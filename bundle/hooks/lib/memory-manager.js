"use strict";

const path = require("node:path");
const {
  MEMORY_MAX_COMPLETED,
  MEMORY_MAX_RECENT_FILES,
  MEMORY_MAX_ERROR_PATTERNS,
  RECENT_GOALS_DISPLAY_COUNT,
  TOP_FILES_DISPLAY_COUNT,
  TOP_ERRORS_DISPLAY_COUNT,
  SEMANTIC_RECALL_TOP_K,
} = require("./constants.js");
const {
  retrieveRelevantGoals,
  retrieveRelevantErrors,
  formatRelevantGoals,
} = require("./semantic-memory.js");
const { indexCompletedGoal, searchMemoryIndex } = require("./memory-index.js");
const { writeJson, readJsonSafe, resolveStatePath } = require("./safe-write.js");

const MEMORY_PATH = path.join(__dirname, "..", "state", "orchestra-memory.json");

const DEFAULT_SESSION_MEMORY = {
  completed_goals: [],
  project_patterns: {},
  recent_files: [],
  error_patterns: [],
  user_preferences: {},
};

const DEFAULT_MEMORY_STATE = {
  version: 1,
  sessions: {},
};

/** Get the session ID from environment variables. */
function getSessionId() {
  return (
    process.env.PCORE_SESSION_ID ||
    process.env.OPENCODE_SESSION_ID ||
    process.env.CLAUDE_SESSION_ID ||
    process.env.CURSOR_TRACE_ID ||
    "pid-" + process.pid
  );
}

/** Migrate legacy flat memory to session-namespaced structure. */
function migrateToSessions(raw) {
  if (raw && raw.sessions && typeof raw.sessions === "object") {
    return raw;
  }

  const sessionId = getSessionId();
  const migrated = {
    version: 1,
    sessions: {},
  };
  migrated.sessions[sessionId] = { ...DEFAULT_SESSION_MEMORY, ...(raw || {}) };
  return migrated;
}

function loadLongTermMemory(sessionId) {
  const session = sessionId || getSessionId();
  try {
    const raw = readJsonSafe(resolveStatePath(MEMORY_PATH), { version: 1, sessions: {} });
    const migrated = migrateToSessions(raw);

    if (!migrated.sessions[session]) {
      migrated.sessions[session] = { ...DEFAULT_SESSION_MEMORY };
    }

    return migrated;
  } catch {
    const empty = { version: 1, sessions: {} };
    empty.sessions[session] = { ...DEFAULT_SESSION_MEMORY };
    return empty;
  }
}

/** Get aggregated memory across all sessions for cross-session recall. */
function getAggregatedMemory(memoryState) {
  if (!memoryState.sessions) return { ...DEFAULT_SESSION_MEMORY };

  const aggregated = { ...DEFAULT_SESSION_MEMORY };
  for (const [, sessionMem] of Object.entries(memoryState.sessions)) {
    if (!sessionMem) continue;
    aggregated.completed_goals.push(...(sessionMem.completed_goals || []));
    aggregated.recent_files.push(...(sessionMem.recent_files || []));
    aggregated.error_patterns.push(...(sessionMem.error_patterns || []));

    for (const [project, patterns] of Object.entries(sessionMem.project_patterns || {})) {
      if (!aggregated.project_patterns[project]) {
        aggregated.project_patterns[project] = [];
      }
      aggregated.project_patterns[project].push(...patterns);
    }

    for (const [key, value] of Object.entries(sessionMem.user_preferences || {})) {
      aggregated.user_preferences[key] = value;
    }
  }

  // Deduplicate and cap
  const seenGoals = new Set();
  aggregated.completed_goals = aggregated.completed_goals
    .filter((g) => {
      const key = g.goal + "|" + g.timestamp;
      if (seenGoals.has(key)) return false;
      seenGoals.add(key);
      return true;
    })
    .slice(-MEMORY_MAX_COMPLETED);

  const fileMap = new Map();
  for (const f of aggregated.recent_files) {
    const existing = fileMap.get(f.path);
    if (existing) {
      existing.count += f.count || 1;
      if (f.last_seen > existing.last_seen) existing.last_seen = f.last_seen;
    } else {
      fileMap.set(f.path, { ...f });
    }
  }
  aggregated.recent_files = Array.from(fileMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, MEMORY_MAX_RECENT_FILES);

  const errorMap = new Map();
  for (const e of aggregated.error_patterns) {
    const existing = errorMap.get(e.error_type);
    if (existing) {
      existing.count += e.count || 1;
      if (e.last_seen > existing.last_seen) existing.last_seen = e.last_seen;
      if (e.solution && !existing.solution) existing.solution = e.solution;
    } else {
      errorMap.set(e.error_type, { ...e });
    }
  }
  aggregated.error_patterns = Array.from(errorMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, MEMORY_MAX_ERROR_PATTERNS);

  return aggregated;
}

function saveLongTermMemory(mem, sessionId) {
  const session = sessionId || getSessionId();
  const memoryPath = resolveStatePath(MEMORY_PATH);
  const fullState = migrateToSessions(readJsonSafe(memoryPath, { version: 1, sessions: {} }));

  if (!fullState.sessions) fullState.sessions = {};
  if (!fullState.sessions[session]) fullState.sessions[session] = { ...DEFAULT_SESSION_MEMORY };

  const target = fullState.sessions[session];
  target.completed_goals = (mem.completed_goals || []).slice(-MEMORY_MAX_COMPLETED);
  target.recent_files = (mem.recent_files || []).slice(-MEMORY_MAX_RECENT_FILES);
  target.error_patterns = (mem.error_patterns || []).slice(-MEMORY_MAX_ERROR_PATTERNS);
  target.project_patterns = mem.project_patterns || target.project_patterns || {};
  target.user_preferences = mem.user_preferences || target.user_preferences || {};

  writeJson(memoryPath, fullState);
}

function flushShortToLong(state, outcome, sessionId) {
  const session = sessionId || getSessionId();
  const fullMem = loadLongTermMemory(session);
  const sessionMem = fullMem.sessions[session] || { ...DEFAULT_SESSION_MEMORY };
  const stm = state.memory || {};

  const duration = state.started_at
    ? Date.now() - new Date(state.started_at).getTime()
    : 0;

  sessionMem.completed_goals.push({
    goal: state.goal || "",
    outcome: outcome || "completed",
    duration_ms: duration,
    timestamp: new Date().toISOString(),
    lessons: (stm.decisions || []).map((d) => d.decision).filter(Boolean),
    phase_count: (stm.phases_completed || []).length,
    tokens_estimated:
      state.tokens?.total_estimated ??
      state.tokens?.last_finalized?.total_estimated ??
      null,
    token_tips: state.tokens?.last_finalized?.tips_count ?? null,
    run_id: state.tokens?.run_id || null,
    plan_artifact: state.planArtifact?.path || null,
  });

  try {
    indexCompletedGoal(
      sessionMem.completed_goals[sessionMem.completed_goals.length - 1],
      new Date().toISOString()
    );
  } catch {}

  for (const f of stm.files_changed || []) {
    const existing = sessionMem.recent_files.find((r) => r.path === f);
    if (existing) {
      existing.count++;
      existing.last_seen = new Date().toISOString();
    } else {
      sessionMem.recent_files.push({ path: f, count: 1, last_seen: new Date().toISOString() });
    }
  }

  for (const e of stm.errors || []) {
    const errorType = (e.error || "").slice(0, 100);
    const existing = sessionMem.error_patterns.find((p) => p.error_type === errorType);
    if (existing) {
      existing.count++;
      existing.last_seen = new Date().toISOString();
    } else {
      sessionMem.error_patterns.push({
        error_type: errorType,
        solution: "",
        count: 1,
        last_seen: new Date().toISOString(),
      });
    }
  }

  saveLongTermMemory(sessionMem, session);
}

function buildMemoryContext(memoryState, options) {
  const aggregated = getAggregatedMemory(memoryState);
  if (!aggregated.completed_goals || aggregated.completed_goals.length === 0) return "";

  const query = options?.query || options?.goal || "";
  const lines = ["Long-term memory (past orchestration results):"];

  if (query.trim()) {
    // Use semantic-memory.js for content-based recall
    const relevant = retrieveRelevantGoals(
      aggregated.completed_goals,
      query,
      SEMANTIC_RECALL_TOP_K
    );
    const relevantBlock = formatRelevantGoals(relevant);
    if (relevantBlock) lines.push(relevantBlock);

    // Also use memory-index.js for token-based search (cross-session)
    const indexed = searchMemoryIndex(query, SEMANTIC_RECALL_TOP_K);
    if (indexed.length > 0) {
      lines.push("Relevant past goals (index search):");
      for (const g of indexed) {
        const lessons =
          g.lessons?.length > 0 ? ` | lessons: ${g.lessons.slice(0, 2).join("; ")}` : "";
        lines.push(
          `  - "${g.goal}" (${g.outcome}, ${Math.round((g.duration_ms || 0) / 1000)}s, score: ${g.score})${lessons}`
        );
      }
    }

    const relevantErrors = retrieveRelevantErrors(
      aggregated.error_patterns,
      query,
      2
    );
    if (relevantErrors.length > 0) {
      lines.push("Relevant error patterns:");
      for (const e of relevantErrors) {
        lines.push(
          `  - ${e.error_type} (${e.count}x${e.solution ? ", fix: " + e.solution : ""})`
        );
      }
    }
  }

  const recent = aggregated.completed_goals.slice(-RECENT_GOALS_DISPLAY_COUNT);
  if (recent.length > 0) {
    lines.push("Recent completed goals:");
    for (const g of recent) {
      lines.push(
        `  - "${g.goal}" (${g.outcome}, ${Math.round(g.duration_ms / 1000)}s, ${g.phase_count} phases)`
      );
    }
  }

  const topFiles = aggregated.recent_files
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_FILES_DISPLAY_COUNT);
  if (topFiles.length > 0) {
    lines.push("Frequently modified files:");
    for (const f of topFiles) {
      lines.push(`  - ${f.path} (modified ${f.count}x)`);
    }
  }

  const topErrors = aggregated.error_patterns
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_ERRORS_DISPLAY_COUNT);
  if (topErrors.length > 0) {
    lines.push("Recurring error patterns:");
    for (const e of topErrors) {
      lines.push(
        `  - ${e.error_type} (${e.count}x${e.solution ? ", solution: " + e.solution : ""})`
      );
    }
  }

  return lines.join("\n");
}

function getSessionMemory(memoryState, sessionId) {
  const session = sessionId || getSessionId();
  if (!memoryState.sessions) return { ...DEFAULT_SESSION_MEMORY };
  return memoryState.sessions[session] || { ...DEFAULT_SESSION_MEMORY };
}

module.exports = {
  MEMORY_PATH,
  DEFAULT_SESSION_MEMORY,
  DEFAULT_MEMORY_STATE,
  getSessionId,
  loadLongTermMemory,
  saveLongTermMemory,
  flushShortToLong,
  buildMemoryContext,
  getAggregatedMemory,
  getSessionMemory,
  migrateToSessions,
  searchMemoryIndex,
};

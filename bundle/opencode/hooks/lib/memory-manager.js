"use strict";

const path = require("node:path");
const {
  MEMORY_MAX_COMPLETED,
  MEMORY_MAX_RECENT_FILES,
  MEMORY_MAX_ERROR_PATTERNS,
  MEMORY_MAX_PROJECT_PATTERNS,
  MEMORY_MAX_USER_PREFERENCES,
  PATTERN_RECALL_TOP_K,
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
  plan_outcomes: [],
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

    aggregated.plan_outcomes.push(...(sessionMem.plan_outcomes || []));
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

  // Aggregate plan outcomes (deduplicate by goal+timestamp)
  const outcomeMap = new Map();
  for (const o of aggregated.plan_outcomes || []) {
    const key = o.goal + "|" + o.timestamp;
    if (!outcomeMap.has(key)) outcomeMap.set(key, { ...o });
  }
  aggregated.plan_outcomes = Array.from(outcomeMap.values())
    .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
    .slice(0, MEMORY_MAX_COMPLETED);

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
  target.plan_outcomes = (mem.plan_outcomes || []).slice(-MEMORY_MAX_COMPLETED);

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



// --- User coding pattern learning ---

/** Infer a task-type key from a goal string (e.g. "api", "frontend", "db", "test"). */
function inferTaskType(goal) {
  const g = (goal || "").toLowerCase();
  if (/(api|endpoint|route|controller|middleware)/.test(g)) return "api";
  if (/(frontend|ui|component|page|view|css|tailwind|react|vue)/.test(g)) return "frontend";
  if (/(database|db|schema|migration|model|prisma|sql)/.test(g)) return "database";
  if (/(test|spec|vitest|jest|unit|integration|e2e)/.test(g)) return "testing";
  if (/(config|setup|install|docker|ci|deploy|env)/.test(g)) return "devops";
  if (/(fix|bug|patch|refactor|clean)/.test(g)) return "bugfix";
  return "general";
}

/** Record/update project-level coding patterns observed during a run. */
function recordProjectPatterns(sessionId, patterns) {
  const session = sessionId || getSessionId();
  const fullMem = loadLongTermMemory(session);
  const sessionMem = fullMem.sessions[session] || { ...DEFAULT_SESSION_MEMORY };
  const existing = sessionMem.project_patterns || {};
  const merged = { ...existing };

  for (const [project, p] of Object.entries(patterns || {})) {
    if (!merged[project]) merged[project] = [];
    merged[project].push({
      task_type: p.task_type || "general",
      files: Array.isArray(p.files) ? p.files : [],
      conventions: p.conventions || {},
      test_framework: p.test_framework || null,
      package_manager: p.package_manager || null,
      style: p.style || null,
      timestamp: new Date().toISOString(),
    });
    if (merged[project].length > MEMORY_MAX_PROJECT_PATTERNS) {
      merged[project] = merged[project].slice(-MEMORY_MAX_PROJECT_PATTERNS);
    }
  }

  sessionMem.project_patterns = merged;
  saveLongTermMemory(sessionMem, session);
}

/** Record/update user-level preferences observed during a run. */
function recordUserPreferences(sessionId, preferences) {
  const session = sessionId || getSessionId();
  const fullMem = loadLongTermMemory(session);
  const sessionMem = fullMem.sessions[session] || { ...DEFAULT_SESSION_MEMORY };
  const merged = { ...(sessionMem.user_preferences || {}), ...(preferences || {}) };

  const keys = Object.keys(merged);
  if (keys.length > MEMORY_MAX_USER_PREFERENCES) {
    const toDrop = keys.slice(0, keys.length - MEMORY_MAX_USER_PREFERENCES);
    for (const k of toDrop) delete merged[k];
  }

  sessionMem.user_preferences = merged;
  saveLongTermMemory(sessionMem, session);
}

/** Build a pattern-aware context block for the planner. */
function buildPatternContext(memoryState, goal) {
  const aggregated = getAggregatedMemory(memoryState);
  const taskType = inferTaskType(goal);
  const lines = [];

  const prefs = aggregated.user_preferences || {};
  const prefKeys = Object.keys(prefs);
  if (prefKeys.length > 0) {
    lines.push("User coding preferences (learned from past runs):");
    for (const k of prefKeys) {
      lines.push("  - " + k + ": " + prefs[k]);
    }
    lines.push("");
  }

  const pats = aggregated.project_patterns || {};
  let relevant = [];
  for (const [project, entries] of Object.entries(pats)) {
    for (const e of entries) {
      if (!e.task_type || e.task_type === taskType || e.task_type === "general") {
        relevant.push({ project: project, ...e });
      }
    }
  }
  relevant.sort(function(a, b) { return new Date(b.timestamp || 0) - new Date(a.timestamp || 0); });
  relevant = relevant.slice(0, PATTERN_RECALL_TOP_K);

  if (relevant.length > 0) {
    lines.push("Learned patterns for similar tasks (task type: " + taskType + "):");
    for (const p of relevant) {
      var files = "";
      if (p.files && p.files.length > 0) files = " files: [" + p.files.join(", ") + "]";
      var tf = p.test_framework ? " test: " + p.test_framework : "";
      var pm = p.package_manager ? " pkg: " + p.package_manager : "";
      var style = p.style ? " style: " + p.style : "";
      lines.push("  - " + p.project + " (" + p.task_type + ")" + files + tf + pm + style + " @ " + new Date(p.timestamp).toLocaleDateString());
    }
    lines.push("");
  }

  return lines.length > 0 ? lines.join("\n") : "";
}

/** Record a plan outcome (verify/review result) keyed by task type for pattern learning. */
function recordPhasePlanOutcome(state, sessionId) {
  const session = sessionId || getSessionId();
  const fullMem = loadLongTermMemory(session);
  const sessionMem = fullMem.sessions[session] || { ...DEFAULT_SESSION_MEMORY };
  const outcomes = sessionMem.plan_outcomes || [];

  const taskType = inferTaskType(state.goal || "");
  const stm = state.memory || {};

  outcomes.push({
    task_type: taskType,
    goal: state.goal || "",
    phase: state.currentPhase || unknown,
    outcome: state.last_outcome || unknown,
    files: Array.isArray(stm.files_changed) ? stm.files_changed : [],
    errors: Array.isArray(stm.errors) ? stm.errors : [],
    duration_ms: state.started_at ? Date.now() - new Date(state.started_at).getTime() : 0,
    timestamp: new Date().toISOString(),
  });

  // Cap outcomes
  if (outcomes.length > MEMORY_MAX_COMPLETED) {
    outcomes.splice(0, outcomes.length - MEMORY_MAX_COMPLETED);
  }

  sessionMem.plan_outcomes = outcomes;
  saveLongTermMemory(sessionMem, session);
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
  buildPatternContext,
  recordProjectPatterns,
  recordUserPreferences,
  inferTaskType,
  getAggregatedMemory,
  getSessionMemory,
  migrateToSessions,
  searchMemoryIndex,
  recordPhasePlanOutcome,
};

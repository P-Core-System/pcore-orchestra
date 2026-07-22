"use strict";

const fs = require("node:fs");
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
const { indexCompletedGoal } = require("./memory-index.js");

const MEMORY_PATH = path.join(__dirname, "..", "state", "orchestra-memory.json");

const DEFAULT_LONG_TERM_MEMORY = {
  version: 1,
  completed_goals: [],
  project_patterns: {},
  recent_files: [],
  error_patterns: [],
  user_preferences: {},
};

function loadLongTermMemory() {
  try {
    if (!fs.existsSync(MEMORY_PATH)) return { ...DEFAULT_LONG_TERM_MEMORY };
    return { ...DEFAULT_LONG_TERM_MEMORY, ...JSON.parse(fs.readFileSync(MEMORY_PATH, "utf8")) };
  } catch {
    return { ...DEFAULT_LONG_TERM_MEMORY };
  }
}

function saveLongTermMemory(mem) {
  fs.mkdirSync(path.dirname(MEMORY_PATH), { recursive: true });
  if (mem.completed_goals.length > MEMORY_MAX_COMPLETED) {
    mem.completed_goals = mem.completed_goals.slice(-MEMORY_MAX_COMPLETED);
  }
  if (mem.recent_files.length > MEMORY_MAX_RECENT_FILES) {
    mem.recent_files = mem.recent_files.slice(-MEMORY_MAX_RECENT_FILES);
  }
  if (mem.error_patterns.length > MEMORY_MAX_ERROR_PATTERNS) {
    mem.error_patterns = mem.error_patterns.slice(-MEMORY_MAX_ERROR_PATTERNS);
  }
  fs.writeFileSync(MEMORY_PATH, JSON.stringify(mem, null, 2));
}

function flushShortToLong(state, outcome) {
  const ltm = loadLongTermMemory();
  const stm = state.memory || {};

  const duration = state.started_at
    ? Date.now() - new Date(state.started_at).getTime()
    : 0;

  ltm.completed_goals.push({
    goal: state.goal || "",
    outcome: outcome || "completed",
    duration_ms: duration,
    timestamp: new Date().toISOString(),
    lessons: (stm.decisions || []).map((d) => d.decision).filter(Boolean),
    phase_count: (stm.phases_completed || []).length,
    tokens_estimated: state.tokens?.total_estimated ?? state.tokens?.last_finalized?.total_estimated ?? null,
    token_tips: state.tokens?.last_finalized?.tips_count ?? null,
    run_id: state.tokens?.run_id || null,
    plan_artifact: state.planArtifact?.path || null,
  });

  try {
    indexCompletedGoal(ltm.completed_goals[ltm.completed_goals.length - 1], new Date().toISOString());
  } catch {}

  for (const f of (stm.files_changed || [])) {
    const existing = ltm.recent_files.find((r) => r.path === f);
    if (existing) {
      existing.count++;
      existing.last_seen = new Date().toISOString();
    } else {
      ltm.recent_files.push({ path: f, count: 1, last_seen: new Date().toISOString() });
    }
  }

  for (const e of (stm.errors || [])) {
    const errorType = (e.error || "").slice(0, 100);
    const existing = ltm.error_patterns.find((p) => p.error_type === errorType);
    if (existing) {
      existing.count++;
      existing.last_seen = new Date().toISOString();
    } else {
      ltm.error_patterns.push({
        error_type: errorType,
        solution: "",
        count: 1,
        last_seen: new Date().toISOString(),
      });
    }
  }

  saveLongTermMemory(ltm);
}

function buildMemoryContext(ltm, options) {
  if (!ltm || !ltm.completed_goals || ltm.completed_goals.length === 0) return "";

  const query = options?.query || options?.goal || "";
  const lines = ["Long-term memory (past orchestration results):"];

  if (query.trim()) {
    const relevant = retrieveRelevantGoals(ltm.completed_goals, query, SEMANTIC_RECALL_TOP_K);
    const relevantBlock = formatRelevantGoals(relevant);
    if (relevantBlock) lines.push(relevantBlock);

    const relevantErrors = retrieveRelevantErrors(ltm.error_patterns, query, 2);
    if (relevantErrors.length > 0) {
      lines.push("Relevant error patterns:");
      for (const e of relevantErrors) {
        lines.push(
          `  - ${e.error_type} (${e.count}x${e.solution ? ", fix: " + e.solution : ""})`
        );
      }
    }
  }

  const recent = ltm.completed_goals.slice(-RECENT_GOALS_DISPLAY_COUNT);
  if (recent.length > 0) {
    lines.push("Recent completed goals:");
    for (const g of recent) {
      lines.push(
        `  - "${g.goal}" (${g.outcome}, ${Math.round(g.duration_ms / 1000)}s, ${g.phase_count} phases)`
      );
    }
  }

  const topFiles = ltm.recent_files.sort((a, b) => b.count - a.count).slice(0, TOP_FILES_DISPLAY_COUNT);
  if (topFiles.length > 0) {
    lines.push("Frequently modified files:");
    for (const f of topFiles) {
      lines.push(`  - ${f.path} (modified ${f.count}x)`);
    }
  }

  const topErrors = ltm.error_patterns.sort((a, b) => b.count - a.count).slice(0, TOP_ERRORS_DISPLAY_COUNT);
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

module.exports = {
  MEMORY_PATH,
  DEFAULT_LONG_TERM_MEMORY,
  loadLongTermMemory,
  saveLongTermMemory,
  flushShortToLong,
  buildMemoryContext,
};

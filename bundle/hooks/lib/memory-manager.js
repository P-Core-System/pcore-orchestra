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
} = require("./constants.js");

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
  });

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

function buildMemoryContext(ltm) {
  if (!ltm || !ltm.completed_goals || ltm.completed_goals.length === 0) return "";

  const lines = ["Long-term memory (past orchestration results):"];

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

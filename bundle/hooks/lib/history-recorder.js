"use strict";

const path = require("node:path");
const { HISTORY_MAX_RUNS } = require("./constants.js");
const { writeJson, readJsonSafe, resolveStatePath } = require("./safe-write.js");

const HISTORY_PATH = path.join(__dirname, "..", "state", "orchestra-history.json");

function recordOrchestrationRun(state, outcome) {
  const historyPath = resolveStatePath(HISTORY_PATH);
  let history = readJsonSafe(historyPath, []);
  if (!Array.isArray(history)) history = [];

  const duration = state.started_at
    ? Date.now() - new Date(state.started_at).getTime()
    : 0;

  history.push({
    goal: state.goal || "",
    outcome,
    started_at: state.started_at,
    completed_at: new Date().toISOString(),
    duration_ms: duration,
    iterations: state.iteration || 0,
    phases_completed: state.memory?.phases_completed?.map((p) => p.phase) || [],
    files_changed: state.memory?.files_changed || [],
    errors: state.memory?.errors?.length || 0,
    tokens_estimated: state.tokens?.total_estimated ?? state.tokens?.last_finalized?.total_estimated ?? null,
    tokens_reported: state.tokens?.total_reported ?? null,
    over_cycle_budget: state.tokens?.last_finalized
      ? state.tokens.last_finalized.total_estimated > 63000
      : null,
  });

  if (history.length > HISTORY_MAX_RUNS) {
    history = history.slice(-HISTORY_MAX_RUNS);
  }

  writeJson(historyPath, history);
}

function loadOrchestrationHistory() {
  const history = readJsonSafe(resolveStatePath(HISTORY_PATH), []);
  return Array.isArray(history) ? history : [];
}

module.exports = {
  HISTORY_PATH,
  recordOrchestrationRun,
  loadOrchestrationHistory,
};

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { HISTORY_MAX_RUNS } = require("./constants.js");

const HISTORY_PATH = path.join(__dirname, "..", "state", "orchestra-history.json");

function recordOrchestrationRun(state, outcome) {
  let history = [];
  try {
    if (fs.existsSync(HISTORY_PATH)) {
      history = JSON.parse(fs.readFileSync(HISTORY_PATH, "utf8"));
    }
  } catch {
    history = [];
  }

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
  });

  if (history.length > HISTORY_MAX_RUNS) {
    history = history.slice(-HISTORY_MAX_RUNS);
  }

  fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
}

function loadOrchestrationHistory() {
  try {
    if (!fs.existsSync(HISTORY_PATH)) return [];
    return JSON.parse(fs.readFileSync(HISTORY_PATH, "utf8"));
  } catch {
    return [];
  }
}

module.exports = {
  HISTORY_PATH,
  recordOrchestrationRun,
  loadOrchestrationHistory,
};

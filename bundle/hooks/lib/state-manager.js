"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  DEFAULT_STALL_THRESHOLD_MS,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
} = require("./constants.js");

const STATE_PATH = path.join(__dirname, "..", "state", "orchestra.json");

const DEFAULT_STATE = {
  version: 2,
  ambient: true,
  active: false,
  goal: "",
  phase: "idle",
  started_at: null,
  last_subagent: null,
  iteration: 0,
  max_iterations: 8,
  last_prompt: null,
  auto_started: null,
  lifecycle: { events: [], phase_history: [] },
  heartbeat: {
    last_beat: null,
    phase_started_at: null,
    stall_threshold_ms: DEFAULT_STALL_THRESHOLD_MS,
    interval_ms: DEFAULT_HEARTBEAT_INTERVAL_MS,
  },
  memory: {
    phases_completed: [],
    files_changed: [],
    errors: [],
    decisions: [],
    context_summary: "",
  },
  resumable: {
    paused: false,
    paused_at: null,
    pause_reason: null,
    checkpoint: null,
    last_save: null,
  },
};

function cloneDefaults() {
  return {
    lifecycle: { events: [], phase_history: [] },
    heartbeat: { ...DEFAULT_STATE.heartbeat },
    memory: { ...DEFAULT_STATE.memory },
    resumable: { ...DEFAULT_STATE.resumable },
  };
}

function loadState() {
  try {
    if (!fs.existsSync(STATE_PATH)) return { ...DEFAULT_STATE, ...cloneDefaults() };
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
    const merged = { ...DEFAULT_STATE, ...raw };
    merged.lifecycle = { ...DEFAULT_STATE.lifecycle, ...merged.lifecycle };
    merged.lifecycle.events = merged.lifecycle.events || [];
    merged.lifecycle.phase_history = merged.lifecycle.phase_history || [];
    merged.heartbeat = { ...DEFAULT_STATE.heartbeat, ...merged.heartbeat };
    merged.memory = { ...DEFAULT_STATE.memory, ...merged.memory };
    merged.resumable = { ...DEFAULT_STATE.resumable, ...merged.resumable };
    merged.version = 2;
    return merged;
  } catch {
    return { ...DEFAULT_STATE, ...cloneDefaults() };
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function startOrchestra(goal, state, source) {
  const { emitLifecycleEvent } = require("./lifecycle-recorder.js");

  state.active = true;
  state.goal = goal;
  state.phase = "plan";
  state.started_at = new Date().toISOString();
  state.last_subagent = null;
  state.iteration = 0;
  state.last_prompt = goal;
  state.auto_started = source || "ambient";
  state.lifecycle = { events: [], phase_history: [] };
  state.heartbeat.last_beat = new Date().toISOString();
  state.heartbeat.phase_started_at = new Date().toISOString();
  state.memory = {
    phases_completed: [], files_changed: [], errors: [], decisions: [], context_summary: "",
  };
  state.resumable = {
    paused: false, paused_at: null, pause_reason: null, checkpoint: null, last_save: null,
  };
  emitLifecycleEvent(state, "orchestra_start", "plan", { goal, source });
  saveState(state);
}

module.exports = {
  STATE_PATH,
  DEFAULT_STATE,
  loadState,
  saveState,
  startOrchestra,
};

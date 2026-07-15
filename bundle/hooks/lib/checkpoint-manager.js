"use strict";

const {
  DEFAULT_STALE_THRESHOLD_MS,
  CRASH_RECOVERY_THRESHOLD_MS,
} = require("./constants.js");
const { DEFAULT_STATE, saveState } = require("./state-manager.js");

function createCheckpoint(state) {
  return {
    phase: state.phase,
    goal: state.goal,
    iteration: state.iteration,
    last_subagent: state.last_subagent,
    started_at: state.started_at,
    lifecycle_snapshot: state.lifecycle?.events?.slice(-20) || [],
    memory_snapshot: state.memory || {},
    timestamp: new Date().toISOString(),
  };
}

function saveCheckpoint(state) {
  if (!state.resumable) state.resumable = { ...DEFAULT_STATE.resumable };
  state.resumable.checkpoint = createCheckpoint(state);
  state.resumable.last_save = new Date().toISOString();
  saveState(state);
}

function pauseOrchestra(state, reason) {
  if (!state.active) return false;
  state.resumable.paused = true;
  state.resumable.paused_at = new Date().toISOString();
  state.resumable.pause_reason = reason || "manual";
  saveCheckpoint(state);
  return true;
}

function resumeOrchestra(state) {
  if (!state.resumable?.paused || !state.resumable?.checkpoint) return null;
  const cp = state.resumable.checkpoint;
  state.active = true;
  state.phase = cp.phase;
  state.goal = cp.goal;
  state.iteration = cp.iteration;
  state.last_subagent = cp.last_subagent;
  state.started_at = cp.started_at;
  state.resumable.paused = false;
  state.resumable.paused_at = null;
  state.resumable.pause_reason = null;
  state.heartbeat.last_beat = new Date().toISOString();
  state.heartbeat.phase_started_at = new Date().toISOString();
  saveState(state);
  return cp;
}

function isStaleState(state, staleThresholdMs) {
  if (!state.active || !state.started_at) return false;
  const elapsed = Date.now() - new Date(state.started_at).getTime();
  return elapsed > (staleThresholdMs || DEFAULT_STALE_THRESHOLD_MS);
}

function detectCrashRecovery(state) {
  if (!state.active) return null;
  const lastBeat = state.heartbeat?.last_beat;
  if (lastBeat) {
    const sinceBeat = Date.now() - new Date(lastBeat).getTime();
    if (sinceBeat > CRASH_RECOVERY_THRESHOLD_MS) {
      return {
        phase: state.phase,
        goal: state.goal,
        iteration: state.iteration,
        last_activity: lastBeat,
      };
    }
  }
  if (isStaleState(state)) {
    return {
      phase: state.phase,
      goal: state.goal,
      iteration: state.iteration,
      last_activity: state.started_at,
    };
  }
  return null;
}

function abortOrchestra(state, reason) {
  if (!state.active) return false;
  const { recordOrchestrationRun } = require("./history-recorder.js");
  recordOrchestrationRun(state, "aborted");
  state.active = false;
  state.phase = "idle";
  state.resumable.paused = true;
  state.resumable.paused_at = new Date().toISOString();
  state.resumable.pause_reason = reason || "aborted";
  saveCheckpoint(state);
  return true;
}

module.exports = {
  createCheckpoint,
  saveCheckpoint,
  pauseOrchestra,
  resumeOrchestra,
  isStaleState,
  detectCrashRecovery,
  abortOrchestra,
};

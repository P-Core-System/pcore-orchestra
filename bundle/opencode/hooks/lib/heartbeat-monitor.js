"use strict";

const { DEFAULT_STATE } = require("./state-manager.js");

function writeHeartbeat(state) {
  if (!state.heartbeat) state.heartbeat = { ...DEFAULT_STATE.heartbeat };
  state.heartbeat.last_beat = new Date().toISOString();
}

function isStalled(state) {
  if (!state.active || !state.heartbeat?.phase_started_at) return false;
  const elapsed = Date.now() - new Date(state.heartbeat.phase_started_at).getTime();
  const threshold = state.heartbeat.stall_threshold_ms || 300000;
  return elapsed > threshold;
}

function getStallDurationMs(state) {
  if (!state.heartbeat?.phase_started_at) return 0;
  return Date.now() - new Date(state.heartbeat.phase_started_at).getTime();
}

module.exports = {
  writeHeartbeat,
  isStalled,
  getStallDurationMs,
};

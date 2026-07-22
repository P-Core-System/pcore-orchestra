"use strict";

const { LIFECYCLE_MAX_EVENTS } = require("./constants.js");
const { DEFAULT_STATE } = require("./state-manager.js");

function emitLifecycleEvent(state, type, phase, data) {
  if (!state.lifecycle) state.lifecycle = { events: [], phase_history: [] };
  const event = { type, phase, timestamp: new Date().toISOString(), data: data || null };
  state.lifecycle.events.push(event);
  if (state.lifecycle.events.length > LIFECYCLE_MAX_EVENTS) {
    state.lifecycle.events = state.lifecycle.events.slice(-LIFECYCLE_MAX_EVENTS);
  }
}

function startPhaseTimer(state, phase, subagent) {
  if (!state.heartbeat) state.heartbeat = { ...DEFAULT_STATE.heartbeat };
  state.heartbeat.phase_started_at = new Date().toISOString();
  if (!state.lifecycle) state.lifecycle = { events: [], phase_history: [] };
  state.lifecycle.phase_history.push({
    phase,
    started_at: state.heartbeat.phase_started_at,
    ended_at: null,
    subagent,
    status: "running",
    duration_ms: null,
  });
}

function endPhaseTimer(state, status) {
  const history = state.lifecycle?.phase_history;
  if (!history || history.length === 0) return;
  const current = history[history.length - 1];
  if (current.status !== "running") return;
  const ended = new Date().toISOString();
  current.ended_at = ended;
  current.status = status || "completed";
  current.duration_ms = new Date(ended) - new Date(current.started_at);
  if (state.heartbeat) state.heartbeat.phase_started_at = null;
}

function getPhaseElapsedMs(state) {
  if (!state.heartbeat?.phase_started_at) return 0;
  return Date.now() - new Date(state.heartbeat.phase_started_at).getTime();
}

module.exports = {
  emitLifecycleEvent,
  startPhaseTimer,
  endPhaseTimer,
  getPhaseElapsedMs,
};

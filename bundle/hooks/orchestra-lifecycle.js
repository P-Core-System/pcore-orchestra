#!/usr/bin/env node
"use strict";

const {
  loadState,
  saveState,
  readStdinJson,
  emit,
  emitLifecycleEvent,
  PHASE_CHAIN,
} = require("./orchestra-lib.js");

/**
 * Lifecycle logger — runs on subagentStop alongside the phase-chain hook.
 * Records phase completion events to state for observability.
 */
async function main() {
  const input = await readStdinJson();
  const status = input.status || "";
  const subagentType = input.subagent_type || input.subagentType || "";

  const state = loadState();
  if (!state.active) {
    emit({});
    return;
  }

  // subagent-stop.js runs first and advances state.phase, so we need to
  // determine the completed phase from the subagent type and PHASE_CHAIN
  const completedPhase = Object.entries(PHASE_CHAIN).find(
    ([, v]) => v.nextPhase === state.phase
  )?.[1]?.nextPhase === state.phase
    ? state.phase
    : state.last_subagent === "orchestra-planner" ? "plan"
    : state.last_subagent === "orchestra-implementer" ? "implement"
    : state.last_subagent === "orchestra-verifier" ? "verify"
    : state.last_subagent === "orchestra-reviewer" ? "review"
    : state.phase;

  // Record the subagent completion event
  emitLifecycleEvent(state, "subagent_complete", completedPhase, {
    subagent: subagentType,
    status,
    iteration: state.iteration,
  });

  // Record errors
  if (status !== "completed") {
    emitLifecycleEvent(state, "subagent_error", state.phase, {
      subagent: subagentType,
      status,
      error: input.error || input.error_message || null,
    });
    if (!state.memory) state.memory = { phases_completed: [], files_changed: [], errors: [], decisions: [], context_summary: "" };
    state.memory.errors.push({
      phase: completedPhase,
      error: `Subagent ${subagentType} exited with status: ${status}`,
      timestamp: new Date().toISOString(),
    });
  }

  // Record phase completion in short-term memory
  if (status === "completed") {
    if (!state.memory) state.memory = { phases_completed: [], files_changed: [], errors: [], decisions: [], context_summary: "" };
    state.memory.phases_completed.push({
      phase: completedPhase,
      subagent: subagentType,
      timestamp: new Date().toISOString(),
    });
  }

  // Write heartbeat beat
  if (!state.heartbeat) state.heartbeat = { last_beat: null, phase_started_at: null, stall_threshold_ms: 300000, interval_ms: 60000 };
  state.heartbeat.last_beat = new Date().toISOString();

  saveState(state);
  emit({});
}

main().catch(() => {
  emit({});
});

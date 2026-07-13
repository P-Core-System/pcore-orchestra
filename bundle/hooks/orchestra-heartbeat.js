#!/usr/bin/env node
"use strict";

const {
  loadState,
  saveState,
  readStdinJson,
  emit,
  isStalled,
  getStallDurationMs,
  emitLifecycleEvent,
  endPhaseTimer,
  writeHeartbeat,
} = require("./orchestra-lib.js");

/**
 * Heartbeat monitor — runs on the `stop` event.
 * 1. Writes alive signal to state.
 * 2. Detects stalled orchestration (phase running too long).
 * 3. Emits stall recovery nudge if needed.
 */
async function main() {
  const input = await readStdinJson();

  const state = loadState();
  if (!state.active) {
    emit({});
    return;
  }

  // Write alive signal
  writeHeartbeat(state);

  // Check for stall
  if (isStalled(state)) {
    const elapsed = getStallDurationMs(state);
    const threshold = state.heartbeat?.stall_threshold_ms || 300000;

    emitLifecycleEvent(state, "stall_detected", state.phase, {
      elapsed_ms: elapsed,
      threshold_ms: threshold,
    });

    // Mark current phase as stalled
    endPhaseTimer(state, "stalled");

    // Recovery: after 2 stall detections, force-abort
    const recentStalls = (state.lifecycle?.events || []).filter(
      (e) => e.type === "stall_detected" && e.phase === state.phase
    ).length;

    if (recentStalls >= 2) {
      const stalledPhase = state.phase;
      emitLifecycleEvent(state, "stall_aborted", stalledPhase, {
        attempts: recentStalls,
      });
      state.active = false;
      state.phase = "idle";
      saveState(state);
      emit({
        followup_message: `Orchestra: phase "${stalledPhase}" stalled ${recentStalls} times. Orchestration aborted. Report to user.`,
      });
      return;
    }

    // First stall — nudge the agent to retry
    saveState(state);
    const nudges = {
      plan: "Orchestra heartbeat: planner may be stalled. Re-launch **orchestra-planner** or skip to implementer if plan exists.",
      implement: "Orchestra heartbeat: implementer may be stalled. Re-launch **orchestra-implementer**.",
      verify: "Orchestra heartbeat: verifier may be stalled. Re-launch **orchestra-verifier**.",
      review: "Orchestra heartbeat: reviewer may be stalled. Re-launch **orchestra-reviewer**.",
    };
    emit({
      followup_message: `${nudges[state.phase] || "Orchestra heartbeat: unknown stall."}\n\nGoal: ${state.goal}`,
    });
    return;
  }

  saveState(state);
  emit({});
}

main().catch(() => {
  emit({});
});

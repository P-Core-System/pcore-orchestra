#!/usr/bin/env node
"use strict";

const { STALL_ATTEMPTS_ABORT_THRESHOLD } = require("./lib/constants.js");
const { readStdinJson, emit } = require("./lib/io.js");
const { loadState, saveState } = require("./lib/state-manager.js");
const { isStalled, getStallDurationMs, writeHeartbeat } = require("./lib/heartbeat-monitor.js");
const { emitLifecycleEvent, endPhaseTimer } = require("./lib/lifecycle-recorder.js");

async function main() {
  const input = await readStdinJson();
  const state = loadState();
  if (!state.active) {
    emit({});
    return;
  }

  writeHeartbeat(state);

  if (isStalled(state)) {
    const elapsed = getStallDurationMs(state);
    const threshold = state.heartbeat?.stall_threshold_ms || 300000;

    emitLifecycleEvent(state, "stall_detected", state.phase, {
      elapsed_ms: elapsed,
      threshold_ms: threshold,
    });

    endPhaseTimer(state, "stalled");

    const recentStalls = (state.lifecycle?.events || []).filter(
      (e) => e.type === "stall_detected" && e.phase === state.phase
    ).length;

    if (recentStalls >= STALL_ATTEMPTS_ABORT_THRESHOLD) {
      const stalledPhase = state.phase;
      emitLifecycleEvent(state, "stall_aborted", stalledPhase, {
        attempts: recentStalls,
      });
      state.active = false;
      state.phase = "idle";
      saveState(state);
      emit({
        followup_message:
          `Orchestra: phase "${stalledPhase}" stalled ${recentStalls} times. Orchestration aborted. Report to user.`,
      });
      return;
    }

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

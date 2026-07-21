#!/usr/bin/env node
"use strict";

const { STALL_ATTEMPTS_ABORT_THRESHOLD } = require("./lib/constants.js");
const { readStdinJson, emit } = require("./lib/io.js");
const { loadState, saveState } = require("./lib/state-manager.js");
const { isStalled, getStallDurationMs, writeHeartbeat } = require("./lib/heartbeat-monitor.js");
const { emitLifecycleEvent, endPhaseTimer } = require("./lib/lifecycle-recorder.js");
const { getAgentForPhase, getPhaseInfo } = require("./lib/phase-engine.js");

function stallNudge(state) {
  const phase = state.currentPhase || state.phase || "unknown";
  const agent = getAgentForPhase(phase);
  const info = getPhaseInfo(phase);
  const label = info ? `${info.category}/${phase}` : phase;

  const special = {
    plan: `Orchestra heartbeat: planner may be stalled at **${label}**. Re-launch **orchestra-planner** (or skip to implementer if PLAN_READY exists).`,
    implement: `Orchestra heartbeat: implementer may be stalled at **${label}**. Re-launch **orchestra-implementer**.`,
    implementation: `Orchestra heartbeat: implementer may be stalled at **${label}**. Re-launch **orchestra-implementer**.`,
    verify: `Orchestra heartbeat: verifier may be stalled at **${label}**. Re-launch **orchestra-verifier**.`,
    review: `Orchestra heartbeat: reviewer may be stalled at **${label}**. Re-launch **orchestra-reviewer**.`,
    idle: `Orchestra heartbeat: active flag set but phase is idle. Say "stop orchestra" or resume with the correct subagent.`,
  };

  if (special[phase]) return special[phase];
  if (agent) {
    return `Orchestra heartbeat: phase **${label}** may be stalled. Re-launch **${agent}** subagent to continue.`;
  }
  return `Orchestra heartbeat: phase "${phase}" may be stalled. Re-launch the matching subagent for this goal.`;
}

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
    const phase = state.currentPhase || "unknown";

    emitLifecycleEvent(state, "stall_detected", phase, {
      elapsed_ms: elapsed,
      threshold_ms: threshold,
      loopMode: state.loopMode || null,
    });

    endPhaseTimer(state, "stalled");

    const recentStalls = (state.lifecycle?.events || []).filter(
      (e) => e.type === "stall_detected" && e.phase === phase
    ).length;

    if (recentStalls >= STALL_ATTEMPTS_ABORT_THRESHOLD) {
      emitLifecycleEvent(state, "stall_aborted", phase, {
        attempts: recentStalls,
      });
      state.active = false;
      state.currentPhase = "idle";
      saveState(state);
      emit({
        followup_message:
          `Orchestra: phase "${phase}" stalled ${recentStalls} times. Orchestration aborted. Report to user.\n\nGoal: ${state.goal}`,
      });
      return;
    }

    saveState(state);
    emit({
      followup_message: `${stallNudge(state)}\n\nGoal: ${state.goal}\nMode: ${state.loopMode || "core"}`,
    });
    return;
  }

  saveState(state);
  emit({});
}

main().catch(() => {
  emit({});
});

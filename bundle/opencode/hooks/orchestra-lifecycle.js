#!/usr/bin/env node
"use strict";

const { readStdinJson, emit } = require("./lib/io.js");
const { loadState, saveState } = require("./lib/state-manager.js");
const { emitLifecycleEvent } = require("./lib/lifecycle-recorder.js");
const { getPhaseChain } = require("./lib/phase-engine.js");

function resolveCompletedPhase(state, subagentType) {
  const chain = getPhaseChain(state);
  const entry = Object.entries(chain).find(
    ([, v]) => v.nextPhase === state.currentPhase
  );
  if (entry && entry[1].nextPhase === state.currentPhase) return state.currentPhase;
  const phaseMap = {
    "orchestra-planner": "plan",
    "orchestra-implementer": state.loopMode === "enterprise" ? "implementation" : "implement",
    "orchestra-verifier": "verify",
    "orchestra-reviewer": "review",
    "business-analyst": "idea",
  };
  return phaseMap[subagentType || state.last_subagent] || state.currentPhase;
}

async function main() {
  const input = await readStdinJson();
  const status = input.status || "";
  const subagentType = input.subagent_type || input.subagentType || "";

  const state = loadState();
  if (!state.active) {
    emit({});
    return;
  }

  const completedPhase = resolveCompletedPhase(state, subagentType);

  emitLifecycleEvent(state, "subagent_complete", completedPhase, {
    subagent: subagentType,
    status,
    iteration: state.iteration,
  });

  if (status !== "completed") {
    emitLifecycleEvent(state, "subagent_error", state.currentPhase, {
      subagent: subagentType,
      status,
      error: input.error || input.error_message || null,
    });
    if (!state.memory) {
      state.memory = { phases_completed: [], files_changed: [], errors: [], decisions: [], context_summary: "" };
    }
    state.memory.errors.push({
      phase: completedPhase,
      error: `Subagent ${subagentType} exited with status: ${status}`,
      timestamp: new Date().toISOString(),
    });
  }

  if (status === "completed") {
    if (!state.memory) {
      state.memory = { phases_completed: [], files_changed: [], errors: [], decisions: [], context_summary: "" };
    }
    state.memory.phases_completed.push({
      phase: completedPhase,
      subagent: subagentType,
      timestamp: new Date().toISOString(),
    });
  }

  if (!state.heartbeat) {
    state.heartbeat = { last_beat: null, phase_started_at: null, stall_threshold_ms: 300000, interval_ms: 60000 };
  }
  state.heartbeat.last_beat = new Date().toISOString();

  saveState(state);
  emit({});
}

main().catch(() => {
  emit({});
});

#!/usr/bin/env node
"use strict";

const {
  DEFAULT_STALL_THRESHOLD_MS,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
} = require("./lib/constants.js");
const { readStdinJson, emit } = require("./lib/io.js");
const { loadState, saveState, DEFAULT_STATE } = require("./lib/state-manager.js");
const { PHASE_CHAIN, reviewerNeedsFix, getAgentForPhase } = require("./lib/phase-engine.js");
const { emitLifecycleEvent, endPhaseTimer, startPhaseTimer } = require("./lib/lifecycle-recorder.js");
const { flushShortToLong } = require("./lib/memory-manager.js");
const { recordOrchestrationRun } = require("./lib/history-recorder.js");

function handleFixRequired(input, state, subagentType) {
  state.phase = "implement";
  emitLifecycleEvent(state, "fix_required", state.phase, { iteration: state.iteration });
  if (!state.memory) state.memory = { ...DEFAULT_STATE.memory };
  state.memory.decisions.push({
    phase: "review",
    decision: "FIX_REQUIRED",
    rationale: "Reviewer requested fixes",
    timestamp: new Date().toISOString(),
  });

  if (state.iteration >= state.max_iterations) {
    emitLifecycleEvent(state, "max_iterations", state.phase, { iteration: state.iteration });
    state.active = false;
    state.phase = "idle";
    saveState(state);
    emit({
      followup_message:
        "Orchestra max iterations reached after FIX_REQUIRED. Report blockers to the user.",
    });
    return true;
  }

  startPhaseTimer(state, "implement", "orchestra-implementer");
  saveState(state);
  emit({
    followup_message:
      `Orchestra — FIX_REQUIRED. Use **orchestra-implementer** subagent to address reviewer blockers, then continue verify → review.\n\nGoal: ${state.goal}`,
  });
  return true;
}

function handlePhaseComplete(state, chain) {
  state.phase = chain.nextPhase;
  emitLifecycleEvent(state, "phase_advance", state.phase, {
    from: state.last_subagent,
    to: chain.nextPhase,
  });

  if (chain.nextPhase === "done") {
    emitLifecycleEvent(state, "orchestra_complete", "done", { goal: state.goal });
    flushShortToLong(state, "completed");
    recordOrchestrationRun(state, "completed");
    state.active = false;
    state.phase = "idle";
    saveState(state);
    emit({
      followup_message:
        `Orchestra complete (ambient). Goal: ${state.goal || "(no goal)"}. Summarize deliverables for the user.`,
    });
    return true;
  }

  if (state.iteration >= state.max_iterations) {
    emitLifecycleEvent(state, "max_iterations", state.phase, { iteration: state.iteration });
    flushShortToLong(state, "max_iterations");
    recordOrchestrationRun(state, "max_iterations");
    state.active = false;
    state.phase = "idle";
    saveState(state);
    emit({
      followup_message:
        "Orchestra hit max iterations. Stop chaining and give the user a status report.",
    });
    return true;
  }

  saveState(state);
  startPhaseTimer(state, chain.nextPhase, getAgentForPhase(chain.nextPhase));
  saveState(state);

  emit({
    followup_message: `${chain.followup}\n\nGoal: ${state.goal}`,
  });
  return true;
}

async function main() {
  const input = await readStdinJson();
  const status = input.status || "";
  const subagentType = input.subagent_type || input.subagentType || "";

  if (status !== "completed") {
    emit({});
    return;
  }

  const state = loadState();
  if (!state.active) {
    emit({});
    return;
  }

  const chain = PHASE_CHAIN[subagentType];
  if (!chain) {
    emit({});
    return;
  }

  state.last_subagent = subagentType;
  state.iteration = (state.iteration || 0) + 1;

  endPhaseTimer(state, "completed");
  emitLifecycleEvent(state, "phase_complete", state.phase, {
    subagent: subagentType,
    iteration: state.iteration,
  });

  const newMemory = {
    phases_completed: [],
    files_changed: [],
    errors: [],
    decisions: [],
    context_summary: "",
  };
  if (!state.memory) state.memory = newMemory;

  if (subagentType === "orchestra-reviewer" && reviewerNeedsFix(input)) {
    if (handleFixRequired(input, state, subagentType)) return;
  }

  handlePhaseComplete(state, chain);
}

main().catch(() => {
  emit({});
});

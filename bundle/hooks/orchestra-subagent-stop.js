#!/usr/bin/env node
"use strict";

const {
  loadState,
  saveState,
  readStdinJson,
  emit,
  PHASE_CHAIN,
  reviewerNeedsFix,
  emitLifecycleEvent,
  endPhaseTimer,
  startPhaseTimer,
  flushShortToLong,
  recordOrchestrationRun,
} = require("./orchestra-lib.js");

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

  // End phase timer for completed subagent
  endPhaseTimer(state, "completed");
  emitLifecycleEvent(state, "phase_complete", state.phase, {
    subagent: subagentType,
    iteration: state.iteration,
  });

  // Reviewer asked for fixes — loop back to implementer
  if (subagentType === "orchestra-reviewer" && reviewerNeedsFix(input)) {
    state.phase = "implement";
    emitLifecycleEvent(state, "fix_required", state.phase, { iteration: state.iteration });
    if (!state.memory) state.memory = { phases_completed: [], files_changed: [], errors: [], decisions: [], context_summary: "" };
    state.memory.decisions.push({
      phase: "review",
      decision: "FIX_REQUIRED",
      rationale: "Reviewer requested fixes",
      timestamp: new Date().toISOString(),
    });
    saveState(state);
    if (state.iteration >= state.max_iterations) {
      emitLifecycleEvent(state, "max_iterations", state.phase, { iteration: state.iteration });
      state.active = false;
      state.phase = "idle";
      saveState(state);
      emit({
        followup_message:
          "Orchestra max iterations reached after FIX_REQUIRED. Report blockers to the user.",
      });
      return;
    }
    // Start timer for implement phase
    startPhaseTimer(state, "implement", "orchestra-implementer");
    saveState(state);
    emit({
      followup_message: `Orchestra — FIX_REQUIRED. Use **orchestra-implementer** subagent to address reviewer blockers, then continue verify → review.\n\nGoal: ${state.goal}`,
    });
    return;
  }

  state.phase = chain.nextPhase;
  emitLifecycleEvent(state, "phase_advance", state.phase, {
    from: subagentType,
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
      followup_message: `Orchestra complete (ambient). Goal: ${state.goal || "(no goal)"}. Summarize deliverables for the user.`,
    });
    return;
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
    return;
  }

  saveState(state);

  // Start timer for next phase
  const nextAgent = chain.nextPhase === "implement"
    ? "orchestra-implementer"
    : chain.nextPhase === "verify"
    ? "orchestra-verifier"
    : chain.nextPhase === "review"
    ? "orchestra-reviewer"
    : "orchestra-planner";
  startPhaseTimer(state, chain.nextPhase, nextAgent);
  saveState(state);

  emit({
    followup_message: `${chain.followup}\n\nGoal: ${state.goal}`,
  });
}

main().catch(() => {
  emit({});
});

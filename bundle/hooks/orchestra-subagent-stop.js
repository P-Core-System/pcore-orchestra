#!/usr/bin/env node
"use strict";

const {
  loadState,
  saveState,
  readStdinJson,
  emit,
  PHASE_CHAIN,
  reviewerNeedsFix,
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

  // Reviewer asked for fixes — loop back to implementer
  if (subagentType === "orchestra-reviewer" && reviewerNeedsFix(input)) {
    state.phase = "implement";
    saveState(state);
    if (state.iteration >= state.max_iterations) {
      state.active = false;
      state.phase = "idle";
      saveState(state);
      emit({
        followup_message:
          "Orchestra max iterations reached after FIX_REQUIRED. Report blockers to the user.",
      });
      return;
    }
    emit({
      followup_message: `Orchestra — FIX_REQUIRED. Use **orchestra-implementer** subagent to address reviewer blockers, then continue verify → review.\n\nGoal: ${state.goal}`,
    });
    return;
  }

  state.phase = chain.nextPhase;
  saveState(state);

  if (chain.nextPhase === "done") {
    state.active = false;
    state.phase = "idle";
    saveState(state);
    emit({
      followup_message: `Orchestra complete (ambient). Goal: ${state.goal || "(no goal)"}. Summarize deliverables for the user.`,
    });
    return;
  }

  if (state.iteration >= state.max_iterations) {
    state.active = false;
    state.phase = "idle";
    saveState(state);
    emit({
      followup_message:
        "Orchestra hit max iterations. Stop chaining and give the user a status report.",
    });
    return;
  }

  emit({
    followup_message: `${chain.followup}\n\nGoal: ${state.goal}`,
  });
}

main().catch(() => {
  emit({});
});

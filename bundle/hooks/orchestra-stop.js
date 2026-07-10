#!/usr/bin/env node
"use strict";

const {
  loadState,
  readStdinJson,
  emit,
  AMBIENT_CONTEXT,
} = require("./orchestra-lib.js");

async function main() {
  const input = await readStdinJson();
  const status = input.status || "";
  const loopCount = Number(input.loop_count ?? 0);

  if (status !== "completed") {
    emit({});
    return;
  }

  const state = loadState();
  if (!state.active) {
    emit({});
    return;
  }

  const nudges = {
    plan: "Orchestra active — launch **orchestra-planner** subagent (Task) if planning is not done.",
    implement:
      "Orchestra active — continue with **orchestra-implementer** subagent.",
    verify: "Orchestra active — continue with **orchestra-verifier** subagent.",
    review: "Orchestra active — continue with **orchestra-reviewer** subagent.",
  };

  const nudge = nudges[state.phase];
  if (!nudge || loopCount >= 3) {
    emit({});
    return;
  }

  emit({
    followup_message: `${nudge}\n\nGoal: ${state.goal}\n\n(${AMBIENT_CONTEXT.split(".")[0]}.)`,
  });
}

main().catch(() => {
  emit({});
});

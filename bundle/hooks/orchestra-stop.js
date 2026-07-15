#!/usr/bin/env node
"use strict";

const { STOP_NUDGE_LOOP_LIMIT } = require("./lib/constants.js");
const { readStdinJson, emit } = require("./lib/io.js");
const { loadState, saveState } = require("./lib/state-manager.js");
const { AMBIENT_CONTEXT } = require("./lib/context-detector.js");
const { isStalled, writeHeartbeat } = require("./lib/heartbeat-monitor.js");

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

  writeHeartbeat(state);
  saveState(state);

  if (isStalled(state)) {
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
  if (!nudge || loopCount >= STOP_NUDGE_LOOP_LIMIT) {
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

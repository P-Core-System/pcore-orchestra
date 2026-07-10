#!/usr/bin/env node
"use strict";

const { loadState, saveState, startOrchestra } = require("./orchestra-lib.js");

const [, , cmd, ...rest] = process.argv;
const goal = rest.join(" ").trim();

function printStatus(state) {
  console.log(JSON.stringify(state, null, 2));
}

if (!cmd || cmd === "status") {
  printStatus(loadState());
  process.exit(0);
}

if (cmd === "stop") {
  const state = loadState();
  state.active = false;
  state.phase = "idle";
  state.goal = "";
  state.last_subagent = null;
  saveState(state);
  console.log("Orchestra loop stopped (ambient mode unchanged).");
  printStatus(state);
  process.exit(0);
}

if (cmd === "ambient-off") {
  const state = loadState();
  state.ambient = false;
  state.active = false;
  state.phase = "idle";
  saveState(state);
  console.log("Orchestra ambient mode OFF.");
  printStatus(state);
  process.exit(0);
}

if (cmd === "ambient-on") {
  const state = loadState();
  state.ambient = true;
  saveState(state);
  console.log("Orchestra ambient mode ON — auto-runs on implement/fix/build prompts.");
  printStatus(state);
  process.exit(0);
}

if (cmd === "start") {
  if (!goal) {
    console.error("Usage: orchestra-enable.js start \"<goal>\"");
    process.exit(1);
  }
  const state = loadState();
  startOrchestra(goal, state, "manual");
  console.log("Orchestra loop started (manual).");
  console.log(`Goal: ${goal}`);
  console.log("Next: launch orchestra-planner subagent (Task tool).");
  printStatus(state);
  process.exit(0);
}

console.error("Usage: orchestra-enable.js start \"<goal>\" | stop | status | ambient-on | ambient-off");
process.exit(1);

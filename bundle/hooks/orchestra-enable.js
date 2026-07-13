#!/usr/bin/env node
"use strict";

const {
  loadState,
  saveState,
  startOrchestra,
  pauseOrchestra,
  resumeOrchestra,
  abortOrchestra,
  loadLongTermMemory,
  saveLongTermMemory,
  loadOrchestrationHistory,
} = require("./orchestra-lib.js");

const [, , cmd, ...rest] = process.argv;
const arg = rest.join(" ").trim();

function printStatus(state) {
  console.log(JSON.stringify(state, null, 2));
}

function printMemory() {
  const mem = loadLongTermMemory();
  console.log("=== Long-term Memory ===");
  console.log(`Completed goals: ${mem.completed_goals.length}`);
  console.log(`Recent files: ${mem.recent_files.length}`);
  console.log(`Error patterns: ${mem.error_patterns.length}`);
  if (mem.completed_goals.length > 0) {
    console.log("\nLast 5 goals:");
    for (const g of mem.completed_goals.slice(-5)) {
      console.log(`  - "${g.goal}" (${g.outcome}, ${Math.round(g.duration_ms / 1000)}s)`);
    }
  }
}

if (!cmd || cmd === "status") {
  const state = loadState();
  printStatus(state);
  const ltm = loadLongTermMemory();
  console.log(`\nMemory: ${ltm.completed_goals.length} past goals, ${ltm.recent_files.length} tracked files`);
  process.exit(0);
}

if (cmd === "stop") {
  const state = loadState();
  state.active = false;
  state.phase = "idle";
  state.goal = "";
  state.last_subagent = null;
  state.resumable = { paused: false, paused_at: null, pause_reason: null, checkpoint: null, last_save: null };
  saveState(state);
  console.log("Orchestra loop stopped (ambient mode unchanged).");
  printStatus(state);
  process.exit(0);
}

if (cmd === "pause") {
  const state = loadState();
  if (!state.active) {
    console.log("No active orchestration to pause.");
    process.exit(0);
  }
  const reason = arg || "manual";
  pauseOrchestra(state, reason);
  state.active = false;
  state.phase = "paused";
  saveState(state);
  console.log(`Orchestra paused (${reason}). Goal: ${state.goal}`);
  console.log("Resume with: orchestra-enable.js resume");
  printStatus(state);
  process.exit(0);
}

if (cmd === "resume") {
  const state = loadState();
  if (state.resumable?.paused && state.resumable?.checkpoint) {
    const cp = resumeOrchestra(state);
    console.log(`Orchestra resumed from phase "${cp.phase}". Goal: ${cp.goal}`);
    console.log("Continue with the matching orchestra-* subagent.");
    printStatus(state);
  } else if (state.active) {
    console.log("Orchestra is already active.");
    printStatus(state);
  } else {
    console.log("No paused orchestration to resume.");
    if (state.resumable?.checkpoint) {
      console.log("Last checkpoint:", JSON.stringify(state.resumable.checkpoint, null, 2));
    }
  }
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
  if (!arg) {
    console.error('Usage: orchestra-enable.js start "<goal>"');
    process.exit(1);
  }
  const state = loadState();
  startOrchestra(arg, state, "manual");
  console.log("Orchestra loop started (manual).");
  console.log(`Goal: ${arg}`);
  console.log("Next: launch orchestra-planner subagent (Task tool).");
  printStatus(state);
  process.exit(0);
}

if (cmd === "memory") {
  if (arg === "clear") {
    const empty = {
      version: 1,
      completed_goals: [],
      project_patterns: {},
      recent_files: [],
      error_patterns: [],
      user_preferences: {},
    };
    saveLongTermMemory(empty);
    console.log("Long-term memory cleared.");
  } else {
    printMemory();
  }
  process.exit(0);
}

if (cmd === "checkpoint") {
  const state = loadState();
  if (!state.active) {
    console.log("No active orchestration to checkpoint.");
    process.exit(0);
  }
  const { saveCheckpoint } = require("./orchestra-lib.js");
  saveCheckpoint(state);
  console.log("Checkpoint saved.");
  printStatus(state);
  process.exit(0);
}

if (cmd === "abort") {
  const state = loadState();
  if (!state.active) {
    console.log("No active orchestration to abort.");
    process.exit(0);
  }
  const reason = arg || "manual";
  abortOrchestra(state, reason);
  console.log(`Orchestra aborted (${reason}). Goal: ${state.goal}`);
  console.log('Resume with: orchestra-enable.js resume');
  process.exit(0);
}

if (cmd === "history") {
  const history = loadOrchestrationHistory();
  if (history.length === 0) {
    console.log("No orchestration history.");
  } else {
    console.log(`=== Orchestration History (${history.length} runs) ===\n`);
    for (const run of history.slice(-10)) {
      const dur = Math.round(run.duration_ms / 1000);
      console.log(`  ${run.completed_at} | ${run.outcome.padEnd(15)} | ${dur}s | ${run.iterations} iters | "${run.goal}"`);
    }
  }
  process.exit(0);
}

console.error(
  "Usage: orchestra-enable.js <command>\n\n" +
  "Commands:\n" +
  "  status         Show current state\n" +
  '  start "goal"   Start orchestra manually\n' +
  "  stop           Stop active loop\n" +
  "  pause [reason] Pause and save checkpoint\n" +
  "  resume         Resume from checkpoint\n" +
  "  abort [reason] Abort and save checkpoint\n" +
  "  checkpoint     Save current state checkpoint\n" +
  "  ambient-on     Enable ambient mode\n" +
  "  ambient-off    Disable ambient mode\n" +
  "  memory         Show long-term memory\n" +
  "  memory clear   Clear long-term memory\n" +
  "  history        Show orchestration history"
);
process.exit(1);

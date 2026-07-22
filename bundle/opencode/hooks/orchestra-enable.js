#!/usr/bin/env node
"use strict";

const { HISTORY_DISPLAY_COUNT } = require("./lib/constants.js");
const { loadState, saveState, startOrchestra } = require("./lib/state-manager.js");
const { pauseOrchestra, resumeOrchestra, abortOrchestra } = require("./lib/checkpoint-manager.js");
const {
  loadLongTermMemory,
  saveLongTermMemory,
  DEFAULT_LONG_TERM_MEMORY,
} = require("./lib/memory-manager.js");
const { loadOrchestrationHistory } = require("./lib/history-recorder.js");
const { printTokenReport } = require("./lib/token-tracker.js");
const { printOrchestraMetrics } = require("./lib/metrics-report.js");

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

const COMMANDS = {
  status() {
    const state = loadState();
    printStatus(state);
    const ltm = loadLongTermMemory();
    console.log(`\nMemory: ${ltm.completed_goals.length} past goals, ${ltm.recent_files.length} tracked files`);
  },

  stop() {
    const state = loadState();
    state.active = false;
    state.currentPhase = "idle";
    state.goal = "";
    state.last_subagent = null;
    state.resumable = { paused: false, paused_at: null, pause_reason: null, checkpoint: null, last_save: null };
    saveState(state);
    console.log("Orchestra loop stopped (ambient mode unchanged).");
    printStatus(state);
  },

  pause() {
    const state = loadState();
    if (!state.active) {
      console.log("No active orchestration to pause.");
      return;
    }
    const reason = arg || "manual";
    pauseOrchestra(state, reason);
    state.active = false;
    state.currentPhase = "paused";
    saveState(state);
    console.log(`Orchestra paused (${reason}). Goal: ${state.goal}`);
    console.log("Resume with: orchestra-enable.js resume");
    printStatus(state);
  },

  resume() {
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
  },

  "ambient-off"() {
    const state = loadState();
    state.ambient = false;
    state.active = false;
    state.currentPhase = "idle";
    saveState(state);
    console.log("Orchestra ambient mode OFF.");
    printStatus(state);
  },

  "ambient-on"() {
    const state = loadState();
    state.ambient = true;
    saveState(state);
    console.log("Orchestra ambient mode ON — auto-runs on implement/fix/build prompts.");
    printStatus(state);
  },

  start() {
    if (!arg) {
      console.error('Usage: orchestra-enable.js start "<goal>"');
      process.exit(1);
    }
    const state = loadState();
    const { loadOrchestraConfigFromRoot, extractOrchestraFromIdentity } = require("./lib/orchestra-config.js");
    const { syncWorkspaceIdentity } = require("./lib/workspace-identity.js");
    const orchestraConfig = loadOrchestraConfigFromRoot(process.cwd());
    const identitySync = syncWorkspaceIdentity(state, { cwd: process.cwd() });
    const orchestraCfg = identitySync
      ? extractOrchestraFromIdentity(identitySync.identity)
      : orchestraConfig;
    startOrchestra(arg, state, "manual", { orchestraConfig: orchestraCfg || orchestraConfig });
    console.log("Orchestra loop started (manual).");
    console.log(`Goal: ${arg}`);
    console.log("Next: launch orchestra-planner subagent (Task tool).");
    printStatus(state);
  },

  memory() {
    if (arg === "clear") {
      saveLongTermMemory({ ...DEFAULT_LONG_TERM_MEMORY });
      console.log("Long-term memory cleared.");
      return;
    }
    if (arg.startsWith("recall ")) {
      const query = arg.slice("recall ".length).trim();
      if (!query) {
        console.error('Usage: orchestra-enable.js memory recall "<query>"');
        process.exit(1);
      }
      const ltm = loadLongTermMemory();
      const { retrieveRelevantGoals, retrieveRelevantErrors, formatRelevantGoals } = require("./lib/semantic-memory.js");
      const goals = retrieveRelevantGoals(ltm.completed_goals, query);
      const errors = retrieveRelevantErrors(ltm.error_patterns, query);
      console.log(formatRelevantGoals(goals) || "No relevant goals found.");
      if (errors.length > 0) {
        console.log("\nRelevant errors:");
        for (const e of errors) {
          console.log(`  - ${e.error_type} (${e.count}x)`);
        }
      }
      return;
    }
    printMemory();
  },

  checkpoint() {
    const { saveCheckpoint } = require("./lib/checkpoint-manager.js");
    const state = loadState();
    if (!state.active) {
      console.log("No active orchestration to checkpoint.");
      return;
    }
    saveCheckpoint(state);
    console.log("Checkpoint saved.");
    printStatus(state);
  },

  abort() {
    const state = loadState();
    if (!state.active) {
      console.log("No active orchestration to abort.");
      return;
    }
    const reason = arg || "manual";
    abortOrchestra(state, reason);
    console.log(`Orchestra aborted (${reason}). Goal: ${state.goal}`);
    console.log("Resume with: orchestra-enable.js resume");
  },

  history() {
    const history = loadOrchestrationHistory();
    if (history.length === 0) {
      console.log("No orchestration history.");
    } else {
      console.log(`=== Orchestration History (${history.length} runs) ===\n`);
      for (const run of history.slice(-HISTORY_DISPLAY_COUNT)) {
        const dur = Math.round(run.duration_ms / 1000);
        const tok =
          run.tokens_estimated != null
            ? ` | ~${run.tokens_estimated.toLocaleString()} tok`
            : "";
        console.log(
          `  ${run.completed_at} | ${run.outcome.padEnd(15)} | ${dur}s | ${run.iterations} iters${tok} | "${run.goal}"`
        );
      }
    }
  },

  tokens() {
    if (arg === "clear") {
      const { saveTokenState, DEFAULT_TOKEN_STATE } = require("./lib/token-tracker.js");
      saveTokenState({
        ...DEFAULT_TOKEN_STATE,
        runs: [],
        aggregates: {
          total_runs: 0,
          total_tokens_estimated: 0,
          total_tokens_reported: 0,
          by_agent: {},
          by_phase: {},
        },
        tips: [],
        last_summary: null,
      });
      console.log("Token usage history cleared.");
      return;
    }
    printTokenReport();
  },

  metrics() {
    printOrchestraMetrics();
  },

  cycles() {
    const { printCyclesReport } = require("./lib/cycle-report.js");
    const n = parseInt(arg, 10);
    printCyclesReport(Number.isNaN(n) ? 10 : n);
  },
};

const USAGE =
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
  '  memory recall "q"  Semantic search past goals/errors\n' +
  "  history        Show orchestration history\n" +
  "  tokens         Show token usage report and improvement tips\n" +
  "  tokens clear   Clear token usage history\n" +
  "  metrics        Combined dashboard (history, tokens, memory, observability)\n" +
  "  cycles [n]     Production cycle reports (default 10)";

if (!cmd || !COMMANDS[cmd]) {
  console.error(cmd ? `Unknown command: ${cmd}\n` : "", USAGE);
  process.exit(cmd ? 1 : 0);
}

COMMANDS[cmd]();
process.exit(0);

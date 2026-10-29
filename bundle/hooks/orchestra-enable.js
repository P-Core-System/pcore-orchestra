#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { HISTORY_DISPLAY_COUNT } = require("./lib/constants.js");
const { loadState, saveState, startOrchestra } = require("./lib/state-manager.js");
const { pauseOrchestra, resumeOrchestra, abortOrchestra } = require("./lib/checkpoint-manager.js");
const {
  loadLongTermMemory,
  saveLongTermMemory,
  DEFAULT_LONG_TERM_MEMORY,
  getSessionMemory,
  getSessionId,
  getAggregatedMemory,
} = require("./lib/memory-manager.js");
const { loadOrchestrationHistory } = require("./lib/history-recorder.js");
const { printTokenReport } = require("./lib/token-tracker.js");
const { printOrchestraMetrics } = require("./lib/metrics-report.js");
const { writeJson, readJsonSafe, resolveStatePath } = require("./lib/safe-write.js");

const [, , cmd, ...rest] = process.argv;
const arg = rest.join(" ").trim();

function printStatus(state) {
  console.log(JSON.stringify(state, null, 2));
}

function printMemory() {
  const mem = getAggregatedMemory(loadLongTermMemory());
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

// ── Automation triggers (see docs/automation-triggers.md) ────────────────
// Thin CLI over lib/trigger-scheduler.js. Guard state lives in
// state/trigger-state.json (safe-write, PCORE_STATE_DIR-aware): last run,
// recent run timestamps for the daily budget, and dedupe keys.

const TRIGGER_STATE_PATH = path.join(__dirname, "state", "trigger-state.json");
const TRIGGER_RUN_HISTORY_CAP = 100;
const TRIGGER_DEDUPE_TTL_MS = 24 * 60 * 60 * 1000; // state hygiene floor

function loadTriggerState() {
  const raw = readJsonSafe(resolveStatePath(TRIGGER_STATE_PATH), null);
  const s = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    last_run: typeof s.last_run === "string" ? s.last_run : null,
    runs: Array.isArray(s.runs) ? s.runs : [],
    dedupe: s.dedupe && typeof s.dedupe === "object" && !Array.isArray(s.dedupe) ? s.dedupe : {},
  };
}

function saveTriggerState(state) {
  writeJson(resolveStatePath(TRIGGER_STATE_PATH), state);
}

/** project.yaml -> orchestra.triggers; null = not configured = disabled. */
function loadTriggerConfig() {
  const { loadProjectIdentity } = require("./lib/project-identity.js");
  const { normalizeTriggerConfig } = require("./lib/trigger-scheduler.js");
  const identity = loadProjectIdentity(process.cwd());
  const raw = identity && identity.orchestra ? identity.orchestra.triggers : undefined;
  if (raw === undefined) return null;
  return normalizeTriggerConfig(raw); // throws on invalid config (fail loud)
}

/** Shared exit path for a refused/failed trigger invocation. */
function triggerRefuse(message) {
  console.error(`triggers: ${message}`);
  process.exit(1);
}

function triggerConfigOrExit() {
  try {
    const config = loadTriggerConfig();
    if (config === null) {
      triggerRefuse(
        "not configured — add an `orchestra.triggers:` block to project.yaml " +
          "(docs/automation-triggers.md); manual runs: orchestra-enable.js start \"<goal>\""
      );
    }
    return config;
  } catch (e) {
    triggerRefuse(`config error: ${e.message}`);
  }
}

const COMMANDS = {
  status() {
    const state = loadState();
    printStatus(state);
    const sessionId = getSessionId();
    const ltm = getSessionMemory(loadLongTermMemory(), sessionId);
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
    console.log(
      "Auto-continue: launch orchestra-planner via Task NOW (or conductor fallback if Task rejects orchestra-*). Do not wait for the user."
    );
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
      const sessionId = getSessionId();
    const ltm = getSessionMemory(loadLongTermMemory(), sessionId);
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

  // Automation triggers — scheduled sweep + external events, all guarded
  // (debounce / dedupe / daily budget). Docs: docs/automation-triggers.md.
  triggers() {
    const [sub, ...flagTokens] = rest;
    const which = sub || "status";
    const ts = require("./lib/trigger-scheduler.js");

    if (which === "status") {
      const config = triggerConfigOrExit();
      const now = new Date();
      const state = loadTriggerState();
      const runsToday = ts.tallyRunsToday(state.runs, now);
      const due = ts.isDue(now, state.last_run, config.scheduleSpec);
      const next = ts.nextDue(now, state.last_run, config.scheduleSpec);
      console.log("=== Automation triggers ===");
      console.log(`  schedule:       ${config.scheduleSpec} (${config.schedule.type})`);
      console.log(`  debounce:       ${config.debounceMinutes} min`);
      console.log(`  daily budget:   ${runsToday}/${config.dailyBudget} used today`);
      console.log(`  events:         ${config.events.join(", ")}`);
      console.log(`  last run:       ${state.last_run || "never"}`);
      console.log(
        `  next due:       ${due ? "due now" : next ? next.toISOString() : "never (no future occurrence)"}`
      );
      console.log(
        `  dedupe keys:    ${Object.keys(state.dedupe).length} tracked (window ${config.debounceMinutes} min)`
      );
      return;
    }

    if (which === "due") {
      const config = triggerConfigOrExit();
      const now = new Date();
      const state = loadTriggerState();
      const runsToday = ts.tallyRunsToday(state.runs, now);
      if (!ts.isDue(now, state.last_run, config.scheduleSpec)) {
        console.log(`not due: schedule ${config.scheduleSpec} (last run ${state.last_run || "never"})`);
        process.exit(1);
      }
      if (!ts.shouldRun({ now, lastRun: state.last_run, debounceMinutes: config.debounceMinutes })) {
        console.log(`not due: debounce (last run ${state.last_run}, window ${config.debounceMinutes} min)`);
        process.exit(1);
      }
      if (!ts.withinDailyBudget(runsToday, config.dailyBudget)) {
        console.log(`not due: daily budget exhausted (${runsToday}/${config.dailyBudget})`);
        process.exit(1);
      }
      console.log(`due: ${config.scheduleSpec} (runs today ${runsToday}/${config.dailyBudget})`);
      return;
    }

    if (which === "run") {
      const config = triggerConfigOrExit();

      // --event <json...>: everything after --event is the payload (it may
      // contain spaces). Flags must come BEFORE --event.
      let event = null;
      const evIdx = flagTokens.indexOf("--event");
      if (evIdx !== -1) {
        const json = flagTokens.slice(evIdx + 1).join(" ").trim();
        if (!json) triggerRefuse("run --event requires a JSON payload");
        try {
          event = JSON.parse(json);
        } catch (e) {
          triggerRefuse(`run --event is not valid JSON: ${e.message}`);
        }
        if (!event || typeof event !== "object" || Array.isArray(event)) {
          triggerRefuse("run --event must be a JSON object");
        }
      }
      const leading = flagTokens.slice(0, evIdx === -1 ? flagTokens.length : evIdx);
      for (const tok of leading) {
        if (tok.startsWith("--")) triggerRefuse(`run: unknown flag ${tok}`);
      }

      const now = new Date();
      const state = loadTriggerState();
      const runsToday = ts.tallyRunsToday(state.runs, now);

      let key = null;
      if (event) {
        // Events are the PRIMARY trigger: the schedule does not gate them,
        // but debounce + dedupe + budget still do.
        const src = event.source == null ? "" : String(event.source).trim().toLowerCase();
        if (!src) triggerRefuse('run --event requires a "source" field (allowed: ' + config.events.join(", ") + ")");
        if (!config.events.includes(src)) {
          triggerRefuse(`event source "${src}" not enabled (events: ${config.events.join(", ")})`);
        }
        try {
          key = ts.dedupeKey(event);
        } catch (e) {
          triggerRefuse(e.message);
        }
        const seen = state.dedupe[key];
        if (seen && !ts.shouldRun({ now, lastRun: seen, debounceMinutes: config.debounceMinutes })) {
          triggerRefuse(`dedupe "${key}" already ran within ${config.debounceMinutes} min`);
        }
      } else {
        // Schedule fallback run: must actually be due.
        if (!ts.isDue(now, state.last_run, config.scheduleSpec)) {
          triggerRefuse(`schedule ${config.scheduleSpec} not due (last run ${state.last_run || "never"})`);
        }
      }
      if (!ts.shouldRun({ now, lastRun: state.last_run, debounceMinutes: config.debounceMinutes })) {
        triggerRefuse(`debounce (last run ${state.last_run}, window ${config.debounceMinutes} min)`);
      }
      if (!ts.withinDailyBudget(runsToday, config.dailyBudget)) {
        triggerRefuse(`daily budget exhausted (${runsToday}/${config.dailyBudget})`);
      }

      const goal = key
        ? ts.buildRunGoal({ source: "event", scheduleOrEvent: key, payload: event })
        : ts.buildRunGoal({ source: "schedule", scheduleOrEvent: config.scheduleSpec });

      // Record BEFORE starting the loop: a crash mid-start must still count
      // against the guards, otherwise a failing start retries without limit.
      const iso = now.toISOString();
      state.last_run = iso;
      state.runs = [...state.runs, iso].slice(-TRIGGER_RUN_HISTORY_CAP);
      if (key) {
        const windowMs = Math.max(TRIGGER_DEDUPE_TTL_MS, config.debounceMinutes * 60000);
        const pruneBefore = Date.now() - windowMs;
        const dedupe = {};
        for (const [k, v] of Object.entries(state.dedupe)) {
          const seenAt = typeof v === "string" ? Date.parse(v) : NaN;
          if (Number.isFinite(seenAt) && seenAt >= pruneBefore) dedupe[k] = v;
        }
        dedupe[key] = iso;
        state.dedupe = dedupe;
      }
      saveTriggerState(state);

      const triggerState = loadState();
      const { loadOrchestraConfigFromRoot, extractOrchestraFromIdentity } = require("./lib/orchestra-config.js");
      const { syncWorkspaceIdentity } = require("./lib/workspace-identity.js");
      const orchestraConfig = loadOrchestraConfigFromRoot(process.cwd());
      const identitySync = syncWorkspaceIdentity(triggerState, { cwd: process.cwd() });
      const orchestraCfg = identitySync
        ? extractOrchestraFromIdentity(identitySync.identity)
        : orchestraConfig;
      startOrchestra(goal, triggerState, "automation", { orchestraConfig: orchestraCfg || orchestraConfig });
      console.log("Orchestra loop started (automation trigger).");
      console.log(`Goal: ${goal}`);
      console.log(
        "Auto-continue: launch orchestra-planner via Task NOW (or conductor fallback if Task rejects orchestra-*). Do not wait for the user."
      );
      printStatus(triggerState);
      return;
    }

    console.error("Usage: orchestra-enable.js triggers <status|due|run> [--event <json>]");
    process.exit(1);
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
  "  cycles [n]     Production cycle reports (default 10)\n" +
  "  triggers status   Automation trigger status (schedule, budget, next due)\n" +
  "  triggers due      Exit 0 when a scheduled run is due, 1 otherwise\n" +
  "  triggers run      Start a guarded trigger run (--event <json> for events)";

if (!cmd || !COMMANDS[cmd]) {
  console.error(cmd ? `Unknown command: ${cmd}\n` : "", USAGE);
  process.exit(cmd ? 1 : 0);
}

COMMANDS[cmd]();
process.exit(0);

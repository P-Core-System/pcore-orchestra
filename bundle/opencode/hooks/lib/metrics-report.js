"use strict";

const { loadState } = require("./state-manager.js");
const { loadOrchestrationHistory, HISTORY_PATH } = require("./history-recorder.js");
const { loadTokenState, TOKENS_PATH, CYCLE_BUDGET } = require("./token-tracker.js");
const { loadLongTermMemory, MEMORY_PATH } = require("./memory-manager.js");
const { loadMetricsState, METRICS_PATH, generateHealthReport } = require("./observability.js");
const fs = require("node:fs");

function printOrchestraMetrics() {
  const state = loadState();
  const history = loadOrchestrationHistory();
  const tokens = loadTokenState();
  const memory = loadLongTermMemory();
  const metrics = loadMetricsState();

  console.log("=== Orchestra Metrics ===\n");

  console.log("--- Runtime ---");
  console.log(`  Active: ${state.active}`);
  console.log(`  Phase: ${state.currentPhase} | Mode: ${state.loopMode || "core"}`);
  console.log(`  Ambient: ${state.ambient !== false}`);
  console.log(`  Iteration: ${state.iteration || 0} / ${state.max_iterations || 8}`);
  if (state.goal) console.log(`  Goal: ${state.goal.slice(0, 80)}${state.goal.length > 80 ? "…" : ""}`);

  console.log("\n--- History ---");
  if (history.length === 0) {
    console.log("  No completed runs yet.");
  } else {
    const completed = history.filter((r) => r.outcome === "completed").length;
    const maxIter = history.filter((r) => r.outcome === "max_iterations").length;
    const rate = ((completed / history.length) * 100).toFixed(1);
    const avgDur =
      history.reduce((s, r) => s + (r.duration_ms || 0), 0) / history.length / 1000;
    const withTok = history.filter((r) => r.tokens_estimated != null);
    const avgTok =
      withTok.length > 0
        ? withTok.reduce((s, r) => s + r.tokens_estimated, 0) / withTok.length
        : null;
    console.log(`  Runs: ${history.length} | Completed: ${completed} (${rate}%) | Max iter: ${maxIter}`);
    console.log(`  Avg duration: ${avgDur.toFixed(0)}s`);
    if (avgTok != null) {
      console.log(`  Avg tokens/run: ~${Math.round(avgTok).toLocaleString()} (budget ${CYCLE_BUDGET.toLocaleString()})`);
    }
  }

  console.log("\n--- Tokens ---");
  if (tokens.runs.length === 0) {
    console.log("  No token data — complete an orchestra cycle first.");
  } else {
    console.log(`  Runs tracked: ${tokens.aggregates.total_runs}`);
    console.log(`  All-time est.: ~${tokens.aggregates.total_tokens_estimated.toLocaleString()}`);
    const agents = Object.entries(tokens.aggregates.by_agent || {}).sort(
      (a, b) => b[1].avg_tokens - a[1].avg_tokens
    );
    if (agents.length > 0) {
      console.log("  Top agent avg:");
      for (const [name, row] of agents.slice(0, 3)) {
        console.log(`    ${name}: ~${row.avg_tokens.toLocaleString()} (${row.count} phases)`);
      }
    }
    const tips = (tokens.tips || []).slice(-3);
    if (tips.length > 0) {
      console.log("  Recent tips:");
      for (const t of tips) {
        console.log(`    [${t.priority}] ${t.action || t.message}`);
      }
    }
  }

  console.log("\n--- Memory ---");
  console.log(`  Completed goals: ${memory.completed_goals.length}`);
  console.log(`  Tracked files: ${memory.recent_files.length}`);
  console.log(`  Error patterns: ${memory.error_patterns.length}`);

  if (metrics.metrics.length > 0 || metrics.slos.length > 0) {
    console.log("\n--- Observability ---");
    console.log(generateHealthReport(metrics).replace(/^## Health Report\n\n/, ""));
  }

  console.log("\n--- State files ---");
  for (const p of [HISTORY_PATH, TOKENS_PATH, MEMORY_PATH, METRICS_PATH]) {
    const exists = fs.existsSync(p);
    console.log(`  ${exists ? "✓" : "○"} ${p}`);
  }

  console.log("\nCLI: tokens | history | status | orchestra-health.js");
}

module.exports = { printOrchestraMetrics };

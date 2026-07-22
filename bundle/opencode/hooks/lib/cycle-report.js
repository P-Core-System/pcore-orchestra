"use strict";

const fs = require("node:fs");
const path = require("node:path");

const CYCLES_DIR = path.join(__dirname, "..", "state", "cycles");
const CYCLES_INDEX_PATH = path.join(CYCLES_DIR, "index.json");
const CYCLES_INDEX_MAX = 100;

function loadCyclesIndex() {
  try {
    if (!fs.existsSync(CYCLES_INDEX_PATH)) return { version: 1, cycles: [] };
    return JSON.parse(fs.readFileSync(CYCLES_INDEX_PATH, "utf8"));
  } catch {
    return { version: 1, cycles: [] };
  }
}

function saveCyclesIndex(index) {
  fs.mkdirSync(CYCLES_DIR, { recursive: true });
  if (index.cycles.length > CYCLES_INDEX_MAX) {
    index.cycles = index.cycles.slice(-CYCLES_INDEX_MAX);
  }
  fs.writeFileSync(CYCLES_INDEX_PATH, JSON.stringify(index, null, 2));
}

/**
 * Write production cycle report when a run completes or max-iterations.
 * @returns {object} cycle report
 */
function writeCycleReport(state, outcome) {
  const runId = state.tokens?.run_id || `run-${Date.now().toString(36)}`;
  const completedAt = new Date().toISOString();
  const startedAt = state.started_at || state.tokens?.started_at || completedAt;
  const durationMs = startedAt ? Date.now() - new Date(startedAt).getTime() : 0;

  const report = {
    version: 1,
    run_id: runId,
    goal: state.goal || "",
    outcome: outcome || "completed",
    loop_mode: state.loopMode || "core",
    project_slug: state.project?.slug || "",
    started_at: startedAt,
    completed_at: completedAt,
    duration_ms: durationMs,
    iterations: state.iteration || 0,
    max_iterations: state.max_iterations || 8,
    phases: state.memory?.phases_completed || [],
    plan_artifact: state.planArtifact || null,
    tokens: {
      total_estimated: state.tokens?.total_estimated ?? state.tokens?.last_finalized?.total_estimated ?? null,
      phases: state.tokens?.phases?.length ?? 0,
      tips_count: state.tokens?.last_finalized?.tips_count ?? null,
    },
    quality_gates: {
      passed: (state.qualityGates?.passed || []).length,
      failed: (state.qualityGates?.failed || []).length,
      skipped: (state.qualityGates?.skipped || []).length,
      all_required_passed: state.qualityGates?.allRequiredPassed ?? false,
    },
    evidence: state.memory?.evidence_gates ? "recorded" : null,
  };

  fs.mkdirSync(CYCLES_DIR, { recursive: true });
  const reportPath = path.join(CYCLES_DIR, `${runId}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  const index = loadCyclesIndex();
  index.cycles.push({
    run_id: runId,
    goal: (report.goal || "").slice(0, 120),
    outcome: report.outcome,
    completed_at: completedAt,
    duration_ms: durationMs,
    tokens_estimated: report.tokens.total_estimated,
    path: reportPath,
  });
  saveCyclesIndex(index);

  state.lastCycleReport = { run_id: runId, path: reportPath, outcome: report.outcome };
  return report;
}

function listCycleReports(limit = 10) {
  const index = loadCyclesIndex();
  return index.cycles.slice(-limit).reverse();
}

function formatCycleSummary(report) {
  if (!report) return "";
  const dur = Math.round((report.duration_ms || 0) / 1000);
  const tok = report.tokens?.total_estimated;
  const tokStr = tok != null ? ` | ~${tok.toLocaleString()} tok` : "";
  const gates = report.quality_gates;
  return [
    `Cycle ${report.run_id}: ${report.outcome} (${dur}s, ${report.iterations} iters${tokStr})`,
    `Goal: ${report.goal}`,
    `Gates: ${gates.passed} pass / ${gates.failed} fail / ${gates.skipped} skip`,
    report.plan_artifact?.path ? `Plan: ${report.plan_artifact.path}` : null,
  ].filter(Boolean).join("\n");
}

function printCyclesReport(limit = 10) {
  const rows = listCycleReports(limit);
  console.log(`=== Orchestra Cycle Reports (${rows.length} recent) ===\n`);
  if (rows.length === 0) {
    console.log("No cycle reports yet — complete an orchestra run first.");
    return;
  }
  for (const row of rows) {
    try {
      const full = JSON.parse(fs.readFileSync(row.path, "utf8"));
      console.log(formatCycleSummary(full));
      console.log("");
    } catch {
      console.log(`  ${row.completed_at} | ${row.outcome} | "${row.goal}"`);
    }
  }
  console.log(`Index: ${CYCLES_INDEX_PATH}`);
}

module.exports = {
  CYCLES_DIR,
  CYCLES_INDEX_PATH,
  writeCycleReport,
  listCycleReports,
  formatCycleSummary,
  printCyclesReport,
  loadCyclesIndex,
};

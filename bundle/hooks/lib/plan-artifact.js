"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { saveState } = require("./state-manager.js");
const { atomicWrite, resolveStateDir } = require("./safe-write.js");

const PLAN_DIR = ".cursor";
const PLAN_FILENAME = "orchestra-plan.md";
const PLANS_STATE_DIR = path.join(__dirname, "..", "state", "plans");

function detectWorkspaceRoot(state) {
  if (state?.project?.identityFile) {
    return path.dirname(state.project.identityFile);
  }
  return process.cwd();
}

function workspacePlanPath(root) {
  return path.join(root, PLAN_DIR, PLAN_FILENAME);
}

function globalPlanPath(runId) {
  return path.join(resolveStateDir(PLANS_STATE_DIR), `${runId}.md`);
}

function extractSubagentOutput(input) {
  if (!input || typeof input !== "object") return "";
  return (
    input.summary ||
    input.result ||
    input.output ||
    input.final_text ||
    input.text ||
    ""
  ).toString();
}

function hasPlanReady(text) {
  return /\bPLAN_READY\b/i.test(text || "");
}

/**
 * Persist planner output to workspace + global state backup.
 * @returns {{ path: string, globalPath: string, run_id: string, saved_at: string } | null}
 */
function savePlanArtifact(state, input) {
  const text = extractSubagentOutput(input);
  if (!text.trim()) return null;

  const root = detectWorkspaceRoot(state);
  const runId = state.tokens?.run_id || `run-${Date.now().toString(36)}`;
  const savedAt = new Date().toISOString();
  const header = [
    "# Orchestra Plan",
    "",
    `Goal: ${state.goal || "(none)"}`,
    `Run: ${runId}`,
    `Loop: ${state.loopMode || "core"}`,
    `Saved: ${savedAt}`,
    "",
    "---",
    "",
  ].join("\n");

  const content = header + text.trim() + "\n";

  const wsPath = workspacePlanPath(root);
  atomicWrite(wsPath, content);

  const gPath = globalPlanPath(runId);
  atomicWrite(gPath, content);

  state.planArtifact = {
    path: wsPath,
    globalPath: gPath,
    run_id: runId,
    saved_at: savedAt,
    plan_ready: hasPlanReady(text),
  };
  saveState(state);
  return state.planArtifact;
}

function loadPlanArtifact(state) {
  const p = state?.planArtifact?.path || state?.planArtifact?.globalPath;
  if (!p || !fs.existsSync(p)) return null;
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function buildPlanHandoffLine(state, nextAgentId) {
  const artifact = state?.planArtifact;
  if (!artifact?.path) {
    if (nextAgentId === "orchestra-implementer") {
      return "Plan file missing — read planner phase summary in Prior phases; do not re-plan without user ask.";
    }
    return "";
  }
  const rel = path.relative(detectWorkspaceRoot(state), artifact.path).replace(/\\/g, "/");
  const planPath = rel && !rel.startsWith("..") ? rel : `${PLAN_DIR}/${PLAN_FILENAME}`;
  if (nextAgentId === "orchestra-implementer") {
    return `Read approved plan: \`${planPath}\` — implement ONLY what it specifies.`;
  }
  if (nextAgentId === "orchestra-verifier" || nextAgentId === "orchestra-reviewer") {
    return `Verify/review against plan: \`${planPath}\` and git diff.`;
  }
  return `Plan artifact: \`${planPath}\``;
}

module.exports = {
  PLAN_DIR,
  PLAN_FILENAME,
  detectWorkspaceRoot,
  workspacePlanPath,
  extractSubagentOutput,
  hasPlanReady,
  savePlanArtifact,
  loadPlanArtifact,
  buildPlanHandoffLine,
};

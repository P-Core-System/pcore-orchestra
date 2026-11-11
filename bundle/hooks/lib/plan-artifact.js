"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { saveState } = require("./state-manager.js");
const { atomicWrite, resolveStateDir } = require("./safe-write.js");

const PLAN_DIR = ".cursor";
const PLAN_FILENAME = "orchestra-plan.md";
const PLANS_STATE_DIR = path.join(__dirname, "..", "state", "plans");

/** Durable in-workspace artifact subdir (first choice, never /tmp). */
const ARTIFACT_SUBDIR = path.join("data", "conductor");

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

/**
 * True when `p` resolves inside the OS temp dir — artifact candidates there
 * are rejected (a /tmp wipe must never take conductor artifacts with it).
 */
function isTmpPath(p) {
  try {
    const tmp = path.resolve(os.tmpdir());
    const cand = path.resolve(String(p));
    return cand === tmp || cand.startsWith(tmp + path.sep);
  } catch {
    return false;
  }
}

/**
 * Resolve the durable directory for conductor artifacts (plans, baselines,
 * live-proof records). Precedence: `<workspace>/data/conductor` (durable,
 * survives /tmp wipes) > `PCORE_ARTIFACT_DIR` > the global state plans dir.
 * A candidate under the OS temp dir is never returned. The winning dir is
 * created (mkdir -p); an unwritable candidate falls through to the next.
 * @returns {{dir:string, via:"workspace-data"|"env"|"global-state"}}
 */
function resolveArtifactDir(opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const candidates = [];
  try {
    const root = o.workspaceRoot || detectWorkspaceRoot(o.state);
    if (root) candidates.push({ dir: path.join(String(root), ARTIFACT_SUBDIR), via: "workspace-data" });
  } catch {
    /* fall through to env/global */
  }
  if (process.env.PCORE_ARTIFACT_DIR) {
    candidates.push({ dir: process.env.PCORE_ARTIFACT_DIR, via: "env" });
  }
  for (const c of candidates) {
    try {
      if (!c.dir || isTmpPath(c.dir)) continue;
      fs.mkdirSync(c.dir, { recursive: true });
      return c;
    } catch {
      /* unwritable — try the next candidate */
    }
  }
  const fallback = resolveStateDir(PLANS_STATE_DIR);
  try {
    fs.mkdirSync(fallback, { recursive: true });
  } catch {
    /* fail-open: caller handles an unwritable dir */
  }
  return { dir: fallback, via: "global-state" };
}

/**
 * Safe-write an artifact (`atomicWrite`, invariant 15). `name` is confined
 * to `dir` (basename + character whitelist, no traversal).
 * @returns {string} absolute path of the written artifact
 */
function writeArtifact(dir, name, content) {
  const safe = String(name || "artifact.md")
    .split(/[\\/]/)
    .pop()
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/^-+|-+$/g, "") || "artifact.md";
  const target = path.join(path.resolve(String(dir)), safe);
  atomicWrite(target, String(content === undefined || content === null ? "" : content));
  return target;
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
 * Count acceptance-criteria bullets under the planner's `## Done when`
 * section. Bullets are `-`/`*`/`1.`-style lines until the next `##` heading.
 * @returns {number} 0 when the section is absent
 */
function countAcceptanceCriteria(text) {
  const lines = String(text || "").split(/\r?\n/);
  let inSection = false;
  let count = 0;
  for (const line of lines) {
    if (/^##\s/.test(line)) {
      if (inSection) break;
      inSection = /^##\s+done when\b/i.test(line);
      continue;
    }
    if (inSection && /^\s*(?:[-*]|\d+[.)])\s+\S/.test(line)) count++;
  }
  return count;
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
  // Feed the work-item AC count into memory so the handoff/verifier can
  // check "AC: n"; an absent "## Done when" section never clobbers it.
  const acCount = countAcceptanceCriteria(text);
  if (acCount > 0 && state.memory) state.memory.acCount = acCount;
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
  ARTIFACT_SUBDIR,
  detectWorkspaceRoot,
  workspacePlanPath,
  extractSubagentOutput,
  hasPlanReady,
  countAcceptanceCriteria,
  savePlanArtifact,
  loadPlanArtifact,
  buildPlanHandoffLine,
  isTmpPath,
  resolveArtifactDir,
  writeArtifact,
};

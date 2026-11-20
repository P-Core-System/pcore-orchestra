#!/usr/bin/env node
"use strict";

/**
 * Agent mirror parity: Cursor sources → OpenCode and Qoder copies.
 *
 * Asserts that both sync scripts are drift-free, that core agent bodies are
 * identical across the three vaults (so --force-core is lossless), that the
 * OpenCode step budget survives regeneration, and that the verdict-discipline
 * and step-budget sections ship on every host.
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const CORE = ["orchestra-planner", "orchestra-implementer", "orchestra-verifier", "orchestra-reviewer"];
const VERDICT_TOKENS = {
  "orchestra-verifier": ["VERIFY_PASS", "VERIFY_FAIL"],
  "orchestra-reviewer": ["ORCHESTRA_COMPLETE", "FIX_REQUIRED"],
};

let failed = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS  ${name}`);
  else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function run(script, args) {
  return spawnSync(process.execPath, [path.join(ROOT, "scripts", script), ...(args || [])], {
    cwd: ROOT,
    encoding: "utf8",
  });
}

function bodyOf(file) {
  const raw = fs.readFileSync(file, "utf8");
  if (!raw.startsWith("---")) return raw;
  const end = raw.indexOf("\n---", 3);
  return end === -1 ? raw : raw.slice(raw.indexOf("\n", end + 4) + 1);
}

function stepsOf(file) {
  const raw = fs.readFileSync(file, "utf8");
  const m = raw.match(/^steps:\s*(\d+)$/m);
  return m ? parseInt(m[1], 10) : null;
}

for (const [script, label] of [
  ["sync-opencode-agents.js", "OpenCode"],
  ["sync-qoder-agents.js", "Qoder"],
]) {
  const out = run(script, ["--check"]);
  check(`${label} mirror is drift-free`, out.status === 0, out.stderr || out.stdout);
}

for (const name of CORE) {
  const cursor = bodyOf(path.join(ROOT, "bundle", "agents", `${name}.md`));
  const opencode = bodyOf(path.join(ROOT, "bundle", "opencode", "agents", `${name}.md`));
  const qoder = bodyOf(path.join(ROOT, "bundle", "qoder", "agents", `${name}.md`));
  check(`${name}: OpenCode body matches Cursor`, cursor === opencode);
  check(`${name}: Qoder body matches Cursor`, cursor === qoder);
  for (const vault of ["agents", "opencode/agents", "qoder/agents"]) {
    const text = fs.readFileSync(path.join(ROOT, "bundle", vault, `${name}.md`), "utf8");
    check(`${name}: step-budget section in ${vault}`, text.includes("## Step budget awareness"));
  }
}

// The ordered engineering algorithm belongs in the actual phase prompts.
const planner = bodyOf(path.join(ROOT, "bundle", "agents", "orchestra-planner.md"));
const algorithm = [
  "1. Question requirements",
  "2. Delete unnecessary parts or processes",
  "3. Simplify and optimize",
  "4. Accelerate cycle time",
  "5. Automate last",
];
let previous = -1;
for (const step of algorithm) {
  const index = planner.indexOf(step);
  check(`planner: ordered algorithm ${step}`, index > previous && index !== -1);
  previous = index;
}
check("planner: deletion is not a quota", planner.includes("not a deletion quota"));
check("planner: unknown requirement owners remain unknown", planner.includes("owner unknown"));
const reviewer = bodyOf(path.join(ROOT, "bundle", "agents", "orchestra-reviewer.md"));
check("reviewer: checks ordered algorithm", reviewer.includes("five-step algorithm"));
check("reviewer: protects safety and quality gates", reviewer.includes("safety and quality gates"));

// Every route and phase must carry the ordered practice, not only the core planner.
const conductorCursor = fs.readFileSync(path.join(ROOT, "bundle", "agents", "orchestra.md"), "utf8");
const conductorOpencode = fs.readFileSync(path.join(ROOT, "bundle", "opencode", "agents", "orchestra.md"), "utf8");
for (const [label, text] of [
  ["conductor (Cursor)", conductorCursor],
  ["conductor (OpenCode)", conductorOpencode],
]) {
  check(`${label}: ordered algorithm on all routes`, text.includes("## Ordered improvement algorithm (all routes)"));
  check(`${label}: deletion is not a quota`, text.includes("not a deletion quota"));
  check(`${label}: review checks actual execution`, text.includes("checks actual execution, not just the stated plan"));
}
for (const [name, marker] of [
  ["ai-trigger", "unknown owner becomes a clarification item"],
  ["review-agent", "ordered five-step evidence against the actual diff"],
  ["orchestra-implementer", "## Ordered-step evidence"],
  ["orchestra-verifier", "steps 1–3 must be supported before step 4 speedups or step 5 automation"],
]) {
  const text = bodyOf(path.join(ROOT, "bundle", "agents", `${name}.md`));
  check(`${name}: carries ordered-step execution evidence`, text.includes(marker));
}

for (const [name, tokens] of Object.entries(VERDICT_TOKENS)) {
  for (const vault of ["agents", "opencode/agents", "qoder/agents"]) {
    const text = fs.readFileSync(path.join(ROOT, "bundle", vault, `${name}.md`), "utf8");
    check(`${name}: verdict discipline in ${vault}`, text.includes("## Verdict discipline"));
    check(`${name}: tokens named in ${vault}`, tokens.every((t) => text.includes(`\`${t}\``)));
  }
}

for (const name of CORE) {
  const steps = stepsOf(path.join(ROOT, "bundle", "opencode", "agents", `${name}.md`));
  // Free model pools are limited by REQUESTS PER DAY, so step ceilings are the
  // quota dial. The old pin (>= 200) defended a value that could burn a whole
  // day's allowance in one runaway phase agent.
  const cap = require("./lib/context-budget.js").maxStepsFor(name);
  check(`${name}: OpenCode step budget at role cap (${steps})`, Number.isFinite(steps) && steps === cap, String(steps));
}

// Drift detection: a manual edit to a generated core agent must fail --check.
const target = path.join(ROOT, "bundle", "opencode", "agents", "orchestra-verifier.md");
const original = fs.readFileSync(target, "utf8");
try {
  fs.writeFileSync(target, `${original}\n<!-- manual drift -->\n`);
  const drift = run("sync-opencode-agents.js", ["--check"]);
  check("OpenCode --check exits 1 on drift", drift.status === 1, String(drift.status));
} finally {
  fs.writeFileSync(target, original);
}

const restored = run("sync-opencode-agents.js", ["--check"]);
check("OpenCode --check passes after restore", restored.status === 0, restored.stderr || restored.stdout);

console.log(failed === 0 ? "\nAll agent sync tests passed." : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

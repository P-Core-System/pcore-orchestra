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

for (const [name, tokens] of Object.entries(VERDICT_TOKENS)) {
  for (const vault of ["agents", "opencode/agents", "qoder/agents"]) {
    const text = fs.readFileSync(path.join(ROOT, "bundle", vault, `${name}.md`), "utf8");
    check(`${name}: verdict discipline in ${vault}`, text.includes("## Verdict discipline"));
    check(`${name}: tokens named in ${vault}`, tokens.every((t) => text.includes(`\`${t}\``)));
  }
}

for (const name of CORE) {
  const steps = stepsOf(path.join(ROOT, "bundle", "opencode", "agents", `${name}.md`));
  check(`${name}: OpenCode step budget preserved (${steps})`, Number.isFinite(steps) && steps >= 200, String(steps));
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

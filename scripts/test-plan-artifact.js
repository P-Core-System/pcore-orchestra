#!/usr/bin/env node
"use strict";

/**
 * Self-check for the durable artifact dir:
 *  1. workspace first: <workspaceRoot>/data/conductor is created + via=workspace-data
 *  2. unwritable workspace falls through to PCORE_ARTIFACT_DIR (via=env)
 *  3. PCORE_ARTIFACT_DIR under os.tmpdir() is rejected (never /tmp)
 *  4. with no candidates, falls back to the global state plans dir
 *  5. writeArtifact round-trips content via safe-write
 *  6. writeArtifact confines traversal names inside dir
 *  7. no .tmp.* residue after ops
 *
 * Temp dirs only; the real home config is never touched.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const base = path.join(__dirname, "..", ".tmp-test-plan-artifact");
fs.rmSync(base, { recursive: true, force: true });
fs.mkdirSync(base, { recursive: true });
process.env.PCORE_STATE_DIR = path.join(base, "state");

const p = require("../bundle/hooks/lib/plan-artifact.js");

let failed = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function walk(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const f = path.join(dir, name);
    if (fs.lstatSync(f).isDirectory()) out.push(...walk(f));
    else out.push(f);
  }
  return out;
}

const savedEnv = process.env.PCORE_ARTIFACT_DIR;
delete process.env.PCORE_ARTIFACT_DIR;

try {
  check("ARTIFACT_SUBDIR exported", p.ARTIFACT_SUBDIR === path.join("data", "conductor"));

  // ---- 1. workspace first ----
  const ws = path.join(base, "ws");
  fs.mkdirSync(ws, { recursive: true });
  const r1 = p.resolveArtifactDir({ workspaceRoot: ws });
  check("workspace wins", r1.via === "workspace-data", r1.via);
  check("workspace dir created", fs.existsSync(r1.dir) && fs.statSync(r1.dir).isDirectory());
  check(
    "workspace dir is <root>/data/conductor",
    r1.dir === path.join(ws, "data", "conductor"),
    r1.dir
  );

  // ---- 2. unwritable workspace -> env ----
  const fileAsRoot = path.join(base, "not-a-dir");
  fs.writeFileSync(fileAsRoot, "x");
  const envDir = path.join(base, "env-artifacts");
  process.env.PCORE_ARTIFACT_DIR = envDir;
  const r2 = p.resolveArtifactDir({ workspaceRoot: fileAsRoot });
  check("env fallback on unwritable workspace", r2.via === "env", r2.via);
  check("env dir created", fs.existsSync(envDir));

  // ---- 3. /tmp env rejected ----
  const tmpTrap = path.join(os.tmpdir(), "plan-artifact-trap");
  process.env.PCORE_ARTIFACT_DIR = tmpTrap;
  check("isTmpPath true inside os.tmpdir()", p.isTmpPath(tmpTrap) === true);
  check("isTmpPath false for durable dir", p.isTmpPath(envDir) === false);
  const r3 = p.resolveArtifactDir({ workspaceRoot: fileAsRoot });
  check("tmp env never returned", r3.dir !== tmpTrap && !p.isTmpPath(r3.dir), `${r3.via} ${r3.dir}`);
  check("tmp trap not created", !fs.existsSync(tmpTrap));
  delete process.env.PCORE_ARTIFACT_DIR;

  // ---- 4. global-state fallback ----
  const r4 = p.resolveArtifactDir({ workspaceRoot: fileAsRoot });
  check("global-state fallback", r4.via === "global-state", r4.via);

  // ---- 5. writeArtifact round-trip ----
  const target = p.writeArtifact(r1.dir, "plan.md", "# Plan\nbody\n");
  check("writeArtifact returns inside dir", target === path.join(r1.dir, "plan.md"), target);
  check("writeArtifact content round-trips", fs.readFileSync(target, "utf8") === "# Plan\nbody\n");

  // ---- 6. traversal confined ----
  const evil = p.writeArtifact(r1.dir, "../../evil.md", "x");
  check(
    "traversal stays inside dir",
    path.resolve(evil).startsWith(path.resolve(r1.dir) + path.sep),
    evil
  );
  check("traversal sanitized to basename", path.basename(evil) === "evil.md", evil);

  // ---- 7. no .tmp.* residue ----
  const residue = walk(base).filter((f) => path.basename(f).indexOf(".tmp.") !== -1);
  check("no .tmp.* residue", residue.length === 0, JSON.stringify(residue));
} finally {
  if (savedEnv === undefined) delete process.env.PCORE_ARTIFACT_DIR;
  else process.env.PCORE_ARTIFACT_DIR = savedEnv;
  delete process.env.PCORE_STATE_DIR;
  try {
    fs.rmSync(base, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

if (failed) {
  console.log(`\nFAIL (${failed} checks)`);
  process.exit(1);
}
console.log("\nPASS (all checks)");

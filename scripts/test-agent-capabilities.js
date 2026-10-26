#!/usr/bin/env node
"use strict";

/**
 * Capability & metadata invariants — the dynamic-capability contract:
 *
 *  1. generator checks pass (capabilities, qoder tree, registry)
 *  2. every non-conductor agent declares an explicit `tools:` allowlist
 *     consistent with its `readonly` flag
 *  3. conductors (orchestra, workflow-orchestrator) declare NO tools key —
 *     they must inherit full access, including agent spawning
 *  4. bundle/agent-registry.json agentDetails.capabilities.tools matches the
 *     agent files
 *  5. every bundle skill SKILL.md carries name + description frontmatter
 *  6. installed ~/.qoder agents + skills match the bundle (skipped when the
 *     bundle was never installed here)
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const AGENTS = path.join(ROOT, "bundle", "agents");
const SKILLS = path.join(ROOT, "bundle", "skills");
const REGISTRY = path.join(ROOT, "bundle", "agent-registry.json");
const QODER = path.join(process.env.HOME || process.env.USERPROFILE, ".qoder");

const READONLY_TOOLS = "Bash, Read, Grep, Glob, WebFetch, WebSearch";
const WRITABLE_TOOLS = "Bash, Read, Write, Edit, Glob, Grep, WebFetch, WebSearch";
const CONDUCTORS = new Set(["orchestra", "workflow-orchestrator"]);

let pass = 0, fail = 0;
function check(name, ok, extra = "") {
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${extra ? " — " + extra : ""}`); }
}

function fmBlock(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : null;
}
function field(fm, key) {
  const m = fm.match(new RegExp(`^${key}:[ \\t]*(.*)$`, "m"));
  return m ? m[1].trim() : null;
}
function agentFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== "references") walk(p); }
      else if (e.name.endsWith(".md")) out.push(p);
    }
  };
  walk(dir);
  return out;
}

// 1 — generator --check gates
for (const s of ["scripts/enrich-agent-capabilities.js", "scripts/sync-qoder-agents.js", "scripts/gen-agent-registry.js"]) {
  const r = spawnSync(process.execPath, [path.join(ROOT, s), "--check"], { encoding: "utf8", timeout: 60000 });
  check(`${s} --check`, r.status === 0, (r.stderr || r.stdout || "").split("\n").slice(0, 3).join(" / "));
}

// 2+3 — per-agent tools policy
const badTools = [], badConductors = [];
for (const f of agentFiles(AGENTS)) {
  const fm = fmBlock(fs.readFileSync(f, "utf8"));
  if (!fm) continue;
  const name = field(fm, "name");
  if (!name) continue;
  const tools = field(fm, "tools");
  const want = field(fm, "readonly") === "true" ? READONLY_TOOLS : WRITABLE_TOOLS;
  if (CONDUCTORS.has(name)) { if (tools !== null) badConductors.push(name); continue; }
  if (tools !== want) badTools.push(`${name}: ${tools || "missing"} (want ${want})`);
}
check("all non-conductor agents declare tools matching readonly policy", badTools.length === 0, badTools.slice(0, 5).join("; "));
check("conductors inherit (no tools key)", badConductors.length === 0, badConductors.join(", "));

// 4 — registry capabilities agree with the files
const reg = JSON.parse(fs.readFileSync(REGISTRY, "utf8"));
const byName = {};
for (const f of agentFiles(AGENTS)) {
  const fm = fmBlock(fs.readFileSync(f, "utf8"));
  const name = fm && field(fm, "name");
  if (name) byName[name] = { file: f, fm };
}
const mismatch = [];
for (const d of reg.agentDetails || []) {
  const hit = byName[d.id];
  if (!hit) { mismatch.push(`${d.id}: no file`); continue; }
  const want = CONDUCTORS.has(d.id) ? "inherit" : field(hit.fm, "tools");
  if ((d.capabilities || {}).tools !== want) mismatch.push(`${d.id}: registry ${(d.capabilities || {}).tools} vs file ${want}`);
}
check("registry agentDetails.capabilities.tools matches agent files", mismatch.length === 0, mismatch.slice(0, 5).join("; "));

// 5 — skills metadata
const badSkills = [];
for (const dir of fs.readdirSync(SKILLS)) {
  const p = path.join(SKILLS, dir, "SKILL.md");
  if (!fs.existsSync(p)) { badSkills.push(`${dir}: no SKILL.md`); continue; }
  const fm = fmBlock(fs.readFileSync(p, "utf8"));
  if (!fm || !field(fm, "name") || !field(fm, "description")) badSkills.push(dir);
}
check("every skill has name+description frontmatter", badSkills.length === 0, badSkills.join(", "));

// 6 — installed tree matches bundle (only when installed)
if (fs.existsSync(path.join(QODER, "agents"))) {
  const drift = [];
  const rel = (dir) => {
    const out = [];
    const walk = (p, base) => {
      for (const e of fs.readdirSync(p, { withFileTypes: true })) {
        const q = path.join(p, e.name);
        if (e.isDirectory()) walk(q, base);
        else if (e.name.endsWith(".md")) out.push(path.relative(base, q).split(path.sep).join("/"));
      }
    };
    walk(dir, dir);
    return out.sort();
  };
  const src = path.join(ROOT, "bundle", "qoder", "agents");
  const installed = path.join(QODER, "agents");
  const srcFiles = rel(src), instFiles = rel(installed);
  for (const r of srcFiles) {
    if (!instFiles.includes(r)) { drift.push(`missing: ${r}`); continue; }
    const a = fs.readFileSync(path.join(src, r), "utf8");
    const b = fs.readFileSync(path.join(installed, r), "utf8");
    if (a !== b) drift.push(`differs: ${r}`);
  }
  check("installed ~/.qoder agents match bundle/qoder tree", drift.length === 0, `${drift.length} entries drift (run bash install.sh --qoder)`);
} else {
  console.log("SKIP  installed ~/.qoder agents check (not installed)");
}

console.log(`\n${fail === 0 ? "All capability invariants passed" : `FAILED (${fail} failures)`} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

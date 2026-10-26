#!/usr/bin/env node
"use strict";

/**
 * Codex CLI installation health check.
 * Usage: node scripts/health-codex.js [--home DIR]
 * Env:   CODEX_HOME (default ~/.codex)
 * Exits 1 when a required piece is missing; warnings never fail.
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const CORE_AGENTS = [
  "orchestra.toml",
  "orchestra-planner.toml",
  "orchestra-implementer.toml",
  "orchestra-verifier.toml",
  "orchestra-reviewer.toml",
];

function parseHome(argv) {
  const i = argv.indexOf("--home");
  if (i !== -1) {
    if (!argv[i + 1]) {
      console.error("--home requires a directory");
      process.exit(2);
    }
    return argv[i + 1];
  }
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

const home = parseHome(process.argv.slice(2));
const skillsDir = process.env.AGENTS_SKILLS || path.join(os.homedir(), ".agents", "skills");
let failed = 0;

function pass(label) {
  console.log(`  PASS  ${label}`);
}
function fail(label) {
  console.log(`  FAIL  ${label}`);
  failed++;
}
function info(label) {
  console.log(`  INFO  ${label}`);
}
function check(ok, label) {
  if (ok) pass(label);
  else fail(label);
}

console.log(`Codex CLI health — ${home}`);

check(fs.existsSync(home), "config directory exists");

const agentsDir = path.join(home, "agents");
const agentFiles = fs.existsSync(agentsDir)
  ? fs.readdirSync(agentsDir).filter((f) => f.endsWith(".toml"))
  : [];
for (const agent of CORE_AGENTS) {
  check(agentFiles.includes(agent), `agent ${agent}`);
}
info(`${agentFiles.length} agent file(s) installed`);

let invalid = [];
for (const file of agentFiles) {
  const raw = fs.readFileSync(path.join(agentsDir, file), "utf8");
  if (!/^name\s*=\s*"/m.test(raw) || !/^description\s*=\s*"/m.test(raw) || !/^developer_instructions\s*=\s*/m.test(raw)) {
    invalid.push(file);
  }
}
check(invalid.length === 0, `agent TOML shape valid${invalid.length ? ` (bad: ${invalid.slice(0, 3).join(", ")})` : ""}`);

if (!fs.existsSync(path.join(home, "ORCHESTRA.md"))) {
  info("ORCHESTRA.md missing — optional entry doc");
}
if (!fs.existsSync(path.join(skillsDir, "orchestra-loop", "SKILL.md"))) {
  info(`shared skill missing: ${path.join(skillsDir, "orchestra-loop", "SKILL.md")}`);
}
info("hooks are not wired for Codex (features.hooks is gated); the conductor drives phases with markers");

if (failed > 0) {
  console.log(`\nVERDICT: FAIL (${failed} check(s))`);
  process.exit(1);
}
console.log("\nVERDICT: PASS");

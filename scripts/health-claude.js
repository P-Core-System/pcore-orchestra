#!/usr/bin/env node
"use strict";

/**
 * Claude Code installation health check.
 * Usage: node scripts/health-claude.js [--home DIR]
 * Env:   CLAUDE_CONFIG_DIR (default ~/.claude)
 * Exits 1 when a required piece is missing; warnings never fail.
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const CORE_AGENTS = [
  "orchestra.md",
  "orchestra-planner.md",
  "orchestra-implementer.md",
  "orchestra-verifier.md",
  "orchestra-reviewer.md",
];
const HOOK_FILES = [
  "hooks/orchestra-prompt.js",
  "hooks/orchestra-subagent-stop.js",
  "hooks/orchestra-stop.js",
  "hooks/lib/io.js",
  "hooks/lib/state-manager.js",
];
const HOOK_EVENTS = ["SessionStart", "UserPromptSubmit", "SubagentStop", "Stop"];

function parseHome(argv) {
  const i = argv.indexOf("--home");
  if (i !== -1) {
    if (!argv[i + 1]) {
      console.error("--home requires a directory");
      process.exit(2);
    }
    return argv[i + 1];
  }
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
}

const home = parseHome(process.argv.slice(2));
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

console.log(`Claude Code health — ${home}`);

check(fs.existsSync(home), "config directory exists");

const agentsDir = path.join(home, "agents");
const agentFiles = fs.existsSync(agentsDir)
  ? fs.readdirSync(agentsDir).filter((f) => f.endsWith(".md"))
  : [];
for (const agent of CORE_AGENTS) {
  check(agentFiles.includes(agent), `agent ${agent}`);
}
info(`${agentFiles.length} agent file(s) installed`);

for (const file of HOOK_FILES) {
  check(fs.existsSync(path.join(home, file)), file);
}

const settingsPath = path.join(home, "settings.json");
let hooks = null;
try {
  hooks = JSON.parse(fs.readFileSync(settingsPath, "utf8")).hooks || null;
} catch {
  hooks = null;
}
for (const event of HOOK_EVENTS) {
  check(Array.isArray(hooks?.[event]) && hooks[event].length > 0, `settings.json hooks.${event}`);
}

if (!fs.existsSync(path.join(home, "skills", "orchestra-loop", "SKILL.md"))) {
  info("skills/orchestra-loop/SKILL.md missing — run: bash install.sh --claude");
}
if (!fs.existsSync(path.join(home, "ORCHESTRA.md"))) {
  info("ORCHESTRA.md missing — optional entry doc");
}
info('writable agents use permissionMode: acceptEdits; readonly agents use disallowedTools');

if (failed > 0) {
  console.log(`\nVERDICT: FAIL (${failed} check(s))`);
  process.exit(1);
}
console.log("\nVERDICT: PASS");

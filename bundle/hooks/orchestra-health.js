#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { loadState, classifyPrompt } = require("./orchestra-lib.js");

const HOOKS_DIR = __dirname;
const ROOT = path.join(HOOKS_DIR, "..");

const scripts = [
  "orchestra-lib.js",
  "orchestra-prompt.js",
  "orchestra-session-start.js",
  "orchestra-subagent-stop.js",
  "orchestra-stop.js",
  "orchestra-enable.js",
];

console.log("=== Orchestra health check ===\n");

let ok = true;

for (const s of scripts) {
  const p = path.join(HOOKS_DIR, s);
  const exists = fs.existsSync(p);
  console.log(exists ? "OK " : "MISSING ", s);
  if (!exists) ok = false;
}

const hooksJson = path.join(ROOT, "hooks.json");
if (fs.existsSync(hooksJson)) {
  console.log("OK  hooks.json");
  try {
    const cfg = JSON.parse(fs.readFileSync(hooksJson, "utf8"));
    const events = Object.keys(cfg.hooks || {});
    console.log("    events:", events.join(", "));
  } catch (e) {
    console.log("BAD hooks.json parse:", e.message);
    ok = false;
  }
} else {
  console.log("MISSING hooks.json");
  ok = false;
}

const state = loadState();
console.log("\n=== State ===");
console.log(JSON.stringify(state, null, 2));

console.log("\n=== Classification samples ===");
const samples = [
  ["fix import error", true],
  ["what is asyncio", false],
  ["what is the best way to fix login", true],
  ["explain how hooks work", false],
  ["deploy to VPS", true],
  ["no orchestra just explain", false],
];
for (const [text, expect] of samples) {
  const r = classifyPrompt(text, state);
  const pass = r.activate === expect;
  console.log(pass ? "OK " : "FAIL", JSON.stringify(text), "->", r.activate, `(${r.reason})`);
  if (!pass) ok = false;
}

const agentsDir = path.join(ROOT, "agents");
if (fs.existsSync(agentsDir)) {
  console.log("\n=== Agents ===");
  for (const name of [
    "orchestra-planner.md",
    "orchestra-implementer.md",
    "orchestra-verifier.md",
    "orchestra-reviewer.md",
  ]) {
    console.log(fs.existsSync(path.join(agentsDir, name)) ? "OK " : "MISSING ", name);
  }
}

console.log(ok ? "\nAll checks passed." : "\nSome checks failed — restart Cursor and verify Hooks tab.");
process.exit(ok ? 0 : 1);

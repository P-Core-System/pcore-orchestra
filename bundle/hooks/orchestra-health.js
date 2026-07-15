#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const MEMORY_PATH = path.join(__dirname, "state", "orchestra-memory.json");
const { loadState } = require("./lib/state-manager.js");
const { classifyPrompt } = require("./lib/prompt-classifier.js");

const HOOKS_DIR = __dirname;
const ROOT = path.join(HOOKS_DIR, "..");

const SCRIPTS = [
  "orchestra-lib.js",
  "orchestra-prompt.js",
  "orchestra-session-start.js",
  "orchestra-subagent-stop.js",
  "orchestra-stop.js",
  "orchestra-enable.js",
  "orchestra-heartbeat.js",
  "orchestra-lifecycle.js",
  "orchestra-memory.js",
];

const AGENT_NAMES = [
  "orchestra-planner.md",
  "orchestra-implementer.md",
  "orchestra-verifier.md",
  "orchestra-reviewer.md",
];

const CLASSIFICATION_SAMPLES = [
  ["fix import error", true],
  ["what is asyncio", false],
  ["what is the best way to fix login", true],
  ["explain how hooks work", false],
  ["deploy to VPS", true],
  ["no orchestra just explain", false],
];

let ok = true;

function checkScripts() {
  console.log("=== Orchestra health check ===\n");
  for (const s of SCRIPTS) {
    const p = path.join(HOOKS_DIR, s);
    const exists = fs.existsSync(p);
    console.log(exists ? "OK " : "MISSING ", s);
    if (!exists) ok = false;
  }
}

function checkHooksJson() {
  const hooksJson = path.join(ROOT, "hooks.json");
  if (fs.existsSync(hooksJson)) {
    console.log("OK  hooks.json");
    try {
      const cfg = JSON.parse(fs.readFileSync(hooksJson, "utf8"));
      const events = Object.keys(cfg.hooks || {});
      console.log("    events:", events.join(", "));
      const subagentHooks = cfg.hooks?.subagentStop || [];
      const stopHooks = cfg.hooks?.stop || [];
      const hasLifecycle = subagentHooks.some((h) => h.command?.includes("orchestra-lifecycle"));
      const hasMemory = subagentHooks.some((h) => h.command?.includes("orchestra-memory"));
      const hasHeartbeat = stopHooks.some((h) => h.command?.includes("orchestra-heartbeat"));
      console.log("    lifecycle hook:", hasLifecycle ? "OK" : "MISSING");
      console.log("    memory hook:", hasMemory ? "OK" : "MISSING");
      console.log("    heartbeat hook:", hasHeartbeat ? "OK" : "MISSING");
      if (!hasLifecycle || !hasMemory || !hasHeartbeat) ok = false;
    } catch (e) {
      console.log("BAD hooks.json parse:", e.message);
      ok = false;
    }
  } else {
    console.log("MISSING hooks.json");
    ok = false;
  }
}

function checkState() {
  const state = loadState();
  console.log("\n=== State ===");
  console.log("    version:", state.version || "1 (legacy)");
  console.log("    active:", state.active);
  console.log("    phase:", state.phase);
  console.log("    ambient:", state.ambient);
  console.log("    heartbeat:", state.heartbeat ? "present" : "MISSING");
  console.log("    lifecycle:", state.lifecycle ? "present" : "MISSING");
  console.log("    memory:", state.memory ? "present" : "MISSING");
  console.log("    resumable:", state.resumable ? "present" : "MISSING");
}

function checkMemory() {
  console.log("\n=== Long-term Memory ===");
  const memExists = fs.existsSync(MEMORY_PATH);
  console.log(memExists ? "OK  " : "MISS ", "state/orchestra-memory.json");
  if (memExists) {
    try {
      const mem = JSON.parse(fs.readFileSync(MEMORY_PATH, "utf8"));
      console.log(`    completed_goals: ${mem.completed_goals?.length || 0}`);
      console.log(`    recent_files: ${mem.recent_files?.length || 0}`);
      console.log(`    error_patterns: ${mem.error_patterns?.length || 0}`);
    } catch (e) {
      console.log("    WARN: memory file is invalid JSON:", e.message);
    }
  }
}

function checkClassification() {
  const state = loadState();
  console.log("\n=== Classification samples ===");
  for (const [text, expect] of CLASSIFICATION_SAMPLES) {
    const r = classifyPrompt(text, state);
    const pass = r.activate === expect;
    console.log(pass ? "OK " : "FAIL", JSON.stringify(text), "->", r.activate, `(${r.reason})`);
    if (!pass) ok = false;
  }
}

function checkAgents() {
  const agentsDir = path.join(ROOT, "agents");
  if (fs.existsSync(agentsDir)) {
    console.log("\n=== Agents ===");
    for (const name of AGENT_NAMES) {
      console.log(fs.existsSync(path.join(agentsDir, name)) ? "OK " : "MISSING ", name);
    }
  }
}

checkScripts();
checkHooksJson();
checkState();
checkMemory();
checkClassification();
checkAgents();

console.log(ok ? "\nAll checks passed." : "\nSome checks failed — restart Cursor and verify Hooks tab.");
process.exit(ok ? 0 : 1);

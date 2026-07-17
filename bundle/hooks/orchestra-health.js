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
  "orchestra-quality-gate.js",
];

const LIBS = [
  "constants.js", "io.js", "state-manager.js", "prompt-classifier.js",
  "phase-engine.js", "lifecycle-recorder.js", "heartbeat-monitor.js",
  "memory-manager.js", "history-recorder.js", "checkpoint-manager.js",
  "context-detector.js", "version-manager.js", "project-manager.js",
  "daily-planner.js", "quality-gate.js", "observability.js",
  "self-improvement.js", "devops.js", "security-scanner.js",
];

const AGENT_NAMES = [
  "orchestra-planner.md",
  "orchestra-implementer.md",
  "orchestra-verifier.md",
  "orchestra-reviewer.md",
  "01-idea/business-analyst.md",
  "02-requirements/product-manager.md",
  "03-architecture/architect.md",
  "03-architecture/tech-lead.md",
  "04-planning/project-manager.md",
  "05-implementation/backend-engineer.md",
  "05-implementation/frontend-engineer.md",
  "05-implementation/full-stack-engineer.md",
  "05-implementation/database-engineer.md",
  "06-testing/qa-engineer.md",
  "06-testing/automation-engineer.md",
  "06-testing/performance-engineer.md",
  "06-testing/accessibility-reviewer.md",
  "07-security/security-engineer.md",
  "08-deployment/documentation-writer.md",
  "08-deployment/release-manager.md",
  "08-deployment/devops-engineer.md",
  "08-deployment/platform-engineer.md",
  "08-deployment/cloud-engineer.md",
  "08-deployment/infrastructure-engineer.md",
  "09-observability/sre.md",
  "09-observability/observer.md",
  "10-review/code-reviewer.md",
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
  console.log("=== Enterprise health check ===\n");
  for (const s of SCRIPTS) {
    const p = path.join(HOOKS_DIR, s);
    const exists = fs.existsSync(p);
    console.log(exists ? "OK " : "MISSING ", s);
    if (!exists) ok = false;
  }
}

function checkLibs() {
  const libDir = path.join(HOOKS_DIR, "lib");
  console.log("\n=== Lib modules ===");
  for (const l of LIBS) {
    const p = path.join(libDir, l);
    const exists = fs.existsSync(p);
    console.log(exists ? "OK " : "MISSING ", l);
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
      const hasQualityGate = subagentHooks.some((h) => h.command?.includes("orchestra-quality-gate"));
      console.log("    lifecycle hook:", hasLifecycle ? "OK" : "MISSING");
      console.log("    memory hook:", hasMemory ? "OK" : "MISSING");
      console.log("    heartbeat hook:", hasHeartbeat ? "OK" : "MISSING");
      console.log("    quality gate hook:", hasQualityGate ? "OK" : "MISSING");
      const agentPatterns = cfg.hooks?.subagentStop?.[0]?.matcher || "";
      const agentCount = agentPatterns.split("|").length;
      console.log("    subagent patterns:", agentCount);
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
  console.log("    version:", state.version);
  console.log("    active:", state.active);
  console.log("    phase:", state.currentPhase);
  console.log("    ambient:", state.ambient);
  console.log("    project:", state.project ? "present" : "MISSING");
  console.log("    versioning:", state.versioning ? "present" : "MISSING");
  console.log("    qualityGates:", state.qualityGates ? "present" : "MISSING");
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
    let agentOk = 0;
    let agentMiss = 0;
    for (const name of AGENT_NAMES) {
      const exists = fs.existsSync(path.join(agentsDir, name));
      console.log(exists ? "OK " : "MISSING ", name);
      if (exists) agentOk++; else { agentMiss++; ok = false; }
    }
    console.log(`    Agents: ${agentOk} present, ${agentMiss} missing`);
  }
}

function checkProjectFiles() {
  console.log("\n=== Enterprise State Files ===");
  const stateDir = path.join(HOOKS_DIR, "state");
  const files = [
    "orchestra-project.json",
    "orchestra-version.json",
    "orchestra-daily.json",
    "orchestra-metrics.json",
  ];
  for (const f of files) {
    const p = path.join(stateDir, f);
    const exists = fs.existsSync(p);
    console.log(exists ? "OK  " : "INIT ", f);
  }
}

checkScripts();
checkLibs();
checkHooksJson();
checkState();
checkMemory();
checkClassification();
checkAgents();
checkProjectFiles();

console.log(ok ? "\nAll checks passed." : "\nSome checks failed — review output above.");
process.exit(ok ? 0 : 1);

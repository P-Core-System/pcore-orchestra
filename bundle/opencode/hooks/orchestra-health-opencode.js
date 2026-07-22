#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const OPENCODE = process.env.OPENCODE_CONFIG_DIR
  || path.join(require("os").homedir(), ".config", "opencode");

const AGENTS_DIR = path.join(OPENCODE, "agents");
const SKILL_PATH = path.join(OPENCODE, "skills", "orchestra-loop", "SKILL.md");
const STATE_PATH = path.join(OPENCODE, "state", "orchestra.json");
const HOOKS_DIR = path.join(OPENCODE, "hooks");
const LIB_DIR = path.join(HOOKS_DIR, "lib");
const EXTERNAL_SKILL = path.join(
  process.env.AGENTS_SKILLS || path.join(require("os").homedir(), ".agents", "skills"),
  "orchestra-loop"
);

const coreAgents = [
  "orchestra-planner.md",
  "orchestra-implementer.md",
  "orchestra-verifier.md",
  "orchestra-reviewer.md",
];

const hookScripts = [
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
  "orchestra-health.js",
];

const libModules = [
  "constants.js",
  "io.js",
  "state-manager.js",
  "prompt-classifier.js",
  "phase-engine.js",
  "lifecycle-recorder.js",
  "heartbeat-monitor.js",
  "memory-manager.js",
  "history-recorder.js",
  "checkpoint-manager.js",
  "context-detector.js",
  "version-manager.js",
  "project-manager.js",
  "daily-planner.js",
  "quality-gate.js",
  "observability.js",
  "self-improvement.js",
  "devops.js",
  "security-scanner.js",
  "project-identity.js",
  "evidence-runner.js",
];

console.log("=== OpenCode Orchestra health check ===\n");

let ok = true;

// --- Agents ---
console.log("--- Agents ---");
for (const name of coreAgents) {
  const p = path.join(AGENTS_DIR, name);
  const exists = fs.existsSync(p);
  console.log(exists ? "OK  " : "MISS", name);
  if (!exists) ok = false;

  if (exists) {
    const content = fs.readFileSync(p, "utf8");
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) {
      console.log("      WARN: no frontmatter found");
    } else {
      const fm = fmMatch[1];
      if (!fm.includes("name:")) console.log("      WARN: missing name in frontmatter");
      if (!fm.includes("description:")) console.log("      WARN: missing description in frontmatter");
      if (!fm.includes("mode: subagent")) console.log("      WARN: mode should be 'subagent'");
    }
  }
}

// Enterprise agents (dirs 01-idea through 10-review)
const enterpriseDirs = [
  "01-idea", "02-requirements", "03-architecture", "04-planning",
  "05-implementation", "06-testing", "07-security", "08-deployment",
  "09-observability", "10-review"
];
let enterpriseCount = 0;
for (const dir of enterpriseDirs) {
  const dirPath = path.join(AGENTS_DIR, dir);
  if (fs.existsSync(dirPath)) {
    const files = fs.readdirSync(dirPath).filter(f => f.endsWith(".md"));
    enterpriseCount += files.length;
    for (const f of files) {
      const p = path.join(dirPath, f);
      const content = fs.readFileSync(p, "utf8");
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (fmMatch && !fmMatch[1].includes("mode: subagent")) {
        console.log("WARN ", dir + "/" + f, "— missing mode: subagent");
      }
    }
  }
}
console.log("OK   Enterprise agents:", enterpriseCount, "present");

// --- Hooks ---
console.log("\n--- Hooks ---");
for (const name of hookScripts) {
  const p = path.join(HOOKS_DIR, name);
  const exists = fs.existsSync(p);
  console.log(exists ? "OK  " : "MISS", name);
  if (!exists) ok = false;
}

// --- Lib modules ---
console.log("\n--- Lib modules ---");
let libOk = 0;
for (const name of libModules) {
  const p = path.join(LIB_DIR, name);
  const exists = fs.existsSync(p);
  console.log(exists ? "OK  " : "MISS", name);
  if (!exists) ok = false;
  else libOk++;
}
console.log("    Lib modules:", libOk + "/" + libModules.length);

// --- Skill ---
console.log("\n--- Skill ---");
const skillExists = fs.existsSync(SKILL_PATH);
console.log(skillExists ? "OK  " : "MISS", "skills/orchestra-loop/SKILL.md");
if (!skillExists) ok = false;

// External link
const externalExists = fs.existsSync(EXTERNAL_SKILL);
console.log(externalExists ? "OK  " : "MISS", "~/.agents/skills/orchestra-loop");
if (!externalExists) {
  console.log("      INFO: external symlink optional — not required for OpenCode");
}

// --- State ---
console.log("\n--- State ---");
const stateExists = fs.existsSync(STATE_PATH);
console.log(stateExists ? "OK  " : "MISS", "state/orchestra.json");
if (!stateExists) {
  ok = false;
} else {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
    console.log("      version:", state.version || "1 (legacy)");
    console.log("      phase:", state.phase);
    console.log("      active:", state.active);
    console.log("      iteration:", state.iteration, "/", state.max_iterations);
    console.log("      loopMode:", state.loopMode || "missing");
    console.log("      project:", state.project ? "present" : "MISSING");
    console.log("      versioning:", state.versioning ? "present" : "MISSING");
    console.log("      qualityGates:", state.qualityGates ? "present" : "MISSING");
    console.log("      heartbeat:", state.heartbeat ? "present" : "MISSING");
    console.log("      lifecycle:", state.lifecycle ? "present" : "MISSING");
    console.log("      memory:", state.memory ? "present" : "MISSING");
    console.log("      resumable:", state.resumable ? "present" : "MISSING");
  } catch (e) {
    console.log("      WARN: state file is invalid JSON:", e.message);
    ok = false;
  }
}

// --- Config ---
console.log("\n--- Config ---");
const configPath = path.join(OPENCODE, "opencode.json");
if (fs.existsSync(configPath)) {
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const agents_cfg = cfg.agent || {};
    const orchestra_agents = Object.keys(agents_cfg).filter(k => k.startsWith("orchestra-"));
    if (orchestra_agents.length > 0) {
      console.log("OK   opencode.json has orchestra agents:", orchestra_agents.join(", "));
    } else {
      console.log("OK   opencode.json (agents from files, not inline)");
    }
  } catch {
    console.log("WARN opencode.json parse error");
  }
} else {
  console.log("INFO no opencode.json found (agents loaded from files)");
}

console.log(ok ? "\nAll OpenCode checks passed." : "\nSome checks failed — restart opencode and verify.");
process.exit(ok ? 0 : 1);

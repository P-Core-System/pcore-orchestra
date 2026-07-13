#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const OPENCODE = process.env.OPENCODE_CONFIG_DIR
  || path.join(require("os").homedir(), ".config", "opencode");

const AGENTS_DIR = path.join(OPENCODE, "agents");
const SKILL_PATH = path.join(OPENCODE, "skills", "orchestra-loop", "SKILL.md");
const STATE_PATH = path.join(OPENCODE, "state", "orchestra.json");
const EXTERNAL_SKILL = path.join(
  process.env.AGENTS_SKILLS || path.join(require("os").homedir(), ".agents", "skills"),
  "orchestra-loop"
);

const agents = [
  "orchestra-planner.md",
  "orchestra-implementer.md",
  "orchestra-verifier.md",
  "orchestra-reviewer.md",
];

console.log("=== OpenCode Orchestra health check ===\n");

let ok = true;

// Check agents
console.log("--- Agents ---");
for (const name of agents) {
  const p = path.join(AGENTS_DIR, name);
  const exists = fs.existsSync(p);
  console.log(exists ? "OK  " : "MISS", name);
  if (!exists) ok = false;

  // Validate frontmatter
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

// Check skill
console.log("\n--- Skill ---");
const skillExists = fs.existsSync(SKILL_PATH);
console.log(skillExists ? "OK  " : "MISS", "skills/orchestra-loop/SKILL.md");
if (!skillExists) ok = false;

// Check external link
const externalExists = fs.existsSync(EXTERNAL_SKILL);
console.log(externalExists ? "OK  " : "MISS", "~/.agents/skills/orchestra-loop");
if (!externalExists) {
  console.log("      INFO: external symlink optional — not required for OpenCode");
}

// Check state
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
    console.log("      heartbeat:", state.heartbeat ? "present" : "MISSING");
    console.log("      lifecycle:", state.lifecycle ? "present" : "MISSING");
    console.log("      memory:", state.memory ? "present" : "MISSING");
    console.log("      resumable:", state.resumable ? "present" : "MISSING");
  } catch (e) {
    console.log("      WARN: state file is invalid JSON:", e.message);
    ok = false;
  }
}

// Check opencode config references
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

#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const OPENCODE = process.env.OPENCODE_CONFIG_DIR
  || path.join(os.homedir(), ".config", "opencode");

const AGENTS_DIR = path.join(OPENCODE, "agents");
const SKILL_PATH = path.join(OPENCODE, "skills", "orchestra-loop", "SKILL.md");
const STATE_PATH = path.join(OPENCODE, "hooks", "state", "orchestra.json");
const HOOKS_DIR = path.join(OPENCODE, "hooks");
const LIB_DIR = path.join(HOOKS_DIR, "lib");
const EXTERNAL_SKILL = path.join(
  process.env.AGENTS_SKILLS || path.join(os.homedir(), ".agents", "skills"),
  "orchestra-loop"
);

// --- Auto-heal: locate the pcore-orchestra bundle to restore from ---
const HEAL = process.argv.includes("--heal");
const BUNDLE_OPENCODE = process.env.PCORE_ORCHESTRA_BUNDLE
  || (() => {
    const candidates = [
      path.join(os.homedir(), "Documents", "Project", "pcore-orchestra", "bundle", "opencode"),
      path.join(os.homedir(), "Projects", "pcore-orchestra", "bundle", "opencode"),
      path.join(os.homedir(), "code", "pcore-orchestra", "bundle", "opencode"),
      path.join(os.homedir(), "Developer", "pcore-orchestra", "bundle", "opencode"),
    ];
    return candidates.find((p) => fs.existsSync(path.join(p, "hooks")));
  })();

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
let healed = 0;

function healFile(src, dest) {
  if (!src || !fs.existsSync(src)) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  healed++;
}

function healDir(src, dest) {
  if (!src || !fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    const s = path.join(src, entry);
    const d = path.join(dest, entry);
    if (fs.statSync(s).isDirectory()) healDir(s, d);
    else if (!fs.existsSync(d)) healFile(s, d);
  }
}

if (HEAL) {
  console.log("HEAL mode: restoring missing files from bundle");
  if (!BUNDLE_OPENCODE) {
    console.log("  WARN: pcore-orchestra bundle not found — set PCORE_ORCHESTRA_BUNDLE");
    console.log("  Continuing with state/config repair only.\n");
  }
}

// --- Agents ---
console.log("--- Agents ---");
for (const name of coreAgents) {
  const p = path.join(AGENTS_DIR, name);
  const exists = fs.existsSync(p);
  if (!exists && HEAL && BUNDLE_OPENCODE) {
    healFile(path.join(BUNDLE_OPENCODE, "agents", name), p);
    console.log("HEALED  ", name);
    continue;
  }
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
  } else if (HEAL && BUNDLE_OPENCODE) {
    const src = path.join(BUNDLE_OPENCODE, "agents", dir);
    if (fs.existsSync(src)) {
      healDir(src, dirPath);
      const files = fs.readdirSync(dirPath).filter(f => f.endsWith(".md"));
      enterpriseCount += files.length;
      console.log("HEALED  enterprise dir", dir);
    }
  }
}
console.log("OK   Enterprise agents:", enterpriseCount, "present");

// --- Hooks ---
console.log("\n--- Hooks ---");
for (const name of hookScripts) {
  const p = path.join(HOOKS_DIR, name);
  const exists = fs.existsSync(p);
  if (!exists && HEAL && BUNDLE_OPENCODE) {
    healFile(path.join(BUNDLE_OPENCODE, "hooks", name), p);
    console.log("HEALED  ", name);
    continue;
  }
  console.log(exists ? "OK  " : "MISS", name);
  if (!exists) ok = false;
}

// --- Lib modules ---
console.log("\n--- Lib modules ---");
let libOk = 0;
for (const name of libModules) {
  const p = path.join(LIB_DIR, name);
  const exists = fs.existsSync(p);
  if (!exists && HEAL && BUNDLE_OPENCODE) {
    healFile(path.join(BUNDLE_OPENCODE, "hooks", "lib", name), p);
    console.log("HEALED  lib/" + name);
    continue;
  }
  console.log(exists ? "OK  " : "MISS", name);
  if (!exists) ok = false;
  else libOk++;
}
console.log("    Lib modules:", libOk + "/" + libModules.length);

// --- Skill ---
console.log("\n--- Skill ---");
const skillExists = fs.existsSync(SKILL_PATH);
if (!skillExists && HEAL && BUNDLE_OPENCODE) {
  healDir(
    path.join(BUNDLE_OPENCODE, "skills", "orchestra-loop"),
    path.join(OPENCODE, "skills", "orchestra-loop")
  );
  console.log("HEALED  skills/orchestra-loop/SKILL.md");
}
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
console.log(stateExists ? "OK  " : "MISS", "state/orchestra.json (hooks/state)");
if (!stateExists) {
  if (HEAL) {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    fs.writeFileSync(STATE_PATH, "{}");
    console.log("HEALED  state/orchestra.json (initialized empty)");
  }
  ok = false;
} else {
  try {
    let state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
    const missingKeys = ["project", "versioning", "qualityGates", "loopMode"].filter(
      (k) => state[k] === undefined
    );
    if (missingKeys.length > 0) {
      if (HEAL) {
        const { loadState, saveState } = require("./lib/state-manager.js");
        const repaired = loadState();
        repaired.project = repaired.project || { name: "", slug: "", displayName: "", type: "software", lifecycleStage: "development", lifecycleStatus: "active" };
        repaired.versioning = repaired.versioning || { current: "0.1.0", buildNumber: 0, previous: null, bumpType: null };
        repaired.qualityGates = repaired.qualityGates || { passed: [], failed: [], skipped: [], allRequiredPassed: false };
        saveState(repaired);
        healed++;
        console.log("HEALED  state keys:", missingKeys.join(", "));
        state = repaired;
      } else {
        console.log("      WARN: missing state keys:", missingKeys.join(", "));
      }
    }
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

if (healed > 0) {
  console.log(`\nHEALED ${healed} items — run again to confirm clean.`);
}
console.log(ok ? "\nAll OpenCode checks passed." : "\nSome checks failed — restart opencode and verify.");
process.exit(ok ? 0 : 1);

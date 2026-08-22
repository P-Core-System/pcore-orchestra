#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const MEMORY_PATH = path.join(__dirname, "state", "orchestra-memory.json");
const { loadState } = require("./lib/state-manager.js");
const { classifyPrompt } = require("./lib/prompt-classifier.js");
const { loadProjectIdentity, validateProjectIdentity, findProjectIdentity } = require("./lib/project-identity.js");

const HOOKS_DIR = __dirname;
const ROOT = path.join(HOOKS_DIR, "..");
const SESSION_CLAIMS_SCRIPT = path.join(__dirname, "..", "..", "scripts", "session-claims.sh");

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
  "project-identity.js", "evidence-runner.js", "token-tracker.js",
  "orchestra-config.js", "handoff-enforcer.js", "metrics-report.js", "workspace-identity.js",
  "semantic-memory.js", "plan-artifact.js", "cycle-report.js", "memory-index.js",
  "phase-commit-gate.js", "greenfield-intake.js",
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

function checkProjectIdentityTemplate() {
  console.log("\n=== Project Identity System ===");
  const templateDir = path.join(ROOT, "..", "templates");
  const templateYaml = path.join(templateDir, "project.yaml");
  const templateExists = fs.existsSync(templateYaml);
  console.log(templateExists ? "OK  " : "MISS ", "templates/project.yaml");
  if (!templateExists) { ok = false; return; }

  try {
    const identity = loadProjectIdentity(templateDir);
    if (identity) {
      const validation = validateProjectIdentity(identity);
      console.log("    project.identity: loaded OK");
      if (validation.errors.length > 0) {
        console.log("    validation errors:", validation.errors.join("; "));
      }
      if (validation.warnings.length > 0) {
        console.log("    validation warnings:", validation.warnings.join("; "));
      }
      console.log(`    project.identity.lib: project-identity.js`);
    } else {
      console.log("    project.identity: FAILED to load");
      ok = false;
    }
  } catch (e) {
    console.log("    project.identity: ERROR", e.message);
    ok = false;
  }
}

function checkAdaptiveInstall() {
  console.log("\n=== Adaptive loop install ===");
  const libDir = path.join(HOOKS_DIR, "lib");
  const nested = path.join(libDir, "lib");
  if (fs.existsSync(nested)) {
    console.log("FAIL nested hooks/lib/lib (stale install) — re-run install.sh");
    ok = false;
  } else {
    console.log("OK  no nested hooks/lib/lib");
  }
  const sm = path.join(libDir, "state-manager.js");
  try {
    const text = fs.readFileSync(sm, "utf8");
    const hasMode = text.includes("LOOP_MODE_CORE");
    const startsPlan =
      /startPhase\s*=\s*route\s*===\s*LOOP_MODE_ENTERPRISE\s*\?\s*"idea"\s*:\s*"plan"/.test(text) ||
      /startPhase\s*=\s*route\s*===\s*LOOP_MODE_ENTERPRISE\s*\?\s*enterprisePhases\[0\]\.id\s*:\s*"plan"/.test(text);
    console.log(hasMode ? "OK  " : "FAIL", "LOOP_MODE_CORE in state-manager");
    console.log(startsPlan ? "OK  " : "FAIL", "core starts at plan");
    if (!hasMode || !startsPlan) ok = false;
  } catch (e) {
    console.log("FAIL read state-manager:", e.message);
    ok = false;
  }

  const state = { ambient: true };
  const vague = classifyPrompt("next improve", state);
  const informalOk =
    vague.activate &&
    vague.route === "core" &&
    !vague.clarifyNeeded &&
    vague.inferFromContext;
  console.log(
    informalOk ? "OK  " : "FAIL",
    'classify "next improve" informal_inferred=',
    informalOk
  );
  if (!informalOk) ok = false;

  const core = classifyPrompt("fix login bug in auth.js", state);
  console.log(
    core.route === "core" && core.activate ? "OK  " : "FAIL",
    'classify fix →',
    core.route
  );
  if (!(core.route === "core" && core.activate)) ok = false;
}

checkScripts();
checkLibs();
checkHooksJson();
checkState();
checkMemory();
checkClassification();
checkAgents();
checkProjectFiles();
checkProjectIdentityTemplate();
checkAdaptiveInstall();

// --- Session-claims validation ---
function checkSessionClaims() {
  console.log("\n=== Session-claims ===");
  if (fs.existsSync(SESSION_CLAIMS_SCRIPT)) {
    console.log("OK  session-claims.sh exists at", SESSION_CLAIMS_SCRIPT);
    try {
      const { spawnSync } = require("child_process");
      // Check for stale/active conflicts in current repo
      const result = spawnSync("bash", [SESSION_CLAIMS_SCRIPT, "check", process.cwd()], {
        encoding: "utf8",
        timeout: 10000,
      });
      if (result.status === 0) {
        console.log("OK  check: no live conflicts in current repo");
      } else if (result.status === 1) {
        console.log("WARN check: active conflicting claim detected");
        console.log("     Output:", result.stdout.trim() || result.stderr.trim());
        ok = false;
      } else {
        console.log("WARN check: script error (exit", result.status, ")");
        console.log("     stderr:", result.stderr.trim());
        ok = false;
      }
      // Also list stale claims in current repo
      const listResult = spawnSync("bash", [SESSION_CLAIMS_SCRIPT, "list", process.cwd()], {
        encoding: "utf8",
        timeout: 10000,
      });
      if (listResult.status === 0 && listResult.stdout.trim()) {
        const lines = listResult.stdout.trim().split("\n");
        const staleLines = lines.filter(l => l.startsWith("STALE"));
        if (staleLines.length > 0) {
          console.log("WARN stale claims in current repo:", staleLines.length);
          staleLines.forEach(l => console.log("     ", l.trim()));
        } else {
          console.log("OK  no stale claims in current repo");
        }
      }
    } catch (e) {
      console.log("WARN session-claims check failed:", e.message);
      ok = false;
    }
  } else {
    console.log("MISS session-claims.sh not found at", SESSION_CLAIMS_SCRIPT);
    console.log("     Expected at repo-root/scripts/session-claims.sh");
    ok = false;
  }
}

checkSessionClaims();

console.log(ok ? "\nAll checks passed." : "\nSome checks failed — review output above.");
process.exit(ok ? 0 : 1);

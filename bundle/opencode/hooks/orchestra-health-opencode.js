#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

// Walk-up limit when searching for the repo sentinel from the installed location
const REPO_WALK_MAX_LEVELS = 4;
const REPO_SENTINEL = path.join("scripts", "session-claims.sh");

/**
 * Locate the pcore-orchestra source repository.
 * Order: PCORE_ORCHESTRA_REPO env → walk up from __dirname → process.cwd().
 * Returns null when not found (callers must degrade to INFO, never fail).
 */
function findRepoRoot() {
  if (process.env.PCORE_ORCHESTRA_REPO) {
    const envRoot = process.env.PCORE_ORCHESTRA_REPO;
    if (fs.existsSync(path.join(envRoot, REPO_SENTINEL))) return envRoot;
  }
  let dir = __dirname;
  for (let i = 0; i < REPO_WALK_MAX_LEVELS; i++) {
    if (fs.existsSync(path.join(dir, REPO_SENTINEL))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (fs.existsSync(path.join(process.cwd(), REPO_SENTINEL))) return process.cwd();
  return null;
}

function loadSanitizer() {
  const repoRoot = findRepoRoot();
  const candidates = [
    path.join(__dirname, "lib", "opencode-config-sanitize.js"),
    ...(repoRoot
      ? [path.join(repoRoot, "scripts", "lib", "opencode-config-sanitize.js")]
      : []),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return require(p);
  }
  throw new Error("opencode-config-sanitize.js not found — re-run bash install.sh --opencode");
}

const { sanitizeOpenCodeConfig, getOpenCodeVersion, MIN_TOOL_OUTPUT_VERSION } = loadSanitizer();

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

const REPO_ROOT = findRepoRoot();
const SESSION_CLAIMS_SCRIPT = REPO_ROOT
  ? path.join(REPO_ROOT, "scripts", "session-claims.sh")
  : null;

// --- Auto-heal: locate the pcore-orchestra bundle to restore from ---
const HEAL = process.argv.includes("--heal");
const BUNDLE_OPENCODE = process.env.PCORE_ORCHESTRA_BUNDLE
  || (REPO_ROOT && fs.existsSync(path.join(REPO_ROOT, "bundle", "opencode", "hooks"))
    ? path.join(REPO_ROOT, "bundle", "opencode")
    : null);

const coreAgents = [
  "orchestra.md",
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
      const isConductor = name === "orchestra.md";
      if (isConductor && !fm.includes("mode: primary")) {
        console.log("      WARN: conductor should have mode: primary");
      }
      if (!isConductor && !fm.includes("mode: subagent")) {
        console.log("      WARN: phase agent should have mode: subagent");
      }
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
console.log(stateExists ? "OK  " : "INFO", "state/orchestra.json (hooks/state)");
if (!stateExists) {
  if (HEAL) {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    fs.writeFileSync(STATE_PATH, "{}");
    console.log("HEALED  state/orchestra.json (initialized empty)");
  } else {
    console.log("      state/orchestra.json — created on first orchestration run");
  }
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
    const { config: sanitized, removed, fixed, version } = sanitizeOpenCodeConfig(cfg);

    if (removed.length > 0) {
      const ver = version || getOpenCodeVersion() || "unknown";
      console.log("WARN opencode.json has unsupported keys:", removed.join(", "));
      console.log(`      OpenCode ${ver} — need >= ${MIN_TOOL_OUTPUT_VERSION} for tool_output.`);
      console.log("      Upgrade: bash scripts/ensure-opencode-latest.sh (or OPENCODE_CHANNEL=beta)");
      ok = false;
      if (HEAL) {
        fs.writeFileSync(configPath, JSON.stringify(sanitized, null, 2) + "\n");
        healed++;
        console.log("HEALED  removed unsupported keys from opencode.json");
      }
    } else if (fixed.length > 0) {
      console.log("WARN opencode.json invalid fields:", fixed.join(", "));
      ok = false;
      if (HEAL) {
        fs.writeFileSync(configPath, JSON.stringify(sanitized, null, 2) + "\n");
        healed++;
        console.log("HEALED  normalized", fixed.join(", "));
      }
    }

    const agents_cfg = sanitized.agent || {};
    const orchestra_agents = Object.keys(agents_cfg).filter(
      (k) => k.startsWith("orchestra-") || k === "orchestra"
    );
    if (orchestra_agents.length > 0) {
      console.log("OK   opencode.json has orchestra agents:", orchestra_agents.join(", "));
    } else {
      console.log("OK   opencode.json (agents from files, not inline)");
    }

    const def = sanitized.default_agent;
    const orch = agents_cfg.orchestra;
    if (def === "orchestra") {
      if (!orch) {
        console.log("WARN default_agent is orchestra but agent.orchestra missing in opencode.json");
        ok = false;
      } else if (orch.mode !== "primary") {
        console.log("WARN agent.orchestra.mode should be 'primary' (desktop default_agent requires it)");
        ok = false;
        if (HEAL) {
          orch.mode = "primary";
          orch.description =
            orch.description ||
            "Orchestra conductor — plan → implement → verify → review via task tool";
          orch.reasoningEffort = orch.reasoningEffort || "low";
          orch.textVerbosity = orch.textVerbosity || "low";
          sanitized.agent = agents_cfg;
          fs.writeFileSync(configPath, JSON.stringify(sanitized, null, 2) + "\n");
          healed++;
          console.log("HEALED  set agent.orchestra.mode=primary + low reasoning");
        }
      } else {
        console.log("OK   default_agent orchestra with mode: primary");
      }
    }
  } catch {
    console.log("WARN opencode.json parse error");
    ok = false;
  }
} else {
  console.log("INFO no opencode.json found (agents loaded from files)");
}

// --- Session-claims validation ---
  console.log("\n--- Session-claims ---");
  if (!SESSION_CLAIMS_SCRIPT) {
    console.log("INFO  session-claims.sh not found (source repo not located — set PCORE_ORCHESTRA_REPO to enable this check)");
  } else if (fs.existsSync(SESSION_CLAIMS_SCRIPT)) {
    console.log("OK  session-claims.sh exists at", SESSION_CLAIMS_SCRIPT);
    try {
      const { spawnSync } = require("child_process");
      // Check for stale/active conflicts in current repo
      const result = spawnSync("bash", [SESSION_CLAIMS_SCRIPT, "check", "--json", process.cwd()], {
        encoding: "utf8",
        timeout: 10000,
      });
      if (result.status === 0) {
        try {
          const parsed = JSON.parse(result.stdout.trim());
          if (parsed.has_conflicts && parsed.conflicts.length > 0) {
            console.log("INFO  session-claims: live sessions on these paths:", parsed.conflicts.map(c => c.session_id).join(", "));
          } else {
            console.log("OK  check: no live conflicts in current repo");
          }
        } catch {
          console.log("OK  check completed (output parsing skipped)");
        }
      } else {
        console.log("WARN check: script error (exit", result.status, ")");
        console.log("     stderr:", result.stderr.trim());
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
          console.log("INFO stale claims in current repo:", staleLines.length);
          staleLines.forEach(l => console.log("     ", l.trim()));
        } else {
          console.log("OK  no stale claims in current repo");
        }
      }
    } catch (e) {
      console.log("WARN session-claims check failed:", e.message);
    }
  } else {
    console.log("INFO  session-claims.sh not found at", SESSION_CLAIMS_SCRIPT);
  }

  if (healed > 0) {
  console.log(`\nHEALED ${healed} items — run again to confirm clean.`);
}
console.log(ok ? "\nAll OpenCode checks passed." : "\nSome checks failed — restart opencode and verify.");
process.exit(ok ? 0 : 1);

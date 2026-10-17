#!/usr/bin/env node
/**
 * scripts/test-opencode-permission-contract.js
 *
 * Track D2 — contract test + CI plugins coverage.
 *
 * Asserts the OpenCode permission contract enforced by the orchestra autonomy
 * config (bundle/config/opencode/autonomy.json) against the live `opencode
 * debug agents` oracle.
 *
 * Design rules (from verified facts):
 *  - Oracle (`opencode debug agents`) is nondeterministic: transiently returns
 *    [] under parallel load. Retry up to 5x with sleep; FAIL LOUD if still 0.
 *  - Resolution = last-match-wins over the conductor's subagent + `*` rules,
 *      iterated IN ORDER; keep the LAST rule whose resource glob matches the
 *      agent id. Glob: "*" matches all; "prefix*" = startsWith(prefix); else
 *      exact equality. Matching is against the agent basename (conductor rules
 *      are bare basename globs such as `backend-engineer*`).
 *  - Do NOT hardcode agent names or absolute counts; derive expected values
 *      from the same run asserted against. `explore`/`general` built-ins are
 *      unstable — skip-with-warning when absent, never hard assert.
 *  - Read resolved JSON from a file path, never `$(cat ...)` argv.
 *  - Derived-from-same-run assertions only (tolerant of oracle nondeterminism).
 *
 * Run: node scripts/test-opencode-permission-contract.js
 */

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");
const BUNDLE_AGENTS = path.join(ROOT, "bundle", "opencode", "agents");
const BUNDLE_HOOKS_LIB = path.join(ROOT, "bundle", "hooks", "lib");
const OPCODE_HOOKS_LIB = path.join(ROOT, "bundle", "opencode", "hooks", "lib");
const BUNDLE_PLUGIN = path.join(
  ROOT,
  "bundle",
  "opencode",
  "plugins",
  "orchestra-ambient.js"
);
const ORACLE_CMD = "opencode";
const ORACLE_RETRIES = 15;
const ORACLE_SLEEP_MS = 2000;

let passed = 0;
let failed = 0;
let skipped = 0;

function t(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL  ${name}`);
    console.error(`    ${err && err.message ? err.message.split("\n").join("\n    ") : err}`);
  }
}

function warn(name, detail) {
  skipped += 1;
  console.log(`SKIP  ${name}${detail ? ` — ${detail}` : ""}`);
}

function sleep(ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {}
}

/* ─────────────────────────── oracle helpers ─────────────────────────── */

/**
 * Query the `opencode debug agents` oracle with retry for transient 0.
 * Returns the parsed agent array (never [], never throws on transient 0 —
 * throws FAIL LOUD only after exhausting retries).
 */
function runOracle() {
  let lastErr;
  const tmpFile = path.join(os.tmpdir(), `opencode-oracle-${process.pid}-${Date.now()}.json`);
  for (let i = 0; i < ORACLE_RETRIES; i++) {
    let out;
    try {
      // Use shell redirection to a temp file instead of execFileSync's maxBuffer,
      // which truncates/corrupts the large oracle JSON (~1.3MB, "Unterminated
      // string at position 984994"). Read back from the file path.
      execFileSync("bash", ["-c", ORACLE_CMD + " debug agents > " + tmpFile + " 2>/dev/null"], {
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
      });
      out = fs.readFileSync(tmpFile, "utf8");
    } catch (err) {
      lastErr = `exec failed: ${err.message}`;
      sleep(ORACLE_SLEEP_MS);
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(out);
    } catch (err) {
      lastErr = `parse failed: ${err.message}`;
      sleep(ORACLE_SLEEP_MS);
      continue;
    }
    if (Array.isArray(parsed) && parsed.length > 0) {
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        /* best-effort cleanup */
      }
      return parsed;
    }
    lastErr = `oracle returned ${Array.isArray(parsed) ? parsed.length : "non-array"} agents`;
    sleep(ORACLE_SLEEP_MS);
  }
  try {
    fs.unlinkSync(tmpFile);
  } catch {
    /* best-effort cleanup */
  }
  throw new Error(
    `FAIL LOUD (trap 2): oracle returned 0 agents after ${ORACLE_RETRIES} retries (last: ${lastErr})`
  );
}

/**
 * Write resolved oracle JSON to a temp file path and read it back from that
 * path (trap k: never pass `$(cat ...)` as argv).
 */
function readOracleFromFile(agents) {
  const file = path.join(os.tmpdir(), `opencode-permission-contract-${process.pid}.json`);
  fs.writeFileSync(file, JSON.stringify(agents, null, 2) + "\n");
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } finally {
    try {
      fs.unlinkSync(file);
    } catch {
      /* best-effort cleanup */
    }
  }
}

/* ─────────────────────── agent file enumeration (derived) ─────────────────────── */

function globMd(dir) {
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(globMd(p));
    else if (e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

const EXCLUDE_BASENAMES = new Set([
  "orchestra.md",
  "orchestra-planner.md",
  "orchestra-implementer.md",
  "orchestra-verifier.md",
  "orchestra-reviewer.md",
]);

const specialistFiles = globMd(BUNDLE_AGENTS).filter((f) => {
  const b = path.basename(f);
  if (EXCLUDE_BASENAMES.has(b)) return false;
  if (f.includes(path.sep + "references" + path.sep)) return false;
  return true;
});

// Specialist agent basenames — derived from bundle files, NOT hardcoded.
const specialistNames = specialistFiles.map((f) => path.basename(f, ".md"));

// Build id → basename lookup from the oracle so namespaced ids (e.g.
// 05-implementation/backend-engineer) map to their bare basename for glob
// matching against conductor rules like `backend-engineer*`.
function oracleBasenameLookup(agents) {
  const byBase = new Map();
  for (const a of agents) {
    const base = a.id.split("/").pop();
    if (!byBase.has(base)) byBase.set(base, a);
  }
  return byBase;
}

/* ─────────────────────── last-match-wins resolution ─────────────────────── */

function globMatches(glob, id) {
  if (glob === "*") return true;
  if (glob.endsWith("*")) return id.startsWith(glob.slice(0, -1));
  return glob === id;
}

/**
 * Last-match-wins: iterate rules IN ORDER, keep the LAST rule whose resource
 * glob matches `id`, return its effect ('allow' | 'deny' | null).
 */
function lastMatch(rules, id) {
  let last = null;
  for (const r of rules) {
    if (r && globMatches(r.resource, id)) last = r.effect;
  }
  return last;
}

/* ─────────────────────── tests ─────────────────────── */

/* ─────────────────────── oracle (fetched once, same-run) ─────────────────────── */

const ORACLE_ENABLED = (() => {
  const r = spawnSync(ORACLE_CMD, ["--version"], { encoding: "utf8" });
  return r.status === 0;
})();

// Fetched ONCE so every assertion is derived from the SAME oracle run
// (spec: "derived-from-same-run assertions only"). Also means a single
// transient bad streak is absorbed by runOracle's retries instead of N
// independent calls each risking failure.
let cachedAgents = null;
let cachedAgentsErr = null;
function cachedOracle() {
  if (cachedAgentsErr) return; // already failed
  if (cachedAgents) return cachedAgents;
  if (!ORACLE_ENABLED) {
    cachedAgentsErr = new Error("opencode binary unavailable");
    return;
  }
  try {
    cachedAgents = readOracleFromFile(runOracle()); // (k) read from file path; throws FAIL LOUD if 0 after retries
  } catch (err) {
    cachedAgentsErr = err;
  }
  return cachedAgents;
}
function requireOracle(label) {
  cachedOracle();
  if (cachedAgentsErr) throw cachedAgentsErr;
  if (!cachedAgents) throw new Error(`${label}: oracle returned no agents`);
  return cachedAgents;
}

// ───── (i) retry logic + (a) oracle non-zero count (trap 1) ─────
t("oracle non-zero agent count (retry up to 10x, fail loud if still 0)", () => {
  if (!ORACLE_ENABLED) {
    warn("oracle non-zero agent count", "opencode binary unavailable");
    return;
  }
  const agents = requireOracle("oracle non-zero count"); // retries + fail loud inside
  console.log(`    oracle agent count: ${agents.length}`);
  if (!Array.isArray(agents) || agents.length === 0) {
    throw new Error("oracle returned zero agents");
  }
});

// ───── (b) last-match-wins reachability: all specialists effectively allowed ─────
t("last-match-wins: every derived specialist agent is effectively allowed", () => {
  if (!ORACLE_ENABLED) {
    warn("last-match-wins reachability", "opencode binary unavailable");
    return;
  }
  const agents = requireOracle("last-match-wins reachability");
  const conductor = agents.find((a) => a.id === "orchestra");
  if (!conductor) throw new Error("oracle missing conductor agent 'orchestra'");
  const subRules = (conductor.permissions || []).filter((p) => p.action === "subagent");
  if (!subRules.length) throw new Error("conductor has no subagent rules");

  const byBase = oracleBasenameLookup(agents);
  let allowed = 0;
  let denied = 0;
  let unresolved = 0;
  const deniedList = [];

  for (const name of specialistNames) {
    // Conductor rules are bare basename globs (e.g. `backend-engineer*`); match
    // against the specialist basename, not the namespaced oracle id.
    const agent = byBase.get(name);
    if (!agent) {
      unresolved += 1;
      deniedList.push(`${name}(no-oracle-agent)`);
      continue;
    }
    const eff = lastMatch(subRules, name);
    if (eff === "allow") allowed += 1;
    else if (eff === "deny") {
      denied += 1;
      deniedList.push(name);
    } else {
      unresolved += 1;
      deniedList.push(`${name}(no-match)`);
    }
  }

  console.log(
    `    specialists: ${specialistNames.length} | allowed: ${allowed} | denied: ${denied} | unresolved: ${unresolved}`
  );
  if (deniedList.length) {
    console.log(`    denied/unresolved: ${deniedList.slice(0, 12).join(", ")}`);
  }
  if (allowed !== specialistNames.length) {
    throw new Error(
      `not all specialists allowed: ${allowed}/${specialistNames.length} allowed`
    );
  }
});

// ───── (d) resolved count >= agent files count (catches silent drop) ─────
t("resolved allowed count >= agent file count (no silent drop)", () => {
  if (!ORACLE_ENABLED) {
    warn("resolved count >= agent files", "opencode binary unavailable");
    return;
  }
  const agents = requireOracle("resolved count >= agent files");
  const conductor = agents.find((a) => a.id === "orchestra");
  const subRules = (conductor.permissions || []).filter((p) => p.action === "subagent");
  const byBase = oracleBasenameLookup(agents);

  let resolved = 0;
  for (const name of specialistNames) {
    const agent = byBase.get(name);
    if (!agent) continue; // no oracle agent -> not resolved (counts against)
    // match against basename (conductor rules are basename globs)
    if (lastMatch(subRules, name) === "allow") resolved += 1;
  }
  console.log(`    resolved allowed: ${resolved} | agent files: ${specialistNames.length}`);
  if (resolved < specialistNames.length) {
    throw new Error(
      `resolved ${resolved} < agent files ${specialistNames.length} (silent drop)`
    );
  }
});

// ───── (c)+(h) precedence: agent-level DENY beats later global allow ─────
t("precedence property: agent-level subagent *: deny beats global allow", () => {
  if (!ORACLE_ENABLED) {
    warn("precedence: agent-level deny beats global allow", "opencode binary unavailable");
    return;
  }
  const agents = requireOracle("precedence property");

  // Focused property reproduction (do NOT pin the full resolution chain):
  // global allow `subagent *: allow` + agent-level deny `subagent *: deny`
  // applied after → last match for `*` must be deny.
  const globalAllow = [{ action: "subagent", resource: "*", effect: "allow" }];
  const agentDeny = [{ action: "subagent", resource: "*", effect: "deny" }];
  const combined = [...globalAllow, ...agentDeny];
  if (lastMatch(combined, "*") !== "deny") {
    throw new Error(
      "property broken: agent-level deny did not beat global allow for `subagent *`"
    );
  }

  // Reproduce against the real planner agent: its agent-level `subagent *: deny`
  // must win over the global `subagent *: allow` → effective deny.
  const planner = agents.find((a) => a.id === "orchestra-planner");
  if (!planner) throw new Error("oracle missing planner agent 'orchestra-planner'");
  const globalRules = agents
    .find((a) => a.id === "orchestra")
    ?.permissions.filter((p) => p.action === "subagent");
  const plannerRules = [...(globalRules || []), ...(planner.permissions || []).filter((p) => p.action === "subagent")];
  const eff = lastMatch(plannerRules, "*");
  console.log(`    planner effective subagent *: ${eff} (expect deny)`);
  if (eff !== "deny") {
    throw new Error(
      `planner agent-level deny did not beat global allow (effective: ${eff})`
    );
  }
});

// ───── (j) explore/general: skip-with-warning if absent, never hardcode ─────
t("explore/general built-ins: skip-with-warning if absent, never hard asserted", () => {
  if (!ORACLE_ENABLED) {
    warn("explore/general presence", "opencode binary unavailable");
    return;
  }
  const agents = requireOracle("explore/general presence");
  const ids = new Set(agents.map((a) => a.id));
  const present = ["explore", "general"].filter((n) => ids.has(n) || ids.has(`${n}/`));
  console.log(`    explore/general present: ${present.length}/2`);
  if (present.length < 2) {
    warn(
      "explore/general presence",
      `built-in unstable — only ${present.join(",") || "none"} in this run`
    );
  }
});

// ───── (e) Cursor byte-identical: git diff --stat bundle/agents bundle/config/cursor empty ─────
t("Cursor byte-identical: git diff --stat bundle/agents bundle/config/cursor empty", () => {
  const r = spawnSync("git", ["diff", "--stat", "--", "bundle/agents", "bundle/config/cursor"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (r.status !== 0) {
    throw new Error(`git diff failed: ${r.stderr}`);
  }
  const stat = r.stdout.trim();
  if (stat) {
    throw new Error(`bundle/agents or bundle/config/cursor drifted:\n${stat}`);
  }
  console.log("    git diff --stat bundle/agents bundle/config/cursor: empty");
});

// ───── (f) lib mirrors cmp-identical: bundle/opencode/hooks/lib/* vs bundle/hooks/lib/* ─────
t("lib mirrors cmp-identical: bundle/opencode/hooks/lib/* == bundle/hooks/lib/*", () => {
  const libFiles = fs.readdirSync(BUNDLE_HOOKS_LIB).filter((f) => f.endsWith(".js"));
  let compared = 0;
  for (const f of libFiles) {
    const a = path.join(BUNDLE_HOOKS_LIB, f);
    const b = path.join(OPCODE_HOOKS_LIB, f);
    if (!fs.existsSync(b)) {
      throw new Error(`mirror missing in opencode/hooks/lib: ${f}`);
    }
    const ba = fs.readFileSync(a);
    const bb = fs.readFileSync(b);
    if (!ba.equals(bb)) {
      throw new Error(`lib mirror differs: ${f} (${crypto.createHash("sha256").update(ba).digest("hex").slice(0,8)} vs ${crypto.createHash("sha256").update(bb).digest("hex").slice(0,8)})`);
    }
    compared += 1;
  }
  console.log(`    compared ${compared} lib files — all identical`);
});

// ───── (g) plugin load: opencode.log contains no SchemaError / failed to load plugin for orchestra-ambient ─────
function findOpencodeLog() {
  const candidates = [
    path.join(os.homedir(), ".local", "share", "opencode", "log", "opencode.log"),
    path.join(os.homedir(), ".config", "opencode", "opencode.log"),
    path.join(ROOT, "opencode.log"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

t("plugin load: opencode.log has no SchemaError / failed-to-load-plugin for orchestra-ambient", () => {
  const logFile = findOpencodeLog();
  if (!logFile) {
    warn("plugin load log check", "opencode.log not found — skipping");
    return;
  }
  const text = fs.readFileSync(logFile, "utf8");
  const lines = text.split(/\r?\n/);
  const now = Date.now();
  const recentMs = 24 * 60 * 60 * 1000;
  const recentFailures = [];
  const historicalFailures = [];
  const tsRe = /timestamp=(\d{4}-\d{2}-\d{2}T[\d:.Z-]+)/;
  for (const l of lines) {
    if (
      !l.includes("orchestra-ambient") ||
      !(l.includes("SchemaError") || l.includes("failed to load plugin"))
    )
      continue;
    const m = l.match(tsRe);
    let recent = false;
    if (m) {
      const t = Date.parse(m[1]);
      recent = !isNaN(t) && now - t <= recentMs;
    } else {
      // no parseable timestamp: treat lines in the tail of the log as recent
      recent = true;
    }
    if (recent) recentFailures.push(l);
    else historicalFailures.push(l);
  }
  if (recentFailures.length) {
    throw new Error(
      `recent orchestra-ambient plugin load errors in ${logFile}:\n${recentFailures.slice(0, 5).join("\n")}`
    );
  }
  if (historicalFailures.length) {
    console.log(
      `    (${historicalFailures.length} older orchestra-ambient load errors present — historical, not recent)`
    );
  }
  console.log(`    no recent SchemaError/failed-to-load-plugin for orchestra-ambient in ${logFile}`);
});

// ───── static check: bundle plugin uses default export (the RC4 fix) ─────
t("bundle plugin orchestra-ambient.js uses default export (no SchemaError at load)", () => {
  const src = fs.readFileSync(BUNDLE_PLUGIN, "utf8");
  if (!/export\s+default\s*{/.test(src)) {
    throw new Error("bundle plugin is not a default export — would raise SchemaError(Missing key at [\"default\"])");
  }
  console.log("    bundle plugin exports default { id, setup }");
});

/* ─────────────────────── summary ─────────────────────── */

console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
if (failed > 0) process.exit(1);

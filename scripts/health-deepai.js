#!/usr/bin/env node
"use strict";

/**
 * DeepAI Code installation health check.
 * Usage: node scripts/health-deepai.js [--home DIR] [--json]
 * Env:   PCORE_STATE_DIR
 * Exits 1 when a required piece is missing; warnings never fail.
 *
 * DeepAI Code is not a hook host and has no agent-definition directory: it
 * resolves models/agents from its own provider catalog and delegates through
 * app-owned subagents. So "installed" here means the surfaces it actually
 * reads are present and consistent — not files copied into a home dir.
 *
 * Checks:
 *   1. orchestra-loop skill reachable through shared discovery (~/.agents/skills)
 *   2. project entry points the conductor reads in place (AGENTS.md, context/)
 *   3. shared orchestra state readable + writable
 *   4. spawn matrix knows the deepai host
 *   5. lazy catalogs from the context diet exist (so hidden things are findable)
 *   6. request-budget ledger is usable (the per-day quota guard)
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const HOME = process.env.HOME || os.homedir();
const ROOT = path.join(__dirname, "..");

function parseArgs(argv) {
  const i = argv.indexOf("--home");
  const repoRoot = i !== -1 ? argv[i + 1] : ROOT;
  if (i !== -1 && !argv[i + 1]) {
    console.error("--home requires a directory");
    process.exit(2);
  }
  return { repoRoot: repoRoot || ROOT, json: argv.includes("--json") };
}

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function check(rows, name, ok, detail, level = "required") {
  rows.push({ name, ok: Boolean(ok), level, detail: detail || "" });
  return Boolean(ok);
}

function main() {
  const { repoRoot, json } = parseArgs(process.argv.slice(2));
  const rows = [];
  let failed = false;

  // 1. shared skill discovery
  const skillDir = path.join(HOME, ".agents", "skills", "orchestra-loop");
  const skillMd = path.join(skillDir, "SKILL.md");
  if (!check(rows, "orchestra-loop skill discoverable", exists(skillMd), skillMd.replace(HOME, "~"))) failed = true;
  const intake = path.join(HOME, ".agents", "skills", "prompt-intake", "SKILL.md");
  check(rows, "prompt-intake skill discoverable", exists(intake), intake.replace(HOME, "~"), "warn");
  const verify = path.join(HOME, ".agents", "skills", "verification-before-completion", "SKILL.md");
  check(rows, "verification-before-completion skill discoverable", exists(verify), verify.replace(HOME, "~"), "warn");

  // 2. in-place project surfaces (DeepAI reads the repo, it has no copy step)
  check(rows, "AGENTS.md present", exists(path.join(repoRoot, "AGENTS.md")), path.join(repoRoot, "AGENTS.md"), "warn");
  check(rows, "context/ six-file present", exists(path.join(repoRoot, "context", "progress-tracker.md")), path.join(repoRoot, "context"), "warn");

  // 3. shared state readable + writable
  const stateCandidates = [
    process.env.PCORE_STATE_DIR,
    path.join(HOME, ".cursor", "hooks", "state"),
    path.join(HOME, ".config", "opencode", "hooks", "state"),
  ].filter(Boolean);
  const writable = stateCandidates.find((d) => {
    try {
      fs.mkdirSync(d, { recursive: true });
      const probe = path.join(d, ".pcore-deepai-probe");
      fs.writeFileSync(probe, "x");
      fs.rmSync(probe, { force: true });
      return true;
    } catch {
      return false;
    }
  });
  if (!check(rows, "shared orchestra state writable", Boolean(writable), (writable || "none of: " + stateCandidates.join(", ")).replace(HOME, "~"))) failed = true;
  const stateFile = writable && path.join(writable, "orchestra.json");
  if (stateFile && exists(stateFile)) {
    let parsed = null;
    try {
      parsed = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    } catch {}
    check(rows, "orchestra.json parses", Boolean(parsed), stateFile.replace(HOME, "~"));
  }

  // 4. the matrix must know this host
  let matrix = null;
  try {
    matrix = require(path.join(ROOT, "bundle", "hooks", "lib", "orchestra-spawn-matrix.js"));
  } catch {}
  const knows = Boolean(matrix && matrix.PLATFORMS && matrix.PLATFORMS.deepai);
  if (!check(rows, "spawn matrix registers deepai host", knows, knows ? matrix.PLATFORMS.deepai.spawnTool : "PLATFORMS.deepai missing")) failed = true;
  check(rows, "spawn matrix has no-ambient flag", Boolean(knows && matrix.PLATFORMS.deepai.noAmbient), "DeepAI has no hook/ambient surface to lean on", "warn");

  // 5. lazy catalogs (hidden things must still be findable)
  const lazy = path.join(HOME, ".config", "opencode", "lazy");
  check(rows, "lazy agent index exists", exists(path.join(lazy, "agent-index.md")), path.join(lazy, "agent-index.md"), "warn");
  check(rows, "lazy skill catalog exists", exists(path.join(lazy, "skill-index.json")), path.join(lazy, "skill-index.json"), "warn");

  // 6. request budget usable
  let rb = null;
  try {
    rb = require(path.join(ROOT, "bundle", "hooks", "lib", "request-budget.js"));
  } catch {}
  check(rows, "request-budget lib loads", Boolean(rb), rb ? `account cap ${rb.FREE_POOL_DAILY_ACCOUNT_CAP} calls/day` : "missing", "warn");

  const required = rows.filter((r) => r.level === "required");
  const warns = rows.filter((r) => r.level === "warn" && !r.ok);

  if (json) {
    console.log(JSON.stringify({ rows, failed, warnings: warns.length }, null, 2));
  } else {
    console.log("=== DeepAI Code health ===");
    for (const r of rows) {
      const mark = r.ok ? "OK  " : r.level === "warn" ? "WARN" : "FAIL";
      console.log(`${mark} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
    }
    console.log("");
    console.log(`${required.filter((r) => r.ok).length}/${required.length} required checks passed` + (warns.length ? `, ${warns.length} warning(s)` : ""));
    if (failed) {
      console.log("Next: bash install.sh --dry-run   then   bash install.sh --all");
      console.log("Note: DeepAI Code needs no agent copies — if the skill is missing,");
      console.log("      the shared discovery root (~/.agents/skills) was not populated.");
    }
  }
  process.exit(failed ? 1 : 0);
}

main();

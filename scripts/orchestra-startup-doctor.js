#!/usr/bin/env node
"use strict";

/**
 * Orchestra startup doctor — why loading a coding-agent host feels heavy.
 *
 * "Slow to start" on these harnesses is almost never CPU. It is the sum of:
 *   1. process boot + config parse (small, ms)
 *   2. cold I/O over the state dir (a 700 MB session DB is opened per start)
 *   3. filesystem watchers (each watched dir costs an inotify instance/watch;
 *      when `max_user_instances` is exhausted the host logs "failed to subscribe"
 *      and retries, which shows up as a sluggish first turn)
 *   4. prompt index weight (agents + skills inlined into EVERY request)
 *   5. network checks at start (models.dev fetch, update check)
 *
 * `scripts/diagnose-opencode.sh` covers hangs/stale processes; this covers
 * weight. Report is read-only; `--repair` performs only the actions marked
 * SAFE below and never deletes user work (worktrees are reported, not touched).
 *
 * Usage:
 *   node scripts/orchestra-startup-doctor.js
 *   node scripts/orchestra-startup-doctor.js --json
 *   node scripts/orchestra-startup-doctor.js --repair
 */

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const cb = require("./lib/context-budget.js");

const HOME = process.env.HOME || "";
const DATA = process.env.XDG_DATA_HOME || path.join(HOME, ".local/share");
const CONFIG = cb.opencodeConfigDir();

const WEIGHTY = [
  { host: "opencode", path: path.join(DATA, "opencode", "opencode.db"), kind: "session DB", softMB: 150, note: "opened on every start; compaction + session history live here" },
  { host: "opencode", path: path.join(DATA, "opencode", "opencode.db-wal"), kind: "WAL", softMB: 32, note: "un-checkpointed writes; grows when the app is killed" },
  { host: "opencode", path: path.join(DATA, "opencode", "storage"), kind: "legacy storage", softMB: 200, note: "pre-sqlite session blobs; not read by V2" },
  { host: "opencode", path: path.join(DATA, "opencode", "worktree"), kind: "git worktrees", softMB: 2000, note: "REAL WORK — never auto-delete, archive manually", neverTouch: true },
  { host: "opencode", path: path.join(DATA, "opencode", "log"), kind: "logs", softMB: 20, note: "rotated only on restart; safe to trim" },
  { host: "opencode", path: path.join(DATA, "opencode", "bin"), kind: "downloaded LSP/tools", softMB: 250, note: "re-fetchable; safe to clear if disk is tight" },
  { host: "opencode", path: path.join(DATA, "opencode", "tool-output"), kind: "truncated tool output", softMB: 60, note: "referenced by old sessions; >7d is dead weight" },
  { host: "opencode", path: path.join(CONFIG, "node_modules"), kind: "plugin deps", softMB: 90, note: "bun install target for @opencode-ai/plugin" },
  { host: "cursor", path: path.join(HOME, ".cursor", "hooks", "state"), kind: "hook state", softMB: 40, note: "orchestra state + mirrors" },
  { host: "qoder", path: path.join(HOME, ".qoder", "hooks", "state"), kind: "hook state", softMB: 40, note: "shared cursor hook state surface" },
  { host: "claude", path: path.join(HOME, ".claude"), kind: "claude home", softMB: 400, note: "skills + projects + todos" },
  { host: "codex", path: path.join(HOME, ".codex"), kind: "codex home", softMB: 200, note: "sessions + agents + skills" },
];

function mb(n) {
  return n / 1048576;
}

function dirSize(p, budget = 40000) {
  let total = 0;
  let files = 0;
  let stack = [p];
  try {
    if (!fs.lstatSync(p).isDirectory()) return { bytes: fs.statSync(p).size, files: 1 };
  } catch {
    return { bytes: 0, files: 0 };
  }
  while (stack.length && files < budget) {
    const d = stack.pop();
    let ents;
    try {
      ents = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of ents) {
      const full = path.join(d, e.name);
      if (e.isDirectory() && !e.isSymbolicLink()) stack.push(full);
      else {
        try {
          total += fs.statSync(full).size;
          files++;
        } catch {}
      }
    }
  }
  return { bytes: total, files };
}

function inotify() {
  const read = (p) => {
    try {
      return Number.parseInt(fs.readFileSync(p, "utf8").trim(), 10);
    } catch {
      return null;
    }
  };
  const instances = read("/proc/sys/fs/inotify/max_user_instances");
  const watches = read("/proc/sys/fs/inotify/max_user_watches");
  let used = null;
  try {
    const out = execFileSync("sh", ["-c", "ls /proc/*/fd 2>/dev/null | wc -l"], { encoding: "utf8" });
    used = null; // exact inotify fd count needs root; skip guessing
  } catch {}
  return { instances, watches, used };
}

function countBackups(dir) {
  let list = [];
  try {
    list = fs.readdirSync(dir).filter((f) => /\.bak(\.|$)/.test(f));
  } catch {}
  return list;
}

/**
 * Read-only findings.
 * @returns {{rows:Array, summary:object}}
 */
function inspect() {
  const rows = [];

  // 1. process boot + config parse
  let bootMs = null;
  const t0 = process.hrtime.bigint();
  try {
    spawnSync("opencode", ["--version"], { encoding: "utf8", timeout: 30000 });
    bootMs = Number(process.hrtime.bigint() - t0) / 1e6;
  } catch {}
  rows.push({
    id: "boot",
    title: "opencode --version wall time",
    value: bootMs === null ? "opencode not on PATH" : `${bootMs.toFixed(0)} ms`,
    level: bootMs === null ? "warn" : bootMs > 2500 ? "bad" : "ok",
    advice: "Process boot is not the bottleneck; weight is in state I/O and the prompt index.",
  });

  // 2. state-dir weight
  for (const w of WEIGHTY) {
    const st = fs.existsSync(w.path) ? dirSize(w.path) : { bytes: 0, files: 0 };
    const m = mb(st.bytes);
    rows.push({
      id: `weight:${w.path}`,
      title: `${w.host} ${w.kind}`,
      value: `${m.toFixed(1)} MB (${st.files} files) ${w.path.replace(HOME, "~")}`,
      level: m > w.softMB ? (w.neverTouch ? "warn" : "bad") : "ok",
      advice: w.note,
      neverTouch: Boolean(w.neverTouch),
      path: w.path,
      bytes: st.bytes,
    });
  }

  // 3. watchers
  const ino = inotify();
  const watched = [path.join(CONFIG, "skills"), path.join(HOME, ".agents", "skills"), path.join(HOME, ".claude", "skills")].map((d) => {
    let dirs = 0;
    try {
      dirs = dirSize(d, 40000).files;
    } catch {}
    return { d, files: dirs };
  });
  const totalFiles = watched.reduce((s, w) => s + w.files, 0);
  rows.push({
    id: "inotify",
    title: "inotify limits",
    value: `max_user_instances=${ino.instances ?? "?"} max_user_watches=${ino.watches ?? "?"}`,
    level: ino.instances !== null && ino.instances <= 128 ? "warn" : "ok",
    advice:
      ino.instances !== null && ino.instances <= 128
        ? "128 instances is tight for 4 hosts of watchers; raise to 512: echo 'fs.inotify.max_user_instances=512' | sudo tee /etc/sysctl.d/99-inotify.conf && sudo sysctl --system. Watch failures show up as slow first turns, not errors."
        : "headroom looks fine",
  });
  rows.push({
    id: "watched-files",
    title: "files under skill roots (watched)",
    value: `${totalFiles} files across ${watched.map((w) => path.basename(path.dirname(w.d)) || w.d).join(", ")}`,
    level: totalFiles > 4000 ? "bad" : totalFiles > 1500 ? "warn" : "ok",
    advice: "Skill payload files are watched even when the skill is never used. Unindexing unused skills shrinks this directly.",
  });

  // 4. prompt index weight
  const idx = cb.fullIndexReport({ configDir: CONFIG });
  rows.push({
    id: "index-agents",
    title: "agent index (inlined into every request)",
    value: `${idx.agents.entries} visible -> ${idx.agents.tokens} tok/request`,
    level: idx.agents.tokens > 2000 ? "bad" : idx.agents.tokens > 500 ? "warn" : "ok",
    advice: "fix: node scripts/orchestra-context-diet.js --apply (hidden agents stay spawnable by id)",
  });
  rows.push({
    id: "index-skills",
    title: "skill index",
    value: `${idx.skills.entries} rows -> ${idx.skills.tokens} tok/request (${idx.skills.denied} not in the orchestra allowlist)`,
    level: idx.skills.tokens > 8000 ? "bad" : idx.skills.tokens > 2000 ? "warn" : "ok",
    advice: "orchestra-owned ones are handled by the diet; foreign skills are yours to uninstall or trim.",
  });
  rows.push({
    id: "index-total",
    title: "fixed index cost per request",
    value: `${idx.totalTokens} tok/request`,
    level: idx.totalTokens > 12000 ? "bad" : idx.totalTokens > 4000 ? "warn" : "ok",
    advice: `at ~7.5K calls/day that is ~${Math.round((idx.totalTokens * 7500) / 1e6)}M tokens/day of pure index`,
  });

  // 5. config clutter
  const baks = countBackups(CONFIG);
  const bakBytes = baks.reduce((s, f) => {
    try {
      return s + fs.statSync(path.join(CONFIG, f)).size;
    } catch {
      return s;
    }
  }, 0);
  rows.push({
    id: "config-backups",
    title: "opencode.json backups",
    value: `${baks.length} files, ${mb(bakBytes).toFixed(1)} MB`,
    level: baks.length > 10 ? "warn" : "ok",
    advice: "each merge writes one; only the newest are ever needed. --repair keeps the 3 most recent",
  });

  // 6. startup network checks
  const cfg = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(CONFIG, "opencode.json"), "utf8"));
    } catch {
      return null;
    }
  })();
  rows.push({
    id: "net-checks",
    title: "startup network checks",
    value: cfg ? `update=${cfg.update ?? "unset"} warming=${cfg.warming === undefined ? "unset(default false)" : cfg.warming}` : "no config",
    level: cfg && cfg.update === "disable" && cfg.warming !== true ? "ok" : "warn",
    advice: "update must be 'disable' and warming false; models.dev timeouts and warm requests both land on start latency and quota.",
  });

  // 7. quota reality
  const rb = require("../bundle/hooks/lib/request-budget.js");
  const dbPath = path.join(DATA, "opencode", "opencode.db");
  let today = null;
  try {
    today = require("./orchestra-budget.js").countOpenCodeCalls({ db: dbPath });
  } catch {}
  rows.push({
    id: "quota-today",
    title: "free-pool calls counted today (opencode.db)",
    value: today ? `${today.total} across ${Object.keys(today.byPool).length} pools (account cap ${rb.FREE_POOL_DAILY_ACCOUNT_CAP})` : "not measurable on this host",
    level: !today ? "warn" : today.total >= rb.FREE_POOL_DAILY_ACCOUNT_CAP ? "bad" : today.total >= rb.FREE_POOL_DAILY_ACCOUNT_CAP * rb.WARN_RATIO ? "warn" : "ok",
    advice: "free pools are limited per DAY BY REQUEST. node scripts/orchestra-budget.js sync-opencode to latch + steer.",
  });

  const summary = {
    bad: rows.filter((r) => r.level === "bad").length,
    warn: rows.filter((r) => r.level === "warn").length,
    ok: rows.filter((r) => r.level === "ok").length,
    indexTokens: idx.totalTokens,
    diskMB: Math.round(rows.filter((r) => r.id.startsWith("weight:")).reduce((s, r) => s + r.bytes, 0) / 1048576),
  };
  return { rows, summary };
}

/**
 * SAFE repairs only: prune old config backups, vacuum sqlite, trim logs and
 * stale tool-output. Never touches worktrees, sessions, or skills.
 * @param {{keepBackups?:number, logDays?:number, toolOutputDays?:number, dryRun?:boolean, log?:(s:string)=>void}} [opts]
 */
function repair(opts = {}) {
  const log = opts.log || (() => {});
  const dry = Boolean(opts.dryRun);
  const done = [];

  // config backups: keep the newest N
  const baks = countBackups(CONFIG)
    .map((f) => ({ f, t: fs.statSync(path.join(CONFIG, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  const keep = Number.isFinite(opts.keepBackups) ? opts.keepBackups : 3;
  for (const b of baks.slice(keep)) {
    const p = path.join(CONFIG, b.f);
    if (dry) log(`would remove ${p}`);
    else fs.rmSync(p, { force: true });
    done.push(`backup:${b.f}`);
  }
  if (baks.length > keep) log(`config backups: ${baks.length} -> ${keep} kept${dry ? " (dry)" : ""}`);

  // sqlite vacuum/analyze (safe: same logical content, smaller file, better read plan)
  const db = path.join(DATA, "opencode", "opencode.db");
  if (!dry && fs.existsSync(db)) {
    const before = mb(fs.statSync(db).size);
    try {
      spawnSync("sqlite3", [db, "PRAGMA wal_checkpoint(TRUNCATE);", "VACUUM;", "ANALYZE;"], { timeout: 180000, stdio: "ignore" });
      const after = mb(fs.statSync(db).size);
      log(`sqlite: ${before.toFixed(0)} MB -> ${after.toFixed(0)} MB (freed ${(before - after).toFixed(0)} MB)`);
      done.push("sqlite-vacuum");
    } catch (e) {
      log(`sqlite vacuum skipped: ${e.message}`);
    }
  } else if (dry && fs.existsSync(db)) log(`would VACUUM+ANALYZE ${db}`);

  // logs + tool-output older than N days
  const pruneOlder = (dir, days, label) => {
    let cutoff = Date.now() - days * 86400000;
    let removed = 0;
    let bytes = 0;
    let ents = [];
    try {
      ents = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const name of ents) {
      const p = path.join(dir, name);
      let st;
      try {
        st = fs.statSync(p);
      } catch {
        continue;
      }
      if (st.mtimeMs >= cutoff) continue;
      bytes += st.size;
      if (!dry) fs.rmSync(p, { recursive: true, force: true });
      removed++;
    }
    if (removed) log(`${label}: ${removed} file(s) older than ${days}d = ${mb(bytes).toFixed(0)} MB${dry ? " (dry)" : ""}`);
    if (removed) done.push(`${label}-pruned:${removed}`);
  };
  pruneOlder(path.join(DATA, "opencode", "log"), opts.logDays ?? 3, "logs");
  pruneOlder(path.join(DATA, "opencode", "tool-output"), opts.toolOutputDays ?? 7, "tool-output");

  return { done, dry };
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(fs.readFileSync(__filename, "utf8").split("*/")[0].split("/**")[1]);
    return;
  }

  if (argv.includes("--repair")) {
    console.log("=== safe repairs ===");
    repair({ dryRun: argv.includes("--dry-run"), log: (s) => console.log(`  ${s}`) });
    console.log("");
  }

  // Inspect AFTER any repair so the report reflects what is on disk now.
  const { rows, summary } = inspect();

  if (argv.includes("--json")) {
    console.log(JSON.stringify({ rows, summary }, null, 2));
  } else {
    console.log("=== host startup weight ===");
    for (const r of rows) {
      const mark = r.level === "bad" ? "BAD " : r.level === "warn" ? "WARN" : "ok  ";
      console.log(`${mark} ${r.title}`);
      console.log(`     ${r.value}`);
      if (r.level !== "ok") console.log(`     -> ${r.advice}`);
    }
    console.log("");
    console.log(`summary: ${summary.bad} bad, ${summary.warn} warn, ${summary.ok} ok | ${summary.diskMB} MB state data | ${summary.indexTokens} tok fixed index/request`);
    console.log("for hangs / stale processes: bash scripts/diagnose-opencode.sh");
    console.log("for the prompt index: node scripts/orchestra-context-diet.js --apply");
  }
  process.exit(summary.bad > 0 && !argv.includes("--repair") ? 1 : 0);
}

if (require.main === module) main();

module.exports = { inspect, repair, dirSize, WEIGHTY };

#!/usr/bin/env node
"use strict";

/**
 * Orchestra request-budget CLI — the per-DAY REQUEST meter for free model pools.
 *
 * Free OpenCode pools reject with `free-models-per-day-*`, which counts
 * requests, not tokens. This CLI is how the conductor and the hooks know
 * whether another model call is worth making.
 *
 * Usage:
 *   node scripts/orchestra-budget.js status [--pool P] [--json]
 *   node scripts/orchestra-budget.js charge [--n N] [--pool P] [--session S]
 *   node scripts/orchestra-budget.js observe [--message M] [--pool P]
 *   node scripts/orchestra-budget.js check --agent A --task "..." [--files a,b]
 *   node scripts/orchestra-budget.js sync-opencode [--db PATH]
 *
 * `sync-opencode` is the accurate source on OpenCode hosts: it counts real
 * assistant calls for today straight out of opencode.db instead of trusting
 * spawn bookkeeping. Other hosts fall back to charge-per-spawn.
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const rb = require("../bundle/hooks/lib/request-budget.js");

const DEFAULT_DB = path.join(process.env.XDG_DATA_HOME || path.join(process.env.HOME || "", ".local/share"), "opencode", "opencode.db");

function flag(argv, name, dflt) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return dflt;
  return argv[i + 1] !== undefined && !argv[i + 1].startsWith("--") ? argv[i + 1] : true;
}

function parseDate(v) {
  if (!v || v === true) return new Date();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

/**
 * Count assistant messages per model for one UTC day, straight from the
 * OpenCode store. Returns null when sqlite or the DB is unavailable.
 * @param {{db?:string, at?:Date}} [opts]
 * @returns {{byPool:Record<string,number>, total:number, day:string}|null}
 */
function countOpenCodeCalls(opts = {}) {
  const db = opts.db || DEFAULT_DB;
  const at = opts.at || new Date();
  if (!fs.existsSync(db)) return null;
  const day = rb.dayKey(at);
  // Whole UTC day boundaries in epoch milliseconds.
  const start = Date.parse(`${day}T00:00:00.000Z`);
  const end = start + 86400000;
  const sql =
    `select json_extract(data,'$.model.providerID')||'/'||lower(json_extract(data,'$.model.id')) pool,` +
    `count(*) n from session_message where type='assistant' ` +
    `and time_created>=${start} and time_created<${end} group by pool;`;
  let out;
  try {
    out = spawnSync("sqlite3", ["-noheader", "-separator", "|", db, sql], { encoding: "utf8", timeout: 20000 });
  } catch {
    return null;
  }
  if (!out || out.status !== 0 || !out.stdout) return null;
  const byPool = {};
  let total = 0;
  for (const line of out.stdout.split("\n")) {
    const idx = line.lastIndexOf("|");
    if (idx < 0) continue;
    const pool = line.slice(0, idx).trim();
    const n = Number.parseInt(line.slice(idx + 1), 10);
    if (!pool || !Number.isFinite(n)) continue;
    byPool[pool] = n;
    total += n;
  }
  return { byPool, total, day };
}

/**
 * Write observed counts into the ledger so hooks and the conductor agree.
 * @param {{db?:string, at?:Date, dir?:string}} [opts]
 */
function syncOpenCode(opts = {}) {
  const at = opts.at || new Date();
  const counted = countOpenCodeCalls({ db: opts.db, at });
  if (!counted) return { ok: false, reason: "opencode.db or sqlite3 unavailable" };
  let led = rb.readLedger(opts.dir, at);
  // Replace counts with ground truth (do not add on top of spawn bookkeeping).
  for (const [pool, n] of Object.entries(counted.byPool)) {
    led = rb.chargeCall(led, { pool, n: Math.max(0, n - ((led.pools[pool] && led.pools[pool].calls) || 0)), at });
  }
  rb.saveLedger(opts.dir, led);
  return { ok: true, day: counted.day, total: counted.total, byPool: counted.byPool };
}

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0] && !argv[0].startsWith("--") ? argv[0] : "status";
  const json = argv.includes("--json");
  const at = parseDate(flag(argv, "at", null));
  const dir = flag(argv, "dir", undefined);
  const poolArg = flag(argv, "pool", null);
  const pool = poolArg && poolArg !== true ? poolArg : undefined;

  if (cmd === "charge") {
    const n = Number.parseInt(flag(argv, "n", "1"), 10) || 1;
    const st = rb.charge({ dir, pool, model: pool, n, at });
    if (json) return console.log(JSON.stringify(st));
    console.log(`${st.pool}: ${st.used}/${st.cap} today (${st.state})`);
    const line = rb.formatBudgetLine(st);
    if (line) console.log(line);
    return;
  }

  if (cmd === "observe") {
    const message = flag(argv, "message", "") || "";
    const res = rb.observe({ dir, pool, model: pool, message, at });
    if (json) return console.log(JSON.stringify(res));
    console.log(res.latched ? `LATCHED ${res.status.pool} for the rest of ${rb.dayKey(at)}` : `not a quota-day error; pool ${res.status.pool} stays open (${res.status.state})`);
    const line = rb.formatBudgetLine(res.status);
    if (line) console.log(line);
    return process.exit(res.latched ? 2 : 0);
  }

  if (cmd === "check") {
    const agent = flag(argv, "agent", "") || "";
    const task = flag(argv, "task", "") || "";
    const files = String(flag(argv, "files", "") || "").split(",").map((s) => s.trim()).filter(Boolean);
    const sig = rb.workSignature({ agent, task, files });
    const peekOnly = flag(argv, "peek", false);
    let led = rb.readLedger(dir, at);
    // Recording by default: asking "should I dispatch this?" from the conductor
    // means the dispatch is happening, and only a recorded dispatch can later
    // be recognized as the repeat that it is.
    const rec = peekOnly
      ? { ledger: led, ...rb.peekAttempt(led, { sig, at }) }
      : (() => { const r = rb.recordAttempt(led, { sig, at }); return { ledger: r.ledger, seen: r.seen, duplicate: r.duplicate }; })();
    led = rec.ledger;
    rb.saveLedger(dir, led);
    const st = rb.worstStatus(led, { at });
    if (json) return console.log(JSON.stringify({ sig, seen: rec.seen, duplicate: rec.duplicate, budget: st }));
    console.log(`signature ${sig} seen ${rec.seen}x today${rec.duplicate ? " — DUPLICATE work, do not re-spawn" : ""}`);
    const line = rb.formatBudgetLine(st);
    if (line) console.log(line);
    return process.exit(rec.duplicate ? 2 : 0);
  }

  if (cmd === "sync-opencode") {
    const res = syncOpenCode({ db: flag(argv, "db", undefined) || undefined, at, dir });
    if (json) return console.log(JSON.stringify(res));
    if (!res.ok) {
      console.log(`skip: ${res.reason}`);
      return process.exit(0);
    }
    console.log(`${res.day}: ${res.total} assistant calls counted from opencode.db`);
    for (const [p, n] of Object.entries(res.byPool).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
      const s = rb.status(rb.readLedger(dir, at), { pool: p, at });
      console.log(`  ${n.toString().padStart(6)} ${p}${s.free ? "  [free]" : ""} -> ${s.state}`);
    }
    return;
  }

  // status (default)
  let led = rb.readLedger(dir, at);
  if (flag(argv, "sync", false)) syncOpenCode({ db: flag(argv, "db", undefined) || undefined, at, dir }), (led = rb.readLedger(dir, at));
  const pools = Object.keys(led.pools);
  const rows = pools.map((p) => rb.status(led, { pool: p, at }));
  if (pool) rows.unshift(rb.status(led, { pool, at }));
  if (json) return console.log(JSON.stringify({ day: led.day, pools: rows, latched: Object.keys(led.latched) }));
  console.log(`request budget for ${led.day} (per-pool cap ${rb.FREE_POOL_DAILY_CALL_CAP}, account-wide free cap ${rb.FREE_POOL_DAILY_ACCOUNT_CAP}, warn at ${Math.round(rb.WARN_RATIO * 100)}%)`);
  if (!rows.length) console.log("  no calls recorded yet today");
  for (const r of rows) console.log(`  ${r.used.toString().padStart(6)}/${r.cap} ${r.state.padEnd(9)} ${r.pool}${r.free ? "  [free]" : ""}`);
  const acc = rb.freePoolTotal(led);
  console.log(`  ${acc.used.toString().padStart(6)}/${acc.cap} ${acc.state.padEnd(9)} FREE-POOL ACCOUNT TOTAL (${acc.pools.length} free pools)`);
  const line = rb.formatBudgetLine(rb.worstStatus(led));
  if (line) console.log(line);
}

if (require.main === module) main();

module.exports = { countOpenCodeCalls, syncOpenCode };

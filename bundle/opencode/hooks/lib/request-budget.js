#!/usr/bin/env node
"use strict";

/**
 * Request budget + duplicate-work guard.
 *
 * WHY THIS EXISTS (measured on a live host, 2026-11-17):
 *   - OpenCode free pools reject with `Rate limit exceeded:
 *     free-models-per-day-high-balance` and `Free usage limit reached.`
 *     That is a per-DAY REQUEST counter, not a token meter. So the dial that
 *     protects quota is the number of model calls, not prompt size.
 *   - Observed burn: 52,624 assistant calls in 7 days (~7.5K/day), and single
 *     persistent team sessions alone reached 3,859 and 1,968 calls. One
 *     runaway phase agent used to be allowed 200-500 steps.
 *   - 102 of 106 discovered skills were permission-DENIED yet still described
 *     in every request, and 182 agents sat unhidden in the prompt index:
 *     ~18.9K fixed tokens on every call, for capability that could not fire.
 *
 * WHAT THIS DOES:
 *   1. Counts model calls per UTC day per pool, with warn/exhausted tiers.
 *   2. Latches a pool for the rest of the day once a quota error is observed,
 *      so a stuck loop cannot spend 500 futile requests against a closed door.
 *   3. Signatures every dispatched task so the same work cannot be re-spawned
 *      over and over inside one day ("do X again and again" waste).
 *   4. Speaks only when it has something to say: `formatBudgetLine` returns an
 *      empty string while healthy, so the guard never adds per-turn boilerplate.
 *
 * Fail-open everywhere: a corrupted or unreadable ledger must never block a
 * real task. Budget is advisory at the hook edge and enforced where an agent
 * decides to spawn.
 *
 * Mirrored byte-identical into bundle/opencode/hooks/lib/ (invariant 18).
 */

const path = require("node:path");
const crypto = require("node:crypto");

const { readJsonSafe, writeJson, resolveStateDir } = require("./safe-write.js");

/** Default advisory ceiling of free-pool model calls per UTC day per scope. */
const FREE_POOL_DAILY_CALL_CAP = 600;
/**
 * Account-wide ceiling across ALL free pools. The rejection is
 * `free-models-per-day-high-balance`, which the account pays, not the model:
 * measured here as ~7.5K calls/day against a limit that then returned
 * "Free usage limit reached" 371 times. This aggregate is what actually binds.
 */
const FREE_POOL_DAILY_ACCOUNT_CAP = 1200;
/** Warn (and steer the conductor to batch) at this fraction of the cap. */
const WARN_RATIO = 0.7;

/** Substrings that mean "your per-day quota is gone", not "slow down". */
const QUOTA_DAY_MARKERS = [
  "free-models-per-day",
  "free usage limit reached",
  "per-day limit",
  "daily quota exceeded",
  "quota exhausted",
];

/** Substrings that mean a transient throttle — must NOT latch the day. */
const RATE_LIMIT_MARKERS = ["slow down", "rate limit exceeded: requests-per-minute", "429 too many requests"];

/** Ring cap so the ledger cannot grow without bound. */
const MAX_TRACKED_POOLS = 32;
const MAX_ATTEMPT_SIGNATURES = 400;

/**
 * @param {Date|number} [at]
 * @returns {string} UTC day key
 */
function dayKey(at) {
  const d = at instanceof Date ? at : new Date(typeof at === "number" ? at : Date.now());
  return d.toISOString().slice(0, 10);
}

/** @returns {{day:string, pools:object, attempts:object, latched:object}} */
function emptyLedger(at) {
  return { version: 1, day: dayKey(at), pools: {}, attempts: {}, latched: {} };
}

/**
 * Normalize a model reference to a pool key. Free pools get their own bucket so
 * one pool exhausting cannot mask another pool's remaining headroom.
 * @param {string|{id?:string,providerID?:string}|null} model
 * @returns {string}
 */
function poolKey(model) {
  if (!model) return "unknown";
  if (typeof model === "object") {
    const id = model.id || "unknown";
    const prov = model.providerID || "";
    return `${prov ? prov + "/" : ""}${String(id).toLowerCase()}`;
  }
  return String(model).toLowerCase();
}

/** @param {string} poolKeyArg @returns {boolean} */
function isFreePool(poolKeyArg) {
  return /(:free$|-free\b|\bfree-)/i.test(String(poolKeyArg)) || /\/free(\b|$)/i.test(String(poolKeyArg));
}

/**
 * True when an error message means the day's quota is spent.
 * @param {string|Error|null} err
 * @returns {boolean}
 */
function isQuotaDayError(err) {
  const msg = String(err && err.message ? err.message : err || "").toLowerCase();
  if (!msg) return false;
  if (RATE_LIMIT_MARKERS.some((m) => msg.includes(m.toLowerCase()))) return false;
  return QUOTA_DAY_MARKERS.some((m) => msg.includes(m.toLowerCase()));
}

/** Roll the ledger when the UTC day changes (pure). */
function forDay(ledger, at) {
  const day = dayKey(at);
  if (!ledger || ledger.day !== day) return emptyLedger(at);
  return ledger;
}

/**
 * Count one model call against a pool (pure — returns a new ledger).
 * @param {object} ledger
 * @param {{at?:Date|number, model?:any, pool?:string, n?:number, cost?:number}} opts
 * @returns {object} next ledger
 */
function chargeCall(ledger, opts = {}) {
  const next = JSON.parse(JSON.stringify(forDay(ledger, opts.at)));
  const key = opts.pool || poolKey(opts.model);
  const n = Number.isFinite(opts.n) ? opts.n : 1;
  const cur = next.pools[key] || { calls: 0, tokens: 0 };
  next.pools[key] = {
    calls: (cur.calls || 0) + n,
    tokens: (cur.tokens || 0) + (Number.isFinite(opts.tokens) ? opts.tokens : 0),
    cost: (cur.cost || 0) + (Number.isFinite(opts.cost) ? opts.cost : 0),
  };
  const keys = Object.keys(next.pools);
  if (keys.length > MAX_TRACKED_POOLS) {
    for (const k of keys.sort((a, b) => (next.pools[a].calls || 0) - (next.pools[b].calls || 0)).slice(0, keys.length - MAX_TRACKED_POOLS)) {
      delete next.pools[k];
    }
  }
  return next;
}

/**
 * Latch a pool for the remainder of the UTC day after a real quota rejection.
 * @param {object} ledger
 * @param {{at?:Date|number, model?:any, pool?:string, message?:string}} opts
 * @returns {object}
 */
function noteQuotaDay(ledger, opts = {}) {
  const next = JSON.parse(JSON.stringify(forDay(ledger, opts.at)));
  const key = opts.pool || poolKey(opts.model);
  next.latched[key] = {
    at: new Date(opts.at instanceof Date ? opts.at.getTime() : (typeof opts.at === "number" ? opts.at : Date.now())).toISOString(),
    reason: String(opts.message || "quota day").slice(0, 300),
  };
  return next;
}

/**
 * Sum of calls across every free pool today, plus the binding status.
 * Per-pool headroom is meaningless if the account bucket is what gets charged,
 * so the aggregate is folded into `status` as `account`.
 * @param {object} ledger
 * @param {{at?:Date|number, cap?:number}} [opts]
 * @returns {{used:number,cap:number,remaining:number,ratio:number,state:string,pools:string[]}}
 */
function freePoolTotal(ledger, opts = {}) {
  const l = forDay(ledger, opts.at);
  const cap = Number.isFinite(opts.cap) ? opts.cap : FREE_POOL_DAILY_ACCOUNT_CAP;
  const pools = Object.keys(l.pools).filter(isFreePool);
  const used = pools.reduce((s, p) => s + ((l.pools[p] && l.pools[p].calls) || 0), 0);
  const ratio = cap > 0 ? used / cap : 1;
  const anyLatched = pools.some((p) => l.latched[p]);
  let state = "ok";
  if (anyLatched) state = "latched";
  else if (used >= cap) state = "exhausted";
  else if (ratio >= WARN_RATIO) state = "warn";
  return { used, cap, remaining: Math.max(0, cap - used), ratio, state, pools };
}

/** Rank two statuses worst-first. */
function worstState(a, b) {
  const rank = { ok: 0, warn: 1, exhausted: 2, latched: 3 };
  return (rank[a] || 0) - (rank[b] || 0);
}

/**
 * Effective status of one pool.
 * @param {object} ledger
 * @param {{pool?:string, model?:any, at?:Date|number, cap?:number}} [opts]
 * @returns {{pool:string,used:number,cap:number,remaining:number,ratio:number,latched:boolean,state:string,free:boolean,account:object,binding:string}}
 */
function status(ledger, opts = {}) {
  const l = forDay(ledger, opts.at);
  const key = opts.pool || poolKey(opts.model);
  const cap = Number.isFinite(opts.cap) ? opts.cap : FREE_POOL_DAILY_CALL_CAP;
  const used = (l.pools[key] && l.pools[key].calls) || 0;
  const latched = Boolean(l.latched[key]);
  const remaining = Math.max(0, cap - used);
  const ratio = cap > 0 ? used / cap : 1;
  let state = "ok";
  if (latched) state = "latched";
  else if (used >= cap) state = "exhausted";
  else if (ratio >= WARN_RATIO) state = "warn";
  const account = isFreePool(key) ? freePoolTotal(l, { at: opts.at }) : null;
  // The account-wide bucket is what the provider actually charges. Prefer it
  // when it is worse AND on ties, because "every free pool looks fine but the
  // account is done" is the real failure mode behind these rejections.
  let binding = "pool";
  if (account && account.state !== "ok" && worstState(account.state, state) >= 0) {
    binding = "account";
    state = account.state;
  }
  return { pool: key, used, cap, remaining, ratio, latched, state, free: isFreePool(key), account, binding };
}

/**
 * Worst status across every pool seen today — the single number a hook or the
 * conductor should act on. Falls back to an empty-day ok status.
 * @param {object} ledger
 * @param {{at?:Date|number, cap?:number}} [opts]
 * @returns {{state:string,pool:string,used:number,cap:number,remaining:number,ratio:number,latched:boolean,free:boolean,account:object,binding:string}}
 */
function worstStatus(ledger, opts = {}) {
  const l = forDay(ledger, opts.at);
  const keys = Object.keys(l.pools);
  const account = freePoolTotal(l, opts);
  if (!keys.length) {
    return {
      pool: "none",
      used: 0,
      cap: Number.isFinite(opts.cap) ? opts.cap : FREE_POOL_DAILY_ACCOUNT_CAP,
      remaining: Number.isFinite(opts.cap) ? opts.cap : FREE_POOL_DAILY_ACCOUNT_CAP,
      ratio: 0,
      latched: Object.keys(l.latched).length > 0,
      state: Object.keys(l.latched).length ? "latched" : "ok",
      free: true,
      account,
      binding: "account",
    };
  }
  const rows = keys.map((k) => status(l, { pool: k, at: opts.at, cap: opts.cap }));
  rows.sort((a, b) => worstState(b.state, a.state) || b.ratio - a.ratio);
  const worst = rows[0];
  // The account bucket outranks any single pool unless a single pool is worse.
  if (account && account.state !== "ok" && worstState(account.state, worst.state) >= 0) {
    return { ...worst, state: account.state, binding: "account" };
  }
  return worst;
}

/**
 * One short line for the conductor, or "" while there is nothing to report.
 * Returning empty when healthy is deliberate: an always-on budget sentence is
 * exactly the per-turn boilerplate this module exists to stop.
 * @param {{state:string,pool:string,used:number,cap:number,remaining:number,free:boolean,account?:object,binding?:string}} st
 * @returns {string}
 */
function formatBudgetLine(st) {
  if (!st || st.state === "ok") return "";
  const scope = st.binding === "account" && st.account
    ? `free pools ${st.account.used}/${st.account.cap} today (account-wide)`
    : `${st.pool}: ${st.used}/${st.cap} calls today`;
  if (st.state === "latched") {
    return `QUOTA_LATCHED (${st.pool}) — ${scope}: today's free-model allowance is spent. Do not retry free pools; switch pool, batch the remaining work into one pass, or report status and stop.`;
  }
  if (st.state === "exhausted") {
    return `QUOTA_EXHAUSTED — ${scope}. Stop spawning; finish in this context and report.`;
  }
  return `QUOTA_WARN — ${scope}: prefer fewer, larger steps; no speculative re-spawns.`;
}

/**
 * Deterministic signature of a dispatched unit of work, so "run the same task
 * again" is detectable rather than merely annoying.
 * @param {{agent?:string, task?:string, files?:string[]}} spec
 * @returns {string}
 */
function workSignature(spec = {}) {
  const norm = (s) =>
    String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const files = [...new Set((spec.files || []).map(norm).filter(Boolean))].sort().join(",");
  return crypto
    .createHash("sha256")
    .update(`${norm(spec.agent)}|${norm(spec.task).slice(0, 600)}|${files}`)
    .digest("hex")
    .slice(0, 16);
}

/**
 * Has this exact unit of work already been dispatched today? (pure)
 * @param {object} ledger
 * @param {{sig:string, at?:Date|number, limit?:number}} opts
 * @returns {{ledger:object, seen:number, duplicate:boolean, fresh:boolean}}
 */
function recordAttempt(ledger, opts = {}) {
  const next = JSON.parse(JSON.stringify(forDay(ledger, opts.at)));
  const sig = opts.sig;
  const limit = Number.isFinite(opts.limit) ? opts.limit : 2;
  if (!sig) return { ledger: next, seen: 0, duplicate: false, fresh: true };
  const prev = next.attempts[sig];
  const seen = prev ? (prev.count || 1) + 1 : 1;
  next.attempts[sig] = { count: seen, last: dayKey(opts.at) };
  const keys = Object.keys(next.attempts);
  if (keys.length > MAX_ATTEMPT_SIGNATURES) {
    for (const k of keys.slice(0, keys.length - MAX_ATTEMPT_SIGNATURES)) delete next.attempts[k];
  }
  return { ledger: next, seen, duplicate: seen > limit, fresh: seen === 1 };
}

/**
 * Non-mutating duplicate probe.
 * @param {object} ledger
 * @param {{sig:string, limit?:number}} opts
 * @returns {{seen:number,duplicate:boolean}}
 */
function peekAttempt(ledger, opts = {}) {
  const l = forDay(ledger, opts.at);
  const rec = opts.sig ? l.attempts[opts.sig] : null;
  const seen = rec ? rec.count || 1 : 0;
  return { seen, duplicate: seen >= (Number.isFinite(opts.limit) ? opts.limit : 2) };
}

/* ------------------------------ I/O (fail-open) ----------------------------- */

/**
 * Device-level default state dir. Free-model quota is an ACCOUNT property, not
 * a repo property, so the ledger lives outside any project tree — mirroring
 * knowledge-store. A per-repo default would drop runtime state into the bundle
 * itself and make the source tree dirty.
 * @returns {string}
 */
function defaultStateDir() {
  const os = require("node:os");
  return resolveStateDir(path.join(process.env.HOME || os.homedir(), ".pcore", "state"));
}

function ledgerPath(dir) {
  return path.join(dir || defaultStateDir(), "request-budget.json");
}

function readLedger(dir, at) {
  try {
    return forDay(readJsonSafe(ledgerPath(dir), emptyLedger(at)), at);
  } catch {
    return emptyLedger(at);
  }
}

function saveLedger(dir, ledger) {
  try {
    writeJson(ledgerPath(dir), ledger);
    return true;
  } catch {
    return false;
  }
}

/**
 * Charge one call and persist. Returns the post-charge status.
 * @param {{dir?:string, model?:any, pool?:string, at?:Date|number, tokens?:number, cost?:number}} opts
 */
function charge(opts = {}) {
  const at = opts.at;
  const led = chargeCall(readLedger(opts.dir, at), { ...opts, at });
  saveLedger(opts.dir, led);
  return status(led, { pool: opts.pool || poolKey(opts.model), at });
}

/**
 * Observe an error; latch the pool when it is a real quota-day rejection.
 * @param {{dir?:string, model?:any, pool?:string, message?:string, at?:Date|number}} opts
 */
function observe(opts = {}) {
  const led0 = readLedger(opts.dir, opts.at);
  const key = opts.pool || poolKey(opts.model);
  const led = isQuotaDayError(opts.message) ? noteQuotaDay(led0, { ...opts, pool: key }) : led0;
  saveLedger(opts.dir, led);
  return { latched: Boolean(led.latched[key]), status: status(led, { pool: key, at: opts.at }) };
}

module.exports = {
  FREE_POOL_DAILY_CALL_CAP,
  FREE_POOL_DAILY_ACCOUNT_CAP,
  WARN_RATIO,
  QUOTA_DAY_MARKERS,
  dayKey,
  emptyLedger,
  poolKey,
  isFreePool,
  isQuotaDayError,
  chargeCall,
  noteQuotaDay,
  freePoolTotal,
  worstState,
  worstStatus,
  status,
  formatBudgetLine,
  workSignature,
  recordAttempt,
  peekAttempt,
  ledgerPath,
  defaultStateDir,
  readLedger,
  saveLedger,
  charge,
  observe,
};

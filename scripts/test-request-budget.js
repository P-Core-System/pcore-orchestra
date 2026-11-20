#!/usr/bin/env node
"use strict";

/**
 * Self-check for the request budget + duplicate-work guard.
 * Temp-dir only; never touches the real state dir.
 *
 * The limits this models are real: OpenCode free pools reject with
 * `Rate limit exceeded: free-models-per-day-high-balance` (a per-DAY REQUEST
 * counter) and `Free usage limit reached.` — 371 such errors in one host log.
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const rb = require("../bundle/hooks/lib/request-budget.js");
const mirrored = require("../bundle/opencode/hooks/lib/request-budget.js");

let fails = 0;
const ok = (name, cond, detail = "") => {
  if (cond) console.log(`PASS  ${name}`);
  else {
    fails++;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

const NOW = new Date(Date.UTC(2026, 10, 17, 12, 0, 0));
const FREE = "opencode/nemotron-3.5-super-vl-free";
const PAID = "meta/muse-spark-1.3-contributor";

// ------------------------------------------------------------------ mirrors
ok("cursor + opencode hook libs are byte-identical",
  fs.readFileSync(path.join(__dirname, "../bundle/hooks/lib/request-budget.js"), "utf8") ===
  fs.readFileSync(path.join(__dirname, "../bundle/opencode/hooks/lib/request-budget.js"), "utf8"));
ok("mirror exports the same API", Object.keys(rb).sort().join() === Object.keys(mirrored).sort().join());

// ------------------------------------------------------------------ day keys
ok("dayKey is UTC-based", rb.dayKey(NOW) === "2026-11-17", rb.dayKey(NOW));
ok("emptyLedger stamps the day", rb.emptyLedger(NOW).day === "2026-11-17");
ok("ledger rolls over on a new day", (() => {
  let l = rb.chargeCall(rb.emptyLedger(NOW), { pool: FREE, n: 500, at: NOW });
  const next = new Date(Date.UTC(2026, 10, 18, 0, 5, 0));
  return rb.status(l, { pool: FREE, at: next }).used === 0;
})());

// ------------------------------------------------------------------ pool keys
ok("poolKey normalizes provider+model", rb.poolKey({ id: "Nemotron-3.5-Super-VL-Free", providerID: "opencode" }) === "opencode/nemotron-3.5-super-vl-free");
ok("poolKey tolerates null", rb.poolKey(null) === "unknown");
ok("isFreePool detects :free", rb.isFreePool("openrouter/nvidia/nemotron-3.5-super-vl:free"));
ok("isFreePool detects -free", rb.isFreePool(FREE));
ok("isFreePool rejects paid", rb.isFreePool(PAID) === false);
ok("isFreePool rejects a model merely named big-pickle", rb.isFreePool("opencode/big-pickle") === false);

// ------------------------------------------------------------------ quota errors
ok("free-models-per-day is a day-quota rejection",
  rb.isQuotaDayError("AI.Error: Rate limit exceeded: free-models-per-day-high-balance"));
ok("'Free usage limit reached' is a day-quota rejection",
  rb.isQuotaDayError("Free usage limit reached. Subscribe to OpenCode Go to keep going"));
ok("a transient 429 does NOT latch the day",
  rb.isQuotaDayError("429 slow down") === false);
ok("null/empty is not a quota error", rb.isQuotaDayError(null) === false && rb.isQuotaDayError("") === false);

// ------------------------------------------------------------------ charging
ok("chargeCall accumulates per pool", (() => {
  let l = rb.emptyLedger(NOW);
  l = rb.chargeCall(l, { pool: FREE, n: 7, at: NOW });
  l = rb.chargeCall(l, { pool: FREE, n: 3, at: NOW });
  return rb.status(l, { pool: FREE, at: NOW }).used === 10;
})());
ok("chargeCall is pure (input ledger untouched)", (() => {
  const l0 = rb.emptyLedger(NOW);
  rb.chargeCall(l0, { pool: FREE, n: 99, at: NOW });
  return Object.keys(l0.pools).length === 0;
})());
ok("chargeCall rings the pool set", (() => {
  let l = rb.emptyLedger(NOW);
  for (let i = 0; i < 90; i++) l = rb.chargeCall(l, { pool: `p/${i}-free`, n: 1, at: NOW });
  return Object.keys(l.pools).length <= 32;
})());
ok("default n is 1", (() => {
  const l = rb.chargeCall(rb.emptyLedger(NOW), { pool: FREE, at: NOW });
  return rb.status(l, { pool: FREE, at: NOW }).used === 1;
})());

// ------------------------------------------------------------------ status
ok("ok -> warn at 70%", (() => {
  const l = rb.chargeCall(rb.emptyLedger(NOW), { pool: FREE, n: Math.ceil(rb.FREE_POOL_DAILY_CALL_CAP * rb.WARN_RATIO), at: NOW });
  return rb.status(l, { pool: FREE, at: NOW }).state === "warn";
})());
ok("exhausted at cap", (() => {
  const l = rb.chargeCall(rb.emptyLedger(NOW), { pool: FREE, n: rb.FREE_POOL_DAILY_CALL_CAP, at: NOW });
  return rb.status(l, { pool: FREE, at: NOW }).state === "exhausted";
})());
ok("latched beats everything", (() => {
  let l = rb.chargeCall(rb.emptyLedger(NOW), { pool: FREE, n: 1, at: NOW });
  l = rb.noteQuotaDay(l, { pool: FREE, at: NOW, message: "free-models-per-day-high-balance" });
  return rb.status(l, { pool: FREE, at: NOW }).state === "latched";
})());
ok("paid pools carry no account-wide free bucket", (() => {
  const l = rb.chargeCall(rb.emptyLedger(NOW), { pool: PAID, n: 400, at: NOW });
  const s = rb.status(l, { pool: PAID, at: NOW });
  return s.account === null && s.free === false;
})());

// ------------------------------------------------------------------ account aggregate
ok("freePoolTotal sums ONLY free pools", (() => {
  let l = rb.emptyLedger(NOW);
  l = rb.chargeCall(l, { pool: "opencode/mimo-v2.6-flash-free", n: 100, at: NOW });
  l = rb.chargeCall(l, { pool: FREE, n: 150, at: NOW });
  l = rb.chargeCall(l, { pool: PAID, n: 900, at: NOW });
  return rb.freePoolTotal(l, { at: NOW }).used === 250;
})());
ok("account bucket binds before roomy per-pool counts", (() => {
  // The real failure shape: each free pool is comfortably under its own cap,
  // but the sum crosses the account-wide per-day limit.
  let l = rb.emptyLedger(NOW);
  const four = [FREE, "opencode/mimo-v2.6-flash-free", "opencode/nemotron-3.5-lightning-free", "openrouter/nvidia/nemotron-3.5-super-vl:free"];
  const per = Math.ceil(rb.FREE_POOL_DAILY_ACCOUNT_CAP / four.length) + 10;
  for (const p of four) l = rb.chargeCall(l, { pool: p, n: per, at: NOW });
  const s = rb.status(l, { pool: FREE, at: NOW });
  const everyPoolRoomy = four.every((p) => rb.status(l, { pool: p, at: NOW }).used < rb.FREE_POOL_DAILY_CALL_CAP);
  return everyPoolRoomy && s.state === "exhausted" && s.binding === "account";
})());
ok("latch on one free pool surfaces account-wide as latched", (() => {
  let l = rb.chargeCall(rb.emptyLedger(NOW), { pool: FREE, n: 1, at: NOW });
  l = rb.noteQuotaDay(l, { pool: FREE, at: NOW });
  return rb.freePoolTotal(l, { at: NOW }).state === "latched";
})());
ok("worstState ranks ok<warn<exhausted<latched",
  rb.worstState("ok", "warn") < 0 && rb.worstState("warn", "exhausted") < 0 && rb.worstState("exhausted", "latched") < 0);

// ------------------------------------------------------------------ reporting line
ok("healthy produces NO text (no per-turn boilerplate)",
  rb.formatBudgetLine(rb.status(rb.emptyLedger(NOW), { pool: FREE, at: NOW })) === "");
ok("warn line names the action", /QUOTA_WARN/.test(rb.formatBudgetLine(rb.status(
  rb.chargeCall(rb.emptyLedger(NOW), { pool: FREE, n: 500, at: NOW }), { pool: FREE, at: NOW }))));
ok("latched line forbids retry", /QUOTA_LATCHED/.test(rb.formatBudgetLine(rb.status(
  rb.noteQuotaDay(rb.emptyLedger(NOW), { pool: FREE, at: NOW }), { pool: FREE, at: NOW }))));
ok("account-bound line quotes the account bucket", (() => {
  let l = rb.emptyLedger(NOW);
  for (const p of [FREE, "opencode/mimo-v2.6-flash-free", "opencode/nemotron-3.5-lightning-free"]) {
    l = rb.chargeCall(l, { pool: p, n: Math.ceil(rb.FREE_POOL_DAILY_ACCOUNT_CAP / 3) + 5, at: NOW });
  }
  return /account-wide/.test(rb.formatBudgetLine(rb.status(l, { pool: FREE, at: NOW })));
})());

// ------------------------------------------------------------------ duplicate work
ok("workSignature normalizes case/punctuation/files",
  rb.workSignature({ agent: "orchestra-implementer", task: "Fix the LOGIN bug!!", files: ["a.ts", "A.ts"] }) ===
  rb.workSignature({ agent: "Orchestra-Implementer", task: "fix the login bug", files: ["a.ts"] }));
ok("different task -> different signature",
  rb.workSignature({ agent: "a", task: "add caching" }) !== rb.workSignature({ agent: "a", task: "drop caching" }));
ok("3rd identical dispatch is a duplicate", (() => {
  const sig = rb.workSignature({ agent: "a", task: "t" });
  let l = rb.emptyLedger(NOW);
  for (let i = 0; i < 3; i++) l = rb.recordAttempt(l, { sig, at: NOW }).ledger;
  return rb.peekAttempt(l, { sig, at: NOW }).duplicate === true;
})());
ok("first dispatch is never a duplicate", (() => {
  const sig = rb.workSignature({ agent: "a", task: "t" });
  return rb.peekAttempt(rb.emptyLedger(NOW), { sig, at: NOW }).duplicate === false;
})());
ok("recordAttempt rings the signature set", (() => {
  let l = rb.emptyLedger(NOW);
  for (let i = 0; i < 500; i++) l = rb.recordAttempt(l, { sig: `s${i}`, at: NOW }).ledger;
  return Object.keys(l.attempts).length <= 400;
})());
ok("attempt log resets on a new day", (() => {
  const sig = rb.workSignature({ agent: "a", task: "t" });
  const l = rb.recordAttempt(rb.emptyLedger(NOW), { sig, at: NOW }).ledger;
  return rb.peekAttempt(l, { sig, at: new Date(Date.UTC(2026, 10, 19)) }).seen === 0;
})());

ok("worstStatus outranks a roomy account with a latched pool", (() => {
  let l = rb.chargeCall(rb.emptyLedger(NOW), { pool: FREE, n: 5, at: NOW });
  l = rb.noteQuotaDay(l, { pool: FREE, at: NOW });
  return rb.worstStatus(l, { at: NOW }).state === "latched";
})());
ok("worstStatus on an empty day says ok and prints nothing", (() => {
  const w = rb.worstStatus(rb.emptyLedger(NOW), { at: NOW });
  return w.state === "ok" && rb.formatBudgetLine(w) === "";
})());
ok("worstStatus picks the pool closest to its cap", (() => {
  let l = rb.emptyLedger(NOW);
  l = rb.chargeCall(l, { pool: FREE, n: 50, at: NOW });
  l = rb.chargeCall(l, { pool: PAID, n: 550, at: NOW });
  return rb.worstStatus(l, { at: NOW }).pool === PAID && rb.worstStatus(l, { at: NOW }).state === "warn";
})());
ok("paid pools never inherit a free-pool latch", (() => {
  let l = rb.chargeCall(rb.emptyLedger(NOW), { pool: PAID, n: 10, at: NOW });
  l = rb.noteQuotaDay(l, { pool: FREE, at: NOW });
  return rb.status(l, { pool: PAID, at: NOW }).state === "ok";
})());

// ------------------------------------------------------------------ persistence
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pcore-budget-"));
try {
  ok("saveLedger + readLedger round-trip", (() => {
    const l = rb.chargeCall(rb.emptyLedger(NOW), { pool: FREE, n: 12, at: NOW });
    ok("write returns true", rb.saveLedger(tmp, l) === true);
    const back = rb.readLedger(tmp, NOW);
    return rb.status(back, { pool: FREE, at: NOW }).used === 12;
  })());
  ok("corrupt ledger fails open (never blocks work)", (() => {
    fs.writeFileSync(path.join(tmp, "request-budget.json"), "{ not json");
    const s = rb.status(rb.readLedger(tmp, NOW), { pool: FREE, at: NOW });
    return s.used === 0 && s.state === "ok";
  })());
  ok("charge() persists", (() => {
    fs.rmSync(path.join(tmp, "request-budget.json"), { force: true });
    rb.charge({ dir: tmp, pool: FREE, n: 3, at: NOW });
    return rb.status(rb.readLedger(tmp, NOW), { pool: FREE, at: NOW }).used === 3;
  })());
  ok("observe() latches only on a real quota error", (() => {
    fs.rmSync(path.join(tmp, "request-budget.json"), { force: true });
    const a = rb.observe({ dir: tmp, pool: FREE, message: "429 slow down", at: NOW });
    const b = rb.observe({ dir: tmp, pool: FREE, message: "Rate limit exceeded: free-models-per-day-high-balance", at: NOW });
    return a.latched === false && b.latched === true;
  })());
  ok("no .tmp residue", !fs.readdirSync(tmp).some((f) => f.endsWith(".tmp")));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${fails === 0 ? "All request-budget tests passed." : `${fails} FAILED`}`);
process.exit(fails === 0 ? 0 : 1);

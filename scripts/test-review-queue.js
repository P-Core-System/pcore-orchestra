#!/usr/bin/env node
"use strict";

/**
 * Suite for the human-review queue (audit Phase 3: "surface the human-review
 * queue on needs_human" — §15 listed human review as *NOT implemented*, and
 * the reviewer's `needs_human` status string existed only in agent prose).
 *
 * Focus:
 *   - `pendingReview()` derives the queue ONLY from `store.loadEvents()`
 *     (zero raw fs in the module — the store is the single writer)
 *   - openers/closers pairing, oldest-first ordering, `[{ticketId, phase,
 *     reason, since}]` shape
 *   - empty log => [], corrupt log => [] and NEVER throws
 *   - the quality-gate hook injects a `## Human review queue` block into
 *     `additional_context` when the outcome is blocked / needs_human, and
 *     injecting it cannot change a gate verdict
 *
 * All fixtures live in os.tmpdir() and are removed afterwards.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const DOMAIN = path.join(ROOT, "bundle", "hooks", "lib", "domain");
const MIRROR_DOMAIN = path.join(ROOT, "bundle", "opencode", "hooks", "lib", "domain");
const QUEUE = path.join(DOMAIN, "review-queue.js");
const GATE_HOOK = path.join(ROOT, "bundle", "hooks", "orchestra-quality-gate.js");

let failures = 0;
let asserts = 0;
const tmpDirs = [];

function test(name, fn) {
  try {
    fn();
    console.log("PASS", name);
  } catch (e) {
    failures++;
    console.error("FAIL", name, e && e.message);
  }
}

function ok(cond, msg) {
  asserts++;
  assert.ok(cond, msg);
}

function eq(a, b, msg) {
  asserts++;
  assert.strictEqual(a, b, msg);
}

function tmpdir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

process.on("exit", () => {
  for (const d of tmpDirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

/** Require inside a test so a missing module fails the test, not the suite. */
function loadQueue() {
  return require(QUEUE);
}

/** Point the domain store at a throwaway state dir and return its events path. */
function useStateDir(prefix) {
  const dir = tmpdir(prefix);
  process.env.PCORE_STATE_DIR = dir;
  return path.join(dir, "domain-events.json");
}

/** Append one raw event straight to the events file (fixtures, not the store). */
function writeEvents(eventsPath, events) {
  fs.mkdirSync(path.dirname(eventsPath), { recursive: true });
  fs.writeFileSync(eventsPath, JSON.stringify(events, null, 2), "utf8");
}

function requestEvent(ticketId, at, phase, reason) {
  return {
    id: `event_${ticketId}`,
    kind: "event",
    type: "review.requested",
    entityId: ticketId,
    payload: { ticketId, phase: phase || "review", reason: reason || "human sign-off required" },
    at,
    createdAt: at,
    updatedAt: at,
    refs: [],
  };
}

function resolveEvent(ticketId, at) {
  return {
    id: `event_resolved_${ticketId}`,
    kind: "event",
    type: "review.resolved",
    entityId: ticketId,
    payload: { ticketId },
    at,
    createdAt: at,
    updatedAt: at,
    refs: [],
  };
}

// ---------------------------------------------------------------- module shape

test("review-queue.js exists (RED first)", () => {
  ok(fs.existsSync(QUEUE), "bundle/hooks/lib/domain/review-queue.js must exist");
});

test("exports pendingReview()", () => {
  const queue = loadQueue();
  eq(typeof queue.pendingReview, "function", "pendingReview must be exported");
});

test("pendingReview reads only via the store — zero raw fs in the module", () => {
  const src = fs.readFileSync(QUEUE, "utf8");
  ok(!/require\(\s*["']node:fs["']\s*\)/.test(src), "review-queue.js must not require node:fs");
  ok(!/\bfs\.[a-zA-Z]+/.test(src), "review-queue.js must not call fs.* directly");
  ok(!/\b(readFileSync|writeFileSync|existsSync|readdirSync)\b/.test(src), "review-queue.js must not touch the filesystem");
  ok(/store\.loadEvents\s*\(/.test(src), "review-queue.js must read through store.loadEvents()");
});

test("index.js barrel exports pendingReview", () => {
  const domain = require(path.join(DOMAIN, "index.js"));
  eq(typeof domain.pendingReview, "function", "the barrel must re-export pendingReview");
});

test("opencode mirror carries review-queue.js", () => {
  const mirror = path.join(MIRROR_DOMAIN, "review-queue.js");
  ok(fs.existsSync(mirror), "bundle/opencode/hooks/lib/domain/review-queue.js must exist");
  ok(
    fs.readFileSync(mirror).equals(fs.readFileSync(QUEUE)),
    "the mirror must be byte-identical to the cursor copy"
  );
});

// ----------------------------------------------------------------- queue shape

test("empty event log -> []", () => {
  const eventsPath = useStateDir("orchestra-rq-empty-");
  writeEvents(eventsPath, []);
  const queue = loadQueue();
  eq(JSON.stringify(queue.pendingReview()), "[]", "an empty log must yield an empty queue");
});

test("missing event log -> [] (no throw)", () => {
  useStateDir("orchestra-rq-missing-");
  const queue = loadQueue();
  eq(JSON.stringify(queue.pendingReview()), "[]", "a missing log must yield an empty queue");
});

test("pending entries carry {ticketId, phase, reason, since}", () => {
  const eventsPath = useStateDir("orchestra-rq-shape-");
  const at = "2026-10-02T10:00:00.000Z";
  writeEvents(eventsPath, [requestEvent("tkt-1", at, "verify", "security sign-off")]);
  const { pendingReview } = loadQueue();
  const items = pendingReview();
  eq(items.length, 1, `expected 1 queued item, got ${items.length}`);
  eq(JSON.stringify(Object.keys(items[0]).sort()), JSON.stringify(["phase", "reason", "since", "ticketId"]), "unexpected item shape");
  eq(items[0].ticketId, "tkt-1", "ticketId must be carried through");
  eq(items[0].phase, "verify", "phase must be carried through");
  eq(items[0].reason, "security sign-off", "reason must be carried through");
  eq(items[0].since, at, "since must be the request timestamp");
});

test("queue is sorted oldest-first regardless of log order", () => {
  const eventsPath = useStateDir("orchestra-rq-order-");
  writeEvents(eventsPath, [
    requestEvent("tkt-new", "2026-10-02T12:00:00.000Z"),
    requestEvent("tkt-old", "2026-10-01T08:00:00.000Z"),
    requestEvent("tkt-mid", "2026-10-02T09:00:00.000Z"),
  ]);
  const { pendingReview } = loadQueue();
  const ids = pendingReview().map((i) => i.ticketId);
  eq(JSON.stringify(ids), JSON.stringify(["tkt-old", "tkt-mid", "tkt-new"]), `expected oldest-first order, got ${JSON.stringify(ids)}`);
});

test("a resolving event closes its ticket and leaves the rest queued", () => {
  const eventsPath = useStateDir("orchestra-rq-resolve-");
  writeEvents(eventsPath, [
    requestEvent("tkt-1", "2026-10-01T08:00:00.000Z"),
    requestEvent("tkt-2", "2026-10-02T08:00:00.000Z"),
    resolveEvent("tkt-1", "2026-10-02T09:00:00.000Z"),
  ]);
  const { pendingReview } = loadQueue();
  const ids = pendingReview().map((i) => i.ticketId);
  eq(JSON.stringify(ids), JSON.stringify(["tkt-2"]), `only the unresolved ticket stays queued, got ${JSON.stringify(ids)}`);
});

test("phase.outcome needs_human opens the queue; an advance closes it", () => {
  const eventsPath = useStateDir("orchestra-rq-outcome-");
  writeEvents(eventsPath, [
    {
      id: "e1",
      kind: "event",
      type: "phase.outcome",
      entityId: "sess-1",
      payload: { phase: "review", decision: "needs_human", reason: "scope-creep" },
      at: "2026-10-02T08:00:00.000Z",
      createdAt: "2026-10-02T08:00:00.000Z",
      updatedAt: "2026-10-02T08:00:00.000Z",
      refs: [],
    },
    {
      id: "e2",
      kind: "event",
      type: "phase.outcome",
      entityId: "sess-1",
      payload: { phase: "review", decision: "advance" },
      at: "2026-10-02T10:00:00.000Z",
      createdAt: "2026-10-02T10:00:00.000Z",
      updatedAt: "2026-10-02T10:00:00.000Z",
      refs: [],
    },
  ]);
  const { pendingReview } = loadQueue();
  eq(pendingReview().length, 0, "a needs_human closed by an advance must not stay queued");
});

test("a corrupt event log -> [] and never throws", () => {
  const eventsPath = useStateDir("orchestra-rq-corrupt-");
  fs.mkdirSync(path.dirname(eventsPath), { recursive: true });
  fs.writeFileSync(eventsPath, "{ not json at all [[[", "utf8");
  const { pendingReview } = loadQueue();
  let result = null;
  let threw = null;
  try {
    result = pendingReview();
  } catch (e) {
    threw = e;
  }
  eq(threw, null, `pendingReview must never throw on a corrupt log (${threw && threw.message})`);
  eq(JSON.stringify(result), "[]", "a corrupt log must yield an empty queue");
});

test("junk entries in an otherwise valid log are skipped, not fatal", () => {
  const eventsPath = useStateDir("orchestra-rq-junk-");
  writeEvents(eventsPath, [null, 42, "nope", { type: "review.requested" }, requestEvent("tkt-ok", "2026-10-02T08:00:00.000Z")]);
  const { pendingReview } = loadQueue();
  eq(pendingReview().length, 1, `only the well-formed request stays queued, got ${JSON.stringify(pendingReview())}`);
});

// -------------------------------------------------------------- hook injection

/** Seed an active session so the quality-gate hook runs its review branch. */
function seedSession(stateDir, sessionId) {
  const root = {
    version: 3,
    sessions: {
      [sessionId]: {
        active: true,
        goal: "review queue surfacing",
        currentPhase: "review",
        loopMode: "core",
        iteration: 0,
        max_iterations: 20,
      },
    },
  };
  fs.writeFileSync(path.join(stateDir, "orchestra.json"), JSON.stringify(root, null, 2), "utf8");
}

function runGateHook(stateDir, sessionId, summary) {
  const env = Object.assign({}, process.env, {
    PCORE_STATE_DIR: stateDir,
    PCORE_SESSION_ID: sessionId,
  });
  delete env.CURSOR_TRACE_ID;
  delete env.OPENCODE_SESSION_ID;
  delete env.CLAUDE_SESSION_ID;
  return cp.spawnSync(process.execPath, [GATE_HOOK], {
    input: JSON.stringify({
      status: "completed",
      subagent_type: "orchestra-reviewer",
      summary,
    }),
    env,
    cwd: tmpdir("orchestra-rq-cwd-"),
    encoding: "utf8",
    timeout: 120000,
  });
}

test("blocked review injects a '## Human review queue' block naming the ticket", () => {
  const stateDir = tmpdir("orchestra-rq-hook-blocked-");
  const sessionId = "rq-blocked";
  seedSession(stateDir, sessionId);
  writeEvents(path.join(stateDir, "domain-events.json"), [
    requestEvent("tkt-alpha", "2026-10-02T08:00:00.000Z", "review", "scope-creep"),
    requestEvent("tkt-beta", "2026-10-02T09:00:00.000Z", "review", "auth change"),
  ]);
  const out = runGateHook(stateDir, sessionId, "FIX_REQUIRED\nNeeds fixes before approval.");
  eq(out.status, 0, `the hook must still exit 0 (fail-open), got ${out.status}: ${out.stderr}`);
  const emitted = JSON.parse(out.stdout || "{}");
  const ctx = emitted.additional_context || "";
  ok(/^## Human review queue$/m.test(ctx), `expected a '## Human review queue' heading, got:\n${ctx.slice(0, 400)}`);
  ok(/tkt-alpha/.test(ctx), "the oldest queued ticket must be named");
  ok(/tkt-beta/.test(ctx), "every queued ticket must be named");
  ok(
    ctx.indexOf("tkt-alpha") < ctx.indexOf("tkt-beta"),
    `queue must be listed oldest-first:\n${ctx.slice(0, 400)}`
  );
  ok(/auth change/.test(ctx), "the recorded reason must be surfaced");
  ok(/Reviewer approves.*FAIL/.test(ctx), `gate verdicts must be unchanged (reviewer-approval FAIL), got:\n${ctx.slice(0, 600)}`);
});

test("the queue block is absent when nothing needs a human", () => {
  const stateDir = tmpdir("orchestra-rq-hook-green-");
  const sessionId = "rq-green";
  seedSession(stateDir, sessionId);
  writeEvents(path.join(stateDir, "domain-events.json"), []);
  const out = runGateHook(stateDir, sessionId, "ORCHESTRA_COMPLETE\nAll good.");
  eq(out.status, 0, `the hook must exit 0, got ${out.status}: ${out.stderr}`);
  const emitted = JSON.parse(out.stdout || "{}");
  const ctx = emitted.additional_context || "";
  ok(!/Human review queue/.test(ctx), `a green review must not carry a review queue:\n${ctx.slice(0, 400)}`);
  ok(/Quality Gates Report/.test(ctx), "the gates report must still be emitted");
});

test("a broken review queue never breaks the hook (fail-open)", () => {
  const stateDir = tmpdir("orchestra-rq-hook-corrupt-");
  const sessionId = "rq-corrupt-hook";
  seedSession(stateDir, sessionId);
  fs.writeFileSync(path.join(stateDir, "domain-events.json"), "{ broken", "utf8");
  const out = runGateHook(stateDir, sessionId, "FIX_REQUIRED\nbroken log");
  eq(out.status, 0, `the hook must exit 0 with a corrupt log, got ${out.status}: ${out.stderr}`);
  const emitted = JSON.parse(out.stdout || "{}");
  ok(typeof emitted.additional_context === "string", "additional_context must still be a string");
  ok(/Quality Gates Report/.test(emitted.additional_context), "the gates report must still be emitted");
});

// -------------------------------------------------- S1: the queue has a producer

test("phase.outcome `block` — the decision phase-outcome.js really emits — opens the queue", () => {
  const eventsPath = useStateDir("orchestra-rq-block-");
  const at = "2026-10-02T08:00:00.000Z";
  writeEvents(eventsPath, [
    {
      id: "e1",
      kind: "event",
      type: "phase.outcome",
      entityId: null,
      payload: { phase: "verify", decision: "block", reason: "failed-gates" },
      at,
      createdAt: at,
      updatedAt: at,
      refs: [],
    },
  ]);
  const { pendingReview } = loadQueue();
  const items = pendingReview();
  eq(items.length, 1, `a blocked phase must be queued for triage, got ${JSON.stringify(items)}`);
  eq(items[0].phase, "verify", "the blocked phase must be carried through");
  eq(items[0].reason, "failed-gates", "the blocking reason must be carried through");
  eq(items[0].since, at, "since must be the block timestamp");
});

test("an `advance` after a `block` closes it again", () => {
  const eventsPath = useStateDir("orchestra-rq-block-advance-");
  writeEvents(eventsPath, [
    {
      id: "e1",
      kind: "event",
      type: "phase.outcome",
      entityId: null,
      payload: { phase: "verify", decision: "block", reason: "failed-gates" },
      at: "2026-10-02T08:00:00.000Z",
      createdAt: "2026-10-02T08:00:00.000Z",
      updatedAt: "2026-10-02T08:00:00.000Z",
      refs: [],
    },
    {
      id: "e2",
      kind: "event",
      type: "phase.outcome",
      entityId: null,
      payload: { phase: "verify", decision: "advance" },
      at: "2026-10-02T10:00:00.000Z",
      createdAt: "2026-10-02T10:00:00.000Z",
      updatedAt: "2026-10-02T10:00:00.000Z",
      refs: [],
    },
  ]);
  eq(loadQueue().pendingReview().length, 0, "an advance must close the blocked item");
});

test("every decision phase-outcome.js can emit is classified (queue and needsHuman agree)", () => {
  const src = fs.readFileSync(path.join(DOMAIN, "..", "phase-outcome.js"), "utf8");
  const emitted = new Set();
  for (const m of src.matchAll(/decision:\s*"([a-z_]+)"/g)) emitted.add(m[1]);
  ok(emitted.size >= 3, `expected the outcome gate's decisions in source, found ${JSON.stringify([...emitted])}`);
  const queue = loadQueue();
  ok(queue.OPEN_DECISIONS.has("block"), "needsHuman() treats `block` as needing a person, so the queue must open on it");
  ok(queue.OPEN_DECISIONS.has("needs_human"), "the prose decision must stay supported");
  ok(queue.CLOSE_DECISIONS.has("advance"), "an advance closes a queued item");
  for (const d of emitted) {
    ok(
      queue.OPEN_DECISIONS.has(d) || queue.CLOSE_DECISIONS.has(d) || d === "fix",
      `decision "${d}" is emitted by phase-outcome.js but classified by neither side of the queue — an unclassified decision is an inert feature`
    );
  }
});

test("the queue hook renders a REAL phase.outcome block instead of \"nothing is queued\"", () => {
  const eventsPath = useStateDir("orchestra-rq-hook-block-outcome-");
  const stateDir = path.dirname(eventsPath);
  const sessionId = "rq-block-outcome";
  seedSession(stateDir, sessionId);
  // The real producer: the same helper orchestra-subagent-stop.js calls.
  const domain = require(path.join(DOMAIN, "index.js"));
  domain.recordPhaseOutcome(
    { currentPhase: "review", goal: "queue producer" },
    { phase: "review", decision: "block", reason: "failed-gates", token: null },
    "orchestra-reviewer"
  );
  const out = runGateHook(stateDir, sessionId, "FIX_REQUIRED\nA required gate is red.");
  eq(out.status, 0, `the hook must still exit 0 (fail-open), got ${out.status}: ${out.stderr}`);
  const ctx = JSON.parse(out.stdout || "{}").additional_context || "";
  ok(/^## Human review queue$/m.test(ctx), `expected the queue heading, got:\n${ctx.slice(0, 500)}`);
  ok(
    /nothing is queued for triage/.test(ctx) === false,
    `a blocked phase must produce a queue entry, not the empty-queue line:\n${ctx.slice(0, 500)}`
  );
  ok(/review/.test(ctx.split("## Human review queue")[1] || ""), `the blocked phase must be named:\n${ctx.slice(0, 500)}`);
});

console.log(`review-queue assertions: ${asserts}`);

if (failures > 0) {
  console.error(`${failures} FAILED`);
  process.exit(1);
}
console.log("All review-queue tests passed");
process.exit(0);
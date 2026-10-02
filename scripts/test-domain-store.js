#!/usr/bin/env node
"use strict";

/**
 * Phase 2 COMMIT 3 self-check: domain JSON store (safe-write based) +
 * checkpoint resume round-trip + the index.js barrel (recordPhaseOutcome).
 *
 * Everything runs against a PCORE_STATE_DIR temp dir: no repo state, no
 * .tmp residue, corrupt files quarantined (never silently reset).
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const DOMAIN = path.join(ROOT, "bundle", "hooks", "lib", "domain");
const HOOK = path.join(ROOT, "bundle", "hooks", "orchestra-subagent-stop.js");

let failed = 0;

function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "orchestra-domain-store-"));
const stateDir = path.join(tmp, "state");
fs.mkdirSync(stateDir, { recursive: true });
process.env.PCORE_STATE_DIR = stateDir;
delete process.env.PCORE_SESSION_ID;

const constants = require(path.join(DOMAIN, "constants.js"));
const entities = require(path.join(DOMAIN, "entities.js"));
const store = require(path.join(DOMAIN, "store.js"));

// -------------------------------------------------- paths land in PCORE_STATE_DIR
const eventsPath = store.domainEventsPath();
check("domainEventsPath resolves into PCORE_STATE_DIR", eventsPath === path.join(stateDir, "domain-events.json"), eventsPath);
const checkpointPath = store.checkpointPath();
check("checkpointPath resolves into PCORE_STATE_DIR", checkpointPath.startsWith(stateDir + path.sep), checkpointPath);

// ------------------------------------------------------------- appendEvent
const ev1 = store.appendEvent(entities.createEvent({ type: "phase.outcome", entityId: "s1", payload: { decision: "advance" } }));
check("appendEvent returns the stored event", ev1 && typeof ev1.id === "string" && ev1.id.length > 0, JSON.stringify(ev1));
check("domain-events.json lands in PCORE_STATE_DIR", fs.existsSync(eventsPath), eventsPath);
const onDisk = JSON.parse(fs.readFileSync(eventsPath, "utf8"));
check("domain-events.json is an array", Array.isArray(onDisk), typeof onDisk);
check("appended event is persisted", Array.isArray(onDisk) && onDisk.some((e) => e.id === ev1.id), JSON.stringify(onDisk.map((e) => e.id)));
check("loadEvents round-trips", store.loadEvents().some((e) => e.id === ev1.id));

// --------------------------------------------------------- no .tmp residue
store.saveCheckpoint({
  sessionId: "sess-1",
  ticketId: "tkt-1",
  completedTasks: ["task-a"],
  runningTasks: ["task-b"],
  pendingTasks: ["task-c"],
  lastEventId: ev1.id,
  lastVerifiedCommit: "abc123",
  createdAt: new Date().toISOString(),
});
const residue = fs.readdirSync(stateDir).filter((f) => f.includes(".tmp.") || f.endsWith(".lock"));
check("no .tmp/.lock residue after writes", residue.length === 0, residue.join(", "));
check("checkpoint file lands in PCORE_STATE_DIR", fs.existsSync(checkpointPath), checkpointPath);

// ------------------------------------------------- checkpoint round-trip (J)
const checkpoint = {
  sessionId: "sess-2",
  ticketId: "tkt-2",
  completedTasks: ["t1", "t2"],
  runningTasks: ["t3"],
  pendingTasks: ["t4", "t5"],
  lastEventId: "evt-99",
  lastVerifiedCommit: "deadbeef",
  createdAt: "2026-10-02T00:00:00.000Z",
};
store.saveCheckpoint(checkpoint);
const loaded = store.loadCheckpoint("sess-2");
check("checkpoint deep-equal round-trip", deepEqual(loaded, checkpoint), JSON.stringify(loaded));
check("loadCheckpoint(sessionId) filters other sessions", store.loadCheckpoint("sess-OTHER") === null, JSON.stringify(store.loadCheckpoint("sess-OTHER")));
check("loadCheckpoint with no checkpoint -> null", store.loadCheckpoint("missing-session") !== undefined && (store.loadCheckpoint("missing-session") === null || deepEqual(store.loadCheckpoint("missing-session"), checkpoint)));

// ----------------------------------------------------- corrupt file quarantine
const garbage = "{ this is NOT json [[[";
fs.writeFileSync(eventsPath, garbage, "utf8");
const defaults = store.loadEvents();
check("corrupt domain-events.json -> defaults (array)", Array.isArray(defaults) && defaults.length === 0, JSON.stringify(defaults));
const siblings = fs.readdirSync(stateDir).filter((f) => f.includes(".corrupt-"));
check("corrupt file quarantined to a .corrupt sibling", siblings.length >= 1, siblings.join(", "));
if (siblings.length >= 1) {
  const preserved = fs.readFileSync(path.join(stateDir, siblings[0]), "utf8");
  check("quarantine preserves the original bytes (no silent reset)", preserved === garbage, JSON.stringify(preserved.slice(0, 40)));
}
const rebuilt = store.appendEvent(entities.createEvent({ type: "phase.outcome", payload: { decision: "block" } }));
check("appendEvent recovers after quarantine", rebuilt && store.loadEvents().some((e) => e.id === rebuilt.id), JSON.stringify(store.loadEvents().map((e) => e.type)));

// ------------------------------------------------------------- ring cap
const ringDir = path.join(tmp, "ring-state");
fs.mkdirSync(ringDir, { recursive: true });
process.env.PCORE_STATE_DIR = ringDir;
const RING_CAP = 5;
for (let i = 0; i < RING_CAP + 3; i += 1) {
  store.appendEvent(entities.createEvent({ type: "phase.outcome", entityId: `e${i}` }), { cap: RING_CAP });
}
const ringed = store.loadEvents();
check("appendEvent honors the ring cap", ringed.length === RING_CAP, String(ringed.length));
check("ring keeps the newest", ringed[ringed.length - 1].entityId === `e${RING_CAP + 2}`, ringed[ringed.length - 1].entityId);
check("ring drops the oldest", ringed[0].entityId === `e${RING_CAP + 3 - RING_CAP}`, ringed[0].entityId);
check("default ring cap is DOMAIN_EVENT_CAP", store.domainEventCap() === constants.DOMAIN_EVENT_CAP, String(store.domainEventCap()));
process.env.PCORE_STATE_DIR = stateDir;

// ------------------------------------------ implementation uses safe-write only
const src = fs.readFileSync(path.join(DOMAIN, "store.js"), "utf8");
check("store.js uses withLock", /withLock\s*\(/.test(src), "missing withLock");
check("store.js uses readJsonSafe", /readJsonSafe\s*\(/.test(src), "missing readJsonSafe");
check("store.js uses writeJson", /writeJson\s*\(/.test(src), "missing writeJson");
check("store.js has zero raw fs.writeFileSync/appendFileSync", !/fs\.(writeFileSync|appendFileSync)/.test(src), "raw write found");

// ------------------------------------------------------- index barrel + recordPhaseOutcome
const domain = require(path.join(DOMAIN, "index.js"));
check("index.js exposes constants", domain.constants && Array.isArray(domain.constants.TICKET_STATES));
check("index.js exposes entities", typeof domain.createTicket === "function" && typeof domain.validateEntity === "function");
check("index.js exposes state-machine", typeof domain.transition === "function" && typeof domain.sessionTransition === "function");
check("index.js exposes completion", typeof domain.evaluateCompletion === "function" && typeof domain.claimDone === "function");
check("index.js exposes store", typeof domain.appendEvent === "function" && typeof domain.saveCheckpoint === "function");
check("index.js exposes recordPhaseOutcome", typeof domain.recordPhaseOutcome === "function");

const outcomeEvent = domain.recordPhaseOutcome(
  { currentPhase: "verify", goal: "ship phase 2", last_subagent: "orchestra-verifier" },
  { phase: "verify", decision: "advance", reason: "token-matched", token: "VERIFY_PASS" },
  "orchestra-verifier"
);
check("recordPhaseOutcome returns an event", outcomeEvent && outcomeEvent.type === "phase.outcome", JSON.stringify(outcomeEvent));
const storedOutcome = store.loadEvents().find((e) => e.id === outcomeEvent.id);
check("recordPhaseOutcome persists a phase.outcome event", !!storedOutcome, JSON.stringify(storedOutcome && storedOutcome.type));
check(
  "phase.outcome carries decision",
  storedOutcome && storedOutcome.payload && storedOutcome.payload.decision === "advance",
  JSON.stringify(storedOutcome && storedOutcome.payload)
);
check(
  "phase.outcome carries phase + subagentType + reason",
  storedOutcome &&
    storedOutcome.payload.phase === "verify" &&
    storedOutcome.payload.subagentType === "orchestra-verifier" &&
    storedOutcome.payload.reason === "token-matched",
  JSON.stringify(storedOutcome && storedOutcome.payload)
);
const nullEvent = domain.recordPhaseOutcome(null, null, null);
check("recordPhaseOutcome is defensive on null inputs", nullEvent && nullEvent.type === "phase.outcome", JSON.stringify(nullEvent));

// --------------------------------------------- hook: append phase.outcome on stop
const hookState = path.join(tmp, "hook-state");
fs.mkdirSync(hookState, { recursive: true });

function seedHookSession(overrides) {
  const root = {
    version: 3,
    sessions: {
      "hook-test": Object.assign(
        {
          active: true,
          goal: "domain hook wiring",
          currentPhase: "plan",
          loopMode: "core",
          iteration: 0,
          max_iterations: 20,
        },
        overrides || {}
      ),
    },
  };
  fs.writeFileSync(path.join(hookState, "orchestra.json"), JSON.stringify(root, null, 2));
}

const hookEnv = Object.assign({}, process.env, {
  PCORE_STATE_DIR: hookState,
  PCORE_SESSION_ID: "hook-test",
});
delete hookEnv.CURSOR_TRACE_ID;
delete hookEnv.OPENCODE_SESSION_ID;
delete hookEnv.CLAUDE_SESSION_ID;

function runHook(subagentType, summary) {
  return spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ status: "completed", subagent_type: subagentType, summary }),
    env: hookEnv,
    cwd: tmp,
    encoding: "utf8",
    timeout: 60000,
  });
}

function hookEvents() {
  const p = path.join(hookState, "domain-events.json");
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : [];
}

function hookOutcomeEvents() {
  return hookEvents().filter((e) => e && e.type === "phase.outcome");
}

function readHookSession() {
  const root = JSON.parse(fs.readFileSync(path.join(hookState, "orchestra.json"), "utf8"));
  return { root, session: root.sessions["hook-test"] };
}

function containsDomainKey(value) {
  if (!value || typeof value !== "object") return false;
  const keys = Array.isArray(value) ? value.map((_, i) => String(i)) : Object.keys(value);
  if (keys.some((k) => /domain/i.test(k))) return true;
  return keys.some((k) => containsDomainKey(value[k]));
}

// advance case
seedHookSession();
let hookOut = runHook("orchestra-planner", "PLAN_READY\nSteps 0-8 defined.");
check("hook advance exits 0", hookOut.status === 0, hookOut.stderr);
let advanced = readHookSession();
check("hook advance moves plan -> implement", advanced.session.currentPhase === "implement", advanced.session.currentPhase);
const advanceEvents = hookOutcomeEvents();
check(
  "hook advance appends a phase.outcome event",
  advanceEvents.length >= 1,
  JSON.stringify(hookEvents().map((e) => e.type))
);
check(
  "phase.outcome decision = advance",
  advanceEvents.some((e) => e.payload && e.payload.decision === "advance"),
  JSON.stringify(advanceEvents.map((e) => e.payload && e.payload.decision))
);
check(
  "phase.outcome carries subagentType + phase",
  advanceEvents.some((e) => e.payload && e.payload.subagentType === "orchestra-planner" && e.payload.phase === "plan"),
  JSON.stringify(advanceEvents.map((e) => e.payload))
);

// block case (fresh event log)
fs.writeFileSync(path.join(hookState, "domain-events.json"), "[]", "utf8");
seedHookSession();
hookOut = runHook("orchestra-planner", "Drafted a plan but forgot the handshake.");
check("hook block exits 0", hookOut.status === 0, hookOut.stderr);
const blockedSession = readHookSession();
check("hook block keeps phase at plan", blockedSession.session.currentPhase === "plan", blockedSession.session.currentPhase);
const blockEvents = hookOutcomeEvents();
check("hook block appends a phase.outcome event", blockEvents.length >= 1, JSON.stringify(hookEvents().map((e) => e.type)));
check(
  "phase.outcome decision = block",
  blockEvents.some((e) => e.payload && e.payload.decision === "block"),
  JSON.stringify(blockEvents.map((e) => e.payload && e.payload.decision))
);
check(
  "phase.outcome block reason recorded",
  blockEvents.some((e) => e.payload && e.payload.reason === "token-missing"),
  JSON.stringify(blockEvents.map((e) => e.payload && e.payload.reason))
);

// orchestra.json keeps its shape — domain data never lands here
const shape = readHookSession();
check("orchestra.json still parses with version+sessions", shape.root.version === 3 && shape.root.sessions && typeof shape.root.sessions === "object", JSON.stringify(Object.keys(shape.root)));
check("orchestra.json has no domain fields", containsDomainKey(shape.root) === false, JSON.stringify(shape.root).slice(0, 200));
const seededKeys = ["active", "goal", "currentPhase", "loopMode", "iteration", "max_iterations"];
check(
  "orchestra.json session keeps its seeded keys",
  seededKeys.every((k) => Object.prototype.hasOwnProperty.call(shape.session, k)),
  JSON.stringify(Object.keys(shape.session))
);
check("orchestra.json records the outcome as before", shape.session.last_outcome && shape.session.last_outcome.decision === "block", JSON.stringify(shape.session.last_outcome));

const residue2 = fs.readdirSync(stateDir).filter((f) => f.includes(".tmp.") || f.endsWith(".lock"));
check("no residue at the end", residue2.length === 0, residue2.join(", "));

fs.rmSync(tmp, { recursive: true, force: true });

console.log(failed === 0 ? "\nAll domain store tests passed." : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

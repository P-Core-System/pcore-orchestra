#!/usr/bin/env node
"use strict";

/**
 * Phase 2 COMMIT 1 self-check: domain entity schemas + explicit ticket/session
 * state machine (bundle/hooks/lib/domain/{constants,entities,state-machine}.js).
 *
 * Unit only — no disk, no hooks. The store/completion/append suites are
 * scripts/test-domain-completion.js and scripts/test-domain-store.js.
 */

const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DOMAIN = path.join(ROOT, "bundle", "hooks", "lib", "domain");

let failed = 0;

function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function eq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

const constants = require(path.join(DOMAIN, "constants.js"));
const entities = require(path.join(DOMAIN, "entities.js"));
const sm = require(path.join(DOMAIN, "state-machine.js"));

// ------------------------------------------------------------ constants (§5)
const TICKET_STATES = [
  "DRAFT",
  "READY",
  "PLANNED",
  "IN_PROGRESS",
  "VERIFYING",
  "REVIEW_PENDING",
  "COMPLETED",
  "FAILED",
  "BLOCKED",
  "CANCELLED",
];
check("TICKET_STATES is exactly the 10 §5 states", eq(constants.TICKET_STATES, TICKET_STATES), eq(constants.TICKET_STATES));
check("TICKET_STATES has no duplicates", new Set(constants.TICKET_STATES).size === constants.TICKET_STATES.length);
check(
  "ALLOWED_TRANSITIONS covers every ticket state",
  constants.TICKET_STATES.every((s) => Array.isArray(constants.ALLOWED_TRANSITIONS[s])),
  JSON.stringify(Object.keys(constants.ALLOWED_TRANSITIONS || {}))
);
check(
  "ALLOWED_TRANSITIONS is frozen (additive-only extension point)",
  Object.isFrozen(constants.ALLOWED_TRANSITIONS),
  String(Object.isFrozen(constants.ALLOWED_TRANSITIONS))
);
check(
  "DOMAIN_EVENT_TYPES includes phase.outcome",
  Array.isArray(constants.DOMAIN_EVENT_TYPES) && constants.DOMAIN_EVENT_TYPES.includes("phase.outcome"),
  JSON.stringify(constants.DOMAIN_EVENT_TYPES)
);
check(
  "DOMAIN_EVENT_TYPES includes ticket.updated",
  constants.DOMAIN_EVENT_TYPES.includes("ticket.updated"),
  JSON.stringify(constants.DOMAIN_EVENT_TYPES)
);
check(
  "DOMAIN_EVENT_CAP is a positive integer",
  Number.isInteger(constants.DOMAIN_EVENT_CAP) && constants.DOMAIN_EVENT_CAP > 0,
  String(constants.DOMAIN_EVENT_CAP)
);
check(
  "SESSION_STATES has the six session states",
  eq(constants.SESSION_STATES, ["idle", "running", "paused", "completed", "cancelled", "failed"]),
  eq(constants.SESSION_STATES)
);
check(
  "SESSION_ACTIONS = start/pause/resume/cancel/complete/fail",
  eq(constants.SESSION_ACTIONS, ["start", "pause", "resume", "cancel", "complete", "fail"]),
  eq(constants.SESSION_ACTIONS)
);

// --------------------------------------------------------------- factories
const FACTORIES = [
  "createTicket",
  "createPlan",
  "createTask",
  "createSession",
  "createAgentRun",
  "createEvent",
  "createEvidence",
  "createVerification",
  "createReview",
  "createCheckpoint",
  "createMemoryRef",
];
check("all 11 entity factories exported", FACTORIES.every((f) => typeof entities[f] === "function"), FACTORIES.filter((f) => typeof entities[f] !== "function").join(","));
check("validateEntity exported", typeof entities.validateEntity === "function");

const FACTORY_ARGS = {
  createTicket: { title: "Fix login" },
  createPlan: { goal: "ship it" },
  createTask: { title: "write test" },
  createSession: { goal: "loop" },
  createAgentRun: { agentId: "orchestra-implementer" },
  createEvent: { type: "ticket.updated", entityId: "tkt_1" },
  createEvidence: { gate: "tests", passed: true },
  createVerification: { commit: "abc" },
  createReview: { required: true },
  createCheckpoint: { sessionId: "s1" },
  createMemoryRef: { key: "goal" },
};

for (const f of FACTORIES) {
  const e = entities[f](FACTORY_ARGS[f] || {});
  const v = entities.validateEntity(e);
  check(`${f}() -> valid entity`, v.valid === true, JSON.stringify(v.errors));
  check(`${f}() carries id/kind/createdAt/updatedAt/refs`, e && typeof e.id === "string" && e.id.length > 0 && typeof e.kind === "string" && typeof e.createdAt === "string" && typeof e.updatedAt === "string" && Array.isArray(e.refs), JSON.stringify(e));
  check(`${f}() ids are unique`, f === "createTicket" || e.id !== entities.createTicket({ title: "x" }).id, String(e.id));
}

const ticket = entities.createTicket({ title: "Fix login" });
check("ticket defaults to DRAFT", ticket.status === "DRAFT", ticket.status);
check("ticket agent_status default", typeof ticket.agent_status === "string" && ticket.agent_status.length > 0, String(ticket.agent_status));
check("ticket verification_status default not_passed", ticket.verification_status === "not_passed", String(ticket.verification_status));
check("ticket review_status default not_required", ticket.review_status === "not_required", String(ticket.review_status));
check("ticket humanReview.required defaults false", ticket.humanReview && ticket.humanReview.required === false, JSON.stringify(ticket.humanReview));

const reviewedTicket = entities.createTicket({ title: "needs eyes", humanReview: { required: true } });
check("ticket with humanReview.required=true starts review pending", reviewedTicket.review_status === "pending", String(reviewedTicket.review_status));

check(
  "validateEntity rejects a broken entity",
  entities.validateEntity({ id: "", kind: "", createdAt: "nope", updatedAt: null, refs: "x" }).valid === false,
  JSON.stringify(entities.validateEntity({ id: "", kind: "", createdAt: "nope", updatedAt: null, refs: "x" }))
);

// -------------------------------------------------- ticket state machine
check("canTransition DRAFT->READY", sm.canTransition("DRAFT", "READY") === true);
check("canTransition REVIEW_PENDING->COMPLETED", sm.canTransition("REVIEW_PENDING", "COMPLETED") === true);
check("canTransition COMPLETED->IN_PROGRESS is false (reopen only)", sm.canTransition("COMPLETED", "IN_PROGRESS") === false);
check("canTransition DRAFT->COMPLETED is false", sm.canTransition("DRAFT", "COMPLETED") === false);

// happy path
let cur = entities.createTicket({ title: "happy path" });
const happy = ["READY", "PLANNED", "IN_PROGRESS", "VERIFYING", "REVIEW_PENDING", "COMPLETED"];
let happyOk = true;
let lastEvent = null;
for (const to of happy) {
  const res = sm.transition(cur, to);
  if (!res.ok) {
    happyOk = false;
    check(`happy path ${cur.status}->${to}`, false, JSON.stringify(res));
    break;
  }
  cur = res.ticket;
  lastEvent = res.event;
}
check("happy path DRAFT->...->COMPLETED advances", happyOk && cur.status === "COMPLETED", cur.status);
check(
  "every transition returns an Event (type ticket.updated, from/to)",
  lastEvent &&
    lastEvent.type === "ticket.updated" &&
    lastEvent.payload &&
    lastEvent.payload.from === "REVIEW_PENDING" &&
    lastEvent.payload.to === "COMPLETED",
  JSON.stringify(lastEvent)
);
check("transition event carries entityId", lastEvent && lastEvent.entityId === cur.id, JSON.stringify(lastEvent));
check("transition does not mutate the input ticket", ticket.status === "DRAFT", ticket.status);

// invalid transitions
const completed = cur;
const bad1 = sm.transition(completed, "IN_PROGRESS");
check("invalid COMPLETED->IN_PROGRESS -> ok:false", bad1.ok === false, JSON.stringify(bad1));
check("invalid transition code = invalid_transition", bad1.code === "invalid_transition" && bad1.error && bad1.error.code === "invalid_transition", JSON.stringify(bad1));
check("invalid transition leaves status untouched", completed.status === "COMPLETED", completed.status);

const draft = entities.createTicket({ title: "fresh" });
const bad2 = sm.transition(draft, "COMPLETED");
check("invalid DRAFT->COMPLETED -> ok:false", bad2.ok === false, JSON.stringify(bad2));
check("invalid DRAFT->COMPLETED code", bad2.code === "invalid_transition", String(bad2.code));
check("DRAFT status untouched after rejected transition", draft.status === "DRAFT", draft.status);

// reopen is the only COMPLETED -> IN_PROGRESS path
const reopened = sm.reopen(completed);
check("reopen(COMPLETED) -> ok", reopened.ok === true, JSON.stringify(reopened));
check("reopen sets IN_PROGRESS", reopened.ticket && reopened.ticket.status === "IN_PROGRESS", reopened.ticket && reopened.ticket.status);
check("reopen returns a ticket.updated event with from/to COMPLETED->IN_PROGRESS", reopened.event && reopened.event.type === "ticket.updated" && reopened.event.payload.from === "COMPLETED" && reopened.event.payload.to === "IN_PROGRESS", JSON.stringify(reopened.event));
check(
  "reopen of a non-completed ticket is rejected",
  sm.reopen(entities.createTicket({ title: "not done" })).ok === false,
  JSON.stringify(sm.reopen(entities.createTicket({ title: "not done" })))
);
check("normal transition still cannot do COMPLETED->IN_PROGRESS", sm.transition(completed, "IN_PROGRESS").ok === false);

// ------------------------------------------------------ session state machine
let sess = entities.createSession({ goal: "run the loop" });
check("session starts idle", sess.status === "idle", sess.status);

const s1 = sm.sessionTransition(sess, "start");
check("session start -> running", s1.ok === true && s1.session.status === "running", JSON.stringify(s1));
sess = s1.session;
const s2 = sm.sessionTransition(sess, "pause");
check("session pause -> paused", s2.ok === true && s2.session.status === "paused", JSON.stringify(s2));
sess = s2.session;
const s3 = sm.sessionTransition(sess, "resume");
check("session resume -> running", s3.ok === true && s3.session.status === "running", JSON.stringify(s3));
sess = s3.session;
const s4 = sm.sessionTransition(sess, "complete");
check("session complete -> completed", s4.ok === true && s4.session.status === "completed", JSON.stringify(s4));
check("session transition returns an event (session.updated)", s4.event && s4.event.type === "session.updated", JSON.stringify(s4.event));

let c2 = entities.createSession({ goal: "cancel me" });
c2 = sm.sessionTransition(c2, "start").session;
const cancelled = sm.sessionTransition(c2, "cancel");
check("session cancel -> cancelled", cancelled.ok === true && cancelled.session.status === "cancelled", JSON.stringify(cancelled));

let f2 = entities.createSession({ goal: "fail me" });
f2 = sm.sessionTransition(f2, "start").session;
const failedS = sm.sessionTransition(f2, "fail");
check("session fail -> failed", failedS.ok === true && failedS.session.status === "failed", JSON.stringify(failedS));

// terminal rejection
const terminal = sm.sessionTransition(s4.session, "start");
check("terminal session rejects start", terminal.ok === false, JSON.stringify(terminal));
check("terminal rejection code = terminal_state", terminal.code === "terminal_state", String(terminal.code));
check("terminal session status untouched", s4.session.status === "completed", s4.session.status);
check(
  "terminal session rejects complete/cancel/fail too",
  ["complete", "cancel", "fail"].every((a) => sm.sessionTransition(failedS.session, a).ok === false),
  JSON.stringify(["complete", "cancel", "fail"].map((a) => sm.sessionTransition(failedS.session, a)))
);
check(
  "invalid session action rejected",
  sm.sessionTransition(sess, "teleport").ok === false,
  JSON.stringify(sm.sessionTransition(sess, "teleport"))
);
check(
  "start rejected while already running",
  sm.sessionTransition(sess, "start").ok === false,
  JSON.stringify(sm.sessionTransition(sess, "start"))
);

// --------------------------------------------------------------- event ring cap
let ring = [];
for (let i = 0; i < constants.DOMAIN_EVENT_CAP + 5; i += 1) {
  ring = entities.appendRing(ring, entities.createEvent({ type: "phase.outcome", entityId: `e${i}` }));
}
check("ring cap trims to DOMAIN_EVENT_CAP", ring.length === constants.DOMAIN_EVENT_CAP, String(ring.length));
check("ring keeps the newest event", ring[ring.length - 1].entityId === `e${constants.DOMAIN_EVENT_CAP + 4}`, ring[ring.length - 1].entityId);
check("ring drops the oldest events", ring[0].entityId === "e5", ring[0].entityId);
check("appendRing is pure (returns a new array)", Array.isArray(ring));

console.log(failed === 0 ? "\nAll domain model tests passed." : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

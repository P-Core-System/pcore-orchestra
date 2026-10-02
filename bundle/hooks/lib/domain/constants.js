"use strict";

/**
 * Domain constants — the single vocabulary for the Core Domain Model.
 *
 * TICKET_STATES / ALLOWED_TRANSITIONS implement §5 of the Phase 2 plan.
 *
 * ALLOWED_TRANSITIONS is an **additive-only extension point**: new legal
 * edges may be added (e.g. a new review loop) but existing edges must never
 * be removed or narrowed without a schema-change note — consumers rely on
 * the table being a superset of what their state machine version allowed.
 * COMPLETED has NO outgoing edge: `reopen()` in state-machine.js is the one
 * explicit path back to IN_PROGRESS.
 */

const TICKET_STATES = Object.freeze([
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
]);

/** @type {Record<string, string[]>} legal ticket state edges (additive-only). */
const ALLOWED_TRANSITIONS = Object.freeze({
  DRAFT: ["READY", "CANCELLED"],
  READY: ["PLANNED", "DRAFT", "CANCELLED"],
  PLANNED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["VERIFYING", "FAILED", "BLOCKED", "CANCELLED"],
  VERIFYING: ["REVIEW_PENDING", "FAILED", "BLOCKED"],
  REVIEW_PENDING: ["COMPLETED", "IN_PROGRESS", "FAILED", "BLOCKED"],
  // Terminal via the table; reopen() is the explicit COMPLETED -> IN_PROGRESS path.
  COMPLETED: [],
  FAILED: ["IN_PROGRESS", "CANCELLED"],
  BLOCKED: ["IN_PROGRESS", "CANCELLED"],
  CANCELLED: [],
});

const SESSION_STATES = Object.freeze(["idle", "running", "paused", "completed", "cancelled", "failed"]);

const SESSION_ACTIONS = Object.freeze(["start", "pause", "resume", "cancel", "complete", "fail"]);

/** action -> { from: [allowed source states], to: target state } */
const SESSION_TRANSITIONS = Object.freeze({
  start: { from: ["idle"], to: "running" },
  pause: { from: ["running"], to: "paused" },
  resume: { from: ["paused"], to: "running" },
  cancel: { from: ["running", "paused"], to: "cancelled" },
  complete: { from: ["running"], to: "completed" },
  fail: { from: ["running"], to: "failed" },
});

const SESSION_TERMINAL_STATES = Object.freeze(["completed", "cancelled", "failed"]);

/** Domain event types persisted by domain/store.js (ring-capped file). */
const DOMAIN_EVENT_TYPES = Object.freeze([
  "ticket.updated",
  "session.updated",
  "task.updated",
  "agent_run.updated",
  "evidence.recorded",
  "verification.recorded",
  "review.recorded",
  "checkpoint.saved",
  "phase.outcome",
]);

/** Ring cap for the domain-events file: oldest events are trimmed first. */
const DOMAIN_EVENT_CAP = 500;

module.exports = {
  TICKET_STATES,
  ALLOWED_TRANSITIONS,
  SESSION_STATES,
  SESSION_ACTIONS,
  SESSION_TRANSITIONS,
  SESSION_TERMINAL_STATES,
  DOMAIN_EVENT_TYPES,
  DOMAIN_EVENT_CAP,
};

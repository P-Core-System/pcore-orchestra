"use strict";

/**
 * Domain entity factories — every entity is a plain JSON object with the
 * mandatory envelope { id, kind, createdAt, updatedAt, refs } plus
 * domain-specific fields. Factories never touch the disk (see store.js).
 *
 * `appendRing` is the shared ring-cap helper used by store.js so the event
 * file can never grow unbounded (oldest trimmed first).
 */

const { DOMAIN_EVENT_CAP, TICKET_STATES } = require("./constants.js");

let seq = 0;

/** Sortable, collision-resistant id: `<kind>_<time36><seq><rand>`. */
function newId(kind) {
  seq += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${kind}_${Date.now().toString(36)}${seq.toString(36)}${rand}`;
}

function baseEntity(kind, overrides) {
  const now = new Date().toISOString();
  const out = Object.assign({ id: newId(kind), kind, createdAt: now, updatedAt: now, refs: [] }, overrides || {});
  // envelope invariants — an override may never leave these missing/null
  if (typeof out.kind !== "string" || out.kind.length === 0) out.kind = kind;
  if (typeof out.id !== "string" || out.id.length === 0) out.id = newId(kind);
  if (typeof out.createdAt !== "string") out.createdAt = now;
  if (typeof out.updatedAt !== "string") out.updatedAt = now;
  if (!Array.isArray(out.refs)) out.refs = [];
  return out;
}

/**
 * Structural validation for the entity envelope.
 * @returns {{valid:boolean, errors:string[]}}
 */
function validateEntity(e) {
  const errors = [];
  if (!e || typeof e !== "object") return { valid: false, errors: ["not an object"] };
  if (typeof e.id !== "string" || e.id.length === 0) errors.push("id must be a non-empty string");
  if (typeof e.kind !== "string" || e.kind.length === 0) errors.push("kind must be a non-empty string");
  if (typeof e.createdAt !== "string" || Number.isNaN(Date.parse(e.createdAt))) errors.push("createdAt must be an ISO date string");
  if (typeof e.updatedAt !== "string" || Number.isNaN(Date.parse(e.updatedAt))) errors.push("updatedAt must be an ISO date string");
  if (!Array.isArray(e.refs)) errors.push("refs must be an array");
  return { valid: errors.length === 0, errors };
}

/**
 * Ticket — the unit of work the orchestra drives through TICKET_STATES.
 * `agent_status` is the AGENT'S CLAIM ("claimed_done"), never proof of
 * completion; `verification_status` / `review_status` come from evidence.
 * `humanReview.required` defaults to false → review_status "not_required".
 */
function createTicket(input) {
  const o = input || {};
  const humanReview = Object.assign({ required: false }, o.humanReview);
  const reviewStatus = humanReview.required
    ? (typeof o.review_status === "string" ? o.review_status : "pending")
    : "not_required";
  return baseEntity("ticket", Object.assign({}, o, {
    humanReview,
    status: typeof o.status === "string" && TICKET_STATES.includes(o.status) ? o.status : "DRAFT",
    agent_status: typeof o.agent_status === "string" ? o.agent_status : "pending",
    verification_status: typeof o.verification_status === "string" ? o.verification_status : "not_passed",
    review_status: reviewStatus,
  }));
}

function createPlan(input) {
  return baseEntity("plan", Object.assign({}, input));
}

function createTask(input) {
  const o = Object.assign({ status: "pending" }, input);
  return baseEntity("task", o);
}

function createSession(input) {
  const o = Object.assign({ status: "idle" }, input);
  return baseEntity("session", o);
}

function createAgentRun(input) {
  const o = Object.assign({ status: "running" }, input);
  return baseEntity("agent_run", o);
}

/** Domain event: { type, entityId, payload, at }. */
function createEvent(input) {
  const o = input || {};
  const e = baseEntity("event", {
    id: o.id,
    refs: o.refs,
    type: o.type,
    entityId: o.entityId || null,
    payload: o.payload || {},
    at: typeof o.at === "string" ? o.at : new Date().toISOString(),
  });
  return e;
}

function createEvidence(input) {
  const o = Object.assign({ passed: false }, input);
  return baseEntity("evidence", o);
}

function createVerification(input) {
  const o = Object.assign({ result: "not_passed", commit: null, diffHash: null }, input);
  return baseEntity("verification", o);
}

function createReview(input) {
  const o = Object.assign({ required: true, status: "pending", commit: null }, input);
  return baseEntity("review", o);
}

function createCheckpoint(input) {
  return baseEntity("checkpoint", Object.assign({}, input));
}

function createMemoryRef(input) {
  return baseEntity("memory_ref", Object.assign({}, input));
}

/**
 * Ring-capped append: returns a NEW array holding at most `cap` events,
 * oldest first (oldest trimmed first).
 */
function appendRing(events, event, cap) {
  const limit = Number.isInteger(cap) && cap > 0 ? cap : DOMAIN_EVENT_CAP;
  const list = Array.isArray(events) ? events.slice() : [];
  list.push(event);
  while (list.length > limit) list.shift();
  return list;
}

module.exports = {
  newId,
  baseEntity,
  validateEntity,
  createTicket,
  createPlan,
  createTask,
  createSession,
  createAgentRun,
  createEvent,
  createEvidence,
  createVerification,
  createReview,
  createCheckpoint,
  createMemoryRef,
  appendRing,
};

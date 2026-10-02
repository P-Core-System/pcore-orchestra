"use strict";

/**
 * Human-review queue — what is waiting on a person, derived from the domain
 * event log.
 *
 * Read-only by construction: the queue is a pure projection of
 * `store.loadEvents()` (see store.js — the single writer of domain-events.json).
 * This module must never touch the filesystem itself; an extra reader here
 * would bypass the lock/quarantine guarantees.
 *
 * Queue rules:
 *   opener  — `review.requested`, or `phase.outcome` with a `needs_human` decision
 *   closer  — `review.resolved`, or `phase.outcome` with an `advance` decision
 *   key     — `payload.ticketId`, else `entityId`, else `payload.phase`
 *   since   — the opener's `at` (fallback `createdAt`)
 *
 * The result is the still-open openers, oldest first (ties keep log order, so
 * a queue with identical timestamps is still deterministic).
 *
 * Fail-open: a missing, empty, corrupt or junk log yields `[]` and NEVER
 * throws — a queue that cannot be read must never block the review loop.
 */

const store = require("./store.js");

/** Heading the quality-gate hook injects; kept here so both stay in sync. */
const QUEUE_HEADING = "## Human review queue";

/** Event types that open / close a queue entry. */
const OPENER_TYPES = new Set(["review.requested"]);
const CLOSER_TYPES = new Set(["review.resolved"]);

/** phase.outcome decisions that open / close a queue entry. */
const OPEN_DECISIONS = new Set(["needs_human"]);
const CLOSE_DECISIONS = new Set(["advance"]);

function isEvent(e) {
  return !!e && typeof e === "object" && typeof e.type === "string";
}

function keyOf(e) {
  const payload = e.payload && typeof e.payload === "object" ? e.payload : {};
  const key = payload.ticketId || e.entityId || payload.phase || null;
  return typeof key === "string" && key.length > 0 ? key : null;
}

function sinceOf(e) {
  const raw = e.at || e.createdAt || "";
  const t = Date.parse(raw);
  return Number.isNaN(t) ? 0 : t;
}

function toEntry(e) {
  const payload = e.payload && typeof e.payload === "object" ? e.payload : {};
  return {
    ticketId: keyOf(e),
    phase: typeof payload.phase === "string" ? payload.phase : null,
    reason: typeof payload.reason === "string" ? payload.reason : null,
    since: typeof e.at === "string" && e.at.length > 0 ? e.at : (e.createdAt || null),
  };
}

/**
 * Open human-review items, oldest first.
 * @returns {Array<{ticketId:string|null, phase:string|null, reason:string|null, since:string|null}>}
 */
function pendingReview() {
  let events;
  try {
    events = store.loadEvents();
  } catch {
    return [];
  }
  if (!Array.isArray(events)) return [];

  const open = new Map(); // key -> {entry, seq, sinceMs}
  let seq = 0;
  for (const e of events) {
    if (!isEvent(e)) continue;
    const payload = e.payload && typeof e.payload === "object" ? e.payload : {};
    const decision = typeof payload.decision === "string" ? payload.decision : null;
    const opens = OPENER_TYPES.has(e.type) || (e.type === "phase.outcome" && OPEN_DECISIONS.has(decision));
    const closes = CLOSER_TYPES.has(e.type) || (e.type === "phase.outcome" && CLOSE_DECISIONS.has(decision));
    if (!opens && !closes) continue;

    const key = keyOf(e);
    if (!key) continue;
    if (closes) {
      open.delete(key);
      continue;
    }
    if (open.has(key)) continue; // first opener wins; a repeat request does not reset `since`
    open.set(key, { entry: toEntry(e), seq: seq++, sinceMs: sinceOf(e) });
  }

  return [...open.values()]
    .sort((a, b) => (a.sinceMs - b.sinceMs) || (a.seq - b.seq))
    .map((v) => v.entry);
}

/**
 * Markdown block for the quality-gate hook: the queue, or an explicit
 * "nothing to triage" line. Returns "" when there is nothing waiting.
 * @returns {string}
 */
function formatQueue(items) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return "";
  const lines = [QUEUE_HEADING, ""];
  for (const item of list) {
    const since = item.since ? ` since ${item.since}` : "";
    const phase = item.phase ? ` @${item.phase}` : "";
    const reason = item.reason ? ` — ${item.reason}` : "";
    lines.push(`- \`${item.ticketId}\`${phase}${reason}${since}`);
  }
  return lines.join("\n");
}

module.exports = {
  QUEUE_HEADING,
  OPENER_TYPES,
  CLOSER_TYPES,
  OPEN_DECISIONS,
  CLOSE_DECISIONS,
  pendingReview,
  formatQueue,
};
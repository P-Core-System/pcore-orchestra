"use strict";

/**
 * Core Domain Model — public barrel.
 *
 * Re-exports the whole domain (constants, entities, state machine,
 * completion gate, store, evidence, review queue) plus `recordPhaseOutcome`, the helper hooks call
 * to append a `phase.outcome` domain event whenever a subagent finishes.
 *
 * recordPhaseOutcome never throws on shape problems (defensive), but real
 * I/O errors propagate: callers (hook scripts) wrap it in try/catch and stay
 * fail-open — the domain log must never break the host hook.
 */

const constants = require("./constants.js");
const entities = require("./entities.js");
const stateMachine = require("./state-machine.js");
const completion = require("./completion.js");
const store = require("./store.js");
const evidence = require("./evidence.js");
const reviewQueue = require("./review-queue.js");

/**
 * Build + persist the `phase.outcome` event for a finished subagent.
 *
 * A `block` / `needs_human` outcome also produces the human-review queue
 * opener: a `review.requested` event keyed to the run's ticket. The ticket
 * comes from `state.memory.ticketId` (minted at intake); when absent, a
 * blocked ticket is created here so the queue item still has a stable id.
 *
 * @param {object|null} state   session/current state (currentPhase, goal, ...)
 * @param {object|null} outcome outcome record (decision, reason, phase, token)
 * @param {string|null} subagentType
 * @param {string|null} [worktreePath] optional worktree path for isolation
 * @returns {object} the stored phase.outcome event
 */
function recordPhaseOutcome(state, outcome, subagentType, worktreePath) {
  const s = state || {};
  const o = outcome || {};
  const phase = o.phase || s.currentPhase || null;
  const decision = o.decision || null;
  const needsReview =
    decision === "block" || decision === "needs_human" || o.needs_human === true;
  const sessionId = s.sessionId || s.session_id || null;

  let ticketId = s.memory && typeof s.memory.ticketId === "string" && s.memory.ticketId
    ? s.memory.ticketId
    : null;
  if (needsReview && !ticketId) {
    try {
      ticketId = entities.createTicket({
        title: s.goal || "orchestra run",
        goal: s.goal || null,
        status: "BLOCKED",
        humanReview: {
          required: true,
          reason: o.reason || decision || "blocked",
          requestedAt: new Date().toISOString(),
        },
      }).id;
    } catch {
      /* fail-open — the queue falls back to entityId/phase keys */
    }
  }

  const event = entities.createEvent({
    type: "phase.outcome",
    entityId: sessionId,
    payload: {
      phase,
      decision,
      reason: o.reason || null,
      token: o.token || null,
      subagentType: subagentType || s.last_subagent || null,
      goal: s.goal || null,
      ticketId: ticketId || null,
      needs_human: needsReview ? true : undefined,
    },
  });
  const stored = store.appendEvent(event, { worktreePath });

  if (needsReview) {
    try {
      store.appendEvent(
        entities.createEvent({
          type: "review.requested",
          entityId: sessionId,
          payload: {
            ticketId: ticketId || null,
            phase,
            reason: o.reason || null,
            decision,
            subagentType: subagentType || s.last_subagent || null,
            goal: s.goal || null,
            humanReview: { required: true },
          },
        }),
        { worktreePath }
      );
    } catch {
      /* fail-open — queue projection still opens on the block outcome */
    }
  }
  return stored;
}

module.exports = Object.assign(
  {
    constants,
    entities,
    stateMachine,
    completion,
    store,
    evidence,
    reviewQueue,
    recordPhaseOutcome,
  },
  constants,
  entities,
  stateMachine,
  completion,
  store,
  evidence,
  reviewQueue
);

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
 * @param {object|null} state   session/current state (currentPhase, goal, ...)
 * @param {object|null} outcome outcome record (decision, reason, phase, token)
 * @param {string|null} subagentType
 * @returns {object} the stored event
 */
function recordPhaseOutcome(state, outcome, subagentType) {
  const s = state || {};
  const o = outcome || {};
  const event = entities.createEvent({
    type: "phase.outcome",
    entityId: s.sessionId || s.session_id || null,
    payload: {
      phase: o.phase || s.currentPhase || null,
      decision: o.decision || null,
      reason: o.reason || null,
      token: o.token || null,
      subagentType: subagentType || s.last_subagent || null,
      goal: s.goal || null,
    },
  });
  return store.appendEvent(event);
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

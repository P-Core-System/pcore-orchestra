"use strict";

/**
 * Explicit ticket + session state machine.
 *
 * Ticket transitions are table-driven from ALLOWED_TRANSITIONS (constants.js).
 * COMPLETED has no table edge: `reopen()` is the ONE explicit path back to
 * IN_PROGRESS. Every successful transition returns a NEW ticket (the input is
 * never mutated) plus a `ticket.updated` event carrying {from, to}.
 *
 * Failures never mutate anything: { ok:false, code, error } with
 * code = "invalid_transition" | "not_reopenable" | "invalid_action" |
 * "terminal_state" | "unknown_state".
 */

const {
  ALLOWED_TRANSITIONS,
  TICKET_STATES,
  SESSION_TRANSITIONS,
  SESSION_TERMINAL_STATES,
} = require("./constants.js");
const { createEvent } = require("./entities.js");

function fail(code, message, extra) {
  return Object.assign({ ok: false, code, error: Object.assign({ code, message }, extra) }, extra || {});
}

/** Is `to` a legal next state for `from`? Unknown states are never legal. */
function canTransition(from, to) {
  const edges = ALLOWED_TRANSITIONS[from];
  return Array.isArray(edges) && edges.includes(to);
}

/**
 * @param {object} ticket current ticket (not mutated on failure)
 * @param {string} to target state
 * @returns {{ok:true,ticket:object,event:object}|{ok:false,code:string,error:object}}
 */
function transition(ticket, to) {
  const from = ticket && ticket.status;
  if (!TICKET_STATES.includes(from)) {
    return fail("unknown_state", `Unknown ticket state "${from}".`, { from, to });
  }
  if (!TICKET_STATES.includes(to)) {
    return fail("unknown_state", `Unknown target state "${to}".`, { from, to });
  }
  if (!canTransition(from, to)) {
    return fail("invalid_transition", `Illegal ticket transition ${from} -> ${to}.`, { from, to });
  }
  const next = Object.assign({}, ticket, { status: to, updatedAt: new Date().toISOString() });
  const event = createEvent({
    type: "ticket.updated",
    entityId: ticket.id,
    payload: { from, to },
  });
  return { ok: true, ticket: next, event };
}

/**
 * The only COMPLETED -> IN_PROGRESS path.
 * @returns {{ok:true,ticket:object,event:object}|{ok:false,code:string,error:object}}
 */
function reopen(ticket) {
  const from = ticket && ticket.status;
  if (from !== "COMPLETED") {
    return fail("not_reopenable", `Only a COMPLETED ticket can be reopened (is "${from}").`, { from, to: "IN_PROGRESS" });
  }
  const next = Object.assign({}, ticket, { status: "IN_PROGRESS", updatedAt: new Date().toISOString() });
  const event = createEvent({
    type: "ticket.updated",
    entityId: ticket.id,
    payload: { from: "COMPLETED", to: "IN_PROGRESS" },
  });
  return { ok: true, ticket: next, event };
}

/**
 * Session lifecycle: start | pause | resume | cancel | complete | fail.
 * Terminal sessions (completed/cancelled/failed) reject every action.
 * @returns {{ok:true,session:object,event:object}|{ok:false,code:string,error:object}}
 */
function sessionTransition(session, action) {
  const from = session && session.status;
  if (!SESSION_TRANSITIONS[action]) {
    return fail("invalid_action", `Unknown session action "${action}".`, { from, action });
  }
  if (SESSION_TERMINAL_STATES.includes(from)) {
    return fail("terminal_state", `Session is terminal ("${from}"); "${action}" rejected.`, { from, action });
  }
  const rule = SESSION_TRANSITIONS[action];
  if (!rule.from.includes(from)) {
    return fail("invalid_transition", `Illegal session transition: "${action}" not allowed from "${from}".`, { from, action, to: rule.to });
  }
  const next = Object.assign({}, session, { status: rule.to, updatedAt: new Date().toISOString() });
  const event = createEvent({
    type: "session.updated",
    entityId: session.id,
    payload: { action, from, to: rule.to },
  });
  return { ok: true, session: next, event };
}

module.exports = {
  canTransition,
  transition,
  reopen,
  sessionTransition,
};

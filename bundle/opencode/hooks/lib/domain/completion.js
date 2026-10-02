"use strict";

/**
 * Claimed-vs-verified completion gate.
 *
 * An agent SAYING it is done (`claimDone` → `agent_status: "claimed_done"`)
 * is a claim, never proof: `evaluateCompletion` ignores the claim for the
 * verdict and only accepts *evidence* — passed verification, required
 * acceptance results, required human review (when the ticket asks for it)
 * and green gates.
 *
 * NO git calls: the caller passes `currentCommit` / `currentDiffHash` (and
 * records them via `startVerification` / `recordVerification`). A `null`
 * commit means "unknown" and is deliberately **not stale** — staleness is
 * only asserted when BOTH the recorded and current commits are known and
 * differ.
 */

const { createVerification } = require("./entities.js");
const { transition } = require("./state-machine.js");

/** Claim completion without changing ticket state. */
function claimDone(ticket) {
  const from = ticket && ticket.agent_status;
  const next = Object.assign({}, ticket, {
    agent_status: "claimed_done",
    claimed_done_at: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return {
    ok: true,
    ticket: next,
    event: { type: "ticket.updated", entityId: ticket && ticket.id, payload: { field: "agent_status", from, to: "claimed_done" } },
  };
}

/** Open a verification record pinned to the commit/diff it will judge. */
function startVerification(input) {
  const o = input || {};
  return createVerification({
    ticketId: o.ticketId || o.ticket_id || null,
    result: "pending",
    commit: o.commit == null ? null : o.commit,
    diffHash: o.diffHash == null ? null : o.diffHash,
    startedAt: new Date().toISOString(),
  });
}

/** Record the outcome of a verification, keeping commit+diffHash. */
function recordVerification(verification, patch) {
  const p = patch || {};
  return Object.assign({}, verification, {
    result: typeof p.result === "string" ? p.result : verification.result,
    commit: p.commit === undefined || p.commit === null ? (verification.commit == null ? null : verification.commit) : p.commit,
    diffHash:
      p.diffHash === undefined || p.diffHash === null
        ? (verification.diffHash == null ? null : verification.diffHash)
        : p.diffHash,
    recordedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

/** Accepts {failed:[...]} (qualityGates shape) or a plain array of failed ids. */
function failedGateIds(gates) {
  if (!gates) return [];
  if (Array.isArray(gates)) return gates.filter(Boolean);
  if (Array.isArray(gates.failed)) {
    return gates.failed.map((g) => (typeof g === "string" ? g : g && g.id)).filter(Boolean);
  }
  return [];
}

function knownCommit(v) {
  return v != null && v !== "" ? v : null;
}

/**
 * @param {object} input
 * @param {object} input.ticket
 * @param {object|null} input.verification
 * @param {object|array|null} input.gates
 * @param {array|null} input.acResults  [{id, required, result}]
 * @param {object|null} input.review    {status, commit}
 * @param {string|null} input.currentCommit
 * @param {string|null} input.currentDiffHash
 * @returns {{complete:boolean, reasons:string[], checks:object}}
 */
function evaluateCompletion(input) {
  const i = input || {};
  const ticket = i.ticket || {};
  const verification = i.verification || null;
  const review = i.review || null;
  const humanRequired = !!(ticket.humanReview && ticket.humanReview.required);
  const current = knownCommit(i.currentCommit);

  const checks = {};
  const reasons = [];

  checks.agent_claimed = ticket.agent_status === "claimed_done"; // claim, never proof
  checks.verification_passed = !!verification && verification.result === "passed";
  const verifiedAt = knownCommit(verification && verification.commit);
  checks.verification_fresh = !(verifiedAt && current && verifiedAt !== current);

  const acList = Array.isArray(i.acResults) ? i.acResults : [];
  const requiredAcs = acList.filter((a) => a && a.required !== false);
  const missingAcs = requiredAcs.filter((a) => a.result !== "passed");
  checks.acceptance_passed = missingAcs.length === 0;
  checks.missing_acceptance = missingAcs.map((a) => a.id).filter(Boolean);

  if (humanRequired) {
    checks.review_satisfied = !!review && review.status === "approved";
    const reviewedAt = knownCommit(review && review.commit);
    checks.review_fresh = !(checks.review_satisfied && reviewedAt && current && reviewedAt !== current);
  } else {
    checks.review_satisfied = true; // not_required — no human needed
    checks.review_fresh = true;
  }

  checks.gates_green = failedGateIds(i.gates).length === 0;

  const evidenceRecord = i.evidence || null;
  const currentCommitKnown = current ? true : false;
  const recordCommitKnown = knownCommit(evidenceRecord && evidenceRecord.commit) ? true : false;
  checks.evidence_passed = evidenceRecord ? !!evidenceRecord.ok : true;
  checks.evidenceStale = false;
  if (evidenceRecord && recordCommitKnown && currentCommitKnown) {
    const rc = knownCommit(evidenceRecord.commit);
    checks.evidenceStale = rc !== current;
  }
  if (checks.evidence_passed && checks.evidenceStale) {
    checks.evidence_passed = false;
  }

  if (!checks.verification_passed) reasons.push("verification_not_passed");
  if (!checks.acceptance_passed) reasons.push("acceptance_missing");
  if (humanRequired && !checks.review_satisfied) reasons.push("review_required");
  if (humanRequired && checks.review_satisfied && !checks.review_fresh) reasons.push("review_stale");
  if (!checks.verification_fresh) reasons.push("verification_stale");
  if (!checks.gates_green) reasons.push("gates_failed");
  if (!checks.evidence_passed) reasons.push(checks.evidenceStale ? "evidence_stale" : "evidence_failed");

  return { complete: reasons.length === 0, reasons, checks };
}

/**
 * Move the ticket to COMPLETED only when the evaluation says it is complete.
 * @returns {{ok:true,ticket:object,event:object}|{ok:false,code:string,reasons:string[],error:object}}
 */
function applyCompletion(ticket, evaluation) {
  if (!evaluation || evaluation.complete !== true) {
    const reasons = (evaluation && evaluation.reasons) || [];
    return {
      ok: false,
      code: "not_complete",
      reasons,
      error: { code: "not_complete", message: `Completion refused: ${reasons.join(", ") || "no evaluation"}.`, reasons },
    };
  }
  return transition(ticket, "COMPLETED");
}

module.exports = {
  claimDone,
  startVerification,
  recordVerification,
  evaluateCompletion,
  applyCompletion,
  failedGateIds,
};

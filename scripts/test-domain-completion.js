#!/usr/bin/env node
"use strict";

/**
 * Phase 2 COMMIT 2 self-check: claimed-vs-verified completion gate.
 *
 * Core rule: an agent SAYING it is done (`claimDone`) never completes a
 * ticket — completion requires passed verification (at the current commit),
 * required acceptance results, required human review (when the ticket asks
 * for it) and green gates.
 *
 * Scenarios B, E, F, G, H from the Phase 2 plan.
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

const entities = require(path.join(DOMAIN, "entities.js"));
const completion = require(path.join(DOMAIN, "completion.js"));

const GREEN_GATES = { passed: [{ id: "tests" }], failed: [], skipped: [], allRequiredPassed: true };
const RED_GATES = { passed: [], failed: [{ id: "tests", reason: "2 red" }], skipped: [], allRequiredPassed: false };

function verifyAt(commit, diffHash, result) {
  const v = completion.startVerification({ ticketId: "tkt_1", commit, diffHash });
  return completion.recordVerification(v, { result: result || "passed", commit, diffHash });
}

// ------------------------------------------------------- Scenario B: claim only
const bTicket = entities.createTicket({ title: "B: claim only" });
const claimed = completion.claimDone(bTicket);
check("B claimDone -> ok", claimed.ok === true, JSON.stringify(claimed));
check("B claimDone sets agent_status=claimed_done", claimed.ticket.agent_status === "claimed_done", String(claimed.ticket.agent_status));
check("B claimDone leaves status UNCHANGED", claimed.ticket.status === bTicket.status && claimed.ticket.status === "DRAFT", claimed.ticket.status);
check("B input ticket not mutated", bTicket.agent_status !== "claimed_done", bTicket.agent_status);

const bEval = completion.evaluateCompletion({
  ticket: claimed.ticket,
  verification: null,
  gates: GREEN_GATES,
  acResults: [],
  review: null,
  currentCommit: null,
  currentDiffHash: null,
});
check("B claim alone -> complete:false", bEval.complete === false, JSON.stringify(bEval));
check(
  "B reason = verification_not_passed",
  Array.isArray(bEval.reasons) && bEval.reasons.includes("verification_not_passed"),
  JSON.stringify(bEval.reasons)
);
check("B checks recorded", bEval.checks && bEval.checks.agent_claimed === true && bEval.checks.verification_passed === false, JSON.stringify(bEval.checks));

// claimed_done + passed verification but nothing else still not complete? -> covered by E/G below.

// ------------------------------------------- Scenario E: required AC not passed
const eTicket = entities.createTicket({ title: "E: acceptance" });
const eEval = completion.evaluateCompletion({
  ticket: eTicket,
  verification: verifyAt("A", "dA"),
  gates: GREEN_GATES,
  acResults: [
    { id: "AC1", required: true, result: "passed" },
    { id: "AC2", required: true, result: "failed" },
  ],
  review: null,
  currentCommit: "A",
  currentDiffHash: "dA",
});
check("E required AC without passed result -> complete:false", eEval.complete === false, JSON.stringify(eEval));
check(
  "E reason = acceptance_missing",
  eEval.reasons.includes("acceptance_missing"),
  JSON.stringify(eEval.reasons)
);

const eEvalPending = completion.evaluateCompletion({
  ticket: eTicket,
  verification: verifyAt("A", "dA"),
  gates: GREEN_GATES,
  acResults: [{ id: "AC1", required: true, result: "pending" }],
  review: null,
  currentCommit: "A",
  currentDiffHash: "dA",
});
check("E pending required AC -> acceptance_missing", eEvalPending.complete === false && eEvalPending.reasons.includes("acceptance_missing"), JSON.stringify(eEvalPending.reasons));

// --------------------------------- Scenario F: verification PASS, no human review
const fTicket = entities.createTicket({ title: "F: no human", status: "REVIEW_PENDING" });
check("F ticket has humanReview.required=false", fTicket.humanReview.required === false, JSON.stringify(fTicket.humanReview));
const fEval = completion.evaluateCompletion({
  ticket: fTicket,
  verification: verifyAt("A", "dA"),
  gates: GREEN_GATES,
  acResults: [{ id: "AC1", required: true, result: "passed" }],
  review: null,
  currentCommit: "A",
  currentDiffHash: "dA",
});
check("F complete:true without a human", fEval.complete === true, JSON.stringify(fEval));
check("F reasons empty", Array.isArray(fEval.reasons) && fEval.reasons.length === 0, JSON.stringify(fEval.reasons));
check("F review check marked not_required", fEval.checks && fEval.checks.review_satisfied === true, JSON.stringify(fEval.checks));

const fApplied = completion.applyCompletion(fTicket, fEval);
check("F applyCompletion -> ok", fApplied.ok === true, JSON.stringify(fApplied));
check("F ticket COMPLETED", fApplied.ticket && fApplied.ticket.status === "COMPLETED", fApplied.ticket && fApplied.ticket.status);
check("F applyCompletion returns an event", fApplied.event && fApplied.event.type === "ticket.updated", JSON.stringify(fApplied.event));

// ---------------------------------------- Scenario G: required human review
const gTicket = entities.createTicket({ title: "G: human review", status: "REVIEW_PENDING", humanReview: { required: true } });
check("G ticket review_status pending", gTicket.review_status === "pending", gTicket.review_status);
const gBase = {
  ticket: gTicket,
  verification: verifyAt("A", "dA"),
  gates: GREEN_GATES,
  acResults: [{ id: "AC1", required: true, result: "passed" }],
  currentCommit: "A",
  currentDiffHash: "dA",
};
const gPending = completion.evaluateCompletion(Object.assign({}, gBase, { review: { status: "pending", commit: null } }));
check("G required review pending -> complete:false", gPending.complete === false, JSON.stringify(gPending));
check(
  "G reason = review_required",
  gPending.reasons.includes("review_required"),
  JSON.stringify(gPending.reasons)
);

const gApproved = completion.evaluateCompletion(Object.assign({}, gBase, { review: { status: "approved", commit: "A" } }));
check("G approve at same commit -> complete:true", gApproved.complete === true, JSON.stringify(gApproved));
const gApplied = completion.applyCompletion(gTicket, gApproved);
check("G applyCompletion -> COMPLETED", gApplied.ok === true && gApplied.ticket.status === "COMPLETED", JSON.stringify(gApplied));

// --------------------------------------------- Scenario H: staleness + gates
const hTicket = entities.createTicket({ title: "H: staleness", humanReview: { required: true } });
const hBase = {
  ticket: hTicket,
  acResults: [{ id: "AC1", required: true, result: "passed" }],
  gates: GREEN_GATES,
};

const hReviewStale = completion.evaluateCompletion(
  Object.assign({}, hBase, {
    verification: verifyAt("B", "dB"),
    review: { status: "approved", commit: "A" },
    currentCommit: "B",
    currentDiffHash: "dB",
  })
);
check("H approval at commit A vs current B -> complete:false", hReviewStale.complete === false, JSON.stringify(hReviewStale));
check(
  "H reason = review_stale",
  hReviewStale.reasons.includes("review_stale"),
  JSON.stringify(hReviewStale.reasons)
);

const hVerifyStale = completion.evaluateCompletion(
  Object.assign({}, hBase, {
    verification: verifyAt("A", "dA"),
    review: { status: "approved", commit: "B" },
    currentCommit: "B",
    currentDiffHash: "dB",
  })
);
check("H verification at commit A vs current B -> complete:false", hVerifyStale.complete === false, JSON.stringify(hVerifyStale));
check(
  "H reason = verification_stale",
  hVerifyStale.reasons.includes("verification_stale"),
  JSON.stringify(hVerifyStale.reasons)
);

const hGates = completion.evaluateCompletion(
  Object.assign({}, hBase, {
    verification: verifyAt("A", "dA"),
    review: { status: "approved", commit: "A" },
    currentCommit: "A",
    currentDiffHash: "dA",
    gates: RED_GATES,
  })
);
check("H failed gates -> complete:false", hGates.complete === false, JSON.stringify(hGates));
check("H reason = gates_failed", hGates.reasons.includes("gates_failed"), JSON.stringify(hGates.reasons));

const hClaimOnly = completion.evaluateCompletion(
  Object.assign({}, hBase, {
    ticket: completion.claimDone(entities.createTicket({ title: "H: claim only" })).ticket,
    verification: null,
    review: null,
    currentCommit: "A",
    currentDiffHash: "dA",
  })
);
check("H claimed_done alone never completes", hClaimOnly.complete === false, JSON.stringify(hClaimOnly));

// null commit = unknown, not stale
const hNullCurrent = completion.evaluateCompletion(
  Object.assign({}, hBase, {
    verification: verifyAt("A", "dA"),
    review: { status: "approved", commit: "A" },
    currentCommit: null,
    currentDiffHash: null,
  })
);
check("H null currentCommit -> not stale (complete:true)", hNullCurrent.complete === true, JSON.stringify(hNullCurrent));
check(
  "H null verification.commit -> not stale",
  completion.evaluateCompletion(
    Object.assign({}, hBase, {
      verification: completion.recordVerification(completion.startVerification({ ticketId: "t" }), { result: "passed" }),
      review: { status: "approved", commit: "B" },
      currentCommit: "B",
      currentDiffHash: "dB",
    })
  ).complete === true,
  JSON.stringify(
    completion.evaluateCompletion(
      Object.assign({}, hBase, {
        verification: completion.recordVerification(completion.startVerification({ ticketId: "t" }), { result: "passed" }),
        review: { status: "approved", commit: "B" },
        currentCommit: "B",
        currentDiffHash: "dB",
      })
    )
  )
);

// ----------------------------------------------- verification records commit+diff
const v0 = completion.startVerification({ ticketId: "tkt_1", commit: "A", diffHash: "dA" });
check("startVerification is pending", v0.result === "pending" || v0.result === "in_progress", String(v0.result));
check("startVerification records commit+diffHash", v0.commit === "A" && v0.diffHash === "dA", JSON.stringify({ c: v0.commit, d: v0.diffHash }));
const v1 = completion.recordVerification(v0, { result: "passed", commit: "B", diffHash: "dB" });
check("recordVerification -> passed with commit+diffHash", v1.result === "passed" && v1.commit === "B" && v1.diffHash === "dB", JSON.stringify(v1));
check("recordVerification keeps the envelope valid", entities.validateEntity(v1).valid === true, JSON.stringify(entities.validateEntity(v1)));

// ------------------------------------ applyCompletion refuses when not complete
const refuse = completion.applyCompletion(hTicket, hGates);
check("applyCompletion refuses an incomplete evaluation", refuse.ok === false, JSON.stringify(refuse));
check(
  "applyCompletion refusal code = not_complete",
  refuse.code === "not_complete",
  String(refuse.code)
);
check("refusal leaves the ticket status untouched", hTicket.status === "DRAFT", hTicket.status);

console.log(failed === 0 ? "\nAll domain completion tests passed." : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

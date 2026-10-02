"use strict";

/**
 * Phase outcome gate — decides whether a completed subagent may advance.
 *
 * Contract (core loop):
 *   plan     -> PLAN_READY
 *   implement-> IMPLEMENT_DONE
 *   verify   -> VERIFY_PASS | VERIFY_FAIL
 *   review   -> ORCHESTRA_COMPLETE | FIX_REQUIRED
 *
 * Decision precedence: fix > block > advance.
 *   fix    — verify/review emitted FIX_REQUIRED or VERIFY_FAIL → replay implement.
 *   block  — a required quality gate is red at a gate-enforced phase
 *            (verify/review), or the end token is missing from non-empty
 *            output. Records PHASE_BLOCKED_EVENT and returns a corrective
 *            message. The phase does NOT advance.
 *   advance- token matched (and, at verify/review, gates green).
 *
 * Gate scoping (GATE_ENFORCED_PHASES = verify, review):
 *   only verify/review re-evaluate evidence, so they are the only phases that
 *   may block on red gates. plan/implement advance on their own end token even
 *   while gates stay red — otherwise a red test run deadlocks the fix loop
 *   (the implementer cannot clear gates and no evidence re-run is reachable).
 *   Red evidence stays visible in state; nothing is cleared.
 *
 * Precedence within a phase: failed-gates is checked BEFORE the empty-output
 * advance, so silent output can never finish a run with red gates.
 *
 * Deliberate non-blocks (avoid bricking a run):
 *   - empty / absent subagent output at a non-gate-enforced phase (or with
 *     green gates) → advance + warning (nothing to judge).
 *   - enterprise SDLC phases and unknown phases have no token contract →
 *     advance + warning only.
 */

const { PHASE_END_TOKENS, PHASE_BLOCKED_EVENT, LOOP_MODE_ENTERPRISE } = require("./constants.js");

const OUTPUT_FIELDS = ["summary", "result", "output", "final_text", "text"];
const FIX_PHASES = new Set(["verify", "review"]);
const GATE_ENFORCED_PHASES = new Set(["verify", "review"]);
const FIX_RE = /\b(FIX_REQUIRED|VERIFY_FAIL)\b/i;

/** Join every text field a hook may carry into one blob. */
function outputBlob(input) {
  if (!input || typeof input !== "object") return "";
  return OUTPUT_FIELDS.map((f) => input[f]).filter(Boolean).join("\n").trim();
}

function tokensFor(phase, loopMode) {
  if (loopMode === LOOP_MODE_ENTERPRISE) return null;
  const tokens = PHASE_END_TOKENS[phase];
  return Array.isArray(tokens) && tokens.length > 0 ? tokens : null;
}

function matchToken(tokens, blob) {
  if (!tokens) return null;
  const re = new RegExp(`\\b(${tokens.join("|")})\\b`);
  const m = re.exec(blob);
  return m ? m[1] : null;
}

function failedGateIds(qualityGates) {
  if (!qualityGates || !Array.isArray(qualityGates.failed)) return [];
  return qualityGates.failed.map((g) => (typeof g === "string" ? g : g.id)).filter(Boolean);
}

function blockResult(phase, reason, expected, message) {
  return { decision: "block", phase, reason, expected, token: null, message, warning: null, needs_human: true };
}

function advanceResult(phase, reason, token, warning) {
  return { decision: "advance", phase, reason, expected: PHASE_END_TOKENS[phase] || null, token, message: null, warning: warning || null };
}

function fixResult(phase, token) {
  return {
    decision: "fix",
    phase,
    reason: "fix-token",
    expected: PHASE_END_TOKENS[phase] || null,
    token,
    message: null,
    warning: null,
  };
}

/**
 * @param {object} state session state (currentPhase, loopMode, qualityGates)
 * @param {object} input hook stdin payload
 * @returns {{decision:"advance"|"block"|"fix", phase:string, reason:string,
 *   expected:string[]|null, token:string|null, message:string|null, warning:string|null}}
 */
function evaluatePhaseOutcome(state, input) {
  const phase = (state && state.currentPhase) || "";
  const loopMode = (state && state.loopMode) || "core";
  const blob = outputBlob(input);
  const expected = tokensFor(phase, loopMode);

  // 1. fix wins over everything: the loop must go back to implement.
  if (FIX_PHASES.has(phase) && FIX_RE.test(blob)) {
    return fixResult(phase, (blob.match(FIX_RE) || [])[1] || null);
  }

  // 2. no contract to enforce (enterprise SDLC / unknown phase) → warn only.
  if (!expected) {
    const warning =
      loopMode === LOOP_MODE_ENTERPRISE
        ? `Enterprise phase "${phase}" has no end-token contract — advancing without outcome verification.`
        : `Phase "${phase}" has no end-token contract — advancing without outcome verification.`;
    return advanceResult(phase, "unenforced-phase", null, warning);
  }

  // 3. required gates must be green before verify/review move on (P0-1).
  //    Phase-scoped: plan/implement are not gate-enforced — they advance on
  //    their own end token (verify re-runs evidence on entry; the implementer
  //    cannot clear gates). Checked BEFORE the empty-output advance below so
  //    silent output never finishes a run with red gates.
  if (GATE_ENFORCED_PHASES.has(phase)) {
    const red = failedGateIds(state.qualityGates);
    if (red.length > 0) {
      return blockResult(
        phase,
        "failed-gates",
        expected,
        [
          `Orchestra blocked at phase **${phase}** — required quality gate(s) failed: ${red.join(", ")}.`,
          `Resolve the failures (re-run the checks), then re-run the ${phase} subagent.`,
          `Expected end token: ${expected.join(" or ")}.`,
        ].join("\n\n")
      );
    }
  }

  // 4. nothing to judge → advance with a warning (never brick on silence).
  if (!blob) {
    return advanceResult(phase, "empty-output", null, `Subagent returned no output for phase "${phase}" — cannot verify ${expected.join("|")}.`);
  }

  // 5. end token contract.
  const token = matchToken(expected, blob);
  if (!token) {
    return blockResult(
      phase,
      "token-missing",
      expected,
      [
        `Orchestra blocked at phase **${phase}** — the subagent output is missing its end token.`,
        `Reply with **${expected.join(" or ")}** on completion (first line of the handoff) to let the loop advance.`,
        `Goal: ${state.goal || "(unset)"}`,
      ].join("\n\n")
    );
  }

  return advanceResult(phase, "token-matched", token, null);
}

module.exports = {
  evaluatePhaseOutcome,
  outputBlob,
  matchToken,
  failedGateIds,
  PHASE_BLOCKED_EVENT,
};

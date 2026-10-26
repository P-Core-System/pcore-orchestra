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
 * Verdict accuracy (verify/review):
 *   The verdict is the LAST line in the output that carries a token for the
 *   current phase. Scanning backwards means:
 *     - prose may quote a failure token ("the previous run was VERIFY_FAIL")
 *       without forcing a fix replay — a later VERIFY_PASS wins;
 *     - a quoted VERIFY_FAIL in a reviewer's findings no longer forces a fix,
 *       because review only recognises ORCHESTRA_COMPLETE / FIX_REQUIRED;
 *     - the token must be the verdict itself; if none exists the run blocks
 *       for a missing token instead of guessing from prose.
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
// Every phase token is either a pass verdict or a fix verdict.
const FIX_TOKENS = new Set(["VERIFY_FAIL", "FIX_REQUIRED"]);

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

/**
 * Walk the output backwards and return the last line carrying a phase token.
 * When the line holds several tokens, the right-most one is the verdict.
 * @returns {{token:string, line:number, last:boolean}|null}
 */
function lastVerdictToken(tokens, blob) {
  if (!tokens || !blob) return null;
  const lines = blob
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const re = new RegExp(`\\b(${tokens.join("|")})\\b`, "g");
  for (let i = lines.length - 1; i >= 0; i--) {
    re.lastIndex = 0;
    let m;
    let token = null;
    while ((m = re.exec(lines[i])) !== null) token = m[1];
    if (token) return { token, line: i, last: i === lines.length - 1 };
  }
  return null;
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
  const verdict =
    expected && FIX_PHASES.has(phase) ? lastVerdictToken(expected, blob) : null;

  // 1. a fix verdict wins over everything: the loop must go back to implement.
  if (verdict && FIX_TOKENS.has(verdict.token)) {
    return fixResult(phase, verdict.token);
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

  // 5. end token contract. A scanned verdict (last phase token anywhere) is
  //    authoritative; plan/implement fall back to a blob-wide match.
  if (verdict) {
    return advanceResult(phase, verdict.last ? "verdict-line" : "verdict-scan", verdict.token, null);
  }
  const token = matchToken(expected, blob);
  if (!token) {
    return blockResult(
      phase,
      "token-missing",
      expected,
      [
        `Orchestra blocked at phase **${phase}** — the subagent output is missing its end token.`,
        `End your output with **${expected.join(" or ")}** on its own line to let the loop advance.`,
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

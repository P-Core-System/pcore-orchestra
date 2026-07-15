"use strict";

const PHASE_CHAIN = {
  "orchestra-planner": {
    nextPhase: "implement",
    followup:
      "Orchestra (ambient) — implement phase. Use **orchestra-implementer** subagent (Task) to implement the approved plan only. Run relevant checks. Summarize files changed.",
  },
  "orchestra-implementer": {
    nextPhase: "verify",
    followup:
      "Orchestra (ambient) — verify phase. Use **orchestra-verifier** subagent to run tests, linters, and smoke checks. End with VERIFY_PASS or VERIFY_FAIL.",
  },
  "orchestra-verifier": {
    nextPhase: "review",
    followup:
      "Orchestra (ambient) — review phase. Use **orchestra-reviewer** subagent. End with ORCHESTRA_COMPLETE or FIX_REQUIRED.",
  },
  "orchestra-reviewer": {
    nextPhase: "done",
    followup: null,
  },
};

const PHASE_AGENT_MAP = {
  implement: "orchestra-implementer",
  verify: "orchestra-verifier",
  review: "orchestra-reviewer",
  plan: "orchestra-planner",
};

function getAgentForPhase(phase) {
  return PHASE_AGENT_MAP[phase] || "orchestra-planner";
}

function reviewerNeedsFix(input) {
  const blob = [
    input.summary,
    input.result,
    input.output,
    input.final_text,
  ]
    .filter(Boolean)
    .join("\n");
  return /\bFIX_REQUIRED\b/i.test(blob) || /\bVERIFY_FAIL\b/i.test(blob);
}

module.exports = {
  PHASE_CHAIN,
  PHASE_AGENT_MAP,
  getAgentForPhase,
  reviewerNeedsFix,
};

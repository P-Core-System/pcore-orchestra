"use strict";

/** Max chars parent should pass to a subagent Task prompt (excludes subagent's own reads). */
const MAX_HANDOFF_CHARS = 2500;

const { buildPlanHandoffLine } = require("./plan-artifact.js");
const { buildCommitGateHandoff } = require("./phase-commit-gate.js");
const { spawnLine } = require("./orchestra-spawn-matrix.js");

const HANDOFF_RULES = [
  "Parent handoff (compact):",
  "Pass ONLY: goal (1 line) + plan summary (3–5 bullets) + prior phase failures.",
  "Do NOT pass full chat history, tool logs, or file contents.",
  "Do NOT edit files between phases — only the active phase agent writes.",
  "Git: previous phase MUST commit before next phase starts (phase commit gate).",
].join("\n");

function buildPhaseHandoff(state, nextAgentId) {
  const lines = [
    HANDOFF_RULES,
    "",
    `Goal: ${state.goal || "(none)"}`,
    `Next: ${spawnLine("cursor", nextAgentId)}.`,
  ];

  const completed = state.memory?.phases_completed;
  if (completed?.length > 0) {
    const summary = completed
      .slice(-3)
      .map((p) => `${p.phase}${p.summary ? `: ${p.summary.slice(0, 120)}` : ""}`)
      .join(" | ");
    lines.push(`Prior phases: ${summary}`);
  }

  const errors = state.memory?.errors;
  if (errors?.length > 0) {
    lines.push(`Prior failures: ${errors.slice(-3).join("; ")}`);
  }

  const planLine = buildPlanHandoffLine(state, nextAgentId);
  if (planLine) lines.push(planLine);

  const commitGate = buildCommitGateHandoff(state, nextAgentId);
  if (commitGate) lines.push(commitGate);

  return lines.join("\n");
}

function validateHandoffCompact(text) {
  if (!text || typeof text !== "string") return { ok: true, chars: 0 };
  const chars = text.length;
  if (chars > MAX_HANDOFF_CHARS) {
    return {
      ok: false,
      chars,
      warning: `Handoff prompt is ${chars} chars (max ${MAX_HANDOFF_CHARS}). Trim to goal + plan bullets + failures only.`,
    };
  }
  return { ok: true, chars };
}

function handoffWarningBlock(text) {
  const v = validateHandoffCompact(text);
  if (v.ok) return "";
  return v.warning;
}

module.exports = {
  MAX_HANDOFF_CHARS,
  HANDOFF_RULES,
  buildPhaseHandoff,
  validateHandoffCompact,
  handoffWarningBlock,
};

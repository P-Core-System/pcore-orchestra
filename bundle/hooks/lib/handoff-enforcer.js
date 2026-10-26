"use strict";

/** Max chars parent should pass to a subagent Task prompt (excludes subagent's own reads). */
const MAX_HANDOFF_CHARS = 2500;

/** Fix re-entries at which the handoff asks for a deeper approach. */
const ESCALATION_AFTER_FIX_CYCLES = 2;

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

/**
 * Escalation directive once a run has replayed the implementer repeatedly.
 * Reads state.memory.fix_cycles (incremented by handleFixRequired).
 */
function buildEscalationLine(state) {
  const cycles = (state && state.memory && state.memory.fix_cycles) || 0;
  if (cycles < ESCALATION_AFTER_FIX_CYCLES) return null;
  return [
    `Escalation (fix cycle ${cycles}): this run keeps returning to implement.`,
    "Root-cause the red check instead of patching symptoms; reproduce it alone, read the diff since the last green run, and split the remaining scope into smaller steps.",
    "If verify/review is still red after this attempt, escalate the verifier/reviewer to `grok-4.6` standard and report the blocker to the user.",
  ].join(" ");
}

function buildPhaseHandoff(state, nextAgentId) {
  const lines = [
    HANDOFF_RULES,
    "",
    `Goal: ${state.goal || "(none)"}`,
    `Auto-continue: ${spawnLine("cursor", nextAgentId)} immediately — do not wait for the user.`,
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

  const escalation = buildEscalationLine(state);
  if (escalation) lines.push(escalation);

  const planLine = buildPlanHandoffLine(state, nextAgentId);
  if (planLine) lines.push(planLine);

  const commitGate = buildCommitGateHandoff(state, nextAgentId);
  if (commitGate) lines.push(commitGate);

  return lines.join("\n");
}

/**
 * Build enriched handoff with evidence digest, work-item context, and phase outcome.
 * @param {object} state - orchestra state
 * @param {Array} evidenceRecords - evidence records from applyEvidenceToGates
 * @param {object} workItemContext - work item context (ticketId, acCount)
 * @returns {string} enriched handoff, truncated to MAX_HANDOFF_CHARS with marker
 */
function buildHandoffEnforcement(state, evidenceRecords, workItemContext) {
  const lines = [];

  // Evidence digest: gate names + pass/fail summary
  if (evidenceRecords && evidenceRecords.length > 0) {
    const digest = evidenceRecords
      .map((r) => `${r.gate}:${r.ok ? "PASS" : "FAIL"}`)
      .join(" ");
    lines.push(`Evidence: ${digest}`);
  }

  // Keep escalation ahead of the tail so truncation can never hide it.
  const escalation = buildEscalationLine(state);
  if (escalation) lines.push(escalation);

  // Work-item context: ticket ID + AC count
  const ticketId =
    (state.memory && state.memory.ticketId) ||
    workItemContext?.ticketId ||
    (state.goal ? state.goal.slice(0, 50) : "(no goal)");
  const acCount = workItemContext?.acCount;
  let workItemLine = `Work item: ${ticketId}`;
  if (typeof acCount === "number" && acCount > 0) {
    workItemLine += ` (AC: ${acCount})`;
  }
  lines.push(workItemLine);

  // Phase outcome summary from state.last_outcome
  const outcome = state.last_outcome;
  if (outcome) {
    const parts = [];
    if (outcome.phase) parts.push(`phase=${outcome.phase}`);
    if (outcome.decision) parts.push(`decision=${outcome.decision}`);
    if (outcome.reason) parts.push(`reason=${outcome.reason}`);
    if (outcome.token) parts.push(`token=${outcome.token}`);
    if (parts.length > 0) {
      lines.push(`Last outcome: ${parts.join(", ")}`);
    }
  }

  // Truncate to MAX_HANDOFF_CHARS with marker
  const result = lines.join("\n");
  if (result.length <= MAX_HANDOFF_CHARS) {
    return result;
  }

  const truncated = result.slice(0, MAX_HANDOFF_CHARS - 20);
  const overflow = result.length - MAX_HANDOFF_CHARS + 20;
  return `${truncated}... [+${overflow} chars]`;
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
  ESCALATION_AFTER_FIX_CYCLES,
  buildPhaseHandoff,
  buildHandoffEnforcement,
  buildEscalationLine,
  validateHandoffCompact,
  handoffWarningBlock,
};
#!/usr/bin/env node
"use strict";

const { readStdinJson, emit } = require("./lib/io.js");
const { loadState, saveState } = require("./lib/state-manager.js");
const {
  initializeGates,
  passGate,
  failGate,
  skipGate,
  generateGatesReport,
} = require("./lib/quality-gate.js");
const { applyEvidenceToGates } = require("./lib/evidence-runner.js");

/**
 * True when this run needs a person: a failed quality gate, or a recorded
 * `needs_human` / `block` outcome on the session.
 */
function needsHuman(state) {
  const failed = state && state.qualityGates && Array.isArray(state.qualityGates.failed)
    ? state.qualityGates.failed
    : [];
  if (failed.length > 0) return true;
  const decision = state && state.last_outcome ? state.last_outcome.decision : null;
  return decision === "needs_human" || decision === "block";
}

/**
 * Markdown block listing what is waiting on a human review. Empty string when
 * nothing needs a person.
 *
 * Best-effort by construction: the domain module is lazily required inside a
 * try/catch (invariant 19), so an unreadable review queue can never change a
 * gate verdict, the stdout envelope, or the exit code of this hook.
 */
function humanReviewQueueBlock(state) {
  if (!needsHuman(state)) return "";
  try {
    const dom = require("./lib/domain");
    if (!dom || typeof dom.pendingReview !== "function") return "";
    const items = dom.pendingReview();
    if (!Array.isArray(items) || items.length === 0) {
      return "## Human review queue\n\nNo pending items — this run is blocked, but nothing is queued for triage.";
    }
    return dom.reviewQueue.formatQueue(items);
  } catch {
    return "";
  }
}

async function main() {
  const input = await readStdinJson();
  const state = loadState();

  if (!state.active) {
    emit({});
    return;
  }

  if (!state.qualityGates) {
    initializeGates(state);
  }

  const status = input.status || "";
  const subagentType = input.subagent_type || input.subagentType || "";
  const summaryBlob = [input.summary, input.result, input.output, input.final_text]
    .filter(Boolean)
    .join("\n");

  // Only run evidence on final review agents (avoid slowing every phase)
  const isFinalReview =
    subagentType === "orchestra-reviewer" ||
    subagentType === "code-reviewer" ||
    subagentType === "release-manager";

  if (status !== "completed") {
    failGate(state, "reviewer-approval", `Subagent ${subagentType} status: ${status}`);
    saveState(state);
    emit({});
    return;
  }

  if (isFinalReview) {
    const { report } = applyEvidenceToGates(state, passGate, failGate, skipGate, {
      onEvidence: (ev) => {
        try {
          const dom = require("./lib/domain");
          if (dom && dom.evidence && typeof dom.evidence.appendEvidenceRun === "function") {
            dom.evidence.appendEvidenceRun(ev);
          }
        } catch {}
      },
    });

    if (/\bFIX_REQUIRED\b/i.test(summaryBlob) || /\bVERIFY_FAIL\b/i.test(summaryBlob)) {
      failGate(state, "reviewer-approval", "Reviewer/verifier requested fixes");
    } else if (/\bORCHESTRA_COMPLETE\b/i.test(summaryBlob) || /\bVERIFY_PASS\b/i.test(summaryBlob) || subagentType.includes("reviewer")) {
      passGate(state, "reviewer-approval", "Reviewer completed without FIX_REQUIRED");
    }

    passGate(state, "memory-updated", "Lifecycle hooks flushed memory");

    // docs-updated is decided by evidence (evidenceDocsUpdated), which diffs
    // the real git range and fails closed on git errors. The summary/memory
    // probe below is an ADDITIONAL accept signal only — it can add a pass, but
    // it must never be the sole basis for one, and it must never mask a
    // diff-derived FAIL by writing a skip on top of it.
    const summaryMentionsDocs =
      /\bprogress-tracker\.md\b/i.test(summaryBlob) ||
      (state.memory?.files_changed || []).some((f) => /progress-tracker/.test(f));
    if (summaryMentionsDocs) {
      passGate(state, "docs-updated", "progress-tracker referenced in run summary (additional signal on top of git diff)");
    } else {
      const hasEvidenceVerdict =
        [...(state.qualityGates?.passed || []), ...(state.qualityGates?.failed || [])].some(
          (g) => g.id === "docs-updated"
        );
      if (!hasEvidenceVerdict) {
        skipGate(state, "docs-updated", "no doc evidence produced — verify manually");
      }
    }

    saveState(state);
    const contextParts = [report, "", generateGatesReport(state)];
    const reviewQueueBlock = humanReviewQueueBlock(state);
    if (reviewQueueBlock) contextParts.push("", reviewQueueBlock);
    emit({
      additional_context: contextParts.join("\n"),
    });
    return;
  }

  // Non-final agents: do not fake build/test passes
  saveState(state);
  emit({});
}

main().catch(() => {
  emit({});
});

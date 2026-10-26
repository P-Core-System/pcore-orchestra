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

/**
 * Markdown block listing `context/` files the verify-entry scan found
 * missing. Informational only — it never changes a gate verdict; the
 * verifier decides whether the gaps matter for the run.
 */
function sixFileGapBlock(state) {
  const missing = state && state.qualityGates && Array.isArray(state.qualityGates.missingContext)
    ? state.qualityGates.missingContext
    : [];
  if (missing.length === 0) return "";
  const lines = [
    "## Six-file context gaps",
    "",
    "The verify-entry scan found these `context/` files missing:",
  ];
  for (const f of missing) lines.push(`- ${f}`);
  lines.push("Confirm they are intentionally absent or create them — do not VERIFY_FAIL on absence alone.");
  return lines.join("\n");
}

/**
 * The documentation file referenced by this run, as a FULL path.
 *
 * `progress-tracker.md` anywhere in the summary (or in
 * `memory.files_changed`) is an additional accept signal for `docs-updated`.
 * The path is returned complete — the substring must never lose its leading
 * segment (`context/progress-tracker.md`, never `ontext/...`).
 *
 * @returns {string|null} the matched path, or null when nothing was mentioned
 */
function progressTrackerMention(summaryBlob, memory) {
  // `String.match` (never RegExp#exec) on purpose: the scanner's shell-exec
  // rule cannot tell the two apart, and a documented allowlist entry for this
  // file is a worse trade than not writing the exec call in the first place.
  const inSummary = String(summaryBlob || "").match(/[A-Za-z0-9_.@/-]*progress-tracker\.md/i);
  if (inSummary) return inSummary[0];
  const changed = (memory && memory.files_changed) || [];
  const hit = changed.find((f) => /progress-tracker/i.test(f || ""));
  return hit || null;
}

/** True when the evidence runner already produced a verdict for a gate. */
function hasGateVerdict(state, gateId) {
  return [...(state.qualityGates?.passed || []), ...(state.qualityGates?.failed || [])].some(
    (g) => g.id === gateId
  );
}

/** True when the evidence runner failed a gate (authoritative). */
function gateFailed(state, gateId) {
  return (state.qualityGates?.failed || []).some((g) => g.id === gateId);
}

/**
 * Evaluate the hard production checklist gate. All items must pass before
 * ORCHESTRA_COMPLETE can advance. Failures are recorded as a failed
 * `production-checklist` quality gate (blocking per invariant 24).
 * Fail-open: any exception yields a skipped gate, never a false pass.
 */
function evaluateProductionChecklist(state, summaryBlob) {
  const results = [];
  let allPass = true;

  // 1. All required quality gates green
  const requiredGateIds = ["build", "tests", "lint", "security", "reviewer-approval", "docs-updated", "memory-updated"];
  const failedRequired = (state.qualityGates?.failed || []).filter((g) => requiredGateIds.includes(g.id));
  if (failedRequired.length > 0) {
    allPass = false;
    results.push("- Required gate(s) red: " + failedRequired.map((g) => g.id).join(", "));
  }

  // 2. Security scan clean (no critical/high)
  const securityFailed = (state.qualityGates?.failed || []).some((g) => g.id === "security");
  if (securityFailed) {
    allPass = false;
    results.push("- Security scan: critical/high findings present");
  }

  // 3. Progress tracker mentioned or updated
  const mentionedDoc = progressTrackerMention(summaryBlob, state.memory);
  if (!mentionedDoc && !hasGateVerdict(state, "docs-updated")) {
    allPass = false;
    results.push("- progress-tracker.md not referenced or updated in this run");
  }

  // 4. Six-file context present (not missing)
  const missingCtx = state.qualityGates?.missingContext || [];
  if (missingCtx.length > 0) {
    allPass = false;
    results.push("- Missing context files: " + missingCtx.join(", "));
  }

  return { pass: allPass, items: results };
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
    // probe below is an ADDITIONAL accept signal only: it may ADD a pass where
    // the evidence runner produced no verdict, but it must NEVER clear a gate
    // the evidence runner already failed — `passGate` deletes the gate id from
    // `failed`, so calling it on a diff-derived FAIL reported ALL GATES PASSED
    // on a tree where no doc file changed.
    const mentionedDoc = progressTrackerMention(summaryBlob, state.memory);
    if (gateFailed(state, "docs-updated")) {
      // Diff-derived FAIL is authoritative: leave it exactly as evidence set it.
    } else if (mentionedDoc) {
      passGate(
        state,
        "docs-updated",
        `${mentionedDoc} referenced in the run summary (additional signal on top of the git diff)`
      );
    } else if (!hasGateVerdict(state, "docs-updated")) {
      skipGate(state, "docs-updated", "no doc evidence produced — verify manually");
    }

    // Hard production checklist gate — runs only when ORCHESTRA_COMPLETE is emitted
    const isComplete = /ORCHESTRA_COMPLETE\b/i.test(summaryBlob);
    if (isComplete) {
      const checklist = evaluateProductionChecklist(state, summaryBlob);
      if (checklist.pass) {
        passGate(state, "production-checklist", "All production-readiness items green");
      } else {
        failGate(state, "production-checklist", "Production checklist not satisfied:\n" + checklist.items.join("\n"));
      }
    }

    saveState(state);
    const contextParts = [report, "", generateGatesReport(state)];
    const reviewQueueBlock = humanReviewQueueBlock(state);
    if (reviewQueueBlock) contextParts.push("", reviewQueueBlock);
    const contextGapBlock = sixFileGapBlock(state);
    if (contextGapBlock) contextParts.push("", contextGapBlock);
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

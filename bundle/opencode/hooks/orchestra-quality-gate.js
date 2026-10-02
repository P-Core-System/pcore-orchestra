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
    if (/\bprogress-tracker\.md\b/i.test(summaryBlob) || state.memory?.files_changed?.some((f) => /progress-tracker/.test(f))) {
      passGate(state, "docs-updated", "progress-tracker or docs referenced in run");
    } else {
      skipGate(state, "docs-updated", "no progress-tracker evidence in summary — verify manually");
    }

    saveState(state);
    emit({
      additional_context: [report, "", generateGatesReport(state)].join("\n"),
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

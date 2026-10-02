#!/usr/bin/env node
"use strict";

const { readStdinJson, emit } = require("./lib/io.js");
const { saveState, updateState, DEFAULT_STATE } = require("./lib/state-manager.js");
const {
  getPhaseChain,
  getAgentForPhase,
  getPhaseInfo,
  getImplementPhaseId,
  getPhasesForMode,
  reviewerNeedsFix,
  LOOP_MODE_ENTERPRISE,
} = require("./lib/phase-engine.js");
const { emitLifecycleEvent, endPhaseTimer, startPhaseTimer } = require("./lib/lifecycle-recorder.js");
const { flushShortToLong } = require("./lib/memory-manager.js");
const { recordOrchestrationRun } = require("./lib/history-recorder.js");
const { bumpProjectVersion, addChangelogEntry } = require("./lib/version-manager.js");
const { passGate, failGate, skipGate } = require("./lib/quality-gate.js");
const { addTechDebt, generateProjectSummary, loadProjectState, saveProjectState } = require("./lib/project-manager.js");
const { loadDailyState, saveDailyState, getOrCreateTodayEntry, generateDailySummary } = require("./lib/daily-planner.js");
const { recordPhaseTokens, finalizeRunTokens } = require("./lib/token-tracker.js");
const { buildPhaseHandoff } = require("./lib/handoff-enforcer.js");
const { runEvidenceChecks, applyEvidenceToGates } = require("./lib/evidence-runner.js");
const { saveCheckpoint } = require("./lib/checkpoint-manager.js");
const { savePlanArtifact, buildPlanHandoffLine } = require("./lib/plan-artifact.js");
const { writeCycleReport } = require("./lib/cycle-report.js");
const { checkPhaseCommitGate } = require("./lib/phase-commit-gate.js");

function getAgentDisplayName(agentId) {
  const display = {
    "business-analyst": "Business Analyst",
    "product-manager": "Product Manager",
    "architect": "Architect",
    "tech-lead": "Tech Lead",
    "project-manager": "Project Manager",
    "backend-engineer": "Backend Engineer",
    "frontend-engineer": "Frontend Engineer",
    "full-stack-engineer": "Full Stack Engineer",
    "database-engineer": "Database Engineer",
    "qa-engineer": "QA Engineer",
    "automation-engineer": "Automation Engineer",
    "security-engineer": "Security Engineer",
    "accessibility-reviewer": "Accessibility Reviewer",
    "documentation-writer": "Documentation Writer",
    "release-manager": "Release Manager",
    "devops-engineer": "DevOps Engineer",
    "sre": "SRE",
    "observer": "Observer",
    "code-reviewer": "Code Reviewer",
    "performance-engineer": "Performance Engineer",
    "platform-engineer": "Platform Engineer",
    "cloud-engineer": "Cloud Engineer",
    "infrastructure-engineer": "Infrastructure Engineer",
    "orchestra-planner": "Orchestra Planner",
    "orchestra-implementer": "Orchestra Implementer",
    "orchestra-verifier": "Orchestra Verifier",
    "orchestra-reviewer": "Orchestra Reviewer",
  };
  return display[agentId] || agentId;
}

function handleFixRequired(state) {
  const implPhase = getImplementPhaseId(state.loopMode);
  const agentId = "orchestra-implementer";
  state.currentPhase = implPhase;
  emitLifecycleEvent(state, "fix_required", state.currentPhase, {
    iteration: state.iteration,
  });
  if (!state.memory) state.memory = { ...DEFAULT_STATE.memory };
  state.memory.decisions.push({
    phase: "review",
    decision: "FIX_REQUIRED",
    rationale: "Reviewer requested fixes",
    timestamp: new Date().toISOString(),
  });

  if (state.iteration >= state.max_iterations) {
    emitLifecycleEvent(state, "max_iterations", state.currentPhase, {
      iteration: state.iteration,
    });
    state.active = false;
    state.currentPhase = "idle";
    saveState(state);
    emit({
      followup_message:
        "Orchestra max iterations reached after FIX_REQUIRED. Report blockers to the user.",
    });
    return true;
  }

  startPhaseTimer(state, implPhase, agentId);
  saveState(state);
  const modeLabel = state.loopMode === LOOP_MODE_ENTERPRISE ? "Enterprise" : "Core";
  emit({
    followup_message:
      `${modeLabel} loop — FIX_REQUIRED. Launch **${agentId}** to address reviewer blockers, then **commit**, then continue verify → review.\n\nGoal: ${state.goal}\n\nPhase commit gate: fixes must be committed before re-verify.`,
  });
  return true;
}

function handlePlanOnlyPause(state) {
  const implPhase = getImplementPhaseId(state.loopMode);
  saveCheckpoint(state);
  state.planAwaitingConfirm = true;
  state.resumable.paused = true;
  state.resumable.paused_at = new Date().toISOString();
  state.resumable.pause_reason = "plan_only";
  state.resumable.checkpoint = {
    phase: implPhase,
    goal: state.goal,
    iteration: state.iteration,
    last_subagent: state.last_subagent,
    started_at: state.started_at,
    loopMode: state.loopMode,
    timestamp: new Date().toISOString(),
  };
  state.active = false;
  state.currentPhase = "paused";
  saveState(state);
  emit({
    followup_message: [
      "Orchestra plan-only pause — planner finished.",
      "Review the plan above. Do NOT implement yet.",
      "Say **continue orchestra** or **approve plan** to start orchestra-implementer.",
      `Goal: ${state.goal}`,
    ].join("\n"),
  });
  return true;
}

function handlePhaseComplete(state, chain) {
  const phases = getPhasesForMode(state.loopMode, state);
  const nextPhase = chain.nextPhase;
  state.currentPhase = nextPhase;

  emitLifecycleEvent(state, "phase_advance", state.currentPhase, {
    from: state.last_subagent,
    to: nextPhase,
    loopMode: state.loopMode,
  });

  if (nextPhase === "done") {
    emitLifecycleEvent(state, "orchestra_complete", "done", { goal: state.goal });

    const memory = state.memory || {};
    const changeTypes = [];
    const hasFeat = memory.decisions?.some((d) => /feat|feature|add|new/i.test(d.decision));
    const hasFix = memory.decisions?.some((d) => /fix|bug|patch/i.test(d.decision));
    const hasBreaking = memory.decisions?.some((d) => /breaking|major|refactor/i.test(d.decision));
    if (hasBreaking) changeTypes.push("breaking");
    if (hasFeat) changeTypes.push("feat");
    if (hasFix) changeTypes.push("fix");

    if (memory.files_changed?.length > 0) {
      try {
        bumpProjectVersion(state, changeTypes);
        addChangelogEntry(state, {
          type: changeTypes.includes("breaking")
            ? "changed"
            : changeTypes.includes("feat")
              ? "added"
              : "fixed",
          scope: state.goal?.split(" ").slice(0, 3).join("-") || "general",
          description: state.goal || "Orchestra run",
          sha: null,
        });
        passGate(state, "version-updated", `Version bumped to ${state.versioning.current}`);
        passGate(state, "changelog-updated", "Changelog entry added");
      } catch (e) {
        failGate(state, "version-updated", `Version bump failed: ${e.message}`);
      }
    }

    passGate(state, "memory-updated", "Short-term memory flushed to long-term");
    try {
      const ds = loadDailyState();
      getOrCreateTodayEntry(ds);
      generateDailySummary(ds);
      saveDailyState(ds);
      passGate(state, "daily-journal-updated", "Daily journal updated");
    } catch {}

    passGate(state, "docs-updated", "Context and memory files updated");
    passGate(state, "reviewer-approval", "Review completed");

    flushShortToLong(state, "completed");
    finalizeRunTokens(state, "completed");
    recordOrchestrationRun(state, "completed");
    try {
      writeCycleReport(state, "completed");
    } catch {}
    state.active = false;
    state.currentPhase = "idle";
    saveState(state);

    const summary = generateProjectSummary(loadProjectState());
    const modeLabel = state.loopMode === LOOP_MODE_ENTERPRISE ? "Enterprise SDLC" : "Core loop";
    const tokenLine = state.tokens?.last_finalized
      ? `Tokens: ~${state.tokens.last_finalized.total_estimated.toLocaleString()} estimated (${state.tokens.last_finalized.tips_count} improvement tip(s) — orchestra-enable.js tokens)`
      : null;
    emit({
      followup_message: [
        `${modeLabel} complete for goal: ${state.goal || "(no goal)"}`,
        `Version: ${state.versioning.current} (build ${state.versioning.buildNumber})`,
        `Project: ${summary.totalTasks} tasks, ${summary.completedTasks} completed, ${summary.unresolvedDebt} unresolved tech debt items`,
        `Quality gates: ${state.qualityGates.allRequiredPassed ? "ALL PASSED" : `${state.qualityGates.passed.length} passed, ${state.qualityGates.failed.length} failed, ${state.qualityGates.skipped.length} skipped`}`,
        tokenLine,
        "Summarize deliverables and next steps for the user.",
      ].filter(Boolean).join("\n"),
    });
    return true;
  }

  if (state.iteration >= state.max_iterations) {
    emitLifecycleEvent(state, "max_iterations", state.currentPhase, {
      iteration: state.iteration,
    });
    flushShortToLong(state, "max_iterations");
    finalizeRunTokens(state, "max_iterations");
    recordOrchestrationRun(state, "max_iterations");
    try {
      writeCycleReport(state, "max_iterations");
    } catch {}
    state.active = false;
    state.currentPhase = "idle";
    saveState(state);
    emit({
      followup_message:
        "Orchestra hit max iterations. Stop chaining and give the user a status report.",
    });
    return true;
  }

  const memory = state.memory;
  if (memory?.errors?.length > 0) {
    try {
      const ps = loadProjectState();
      addTechDebt(ps, {
        title: `Errors during ${state.last_subagent} phase`,
        description: `Phase ${state.last_subagent} completed with ${memory.errors.length} error(s)`,
        impact: "May cause instability or incomplete implementation",
        area: state.last_subagent || "unknown",
        severity: "medium",
        suggestedFix: "Review phase output and address errors",
      });
      saveProjectState(ps);
    } catch {}
  }

  const nextAgentId = getAgentForPhase(nextPhase);
  state.last_subagent = null;
  saveState(state);
  startPhaseTimer(state, nextPhase, nextAgentId);
  saveState(state);

  let evidenceBlock = "";
  if (nextPhase === "verify") {
    try {
      const { report } = runEvidenceChecks(state);
      evidenceBlock = report;
      if (!state.memory) state.memory = { ...DEFAULT_STATE.memory };
      state.memory.evidence_preflight = report;
      saveState(state);
    } catch {}
  }

  let commitGateBlock = "";
  try {
    const gate = checkPhaseCommitGate(state);
    commitGateBlock = gate.message;
    if (!gate.clean && (nextPhase === "verify" || nextPhase === "review")) {
      commitGateBlock +=
        "\nParent: commit or discard blocking files BEFORE launching the next subagent.";
    }
  } catch {}

  const nextInfo = getPhaseInfo(nextPhase);
  const nextAgentDisplay = getAgentDisplayName(nextAgentId);
  const phaseLabel = nextInfo
    ? nextInfo.id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : nextPhase;
  const categoryLabel = nextInfo ? nextInfo.category.toUpperCase() : "CORE";
  const modeLabel = state.loopMode === LOOP_MODE_ENTERPRISE ? "Enterprise SDLC" : "Core loop";

  emit({
    followup_message: [
      `${modeLabel} — ${categoryLabel} Phase: **${phaseLabel}**`,
      `Launch **${nextAgentId}** (${nextAgentDisplay}) subagent to continue.`,
      `Goal: ${state.goal}`,
      `Phase ${phases.findIndex((p) => p.id === nextPhase) + 1} of ${phases.length}`,
      buildPhaseHandoff(state, nextAgentId),
      commitGateBlock || null,
      evidenceBlock || null,
    ].filter(Boolean).join("\n\n"),
  });
  return true;
}

async function main() {
  const input = await readStdinJson();
  const status = input.status || "";
  const subagentType = input.subagent_type || input.subagentType || "";

  if (status !== "completed") {
    emit({});
    return;
  }

  // Locked read → mutate → write for the bookkeeping half of this hook.
  // Evidence runs, gate checks and phase transitions stay OUTSIDE the lock —
  // they can take minutes (spawnSync of build/tests/lint) and would starve
  // every other hook waiting on the same lock file.
  const state = updateState((s) => {
    if (!s.active) return null;
    if (!getPhaseChain(s)[s.currentPhase]) return null;

    s.last_subagent = subagentType;
    s.iteration = (s.iteration || 0) + 1;

    endPhaseTimer(s, "completed");
    recordPhaseTokens(s, input, subagentType);
    emitLifecycleEvent(s, "phase_complete", s.currentPhase, {
      subagent: subagentType,
      iteration: s.iteration,
    });

    if (!s.memory) {
      s.memory = {
        phases_completed: [],
        files_changed: [],
        errors: [],
        decisions: [],
        context_summary: "",
      };
    }

    const outputSnippet = (input.summary || input.result || input.output || input.text || "")
      .toString()
      .slice(0, 200);
    s.memory.phases_completed.push({
      phase: s.currentPhase,
      agent: subagentType,
      summary: outputSnippet,
      timestamp: new Date().toISOString(),
    });

    if (
      subagentType === "orchestra-planner" &&
      s.currentPhase === "plan"
    ) {
      try {
        savePlanArtifact(s, input);
      } catch {}
    }

    return s;
  });

  if (!state) {
    emit({});
    return;
  }

  const chain = getPhaseChain(state)[state.currentPhase];

  if (
    subagentType === "orchestra-planner" &&
    state.orchestraConfig?.plan_only &&
    state.currentPhase === "plan"
  ) {
    handlePlanOnlyPause(state);
    return;
  }

  if (subagentType === "orchestra-verifier" && state.currentPhase === "verify") {
    try {
      const { report } = applyEvidenceToGates(state, passGate, failGate, skipGate);
      if (!state.memory) state.memory = { ...DEFAULT_STATE.memory };
      state.memory.evidence_gates = report;
      saveState(state);
    } catch {}
  }

  if (
    (subagentType === "orchestra-reviewer" || subagentType === "code-reviewer") &&
    reviewerNeedsFix(input)
  ) {
    if (handleFixRequired(state)) return;
  }

  handlePhaseComplete(state, chain);
}

main().catch(() => {
  emit({});
});

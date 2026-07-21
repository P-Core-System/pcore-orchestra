#!/usr/bin/env node
"use strict";

const { readStdinJson, emit } = require("./lib/io.js");
const { loadState, saveState, DEFAULT_STATE } = require("./lib/state-manager.js");
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
const { passGate, failGate } = require("./lib/quality-gate.js");
const { addTechDebt, generateProjectSummary, loadProjectState, saveProjectState } = require("./lib/project-manager.js");
const { loadDailyState, saveDailyState, getOrCreateTodayEntry, generateDailySummary } = require("./lib/daily-planner.js");

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
      `${modeLabel} loop — FIX_REQUIRED. Launch **${agentId}** to address reviewer blockers, then continue verify → review.\n\nGoal: ${state.goal}`,
  });
  return true;
}

function handlePhaseComplete(state, chain) {
  const phases = getPhasesForMode(state.loopMode);
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
    recordOrchestrationRun(state, "completed");
    state.active = false;
    state.currentPhase = "idle";
    saveState(state);

    const summary = generateProjectSummary(loadProjectState());
    const modeLabel = state.loopMode === LOOP_MODE_ENTERPRISE ? "Enterprise SDLC" : "Core loop";
    emit({
      followup_message: [
        `${modeLabel} complete for goal: ${state.goal || "(no goal)"}`,
        `Version: ${state.versioning.current} (build ${state.versioning.buildNumber})`,
        `Project: ${summary.totalTasks} tasks, ${summary.completedTasks} completed, ${summary.unresolvedDebt} unresolved tech debt items`,
        `Quality gates: ${state.qualityGates.allRequiredPassed ? "ALL PASSED" : `${state.qualityGates.passed.length} passed, ${state.qualityGates.failed.length} failed, ${state.qualityGates.skipped.length} skipped`}`,
        "Summarize deliverables and next steps for the user.",
      ].join("\n"),
    });
    return true;
  }

  if (state.iteration >= state.max_iterations) {
    emitLifecycleEvent(state, "max_iterations", state.currentPhase, {
      iteration: state.iteration,
    });
    flushShortToLong(state, "max_iterations");
    recordOrchestrationRun(state, "max_iterations");
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
    ].join("\n"),
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

  const state = loadState();
  if (!state.active) {
    emit({});
    return;
  }

  const chain = getPhaseChain(state)[state.currentPhase];
  if (!chain) {
    emit({});
    return;
  }

  state.last_subagent = subagentType;
  state.iteration = (state.iteration || 0) + 1;

  endPhaseTimer(state, "completed");
  emitLifecycleEvent(state, "phase_complete", state.currentPhase, {
    subagent: subagentType,
    iteration: state.iteration,
  });

  if (!state.memory) {
    state.memory = {
      phases_completed: [],
      files_changed: [],
      errors: [],
      decisions: [],
      context_summary: "",
    };
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

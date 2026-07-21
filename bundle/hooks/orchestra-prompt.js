#!/usr/bin/env node
"use strict";

const { readStdinJson, emit } = require("./lib/io.js");
const { loadState, saveState, startOrchestra } = require("./lib/state-manager.js");
const { extractPrompt, classifyPrompt } = require("./lib/prompt-classifier.js");
const {
  detectContextInWorkspaces,
  buildContextInjection,
  AMBIENT_CONTEXT,
} = require("./lib/context-detector.js");
const { resumeOrchestra, detectCrashRecovery } = require("./lib/checkpoint-manager.js");
const { loadLongTermMemory, buildMemoryContext } = require("./lib/memory-manager.js");
const { getAgentForPhase, LOOP_MODE_ENTERPRISE } = require("./lib/phase-engine.js");

function handleDisable(state) {
  state.ambient = false;
  state.active = false;
  state.currentPhase = "idle";
  saveState(state);
  emit({
    additional_context:
      "Orchestra ambient mode disabled for this machine. Re-enable: node ~/.cursor/hooks/orchestra-enable.js ambient-on",
  });
}

function handleEnable(state) {
  state.ambient = true;
  saveState(state);
}

function agentForCheckpointPhase(phase) {
  return getAgentForPhase(phase) || "orchestra-planner";
}

function handleResume(state, input) {
  const crash = detectCrashRecovery(state);
  if (state.active && crash) {
    state.active = false;
    state.currentPhase = "idle";
    state.resumable.paused = true;
    state.resumable.paused_at = new Date().toISOString();
    state.resumable.pause_reason = "crash_recovery";
    if (!state.resumable.checkpoint) {
      state.resumable.checkpoint = {
        phase: crash.phase,
        goal: crash.goal,
        iteration: crash.iteration,
        last_subagent: state.last_subagent,
        started_at: state.started_at,
        loopMode: state.loopMode,
        timestamp: new Date().toISOString(),
      };
    }
    saveState(state);
  }
  if (state.resumable?.paused && state.resumable?.checkpoint) {
    const cp = resumeOrchestra(state);
    if (cp) {
      const agent = agentForCheckpointPhase(cp.phase);
      emit({
        additional_context: [
          AMBIENT_CONTEXT,
          crash
            ? `Orchestra recovered from crash (was stuck at ${crash.last_activity}).`
            : `Orchestra RESUMED from checkpoint (paused at ${cp.timestamp}).`,
          `Goal: ${cp.goal}`,
          `Mode: ${state.loopMode || "core"}`,
          `Phase: ${cp.phase} (iteration ${cp.iteration}).`,
          `Launch **${agent}** subagent to continue.`,
        ].join("\n\n"),
      });
      return true;
    }
  }
  return false;
}

function handleBareResume(state) {
  if (state.resumable?.paused && state.resumable?.checkpoint) {
    const cp = resumeOrchestra(state);
    if (cp) {
      const agent = agentForCheckpointPhase(cp.phase);
      emit({
        additional_context: [
          AMBIENT_CONTEXT,
          `Orchestra RESUMED from checkpoint (paused at ${cp.timestamp}).`,
          `Goal: ${cp.goal}`,
          `Mode: ${state.loopMode || "core"}`,
          `Phase: ${cp.phase} (iteration ${cp.iteration}).`,
          `Launch **${agent}** subagent to continue.`,
        ].join("\n\n"),
      });
      return true;
    }
  }
  return false;
}

async function main() {
  const input = await readStdinJson();
  const state = loadState();
  const prompt = extractPrompt(input);

  if (/\b(disable orchestra|orchestra off)\b/i.test(prompt)) {
    handleDisable(state);
    return;
  }

  if (/\b(enable orchestra|orchestra on|ambient on)\b/i.test(prompt)) {
    handleEnable(state);
  }

  if (/\b(resume orchestra|continue orchestra)\b/i.test(prompt)) {
    if (handleResume(state, input)) return;
    emit({
      additional_context: "No paused orchestration found to resume. Starting fresh if needed.",
    });
    return;
  }

  if (/\b(resume|continue)\b/i.test(prompt) && !state.active) {
    if (handleBareResume(state)) return;
    emit({
      additional_context: "No paused orchestration found to resume. Starting fresh if needed.",
    });
    return;
  }

  const classified = classifyPrompt(prompt, state);
  const {
    activate,
    reason,
    goal,
    route,
    routeReason,
    clarifyNeeded,
    clarifyPrompt,
    intake,
    inferFromContext,
    informal,
  } = classified;
  const ctxBlock = buildContextInjection(detectContextInWorkspaces(input));

  if (!activate) {
    if (state.ambient !== false) {
      const parts = [AMBIENT_CONTEXT];
      if (ctxBlock) parts.push(ctxBlock);
      emit({ additional_context: parts.join("\n\n") });
    } else {
      emit(ctxBlock ? { additional_context: ctxBlock } : {});
    }
    return;
  }

  if (state.active && state.goal && goal && state.goal.slice(0, 80) === goal.slice(0, 80)) {
    const agent = getAgentForPhase(state.currentPhase);
    const parts = [
      AMBIENT_CONTEXT,
      `Orchestra already active for this goal. Mode: ${state.loopMode}. Phase: ${state.currentPhase}.`,
      `Launch **${agent}** subagent for the current phase.`,
    ];
    if (ctxBlock) parts.push(ctxBlock);
    emit({ additional_context: parts.join("\n\n") });
    return;
  }

  // Legacy clarify path (kept for safety) — prefer informal_inferred start below
  if (clarifyNeeded && !inferFromContext) {
    const parts = [
      AMBIENT_CONTEXT,
      "Orchestra prompt intake (planner-first) — clarify before implementing.",
      `Draft goal: ${goal || prompt}`,
      clarifyPrompt ||
        "Ask the user for concrete target, success criteria, and constraints. Then re-run with a clearer implement prompt.",
    ];
    if (ctxBlock) parts.push(ctxBlock);
    emit({ additional_context: parts.join("\n\n") });
    return;
  }

  startOrchestra(goal || prompt, state, reason, { route, intake });

  const ltm = loadLongTermMemory();
  const memCtx = buildMemoryContext(ltm);
  const modeLabel =
    route === LOOP_MODE_ENTERPRISE ? "enterprise SDLC" : "core loop (plan→implement→verify→review)";

  const firstAgent = getAgentForPhase(state.currentPhase);
  const parts = [
    AMBIENT_CONTEXT,
    `Orchestra auto-started (${reason}, route=${route || "core"} / ${routeReason || "default"}) — no /orchestra needed.`,
    `Mode: ${modeLabel}`,
    `Goal: ${goal || prompt}`,
    `Phase: ${state.currentPhase} — launch **${firstAgent}** subagent first (Task tool). Do not implement until planning completes.`,
  ];

  if (informal || inferFromContext) {
    parts.push(
      [
        "Informal/short prompt intake — do **not** block the user.",
        "Planner must expand the goal before PLAN_READY:",
        "1. Read `context/progress-tracker.md` Next Up / Current Goal",
        "2. Read `git status` / recent diff if useful",
        "3. Infer the smallest correct fix/build from repo context",
        "4. State assumed goal + success criteria explicitly in the plan",
        "5. Prefer core scope; ask the user only if 2+ equally likely goals conflict",
      ].join("\n")
    );
  }

  if (route === LOOP_MODE_ENTERPRISE) {
    parts.push(
      "Enterprise mode: discovery/design agents are readonly. Before code changes, ensure a plan exists (orchestra-planner or tech-lead/task-breakdown)."
    );
  } else {
    parts.push("Core mode: **orchestra-planner** → implementer → verifier → reviewer. No code edits in plan phase.");
  }
  if (memCtx) parts.push(memCtx);
  if (ctxBlock) {
    parts.push(ctxBlock);
    parts.push("Planner: read all present context/*.md files before PLAN_READY.");
  }
  emit({ additional_context: parts.join("\n\n") });
}

main().catch(() => {
  emit({});
});

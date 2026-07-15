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

function handleDisable(state) {
  state.ambient = false;
  state.active = false;
  state.phase = "idle";
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

function handleResume(state, input) {
  const crash = detectCrashRecovery(state);
  if (state.active && crash) {
    state.active = false;
    state.phase = "idle";
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
        timestamp: new Date().toISOString(),
      };
    }
    saveState(state);
  }
  if (state.resumable?.paused && state.resumable?.checkpoint) {
    const cp = resumeOrchestra(state);
    if (cp) {
      const phaseAgent = {
        plan: "orchestra-planner",
        implement: "orchestra-implementer",
        verify: "orchestra-verifier",
        review: "orchestra-reviewer",
      };
      const agent = phaseAgent[cp.phase] || "orchestra-planner";
      emit({
        additional_context: [
          AMBIENT_CONTEXT,
          crash
            ? `Orchestra recovered from crash (was stuck at ${crash.last_activity}).`
            : `Orchestra RESUMED from checkpoint (paused at ${cp.timestamp}).`,
          `Goal: ${cp.goal}`,
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
      const phaseAgent = {
        plan: "orchestra-planner",
        implement: "orchestra-implementer",
        verify: "orchestra-verifier",
        review: "orchestra-reviewer",
      };
      const agent = phaseAgent[cp.phase] || "orchestra-planner";
      emit({
        additional_context: [
          AMBIENT_CONTEXT,
          `Orchestra RESUMED from checkpoint (paused at ${cp.timestamp}).`,
          `Goal: ${cp.goal}`,
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

  const { activate, reason, goal } = classifyPrompt(prompt, state);
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
    const parts = [
      AMBIENT_CONTEXT,
      `Orchestra already active for this goal. Phase: ${state.phase}.`,
      "Launch the next orchestra-* subagent for the current phase.",
    ];
    if (ctxBlock) parts.push(ctxBlock);
    emit({ additional_context: parts.join("\n\n") });
    return;
  }

  startOrchestra(goal || prompt, state, reason);

  const ltm = loadLongTermMemory();
  const memCtx = buildMemoryContext(ltm);

  const parts = [
    AMBIENT_CONTEXT,
    `Orchestra auto-started (${reason}) — no /orchestra needed.`,
    `Goal: ${goal || prompt}`,
    "Phase: plan — launch **orchestra-planner** subagent first (Task tool).",
  ];
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

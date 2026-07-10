#!/usr/bin/env node
"use strict";

const {
  loadState,
  saveState,
  readStdinJson,
  emit,
  extractPrompt,
  classifyPrompt,
  startOrchestra,
  detectContextInWorkspaces,
  buildContextInjection,
  AMBIENT_CONTEXT,
} = require("./orchestra-lib.js");

async function main() {
  const input = await readStdinJson();
  const state = loadState();
  const prompt = extractPrompt(input);

  // Explicit disable
  if (/\b(disable orchestra|orchestra off)\b/i.test(prompt)) {
    state.ambient = false;
    state.active = false;
    state.phase = "idle";
    saveState(state);
    emit({
      additional_context:
        "Orchestra ambient mode disabled for this machine. Re-enable: node ~/.cursor/hooks/orchestra-enable.js ambient-on",
    });
    return;
  }

  if (/\b(enable orchestra|orchestra on|ambient on)\b/i.test(prompt)) {
    state.ambient = true;
    saveState(state);
  }

  const { activate, reason, goal } = classifyPrompt(prompt, state);

  const ctxBlock = buildContextInjection(detectContextInWorkspaces(input));

  if (!activate) {
    // Still inject ambient policy so agent knows the default behavior
    if (state.ambient !== false) {
      const parts = [AMBIENT_CONTEXT];
      if (ctxBlock) parts.push(ctxBlock);
      emit({ additional_context: parts.join("\n\n") });
    } else {
      emit(ctxBlock ? { additional_context: ctxBlock } : {});
    }
    return;
  }

  // Don't restart if already active on same goal (avoid reset mid-loop)
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

  const parts = [
    AMBIENT_CONTEXT,
    `Orchestra auto-started (${reason}) — no /orchestra needed.`,
    `Goal: ${goal || prompt}`,
    "Phase: plan — launch **orchestra-planner** subagent first (Task tool).",
  ];
  if (ctxBlock) {
    parts.push(ctxBlock);
    parts.push("Planner: read all present context/*.md files before PLAN_READY.");
  }
  emit({ additional_context: parts.join("\n\n") });
}

main().catch(() => {
  emit({});
});

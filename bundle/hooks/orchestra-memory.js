#!/usr/bin/env node
"use strict";

const {
  loadState,
  readStdinJson,
  emit,
  loadLongTermMemory,
  buildMemoryContext,
} = require("./orchestra-lib.js");

/**
 * Memory hook — runs on subagentStop alongside lifecycle hook.
 * Injects long-term memory context when entering plan phase (iteration 0)
 * so the planner benefits from past orchestration knowledge.
 */
async function main() {
  const input = await readStdinJson();

  const state = loadState();
  if (!state.active) {
    emit({});
    return;
  }

  // After subagent-stop runs, phase advances to "implement" and iteration becomes 1.
  // Inject memory context at the start of the first implement phase.
  if (state.phase === "implement" && state.iteration === 1) {
    const ltm = loadLongTermMemory();
    const memCtx = buildMemoryContext(ltm);
    if (memCtx) {
      emit({
        additional_context: memCtx,
      });
      return;
    }
  }

  emit({});
}

main().catch(() => {
  emit({});
});

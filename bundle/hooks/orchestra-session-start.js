#!/usr/bin/env node
"use strict";

const {
  loadState,
  readStdinJson,
  emit,
  detectContextInWorkspaces,
  buildContextInjection,
  AMBIENT_CONTEXT,
  loadLongTermMemory,
  buildMemoryContext,
  detectCrashRecovery,
} = require("./orchestra-lib.js");

async function main() {
  const input = await readStdinJson();
  const state = loadState();
  const parts = [AMBIENT_CONTEXT];

  const ctx = detectContextInWorkspaces(input);
  const ctxBlock = buildContextInjection(ctx);
  if (ctxBlock) parts.push(ctxBlock);

  if (state.active) {
    // Check for crash recovery
    const crash = detectCrashRecovery(state);
    if (crash) {
      parts.push(
        `Orchestra was ACTIVE when session ended (possible crash or restart).`,
        `Goal: ${crash.goal}`,
        `Last phase: ${crash.phase} (iteration ${crash.iteration}).`,
        `Last activity: ${crash.last_activity}.`,
        `To resume: say "resume orchestra" or "continue orchestra".`,
        `To discard: say "stop orchestra" or "new goal".`
      );
    } else {
      parts.push(
        `Orchestra ACTIVE — goal: ${state.goal}`,
        `Phase: ${state.phase}. Continue chain with the matching orchestra-* subagent.`
      );
    }

    // Add short-term memory summary
    if (state.memory?.phases_completed?.length > 0) {
      const completed = state.memory.phases_completed.map((p) => p.phase).join(" → ");
      parts.push(`Phases completed so far: ${completed}`);
    }
  }

  // Inject long-term memory on session start
  const ltm = loadLongTermMemory();
  const memCtx = buildMemoryContext(ltm);
  if (memCtx) parts.push(memCtx);

  emit({ additional_context: parts.join("\n\n") });
}

main().catch(() => {
  emit({});
});

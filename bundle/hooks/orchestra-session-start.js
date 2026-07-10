#!/usr/bin/env node
"use strict";

const {
  loadState,
  readStdinJson,
  emit,
  detectContextInWorkspaces,
  buildContextInjection,
  AMBIENT_CONTEXT,
} = require("./orchestra-lib.js");

async function main() {
  const input = await readStdinJson();
  const state = loadState();
  const parts = [AMBIENT_CONTEXT];

  const ctx = detectContextInWorkspaces(input);
  const ctxBlock = buildContextInjection(ctx);
  if (ctxBlock) parts.push(ctxBlock);

  if (state.active) {
    parts.push(
      `Orchestra ACTIVE — goal: ${state.goal}`,
      `Phase: ${state.phase}. Continue chain with the matching orchestra-* subagent.`
    );
  }

  emit({ additional_context: parts.join("\n\n") });
}

main().catch(() => {
  emit({});
});

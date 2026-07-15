#!/usr/bin/env node
"use strict";

const { readStdinJson, emit } = require("./lib/io.js");
const { loadState } = require("./lib/state-manager.js");
const { loadLongTermMemory, buildMemoryContext } = require("./lib/memory-manager.js");

async function main() {
  const input = await readStdinJson();
  const state = loadState();
  if (!state.active) {
    emit({});
    return;
  }

  if (state.phase === "implement" && state.iteration === 1) {
    const ltm = loadLongTermMemory();
    const memCtx = buildMemoryContext(ltm);
    if (memCtx) {
      emit({ additional_context: memCtx });
      return;
    }
  }

  emit({});
}

main().catch(() => {
  emit({});
});

#!/usr/bin/env node
"use strict";

const { STOP_NUDGE_LOOP_LIMIT } = require("./lib/constants.js");
const { readStdinJson, emit } = require("./lib/io.js");
const { loadState, updateState } = require("./lib/state-manager.js");
const { AMBIENT_CONTEXT } = require("./lib/context-detector.js");
const { isStalled, writeHeartbeat } = require("./lib/heartbeat-monitor.js");
const { getAgentForPhase } = require("./lib/phase-engine.js");

async function main() {
  const input = await readStdinJson();
  const status = input.status || "";
  const loopCount = Number(input.loop_count ?? 0);

  if (status !== "completed") {
    emit({});
    return;
  }

  const loaded = loadState();
  if (!loaded.active) {
    emit({});
    return;
  }

  // Locked read → heartbeat → write: a concurrent hook cannot lose the beat.
  const state = updateState((s) => {
    if (!s.active) return null; // stopped underneath us — skip the write
    writeHeartbeat(s);
    return s;
  });
  if (!state) {
    emit({});
    return;
  }

  // Let heartbeat own stall messaging
  if (isStalled(state)) {
    emit({});
    return;
  }

  if (loopCount >= STOP_NUDGE_LOOP_LIMIT) {
    emit({});
    return;
  }

  const phase = state.currentPhase || "idle";
  if (phase === "idle" || phase === "done" || phase === "paused") {
    emit({});
    return;
  }

  const agent = getAgentForPhase(phase);
  const mode = state.loopMode || "core";
  emit({
    followup_message: [
      `Orchestra active (${mode}) — phase **${phase}**. Launch **${agent}** subagent to continue.`,
      `Goal: ${state.goal}`,
      `To abort: say "stop orchestra" or run: node ~/.cursor/hooks/orchestra-enable.js stop`,
      `(${AMBIENT_CONTEXT.split(".")[0]}.)`,
    ].join("\n\n"),
  });
}

main().catch(() => {
  emit({});
});

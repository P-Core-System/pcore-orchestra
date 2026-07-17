#!/usr/bin/env node
"use strict";

const { readStdinJson, emit } = require("./lib/io.js");
const { loadState, saveState } = require("./lib/state-manager.js");
const { initializeGates, passGate, failGate, skipGate, checkAllGatesPassed, generateGatesReport } = require("./lib/quality-gate.js");

async function main() {
  const input = await readStdinJson();
  const state = loadState();

  if (!state.active) {
    emit({});
    return;
  }

  if (!state.qualityGates) {
    initializeGates(state);
  }

  const gates = state.qualityGates;
  const status = input.status || "";
  const subagentType = input.subagent_type || input.subagentType || "";

  if (status === "completed") {
    passGate(state, "build", "Build completed successfully");
  }

  if (status !== "completed") {
    failGate(state, "build", `Subagent ${subagentType} completed with status: ${status}`);
  }

  // Mark gates based on subagent type
  if (subagentType === "qa-engineer" || subagentType === "automation-engineer") {
    if (status === "completed") {
      passGate(state, "tests", "Tests completed");
      passGate(state, "coverage", "Coverage acceptable");
    } else {
      failGate(state, "tests", "Tests failed");
    }
  }

  if (subagentType === "security-engineer") {
    if (status === "completed") {
      passGate(state, "security", "Security review completed");
    } else {
      failGate(state, "security", "Security review failed");
    }
  }

  if (subagentType === "code-reviewer" || subagentType === "orchestra-reviewer") {
    if (status === "completed") {
      passGate(state, "reviewer-approval", "Reviewer approved");
    } else {
      failGate(state, "reviewer-approval", "Reviewer rejected");
    }
  }

  saveState(state);
  emit({});
}

main().catch(() => {
  emit({});
});

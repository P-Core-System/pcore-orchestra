"use strict";

const { QUALITY_GATES } = require("./constants.js");

const GATE_LABELS = {
  build: "Build passes",
  tests: "Tests pass",
  coverage: "Coverage acceptable",
  lint: "Lint passes",
  security: "Security passes",
  "reviewer-approval": "Reviewer approves",
  "docs-updated": "Documentation updated",
  "version-updated": "Version updated",
  "changelog-updated": "Changelog updated",
  "roadmap-updated": "Roadmap updated",
  "memory-updated": "Project memory updated",
  "daily-journal-updated": "Daily journal updated",
  "release-notes-updated": "Release notes updated",
  "tech-debt-recorded": "Technical debt recorded",
  "production-checklist": "Production checklist",
};

function initializeGates(state) {
  state.qualityGates = {
    passed: [],
    failed: [],
    skipped: [],
    allRequiredPassed: false,
  };
  return state.qualityGates;
}

function passGate(state, gateId, details) {
  if (!state.qualityGates) initializeGates(state);
  const existing = state.qualityGates.passed.find(g => g.id === gateId);
  if (!existing) {
    state.qualityGates.passed.push({
      id: gateId,
      label: GATE_LABELS[gateId] || gateId,
      passedAt: new Date().toISOString(),
      details: details || null,
    });
  }
  // A later PASS supersedes an earlier FAIL, otherwise a single red run would
  // pin the outcome gate shut forever (failGate never drops its entry).
  if (Array.isArray(state.qualityGates.failed) && state.qualityGates.failed.length > 0) {
    state.qualityGates.failed = state.qualityGates.failed.filter(g => g.id !== gateId);
  }
  state.qualityGates.allRequiredPassed = checkAllGatesPassed(state);
  return state.qualityGates;
}

function failGate(state, gateId, reason) {
  if (!state.qualityGates) initializeGates(state);
  const existing = state.qualityGates.failed.find(g => g.id === gateId);
  if (!existing) {
    state.qualityGates.failed.push({
      id: gateId,
      label: GATE_LABELS[gateId] || gateId,
      failedAt: new Date().toISOString(),
      reason: reason || "Unknown",
    });
  }
  state.qualityGates.allRequiredPassed = false;
  return state.qualityGates;
}

function skipGate(state, gateId, reason) {
  if (!state.qualityGates) initializeGates(state);
  const existing = state.qualityGates.skipped.find(g => g.id === gateId);
  if (!existing) {
    state.qualityGates.skipped.push({
      id: gateId,
      label: GATE_LABELS[gateId] || gateId,
      skippedAt: new Date().toISOString(),
      reason: reason || "Not applicable",
    });
  }
  return state.qualityGates;
}

function checkAllGatesPassed(state) {
  const gates = state.qualityGates;
  if (!gates) return false;
  let required = QUALITY_GATES;
  try {
    const { requiredGatesForMode } = require("./evidence-runner.js");
    required = requiredGatesForMode(state.loopMode || "core");
  } catch {
    /* evidence-runner optional for older installs */
  }
  const attempted = new Set([
    ...gates.passed.map(g => g.id),
    ...gates.failed.map(g => g.id),
    ...gates.skipped.map(g => g.id),
  ]);
  for (const gate of required) {
    if (!attempted.has(gate)) return false;
  }
  // Only count failures on required gates
  const requiredSet = new Set(required);
  const failedRequired = gates.failed.filter((g) => requiredSet.has(g.id));
  return failedRequired.length === 0;
}

function generateGatesReport(state) {
  const gates = state.qualityGates || initializeGates(state);
  const lines = ["## Quality Gates Report\n"];
  const allGates = new Map();

  // Precedence: FAIL > PASS > SKIP. A gate can be both skipped earlier and
  // passed later (the docs-updated probe adds a pass where evidence produced
  // no verdict) — reporting SKIP there hid a real pass from the reviewer.
  for (const g of gates.skipped) allGates.set(g.id, { status: "SKIP", label: g.label, reason: g.reason });
  for (const g of gates.passed) allGates.set(g.id, { status: "PASS", label: g.label, details: g.details });
  for (const g of gates.failed) allGates.set(g.id, { status: "FAIL", label: g.label, reason: g.reason });

  for (const gateId of QUALITY_GATES) {
    const info = allGates.get(gateId) || { status: "PENDING", label: GATE_LABELS[gateId] || gateId };
    const statusIcon = info.status === "PASS" ? "✓" : info.status === "FAIL" ? "✗" : info.status === "SKIP" ? "–" : "○";
    lines.push(`${statusIcon} **${info.label}**: ${info.status}`);
    if (info.reason) lines.push(`   Reason: ${info.reason}`);
    if (info.details) lines.push(`   Details: ${info.details}`);
  }

  lines.push(`\n**Overall: ${gates.allRequiredPassed ? "ALL GATES PASSED" : "GATES NOT CLEARED"}**`);
  return lines.join("\n");
}

module.exports = {
  QUALITY_GATES,
  GATE_LABELS,
  initializeGates,
  passGate,
  failGate,
  skipGate,
  checkAllGatesPassed,
  generateGatesReport,
};

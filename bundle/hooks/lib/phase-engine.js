"use strict";

const { SDLC_PHASES, PHASE_IDS } = require("./constants.js");

const PHASE_MAP = {};
for (const p of SDLC_PHASES) {
  PHASE_MAP[p.id] = p;
}

const PHASE_CHAIN = {};
for (let i = 0; i < SDLC_PHASES.length; i++) {
  const current = SDLC_PHASES[i];
  const next = SDLC_PHASES[i + 1] || null;
  const prev = SDLC_PHASES[i - 1] || null;
  PHASE_CHAIN[current.id] = {
    agent: current.agent,
    category: current.category,
    readonly: current.readonly,
    index: i,
    nextPhase: next ? next.id : "done",
    prevPhase: prev ? prev.id : null,
    followup: next
      ? `Enterprise SDLC — ${current.id} complete. Proceed to ${next.id} (${next.agent}).`
      : null,
  };
}

const PHASE_AGENT_MAP = {};
for (const p of SDLC_PHASES) {
  PHASE_AGENT_MAP[p.id] = p.agent;
}

function getPhaseInfo(phaseId) {
  return PHASE_MAP[phaseId] || null;
}

function getAgentForPhase(phaseId) {
  return PHASE_AGENT_MAP[phaseId] || "orchestra-planner";
}

function getNextPhase(phaseId) {
  const info = PHASE_CHAIN[phaseId];
  return info ? info.nextPhase : "done";
}

function getPrevPhase(phaseId) {
  const info = PHASE_CHAIN[phaseId];
  return info ? info.prevPhase : null;
}

function getPhaseCategory(phaseId) {
  const info = PHASE_MAP[phaseId];
  return info ? info.category : null;
}

function isDiscoveryPhase(phaseId) {
  return getPhaseCategory(phaseId) === "discovery";
}

function isDesignPhase(phaseId) {
  return getPhaseCategory(phaseId) === "design";
}

function isPlanningPhase(phaseId) {
  return getPhaseCategory(phaseId) === "planning";
}

function isExecutionPhase(phaseId) {
  return getPhaseCategory(phaseId) === "execution";
}

function isQualityPhase(phaseId) {
  return getPhaseCategory(phaseId) === "quality";
}

function isReleasePhase(phaseId) {
  return getPhaseCategory(phaseId) === "release";
}

function isOperationsPhase(phaseId) {
  return getPhaseCategory(phaseId) === "operations";
}

function isReadonlyPhase(phaseId) {
  const info = PHASE_MAP[phaseId];
  return info ? info.readonly : true;
}

function advancePhase(state) {
  const current = state.currentPhase;
  const next = getNextPhase(current);
  if (next === "done") {
    state.currentPhase = "done";
    state.currentPhaseIndex = PHASE_IDS.length;
    state.phaseCategory = null;
    return false;
  }
  state.currentPhase = next;
  state.currentPhaseIndex = PHASE_IDS.indexOf(next);
  state.phaseCategory = getPhaseCategory(next);
  return true;
}

function reviewerNeedsFix(input) {
  const blob = [
    input.summary,
    input.result,
    input.output,
    input.final_text,
  ]
    .filter(Boolean)
    .join("\n");
  return /\bFIX_REQUIRED\b/i.test(blob) || /\bVERIFY_FAIL\b/i.test(blob);
}

module.exports = {
  SDLC_PHASES,
  PHASE_IDS,
  PHASE_MAP,
  PHASE_CHAIN,
  PHASE_AGENT_MAP,
  getPhaseInfo,
  getAgentForPhase,
  getNextPhase,
  getPrevPhase,
  getPhaseCategory,
  isDiscoveryPhase,
  isDesignPhase,
  isPlanningPhase,
  isExecutionPhase,
  isQualityPhase,
  isReleasePhase,
  isOperationsPhase,
  isReadonlyPhase,
  advancePhase,
  reviewerNeedsFix,
};

"use strict";

const {
  CORE_PHASES,
  CORE_PHASE_IDS,
  SDLC_PHASES,
  PHASE_IDS,
  SDLC_7STAGE_PHASES,
  SDLC_7STAGE_PHASE_IDS,
  LOOP_MODE_CORE,
  LOOP_MODE_ENTERPRISE,
  LOOP_MODE_SDLC_7STAGE,
} = require("./constants.js");

function buildPhaseChain(phases) {
  const chain = {};
  for (let i = 0; i < phases.length; i++) {
    const current = phases[i];
    const next = phases[i + 1] || null;
    const prev = phases[i - 1] || null;
    chain[current.id] = {
      agent: current.agent,
      category: current.category,
      readonly: current.readonly,
      index: i,
      nextPhase: next ? next.id : "done",
      prevPhase: prev ? prev.id : null,
      followup: next
        ? `${current.id} complete. Proceed to ${next.id} (${next.agent}).`
        : null,
    };
  }
  return chain;
}

function buildPhaseMap(phases) {
  const map = {};
  for (const p of phases) map[p.id] = p;
  return map;
}

const CORE_PHASE_CHAIN = buildPhaseChain(CORE_PHASES);
const ENTERPRISE_PHASE_CHAIN = buildPhaseChain(SDLC_PHASES);
const SDLC_7STAGE_PHASE_CHAIN = buildPhaseChain(SDLC_7STAGE_PHASES);
const CORE_PHASE_MAP = buildPhaseMap(CORE_PHASES);
const ENTERPRISE_PHASE_MAP = buildPhaseMap(SDLC_PHASES);
const SDLC_7STAGE_PHASE_MAP = buildPhaseMap(SDLC_7STAGE_PHASES);

/** Union map for lookups (core + enterprise + 7-stage). Core wins on id collision (none today). */
const PHASE_MAP = { ...ENTERPRISE_PHASE_MAP, ...CORE_PHASE_MAP, ...SDLC_7STAGE_PHASE_MAP };

/** @deprecated Prefer getPhaseChain(state) — defaults to enterprise for back-compat readers */
const PHASE_CHAIN = ENTERPRISE_PHASE_CHAIN;

const PHASE_AGENT_MAP = {};
for (const p of [...SDLC_PHASES, ...CORE_PHASES, ...SDLC_7STAGE_PHASES]) {
  PHASE_AGENT_MAP[p.id] = p.agent;
}

function normalizeLoopMode(mode) {
  if (mode === LOOP_MODE_ENTERPRISE) return LOOP_MODE_ENTERPRISE;
  if (mode === LOOP_MODE_SDLC_7STAGE) return LOOP_MODE_SDLC_7STAGE;
  return LOOP_MODE_CORE;
}

function filterPhasesByConfig(allPhases, enabledIds) {
  if (!enabledIds || enabledIds.length === 0) return allPhases;
  const set = new Set(enabledIds);
  const filtered = allPhases.filter((p) => set.has(p.id));
  return filtered.length > 0 ? filtered : allPhases;
}

function validatePhaseFilter(enabledIds, allPhases) {
  if (!enabledIds?.length) return { valid: true, unknown: [], effective: allPhases.map((p) => p.id) };
  const known = new Set(allPhases.map((p) => p.id));
  const unknown = enabledIds.filter((id) => !known.has(id));
  const effective = filterPhasesByConfig(allPhases, enabledIds).map((p) => p.id);
  return { valid: unknown.length === 0, unknown, effective };
}

/** Phases for current run — respects enterprise `orchestraConfig.phases` filter. */
function getPhasesForState(state) {
  const mode = normalizeLoopMode(state?.loopMode);
  if (mode === LOOP_MODE_ENTERPRISE)
    return filterPhasesByConfig(SDLC_PHASES, state?.orchestraConfig?.phases);
  if (mode === LOOP_MODE_SDLC_7STAGE) return SDLC_7STAGE_PHASES;
  return CORE_PHASES;
}

function getPhasesForMode(mode, state) {
  if (state && typeof state === "object") return getPhasesForState(state);
  const m = normalizeLoopMode(mode);
  if (m === LOOP_MODE_ENTERPRISE) return SDLC_PHASES;
  if (m === LOOP_MODE_SDLC_7STAGE) return SDLC_7STAGE_PHASES;
  return CORE_PHASES;
}

function getPhaseIdsForState(state) {
  return getPhasesForState(state).map((p) => p.id);
}

function getPhaseIdsForMode(mode, state) {
  if (state && typeof state === "object") return getPhaseIdsForState(state);
  const m = normalizeLoopMode(mode);
  if (m === LOOP_MODE_ENTERPRISE) return PHASE_IDS;
  if (m === LOOP_MODE_SDLC_7STAGE) return SDLC_7STAGE_PHASE_IDS;
  return CORE_PHASE_IDS;
}

function getPhaseChain(stateOrMode) {
  if (typeof stateOrMode === "object" && stateOrMode !== null) {
    const mode = normalizeLoopMode(stateOrMode.loopMode);
    if (mode === LOOP_MODE_ENTERPRISE)
      return buildPhaseChain(getPhasesForState(stateOrMode));
    if (mode === LOOP_MODE_SDLC_7STAGE) return SDLC_7STAGE_PHASE_CHAIN;
    return CORE_PHASE_CHAIN;
  }
  const mode = stateOrMode;
  const m = normalizeLoopMode(mode);
  if (m === LOOP_MODE_ENTERPRISE) return ENTERPRISE_PHASE_CHAIN;
  if (m === LOOP_MODE_SDLC_7STAGE) return SDLC_7STAGE_PHASE_CHAIN;
  return CORE_PHASE_CHAIN;
}

function getPhaseInfo(phaseId) {
  return PHASE_MAP[phaseId] || null;
}

function getAgentForPhase(phaseId) {
  return PHASE_AGENT_MAP[phaseId] || "orchestra-planner";
}

function getNextPhase(phaseId, stateOrMode) {
  const chain =
    typeof stateOrMode === "object" && stateOrMode !== null
      ? getPhaseChain(stateOrMode)
      : getPhaseChain(stateOrMode || LOOP_MODE_CORE);
  const info = chain[phaseId];
  return info ? info.nextPhase : "done";
}

function getPrevPhase(phaseId, stateOrMode) {
  const chain =
    typeof stateOrMode === "object" && stateOrMode !== null
      ? getPhaseChain(stateOrMode)
      : getPhaseChain(stateOrMode || LOOP_MODE_CORE);
  const info = chain[phaseId];
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
  return getPhaseCategory(phaseId) === "execution" || phaseId === "implement";
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

function isSdlc7StagePhase(phaseId) {
  return SDLC_7STAGE_PHASE_MAP[phaseId] !== undefined;
}

function getImplementPhaseId(mode) {
  return normalizeLoopMode(mode) === LOOP_MODE_ENTERPRISE
    ? "implementation"
    : "implement";
}

function advancePhase(state) {
  const ids = getPhaseIdsForState(state);
  const current = state.currentPhase;
  const next = getNextPhase(current, state);
  if (next === "done") {
    state.currentPhase = "done";
    state.currentPhaseIndex = ids.length;
    state.phaseCategory = null;
    return false;
  }
  state.currentPhase = next;
  state.currentPhaseIndex = ids.indexOf(next);
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
  CORE_PHASES,
  CORE_PHASE_IDS,
  SDLC_PHASES,
  PHASE_IDS,
  SDLC_7STAGE_PHASES,
  SDLC_7STAGE_PHASE_IDS,
  SDLC_7STAGE_PHASE_CHAIN,
  SDLC_7STAGE_PHASE_MAP,
  PHASE_MAP,
  PHASE_CHAIN,
  CORE_PHASE_CHAIN,
  ENTERPRISE_PHASE_CHAIN,
  PHASE_AGENT_MAP,
  LOOP_MODE_CORE,
  LOOP_MODE_ENTERPRISE,
  LOOP_MODE_SDLC_7STAGE,
  normalizeLoopMode,
  filterPhasesByConfig,
  validatePhaseFilter,
  getPhasesForState,
  getPhasesForMode,
  getPhaseIdsForState,
  getPhaseIdsForMode,
  getPhaseChain,
  getPhaseInfo,
  getAgentForPhase,
  getNextPhase,
  getPrevPhase,
  getPhaseCategory,
  getImplementPhaseId,
  isDiscoveryPhase,
  isDesignPhase,
  isPlanningPhase,
  isExecutionPhase,
  isQualityPhase,
  isReleasePhase,
  isOperationsPhase,
  isReadonlyPhase,
  isSdlc7StagePhase,
  advancePhase,
  reviewerNeedsFix,
};

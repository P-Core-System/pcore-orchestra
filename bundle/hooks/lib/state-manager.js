"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  DEFAULT_STALL_THRESHOLD_MS,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  INITIAL_VERSION,
  INITIAL_BUILD,
  LOOP_MODE_CORE,
  LOOP_MODE_ENTERPRISE,
} = require("./constants.js");
const { normalizeLoopMode, getPhaseCategory, getPhaseIdsForState, getPhasesForState } = require("./phase-engine.js");

const STATE_PATH = path.join(__dirname, "..", "state", "orchestra.json");

const DEFAULT_STATE = {
  version: 3,
  ambient: true,
  active: false,
  goal: "",
  loopMode: LOOP_MODE_CORE,
  currentPhase: "idle",
  currentPhaseIndex: -1,
  phaseCategory: null,
  started_at: null,
  last_subagent: null,
  iteration: 0,
  max_iterations: 8,
  last_prompt: null,
  auto_started: null,
  intake: null,

  project: {
    name: "",
    slug: "",
    displayName: "",
    vision: "",
    type: "software",
    category: "",
    owner: "",
    version: INITIAL_VERSION,
    buildNumber: INITIAL_BUILD,
    releaseChannel: "development",
    repository: "",
    defaultBranch: "main",
    lifecycleStage: "idea",
    lifecycleStatus: "active",
    identityFile: null,
    identityFormat: null,
  },

  versioning: {
    current: INITIAL_VERSION,
    buildNumber: INITIAL_BUILD,
    previous: null,
    bumpType: null,
    releaseName: null,
    releaseSlug: null,
    releaseTheme: null,
    releaseDate: null,
    gitSha: null,
    breakingChanges: [],
    migrationNotes: [],
  },

  qualityGates: {
    passed: [],
    failed: [],
    skipped: [],
    allRequiredPassed: false,
  },

  lifecycle: { events: [], phase_history: [] },
  heartbeat: {
    last_beat: null,
    phase_started_at: null,
    stall_threshold_ms: DEFAULT_STALL_THRESHOLD_MS,
    interval_ms: DEFAULT_HEARTBEAT_INTERVAL_MS,
  },
  memory: {
    phases_completed: [],
    files_changed: [],
    errors: [],
    decisions: [],
    context_summary: "",
  },
  resumable: {
    paused: false,
    paused_at: null,
    pause_reason: null,
    checkpoint: null,
    last_save: null,
  },
};

function cloneDefaults() {
  return {
    lifecycle: { events: [], phase_history: [] },
    heartbeat: { ...DEFAULT_STATE.heartbeat },
    memory: { ...DEFAULT_STATE.memory },
    resumable: { ...DEFAULT_STATE.resumable },
  };
}

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] && typeof source[key] === "object" && !Array.isArray(source[key])
    ) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

/** Migrate legacy `phase` → `currentPhase` and keep alias in sync for old readers. */
function normalizePhaseFields(state) {
  if (!state.currentPhase && state.phase) {
    state.currentPhase = state.phase;
  }
  if (!state.currentPhase) state.currentPhase = "idle";

  // Legacy V2 aliases used plan/implement/verify/review — already valid core ids
  const legacyMap = {
    planning: "plan",
    implementation: state.loopMode === LOOP_MODE_ENTERPRISE ? "implementation" : "implement",
  };
  if (legacyMap[state.currentPhase]) {
    state.currentPhase = legacyMap[state.currentPhase];
  }

  state.loopMode = normalizeLoopMode(state.loopMode || LOOP_MODE_CORE);
  state.phase = state.currentPhase; // dual-write for any leftover readers
  return state;
}

function loadState() {
  try {
    if (!fs.existsSync(STATE_PATH)) return { ...DEFAULT_STATE, ...cloneDefaults() };
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
    const merged = deepMerge(DEFAULT_STATE, raw);
    merged.version = 3;
    if (!merged.lifecycle) merged.lifecycle = { events: [], phase_history: [] };
    if (!merged.lifecycle.events) merged.lifecycle.events = [];
    if (!merged.lifecycle.phase_history) merged.lifecycle.phase_history = [];
    if (!merged.heartbeat) merged.heartbeat = { ...DEFAULT_STATE.heartbeat };
    if (!merged.memory) merged.memory = { ...DEFAULT_STATE.memory };
    if (!merged.resumable) merged.resumable = { ...DEFAULT_STATE.resumable };
    if (!merged.project) merged.project = { ...DEFAULT_STATE.project };
    if (!merged.project.slug) merged.project.slug = merged.project.name || "";
    if (!merged.project.type) merged.project.type = "software";
    if (!merged.project.lifecycleStage) merged.project.lifecycleStage = "development";
    if (!merged.project.lifecycleStatus) merged.project.lifecycleStatus = "active";
    if (!merged.versioning) merged.versioning = { ...DEFAULT_STATE.versioning };
    if (!merged.qualityGates) merged.qualityGates = { ...DEFAULT_STATE.qualityGates };
    return normalizePhaseFields(merged);
  } catch {
    return { ...DEFAULT_STATE, ...cloneDefaults() };
  }
}

function saveState(state) {
  normalizePhaseFields(state);
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

/**
 * @param {string} goal
 * @param {object} state
 * @param {string} source
 * @param {{ route?: string, intake?: object }} [options]
 */
function startOrchestra(goal, state, source, options) {
  const { emitLifecycleEvent } = require("./lifecycle-recorder.js");
  const orchestraConfig = options?.orchestraConfig || null;
  let route = normalizeLoopMode(options?.route || orchestraConfig?.route || LOOP_MODE_CORE);
  const enterprisePhases = getPhasesForState({ loopMode: route, orchestraConfig });
  const startPhase = route === LOOP_MODE_ENTERPRISE ? enterprisePhases[0].id : "plan";
  const ids = getPhaseIdsForState({ loopMode: route, orchestraConfig });

  state.active = true;
  state.goal = goal;
  state.loopMode = route;
  state.currentPhase = startPhase;
  state.currentPhaseIndex = ids.indexOf(startPhase);
  state.phaseCategory = getPhaseCategory(startPhase);
  state.phase = startPhase;
  state.started_at = new Date().toISOString();
  state.last_subagent = null;
  state.iteration = 0;
  state.last_prompt = goal;
  state.auto_started = source || "ambient";
  state.intake = options?.intake || {
    goal,
    route,
    plannerFirst: true,
    firstAgent: "orchestra-planner",
  };
  state.orchestraConfig = orchestraConfig;
  state.planAwaitingConfirm = false;
  state.planArtifact = null;

  const defaultMax = route === LOOP_MODE_ENTERPRISE ? 16 : 8;
  state.max_iterations = orchestraConfig?.max_iterations || defaultMax;
  state.lifecycle = { events: [], phase_history: [] };
  state.heartbeat.last_beat = new Date().toISOString();
  state.heartbeat.phase_started_at = new Date().toISOString();
  state.memory = {
    phases_completed: [], files_changed: [], errors: [], decisions: [], context_summary: "",
  };
  state.resumable = {
    paused: false, paused_at: null, pause_reason: null, checkpoint: null, last_save: null,
  };
  state.qualityGates = { passed: [], failed: [], skipped: [], allRequiredPassed: false };
  const { initRunTokens } = require("./token-tracker.js");
  initRunTokens(state);
  emitLifecycleEvent(state, "orchestra_start", startPhase, {
    goal,
    source,
    loopMode: route,
  });
  saveState(state);
}

function syncProjectIdentity(state, identity) {
  if (!identity) return;

  state.project.name = identity.project.name || state.project.name;
  state.project.slug = identity.project.slug || identity.project.name || state.project.slug;
  state.project.displayName = identity.project.display_name || state.project.displayName;
  state.project.type = identity.project.type || state.project.type;
  state.project.category = identity.project.category || state.project.category;
  state.project.owner = identity.project.owner || state.project.owner;
  state.project.version = identity.version.current || state.project.version;
  state.project.buildNumber = identity.version.build_number || state.project.buildNumber;
  state.project.releaseChannel = identity.version.channel || state.project.releaseChannel;
  state.project.lifecycleStage = identity.lifecycle.stage || state.project.lifecycleStage;
  state.project.lifecycleStatus = identity.lifecycle.status || state.project.lifecycleStatus;

  state.versioning.current = identity.version.current || state.versioning.current;
  state.versioning.buildNumber = identity.version.build_number || state.versioning.buildNumber;

  saveState(state);
}

function syncIdentityToFile(state, identity, rootDir) {
  if (!identity || !rootDir) return;
  const { PROJECT_YAML_NAME, PROJECT_JSON_NAME } = require("./constants.js");

  const yamlPath = path.join(rootDir, PROJECT_YAML_NAME);
  const jsonPath = path.join(rootDir, PROJECT_JSON_NAME);

  if (fs.existsSync(yamlPath)) {
    state.project.identityFile = yamlPath;
    state.project.identityFormat = "yaml";
  } else if (fs.existsSync(jsonPath)) {
    state.project.identityFile = jsonPath;
    state.project.identityFormat = "json";
  }

  saveState(state);
}

function resetProjectState(state) {
  state.project = { ...DEFAULT_STATE.project };
  state.versioning = { ...DEFAULT_STATE.versioning };
}

module.exports = {
  STATE_PATH,
  DEFAULT_STATE,
  loadState,
  saveState,
  startOrchestra,
  normalizePhaseFields,
  syncProjectIdentity,
  syncIdentityToFile,
  resetProjectState,
};

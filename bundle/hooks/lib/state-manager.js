"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  DEFAULT_STALL_THRESHOLD_MS,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  INITIAL_VERSION,
  INITIAL_BUILD,
} = require("./constants.js");

const STATE_PATH = path.join(__dirname, "..", "state", "orchestra.json");

const DEFAULT_STATE = {
  version: 3,
  ambient: true,
  active: false,
  goal: "",
  currentPhase: "idle",
  currentPhaseIndex: -1,
  phaseCategory: null,
  started_at: null,
  last_subagent: null,
  iteration: 0,
  max_iterations: 8,
  last_prompt: null,
  auto_started: null,

  // V3: Project management
  // V3.1: Extended with project identity fields
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

  // V3: Version management
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

  // V3: Quality gates
  qualityGates: {
    passed: [],
    failed: [],
    skipped: [],
    allRequiredPassed: false,
  },

  // Core lifecycle
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
    return merged;
  } catch {
    return { ...DEFAULT_STATE, ...cloneDefaults() };
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function startOrchestra(goal, state, source) {
  const { emitLifecycleEvent } = require("./lifecycle-recorder.js");

  state.active = true;
  state.goal = goal;
  state.currentPhase = "idea";
  state.currentPhaseIndex = 0;
  state.phaseCategory = "discovery";
  state.started_at = new Date().toISOString();
  state.last_subagent = null;
  state.iteration = 0;
  state.last_prompt = goal;
  state.auto_started = source || "ambient";
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
  emitLifecycleEvent(state, "orchestra_start", "idea", { goal, source });
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
  const fs = require("node:fs");
  const path = require("node:path");

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
  syncProjectIdentity,
  syncIdentityToFile,
  resetProjectState,
};

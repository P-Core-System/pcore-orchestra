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

const DEFAULT_SESSION_STATE = {
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
    heartbeat: { ...DEFAULT_SESSION_STATE.heartbeat },
    memory: { ...DEFAULT_SESSION_STATE.memory },
    resumable: { ...DEFAULT_SESSION_STATE.resumable },
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

/** Get the session ID from environment variables. */
function getSessionId() {
  return (
    process.env.PCORE_SESSION_ID ||
    process.env.OPENCODE_SESSION_ID ||
    process.env.CLAUDE_SESSION_ID ||
    process.env.CURSOR_TRACE_ID ||
    "pid-" + process.pid
  );
}

/** Create a new empty session state with defaults. */
function createSessionState() {
  return { ...DEFAULT_SESSION_STATE, ...cloneDefaults() };
}

/** Migrate legacy flat state to session-namespaced structure. */
function migrateToSessions(raw) {
  // If already has sessions structure, return as-is
  if (raw && raw.sessions && typeof raw.sessions === "object") {
    return raw;
  }

  // Legacy flat structure - migrate to sessions with default session ID
  const sessionId = getSessionId();
  const migrated = {
    version: 3,
    sessions: {},
  };
  migrated.sessions[sessionId] = deepMerge(DEFAULT_SESSION_STATE, raw || {});
  return migrated;
}

function loadState(rootDir, sessionId) {
  const session = sessionId || getSessionId();
  const statePath = rootDir
    ? path.join(rootDir, ".cursor", "hooks", "state", "orchestra.json")
    : STATE_PATH;

  try {
    if (!fs.existsSync(statePath)) {
      const empty = { version: 3, sessions: {} };
      empty.sessions[session] = createSessionState();
      return empty;
    }
    const raw = JSON.parse(fs.readFileSync(statePath, "utf8"));
    const migrated = migrateToSessions(raw);

    // Ensure the requested session exists
    if (!migrated.sessions[session]) {
      migrated.sessions[session] = createSessionState();
    }

    // Normalize all sessions
    for (const [sid, s] of Object.entries(migrated.sessions)) {
      if (!s.lifecycle) s.lifecycle = { events: [], phase_history: [] };
      if (!s.lifecycle.events) s.lifecycle.events = [];
      if (!s.lifecycle.phase_history) s.lifecycle.phase_history = [];
      if (!s.heartbeat) s.heartbeat = { ...DEFAULT_SESSION_STATE.heartbeat };
      if (!s.memory) s.memory = { ...DEFAULT_SESSION_STATE.memory };
      if (!s.resumable) s.resumable = { ...DEFAULT_SESSION_STATE.resumable };
      if (!s.project) s.project = { ...DEFAULT_SESSION_STATE.project };
      if (!s.project.slug) s.project.slug = s.project.name || "";
      if (!s.project.type) s.project.type = "software";
      if (!s.project.lifecycleStage) s.project.lifecycleStage = "development";
      if (!s.project.lifecycleStatus) s.project.lifecycleStatus = "active";
      if (!s.versioning) s.versioning = { ...DEFAULT_SESSION_STATE.versioning };
      if (!s.qualityGates) s.qualityGates = { ...DEFAULT_SESSION_STATE.qualityGates };
      normalizePhaseFields(s);
    }

    return migrated;
  } catch {
    const empty = { version: 3, sessions: {} };
    empty.sessions[session] = createSessionState();
    return empty;
  }
}

function saveState(rootDir, state, sessionId) {
  const session = sessionId || getSessionId();
  const statePath = rootDir
    ? path.join(rootDir, ".cursor", "hooks", "state", "orchestra.json")
    : STATE_PATH;

  // Ensure sessions structure exists
  if (!state.sessions) {
    state.sessions = {};
  }
  if (!state.sessions[session]) {
    state.sessions[session] = createSessionState();
  }

  // Normalize the target session
  normalizePhaseFields(state.sessions[session]);

  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

/** Get the current session's state from the full state object. */
function getSessionState(state, sessionId) {
  const session = sessionId || getSessionId();
  if (!state.sessions) return createSessionState();
  return state.sessions[session] || createSessionState();
}

/** Set the current session's state in the full state object. */
function setSessionState(state, sessionState, sessionId) {
  const session = sessionId || getSessionId();
  if (!state.sessions) state.sessions = {};
  state.sessions[session] = sessionState;
}

function startOrchestra(goal, state, source, options) {
  const { emitLifecycleEvent } = require("./lifecycle-recorder.js");
  const sessionId = getSessionId();
  const session = getSessionState(state, sessionId);

  const orchestraConfig = options?.orchestraConfig || null;
  let route = normalizeLoopMode(options?.route || orchestraConfig?.route || LOOP_MODE_CORE);
  const enterprisePhases = getPhasesForState({ loopMode: route, orchestraConfig });
  const startPhase = route === LOOP_MODE_ENTERPRISE ? enterprisePhases[0].id : "plan";
  const ids = getPhaseIdsForState({ loopMode: route, orchestraConfig });

  session.active = true;
  session.goal = goal;
  session.loopMode = route;
  session.currentPhase = startPhase;
  session.currentPhaseIndex = ids.indexOf(startPhase);
  session.phaseCategory = getPhaseCategory(startPhase);
  session.phase = startPhase;
  session.started_at = new Date().toISOString();
  session.last_subagent = null;
  session.iteration = 0;
  session.last_prompt = goal;
  session.auto_started = source || "ambient";
  session.intake = options?.intake || {
    goal,
    route,
    plannerFirst: true,
    firstAgent: "orchestra-planner",
  };
  session.orchestraConfig = orchestraConfig;
  session.planAwaitingConfirm = false;
  session.planArtifact = null;

  const defaultMax = route === LOOP_MODE_ENTERPRISE ? 16 : 8;
  session.max_iterations = orchestraConfig?.max_iterations || defaultMax;
  session.lifecycle = { events: [], phase_history: [] };
  session.heartbeat.last_beat = new Date().toISOString();
  session.heartbeat.phase_started_at = new Date().toISOString();
  session.memory = {
    phases_completed: [], files_changed: [], errors: [], decisions: [], context_summary: "",
  };
  session.resumable = {
    paused: false, paused_at: null, pause_reason: null, checkpoint: null, last_save: null,
  };
  session.qualityGates = { passed: [], failed: [], skipped: [], allRequiredPassed: false };
  const { initRunTokens } = require("./token-tracker.js");
  initRunTokens(session);
  emitLifecycleEvent(session, "orchestra_start", startPhase, {
    goal,
    source,
    loopMode: route,
    sessionId,
  });
  setSessionState(state, session, sessionId);
  saveState(null, state, sessionId);
}

function syncProjectIdentity(state, identity) {
  const sessionId = getSessionId();
  const session = getSessionState(state, sessionId);

  if (!identity) return;

  session.project.name = identity.project.name || session.project.name;
  session.project.slug = identity.project.slug || identity.project.name || session.project.slug;
  session.project.displayName = identity.project.display_name || session.project.displayName;
  session.project.type = identity.project.type || session.project.type;
  session.project.category = identity.project.category || session.project.category;
  session.project.owner = identity.project.owner || session.project.owner;
  session.project.version = identity.version.current || session.project.version;
  session.project.buildNumber = identity.version.build_number || session.project.buildNumber;
  session.project.releaseChannel = identity.version.channel || session.project.releaseChannel;
  session.project.lifecycleStage = identity.lifecycle.stage || session.project.lifecycleStage;
  session.project.lifecycleStatus = identity.lifecycle.status || session.project.lifecycleStatus;

  session.versioning.current = identity.version.current || session.versioning.current;
  session.versioning.buildNumber = identity.version.build_number || session.versioning.buildNumber;

  setSessionState(state, session, sessionId);
  saveState(null, state, sessionId);
}

function syncIdentityToFile(state, identity, rootDir) {
  const sessionId = getSessionId();
  const session = getSessionState(state, sessionId);

  if (!identity || !rootDir) return;
  const { PROJECT_YAML_NAME, PROJECT_JSON_NAME } = require("./constants.js");

  const yamlPath = path.join(rootDir, PROJECT_YAML_NAME);
  const jsonPath = path.join(rootDir, PROJECT_JSON_NAME);

  if (fs.existsSync(yamlPath)) {
    session.project.identityFile = yamlPath;
    session.project.identityFormat = "yaml";
  } else if (fs.existsSync(jsonPath)) {
    session.project.identityFile = jsonPath;
    session.project.identityFormat = "json";
  }

  setSessionState(state, session, sessionId);
  saveState(null, state, sessionId);
}

function resetProjectState(state) {
  const sessionId = getSessionId();
  const session = getSessionState(state, sessionId);
  session.project = { ...DEFAULT_SESSION_STATE.project };
  session.versioning = { ...DEFAULT_SESSION_STATE.versioning };
  setSessionState(state, session, sessionId);
  saveState(null, state, sessionId);
}

module.exports = {
  STATE_PATH,
  DEFAULT_SESSION_STATE,
  loadState,
  saveState,
  startOrchestra,
  normalizePhaseFields,
  syncProjectIdentity,
  syncIdentityToFile,
  resetProjectState,
  getSessionId,
  getSessionState,
  setSessionState,
  createSessionState,
};

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

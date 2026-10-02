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
const { writeJson, readJsonSafe, resolveStatePath: resolveStateFile, withLock } = require("./safe-write.js");

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

/** Alias for hooks/CLI that still import DEFAULT_STATE. */
const DEFAULT_STATE = DEFAULT_SESSION_STATE;

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

/** True when object is a sessions root `{ version, sessions }`. */
function isRootState(obj) {
  return !!(obj && typeof obj === "object" && obj.sessions && typeof obj.sessions === "object");
}

/**
 * True when object looks like a flat session (has active/currentPhase/goal, no sessions).
 * Used to overload saveState(session) vs saveState(root).
 */
function isSessionShaped(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
  if (obj.sessions) return false;
  return "active" in obj || "currentPhase" in obj || "goal" in obj;
}

/** Resolve on-disk path; never path.join a non-string. `PCORE_STATE_DIR` wins. */
function resolveStatePath(rootDir) {
  if (typeof rootDir === "string" && rootDir.length > 0) {
    return resolveStateFile(path.join(rootDir, ".cursor", "hooks", "state", "orchestra.json"));
  }
  return resolveStateFile(STATE_PATH);
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

function normalizeSession(s) {
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
  return s;
}

/**
 * Always returns `{ version, sessions }` root.
 * Migrates flat disk format → sessions on read.
 */
function loadRootState(rootDir, sessionId) {
  const session = sessionId || getSessionId();
  const statePath = resolveStatePath(rootDir);

  try {
    if (!fs.existsSync(statePath)) {
      const empty = { version: 3, sessions: {} };
      empty.sessions[session] = createSessionState();
      return empty;
    }
    // readJsonSafe quarantines a corrupt file to `.corrupt-<ts>` and returns
    // defaults — never a silent in-place reset.
    const raw = readJsonSafe(statePath, null);
    if (!raw || typeof raw !== "object") {
      const empty = { version: 3, sessions: {} };
      empty.sessions[session] = createSessionState();
      return empty;
    }
    const migrated = migrateToSessions(raw);

    if (!migrated.sessions[session]) {
      migrated.sessions[session] = createSessionState();
    }

    for (const [, s] of Object.entries(migrated.sessions)) {
      normalizeSession(s);
    }

    return migrated;
  } catch {
    const empty = { version: 3, sessions: {} };
    empty.sessions[session] = createSessionState();
    return empty;
  }
}

/**
 * Returns the **session** object (what hooks/CLI expect: `.active`, `.goal`, …).
 * Signature: loadState() | loadState(rootDir) | loadState(rootDir, sessionId)
 */
function loadState(rootDir, sessionId) {
  const root = loadRootState(rootDir, sessionId);
  return getSessionState(root, sessionId || getSessionId());
}

/**
 * Overload-safe persist.
 * - saveState(sessionOrRoot)
 * - saveState(sessionOrRoot, sessionId)
 * - saveState(null|rootDir, sessionOrRoot, sessionId?)
 * Session-shaped payloads are merged into root.sessions[sid] then written as sessions root.
 * Never path.join on a non-string.
 */
function saveState(a, b, c) {
  let rootDir = null;
  let payload;
  let sessionId;

  if (a === null || typeof a === "string") {
    rootDir = a;
    payload = b;
    sessionId = typeof c === "string" ? c : undefined;
  } else if (a && typeof a === "object") {
    payload = a;
    if (typeof b === "string") sessionId = b;
  } else {
    throw new TypeError("saveState: expected state object or (rootDir, state)");
  }

  if (!payload || typeof payload !== "object") {
    throw new TypeError("saveState: state must be an object");
  }

  const sid = sessionId || getSessionId();
  const statePath = resolveStatePath(rootDir);

  let root;
  if (isSessionShaped(payload)) {
    root = loadRootState(rootDir, sid);
    normalizePhaseFields(payload);
    root.sessions[sid] = payload;
  } else if (isRootState(payload)) {
    root = payload;
    if (!root.sessions[sid]) {
      root.sessions[sid] = createSessionState();
    }
    normalizePhaseFields(root.sessions[sid]);
  } else {
    // Ambiguous plain object — treat as session fields
    root = loadRootState(rootDir, sid);
    const merged = deepMerge(createSessionState(), payload);
    normalizePhaseFields(merged);
    root.sessions[sid] = merged;
  }

  if (!root.version) root.version = 3;

  writeJson(statePath, root);
}

/**
 * Locked read → mutate → write. The `.lock` file is held for the whole
 * load/mutate/save cycle so concurrent hook processes cannot interleave a
 * read-modify-write and lose each other's updates.
 *
 * @param {(session: object) => object|null|undefined} mutator receives the
 *   loaded session; return the session (or nothing) to persist, or `null` to
 *   abort without saving.
 * @param {{rootDir?: string|null, sessionId?: string, waitMs?: number}} [options]
 * @returns {object|null} the persisted session, or null when aborted
 */
function updateState(mutator, options = {}) {
  if (typeof mutator !== "function") {
    throw new TypeError("updateState: expected a mutator function");
  }
  const sid = options.sessionId || getSessionId();
  const rootDir = typeof options.rootDir === "string" ? options.rootDir : null;
  const statePath = resolveStatePath(rootDir);

  return withLock(
    statePath,
    () => {
      const session = loadState(rootDir, sid);
      const next = mutator(session);
      if (next === null) return null;
      const payload = next && typeof next === "object" ? next : session;
      saveState(rootDir, payload, sid);
      return payload;
    },
    { waitMs: options.waitMs }
  );
}

/** Get the current session's state from the full state object. */
function getSessionState(state, sessionId) {
  const session = sessionId || getSessionId();
  if (!state || !state.sessions) return createSessionState();
  return state.sessions[session] || createSessionState();
}

/** Set the current session's state in the full state object. */
function setSessionState(state, sessionState, sessionId) {
  const session = sessionId || getSessionId();
  if (!state.sessions) state.sessions = {};
  state.sessions[session] = sessionState;
}

/**
 * Resolve root + session from either a sessions root or a flat session object.
 * Mutates the caller's session object in place when session-shaped (tests/CLI).
 */
function resolveRootAndSession(state) {
  const sessionId = getSessionId();
  if (isRootState(state)) {
    return { root: state, session: getSessionState(state, sessionId), sessionId };
  }
  if (state && typeof state === "object") {
    return { root: loadRootState(null, sessionId), session: state, sessionId };
  }
  const root = loadRootState(null, sessionId);
  return { root, session: getSessionState(root, sessionId), sessionId };
}

function startOrchestra(goal, state, source, options) {
  const { emitLifecycleEvent } = require("./lifecycle-recorder.js");
  const { root, session, sessionId } = resolveRootAndSession(state);

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
  setSessionState(root, session, sessionId);
  saveState(null, root, sessionId);
}

function syncProjectIdentity(state, identity) {
  const { root, session, sessionId } = resolveRootAndSession(state);

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

  setSessionState(root, session, sessionId);
  saveState(null, root, sessionId);
}

function syncIdentityToFile(state, identity, rootDir) {
  const { root, session, sessionId } = resolveRootAndSession(state);

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

  setSessionState(root, session, sessionId);
  saveState(null, root, sessionId);
}

function resetProjectState(state) {
  const { root, session, sessionId } = resolveRootAndSession(state);
  session.project = { ...DEFAULT_SESSION_STATE.project };
  session.versioning = { ...DEFAULT_SESSION_STATE.versioning };
  setSessionState(root, session, sessionId);
  saveState(null, root, sessionId);
}

module.exports = {
  STATE_PATH,
  DEFAULT_SESSION_STATE,
  DEFAULT_STATE,
  loadRootState,
  loadState,
  saveState,
  updateState,
  startOrchestra,
  normalizePhaseFields,
  syncProjectIdentity,
  syncIdentityToFile,
  resetProjectState,
  getSessionId,
  getSessionState,
  setSessionState,
  createSessionState,
  migrateToSessions,
  isSessionShaped,
  isRootState,
};

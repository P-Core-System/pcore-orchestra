"use strict";

/**
 * Harness observability — additive, fail-open event log that records how the
 * harness is used so it can be relearned from:
 *
 *   1. How INPUT is received and classified (input.received / input.classified)
 *   2. WHO spawned WHICH agent and whether it succeeded
 *      (spawn.attempted / spawn.result)
 *   3. Every PERMISSION DENIED (permission.denied)
 *
 * Contract:
 *  - Additive logging ONLY. This module never changes hook stdout, exit codes,
 *    permission decisions, agent files, config, or existing state shapes.
 *    Every public function swallows its own errors — an observability failure
 *    can never break a hook or a session (fail-open, invariant 1).
 *  - All writes go through safe-write.js (withLock + readJsonSafe + writeJson;
 *    atomic tmp+rename, quarantine-on-corruption, PCORE_STATE_DIR aware,
 *    invariant 15). No raw fs writes on the log — the source is scanned.
 *  - Storage is one ring-capped JSON file, `<state>/harness-observability.json`
 *    (a bare event array, capped at OBSERVABILITY_EVENT_CAP — oldest trimmed
 *    first). The default state dir is `~/.config/opencode/hooks/state` (same
 *    as lib/domain/store.js, invariant 19); `PCORE_STATE_DIR` overrides it; an
 *    optional worktreePath partitions the file under `<worktree>/.pcore/state/`
 *    (invariant 31). All events share the global log by default so health
 *    reports see every session; the advisory lock serializes concurrent runs.
 *  - Dependency-free: node builtins + ./safe-write.js only.
 *  - Free-text fields are clamped and token-shaped substrings are redacted
 *    before persistence — previews are for pattern analysis, not archival.
 *
 * Byte-identical mirror: bundle/opencode/hooks/lib/harness-observability.js
 * (invariant 18).
 */

const os = require("node:os");
const path = require("node:path");
const { withLock, readJsonSafe, writeJson, resolveStateDir } = require("./safe-write.js");

// --- constants (local: observability is a leaf module, self-contained) ---
const OBSERVABILITY_SCHEMA_VERSION = 1;
const OBSERVABILITY_FILE_NAME = "harness-observability.json";
const OBSERVABILITY_EVENT_CAP = 500;
const OBSERVABILITY_LOCK_WAIT_MS = 2000; // never stall a hook on a stuck lock
const OBSERVABILITY_WINDOW_MS = 24 * 60 * 60 * 1000; // "recent" for reports
const RECENT_DENIALS_SAMPLE = 10; // newest denials surfaced by health reports
const PROMPT_SAMPLE_MAX = 120; // clamp prompt previews
const FIELD_SAMPLE_MAX = 120; // clamp other free-text fields
const ERROR_SAMPLE_MAX = 200; // clamp error messages
const SPAWN_PAYLOAD_KEYS_MAX = 24; // cap recorded payload key names
const EVENT_ID_PREFIX = "obs-";

const EVENT_KINDS = Object.freeze({
  INPUT_RECEIVED: "input.received",
  INPUT_CLASSIFIED: "input.classified",
  SPAWN_ATTEMPTED: "spawn.attempted",
  SPAWN_RESULT: "spawn.result",
  PERMISSION_DENIED: "permission.denied",
});

/**
 * Token shapes redacted from previews before persistence (defence-in-depth,
 * not exhaustive — previews are short samples, not archives).
 */
const REDACTION_PATTERN =
  /(?:gh[pous]_[A-Za-z0-9]{6,}|github_pat_[A-Za-z0-9_]{6,}|sk-[A-Za-z0-9_-]{8,}|AKIA[0-9A-Z]{8,}|xox[abpors]-[A-Za-z0-9-]{6,}|Bearer\s+[A-Za-z0-9._~+/=-]{8,})/gi;

// --- paths (same resolution as lib/domain/store.js) ---

/** Shared state dir used by the other orchestra state writers. */
function defaultStateDir() {
  return path.join(os.homedir(), ".config", "opencode", "hooks", "state");
}

/** Resolved state dir: `PCORE_STATE_DIR` wins, never a path inside the bundle. */
function stateDir(worktreePath) {
  if (worktreePath && typeof worktreePath === "string") {
    return path.join(worktreePath, ".pcore", "state");
  }
  return resolveStateDir(defaultStateDir());
}

/** Resolved path of the observability log (honors PCORE_STATE_DIR). */
function observabilityPath(worktreePath) {
  return path.join(stateDir(worktreePath), OBSERVABILITY_FILE_NAME);
}

// --- envelope helpers ---

/** Clamp free text and redact token-shaped substrings; non-strings -> "". */
function safePreview(value, maxLen) {
  if (typeof value !== "string" || value.length === 0) return "";
  let text = value;
  try {
    text = text.replace(REDACTION_PATTERN, "[redacted]");
  } catch {
    /* pattern is static — defence only */
  }
  const limit = Number.isInteger(maxLen) && maxLen > 0 ? maxLen : PROMPT_SAMPLE_MAX;
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function newEventId() {
  return `${EVENT_ID_PREFIX}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Same session-id chain as state-manager.getSessionId (guarded, with fallback). */
function resolveSessionId() {
  try {
    const stateManager = require("./state-manager.js");
    if (stateManager && typeof stateManager.getSessionId === "function") {
      return stateManager.getSessionId();
    }
  } catch {
    /* fall through to the env chain */
  }
  return (
    process.env.PCORE_SESSION_ID ||
    process.env.OPENCODE_SESSION_ID ||
    process.env.CLAUDE_SESSION_ID ||
    process.env.CURSOR_TRACE_ID ||
    `pid-${process.pid}`
  );
}

// --- store (safe-write only; ring-capped) ---

/** @returns {object[]} ring-capped event list; corrupt/missing -> []. */
function loadHarnessEvents(worktreePath) {
  try {
    const data = readJsonSafe(observabilityPath(worktreePath), []);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/** Ring-append one event under the advisory lock (oldest trimmed first). */
function appendEvent(event, worktreePath) {
  const file = observabilityPath(worktreePath);
  withLock(
    file,
    () => {
      const current = readJsonSafe(file, []);
      const list = Array.isArray(current) ? current : [];
      list.push(event);
      const trimmed =
        list.length > OBSERVABILITY_EVENT_CAP ? list.slice(list.length - OBSERVABILITY_EVENT_CAP) : list;
      writeJson(file, trimmed);
    },
    { waitMs: OBSERVABILITY_LOCK_WAIT_MS }
  );
  return event;
}

/**
 * Record one event; NEVER throws. Returns the stored event or null.
 * @param {string} kind one of EVENT_KINDS
 * @param {object} data kind-specific payload (strings clamped+redacted here)
 * @param {{sessionId?:string, runId?:string|null, worktreePath?:string}} [ctx]
 */
function recordHarnessEvent(kind, data, ctx) {
  try {
    const c = ctx || {};
    const event = {
      id: newEventId(),
      kind,
      at: new Date().toISOString(),
      sessionId:
        typeof c.sessionId === "string" && c.sessionId ? c.sessionId : resolveSessionId(),
      runId: typeof c.runId === "string" && c.runId ? c.runId : null,
      data: data && typeof data === "object" ? data : {},
    };
    appendEvent(event, c.worktreePath);
    return event;
  } catch {
    return null; // fail-open: observability can never break the caller
  }
}

// --- public emitters (one per event kind) ---

/** input.received — how an input reached the harness. */
function recordInputReceived(payload) {
  const p = payload || {};
  return recordHarnessEvent(
    EVENT_KINDS.INPUT_RECEIVED,
    {
      source: typeof p.source === "string" && p.source ? p.source : "prompt",
      chars: typeof p.prompt === "string" ? p.prompt.length : 0,
      promptPreview: safePreview(p.prompt, PROMPT_SAMPLE_MAX),
      cwd: typeof p.cwd === "string" ? p.cwd : null,
    },
    p
  );
}

/** input.classified — the classifier's decision on a received input. */
function recordInputClassification(payload) {
  const p = payload || {};
  const c = p.classification && typeof p.classification === "object" ? p.classification : {};
  return recordHarnessEvent(
    EVENT_KINDS.INPUT_CLASSIFIED,
    {
      activate: !!c.activate,
      reason: typeof c.reason === "string" ? c.reason : null,
      route: typeof c.route === "string" ? c.route : null,
      routeReason: typeof c.routeReason === "string" ? c.routeReason : null,
      clarifyNeeded: !!c.clarifyNeeded,
      informal: !!c.informal,
      inferFromContext: !!c.inferFromContext,
      greenfield: !!c.greenfield,
      goalPreview: safePreview(c.goal, FIELD_SAMPLE_MAX),
    },
    p
  );
}

/** spawn.attempted — WHO (fromAgent/host) is spawning WHICH agent. */
function recordSpawnAttempted(payload) {
  const p = payload || {};
  return recordHarnessEvent(
    EVENT_KINDS.SPAWN_ATTEMPTED,
    {
      host: typeof p.host === "string" ? p.host : null,
      toAgent: typeof p.toAgent === "string" ? p.toAgent : null,
      fromAgent: typeof p.fromAgent === "string" ? p.fromAgent : null,
      phase: typeof p.phase === "string" ? p.phase : null,
      payloadKeys: Array.isArray(p.payloadKeys) ? p.payloadKeys.slice(0, SPAWN_PAYLOAD_KEYS_MAX) : [],
    },
    p
  );
}

/** spawn.result — did the spawn succeed (ok|error + artifact count). */
function recordSpawnResult(payload) {
  const p = payload || {};
  return recordHarnessEvent(
    EVENT_KINDS.SPAWN_RESULT,
    {
      host: typeof p.host === "string" ? p.host : null,
      toAgent: typeof p.toAgent === "string" ? p.toAgent : null,
      fromAgent: typeof p.fromAgent === "string" ? p.fromAgent : null,
      phase: typeof p.phase === "string" ? p.phase : null,
      ok: !!p.ok,
      error: safePreview(p.error, ERROR_SAMPLE_MAX),
      artifacts: Number.isInteger(p.artifacts) && p.artifacts >= 0 ? p.artifacts : 0,
    },
    p
  );
}

/** permission.denied — every harness-level denial (additive; semantics unchanged). */
function recordPermissionDenied(payload) {
  const p = payload || {};
  return recordHarnessEvent(
    EVENT_KINDS.PERMISSION_DENIED,
    {
      scope: typeof p.scope === "string" ? p.scope : null,
      rule: typeof p.rule === "string" ? p.rule : null,
      subject: safePreview(p.subject, FIELD_SAMPLE_MAX),
      reason: safePreview(p.reason, ERROR_SAMPLE_MAX),
      host: typeof p.host === "string" ? p.host : null,
      toAgent: typeof p.toAgent === "string" ? p.toAgent : null,
    },
    p
  );
}

// --- report helpers (report-only consumers, e.g. health checks) ---

/**
 * Count permission.denied events inside the recent window (report-only).
 * Never throws.
 * @returns {{count:number, events:object[]}} newest-last; events capped at RECENT_DENIALS_SAMPLE
 */
function countRecentPermissionDenials(options) {
  const o = options || {};
  try {
    const windowMs =
      Number.isFinite(o.windowMs) && o.windowMs > 0 ? o.windowMs : OBSERVABILITY_WINDOW_MS;
    const cutoff = Date.now() - windowMs;
    const recent = loadHarnessEvents(o.worktreePath).filter((e) => {
      if (!e || e.kind !== EVENT_KINDS.PERMISSION_DENIED) return false;
      const at = Date.parse(e.at);
      return Number.isFinite(at) && at >= cutoff;
    });
    return { count: recent.length, events: recent.slice(-RECENT_DENIALS_SAMPLE) };
  } catch {
    return { count: 0, events: [] };
  }
}

/**
 * Event counts by kind inside the recent window (report-only). Never throws.
 * @returns {{total:number, byKind:Object<string,number>}}
 */
function summarizeRecentEvents(options) {
  const o = options || {};
  try {
    const windowMs =
      Number.isFinite(o.windowMs) && o.windowMs > 0 ? o.windowMs : OBSERVABILITY_WINDOW_MS;
    const cutoff = Date.now() - windowMs;
    const byKind = {};
    let total = 0;
    for (const e of loadHarnessEvents(o.worktreePath)) {
      if (!e || typeof e.kind !== "string") continue;
      const at = Date.parse(e.at);
      if (!Number.isFinite(at) || at < cutoff) continue;
      total += 1;
      byKind[e.kind] = (byKind[e.kind] || 0) + 1;
    }
    return { total, byKind };
  } catch {
    return { total: 0, byKind: {} };
  }
}

module.exports = {
  EVENT_KINDS,
  OBSERVABILITY_SCHEMA_VERSION,
  OBSERVABILITY_FILE_NAME,
  OBSERVABILITY_EVENT_CAP,
  defaultStateDir,
  stateDir,
  observabilityPath,
  loadHarnessEvents,
  recordHarnessEvent,
  recordInputReceived,
  recordInputClassification,
  recordSpawnAttempted,
  recordSpawnResult,
  recordPermissionDenied,
  countRecentPermissionDenials,
  summarizeRecentEvents,
};

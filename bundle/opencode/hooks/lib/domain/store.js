"use strict";

/**
 * Domain JSON store — every write goes through safe-write.js
 * (withLock + readJsonSafe + writeJson; atomic tmp+rename, quarantine on
 * corruption, PCORE_STATE_DIR aware). Direct raw filesystem writes are
 * forbidden here on purpose — the source is scanned by the test suite.
 *
 * Files (both under the resolved state dir, gitignored as `domain-*.json`):
 *   domain-events.json       ring-capped domain event log (oldest trimmed)
 *   domain-checkpoint.json   last checkpoint for resume (Scenario J domain half)
 *
 * The DEFAULT state dir is `~/.config/opencode/hooks/state` — alongside the
 * other state writers, deliberately OUTSIDE the shipped bundle. A path derived
 * from `__dirname` would write a runtime artifact into the installed payload
 * (and into this repo on any run without `PCORE_STATE_DIR`). `PCORE_STATE_DIR`
 * still overrides everything, which is what the suites use.
 *
 * Worktree isolation: when `worktreePath` is provided, state files are read
 * from `worktreePath/.pcore/state/` instead of the global state dir. This
 * enables per-run isolation for concurrent orchestra runs.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { withLock, readJsonSafe, writeJson, resolveStateDir } = require("../safe-write.js");
const { appendRing, newId } = require("./entities.js");
const { DOMAIN_EVENT_CAP } = require("./constants.js");

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

function ensureDir(filePath) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  } catch {
    /* best effort — safe-write will surface a real error */
  }
}

function domainEventsPath(worktreePath) {
  return path.join(stateDir(worktreePath), "domain-events.json");
}

function checkpointPath(worktreePath) {
  return path.join(stateDir(worktreePath), "domain-checkpoint.json");
}

function domainEventCap() {
  return DOMAIN_EVENT_CAP;
}

/** @returns {object[]} ring-capped event list; corrupt/missing -> []. */
function loadEvents(worktreePath) {
  const data = readJsonSafe(domainEventsPath(worktreePath), []);
  return Array.isArray(data) ? data : [];
}

/**
 * Append one event under an advisory lock, re-read, push, ring-cap, write.
 * @param {object} event entity from createEvent()
 * @param {{cap?:number, waitMs?:number, worktreePath?:string}} [opts]
 * @returns {object} the stored event (id guaranteed)
 */
function appendEvent(event, opts) {
  const o = opts || {};
  const cap = Number.isInteger(o.cap) && o.cap > 0 ? o.cap : DOMAIN_EVENT_CAP;
  const worktreePath = o.worktreePath;
  const file = domainEventsPath(worktreePath);
  const stored = Object.assign({}, event || {}, {
    id: event && typeof event.id === "string" && event.id.length > 0 ? event.id : newId("event"),
    at: event && typeof event.at === "string" ? event.at : new Date().toISOString(),
  });
  ensureDir(file);
  withLock(
    file,
    () => {
      const current = readJsonSafe(file, []);
      const list = Array.isArray(current) ? current : [];
      writeJson(file, appendRing(list, stored, cap));
    },
    { waitMs: o.waitMs }
  );
  return stored;
}

/** Persist the resume checkpoint (atomic, lock-guarded). @returns {string} path */
function saveCheckpoint(checkpoint, worktreePath) {
  const file = checkpointPath(worktreePath);
  ensureDir(file);
  withLock(file, () => writeJson(file, checkpoint), {});
  return file;
}

/**
 * Load a checkpoint. With `sessionId`, only returns it when it belongs to
 * that session (otherwise null) — a foreign checkpoint must not be resumed.
 * @param {string} [worktreePath] optional worktree path for isolation
 * @returns {object|null}
 */
function loadCheckpoint(sessionId, worktreePath) {
  const data = readJsonSafe(checkpointPath(worktreePath), null);
  if (!data || typeof data !== "object") return null;
  if (sessionId && data.sessionId && data.sessionId !== sessionId) return null;
  return data;
}

module.exports = {
  defaultStateDir,
  stateDir,
  domainEventsPath,
  checkpointPath,
  domainEventCap,
  loadEvents,
  appendEvent,
  saveCheckpoint,
  loadCheckpoint,
};

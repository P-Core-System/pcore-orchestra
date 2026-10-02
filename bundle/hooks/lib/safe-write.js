"use strict";

/**
 * Safe persistence primitives for orchestra hook state.
 *
 * Every hook is a short-lived process that reads → mutates → writes shared
 * JSON state. This module is the single implementation of the three
 * guarantees those writers need:
 *
 *  1. **Atomic writes** — tmp + rename, so a crash mid-write never truncates
 *     state. No `.tmp.*` residue is left behind on success or on failure.
 *  2. **Quarantine, never silent reset** — a corrupt state file is renamed to
 *     a `.corrupt-<ts>` sibling (original bytes preserved for forensics) and
 *     the caller gets `defaults`. The corrupt data is never overwritten in
 *     place and never parsed into partial state.
 *  3. **Mutual exclusion** — an advisory `.lock` file serializes
 *     load → mutate → save across concurrent hook processes, with stale
 *     takeover so a crashed holder cannot wedge the loop forever.
 *
 * Backoff between retries uses `sleepSync()` (Atomics.wait), never
 * `setTimeout` — hooks must not keep the event loop alive with pending
 * timers (Cursor kills slow hooks; a pending timer also delays exit).
 */

const fs = require("node:fs");
const path = require("node:path");

// --- constants (also mirrored in lib/constants.js as *_LOCK_*) ---
const LOCK_SUFFIX = ".lock";
const QUARANTINE_MARKER = ".corrupt-";
const WRITE_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 10;
const BACKOFF_JITTER_MS = 20;
const BACKOFF_MAX_MS = 200;
const LOCK_STALE_MS = 5000;
const LOCK_WAIT_MS = 15000;
const LOCK_POLL_MS = 15;

/** Synchronous sleep that registers no timers (keeps hook exit immediate). */
function sleepSync(ms) {
  if (!(ms > 0)) return;
  const buf = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(buf, 0, 0, ms);
}

/** Exponential backoff with jitter, capped — attempt is 1-based. */
function backoffMs(attempt) {
  const raw = BACKOFF_BASE_MS * 2 ** attempt + Math.floor(Math.random() * BACKOFF_JITTER_MS);
  return Math.min(raw, BACKOFF_MAX_MS);
}

/**
 * Honor `PCORE_STATE_DIR` so tests/CI can redirect every state write into a
 * temp directory instead of the installed bundle tree.
 */
function resolveStatePath(defaultPath) {
  const dir = process.env.PCORE_STATE_DIR;
  if (dir && typeof dir === "string" && dir.length > 0 && defaultPath) {
    return path.join(dir, path.basename(defaultPath));
  }
  return defaultPath;
}

function serialize(data) {
  if (Buffer.isBuffer(data)) return data;
  if (typeof data === "string") return data;
  return JSON.stringify(data, null, 2);
}

/** Remove a leftover tmp file; never throw. */
function discardTmp(tmpPath) {
  try {
    fs.rmSync(tmpPath, { force: true });
  } catch {
    /* best effort */
  }
}

/**
 * Atomic tmp+rename write with sync-sleep retry backoff.
 * @returns {string} the target path
 */
function atomicWrite(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const payload = serialize(data);
  let lastErr = null;
  for (let attempt = 1; attempt <= WRITE_ATTEMPTS; attempt += 1) {
    const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${attempt}`;
    try {
      fs.writeFileSync(tmpPath, payload);
      fs.renameSync(tmpPath, filePath);
      return filePath;
    } catch (err) {
      lastErr = err;
      discardTmp(tmpPath);
      if (attempt < WRITE_ATTEMPTS) sleepSync(backoffMs(attempt));
    }
  }
  throw lastErr;
}

/** Atomic write of a JSON document. */
function writeJson(filePath, data) {
  return atomicWrite(filePath, JSON.stringify(data, null, 2));
}

/**
 * Move a corrupt file aside to `<file>.corrupt-<ts>` — a pure rename, so the
 * original bytes are preserved byte-for-byte for forensics (never rewritten,
 * never appended to). Returns the sibling path, or null when the file is gone.
 */
function quarantine(filePath) {
  const sibling = `${filePath}${QUARANTINE_MARKER}${Date.now()}`;
  try {
    fs.renameSync(filePath, sibling);
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw err;
  }
  return sibling;
}

function clone(value) {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

/**
 * Read + parse JSON. Missing file → `defaults`. Unreadable or unparsable file
 * → quarantined to a `.corrupt-<ts>` sibling and `defaults` returned.
 * Never resets the file in place.
 */
function readJsonSafe(filePath, defaults) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return clone(defaults);
    quarantine(filePath);
    return clone(defaults);
  }
  try {
    return JSON.parse(raw);
  } catch {
    quarantine(filePath);
    return clone(defaults);
  }
}

/** Advisory lock path for a target file. */
function lockPathFor(targetPath) {
  return `${targetPath}${LOCK_SUFFIX}`;
}

function isStale(stat, now) {
  return now - stat.mtimeMs > LOCK_STALE_MS;
}

/**
 * One-shot lock attempt: create exclusively; on EEXIST, take over only when
 * the holder's lock is older than LOCK_STALE_MS.
 * @returns {boolean} true when the caller now owns the lock
 */
function tryAcquireLock(lockPath) {
  const payload = JSON.stringify({ pid: process.pid, at: new Date().toISOString() });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.writeFileSync(lockPath, payload, { flag: "wx" });
      return true;
    } catch (err) {
      if (!err || err.code !== "EEXIST") throw err;
      try {
        const stat = fs.statSync(lockPath);
        if (!isStale(stat, Date.now())) return false;
        // stale holder — remove and retry the exclusive create
        fs.rmSync(lockPath, { force: true });
      } catch (statErr) {
        if (statErr && statErr.code === "ENOENT") continue; // released under us
        return false;
      }
    }
  }
  return false;
}

/** Remove a lock this process owns. */
function releaseLock(lockPath) {
  try {
    fs.rmSync(lockPath, { force: true });
  } catch {
    /* already gone */
  }
}

/**
 * Run `fn` while holding an exclusive lock on `targetPath`.
 * Waits up to LOCK_WAIT_MS for a live holder, then throws.
 */
function withLock(targetPath, fn, options = {}) {
  const lockPath = lockPathFor(targetPath);
  const waitMs = Number.isFinite(options.waitMs) ? options.waitMs : LOCK_WAIT_MS;
  const deadline = Date.now() + waitMs;
  while (!tryAcquireLock(lockPath)) {
    if (Date.now() >= deadline) {
      throw new Error(`safe-write: timed out after ${waitMs}ms waiting for lock ${lockPath}`);
    }
    sleepSync(LOCK_POLL_MS);
  }
  try {
    return fn();
  } finally {
    releaseLock(lockPath);
  }
}

module.exports = {
  LOCK_SUFFIX,
  QUARANTINE_MARKER,
  WRITE_ATTEMPTS,
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
  LOCK_STALE_MS,
  LOCK_WAIT_MS,
  LOCK_POLL_MS,
  sleepSync,
  backoffMs,
  resolveStatePath,
  atomicWrite,
  writeJson,
  readJsonSafe,
  quarantine,
  lockPathFor,
  tryAcquireLock,
  releaseLock,
  withLock,
};

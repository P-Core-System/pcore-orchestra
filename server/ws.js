"use strict";

/**
 * Studio v2 WebSocket stream at `/api/ws` (architecture §3).
 *
 *   server -> client only: { type, runId, phase?, gate?, at, data? }
 *   type ∈ phase.started | phase.completed | gate.passed | gate.failed | run.completed
 *
 * Client mutations over WS are deliberately unsupported — the board mutates
 * through `PATCH /api/workitems/:id` only. The stream is a replay of state the
 * hooks already wrote, which is why binding loopback (studio-api.js) is the
 * whole auth story (architecture §7).
 *
 * Change detection: `fs.watch` over the state dir tree (dirs + *.json files),
 * debounced 500ms, re-armed after every sweep so the tmp+rename writers'
 * replaced inodes keep being watched. Each connected client holds its own
 * watermark snapshot, so a fresh connection never replays history — the SPA
 * resumes from `index.json` itself, then applies live events on top.
 *
 * Tolerant by design: a state file that vanishes or parses badly mid-read just
 * yields an empty diff; the watchers and sockets are never allowed to throw
 * into the HTTP server.
 */

const fs = require("node:fs");
const path = require("node:path");
const { WebSocketServer } = require("ws");

const readers = require("./readers.js");

const DEBOUNCE_MS = 500;
const MAX_WATCH_DEPTH = 3;

/** Point-in-time view of everything the diff needs. */
function stateSnapshot(stateDir) {
  const events = readers.loadEvents(stateDir);
  const index = readers.loadIndex(stateDir);
  const runs = {};
  for (const key of Object.keys(index.runs || {})) {
    const entry = index.runs[key] || {};
    const doc = readers.readRunFile(key, stateDir) || {};
    runs[key] = {
      id: readers.runIdOfKey(key, entry),
      sessionId: entry.sessionId || String(key).split("/")[1] || null,
      phase: doc.phase !== undefined && doc.phase !== null ? doc.phase : entry.phase || null,
      status: doc.status || entry.status || null,
    };
  }
  return { events, runs };
}

/** Resolve an `entityId` (usually a sessionId) to a run id from a snapshot. */
function runIdForSession(snapshot, sessionId) {
  if (!sessionId) return null;
  const keys = Object.keys(snapshot.runs);
  let fallback = null;
  for (const key of keys) {
    const run = snapshot.runs[key];
    if (run.sessionId !== sessionId) continue;
    if (run.status === "active" || run.status === "in_progress") return run.id;
    fallback = fallback || run.id;
  }
  return fallback;
}

/**
 * Events between two snapshots: new domain events (index slice) + run-level
 * phase/status transitions.
 * @returns {object[]} spec-shaped WS events
 */
function diffSnapshots(prev, next, nowIso) {
  const out = [];
  const at = typeof nowIso === "string" ? nowIso : new Date().toISOString();

  if (next.events.length > prev.events.length) {
    for (const event of next.events.slice(prev.events.length)) {
      if (!event || typeof event !== "object") continue;
      const payload = readers.payloadOf(event);
      const stamp = readers.atIso(event);
      if (event.type === "evidence.run") {
        const records = Array.isArray(payload.records) ? payload.records : [];
        for (const record of records) {
          if (!record || typeof record !== "object") continue;
          out.push({
            type: record.ok ? "gate.passed" : "gate.failed",
            runId: payload.runId || event.entityId || null,
            gate: record.gate || null,
            at: stamp,
            data: {
              ok: Boolean(record.ok),
              phase: record.phase || null,
              command: record.command || null,
              exitCode: typeof record.exitCode === "number" ? record.exitCode : null,
            },
          });
        }
      } else if (event.type === "phase.outcome") {
        out.push({
          type: "phase.completed",
          runId: payload.runId || runIdForSession(prev, event.entityId) || runIdForSession(next, event.entityId) || null,
          phase: payload.phase || null,
          at: stamp,
          data: {
            decision: payload.decision || null,
            reason: payload.reason || null,
          },
        });
      }
    }
  }

  for (const key of Object.keys(next.runs)) {
    const after = next.runs[key];
    const before = prev.runs[key];
    if (!after) continue;
    if (!before) {
      if (after.phase) {
        out.push({ type: "phase.started", runId: after.id, phase: after.phase, at, data: { status: after.status } });
      }
      continue;
    }
    if (after.phase && after.phase !== before.phase) {
      out.push({ type: "phase.started", runId: after.id, phase: after.phase, at, data: { status: after.status } });
    }
    if (after.status && after.status !== before.status && (after.status === "completed" || after.status === "failed")) {
      out.push({ type: "run.completed", runId: after.id, at, data: { status: after.status } });
    }
  }

  return out;
}

/** Watch targets: every directory down to depth 3 plus its *.json files. */
function collectWatchTargets(root, depth, dirs, files) {
  if (depth > MAX_WATCH_DEPTH) return;
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  dirs.add(root);
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) collectWatchTargets(target, depth + 1, dirs, files);
    else if (entry.isFile() && entry.name.endsWith(".json")) files.add(target);
  }
}

/**
 * Attach the `/api/ws` stream to an existing HTTP server.
 * @param {import('node:http').Server} httpServer
 * @param {{ stateDir?: string, debounceMs?: number }} [options]
 * @returns {{ wss: import('ws').WebSocketServer, close: () => void }}
 */
function attachWs(httpServer, options) {
  const opts = options || {};
  const stateDir = opts.stateDir || readers.stateDir();
  const debounceMs = Number.isFinite(opts.debounceMs) ? opts.debounceMs : DEBOUNCE_MS;
  const wss = new WebSocketServer({ server: httpServer, path: "/api/ws" });
  const snapshots = new Map();
  const watchers = new Set();
  let timer = null;
  let closed = false;

  function disarm() {
    for (const watcher of watchers) {
      try {
        watcher.close();
      } catch {
        /* already gone */
      }
    }
    watchers.clear();
  }

  function watch(target) {
    try {
      const watcher = fs.watch(target, () => schedule());
      watcher.on("error", () => {
        try {
          watcher.close();
        } catch {
          /* already gone */
        }
        watchers.delete(watcher);
      });
      watchers.add(watcher);
    } catch {
      /* unreadable path — the other watchers still cover the tree */
    }
  }

  function arm() {
    if (closed) return;
    disarm();
    const dirs = new Set();
    const files = new Set();
    collectWatchTargets(stateDir, 0, dirs, files);
    for (const dir of dirs) watch(dir);
    for (const file of files) watch(file);
  }

  function schedule() {
    if (closed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(fire, debounceMs);
  }

  function fire() {
    timer = null;
    if (closed) return;
    let next;
    try {
      next = stateSnapshot(stateDir);
    } catch {
      arm();
      return;
    }
    for (const [socket, prev] of snapshots) {
      let events = [];
      try {
        events = diffSnapshots(prev, next);
      } catch {
        events = [];
      }
      for (const event of events) {
        if (socket.readyState !== 1) continue;
        try {
          socket.send(JSON.stringify(event));
        } catch {
          /* socket died mid-send; close handler cleans the map up */
        }
      }
      snapshots.set(socket, next);
    }
    arm();
  }

  wss.on("connection", (socket) => {
    try {
      snapshots.set(socket, stateSnapshot(stateDir));
    } catch {
      snapshots.set(socket, { events: [], runs: {} });
    }
    socket.on("close", () => snapshots.delete(socket));
    socket.on("error", () => snapshots.delete(socket));
  });

  arm();

  return {
    wss,
    close() {
      closed = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      disarm();
      for (const socket of wss.clients) {
        try {
          socket.terminate();
        } catch {
          /* already gone */
        }
      }
      try {
        wss.close();
      } catch {
        /* already closed */
      }
      snapshots.clear();
    },
  };
}

module.exports = { attachWs, stateSnapshot, diffSnapshots, DEBOUNCE_MS, MAX_WATCH_DEPTH };

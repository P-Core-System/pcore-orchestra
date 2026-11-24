"use strict";

/**
 * Studio v2 WebSocket stream at `/api/ws`.
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

// `ws` stays a declared server dependency (server/package.json), but the
// require is lazy-tolerant so the pure validators (handleInboundFrame /
// clampOutboundEvent / parseWsFilter / matchWsEvent) stay testable without
// an install. `attachWs` still fails loudly when the transport is missing.
let WebSocketServer = null;
try {
  ({ WebSocketServer } = require("ws"));
} catch {
  WebSocketServer = null;
}

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
 *
 * Discussion events (`discussion.posted` / `discussion.resolved` /
 * `discussion.reaction`) and wake events (`wake.requested` / `wake.delivered` /
 * `wake.denied` / `wake.throttled`) replay 1:1 — the board renders them as
 * team chatter/nudges, never as gates. `runId` stays null: discussion
 * threads are keyed by message id + team, wakes by wake id + team.
 * @returns {object[]} spec-shaped WS events
 */
function diffSnapshots(prev, next, nowIso) {
  const out = [];
  const at = typeof nowIso === "string" ? nowIso : new Date().toISOString();

  // Build a set of seen event keys from prev so we detect new events even
  // when the domain ring buffer has trimmed old events from the front
  // (length stays constant). Key = unique event id, falling back to
  // entityId only for legacy events without one (entityIds repeat across
  // events of the same run/session and must never be the dedup key).
  const prevIds = new Set();
  for (const e of (prev.events || [])) {
    if (e && typeof e === "object") {
      const k = e.id || e.entityId;
      if (k) prevIds.add(k);
    }
  }
  for (const event of next.events) {
    if (!event || typeof event !== "object") continue;
    const key = event.id || event.entityId;
    if (key && prevIds.has(key)) continue; // already seen
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
    } else if (
      event.type === "discussion.posted" ||
      event.type === "discussion.resolved" ||
      event.type === "discussion.reaction"
    ) {
      out.push({
        type: event.type,
        runId: null,
        at: stamp,
        data: {
          messageId: payload.messageId || event.entityId || null,
          kind: payload.kind || null,
          topology: payload.topology || null,
          from: payload.from || null,
          to: payload.to || null,
          team: payload.team || null,
          topic: payload.topic || null,
          body: payload.body || null,
        },
      });
    } else if (
      event.type === "wake.requested" ||
      event.type === "wake.delivered" ||
      event.type === "wake.denied" ||
      event.type === "wake.throttled"
    ) {
      out.push({
        type: event.type,
        runId: null,
        at: stamp,
        data: {
          wakeId: payload.wakeId || event.entityId || null,
          from: payload.from || null,
          to: payload.to || null,
          team: payload.team || null,
          topic: payload.topic || null,
          threadId: payload.threadId || null,
          messageId: payload.messageId || null,
          topology: payload.topology || null,
          reason: payload.reason || null,
        },
      });
    } else if (event.type === "done.reported") {
      out.push({
        type: "done.reported",
        runId: null,
        at: stamp,
        data: {
          doneId: payload.doneId || event.entityId || null,
          member: payload.member || null,
          team: payload.team || null,
          sha: payload.sha || null,
          branch: payload.branch || null,
          summary: payload.summary || null,
          reportedAt: payload.reportedAt || null,
        },
      });
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

/** Per-connection filter matrix for `/api/ws`.
 *
 * Query params: `type` (repeatable or comma-separated WS event type) and
 * `team` (repeatable or comma-separated team id, matched against the
 * discussion payload's `team`). Absent/empty params mean no filtering —
 * the Studio loopback story is unchanged: a plain connection subscribes
 * to everything, auth stays binding-loopback only, mutations stay
 * unsupported.
 */
const WS_EVENT_TYPES = Object.freeze([
  "phase.started",
  "phase.completed",
  "gate.passed",
  "gate.failed",
  "run.completed",
  "discussion.posted",
  "discussion.resolved",
  "discussion.reaction",
  "wake.requested",
  "wake.delivered",
  "wake.denied",
  "wake.throttled",
  "done.reported",
]);

/**
 * P0 inbound/outbound hardening (ws-batch, one scope).
 *
 * The stream is server -> client only: inbound frames NEVER reach the store
 * (invariant 19's sole writer stays `PATCH /api/workitems/:id`). Inbound is
 * allowlisted, size-bounded and flood-gated: drop + warn by default, close
 * only on flood. Outbound events are clamped + control-stripped so one
 * oversized hook payload cannot blow a client frame.
 */
const INBOUND_MAX_BYTES = 64 * 1024; // 64KiB
const INBOUND_FLOOD_WINDOW_MS = 10 * 1000;
const INBOUND_FLOOD_MAX_VIOLATIONS = 10;
const INBOUND_TYPES = Object.freeze(WS_EVENT_TYPES.concat(["ping", "subscribe"]));
const WS_FILTER_MAX_VALUES = 10;
const WS_FILTER_MAX_TOKEN = 64;
const WS_FILTER_TOKEN_RE = /^[a-z0-9._-]+$/;
const OUTBOUND_LIMITS = Object.freeze({ body: 4096, summary: 2048, topic: 256, reason: 512 });

let filterWarnedOnce = false;
function warnFilterOnce(message, detail) {
  if (filterWarnedOnce) return;
  filterWarnedOnce = true;
  try {
    console.warn(`[ws] parseWsFilter: ${message}${detail !== undefined ? ` (${detail})` : ""}`);
  } catch {
    /* stdout gone — the default filter still applies */
  }
}

/** Strip C0 controls (minus \t\n\r) + DEL so one hook payload cannot smuggle control bytes into a frame. */
function stripControlChars(value) {
  return String(value).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

/** Clamp + control-strip the free-text fields of an outbound event. Returns a new object; never mutates. */
function clampOutboundEvent(event) {
  if (!event || typeof event !== "object") return event;
  const data = event.data && typeof event.data === "object" ? event.data : null;
  if (!data) return event;
  let changed = false;
  const nextData = Object.assign({}, data);
  for (const key of Object.keys(OUTBOUND_LIMITS)) {
    const value = nextData[key];
    if (typeof value !== "string") continue;
    const clean = stripControlChars(value).slice(0, OUTBOUND_LIMITS[key]);
    if (clean !== value) {
      nextData[key] = clean;
      changed = true;
    }
  }
  if (!changed) return event;
  return Object.assign({}, event, { data: nextData });
}

/** Byte length of an inbound frame without forcing a string alloc for Buffers. */
function inboundByteLength(raw) {
  if (typeof raw === "string") return Buffer.byteLength(raw, "utf8");
  if (Buffer.isBuffer(raw)) return raw.length;
  if (raw && typeof raw.byteLength === "number") return raw.byteLength;
  try {
    return Buffer.byteLength(String(raw), "utf8");
  } catch {
    return INBOUND_MAX_BYTES + 1;
  }
}

function inboundText(raw) {
  if (typeof raw === "string") return raw;
  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  return String(raw);
}

/**
 * Validate one inbound client frame.
 *
 * Pure + store-free by construction: this module never requires the domain
 * store, and this function has no write path — valid frames resolve to
 * `ack` (a `ping` additionally earns a server-generated `pong`), violations
 * resolve to `drop`, and only a caller-supplied flood tracker can escalate
 * to `close`.
 *
 * @param {string|Buffer} raw
 * @param {{ violations?: number[], now?: number }} [tracker] flood window state (mutated on violation)
 * @returns {{ action: "ack"|"drop"|"close", reason: string, frame?: object, reply?: object }}
 */
function handleInboundFrame(raw, tracker) {
  if (inboundByteLength(raw) > INBOUND_MAX_BYTES) {
    return noteViolation(tracker, { action: "drop", reason: "oversize" });
  }
  let frame;
  try {
    frame = JSON.parse(inboundText(raw));
  } catch {
    return noteViolation(tracker, { action: "drop", reason: "invalid-json" });
  }
  if (!frame || typeof frame !== "object" || Array.isArray(frame)) {
    return noteViolation(tracker, { action: "drop", reason: "not-an-object" });
  }
  if (frame.type !== undefined) {
    if (typeof frame.type !== "string" || INBOUND_TYPES.indexOf(frame.type.toLowerCase()) === -1) {
      return noteViolation(tracker, { action: "drop", reason: "unknown-type" });
    }
  }
  if (frame.team !== undefined) {
    const team = String(frame.team).toLowerCase();
    if (
      typeof frame.team !== "string" ||
      team.length === 0 ||
      team.length > WS_FILTER_MAX_TOKEN ||
      !WS_FILTER_TOKEN_RE.test(team)
    ) {
      return noteViolation(tracker, { action: "drop", reason: "bad-team" });
    }
  }
  const type = typeof frame.type === "string" ? frame.type.toLowerCase() : null;
  if (type === "ping") {
    return { action: "ack", reason: "ping", frame, reply: { type: "pong", at: new Date().toISOString() } };
  }
  return { action: "ack", reason: type === "subscribe" ? "subscribe" : "ignored", frame };
}

/** Record a violation on the tracker's sliding window; escalate to `close` only on flood. */
function noteViolation(tracker, verdict) {
  if (!tracker || !Array.isArray(tracker.violations)) return verdict;
  const now = typeof tracker.now === "number" ? tracker.now : Date.now();
  tracker.violations.push(now);
  while (tracker.violations.length > 0 && now - tracker.violations[0] > INBOUND_FLOOD_WINDOW_MS) {
    tracker.violations.shift();
  }
  if (tracker.violations.length >= INBOUND_FLOOD_MAX_VIOLATIONS) {
    return { action: "close", reason: `flood:${verdict.reason}` };
  }
  try {
    console.warn(`[ws] inbound dropped (${verdict.reason})`);
  } catch {
    /* stdout gone — the drop still stands */
  }
  return verdict;
}

/** Parse a query string (leading `?` optional) into `{ types, teams }`. */
function parseWsFilter(search) {
  let params;
  try {
    params =
      typeof search === "string"
        ? new URLSearchParams(search.charAt(0) === "?" ? search.slice(1) : search)
        : new URLSearchParams(search || "");
  } catch {
    warnFilterOnce("malformed query, defaulting to unfiltered");
    return { types: [], teams: [] };
  }
  const split = (key) => {
    const out = [];
    let capped = false;
    let droppedToken = null;
    const push = (token) => {
      if (out.length >= WS_FILTER_MAX_VALUES) {
        capped = true;
        return;
      }
      if (token.length > WS_FILTER_MAX_TOKEN || !WS_FILTER_TOKEN_RE.test(token)) {
        if (droppedToken === null) droppedToken = token.slice(0, 40);
        return;
      }
      if (out.indexOf(token) === -1) out.push(token);
    };
    let raws;
    try {
      raws = params.getAll(key);
    } catch {
      warnFilterOnce("malformed query, defaulting to unfiltered");
      return [];
    }
    for (const raw of raws) {
      for (const part of String(raw).split(",")) {
        const s = part.trim().toLowerCase();
        if (!s) continue;
        push(s);
      }
    }
    if (capped) warnFilterOnce(`too many ${key} values, capped at ${WS_FILTER_MAX_VALUES}`);
    else if (droppedToken !== null) warnFilterOnce(`invalid ${key} token dropped`, droppedToken);
    return out;
  };
  return { types: split("type"), teams: split("team") };
}

/** Pure filter predicate: a null/empty filter matches everything.
 * Unknown types never match when a type allowlist is present. */
function matchWsEvent(event, filter) {
  if (!event || typeof event !== "object") return false;
  const f = filter && typeof filter === "object" ? filter : {};
  const types = Array.isArray(f.types) ? f.types : [];
  const teams = Array.isArray(f.teams) ? f.teams : [];
  if (types.length > 0 && types.indexOf(String(event.type).toLowerCase()) === -1) return false;
  if (teams.length > 0) {
    const team =
      event.data && typeof event.data.team === "string" ? event.data.team.toLowerCase() : null;
    if (!team || teams.indexOf(team) === -1) return false;
  }
  return true;
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
  if (!WebSocketServer) throw new Error('missing dependency "ws": run `npm install --prefix server`');
  const opts = options || {};
  const stateDir = opts.stateDir || readers.stateDir();
  const debounceMs = Number.isFinite(opts.debounceMs) ? opts.debounceMs : DEBOUNCE_MS;
  const wss = new WebSocketServer({ server: httpServer, path: "/api/ws" });
  const snapshots = new Map();
  const filters = new Map();
  const inbound = new Map();
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
      const filter = filters.get(socket) || null;
      for (const event of events) {
        if (socket.readyState !== 1) continue;
        if (!matchWsEvent(event, filter)) continue;
        try {
          socket.send(JSON.stringify(clampOutboundEvent(event)));
        } catch {
          /* socket died mid-send; close handler cleans the map up */
        }
      }
      snapshots.set(socket, next);
    }
    arm();
  }

  wss.on("connection", (socket, req) => {
    let filter = null;
    try {
      const rawUrl = (req && typeof req.url === "string" && req.url) || "/api/ws";
      filter = parseWsFilter(rawUrl.indexOf("?") === -1 ? "" : rawUrl.slice(rawUrl.indexOf("?") + 1));
    } catch {
      filter = null;
    }
    filters.set(socket, filter);
    try {
      snapshots.set(socket, stateSnapshot(stateDir));
    } catch {
      snapshots.set(socket, { events: [], runs: {} });
    }
    inbound.set(socket, { violations: [] });
    const drop = () => {
      snapshots.delete(socket);
      filters.delete(socket);
      inbound.delete(socket);
    };
    socket.on("close", drop);
    socket.on("error", drop);
    socket.on("message", (raw) => {
      // Server -> client only: inbound frames are validated + acked/dropped
      // here and NEVER reach the store. Drop + warn by default; close only
      // when the per-socket flood window trips (sole-writer invariant intact).
      let verdict;
      try {
        verdict = handleInboundFrame(raw, inbound.get(socket));
      } catch {
        verdict = { action: "drop", reason: "handler-error" };
      }
      if (!verdict || verdict.action === "ack") {
        if (verdict && verdict.reply && socket.readyState === 1) {
          try {
            socket.send(JSON.stringify(verdict.reply));
          } catch {
            /* keepalive reply is best effort */
          }
        }
        return;
      }
      if (verdict.action === "close" && socket.readyState === 1) {
        try {
          socket.close(1009, "inbound flood");
        } catch {
          /* already gone */
        }
      }
    });
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
          /* already closed */
        }
      }
      try {
        wss.close();
      } catch {
        /* already closed */
      }
      snapshots.clear();
      filters.clear();
      inbound.clear();
    },
  };
}

module.exports = { attachWs, stateSnapshot, diffSnapshots, parseWsFilter, matchWsEvent, handleInboundFrame, clampOutboundEvent, stripControlChars, WS_EVENT_TYPES, INBOUND_MAX_BYTES, INBOUND_FLOOD_WINDOW_MS, INBOUND_FLOOD_MAX_VIOLATIONS, WS_FILTER_MAX_VALUES, WS_FILTER_MAX_TOKEN, WS_FILTER_TOKEN_RE, OUTBOUND_LIMITS, DEBOUNCE_MS, MAX_WATCH_DEPTH };

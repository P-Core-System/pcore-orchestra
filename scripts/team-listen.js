"use strict";

/**
 * team-listen.js — live WS listen client for team sessions.
 *
 * Connects to the Studio WS stream at ws://127.0.0.1:3110/api/ws and prints
 * every matching team event as it happens, so member sessions no longer have
 * to poll `discuss list` / `wake list` / `done list` and never miss a
 * connection (discussion post, wake nudge, done report).
 *
 *   node scripts/team-listen.js --member John --team Alpha
 *   node scripts/team-listen.js --team Alpha --types discussion.posted,wake.delivered,done.reported
 *   node scripts/team-listen.js --team Alpha --once 3        # print 3 events then exit (tests)
 *
 * Client mirrors the server filter matrix (`?type=` / `?team=`) so a
 * connection never receives traffic it did not ask for, and reconnects with
 * exponential backoff when the server drops or restarts. Receive-only: no
 * mutations flow over the socket (acks/reacts/resolves stay on the CLI).
 * Every filter value is `encodeURIComponent`-ed per value, and the
 * client-side re-filter is case-insensitive on both type and team, in
 * parity with `server/ws.js` `matchWsEvent`.
 *
 * Fail-open by design: if the WS server is not yet running the client keeps
 * retrying; a single bad message line never kills the client.
 */

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { WebSocket } = require(path.join(__dirname, "..", "server", "node_modules", "ws"));

let scopeLib = null;
try {
  scopeLib = require(path.join(__dirname, "..", "bundle", "hooks", "lib", "studio-scope.js"));
} catch {
  scopeLib = null; // fail-open: unscoped behavior unchanged
}

const DEFAULT_PORT = 3110;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PATH = "/api/ws";
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;

/** Event types the client cares about by default (everything team-facing). */
const DEFAULT_TYPES = [
  "discussion.posted",
  "discussion.resolved",
  "discussion.reaction",
  "wake.requested",
  "wake.delivered",
  "wake.denied",
  "wake.throttled",
  "done.reported",
];

function die(code, msg) {
  console.error(`team-listen: ${msg}`);
  process.exit(code);
}

/** Read-only port for a repo scope: registry hit, else the hash candidate. */
function resolveScopePort(scope, globalDir) {
  if (!scopeLib) return DEFAULT_PORT;
  const base = globalDir || process.env.PCORE_STATE_DIR || scopeLib.globalStateDir();
  return scopeLib.resolvePort(scope, base);
}

/** State dir backing a scope's snapshot: the repo's own partition. */
function scopeStateDir(scope, globalDir) {
  if (!scopeLib || !scope) return null;
  const base = globalDir || process.env.PCORE_STATE_DIR || scopeLib.globalStateDir();
  return scopeLib.scopedStateDir(base, scope);
}

function parseList(raw) {
  if (!raw) return [];
  return String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildUrl(opts) {
  const qs = [];
  // P0: each value is encodeURIComponent-ed so team ids with spaces,
  // slashes, dots/underscores/dashes survive the URL round trip.
  if (opts.types.length) qs.push("type=" + opts.types.map((t) => encodeURIComponent(String(t))).join("&type="));
  if (opts.teams.length) qs.push("team=" + opts.teams.map((t) => encodeURIComponent(String(t))).join("&team="));
  const sep = qs.length ? "?" : "";
  return `ws://${opts.host}:${opts.port}${opts.path}${sep}${qs.join("&")}`;
}

/** Client-side re-filter so the client never acts on traffic it did not ask for.
 * Mirrors the server matrix (`server/ws.js` matchWsEvent): team AND type
 * comparisons are case-insensitive. */
function passesFilter(event, types, teams) {
  if (types.length && types.map((t) => String(t).toLowerCase()).indexOf(String(event.type).toLowerCase()) === -1) return false;
  if (teams.length) {
    const team = (event.data && typeof event.data.team === "string") ? event.data.team.toLowerCase() : null;
    const wanted = teams.map((t) => String(t).toLowerCase());
    if (!team || wanted.indexOf(team) === -1) return false;
  }
  return true;
}

function fmtEvent(event) {
  const d = event.data || {};
  const bits = [
    `type=${event.type}`,
    `at=${event.at || "-"}`,
  ];
  if (d.messageId) bits.push(`msg=${d.messageId}`);
  if (d.wakeId) bits.push(`wake=${d.wakeId}`);
  if (d.doneId) bits.push(`done=${d.doneId}`);
  if (d.member) bits.push(`from=${d.member}`);
  if (d.from) bits.push(`from=${d.from}`);
  if (d.to) bits.push(`to=${d.to}`);
  if (d.team) bits.push(`team=${d.team}`);
  if (d.topic) bits.push(`topic=${d.topic}`);
  if (d.kind) bits.push(`kind=${d.kind}`);
  if (d.sha) bits.push(`sha=${d.sha}`);
  if (d.gate) bits.push(`gate=${d.gate}`);
  if (d.ok !== undefined) bits.push(`ok=${d.ok}`);
  return `[ws] ${bits.join(" ")}`;
}

function listen(opts, onEvent) {
  let ws = null;
  let closedByUser = false;
  let backoff = INITIAL_BACKOFF_MS;

  function connect() {
    if (closedByUser) return;
    const url = buildUrl(opts);
    ws = new WebSocket(url);
    ws.on("open", () => {
      backoff = INITIAL_BACKOFF_MS;
      onEvent({ type: "_connect", at: new Date().toISOString(), data: { url } });
    });
    ws.on("message", (raw) => {
      try {
        const event = JSON.parse(raw);
        if (passesFilter(event, opts.types, opts.teams)) onEvent(event);
      } catch {
        /* ignore unparseable frames */
      }
    });
    ws.on("close", () => {
      ws = null;
      if (closedByUser) return;
      onEvent({ type: "_disconnect", at: new Date().toISOString(), data: {} });
      setTimeout(connect, backoff);
      backoff = Math.min(MAX_BACKOFF_MS, backoff * 2);
    });
    ws.on("error", () => {
      /* close handler will reconnect */
    });
  }

  connect();

  return {
    close() {
      closedByUser = true;
      if (ws) ws.close();
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const opts = {
    member: null,
    team: null,
    scope: null,
    types: [],
    teams: [],
    port: null, // null = default (3110), or the scope registry port with --scope
    host: DEFAULT_HOST,
    path: DEFAULT_PATH,
    once: 0,
    snapshot: true,
  };

  let i = 0;
  while (i < args.length) {
    const a = args[i];
    const v = args[i + 1];
    if (a === "--member") { opts.member = v; i += 2; continue; }
    if (a === "--team") { opts.teams = parseList(v); i += 2; continue; }
    if (a === "--scope") { opts.scope = v; i += 2; continue; }
    if (a === "--types") { opts.types = parseList(v); i += 2; continue; }
    if (a === "--port") { opts.port = Number(v) || DEFAULT_PORT; i += 2; continue; }
    if (a === "--host") { opts.host = v; i += 2; continue; }
    if (a === "--path") { opts.path = v; i += 2; continue; }
    if (a === "--once") { opts.once = Number(v) || 1; i += 1; continue; }
    if (a === "--no-snapshot") { opts.snapshot = false; i += 1; continue; }
    if (a === "--help" || a === "-h") {
      console.log("Usage: node scripts/team-listen.js --member M --team T [--scope S] [--types T1,T2] [--port N] [--once N] [--no-snapshot]");
      process.exit(0);
    }
    i += 1;
  }

  // Repo scope: sanitize, point the snapshot at the repo partition, and dial
  // the scope's registry port unless --port explicitly overrides.
  if (opts.scope && scopeLib) {
    opts.scope = scopeLib.sanitizeScope(opts.scope);
    process.env.PCORE_REPO_SCOPE = opts.scope;
    if (opts.port === null) opts.port = resolveScopePort(opts.scope);
  }
  if (opts.port === null) opts.port = DEFAULT_PORT;

  // Resolve member's live slot for context (informational only; WS filters by team).
  if (opts.member) {
    try {
      const claims = require(path.join(__dirname, "..", "bundle", "hooks", "lib", "session-claims.js"));
      const slot = claims.findLiveSlot
        ? claims.findLiveSlot({ team: (opts.teams[0] || ""), member: opts.member, workspaceSlug: "pcore-orchestra" })
        : null;
      if (slot) {
        console.error(`team-listen: member ${opts.member} live slot ${slot.claimKey}`);
      }
    } catch {
      /* fail-open: slot resolution is informational only */
    }
  }

  // Initial snapshot so nothing that happened before the connect is missed.
  if (opts.snapshot && opts.teams.length) {
    try {
      const discussion = require(path.join(__dirname, "..", "bundle", "hooks", "lib", "team-discussion.js"));
      const done = require(path.join(__dirname, "..", "bundle", "hooks", "lib", "team-done.js"));
      const msgs = discussion.listMessages({ team: opts.teams[0] }).slice(-10);
      for (const m of msgs) {
        console.log(`[snapshot] ${fmtEvent({ type: "discussion.posted", at: m.reportedAt || m.createdAt || "-", data: { messageId: m.id, kind: m.kind, team: m.team, from: m.from, topic: m.topic, body: m.body } })}`);
      }
      const latest = done.latestByMember ? done.latestByMember(".") : {};
      const wantedTeam = (opts.teams[0] || "").toLowerCase();
    const teamReports = Object.values(latest).filter((r) => r && String(r.team || "").toLowerCase() === wantedTeam);
      for (const r of teamReports.slice(-5)) {
        console.log(`[snapshot] ${fmtEvent({ type: "done.reported", at: r.reportedAt || "-", data: { doneId: r.id, member: r.member, team: r.team, sha: r.sha, summary: r.summary } })}`);
      }
    } catch {
      /* fail-open: snapshot is best-effort */
    }
  }

  let printed = 0;
  const client = listen(opts, (event) => {
    if (event.type === "_connect") {
      console.error(`team-listen: connected to ${event.data.url}`);
      return;
    }
    if (event.type === "_disconnect") {
      console.error("team-listen: disconnected, retrying...");
      return;
    }
    console.log(fmtEvent(event));
    printed += 1;
    if (opts.once > 0 && printed >= opts.once) {
      client.close();
      process.exit(0);
    }
  });

  // Keep the process alive while listening.
  process.on("SIGINT", () => {
    client.close();
    process.exit(0);
  });
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`team-listen: fatal ${err.message}`);
    process.exit(1);
  });
}

module.exports = { listen, buildUrl, parseList, passesFilter, fmtEvent, resolveScopePort, scopeStateDir, DEFAULT_PORT, DEFAULT_HOST, DEFAULT_PATH };

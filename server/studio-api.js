#!/usr/bin/env node
"use strict";

/**
 * Studio v2 API server (docs/studio-v2-architecture.md §2).
 *
 *   node server/studio-api.js [--port N]     # default 3110, always 127.0.0.1
 *   node server/studio-api.js --scope NAME [--port N]
 *     # scoped: state partitions to <global>/repos/<name>/ (PCORE_REPO_SCOPE
 *     # set for the process, so readers/state-dirs/ws all follow); unscoped
 *     # keeps the legacy global layout. Invalid --scope refuses to start.
 *
 * One process: Express REST + `/api/ws` (server/ws.js) + static `studio/dist`
 * with SPA fallback. Reads hook state through `server/readers.js` only —
 * the server never writes state except `PATCH /api/workitems/:id`, which
 * validates the domain transition and appends via `store.appendEvent`
 * (invariant 19's sole writer of domain-events.json).
 *
 * No `--host` flag by design: binding loopback is the WS/auth mitigation
 * from architecture §7, not an option.
 */

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");

const readers = require("./readers.js");
const { buildRunGraph } = require("./graph-builder.js");
const store = require("../bundle/hooks/lib/domain/store.js");
const { discoverStateDirs } = require("./state-dirs.js");
const entities = require("../bundle/hooks/lib/domain/entities.js");
const { ALLOWED_TRANSITIONS } = require("../bundle/hooks/lib/domain/constants.js");
const scopeLib = require("../bundle/hooks/lib/studio-scope.js");

const DEFAULT_PORT = 3110;
const GLOBAL_DIST_DIR =
  process.env.HOME || process.env.USERPROFILE
    ? path.join(process.env.HOME || process.env.USERPROFILE, ".local", "share", "orchestra-studio", "dist")
    : "";
const DIST_CANDIDATES = [
  GLOBAL_DIST_DIR,
  path.join(__dirname, "..", "studio", "dist"),
  path.join(osHomedir(), ".cursor", "studio", "dist"),
  path.join(osHomedir(), ".config", "opencode", "studio", "dist"),
].filter(Boolean);
const DIST_DIR = DIST_CANDIDATES.find((d) => { try { return fs.existsSync(path.join(d, "index.html")); } catch { return false; } })
  || path.join(__dirname, "..", "studio", "dist");
const INDEX_HTML = path.join(DIST_DIR, "index.html");

function osHomedir() {
  try {
    return require("node:os").homedir();
  } catch {
    return "";
  }
}

/**
 * The board speaks the studio's 10 TICKET_STATES (TRIAGE / NEEDS_HUMAN) while
 * the domain state machine speaks DRAFT / BLOCKED. Map across so PATCH stays
 * table-driven by `ALLOWED_TRANSITIONS` instead of a second hand-written map.
 */
const BOARD_TO_DOMAIN = { TRIAGE: "DRAFT", NEEDS_HUMAN: "BLOCKED" };
const DOMAIN_TO_BOARD = { DRAFT: "TRIAGE", BLOCKED: "NEEDS_HUMAN" };

function allowedTargets(fromState) {
  const edges = ALLOWED_TRANSITIONS[BOARD_TO_DOMAIN[fromState] || fromState];
  if (!Array.isArray(edges)) return [];
  return edges.map((state) => DOMAIN_TO_BOARD[state] || state);
}

function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json());

  // ------------------------------------------------------------ REST (spec §6)
  app.get("/api/runs", (req, res) => {
    res.json(readers.listRuns());
  });

  app.get("/api/runs/:id", (req, res) => {
    const detail = readers.loadRunDetail(req.params.id);
    if (!detail) return res.status(404).json({ error: "run not found", id: req.params.id });
    res.json(detail);
  });

  app.get("/api/runs/:id/graph", (req, res) => {
    const run = readers.loadRun(req.params.id);
    if (!run) return res.status(404).json({ error: "run not found", id: req.params.id });
    res.json(
      buildRunGraph(run, readers.evidenceRecords(run), readers.outcomeEvents(run))
    );
  });

  app.get("/api/workitems", (req, res) => {
    const { state, agent, run } = req.query;
    res.json(readers.getWorkItems({ state, agent, run }));
  });

  app.patch("/api/workitems/:id", (req, res) => {
    const id = req.params.id;
    const body = req.body || {};
    const target = body.state;
    if (typeof target !== "string" || !readers.TICKET_STATES.includes(target)) {
      return res.status(400).json({
        error: "body.state must be a TICKET_STATE",
        allowed: readers.TICKET_STATES,
      });
    }

    const item = readers.getWorkItems({}).find((candidate) => candidate.id === id);
    if (!item) return res.status(404).json({ error: "work item not found", id });

    const allowed = allowedTargets(item.state);
    if (!allowed.includes(target)) {
      return res.status(409).json({
        error: `illegal transition ${item.state} -> ${target}`,
        from: item.state,
        allowed,
      });
    }

    // The single write path of the whole backend: safe-write append, never fs.
    const stored = store.appendEvent(
      entities.createEvent({
        type: "ticket.transitioned",
        entityId: id,
        payload: {
          ticketId: id,
          fromState: item.state,
          toState: target,
          agent: item.agent || null,
          goal: item.goal || null,
          runId: item.runId || null,
        },
      })
    );
    readers.invalidate(readers.domainEventsPath());

    const at = readers.atMs(stored);
    res.json({
      ok: true,
      item: Object.assign({}, item, {
        state: target,
        updatedAt: at,
        ageMs: 0,
        transitions: item.transitions.concat([{ from: item.state, to: target, at }]),
      }),
    });
  });

  app.get("/api/state-dirs", (req, res) => {
    res.json(discoverStateDirs());
  });

  app.get("/api/tokens/aggregates", (req, res) => {
    res.json(readers.getTokenAggregates());
  });

  // --------------------------------------------------- static SPA + fallback
  if (fs.existsSync(INDEX_HTML)) {
    app.use(express.static(DIST_DIR, { index: "index.html", dotfiles: "allow" })); // fixed dist dir (may live under ~/.local) — never user input
    app.use((req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      if (req.path.startsWith("/api/")) return next();
      res.sendFile(INDEX_HTML, { dotfiles: "allow" });
    });
  }

  app.use((req, res) => {
    res.status(404).json({ error: "not found", path: req.path });
  });

  // eslint-disable-next-line no-unused-vars -- express requires the 4-arg shape
  app.use((err, req, res, next) => {
    if (err && err.type === "entity.parse.failed") {
      return res.status(400).json({ error: "invalid JSON body" });
    }
    res.status(500).json({ error: "internal server error" });
  });

  return app;
}

function parsePort(argv) {
  const args = Array.isArray(argv) ? argv : [];
  let raw = null;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--port") raw = args[i + 1];
    else if (typeof args[i] === "string" && args[i].startsWith("--port=")) raw = args[i].slice(7);
  }
  if (raw === null || raw === undefined) return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`invalid --port value: ${raw}`);
  }
  return port;
}

/**
 * Repo scope for this server: `--scope <name>` wins, else `PCORE_REPO_SCOPE`.
 * Empty = unscoped legacy (global state dir + port default). A scope made only
 * of punctuation sanitizes to "default", which is a lie about intent — refuse.
 */
function parseScope(argv) {
  const args = Array.isArray(argv) ? argv : [];
  let raw = null;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--scope") raw = args[i + 1];
    else if (typeof args[i] === "string" && args[i].startsWith("--scope=")) raw = args[i].slice(8);
  }
  if (raw === null || raw === undefined) return "";
  const s = String(raw).trim();
  if (!s) return "";
  if (!/[a-zA-Z0-9]/.test(s)) {
    throw new Error(`invalid --scope value: ${raw}`);
  }
  return scopeLib.sanitizeScope(s);
}

function main() {
  const argv = process.argv.slice(2);
  const scope = parseScope(argv);
  if (scope) {
    // Single choke: every readers/state-dirs/ws call below partitions through
    // this env value, so no call site needs an explicit scope argument.
    process.env.PCORE_REPO_SCOPE = scope;
  }
  const port = parsePort(argv);
  const app = createApp();
  const server = http.createServer(app);

  // WS stream (/api/ws). Present ws.js attaches; an install without it still
  // serves REST + static. A broken dependency inside ws.js must fail loudly.
  let wsHandle = null;
  const wsModule = path.join(__dirname, "ws.js");
  if (fs.existsSync(wsModule)) {
    wsHandle = require(wsModule).attachWs(server, { stateDir: readers.stateDir() });
  }

  server.listen(port, "127.0.0.1", () => {
    const addr = server.address();
    console.log(`STUDIO_API_LISTENING host=${addr.address} port=${addr.port}`);
  });

  const shutdown = () => {
    if (wsHandle && typeof wsHandle.close === "function") {
      try {
        wsHandle.close();
      } catch {
        /* best effort */
      }
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(String((err && err.message) || err));
    process.exit(1);
  }
}

module.exports = { createApp, parsePort, parseScope, allowedTargets, DEFAULT_PORT, DIST_DIR };

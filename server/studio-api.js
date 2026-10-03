#!/usr/bin/env node
"use strict";

/**
 * Studio v2 API server (docs/studio-v2-architecture.md §2).
 *
 *   node server/studio-api.js [--port N]     # default 3110, always 127.0.0.1
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
const entities = require("../bundle/hooks/lib/domain/entities.js");
const { ALLOWED_TRANSITIONS } = require("../bundle/hooks/lib/domain/constants.js");

const DEFAULT_PORT = 3110;
const DIST_DIR = path.join(__dirname, "..", "studio", "dist");
const INDEX_HTML = path.join(DIST_DIR, "index.html");

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

  app.get("/api/tokens/aggregates", (req, res) => {
    res.json(readers.getTokenAggregates());
  });

  // --------------------------------------------------- static SPA + fallback
  if (fs.existsSync(INDEX_HTML)) {
    app.use(express.static(DIST_DIR, { index: "index.html" }));
    app.use((req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      if (req.path.startsWith("/api/")) return next();
      res.sendFile(INDEX_HTML);
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

function main() {
  const port = parsePort(process.argv.slice(2));
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

module.exports = { createApp, parsePort, allowedTargets, DEFAULT_PORT };

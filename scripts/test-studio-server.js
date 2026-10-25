#!/usr/bin/env node
"use strict";

/**
 * Studio v2 backend server suite (TDD — RED first).
 *
 * T1 — Express + ws API server, read-only over hook state:
 *   routes per docs/studio-v2-design-spec.md §6, binds 127.0.0.1 only,
 *   serves studio/dist as an SPA, PATCH /api/workitems/:id appends through
 *   store.appendEvent (a fs preload blocks any raw write to domain-events.json).
 * T2 — server/graph-builder.js pure buildRunGraph (phase chain + gate
 *   children + fix-loop) and server/ws.js /api/ws stream on fs.watch
 *   (500ms debounce).
 *
 * Fixture state lives in a temp dir behind PCORE_STATE_DIR; the server process
 * is spawned (never required in-process) so bindings and write paths are real.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const SERVER_DIR = path.join(ROOT, "server");
const ENTRY = path.join(SERVER_DIR, "studio-api.js");

let passed = 0;
let failed = 0;

function ok(condition, message, detail) {
  if (condition) {
    console.log(`  \u2713 ${message}`);
    passed += 1;
  } else {
    console.log(`  \u2717 ${message}${detail !== undefined ? ` — ${detail}` : ""}`);
    failed += 1;
  }
}

const PHASES = ["plan", "implement", "verify", "review"];
const RUN1 = "pcore-orchestra:sess-1:abc123def456";
const RUN2 = "pcore-orchestra:sess-2:9f8e7d6c5b4a";

// ---------------------------------------------------------------- fixtures

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

/** Hook-shaped state fixture (tmp+rename, exactly how safe-write writes). */
function writeStateFile(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

function buildFixture(stateDir) {
  const runsDir = path.join(stateDir, "conductor-runs");
  const startedAt = "2026-10-03T09:00:00.000Z";

  writeJson(path.join(runsDir, "index.json"), {
    version: 1,
    updated_at: startedAt,
    runs: {
      "pcore-orchestra/sess-1/abc123def456": {
        workspace: "/home/user/Documents/Project/pcore/pcore-orchestra",
        workspaceSlug: "pcore-orchestra",
        sessionId: "sess-1",
        taskId: "abc123def456",
        goal: "Ship the studio v2 backend",
        phase: "review",
        status: "active",
        agent: "orchestra-implementer",
        host: "cursor",
        startedAt,
        lastHeartbeat: startedAt,
        lastUpdatedAt: startedAt,
      },
      "pcore-orchestra/sess-2/9f8e7d6c5b4a": {
        workspace: "/home/user/Documents/Project/pcore/pcore-orchestra",
        workspaceSlug: "pcore-orchestra",
        sessionId: "sess-2",
        taskId: "9f8e7d6c5b4a",
        goal: "Close the context-migration backlog",
        phase: "review",
        status: "completed",
        agent: "orchestra-verifier",
        startedAt: "2026-10-02T10:00:00.000Z",
        lastHeartbeat: "2026-10-02T11:00:00.000Z",
        lastUpdatedAt: "2026-10-02T11:00:00.000Z",
      },
    },
  });

  writeJson(path.join(runsDir, "pcore-orchestra", "sess-1", "abc123def456.json"), {
    workspace: "/home/user/Documents/Project/pcore/pcore-orchestra",
    workspaceSlug: "pcore-orchestra",
    sessionId: "sess-1",
    taskId: "abc123def456",
    goal: "Ship the studio v2 backend",
    phase: "review",
    status: "active",
    agent: "orchestra-implementer",
    startedAt,
    lastHeartbeat: startedAt,
    completedAt: null,
    failReason: null,
    phaseResults: {},
    resumeAttempts: {},
    summary: null,
    phases: [
      { name: "plan", status: "completed", startedAt: 1, completedAt: 2 },
      { name: "implement", status: "completed", startedAt: 2, completedAt: 3 },
      { name: "verify", status: "completed", startedAt: 3, completedAt: 4 },
      { name: "review", status: "active", startedAt: 4 },
    ],
  });

  writeJson(path.join(runsDir, "pcore-orchestra", "sess-2", "9f8e7d6c5b4a.json"), {
    workspace: "/home/user/Documents/Project/pcore/pcore-orchestra",
    workspaceSlug: "pcore-orchestra",
    sessionId: "sess-2",
    taskId: "9f8e7d6c5b4a",
    goal: "Close the context-migration backlog",
    phase: "review",
    status: "completed",
    agent: "orchestra-verifier",
    startedAt: "2026-10-02T10:00:00.000Z",
    lastHeartbeat: "2026-10-02T11:00:00.000Z",
    completedAt: "2026-10-02T11:00:00.000Z",
    failReason: null,
    phaseResults: {},
    resumeAttempts: {},
    summary: "done",
    phases: [
      { name: "plan", status: "completed" },
      { name: "implement", status: "completed" },
      { name: "verify", status: "completed" },
      { name: "review", status: "completed" },
    ],
  });

  writeStateFile(path.join(stateDir, "domain-events.json"), [
    {
      id: "ev-created-1",
      kind: "event",
      type: "ticket.created",
      entityId: "wi-1",
      at: "2026-10-03T09:01:00.000Z",
      payload: {
        ticketId: "wi-1",
        title: "Build studio API server",
        state: "TRIAGE",
        agent: "orchestra-implementer",
        goal: "Ship the studio v2 backend",
        runId: RUN1,
      },
    },
    {
      id: "ev-evidence-1",
      kind: "event",
      type: "evidence.run",
      entityId: RUN1,
      at: "2026-10-03T09:30:00.000Z",
      payload: {
        runId: RUN1,
        phase: "verify",
        records: [
          {
            gate: "tests",
            ok: true,
            exitCode: 0,
            phase: "verify",
            path: "evidence/tests.log",
            command: "npm test",
          },
          {
            gate: "secrets",
            ok: false,
            exitCode: 1,
            phase: "review",
            path: "evidence/secrets.log",
            command: "scan-secrets",
          },
        ],
      },
    },
    {
      id: "ev-outcome-1",
      kind: "event",
      type: "phase.outcome",
      entityId: "sess-1",
      at: "2026-10-03T09:35:00.000Z",
      payload: {
        runId: RUN1,
        phase: "verify",
        decision: "advance",
        reason: "tests green",
        evidenceDigest: "abc123digest",
      },
    },
    {
      id: "ev-outcome-2",
      kind: "event",
      type: "phase.outcome",
      entityId: "sess-1",
      at: "2026-10-03T09:45:00.000Z",
      payload: {
        runId: RUN1,
        phase: "review",
        decision: "fix",
        reason: "scope creep in diff",
      },
    },
  ]);

  writeJson(path.join(stateDir, "orchestra-tokens.json"), {
    runs: [
      {
        runId: RUN1,
        timestamp: "2026-10-03T09:00:00.000Z",
        byAgent: [
          {
            agent: "orchestra-implementer",
            total: 5000,
            average: 5000,
            budget: 10000,
            overBudget: false,
            runs: 1,
          },
        ],
        byPhase: [
          { phase: "plan", total: 2000, average: 2000, budget: 4000, runs: 1 },
          { phase: "implement", total: 3000, average: 3000, budget: 6000, runs: 1 },
        ],
        total: 5000,
        budget: 10000,
        overBudget: false,
      },
    ],
    aggregated: { byAgent: [], byPhase: [], byRun: [], trend: [] },
    // Hook shape coexists with the studio shape (tokenRecords reads both
    // branches): carries the cache fields the token-tracker now stamps.
    sessions: {
      "sess-hook": {
        runs: [
          {
            run_id: "run-hook-1",
            completed_at: "2026-10-03T09:59:00.000Z",
            total_estimated: 8000,
            total_reported: 8000,
            cache_read_tokens: 6000,
            host: "cursor",
            phases: [
              {
                phase: "implement",
                agent: "orchestra-implementer",
                timestamp: "2026-10-03T09:30:00.000Z",
                estimated_tokens: 8000,
                cache_read_tokens: 6000,
                reported: { prompt_tokens: 2000, completion_tokens: 1000, total_tokens: 8000 },
              },
            ],
          },
        ],
      },
    },
  });
}

/**
 * Preload that makes ANY raw write to domain-events.json throw.
 * store.appendEvent writes `<file>.tmp.<pid>…` then renames, so the atomic
 * path stays usable — a direct fs.writeFileSync(path) would not.
 */
function writeRawWriteGuard(filePath) {
  fs.writeFileSync(
    filePath,
    `"use strict";
const fs = require("node:fs");
for (const fn of ["writeFile", "writeFileSync", "appendFile", "appendFileSync", "createWriteStream"]) {
  const original = fs[fn];
  if (typeof original !== "function") continue;
  fs[fn] = function guarded(target) {
    if (typeof target === "string" && target.includes("domain-events.json")
        && !target.includes(".tmp.") && !target.includes(".lock")) {
      throw new Error("RAW_WRITE_BLOCKED " + target);
    }
    return original.apply(this, arguments);
  };
}
`
  );
}

// ------------------------------------------------------------------- server

function startServer(stateDir, guardPath) {
  return new Promise((resolve, reject) => {
    const args = guardPath ? ["-r", guardPath, ENTRY, "--port", "0"] : [ENTRY, "--port", "0"];
    const child = spawn(process.execPath, args, {
      env: Object.assign({}, process.env, { PCORE_STATE_DIR: stateDir }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`server did not announce a listener within 8s: ${out}`));
    }, 8000);
    const onData = (chunk) => {
      out += String(chunk);
      const match = out.match(/STUDIO_API_LISTENING host=(\S+) port=(\d+)/);
      if (match && !settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ child, host: match[1], port: Number(match[2]), output: () => out });
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`server exited before listening (code ${code}): ${out}`));
    });
  });
}

async function request(port, method, urlPath, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers["content-type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, opts);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* HTML/static responses */
  }
  return { status: res.status, headers: res.headers, text, json };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readEvents(stateDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(stateDir, "domain-events.json"), "utf8"));
  } catch {
    return [];
  }
}

// --------------------------------------------------------------------- main

async function main() {
  console.log("\n=== Studio v2 server tests ===\n");

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "studio-server-"));
  const stateDir = path.join(tmp, "state");
  fs.mkdirSync(stateDir, { recursive: true });
  buildFixture(stateDir);
  const guardPath = path.join(tmp, "raw-write-guard.js");
  writeRawWriteGuard(guardPath);

  // ------------------------------------------------ Test 1: files + package
  console.log("Test 1: server files and package manifest");
  const pkgPath = path.join(SERVER_DIR, "package.json");
  ok(fs.existsSync(pkgPath), "server/package.json exists");
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    ok(pkg.dependencies && pkg.dependencies.express, "express declared as a server dep", JSON.stringify(pkg.dependencies));
    ok(pkg.dependencies && pkg.dependencies.ws, "ws declared as a server dep", JSON.stringify(pkg.dependencies));
  }
  ok(fs.existsSync(ENTRY), "server/studio-api.js exists");
  ok(fs.existsSync(path.join(SERVER_DIR, "readers.js")), "server/readers.js exists");
  ok(fs.existsSync(path.join(SERVER_DIR, "graph-builder.js")), "server/graph-builder.js exists");
  ok(fs.existsSync(path.join(SERVER_DIR, "ws.js")), "server/ws.js exists");

  // ------------------------------------------------ Test 2: spawn + bind
  console.log("\nTest 2: spawn on port 0 and loopback bind");
  let server = null;
  let spawnError = null;
  try {
    server = await startServer(stateDir, guardPath);
  } catch (err) {
    spawnError = err.message;
    ok(false, "server starts", spawnError);
  }

  if (server) {
    ok(/^\d+$/.test(String(server.port)) && server.port > 0, "announces a real port", server.port);
    ok(server.host === "127.0.0.1", "binds 127.0.0.1", server.host);
    ok(server.host !== "0.0.0.0", "does not bind 0.0.0.0", server.host);

    const port = server.port;

    try {
      // ---------------------------------------------- Test 3: GET /api/runs
      console.log("\nTest 3: GET /api/runs");
      const runs = await request(port, "GET", "/api/runs");
      ok(runs.status === 200, "200 OK", runs.status);
      ok(Array.isArray(runs.json), "returns an array", typeof runs.json);
      if (Array.isArray(runs.json)) {
        ok(runs.json.length === 2, "one entry per index run", runs.json.length);
        const r1 = runs.json.find((r) => r.id === RUN1);
        const r2 = runs.json.find((r) => r.id === RUN2);
        ok(Boolean(r1), "run list carries fixture run id", JSON.stringify(runs.json.map((r) => r.id)));
        ok(r1 && r1.host === "cursor", "run list carries host from the conductor index", JSON.stringify(r1 && r1.host));
        ok(Boolean(r2), "run list carries the completed run too");
        if (r1) {
          ok(typeof r1.goal === "string" && r1.goal.length > 0, "entry has goal", r1.goal);
          ok(typeof r1.startedAt === "string", "entry has startedAt", r1.startedAt);
          ok(typeof r1.agent === "string" && r1.agent.length > 0, "entry has agent", r1.agent);
          ok(["running", "completed", "failed", "blocked"].includes(r1.status), "status in spec set", r1.status);
          ok(r1.status === "running", "active run normalizes to running", r1.status);
        }
        if (r2) ok(r2.status === "completed", "completed run keeps completed", r2.status);
      }

      // ------------------------------------------- Test 4: GET /api/runs/:id
      console.log("\nTest 4: GET /api/runs/:id");
      const detail = await request(port, "GET", `/api/runs/${encodeURIComponent(RUN1)}`);
      ok(detail.status === 200, "200 OK", detail.status);
      ok(detail.json && detail.json.id === RUN1, "detail id matches", detail.json && detail.json.id);
      if (detail.json) {
        ok(Array.isArray(detail.json.phases) && detail.json.phases.length === 4, "phases has 4 entries", JSON.stringify(detail.json.phases && detail.json.phases.map((p) => p.name)));
        ok(detail.json.phases.every((p) => typeof p.state === "string"), "every phase has a state", JSON.stringify(detail.json.phases));
        ok(Array.isArray(detail.json.gates), "gates is an array", typeof detail.json.gates);
        ok(detail.json.gates.length === 2, "one gate per evidence record", detail.json.gates.length);
        ok(Array.isArray(detail.json.handoffs), "handoffs is an array", typeof detail.json.handoffs);
        ok(detail.json.handoffs.length >= 1, "handoff derived from outcome digest", detail.json.handoffs.length);
        ok(Array.isArray(detail.json.evidenceRefs), "evidenceRefs is an array", typeof detail.json.evidenceRefs);
        ok(detail.json.evidenceRefs.length === 2, "one evidence ref per record", detail.json.evidenceRefs.length);
      }
      const missing = await request(port, "GET", `/api/runs/${encodeURIComponent("nope:nope:nope")}`);
      ok(missing.status === 404, "unknown run id -> 404", missing.status);

      // --------------------------------------- Test 5: GET /api/runs/:id/graph
      console.log("\nTest 5: GET /api/runs/:id/graph");
      const graph = await request(port, "GET", `/api/runs/${encodeURIComponent(RUN1)}/graph`);
      ok(graph.status === 200, "200 OK", graph.status);
      ok(graph.json && Array.isArray(graph.json.nodes), "nodes is an array", graph.json && typeof graph.json.nodes);
      ok(graph.json && Array.isArray(graph.json.edges), "edges is an array", graph.json && typeof graph.json.edges);
      if (graph.json && Array.isArray(graph.json.nodes)) {
        ok(graph.json.nodes.length >= 4, "at least the 4 phase nodes", graph.json.nodes.length);
        ok(
          graph.json.nodes.every((n) => n.id && n.type && n.state && n.position && typeof n.position.x === "number"),
          "nodes carry id/type/state/position",
          JSON.stringify(graph.json.nodes[0])
        );
        const phaseIds = graph.json.nodes.filter((n) => n.type === "phase").map((n) => n.id);
        ok(JSON.stringify(phaseIds) === JSON.stringify(PHASES), "phase nodes in plan->review order", JSON.stringify(phaseIds));
        if (Array.isArray(graph.json.edges)) {
          ok(
            graph.json.edges.every((e) => e.id && e.source && e.target && e.kind),
            "edges carry id/source/target/kind",
            JSON.stringify(graph.json.edges[0])
          );
        }
      }

      // -------------------------------------------- Test 6: GET /api/workitems
      console.log("\nTest 6: GET /api/workitems");
      const items = await request(port, "GET", "/api/workitems");
      ok(items.status === 200, "200 OK", items.status);
      ok(Array.isArray(items.json), "returns an array", typeof items.json);
      if (Array.isArray(items.json) && items.json.length > 0) {
        const wi = items.json[0];
        ok(wi.id === "wi-1", "item id from ticket events", wi.id);
        ok(typeof wi.goal === "string" && wi.goal.length > 0, "item has goal", wi.goal);
        ok(typeof wi.agent === "string", "item has agent", wi.agent);
        ok(wi.state === "TRIAGE", "item state from created event", wi.state);
        ok(typeof wi.ageMs === "number" && wi.ageMs >= 0, "item has ageMs", wi.ageMs);
        ok(typeof wi.updatedAt === "number", "item has numeric updatedAt", wi.updatedAt);
      } else {
        ok(false, "work items derived from domain events", JSON.stringify(items.json));
      }
      const byState = await request(port, "GET", "/api/workitems?state=TRIAGE");
      ok(Array.isArray(byState.json) && byState.json.length === 1, "state filter narrows the list", JSON.stringify(byState.json && byState.json.length));
      const byOther = await request(port, "GET", "/api/workitems?state=COMPLETED");
      ok(Array.isArray(byOther.json) && byOther.json.length === 0, "state filter can be empty", JSON.stringify(byOther.json));
      const byAgent = await request(port, "GET", "/api/workitems?agent=orchestra-implementer");
      ok(Array.isArray(byAgent.json) && byAgent.json.length === 1, "agent filter works", JSON.stringify(byAgent.json));
      const byRun = await request(port, "GET", `/api/workitems?run=${encodeURIComponent(RUN1)}`);
      ok(Array.isArray(byRun.json) && byRun.json.length === 1, "run filter works", JSON.stringify(byRun.json));

      // ------------------------------------- Test 7: GET /api/tokens/aggregates
      console.log("\nTest 7: GET /api/tokens/aggregates");
      const agg = await request(port, "GET", "/api/tokens/aggregates");
      ok(agg.status === 200, "200 OK", agg.status);
      if (agg.json) {
        ok(Array.isArray(agg.json.byRun), "byRun is an array", typeof agg.json.byRun);
        ok(Array.isArray(agg.json.byPhase), "byPhase is an array", typeof agg.json.byPhase);
        ok(Array.isArray(agg.json.byAgent), "byAgent is an array", typeof agg.json.byAgent);
        ok(Array.isArray(agg.json.buckets), "buckets is an array", typeof agg.json.buckets);
        const runAgg = (agg.json.byRun || []).find((r) => r.runId === RUN1);
        ok(Boolean(runAgg), "byRun carries the fixture run", JSON.stringify(agg.json.byRun));
        if (runAgg) {
          ok(typeof runAgg.total === "number" && runAgg.total === 5000, "byRun total from tokens file", runAgg.total);
          ok(typeof runAgg.input === "number" && typeof runAgg.output === "number", "byRun splits input/output");
        }
        ok((agg.json.byPhase || []).some((p) => p.phase === "plan"), "byPhase has plan", JSON.stringify(agg.json.byPhase));
        ok((agg.json.byAgent || []).some((a) => a.agent === "orchestra-implementer"), "byAgent has implementer", JSON.stringify(agg.json.byAgent));
        const hookRun = (agg.json.byRun || []).find((r) => r.runId === "run-hook-1");
        ok(Boolean(hookRun), "byRun carries the hook-shape run", JSON.stringify(agg.json.byRun));
        if (hookRun) {
          ok(hookRun.cacheRead === 6000, "hook-shape run carries cacheRead", hookRun.cacheRead);
        }
        const implAgent = (agg.json.byAgent || []).find((a) => a.agent === "orchestra-implementer");
        ok(implAgent && implAgent.cacheRead === 6000, "byAgent aggregates phase cacheRead", JSON.stringify(implAgent));
        ok(
          (agg.json.buckets || []).every((b) => typeof b.at === "string" && typeof b.total === "number"),
          "buckets carry at/total",
          JSON.stringify(agg.json.buckets)
        );
      } else {
        ok(false, "aggregates is JSON", agg.text.slice(0, 120));
      }

      // ---------------------------------------- Test 8: PATCH /api/workitems/:id
      console.log("\nTest 8: PATCH /api/workitems/:id via store.appendEvent");
      const eventsBefore = readEvents(stateDir).length;
      const illegal = await request(port, "PATCH", "/api/workitems/wi-1", { state: "IN_PROGRESS" });
      ok(illegal.status === 409, "illegal transition -> 409", illegal.status);
      ok(illegal.json && Array.isArray(illegal.json.allowed), "409 body lists allowed states", JSON.stringify(illegal.json));
      ok(readEvents(stateDir).length === eventsBefore, "rejected PATCH appends nothing");

      const legal = await request(port, "PATCH", "/api/workitems/wi-1", { state: "READY" });
      ok(legal.status === 200, "legal transition -> 200", `${legal.status} ${legal.text.slice(0, 160)}`);
      ok(legal.json && legal.json.ok === true, "body has ok:true", JSON.stringify(legal.json));
      ok(legal.json && legal.json.item && legal.json.item.state === "READY", "body carries the updated item", JSON.stringify(legal.json && legal.json.item));

      const after = readEvents(stateDir);
      ok(after.length === eventsBefore + 1, "event appended to domain-events.json", `${eventsBefore} -> ${after.length}`);
      const appended = after[after.length - 1];
      if (appended) {
        ok(appended.type === "ticket.transitioned", "appended event is ticket.transitioned", appended.type);
        ok(appended.payload && appended.payload.toState === "READY", "payload.toState is READY", JSON.stringify(appended.payload));
        ok(appended.payload && appended.payload.fromState === "TRIAGE", "payload.fromState is TRIAGE", JSON.stringify(appended.payload));
        ok(/^event_/.test(String(appended.id)), "id minted by entities.newId (store.appendEvent)", appended.id);
        ok(typeof appended.at === "string", "store stamps at", appended.at);
      }
      const postGet = await request(port, "GET", "/api/workitems?state=READY");
      ok(Array.isArray(postGet.json) && postGet.json.length === 1, "state persisted and re-read", JSON.stringify(postGet.json && postGet.json.map((i) => i.state)));

      const unknown = await request(port, "PATCH", "/api/workitems/does-not-exist", { state: "READY" });
      ok(unknown.status === 404, "unknown item -> 404", unknown.status);
      const noBody = await request(port, "PATCH", "/api/workitems/wi-1", {});
      ok(noBody.status === 400, "missing state -> 400", noBody.status);

      // --------------------------------------------- Test 9: static SPA fallback
      console.log("\nTest 9: static SPA + fallback");
      const distIndex = path.join(ROOT, "studio", "dist", "index.html");
      const root = await request(port, "GET", "/");
      if (fs.existsSync(distIndex)) {
        ok(root.status === 200, "GET / serves studio/dist", root.status);
        ok(/<html/i.test(root.text), "serves HTML", root.text.slice(0, 40));
        const deep = await request(port, "GET", "/runs/some-id");
        ok(deep.status === 200 && /<html/i.test(deep.text), "unknown SPA route falls back to index.html", deep.status);
      } else {
        ok(root.status < 500, "GET / never crashes without dist", root.status);
      }
      const apiMiss = await request(port, "GET", "/api/nope");
      ok(apiMiss.status === 404, "unknown API route -> 404 JSON", apiMiss.status);
    } catch (err) {
      ok(false, "request sequence completed", err.message);
    }

    // -------------------------------------- Test 10: no raw writes in sources
    console.log("\nTest 10: read-only sources (invariant 19 / architecture §8)");
    const sources = fs
      .readdirSync(SERVER_DIR)
      .filter((f) => f.endsWith(".js"))
      .map((f) => ({ file: f, text: fs.readFileSync(path.join(SERVER_DIR, f), "utf8") }));
    ok(sources.length > 0, "server sources present", sources.length);
    const joined = sources.map((s) => s.text).join("\n");
    ok(/appendEvent\(/.test(joined), "server calls store.appendEvent");
    const rawWrite = /(writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream|writeSync)\s*\(/;
    for (const src of sources) {
      const hasRawWrite = rawWrite.test(src.text);
      ok(!hasRawWrite, `${src.file} has no raw fs write API`, hasRawWrite ? "found raw write" : "");
    }
    ok(!/["']fs["']/.test(joined) || sources.every((s) => !/require\(["']node:fs["']\)\s*\.\s*write/.test(s.text)), "no fs.<write> chain");
    ok(/readFileSync|existsSync|readdirSync|watch\(/.test(joined), "sources read state (read-only adapters)");

    // ------------------------------------------------ Test 11: graph builder
    console.log("\nTest 11: buildRunGraph (pure function, T2)");
    let buildRunGraph = null;
    try {
      ({ buildRunGraph } = require(path.join(SERVER_DIR, "graph-builder.js")));
    } catch (err) {
      ok(false, "server/graph-builder.js loads", err.message);
    }
    if (typeof buildRunGraph === "function") {
      const run = JSON.parse(fs.readFileSync(path.join(stateDir, "conductor-runs", "pcore-orchestra", "sess-1", "abc123def456.json"), "utf8"));
      const events = readEvents(stateDir);
      const evidenceEvent = events.find((e) => e.type === "evidence.run");
      const outcomes = events.filter((e) => e.type === "phase.outcome");
      const evidence = evidenceEvent ? evidenceEvent.payload.records : [];

      let g1 = null;
      let g2 = null;
      try {
        g1 = buildRunGraph(run, evidence, outcomes);
        g2 = buildRunGraph(run, evidence, outcomes);
      } catch (err) {
        ok(false, "buildRunGraph does not throw on the fixture", err.message);
      }
      if (g1) {
        ok(JSON.stringify(g1) === JSON.stringify(g2), "deterministic: same inputs -> same graph");
        const phaseNodes = g1.nodes.filter((n) => n.type === "phase");
        ok(phaseNodes.length === 4, "4 phase nodes", phaseNodes.length);
        ok(JSON.stringify(phaseNodes.map((n) => n.id)) === JSON.stringify(PHASES), "phase chain plan->review", JSON.stringify(phaseNodes.map((n) => n.id)));
        const reviewNode = phaseNodes.find((n) => n.id === "review");
        ok(reviewNode && reviewNode.state === "running", "review phase is running (active)", reviewNode && reviewNode.state);
        const gateNodes = g1.nodes.filter((n) => n.type === "gate");
        ok(gateNodes.length === evidence.length, "one gate node per evidence record", `${gateNodes.length} vs ${evidence.length}`);
        ok(
          gateNodes.some((n) => n.label === "tests" && n.state === "completed") &&
            gateNodes.some((n) => n.label === "secrets" && n.state === "failed"),
          "gate node states mirror evidence ok flags",
          JSON.stringify(gateNodes.map((n) => [n.label, n.state]))
        );
        const gating = g1.edges.filter((e) => e.kind === "gating");
        ok(gating.length === evidence.length, "one gating edge per gate", gating.length);
        ok(gating.every((e) => e.source.startsWith("gate:") && phaseNodes.some((p) => p.id === e.target)), "gating edges point gate -> phase", JSON.stringify(gating));
        const sequence = g1.edges.filter((e) => e.kind === "sequence");
        ok(sequence.length === 3, "3 sequence edges for the chain", sequence.length);
        const fixEdges = g1.edges.filter((e) => e.kind === "fix-loop");
        ok(fixEdges.length >= 1, "fix outcome emits a fix-loop edge", JSON.stringify(fixEdges));
        ok(
          fixEdges.some((e) => e.source === "review" && e.target === "implement"),
          "fix-loop runs review -> implement",
          JSON.stringify(fixEdges)
        );
        const assignment = g1.edges.filter((e) => e.kind === "assignment");
        ok(assignment.length >= 1, "assignment edge for the active agent", JSON.stringify(assignment));
        ok(g1.nodes.some((n) => n.type === "agent"), "agent node present", JSON.stringify(g1.nodes.filter((n) => n.type === "agent").map((n) => n.id)));

        // partial / unknown state never throws
        try {
          const empty = buildRunGraph({ id: "x" }, [], []);
          ok(empty && Array.isArray(empty.nodes) && empty.nodes.length === 4, "partial run degrades to 4 idle phases", JSON.stringify(empty && empty.nodes.map((n) => n.state)));
          ok(empty.nodes.every((n) => n.state === "idle"), "missing state -> idle", JSON.stringify(empty.nodes.map((n) => n.state)));
        } catch (err) {
          ok(false, "buildRunGraph tolerates partial state", err.message);
        }
      }

      // the HTTP graph route must be backed by the builder
      const live = await request(port, "GET", `/api/runs/${encodeURIComponent(RUN1)}/graph`);
      if (live.json && Array.isArray(live.json.nodes)) {
        const gates = live.json.nodes.filter((n) => n.type === "gate");
        ok(gates.length === 2, "graph route includes gate nodes", gates.length);
        ok(live.json.edges.some((e) => e.kind === "fix-loop"), "graph route includes the fix-loop edge", JSON.stringify(live.json.edges));
      }
    }

    // --------------------------------------------------- Test 12: /api/ws
    console.log("\nTest 12: WS /api/ws event stream (T2)");
    let WebSocket = null;
    try {
      WebSocket = require(path.join(SERVER_DIR, "node_modules", "ws"));
    } catch (err) {
      ok(false, "ws module resolvable from server/node_modules", err.message);
    }
    if (WebSocket) {
      const received = [];
      let opened = false;
      const ws = new WebSocket(`ws://127.0.0.1:${port}/api/ws`);
      const done = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve("timeout"), 8000);
        ws.on("open", () => {
          opened = true;
          // 1) hook-shaped write: new evidence event (pass + fail records)
          writeStateFile(path.join(stateDir, "domain-events.json"), readEvents(stateDir).concat([
            {
              id: "ev-evidence-2",
              kind: "event",
              type: "evidence.run",
              entityId: RUN1,
              at: new Date().toISOString(),
              payload: {
                runId: RUN1,
                phase: "review",
                records: [
                  { gate: "lint", ok: true, exitCode: 0, phase: "review" },
                  { gate: "build", ok: false, exitCode: 2, phase: "review" },
                ],
              },
            },
          ]));
          // 2) hook-shaped write: run file phase change
          const runPath = path.join(stateDir, "conductor-runs", "pcore-orchestra", "sess-1", "abc123def456.json");
          const runDoc = JSON.parse(fs.readFileSync(runPath, "utf8"));
          runDoc.phase = "implement";
          writeStateFile(runPath, runDoc);
        });
        ws.on("message", (raw) => {
          try {
            received.push(JSON.parse(String(raw)));
          } catch {
            received.push({ type: "unparsable", raw: String(raw).slice(0, 80) });
          }
          const types = received.map((m) => m.type);
          if (types.includes("gate.passed") && types.includes("gate.failed") && types.includes("phase.started")) {
            clearTimeout(timer);
            resolve("enough");
          }
        });
        ws.on("error", () => resolve("error"));
        ws.on("close", () => resolve("closed"));
      });

      ok(opened, "client connects to /api/ws", done);
      ok(["enough", "timeout"].includes(done), "socket stayed open while events arrived", done);
      const types = received.map((m) => m.type);
      ok(types.includes("gate.passed"), "gate.passed pushed on passing evidence", JSON.stringify(types));
      ok(types.includes("gate.failed"), "gate.failed pushed on failing evidence", JSON.stringify(types));
      ok(types.includes("phase.started"), "phase.started pushed on run phase change", JSON.stringify(types));
      const gateMsg = received.find((m) => m.type === "gate.passed");
      if (gateMsg) {
        ok(gateMsg.runId === RUN1, "event carries runId", gateMsg.runId);
        ok(gateMsg.gate === "lint", "event carries gate id", gateMsg.gate);
        ok(typeof gateMsg.at === "string", "event carries at", gateMsg.at);
      }
      const phaseMsg = received.find((m) => m.type === "phase.started");
      if (phaseMsg) ok(phaseMsg.phase === "implement", "phase.started carries the new phase", phaseMsg.phase);
      ok(received.every((m) => m.type && m.type !== "unparsable"), "every WS frame parses as JSON", JSON.stringify(received.filter((m) => m.type === "unparsable")));
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }

    server.child.kill("SIGTERM");
    await sleep(200);
    if (server.child.exitCode === null) server.child.kill("SIGKILL");
  } else {
    ok(false, "route/graph/WS assertions skipped — server never started (see Test 2)", spawnError);
  }

  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best effort */
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});

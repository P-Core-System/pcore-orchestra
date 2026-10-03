#!/usr/bin/env node
"use strict";

/**
 * Studio v2 SPA suite (TDD — RED first).
 *
 * Complements `test-studio-data-layer.js` (old fs-based data layer) and
 * `test-studio-server.js` (backend). Covers the browser surface against
 * docs/studio-v2-design-spec.md + docs/studio-v2-architecture.md:
 *
 *   T1 — studio/src/lib/api.ts typed fetch wrappers (REST contract §6),
 *         studio/src/lib/queryKeys.ts key table (architecture §5),
 *         WS → invalidation mapping, main.tsx QueryClient wiring,
 *         hooks/useLiveQuery.ts (/api/ws client).
 *   T2 — workflow graph page (React Flow) + graph state classes.
 *   T3 — WorkItem board columns/transitions + PATCH mutation body.
 *   T4 — run list / run detail timeline / tokens pages + routes.
 *
 * Pure `.ts` modules are imported natively (Node 24 type stripping) so the
 * assertions execute real code, not just grep the source. Component files are
 * asserted structurally — JSX cannot be imported without a transform.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "studio", "src");

let passed = 0;
let failed = 0;

function ok(condition, message, detail) {
  if (condition) {
    console.log(`  \u2713 ${message}`);
    passed += 1;
  } else {
    console.log(`  \u2717 ${message}${detail !== undefined ? ` \u2014 ${detail}` : ""}`);
    failed += 1;
  }
}

/** Read a source file; null when missing (so every `has()` below also fails). */
function read(rel) {
  const abs = path.join(SRC, rel);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, "utf8");
}

function has(content, substr, message) {
  if (content === null) {
    ok(false, message, `missing source`);
    return;
  }
  ok(content.includes(substr), message, content.includes(substr) ? undefined : `no "${substr}"`);
}

/** Substring check that accepts either quote style (studio uses both). */
function hasAny(content, candidates, message) {
  if (content === null) {
    ok(false, message, `missing source`);
    return;
  }
  const found = candidates.some((c) => content.includes(c));
  ok(found, message, found ? undefined : `no ${candidates.join(" / ")}`);
}

/** Import a pure TS module natively; null on missing file or strip error. */
async function loadTs(rel, cache) {
  if (cache.has(rel)) return cache.get(rel);
  const abs = path.join(SRC, rel);
  if (!fs.existsSync(abs)) {
    cache.set(rel, null);
    return null;
  }
  let mod = null;
  try {
    mod = await import(pathToFileURL(abs).href);
  } catch (err) {
    console.log(`  (import ${rel} failed: ${String(err && err.message).slice(0, 160)})`);
  }
  cache.set(rel, mod);
  return mod;
}

const tsCache = new Map();

// ============================================================ T1 — api client

async function testApiContract() {
  console.log("\nT1: studio/src/lib/api.ts \u2014 typed fetch wrappers (contract \u00a76)");

  const api = await loadTs("lib/api.ts", tsCache);
  ok(!!api, "lib/api.ts imports (exists, erasable TS only)");

  // Stub global fetch, record every call.
  const calls = [];
  const realFetch = globalThis.fetch;
  let nextResponse = { ok: true, status: 200, payload: {} };
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init: init || {} });
    const body = nextResponse.payload;
    return {
      ok: nextResponse.ok,
      status: nextResponse.status,
      json: async () => body,
    };
  };

  const run = async (fn) => {
    calls.length = 0;
    nextResponse = { ok: true, status: 200, payload: {} };
    let error = null;
    try {
      await fn();
    } catch (err) {
      error = err;
    }
    return { call: calls[0], error };
  };

  if (api) {
    let r = await run(() => api.fetchRuns());
    ok(r.call && r.call.url === "/api/runs", "fetchRuns() \u2192 GET /api/runs", r.call && r.call.url);
    ok(r.call && (!r.call.init.method || r.call.init.method === "GET"), "fetchRuns() uses GET");

    const id = "pcore-orchestra:sess-1/abc123";
    const encoded = encodeURIComponent(id);
    r = await run(() => api.fetchRun(id));
    ok(
      r.call && r.call.url === `/api/runs/${encoded}`,
      "fetchRun(id) \u2192 GET /api/runs/:id with encodeURIComponent (run ids carry : and /)",
      r.call && r.call.url
    );

    r = await run(() => api.fetchRunGraph(id));
    ok(
      r.call && r.call.url === `/api/runs/${encoded}/graph`,
      "fetchRunGraph(id) \u2192 GET /api/runs/:id/graph",
      r.call && r.call.url
    );

    r = await run(() => api.fetchWorkItems());
    ok(r.call && r.call.url === "/api/workitems", "fetchWorkItems() \u2192 GET /api/workitems", r.call && r.call.url);

    r = await run(() => api.fetchWorkItems({ state: "TRIAGE", agent: "orchestra-planner", run: "run-1" }));
    ok(
      r.call && r.call.url === "/api/workitems?state=TRIAGE&agent=orchestra-planner&run=run-1",
      "fetchWorkItems(filters) \u2192 ?state=&agent=&run= (contract filter order)",
      r.call && r.call.url
    );

    r = await run(() => api.fetchTokenAggregates());
    ok(
      r.call && r.call.url === "/api/tokens/aggregates",
      "fetchTokenAggregates() \u2192 GET /api/tokens/aggregates",
      r.call && r.call.url
    );

    r = await run(() => api.patchWorkItemState("wi-7", "REVIEW_PENDING"));
    ok(r.call && r.call.url === "/api/workitems/wi-7", "patchWorkItemState \u2192 PATCH /api/workitems/:id", r.call && r.call.url);
    ok(r.call && r.call.init.method === "PATCH", "patchWorkItemState uses PATCH method");
    ok(
      r.call && /application\/json/.test(String((r.call.init.headers || {})["Content-Type"] || "")),
      "patchWorkItemState sends Content-Type: application/json",
      r.call && JSON.stringify(r.call.init.headers)
    );
    ok(
      r.call && r.call.init.body === JSON.stringify({ state: "REVIEW_PENDING" }),
      "patchWorkItemState body is exactly { state } (contract PATCH body)",
      r.call && r.call.init.body
    );

    // 409 from the transition guard must surface the server's error text.
    nextResponse = {
      ok: false,
      status: 409,
      payload: { error: "illegal transition IN_PROGRESS -> TRIAGE", from: "IN_PROGRESS", allowed: ["VERIFYING"] },
    };
    calls.length = 0;
    let err = null;
    try {
      await api.patchWorkItemState("wi-7", "TRIAGE");
    } catch (e) {
      err = e;
    }
    ok(
      err !== null && /illegal transition IN_PROGRESS -> TRIAGE/.test(String(err.message)),
      "rejected PATCH surfaces the server error message (rollback trigger)",
      err && err.message
    );
    nextResponse = { ok: true, status: 200, payload: {} };
  } else {
    for (const m of [
      "fetchRuns() \u2192 GET /api/runs",
      "fetchRun(id) \u2192 GET /api/runs/:id with encodeURIComponent (run ids carry : and /)",
      "fetchRunGraph(id) \u2192 GET /api/runs/:id/graph",
      "fetchWorkItems() \u2192 GET /api/workitems",
      "fetchWorkItems(filters) \u2192 ?state=&agent=&run= (contract filter order)",
      "fetchTokenAggregates() \u2192 GET /api/tokens/aggregates",
      "patchWorkItemState \u2192 PATCH /api/workitems/:id",
      "patchWorkItemState uses PATCH method",
      "patchWorkItemState sends Content-Type: application/json",
      "patchWorkItemState body is exactly { state } (contract PATCH body)",
      "rejected PATCH surfaces the server error message (rollback trigger)",
    ]) {
      ok(false, m, "lib/api.ts missing");
    }
  }

  globalThis.fetch = realFetch;

  const src = read("lib/api.ts");
  has(src, "export interface RunSummary", "api.ts exports RunSummary type");
  has(src, "export interface Graph", "api.ts exports Graph type (nodes + edges)");
  has(src, "export interface WorkItem", "api.ts exports WorkItem type");
  has(src, "export interface TokenAggregates", "api.ts exports TokenAggregates type");
}

// ======================================================== T1 — query key table

async function testQueryKeys() {
  console.log("\nT1: studio/src/lib/queryKeys.ts \u2014 key table (architecture \u00a75)");

  const mod = await loadTs("lib/queryKeys.ts", tsCache);
  ok(!!mod, "lib/queryKeys.ts imports (exists, erasable TS only)");
  if (!mod) {
    for (const m of [
      "['runs'] for the run list",
      "['run', id] for run detail",
      "['graph', id] for the React Flow payload",
      "['workitems'] + filter vars in key",
      "['tokens'] for aggregates",
      "['ws-status'] local status key",
      "phase.started invalidates graph + run + runs",
      "gate.failed invalidates graph + run + runs",
      "run.completed invalidates graph + run + runs",
      "unknown event type invalidates graph + run only",
      "event without runId invalidates nothing (no undefined keys)",
    ]) {
      ok(false, m, "lib/queryKeys.ts missing");
    }
    return;
  }

  const keys = mod.queryKeys;
  ok(!!keys, "queryKeys table exported");

  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  ok(keys && same(keys.runs(), ["runs"]), "['runs'] for the run list", keys && JSON.stringify(keys.runs()));
  ok(keys && same(keys.run("r1"), ["run", "r1"]), "['run', id] for run detail", keys && JSON.stringify(keys.run("r1")));
  ok(keys && same(keys.graph("r1"), ["graph", "r1"]), "['graph', id] for the React Flow payload", keys && JSON.stringify(keys.graph("r1")));
  ok(keys && same(keys.workitems(), ["workitems"]), "['workitems'] with no filters", keys && JSON.stringify(keys.workitems()));
  ok(
    keys && same(keys.workitems({ state: "TRIAGE" }), ["workitems", { state: "TRIAGE" }]),
    "['workitems', filters] carries the filter vars in the key",
    keys && JSON.stringify(keys.workitems({ state: "TRIAGE" }))
  );
  ok(keys && same(keys.tokens(), ["tokens"]), "['tokens'] for aggregates", keys && JSON.stringify(keys.tokens()));
  ok(keys && same(keys.wsStatus(), ["ws-status"]), "['ws-status'] local status key", keys && JSON.stringify(keys.wsStatus()));

  const map = mod.wsInvalidationKeys;
  ok(typeof map === "function", "wsInvalidationKeys(event) exported");
  if (typeof map !== "function") return;

  const graphRunRuns = (event) => {
    const out = map(event);
    return (
      Array.isArray(out) &&
      out.some((k) => same(k, ["graph", event.runId])) &&
      out.some((k) => same(k, ["run", event.runId])) &&
      out.some((k) => same(k, ["runs"]))
    );
  };

  ok(
    graphRunRuns({ type: "phase.started", runId: "r1", phase: "implement" }),
    "phase.started invalidates graph + run + runs"
  );
  ok(graphRunRuns({ type: "phase.completed", runId: "r1" }), "phase.completed invalidates graph + run + runs");
  ok(graphRunRuns({ type: "gate.passed", runId: "r1", gate: "tests" }), "gate.passed invalidates graph + run + runs");
  ok(graphRunRuns({ type: "gate.failed", runId: "r1", gate: "tests" }), "gate.failed invalidates graph + run + runs");
  ok(graphRunRuns({ type: "run.completed", runId: "r1" }), "run.completed invalidates graph + run + runs");

  const unknown = map({ type: "something.new", runId: "r1" });
  ok(
    Array.isArray(unknown) &&
      unknown.some((k) => same(k, ["graph", "r1"])) &&
      unknown.some((k) => same(k, ["run", "r1"])) &&
      !unknown.some((k) => same(k, ["runs"])),
    "unknown event type invalidates graph + run only (never throws)",
    JSON.stringify(unknown)
  );

  let noRunId = null;
  try {
    noRunId = map({ type: "phase.started" });
  } catch (err) {
    noRunId = String(err && err.message);
  }
  ok(
    Array.isArray(noRunId) && noRunId.length === 0,
    "event without runId invalidates nothing (no undefined cache keys)",
    JSON.stringify(noRunId)
  );
}

// ================================================= T1 — client + WS wiring

function testClientWiring() {
  console.log("\nT1: main.tsx + hooks/useLiveQuery.ts \u2014 QueryClient and /api/ws wiring");

  const main = read("main.tsx");
  ok(main !== null, "src/main.tsx exists");
  has(main, "QueryClientProvider", "main.tsx wraps the app in QueryClientProvider");
  has(main, "new QueryClient", "main.tsx constructs the QueryClient");
  has(main, "staleTime: 5000", "main.tsx staleTime 5s (spec: refetch every 5s)");
  has(main, "refetchInterval: 5000", "main.tsx refetchInterval 5s (WS fallback)");

  const hook = read("hooks/useLiveQuery.ts");
  ok(hook !== null, "src/hooks/useLiveQuery.ts exists");
  has(hook, "/api/ws", "useLiveQuery connects to /api/ws");
  has(hook, "WebSocket", "useLiveQuery uses the WebSocket API");
  has(hook, "invalidateQueries", "useLiveQuery calls queryClient.invalidateQueries");
  has(hook, "wsInvalidationKeys", "useLiveQuery routes events through the wsInvalidationKeys mapping");
  hasAny(hook, ["'connected'", '"connected"'], "useLiveQuery reports the connected status");
  hasAny(hook, ["'reconnecting'", '"reconnecting"'], "useLiveQuery reports the reconnecting status");
  hasAny(hook, ["'disconnected'", '"disconnected"'], "useLiveQuery reports the disconnected status");
  has(hook, "onmessage", "useLiveQuery handles incoming WS messages");
  has(hook, "return () =>", "useLiveQuery cleans up (closes the socket) on unmount");
}

// ================================================ T2 — workflow graph page

/**
 * Graph fixture (written to os.tmpdir, per repo rule) covering every node
 * state, all four edge kinds, and an unknown state that must degrade to idle.
 */
function writeGraphFixture() {
  const dir = path.join(os.tmpdir(), `pcore-studio-ui-${process.pid}`);
  fs.mkdirSync(dir, { recursive: true });
  const fixture = {
    nodes: [
      { id: "phase:plan", type: "phase", state: "completed", label: "plan", position: { x: 0, y: 0 } },
      { id: "phase:implement", type: "phase", state: "running", label: "implement", position: { x: 260, y: 0 } },
      { id: "phase:verify", type: "phase", state: "idle", label: "verify", position: { x: 520, y: 0 } },
      { id: "phase:review", type: "phase", state: "blocked", label: "review", position: { x: 780, y: 0 } },
      { id: "gate:tests", type: "gate", state: "failed", label: "tests", position: { x: 260, y: 260 } },
      { id: "agent:impl", type: "agent", state: "running", label: "orchestra-implementer", position: { x: -260, y: 0 } },
      { id: "phase:legacy", type: "phase", state: "unexpected", label: "legacy", position: { x: 1040, y: 0 } },
    ],
    edges: [
      { id: "e-seq", source: "phase:plan", target: "phase:implement", kind: "sequence" },
      { id: "e-gate", source: "gate:tests", target: "phase:verify", kind: "gating", state: "failed" },
      { id: "e-assign", source: "agent:impl", target: "phase:implement", kind: "assignment", state: "running" },
      { id: "e-fix", source: "phase:review", target: "phase:implement", kind: "fix-loop", state: "blocked" },
    ],
  };
  const file = path.join(dir, "graph-fixture.json");
  fs.writeFileSync(file, JSON.stringify(fixture, null, 2));
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** Spec §7 design token expected per node state. */
const STATE_TOKEN = {
  idle: "zinc",
  running: "sky",
  completed: "emerald",
  failed: "red",
  blocked: "amber",
};

async function testGraphPage() {
  console.log("\nT2: graph state classes + studio/src/pages/WorkflowPage.tsx (React Flow)");

  const fixture = writeGraphFixture();
  const styles = await loadTs("lib/graphStyles.ts", tsCache);
  ok(!!styles, "lib/graphStyles.ts imports (exists, erasable TS only)");

  if (styles) {
    const keys = Object.keys(styles.NODE_STATE_CLASSES || {}).sort();
    ok(
      JSON.stringify(keys) === JSON.stringify(["blocked", "completed", "failed", "idle", "running"]),
      "NODE_STATE_CLASSES covers exactly the 5 spec states",
      JSON.stringify(keys)
    );

    const pulseStates = [];
    for (const node of fixture.nodes) {
      const cls = styles.nodeStateClass(node.state);
      const expected = STATE_TOKEN[styles.nodeState(node.state)];
      ok(
        typeof cls === "string" && cls.length > 0 && cls.includes(expected),
        `fixture node ${node.id} (state=${node.state}) \u2192 class with the §7 "${expected}" token`,
        cls
      );
      if (/pulse/i.test(String(cls))) pulseStates.push(node.id);
    }

    ok(
      JSON.stringify(pulseStates) === JSON.stringify(["phase:implement", "agent:impl"]),
      "pulse animation applies only to running nodes",
      JSON.stringify(pulseStates)
    );

    ok(
      styles.nodeStateClass("unexpected") === styles.nodeStateClass("idle"),
      "unknown/missing state degrades to the idle class (spec \u00a73, never crashes)"
    );
    ok(styles.isKnownState("running") === true, "isKnownState('running') is true");
    ok(styles.isKnownState("unexpected") === false, "isKnownState('unexpected') is false (stale marker)");

    const gating = fixture.edges.find((e) => e.kind === "gating");
    const gatingCls = styles.edgeStateClass(gating.state);
    ok(
      typeof gatingCls === "string" && gatingCls.includes("red"),
      "gating edge inherits the failed target state color",
      gatingCls
    );
    ok(
      typeof styles.edgeStateClass("running") === "string" && styles.edgeStateClass("running").includes("sky"),
      "sequence edge class tracks the running state color"
    );
    const fix = fixture.edges.find((e) => e.kind === "fix-loop");
    const fixCls = styles.fixLoopEdgeClass(fix.state);
    ok(
      typeof fixCls === "string" && /dash/i.test(fixCls) && fixCls.includes("amber"),
      "fix-loop edge is dashed + amber (visually distinct from sequencing)",
      fixCls
    );
  } else {
    for (const m of [
      "NODE_STATE_CLASSES covers exactly the 5 spec states",
      "fixture nodes map to §7 state tokens",
      "pulse animation applies only to running nodes",
      "unknown/missing state degrades to the idle class (spec §3, never crashes)",
      "gating edge inherits the failed target state color",
      "fix-loop edge is dashed + amber (visually distinct from sequencing)",
    ]) {
      ok(false, m, "lib/graphStyles.ts missing");
    }
  }

  const page = read("pages/WorkflowPage.tsx");
  ok(page !== null, "src/pages/WorkflowPage.tsx exists");
  has(page, "'@xyflow/react'", "WorkflowPage imports React Flow from @xyflow/react");
  has(page, "ReactFlow", "WorkflowPage renders <ReactFlow>");
  has(page, "queryKeys.graph", "WorkflowPage fetches the ['graph', runId] key");
  has(page, "queryKeys.runs", "WorkflowPage reads ['runs'] for the run selector");
  has(page, "fetchRunGraph", "WorkflowPage loads GET /api/runs/:id/graph");
  has(page, "nodeStateClass", "WorkflowPage colors nodes through nodeStateClass");
  has(page, "fixLoopEdgeClass", "WorkflowPage styles fix-loop edges distinctly");
  has(page, "onNodeClick", "WorkflowPage binds node click \u2192 side panel (spec J2)");
  has(page, "Escape", "side panel closes on Escape (spec \u00a73)");
  has(page, "Gates", "side panel shows the phase gates");
  has(page, "Evidence", "side panel shows an evidence excerpt");
  has(page, "Handoff", "side panel shows the handoff digest");
  has(page, "stale", "unknown state renders with a stale marker (spec \u00a73)");
  has(page, "<select", "run selector rendered at the top");
}


async function main_() {
  console.log("\n=== Studio v2 UI tests (RED phase) ===");
  await testApiContract();
  await testQueryKeys();
  testClientWiring();
  await testGraphPage();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main_().catch((err) => {
  console.error(err);
  process.exit(1);
});

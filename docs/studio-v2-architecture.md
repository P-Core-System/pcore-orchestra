# Studio v2 — Architecture

Status: draft · Companion to `docs/studio-v2-design-spec.md` · ≤ one new backend surface, no new deps.

## 1. System diagram

```
                         process boundary A                     process boundary B
  ┌─────────────────────────────────────────────┐   ┌──────────────────────────────────────┐
  │  node server/studio-api.js [--port]         │   │  Studio SPA (Vite static dist)       │
  │  (Express + ws)                             │   │  served by studio-api.js             │
  │                                             │   │                                      │
  │  REST: /api/runs, /api/workitems,           │◄──┤  TanStack Query  ── 5s refetch       │
  │        /api/tokens/aggregates, ...          │WS │  React Flow graph                    │
  │  WS:   /api/ws  (phase.*, gate.*, run.*)    │──►│  hooks/useLiveGraph                  │
  │                                             │   │  Board / Timeline / Tokens pages     │
  │  server/graph-builder.js  (pure fn)         │   └──────────────────────────────────────┘
  │  server/readers.js        (data-layer,      │
  │        moved server-side, read-only)        │            client never reads FS
  └───────────────┬─────────────────────────────┘
                  │ read-only (state layout per conductor-state.js)
      ┌───────────▼────────────────┐   ┌──────────────────────────────────┐
      │ ~/.config/opencode/hooks/  │   │ <repo>/.pcore/state/             │
      │   state/                   │   │   conductor-runs/index.json      │
      │   conductor-runs/…         │   │   domain-events.json             │
      │   domain-events.json       │   │   orchestra-tokens.json          │
      │   orchestra-tokens.json    │   │   (discovered worktrees)         │
      └───────────▲────────────────┘   └──────────────▲───────────────────┘
                  │ written ONLY by hooks             │
        ┌─────────┴──────────────────────────────────┴────────┐
        │ Phase 0 hooks (Phase safe-write: tmp+rename/atomic) │
        │   writes: conductor runs, domain events, tokens     │
        └─────────────────────────────────────────────────────┘
```

Reads flow left→right only: hooks write state (Phase 0 safe-write) → server reads it → SPA renders. The one exception is `PATCH /api/workitems/:id`, which appends a domain event via `store.appendEvent` (never a raw write).

## 2. Process boundaries

- **Server:** `node server/studio-api.js [--port N]` — one process, Express + `ws`. Launched by `orchestra-studio`, **replacing the old `npx serve` static launcher** (the server now serves `studio/dist` itself and mounts the API).
- **State files are written ONLY by hooks** (Phase 0 safe-write, atomic tmp+rename). The server's readers are **read-only**: they reuse the existing client data-layer logic (`studio/src/lib/{conductorRuns,domainEvents,tokenTracker,stateResolver}.ts`) moved server-side into `server/readers.js`.
- **Server write exception:** `PATCH /api/workitems/:id` validates `{ state }` against the domain transition map, then calls `store.appendEvent` (`bundle/hooks/lib/domain/store.js` — the sole writer of `domain-events.json`, invariant 19). No raw `fs.write*` anywhere in `server/`.
- **Binds `127.0.0.1`** by default (`--host` to override is deliberately absent in v2). The SPA is same-origin static files — no CORS surface.
- **Client:** browser only. Zero filesystem access; all data over REST/WS.

## 3. API contract

### REST (from design spec §6)

| Endpoint | Method | Returns |
|---|---|---|
| `/api/runs` | GET | `Run[]` summaries |
| `/api/runs/:id` | GET | run detail + phases + gates + handoffs + evidence refs |
| `/api/runs/:id/graph` | GET | `{ nodes, edges }` (from graph builder) |
| `/api/workitems` | GET | `WorkItem[]` (filter: `state`, `agent`, `run`) |
| `/api/workitems/:id` | PATCH | `{ state }` — validated transition, appended via `store.appendEvent` |
| `/api/tokens/aggregates` | GET | totals grouped by run / phase / agent + time buckets |
| `/api/ws` | WS | event stream below |

### WS event schema

```
{ "type": "phase.started" | "phase.completed" | "gate.passed"
        | "gate.failed" | "run.completed",
  "runId": string, "phase"?: string, "gate"?: string,
  "at": string (ISO), "data"?: object }
```

Client sends **no mutations over WS**. Reconnect resumes from the `index.json` watermark, then applies live events; `run.completed` triggers query invalidation.

### JSON shapes

```ts
// GET /api/runs/:id
Run = { id: string, status: "running"|"completed"|"failed"|"blocked",
        startedAt: string, endedAt?: string, goal: string, agent: string,
        workspaceSlug: string, sessionId: string,
        phases: Phase[], gates: Gate[], handoffs: Handoff[],
        evidenceRefs: { gate: string, path: string, at: string }[] }
Phase = { name, state: "idle"|"running"|"completed"|"failed"|"blocked",
          startedAt?, endedAt?, tokens?: { input, output, total } }
Gate  = { id, result: "pass"|"fail"|"skip", evidencePointer?: string }

// GET /api/runs/:id/graph  — React Flow payload
Graph = {
  nodes: { id: string, type: "phase"|"agent"|"gate",
           state: PhaseState, label: string,
           data: { startedAt?, endedAt?, tokens?, result?, evidence? },
           position: { x: number, y: number } }[],
  edges: { id: string, source: string, target: string,
           kind: "sequence"|"assignment"|"gating"|"fix-loop",
           state?: PhaseState }[]
}

// GET /api/workitems (element)
WorkItem = { id: string, goal: string, agent: string,
             state: TicketState,            // TICKET_STATES, 10 columns
             runId?: string, ageMs: number,
             updatedAt: string }
// PATCH body: { state: TicketState }  → 200 { ok, item } | 409 { error, allowed }

// GET /api/tokens/aggregates
TokenAggregates = { byRun:   { runId: string, input, output, total }[],
                    byPhase: { phase: string,  input, output, total }[],
                    byAgent: { agent: string,  input, output, total }[],
                    buckets: { at: string, input, output, total }[] }
```

## 4. Graph builder

`server/graph-builder.js` exports one **pure function** — no fs, no clock:

```js
buildRunGraph(run, evidence, outcomes) → { nodes, edges }
```

- **Phase chain:** `plan → implement → verify → review` as `phase` nodes; `kind:"sequence"` edges between consecutive phases; node `state` from the run's phase record.
- **Gate children:** one `gate` node per evidence record (grouped under its phase), `kind:"gating"` edge `gate → phase`; node `state` = evidence `ok ? completed : failed`.
- **Fix-loop edges:** when `outcomes` contain a `fix` decision, emit `kind:"fix-loop"` edges `verify → implement` / `review → implement` (retarget the failed phase); `kind:"assignment"` edges `agent → phase` for the active agent.
- **Layout:** static preset positions by phase index (x = column, y = row); no auto-layout dependency. Unknown/missing state degrades to `idle` (never throws on partial state files).
- Determinism: same inputs → same `{nodes, edges}`, so `['graph', id]` cache hits are stable across refetches.

## 5. TanStack Query integration

| queryKey | Endpoint | Notes |
|---|---|---|
| `['runs']` | `GET /api/runs` | list + summaries |
| `['run', id]` | `GET /api/runs/:id` | detail, timeline |
| `['graph', id]` | `GET /api/runs/:id/graph` | React Flow payload |
| `['workitems']` | `GET /api/workitems` | board (filter vars in key) |
| `['tokens']` | `GET /api/tokens/aggregates` | aggregates page |
| `['ws-status']` | — | local atom: `connected \| reconnecting \| disconnected` |

- **Refetch interval 5 s** on all data keys as the WS fallback (so a dropped socket still converges).
- **WS wiring (`hooks/useLiveGraph.ts`):** on each WS event, `queryClient.invalidateQueries({ queryKey: ['graph', runId] })` and `['run', runId]`; `phase.*`/`gate.*` also invalidate `['runs']`; `run.completed` invalidates `['runs']`, `['run', id]`, `['graph', id]`. Board PATCH uses optimistic update with rollback on error (WS does not carry mutations).

## 6. File layout

```
server/                    # new backend (Node, no bundler)
  api.js                   # Express app: routes, static dist, error envelope
  ws.js                    # ws server at /api/ws, watermark resume, broadcast
  graph-builder.js         # pure buildRunGraph(run, evidence, outcomes)
  readers.js               # data-layer moved server-side (read-only adapters)
  studio-api.js            # entry: node server/studio-api.js [--port]
studio/src/
  pages/                   # Graph, Board, Runs, RunTimeline, Tokens
  components/              # side panel, node renderers, kanban, timeline
  hooks/useLiveGraph.ts    # WS client + invalidateQueries wiring
  lib/types.ts             # shared types (Run, Graph, WorkItem, WS event, …)
```

`studio/src/lib/types.ts` is the single shared contract imported by both SPA and (via plain TS→JS build or mirrored types) the server; no type duplication.

## 7. Risks

| Risk | Mitigation |
|---|---|
| **FS polling cost** — reading global + N worktree state dirs every refetch scales with worktrees | Server-side read cache with mtime check; discover worktrees lazily; 5 s interval is a fallback, WS is the primary path |
| **WS auth** — an unauthenticated event stream | Bind `127.0.0.1` only; no remote bind by default; no mutations accepted over WS (replay of read data is the worst case) |
| **State files changing under read** — hooks write while server reads | Safe-write atomicity (tmp+rename, invariant 19) makes torn reads impossible; readers tolerate missing/invalid JSON → empty result, never crash |

## 8. Invariant updates

**Draft — `context/architecture.md` invariant 36:**

> 36. **Studio v2 server is read-only over hook state.** `server/studio-api.js` binds `127.0.0.1` (never a remote interface by default), serves the SPA plus `/api/*`, and reads conductor/domain/token state through the moved data-layer readers only — no raw writes to any hook state file. The single write path is `PATCH /api/workitems/:id`, which validates the domain transition and appends a domain event through `store.appendEvent` (invariant 19's sole writer). State files are written only by hooks via Phase 0 safe-write; the server never bypasses `store.appendEvent`.

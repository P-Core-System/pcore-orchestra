# Studio v2 — Design Specification

Status: draft · Scope: single new frontend surface (read-only over existing state files)

## 0. Stack

| Layer | Tech |
|---|---|
| Frontend | Vite + React, TanStack Query, React Flow, Tailwind (existing dark theme) |
| Backend | Express + WebSocket (`ws`), read-only adapters over state files |
| State inputs | `~/.config/opencode/hooks/state/` — `conductor-runs/index.json`, `domain-events.json`, `orchestra-tokens.json`; worktree dirs at `<repo>/.pcore/state/` |

No new dependencies. Backend exposes state; it does not own a database.

## 1. User Journeys

- **J1 — Open → live graph.** Load `/`; TanStack Query fetches `/api/runs/:id/graph`, WS pushes `phase.*` events, React Flow renders the current run and updates in place without refresh.
- **J2 — Click node → detail.** Click a phase/agent/gate node; a side panel slides in with status, evidence excerpt, gate results — no route change, graph stays visible.
- **J3 — Board drag-drop.** On `/board`, drag a WorkItem card across columns; `PATCH /api/workitems` persists the state change, optimistic UI reverts on failure.
- **J4 — Run timeline.** From `/runs`, open `/runs/:id`; scan phase blocks, gate badges, handoff digest, and per-phase token cost on one vertical timeline.
- **J5 — Filters.** Sidebar run + state filters narrow the graph and board (client-side over cached query data); WS events only mutate rows matching the active filter.

Success metrics: graph paints < 1s from cached query; node click → panel < 100ms; drag-drop shows no flicker; filters never require a full reload.

## 2. Information Architecture / Routes

| Route | View | Primary data |
|---|---|---|
| `/` | Workflow graph (React Flow) | `GET /api/runs/:id/graph` |
| `/board` | WorkItem kanban, 10 columns | `GET /api/workitems` |
| `/runs` | Run list + status summary | `GET /api/runs` |
| `/runs/:id` | Run timeline | `GET /api/runs/:id` |
| `/tokens` | Token aggregates by run/phase/agent | `GET /api/tokens/aggregates` |

- **Sidebar (persistent):** state-dir browser (which `conductor-runs` / worktree dirs are mounted) + run filters (run, agent, state, time range).
- **Header (persistent):** WebSocket connection status — `connected` (pulse), `reconnecting` (amber), `disconnected` (red, with retry + last-event timestamp).

## 3. React Flow Schema

**Node types**

| Type | Identity | Payload |
|---|---|---|
| `phase` | phase name within run | state, started/ended, gate refs, tokens |
| `agent` | agent id | role, active phase, run count |
| `gate` | quality gate id | result, evidence pointer |

**Node states:** `idle | running | completed | failed | blocked`

**Edges:** `phase → phase` (sequencing), `agent → phase` (assignment), `gate → phase` (gating). Edge style inherits target node state.

**Rendering rules**

- Colors follow §7 tokens; `running` adds a pulse animation (CSS keyframe on border/box-shadow), disabled under `prefers-reduced-motion`.
- Unknown/missing state → render as `idle` + a "stale" tooltip (never crash on partial state files).
- Click node → open right side panel (selected-node context in component state); Escape or backdrop closes. Double-click is not bound.
- Layout: static preset positions from the graph payload; no auto-layout dependency.

## 4. WorkItem Board

Ten columns, fixed order, sourced from `TICKET_STATES`:

`TRIAGE → READY → PLANNED → IN_PROGRESS → VERIFYING → REVIEW_PENDING → COMPLETED → NEEDS_HUMAN → CANCELLED → FAILED`

| Aspect | Rule |
|---|---|
| Card content | `id` · `goal` · `agent` · `age` (time in current state) |
| Columns | Scroll horizontally on < 1280px; stack into a state-picker list on mobile |
| Drag-drop | Only to states allowed by the domain transition map; illegal drop = snap back + toast |
| Empty column | Dashed placeholder with state label |
| Mutation | `PATCH /api/workitems/:id` with optimistic update; on error, rollback + error toast |

## 5. Run Timeline (`/runs/:id`)

Vertical stack, one block per phase in execution order:

1. **Phase block** — name, state chip, start/end + duration, expandable.
2. **Gate badges** — `pass` (green) / `fail` (red) inline at the phase's gate points; click jumps to evidence.
3. **Evidence excerpt** — first ~10 lines of the gate's evidence record, monospace, clamped with "expand".
4. **Handoff digest** — condensed handoff text passed to the next phase (collapsed by default).
5. **Tokens per phase** — input/output/total from `orchestra-tokens.json`, with a per-run sparkline on the header.

Live: WS `phase.*` / `gate.*` events patch the open timeline in place.

## 6. API Contract

| Endpoint | Method | Returns |
|---|---|---|
| `/api/runs` | GET | `[{ id, status, startedAt, goal, agent }]` |
| `/api/runs/:id` | GET | run detail + phases + gates + handoffs + evidence refs |
| `/api/runs/:id/graph` | GET | `{ nodes: [{ id, type, state, ... }], edges: [{ id, source, target }] }` |
| `/api/workitems` | GET | work items (filter: `state`, `agent`, `run`) |
| `/api/workitems/:id` | PATCH | `{ state }` — validated against domain transitions |
| `/api/tokens/aggregates` | GET | totals grouped by run / phase / agent + time buckets |
| `/api/ws` | WS | event stream below |

**WS events:** `phase.started`, `phase.completed`, `gate.passed`, `gate.failed`, `run.completed` — payload `{ runId, phase?, gate?, at, data }`. Client sends no mutations over WS; reconnect resumes from `index.json` watermark, then applies live events (query invalidation on `run.completed`).

## 7. Design Tokens

Dark mode is the default; reuse the existing Tailwind theme — no second palette, no light-mode work in v2.

| Token | Value | Use |
|---|---|---|
| `node-idle` | `zinc-700` border / `zinc-900` fill | idle nodes, unselected edges |
| `node-running` | `sky-400` | running node + pulse |
| `node-completed` | `emerald-500` | completed nodes |
| `node-failed` | `red-500` | failed nodes, fail badges |
| `node-blocked` | `amber-500` | blocked nodes, `NEEDS_HUMAN` column |
| `phase-*` | violet / sky / teal / rose gradient by phase index | phase block headers, timeline accents |
| `gate-pass` / `gate-fail` | `emerald-500` / `red-500` | gate badges |
| surface | `zinc-950` page, `zinc-900` panels, `zinc-800` borders | shell |

Rules: state color always paired with text/icon (never color-only); contrast ≥ 4.5:1 on `zinc-900+`; all colors exposed as CSS custom properties under `:root[data-theme="dark"]` so React Flow and Tailwind share one source.

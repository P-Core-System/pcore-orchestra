/**
 * Typed fetch wrappers for the Studio v2 REST contract.
 *
 * Contract: docs/studio-v2-design-spec.md §6 + docs/studio-v2-architecture.md §3.
 * Same-origin relative URLs only — the SPA is served by server/studio-api.js
 * itself, so there is no base URL, no CORS surface, and no filesystem access
 * in the browser (architecture §2).
 *
 * Every wrapper funnels through `request()`, which rejects non-2xx responses
 * with the server's `error` string so callers (optimistic mutations, toasts)
 * can show the real reason — e.g. the 409 transition guard of
 * `PATCH /api/workitems/:id`.
 */

// ------------------------------------------------------------------ shapes

export type RunStatus = "running" | "completed" | "failed" | "blocked";

export type NodeState = "idle" | "running" | "completed" | "failed" | "blocked";

export type TicketState =
  | "TRIAGE"
  | "READY"
  | "PLANNED"
  | "IN_PROGRESS"
  | "VERIFYING"
  | "REVIEW_PENDING"
  | "COMPLETED"
  | "NEEDS_HUMAN"
  | "CANCELLED"
  | "FAILED";

export interface RunSummary {
  id: string;
  key?: string;
  status: RunStatus;
  startedAt: string | null;
  goal: string;
  agent: string;
  phase?: string | null;
  workspaceSlug?: string;
  sessionId?: string;
  taskId?: string;
  updatedAt?: string | null;
}

export interface RunPhase {
  name: string;
  state: NodeState;
  startedAt?: string | number | null;
  endedAt?: string | number | null;
  agent?: string | null;
  tokens?: { input?: number; output?: number; total?: number };
}

export interface RunGate {
  id: string;
  name?: string;
  result: "pass" | "fail" | "skip";
  evidencePointer?: string;
  phase?: string;
  at?: string;
  exitCode?: number;
  command?: string;
}

export interface RunHandoff {
  fromPhase: string;
  toPhase: string | null;
  evidenceDigest: string;
  at?: string;
  clamped?: boolean;
}

export interface RunDetail {
  id: string;
  status: RunStatus;
  startedAt: string | null;
  endedAt?: string | null;
  goal: string;
  agent: string;
  workspaceSlug: string;
  sessionId: string;
  taskId: string;
  phase?: string | null;
  summary?: unknown;
  phases: RunPhase[];
  gates: RunGate[];
  handoffs: RunHandoff[];
  evidenceRefs: { gate: string; path: string; at: string }[];
}

export interface GraphNode {
  id: string;
  type: "phase" | "agent" | "gate";
  state: NodeState;
  label: string;
  data?: {
    startedAt?: string | number;
    endedAt?: string | number;
    tokens?: { input?: number; output?: number; total?: number };
    result?: "pass" | "fail" | "skip";
    evidence?: string;
    [key: string]: unknown;
  };
  position: { x: number; y: number };
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: "sequence" | "assignment" | "gating" | "fix-loop";
  state?: NodeState;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface WorkItem {
  id: string;
  title?: string;
  goal: string;
  agent: string;
  state: TicketState;
  runId?: string;
  createdAt?: number;
  updatedAt: number;
  ageMs: number;
  transitions?: { from: string; to: string; at: number }[];
}

export interface WorkItemFilters {
  state?: string;
  agent?: string;
  run?: string;
}

export interface TokenRow {
  input: number;
  output: number;
  total: number;
  budget?: number;
}

export interface TokenAggregates {
  byRun: (TokenRow & { runId: string })[];
  byPhase: (TokenRow & { phase: string })[];
  byAgent: (TokenRow & { agent: string })[];
  buckets: (TokenRow & { at: string })[];
}

/** Server → client WS event (architecture §3). Client sends nothing. */
export interface WsEvent {
  type: "phase.started" | "phase.completed" | "gate.passed" | "gate.failed" | "run.completed" | string;
  runId?: string;
  phase?: string;
  gate?: string;
  at?: string;
  data?: unknown;
}

// ---------------------------------------------------------------- transport

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (body && typeof body.error === "string" && body.error) detail = body.error;
    } catch {
      /* non-JSON error body: keep the HTTP status */
    }
    const method = (init && init.method) || "GET";
    throw new Error(`${detail} (${method} ${path})`);
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------- endpoints

/** `GET /api/runs` — run summaries for the list + run selector. */
export function fetchRuns(): Promise<RunSummary[]> {
  return request<RunSummary[]>("/api/runs");
}

/** `GET /api/runs/:id` — run detail for the timeline. */
export function fetchRun(id: string): Promise<RunDetail> {
  return request<RunDetail>(`/api/runs/${encodeURIComponent(id)}`);
}

/** `GET /api/runs/:id/graph` — React Flow payload for the workflow page. */
export function fetchRunGraph(id: string): Promise<Graph> {
  return request<Graph>(`/api/runs/${encodeURIComponent(id)}/graph`);
}

/** `GET /api/workitems` — board rows, filtered by `state` / `agent` / `run`. */
export function fetchWorkItems(filters?: WorkItemFilters): Promise<WorkItem[]> {
  const params = new URLSearchParams();
  if (filters && filters.state) params.set("state", filters.state);
  if (filters && filters.agent) params.set("agent", filters.agent);
  if (filters && filters.run) params.set("run", filters.run);
  const query = params.toString();
  return request<WorkItem[]>(query ? `/api/workitems?${query}` : "/api/workitems");
}

/**
 * `PATCH /api/workitems/:id` — the backend's only write path. Body is exactly
 * `{ state }`; the server validates the transition (409 → throws here so the
 * board can roll its optimistic update back).
 */
export function patchWorkItemState(
  id: string,
  state: TicketState
): Promise<{ ok: boolean; item: WorkItem }> {
  return request<{ ok: boolean; item: WorkItem }>(`/api/workitems/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state }),
  });
}

/** `GET /api/tokens/aggregates` — totals by run / phase / agent + time buckets. */
export function fetchTokenAggregates(): Promise<TokenAggregates> {
  return request<TokenAggregates>("/api/tokens/aggregates");
}

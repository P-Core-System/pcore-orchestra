/**
 * TanStack Query key table — architecture §5.
 *
 * Single source of truth for cache identity: pages build their keys here and
 * the WS client invalidates through `wsInvalidationKeys`, so a live event can
 * never miss a cache entry because two call sites spelled the key differently.
 *
 * | key                  | endpoint                     |
 * |----------------------|------------------------------|
 * | ['runs']             | GET /api/runs                |
 * | ['run', id]          | GET /api/runs/:id            |
 * | ['graph', id]        | GET /api/runs/:id/graph      |
 * | ['workitems', filt?] | GET /api/workitems           |
 * | ['tokens']           | GET /api/tokens/aggregates   |
 * | ['ws-status']        | local WS connection status   |
 */

import type { WsEvent, WorkItemFilters } from "./api";

/** Structural alias — kept local so this module stays import-free at runtime. */
export type QueryKey = readonly unknown[];

export const queryKeys = {
  runs: (): QueryKey => ["runs"],
  run: (id: string): QueryKey => ["run", id],
  graph: (id: string): QueryKey => ["graph", id],
  workitems: (filters?: WorkItemFilters): QueryKey =>
    filters && Object.keys(filters).length > 0 ? ["workitems", filters] : ["workitems"],
  tokens: (): QueryKey => ["tokens"],
  wsStatus: (): QueryKey => ["ws-status"],
};

/** Event types the server actually emits (architecture §3). */
const KNOWN_EVENTS = new Set([
  "phase.started",
  "phase.completed",
  "gate.passed",
  "gate.failed",
  "run.completed",
]);

/**
 * WS event → query keys to invalidate (architecture §5).
 *
 * - every event: `['graph', runId]` + `['run', runId]` (the open graph and
 *   timeline must repaint in place);
 * - `phase.*` / `gate.*` / `run.completed`: also `['runs']` (status column);
 * - unknown types degrade to the run-scoped keys and never throw;
 * - an event with no `runId` maps to nothing (no `undefined` cache keys).
 */
export function wsInvalidationKeys(event: WsEvent | null | undefined): QueryKey[] {
  if (!event || typeof event.runId !== "string" || !event.runId) return [];
  const runId = event.runId;
  const keys: QueryKey[] = [queryKeys.graph(runId), queryKeys.run(runId)];
  if (typeof event.type === "string" && KNOWN_EVENTS.has(event.type)) {
    keys.push(queryKeys.runs());
  }
  return keys;
}

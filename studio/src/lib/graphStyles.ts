/**
 * Graph state styling — design spec §3 (rendering rules) and §7 (tokens).
 *
 * Pure and dependency-free: the workflow page feeds it raw server state and
 * gets back Tailwind classes / strokes. One map per concern, so the spec's
 * "state color always paired with text" rule is enforced in a single place —
 * `NODE_STATE_LABELS` must be rendered next to every colored node.
 *
 * Unknown or missing state degrades to `idle` (spec §3: never crash on
 * partial state files); `isKnownState` lets the caller add the "stale" marker.
 */

import type { NodeState } from './api';

const NODE_STATES: readonly string[] = ['idle', 'running', 'completed', 'failed', 'blocked'];

/** Node classes — §7: zinc idle / sky running / emerald completed / red failed / amber blocked. */
export const NODE_STATE_CLASSES: Record<NodeState, string> = {
  idle: 'border border-zinc-700 bg-zinc-900 text-zinc-300',
  running: 'border border-sky-400 bg-zinc-900 text-sky-300 node-pulse',
  completed: 'border border-emerald-500 bg-zinc-900 text-emerald-300',
  failed: 'border border-red-500 bg-zinc-900 text-red-300',
  blocked: 'border border-amber-500 bg-zinc-900 text-amber-300',
};

/** Text label rendered beside every state color (§7: never color-only). */
export const NODE_STATE_LABELS: Record<NodeState, string> = {
  idle: 'Idle',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  blocked: 'Blocked',
};

/** Edge class strings (applied on the edge group; the path takes `edgeStroke`). */
export const EDGE_STATE_CLASSES: Record<NodeState, string> = {
  idle: 'stroke-zinc-700',
  running: 'stroke-sky-400',
  completed: 'stroke-emerald-500',
  failed: 'stroke-red-500',
  blocked: 'stroke-amber-500',
};

/** Hex strokes for the path — xyflow's stylesheet beats class-based stroke. */
export const EDGE_STATE_STROKES: Record<NodeState, string> = {
  idle: '#52525b',
  running: '#38bdf8',
  completed: '#10b981',
  failed: '#ef4444',
  blocked: '#f59e0b',
};

/** Fix-loop edges are dashed amber — rework reads differently from sequencing. */
export const FIX_LOOP_EDGE_CLASS = 'stroke-amber-500 stroke-dasharray-[6_4]';
export const FIX_LOOP_STROKE = '#f59e0b';
export const FIX_LOOP_DASHARRAY = '6 4';

export function isKnownState(value: unknown): value is NodeState {
  return typeof value === 'string' && NODE_STATES.indexOf(value) !== -1;
}

/** Normalize any server value to a renderable state (unknown → idle). */
export function nodeState(value: unknown): NodeState {
  return isKnownState(value) ? value : 'idle';
}

export function nodeStateClass(value: unknown): string {
  return NODE_STATE_CLASSES[nodeState(value)];
}

export function nodeStateLabel(value: unknown): string {
  return NODE_STATE_LABELS[nodeState(value)];
}

/** Edges inherit their target's state (spec §3). */
export function edgeStateClass(value: unknown): string {
  return EDGE_STATE_CLASSES[nodeState(value)];
}

export function edgeStroke(value: unknown): string {
  return EDGE_STATE_STROKES[nodeState(value)];
}

export function fixLoopEdgeClass(_value?: unknown): string {
  return FIX_LOOP_EDGE_CLASS;
}

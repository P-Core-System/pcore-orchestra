/**
 * Graph state styling — design spec §3 (rendering rules) and §7 (tokens).
 *
 * Pure and dependency-free: the workflow page feeds it raw server state and
 * gets back Tailwind classes / strokes. One map per concern, so the spec's
 * "state color always paired with text" rule is enforced in a single place —
 * `NODE_STATE_LABELS` must be rendered next to every colored node.
 *
 * Colors are semantic design tokens (`styles.css`), not palette classes, so a
 * node reads correctly in both the light and the dark theme; each state keeps a
 * distinct hue AND its own text label, so the states stay distinguishable in
 * either theme and never rely on color alone.
 *
 * Unknown or missing state degrades to `idle` (spec §3: never crash on
 * partial state files); `isKnownState` lets the caller add the "stale" marker.
 */

import type { NodeState } from './api';

const NODE_STATES: readonly string[] = ['idle', 'running', 'completed', 'failed', 'blocked'];

/** Node classes — §7: neutral idle / info running / ok completed / err failed / warn blocked. */
export const NODE_STATE_CLASSES: Record<NodeState, string> = {
  idle: 'border border-line-strong bg-surface text-neutral-fg',
  running: 'border border-info-line bg-surface text-info-fg node-pulse',
  completed: 'border border-ok-line bg-surface text-ok-fg',
  failed: 'border border-err-line bg-surface text-err-fg',
  blocked: 'border border-warn-line bg-surface text-warn-fg',
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
  idle: 'stroke-neutral-line',
  running: 'stroke-info-line',
  completed: 'stroke-ok-line',
  failed: 'stroke-err-line',
  blocked: 'stroke-warn-line',
};

/**
 * Strokes for the path — xyflow's stylesheet beats class-based stroke, so the
 * value is injected as an inline style. A `var(--studio-*)` reference keeps it
 * theme-reactive; `cssVar()` resolves it for the canvas primitives that only
 * accept a concrete colour.
 */
export const EDGE_STATE_STROKES: Record<NodeState, string> = {
  idle: 'var(--studio-neutral-line)',
  running: 'var(--studio-info-line)',
  completed: 'var(--studio-ok-line)',
  failed: 'var(--studio-err-line)',
  blocked: 'var(--studio-warn-line)',
};

/** Fix-loop edges are dashed amber — rework reads differently from sequencing. */
export const FIX_LOOP_EDGE_CLASS = 'stroke-warn-line stroke-dasharray-[6_4]';
export const FIX_LOOP_STROKE = 'var(--studio-warn-line)';
export const FIX_LOOP_DASHARRAY = '6 4';

/**
 * Read a theme custom property off the document root. Needed for the React Flow
 * primitives (`Background`, `MiniMap`) that take a concrete colour rather than a
 * class, so they follow the active theme instead of freezing one palette.
 */
export function cssVar(name: string, fallback = '#3f3f46'): string {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/** Dot colour for the graph canvas grid. */
export function graphDotColor(): string {
  return cssVar('--studio-graph-dot', '#3f3f46');
}

/** MiniMap mask outside the graph bounds. */
export function graphMaskColor(): string {
  return cssVar('--studio-graph-mask', 'rgba(9, 9, 11, 0.7)');
}

/** Node handle (connector) fill, matching the theme's chrome. */
export function graphHandleColor(): string {
  return cssVar('--studio-graph-handle', '#52525b');
}

/** Resolve a state stroke to a concrete colour (MiniMap node fill). */
export function edgeStrokeColor(value: unknown): string {
  return cssVar(EDGE_STATE_STROKES[nodeState(value)], '#52525b');
}


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

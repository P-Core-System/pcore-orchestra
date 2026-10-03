import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import {
  fetchRun,
  fetchRunGraph,
  fetchRuns,
  type GraphEdge,
  type GraphNode,
  type NodeState,
  type RunDetail,
} from '../lib/api';
import { queryKeys } from '../lib/queryKeys';
import {
  EDGE_STATE_STROKES,
  FIX_LOOP_DASHARRAY,
  FIX_LOOP_STROKE,
  NODE_STATE_LABELS,
  edgeStateClass,
  edgeStroke,
  fixLoopEdgeClass,
  isKnownState,
  nodeState,
  nodeStateClass,
} from '../lib/graphStyles';
import { clampExcerpt, formatDuration, formatTimestamp } from '../lib/format';

/**
 * Workflow graph — route `/` (spec J1/J2).
 *
 * Fetches `['graph', runId]` and renders it with React Flow: state colors and
 * the running pulse come from `lib/graphStyles`, layout is the server's static
 * preset (no auto-layout dependency, spec §3), clicking a node opens the side
 * panel with gates / evidence excerpt / handoff — Escape or the close button
 * puts it away without touching the route.
 */

type StateNodeData = {
  label: string;
  kind: string;
  state: NodeState;
  stale: boolean;
  startedAt?: string | number | null;
  endedAt?: string | number | null;
};

type StateFlowNode = Node<StateNodeData, 'state'>;

function StateNode({ data }: NodeProps<StateFlowNode>) {
  const node: StateNodeData = data ?? {
    label: '',
    kind: 'phase',
    state: 'idle',
    stale: false,
  };
  return (
    <div
      className={`studio-node ${nodeStateClass(node.state)}`}
      data-state={node.state}
      data-kind={node.kind}
      title={node.stale ? 'Unknown state in state file — rendered as idle (stale)' : node.label}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="studio-handle"
        style={{ background: '#52525b' }}
      />
      <div className="text-[10px] uppercase tracking-wider opacity-70">{node.kind}</div>
      <div className="text-sm font-semibold text-inherit">{node.label}</div>
      <div className="text-[11px]">{NODE_STATE_LABELS[nodeState(node.state)]}</div>
      {node.stale && <div className="text-[10px] font-medium text-amber-400">stale</div>}
      <Handle
        type="source"
        position={Position.Right}
        className="studio-handle"
        style={{ background: '#52525b' }}
      />
    </div>
  );
}

const NODE_TYPES: NodeTypes = { state: StateNode };

function toFlowNodes(nodes: GraphNode[]): StateFlowNode[] {
  return nodes.map((node) => ({
    id: node.id,
    type: 'state',
    position: node.position ?? { x: 0, y: 0 },
    data: {
      label: node.label || node.id,
      kind: node.type,
      state: nodeState(node.state),
      stale: !isKnownState(node.state),
      startedAt: node.data?.startedAt,
      endedAt: node.data?.endedAt,
    },
  }));
}

function toFlowEdges(edges: GraphEdge[]): Edge[] {
  return edges.map((edge) => {
    const fixLoop = edge.kind === 'fix-loop';
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      className: fixLoop ? fixLoopEdgeClass(edge.state) : edgeStateClass(edge.state),
      style: fixLoop
        ? { stroke: FIX_LOOP_STROKE, strokeDasharray: FIX_LOOP_DASHARRAY }
        : { stroke: edgeStroke(edge.state) },
      animated: nodeState(edge.state) === 'running',
      label: fixLoop ? 'fix' : undefined,
    };
  });
}

function toMs(value: string | number | null | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return NaN;
}

/** Right-hand detail panel for the clicked node (spec J2). */
function NodeDetailPanel({
  node,
  run,
  onClose,
}: {
  node: GraphNode;
  run: RunDetail | undefined;
  onClose: () => void;
}) {
  const state = nodeState(node.state);
  const phase =
    typeof node.data?.phase === 'string'
      ? node.data.phase
      : node.type === 'phase'
        ? node.label
        : node.data && typeof node.data.activePhase === 'string'
          ? node.data.activePhase
          : run?.phase || '';

  const gates = (run?.gates ?? []).filter(
    (gate) => gate.phase === phase || gate.name === node.label || gate.id === node.label
  );
  const handoff = (run?.handoffs ?? []).find((entry) => entry.fromPhase === phase);
  const pointers = gates
    .map((gate) => gate.evidencePointer)
    .filter((pointer): pointer is string => typeof pointer === 'string' && pointer.length > 0);
  const details = typeof node.data?.details === 'string' ? node.data.details : '';
  const excerpt = clampExcerpt(details || pointers.join('\n'));

  const startMs = toMs(node.data?.startedAt);
  const endMs = toMs(node.data?.endedAt);

  return (
    <aside className="w-80 shrink-0 overflow-y-auto border-l border-zinc-800 bg-zinc-900 p-4 text-zinc-200">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">{node.type}</div>
          <div className="text-lg font-semibold">{node.label}</div>
          <span
            className={`mt-1 inline-block rounded px-2 py-0.5 text-[11px] ${nodeStateClass(state)}`}
          >
            {NODE_STATE_LABELS[state]}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close detail panel"
          className="rounded px-2 py-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
        >
          ✕
        </button>
      </div>

      <div className="mt-3 space-y-1 border-t border-zinc-800 pt-3 text-xs text-zinc-400">
        <div>Started: {formatTimestamp(node.data?.startedAt)}</div>
        <div>Ended: {formatTimestamp(node.data?.endedAt)}</div>
        <div>Duration: {formatDuration(endMs - startMs)}</div>
      </div>

      <section className="mt-4">
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">Gates</h4>
        {gates.length === 0 ? (
          <p className="text-xs text-zinc-500">No gates recorded for this node.</p>
        ) : (
          <ul className="space-y-1">
            {gates.map((gate) => (
              <li key={gate.id} className="flex items-center gap-2 text-xs">
                <span
                  className={
                    gate.result === 'pass' ? 'font-semibold text-emerald-500' : 'font-semibold text-red-500'
                  }
                >
                  {gate.result === 'pass' ? 'pass' : 'fail'}
                </span>
                <span className="text-zinc-300">{gate.name || gate.id}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-4">
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">Evidence</h4>
        <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-all rounded bg-zinc-950 p-2 font-mono text-[11px] text-zinc-400">
          {excerpt || 'No evidence excerpt for this node.'}
        </pre>
      </section>

      <section className="mt-4">
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">Handoff</h4>
        <p className="text-xs text-zinc-400">
          {handoff ? clampExcerpt(handoff.evidenceDigest) : 'No handoff recorded for this phase.'}
        </p>
      </section>
    </aside>
  );
}

export default function WorkflowPage() {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const runsQuery = useQuery({ queryKey: queryKeys.runs(), queryFn: fetchRuns });
  const runs = runsQuery.data ?? [];
  const activeRunId =
    (selectedRunId && runs.some((run) => run.id === selectedRunId) ? selectedRunId : runs[0]?.id) ||
    '';

  const graphQuery = useQuery({
    queryKey: queryKeys.graph(activeRunId),
    queryFn: () => fetchRunGraph(activeRunId),
    enabled: activeRunId.length > 0,
  });
  const runQuery = useQuery({
    queryKey: queryKeys.run(activeRunId),
    queryFn: () => fetchRun(activeRunId),
    enabled: activeRunId.length > 0,
  });

  const graph = graphQuery.data;
  const flowNodes = useMemo(() => toFlowNodes(graph?.nodes ?? []), [graph]);
  const flowEdges = useMemo(() => toFlowEdges(graph?.edges ?? []), [graph]);
  const selectedNode = useMemo(
    () => (graph?.nodes ?? []).find((candidate) => candidate.id === selectedNodeId) ?? null,
    [graph, selectedNodeId]
  );

  const onNodeClick: NodeMouseHandler = (_event, node) => {
    setSelectedNodeId(node.id);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedNodeId(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-800 bg-zinc-900 px-4 py-2">
        <label htmlFor="workflow-run-select" className="text-xs uppercase tracking-wider text-zinc-400">
          Run
        </label>
        <select
          id="workflow-run-select"
          value={activeRunId}
          onChange={(event) => {
            setSelectedRunId(event.target.value);
            setSelectedNodeId(null);
          }}
          className="max-w-md rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-200"
        >
          {runs.length === 0 && <option value="">No runs yet</option>}
          {runs.map((run) => (
            <option key={run.id} value={run.id}>
              [{run.status}] {run.id} — {run.goal || 'no goal'}
            </option>
          ))}
        </select>
        {graphQuery.isFetching && <span className="text-xs text-zinc-500">syncing…</span>}
        {runs.length === 0 && !runsQuery.isFetching && (
          <span className="text-xs text-zinc-500">No runs in the state dir yet.</span>
        )}
        {graphQuery.isError && (
          <span className="text-xs text-red-400">graph unavailable — retrying</span>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="relative min-h-0 min-w-0 flex-1">
          {activeRunId ? (
            <ReactFlow
              className="h-full w-full"
              nodes={flowNodes}
              edges={flowEdges}
              nodeTypes={NODE_TYPES}
              onNodeClick={onNodeClick}
              fitView
              fitViewOptions={{ padding: 0.25 }}
              minZoom={0.2}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable
            >
              <Background color="#3f3f46" gap={18} size={1} />
              <Controls showInteractive={false} />
              <MiniMap
                pannable
                zoomable
                nodeColor={(rfNode) => EDGE_STATE_STROKES[nodeState(rfNode.data?.state)]}
                maskColor="rgba(9, 9, 11, 0.7)"
              />
            </ReactFlow>
          ) : (
            <div className="p-6 text-sm text-zinc-500">Waiting for runs…</div>
          )}
        </div>

        {selectedNode && (
          <NodeDetailPanel
            node={selectedNode}
            run={runQuery.data}
            onClose={() => setSelectedNodeId(null)}
          />
        )}
      </div>
    </div>
  );
}

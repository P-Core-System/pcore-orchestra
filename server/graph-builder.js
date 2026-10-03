"use strict";

/**
 * Studio v2 graph builder — ONE pure function, no fs, no clock, no requires
 * (docs/studio-v2-architecture.md §4).
 *
 *   buildRunGraph(run, evidence, outcomes) -> { nodes, edges }
 *
 * React Flow payload with static preset positions (no auto-layout dependency):
 *   - phase chain   plan -> implement -> verify -> review (`kind:"sequence"`)
 *   - gate children one node per evidence record, `kind:"gating"` gate -> phase
 *   - fix-loop      `kind:"fix-loop"` verify|review -> implement when an
 *                   outcome decided `fix`
 *   - assignment    `kind:"assignment"` agent -> the active phase
 *
 * Determinism is a hard requirement: same inputs -> byte-identical output so
 * the `['graph', id]` query cache never churns across 5s refetches.
 * Partial/unknown state degrades to `idle` and never throws.
 *
 * `derivePhases` lives here too so the run timeline (`GET /api/runs/:id`) and
 * the graph render the exact same phase states — `server/readers.js` re-exports
 * it rather than keeping a second copy.
 */

const PHASE_ORDER = ["plan", "implement", "verify", "review"];

/** Phases that request a fix by looping back to implement. */
const FIX_LOOP_SOURCES = new Set(["verify", "review"]);

const PHASE_X = 260;
const PHASE_Y = 120;
const GATE_Y = 260;
const GATE_GAP = 90;
const AGENT_X = -260;

/** Domain events carry `payload`, studio-era events `data`, bare payloads neither. */
function payloadOf(value) {
  if (!value || typeof value !== "object") return {};
  if (value.payload && typeof value.payload === "object") return value.payload;
  if (value.data && typeof value.data === "object") return value.data;
  return value;
}

function normalizePhaseState(status) {
  switch (status) {
    case "active":
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "blocked":
      return "blocked";
    default:
      return "idle";
  }
}

function isLiveStatus(status) {
  return status === undefined || status === null || status === "active" || status === "in_progress";
}

/** `{ phase, decision }` from either a raw domain event or a bare payload. */
function normalizeOutcome(value) {
  const payload = payloadOf(value);
  const phase = typeof payload.phase === "string" ? payload.phase : undefined;
  const decision = typeof payload.decision === "string" ? payload.decision : undefined;
  if (!phase && !decision) return null;
  return Object.assign({}, payload, { phase, decision });
}

function normalizeOutcomes(outcomes) {
  const list = Array.isArray(outcomes) ? outcomes : [];
  const normalized = [];
  for (const value of list) {
    const outcome = normalizeOutcome(value);
    if (outcome) normalized.push(outcome);
  }
  return normalized;
}

/** Flatten evidence input: records, `evidence.run` events, or `{ records }`. */
function normalizeEvidence(evidence) {
  const list = Array.isArray(evidence) ? evidence : [];
  const records = [];
  const push = (record) => {
    if (record && typeof record === "object" && !Array.isArray(record)) records.push(record);
  };
  for (const value of list) {
    if (!value || typeof value !== "object") continue;
    const payload = payloadOf(value);
    if (Array.isArray(payload.records)) {
      for (const record of payload.records) push(record);
      continue;
    }
    if (Array.isArray(value.records)) {
      for (const record of value.records) push(record);
      continue;
    }
    push(value);
  }
  return records;
}

/**
 * Phase list for a run — `run.phases` when the run file carries it, otherwise
 * the chain derived from the current phase plus `phase.outcome` decisions
 * (real conductor runs store only `phase` + `status`).
 *
 * @param {object} run     run document (any shape; degrades to idle)
 * @param {Array}  outcomes outcome events or payloads
 * @returns {{name:string,state:string,startedAt?:*,endedAt?:*,agent?:*,tokens?:*}[]}
 */
function derivePhases(run, outcomes) {
  const source = run && typeof run === "object" ? run : {};
  const list = Array.isArray(source.phases) ? source.phases : [];
  if (list.length > 0) {
    return list.map((phase) => {
      const p = phase && typeof phase === "object" ? phase : {};
      return {
        name: p.name,
        state: normalizePhaseState(p.status !== undefined ? p.status : p.state),
        startedAt: p.startedAt,
        endedAt: p.completedAt !== undefined ? p.completedAt : p.endedAt,
        agent: p.agent,
        tokens: p.tokens,
      };
    });
  }

  const decisions = new Map();
  for (const outcome of normalizeOutcomes(outcomes)) {
    if (outcome.phase) decisions.set(outcome.phase, outcome.decision);
  }
  const current = typeof source.phase === "string" ? source.phase : null;
  const currentIndex = PHASE_ORDER.indexOf(current);
  const live = isLiveStatus(source.status);

  return PHASE_ORDER.map((name, index) => {
    const decision = decisions.get(name);
    let state = "idle";
    if (decision === "advance") state = "completed";
    else if (decision === "fix") state = "failed";
    else if (decision === "block") state = "blocked";
    else if (index === currentIndex) state = live ? "running" : "completed";
    else if (currentIndex >= 0 && index < currentIndex) state = "completed";
    return { name, state };
  });
}

function activePhaseName(phases, run) {
  const running = phases.find((phase) => phase.state === "running");
  if (running && running.name) return running.name;
  if (typeof run.phase === "string" && PHASE_ORDER.includes(run.phase)) return run.phase;
  return null;
}

function activeAgent(run, phases) {
  if (typeof run.agent === "string" && run.agent) return run.agent;
  const phase = phases.find((candidate) => candidate.agent);
  if (phase) return phase.agent;
  const list = Array.isArray(run.phases) ? run.phases : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const agent = list[i] && list[i].agent;
    if (agent) return agent;
  }
  return null;
}

/**
 * @param {object} run      run document
 * @param {Array}  evidence evidence records (or `evidence.run` events)
 * @param {Array}  outcomes phase.outcome events (or bare payloads)
 * @returns {{nodes:object[],edges:object[]}}
 */
function buildRunGraph(run, evidence, outcomes) {
  const source = run && typeof run === "object" ? run : {};
  const outcomeList = normalizeOutcomes(outcomes);
  const phases = derivePhases(source, outcomeList);
  const records = normalizeEvidence(evidence);

  const nodes = [];
  const edges = [];
  const nodeIds = new Set();
  const edgeIds = new Set();
  const pushNode = (node) => {
    if (!node || !node.id || nodeIds.has(node.id)) return;
    nodeIds.add(node.id);
    nodes.push(node);
  };
  const pushEdge = (edge) => {
    if (!edge || !edge.id || edgeIds.has(edge.id)) return;
    if (!edge.source || !edge.target || edge.source === edge.target) return;
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return;
    edgeIds.add(edge.id);
    edges.push(edge);
  };

  // --- phase chain ---------------------------------------------------------
  phases.forEach((phase, index) => {
    pushNode({
      id: phase.name,
      type: "phase",
      state: phase.state,
      label: phase.name,
      data: {
        startedAt: phase.startedAt,
        endedAt: phase.endedAt,
        tokens: phase.tokens,
        agent: phase.agent,
      },
      position: { x: index * PHASE_X, y: PHASE_Y },
    });
  });
  for (let index = 0; index + 1 < phases.length; index += 1) {
    const from = phases[index];
    const to = phases[index + 1];
    pushEdge({
      id: `seq-${from.name}-${to.name}`,
      source: from.name,
      target: to.name,
      kind: "sequence",
      state: to.state,
    });
  }

  // --- gate children -------------------------------------------------------
  const rowsByPhase = new Map();
  records.forEach((record, index) => {
    const gateName = typeof record.gate === "string" && record.gate ? record.gate : `gate-${index}`;
    const phaseName =
      typeof record.phase === "string" && PHASE_ORDER.includes(record.phase)
        ? record.phase
        : PHASE_ORDER.includes(source.phase)
          ? source.phase
          : PHASE_ORDER[PHASE_ORDER.length - 1];
    const row = rowsByPhase.get(phaseName) || 0;
    rowsByPhase.set(phaseName, row + 1);

    const state = record.ok ? "completed" : "failed";
    let id = `gate:${phaseName}:${gateName}`;
    if (nodeIds.has(id)) id = `${id}-${index}`;
    pushNode({
      id,
      type: "gate",
      state,
      label: gateName,
      data: {
        result: record.ok ? "pass" : "fail",
        phase: phaseName,
        command: record.command,
        exitCode: record.exitCode,
        path: record.path,
        details: record.details,
      },
      position: { x: PHASE_ORDER.indexOf(phaseName) * PHASE_X, y: GATE_Y + row * GATE_GAP },
    });
    pushEdge({
      id: `gating:${id}`,
      source: id,
      target: phaseName,
      kind: "gating",
      state,
    });
  });

  // --- fix-loop edges ------------------------------------------------------
  for (const outcome of outcomeList) {
    if (outcome.decision !== "fix") continue;
    const from = FIX_LOOP_SOURCES.has(outcome.phase) ? outcome.phase : PHASE_ORDER[PHASE_ORDER.length - 1];
    pushEdge({
      id: `fix-${from}-implement`,
      source: from,
      target: PHASE_ORDER[1],
      kind: "fix-loop",
      state: from,
    });
  }

  // --- assignment edge -----------------------------------------------------
  const phaseName = activePhaseName(phases, source);
  const agent = activeAgent(source, phases);
  if (phaseName && agent) {
    const phaseState = (phases.find((phase) => phase.name === phaseName) || {}).state || "idle";
    const agentId = `agent:${agent}`;
    pushNode({
      id: agentId,
      type: "agent",
      state: phaseState,
      label: agent,
      data: { role: agent, activePhase: phaseName, runCount: source.runCount },
      position: { x: AGENT_X, y: PHASE_Y },
    });
    pushEdge({
      id: `assign-${agent}-${phaseName}`,
      source: agentId,
      target: phaseName,
      kind: "assignment",
      state: phaseState,
    });
  }

  return { nodes, edges };
}

module.exports = {
  PHASE_ORDER,
  buildRunGraph,
  derivePhases,
  normalizePhaseState,
  payloadOf,
  normalizeEvidence,
  normalizeOutcomes,
};

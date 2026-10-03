"use strict";

/**
 * Studio v2 data layer — READ-ONLY adapters over hook state files.
 *
 * Ported server-side from `studio/src/lib/{conductorRuns,domainEvents,tokenTracker}.ts`
 * (client TS) so the browser never touches the filesystem (architecture §2).
 *
 * Inputs, all under `PCORE_STATE_DIR` (else `~/.config/opencode/hooks/state`):
 *   conductor-runs/index.json + conductor-runs/<ws>/<sid>/<taskId>.json
 *   domain-events.json        — domain store envelope { payload, at }; studio-era
 *                               events { data, timestamp } are accepted too
 *   orchestra-tokens.json     — studio shape { runs: [...] } or hook shape
 *                               { sessions: { <sid>: { runs: [...] } } }
 *
 * The ONLY write path in the backend is `PATCH /api/workitems/:id` in
 * studio-api.js, which appends through `store.appendEvent` (invariant 19).
 * Nothing in this module writes: every read is tolerant — missing or corrupt
 * JSON degrades to an empty result and never throws.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/** Canonical phase chain (docs/studio-v2-architecture.md §4). */
const PHASE_ORDER = ["plan", "implement", "verify", "review"];

/** Board columns — the 10 TICKET_STATES of the WorkItem kanban (spec §4). */
const TICKET_STATES = [
  "TRIAGE",
  "READY",
  "PLANNED",
  "IN_PROGRESS",
  "VERIFYING",
  "REVIEW_PENDING",
  "COMPLETED",
  "NEEDS_HUMAN",
  "CANCELLED",
  "FAILED",
];

const DEFAULT_STATE_DIR = path.join(os.homedir(), ".config", "opencode", "hooks", "state");

/** Resolved state dir; `PCORE_STATE_DIR` always wins (tests use a temp dir). */
function stateDir(dir) {
  return dir || process.env.PCORE_STATE_DIR || DEFAULT_STATE_DIR;
}

function runsDir(dir) {
  return path.join(stateDir(dir), "conductor-runs");
}

function domainEventsPath(dir) {
  return path.join(stateDir(dir), "domain-events.json");
}

function tokensPath(dir) {
  return path.join(stateDir(dir), "orchestra-tokens.json");
}

// ------------------------------------------------------------ read cache
// mtime+size+inode keyed, so a 5s refetch does not re-parse unchanged files
// (architecture §7 "server-side read cache with mtime check").
const readCache = new Map();

function readJsonSafe(file, fallback) {
  let stat = null;
  try {
    stat = fs.statSync(file);
  } catch {
    readCache.delete(file);
    return fallback;
  }
  const hit = readCache.get(file);
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size && hit.ino === stat.ino) {
    return hit.value;
  }
  let value = fallback;
  try {
    value = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    value = fallback;
  }
  readCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, ino: stat.ino, value });
  return value;
}

/** Drop a cached file (call after the server's own appendEvent). */
function invalidate(file) {
  readCache.delete(file);
}

// ------------------------------------------------------------- envelopes

/** Domain payload = `payload`, studio-era payload = `data`. */
function payloadOf(event) {
  if (!event || typeof event !== "object") return {};
  if (event.payload && typeof event.payload === "object") return event.payload;
  if (event.data && typeof event.data === "object") return event.data;
  return {};
}

/** Domain stamp = `at` (ISO), studio-era stamp = `timestamp` (epoch ms). */
function atMs(event) {
  if (!event) return Date.now();
  const raw = event.at !== undefined ? event.at : event.timestamp;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

function atIso(event) {
  return new Date(atMs(event)).toISOString();
}

function runIdOfEvent(event) {
  if (!event) return undefined;
  if (typeof event.runId === "string" && event.runId) return event.runId;
  const rid = payloadOf(event).runId;
  return typeof rid === "string" && rid ? rid : undefined;
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// ---------------------------------------------------------- conductor runs

function loadIndex(dir) {
  const index = readJsonSafe(path.join(runsDir(dir), "index.json"), null);
  if (!index || typeof index !== "object" || !index.runs || typeof index.runs !== "object") {
    return { version: 1, updated_at: null, runs: {} };
  }
  return index;
}

/**
 * Stable run id: `<workspaceSlug>:<sessionId>:<taskId>` — never contains `/`,
 * so it survives a single `:id` path segment. `entry.runId` (studio shape)
 * wins when present.
 */
function runIdOfKey(key, entry) {
  const e = entry || {};
  if (typeof e.runId === "string" && e.runId) return e.runId;
  const parts = String(key || "").split("/");
  const slug = e.workspaceSlug || parts[0] || "root";
  const sid = e.sessionId || parts[1] || "session";
  const tid = e.taskId || parts.slice(2).join("/") || "task";
  return `${slug}:${sid}:${tid}`;
}

function normalizeStatus(status) {
  if (status === "completed" || status === "failed" || status === "running") return status;
  if (status === "stalled" || status === "blocked") return "blocked";
  if (status === undefined || status === null || status === "active" || status === "in_progress") {
    return "running";
  }
  return "blocked";
}

function isLiveStatus(status) {
  return status === undefined || status === null || status === "active" || status === "in_progress";
}

function readRunFile(key, dir) {
  const parts = String(key || "").split("/");
  if (parts.length < 3) return null;
  const file = path.join(runsDir(dir), parts[0], parts[1], `${parts.slice(2).join("/")}.json`);
  return readJsonSafe(file, null);
}

function findRun(id, dir) {
  if (typeof id !== "string" || !id) return null;
  const runs = loadIndex(dir).runs;
  for (const key of Object.keys(runs)) {
    const entry = runs[key] || {};
    const canonical = runIdOfKey(key, entry);
    if (canonical === id || key === id || id.replace(/:/g, "/") === key) {
      return { key, entry, id: canonical };
    }
  }
  return null;
}

/** Run summaries for `GET /api/runs` (spec §6). */
function listRuns(dir) {
  const runs = loadIndex(dir).runs;
  return Object.keys(runs)
    .map((key) => {
      const entry = runs[key] || {};
      const id = runIdOfKey(key, entry);
      let agent = entry.agent;
      if (!agent) {
        const doc = readRunFile(key, dir);
        if (doc) {
          agent = doc.agent;
          if (!agent && Array.isArray(doc.phases)) {
            const active = doc.phases.find((p) => p && p.status === "active" && p.agent);
            agent = active ? active.agent : undefined;
          }
        }
      }
      return {
        id,
        key,
        status: normalizeStatus(entry.status),
        startedAt: entry.startedAt || null,
        goal: entry.goal || "",
        agent: agent || "",
        phase: entry.phase || null,
        workspaceSlug: entry.workspaceSlug || String(key).split("/")[0],
        sessionId: entry.sessionId || String(key).split("/")[1],
        taskId: entry.taskId || String(key).split("/").slice(2).join("/"),
        updatedAt: entry.lastUpdatedAt || entry.updatedAt || null,
      };
    })
    .sort((a, b) => String(b.startedAt || "").localeCompare(String(a.startedAt || "")));
}

/** Raw run document (index entry merged with the per-run file), or null. */
function loadRun(id, dir) {
  const found = findRun(id, dir);
  if (!found) return null;
  const doc = readRunFile(found.key, dir) || {};
  const merged = Object.assign({}, found.entry, doc, { id: found.id, key: found.key });
  return merged;
}

// ------------------------------------------------------- events / outcomes

function loadEvents(dir) {
  const events = readJsonSafe(domainEventsPath(dir), []);
  return Array.isArray(events) ? events : [];
}

/**
 * Events belonging to a run: exact runId match, else the run's sessionId as
 * `entityId` (how `recordPhaseOutcome` stamps real `phase.outcome` events).
 */
function eventsForRun(run, dir) {
  if (!run) return [];
  const ids = new Set(
    [run.id, run.taskId, run.sessionId, run.key].filter((v) => typeof v === "string" && v)
  );
  return loadEvents(dir).filter((event) => {
    const rid = runIdOfEvent(event);
    if (rid && ids.has(rid)) return true;
    if (event.entityId && run.sessionId && event.entityId === run.sessionId) return true;
    return false;
  });
}

function outcomeEvents(run, dir) {
  return eventsForRun(run, dir).filter((e) => e.type === "phase.outcome");
}

/** Flattened evidence records for a run: `[{ gate, ok, phase, ... }, ...]`. */
function evidenceRecords(run, dir) {
  const records = [];
  for (const event of eventsForRun(run, dir)) {
    if (event.type !== "evidence.run") continue;
    const payload = payloadOf(event);
    const list = Array.isArray(payload.records) ? payload.records : [];
    for (const record of list) {
      if (record && typeof record === "object") records.push(record);
    }
  }
  return records;
}

function outcomePayloads(run, dir) {
  return outcomeEvents(run, dir).map((event) => {
    const payload = payloadOf(event);
    return Object.assign({}, payload, {
      at: atIso(event),
      entityId: event.entityId !== undefined ? event.entityId : undefined,
    });
  });
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
    case "pending":
    case "skipped":
    case "idle":
    case undefined:
    case null:
      return "idle";
    default:
      return "idle";
  }
}

/**
 * Phase list for a run. Uses `run.phases` when the run file carries it;
 * otherwise derives the chain from the current phase + `phase.outcome`
 * events (real conductor runs store only `phase` + `status`).
 */
function phasesFor(run, outcomes) {
  const list = Array.isArray(run && run.phases) ? run.phases : [];
  if (list.length > 0) {
    return list.map((phase) => {
      const p = phase || {};
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
  for (const outcome of outcomes || []) {
    if (outcome && outcome.phase) decisions.set(outcome.phase, outcome.decision);
  }
  const current = run && typeof run.phase === "string" ? run.phase : null;
  const currentIndex = PHASE_ORDER.indexOf(current);
  const live = run ? isLiveStatus(run.status) : false;

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

function gateResults(records) {
  return (records || []).map((record, index) => ({
    id: record.gate || `gate-${index}`,
    name: record.gate || `gate-${index}`,
    result: record.ok ? "pass" : "fail",
    evidencePointer: record.path || record.details || "",
    phase: record.phase,
    at: record.startedAt,
  }));
}

function evidenceRefs(events) {
  const refs = [];
  for (const event of events) {
    if (event.type !== "evidence.run") continue;
    const payload = payloadOf(event);
    const list = Array.isArray(payload.records) ? payload.records : [];
    for (const record of list) {
      if (!record || typeof record !== "object") continue;
      refs.push({ gate: record.gate || "", path: record.path || "", at: atIso(event) });
    }
  }
  return refs;
}

function handoffsFor(outcomes) {
  const handoffs = [];
  for (const outcome of outcomes || []) {
    const digest = outcome.evidenceDigest;
    if (!digest || !outcome.phase) continue;
    const index = PHASE_ORDER.indexOf(outcome.phase);
    handoffs.push({
      fromPhase: outcome.phase,
      toPhase: index >= 0 && index + 1 < PHASE_ORDER.length ? PHASE_ORDER[index + 1] : null,
      evidenceDigest: digest,
      at: outcome.at,
      clamped: Boolean(outcome.clamped),
    });
  }
  return handoffs;
}

/** Run detail for `GET /api/runs/:id` (architecture §3). */
function loadRunDetail(id, dir) {
  const run = loadRun(id, dir);
  if (!run) return null;
  const events = eventsForRun(run, dir);
  const outcomes = outcomeEvents(run, dir).map((event) => {
    const payload = payloadOf(event);
    return Object.assign({}, payload, { at: atIso(event) });
  });
  const records = evidenceRecords(run, dir);

  return {
    id: run.id,
    status: normalizeStatus(run.status),
    startedAt: run.startedAt || null,
    endedAt: run.completedAt || run.endedAt || undefined,
    goal: run.goal || "",
    agent: run.agent || "",
    workspaceSlug: run.workspaceSlug || "",
    sessionId: run.sessionId || "",
    taskId: run.taskId || "",
    phase: run.phase || null,
    summary: run.summary || null,
    phases: phasesFor(run, outcomes),
    gates: gateResults(records),
    handoffs: handoffsFor(outcomes),
    evidenceRefs: evidenceRefs(events),
  };
}

// ------------------------------------------------------------- work items

/**
 * Board projection of `ticket.created` / `ticket.transitioned` events.
 * Returns `id/goal/agent/state/runId/updatedAt/ageMs` per the architecture §3
 * WorkItem shape.
 */
function deriveWorkItems(events, now) {
  const clock = typeof now === "number" ? now : Date.now();
  const items = new Map();
  for (const event of events || []) {
    if (event.type !== "ticket.created" && event.type !== "ticket.transitioned") continue;
    const payload = payloadOf(event);
    const ticketId = payload.ticketId || payload.id || event.entityId;
    if (!ticketId) continue;
    const at = atMs(event);

    if (event.type === "ticket.created") {
      items.set(ticketId, {
        id: ticketId,
        title: payload.title || "",
        goal: payload.goal || payload.title || "",
        agent: payload.agent || "",
        state: payload.state || "TRIAGE",
        runId: payload.runId || runIdOfEvent(event) || undefined,
        createdAt: at,
        updatedAt: at,
        transitions: [],
      });
      continue;
    }

    const toState = payload.toState || payload.to;
    if (!toState) continue;
    const existing =
      items.get(ticketId) ||
      {
        id: ticketId,
        title: payload.title || "",
        goal: payload.goal || payload.title || "",
        agent: payload.agent || "",
        state: payload.fromState || payload.from || "TRIAGE",
        runId: payload.runId || runIdOfEvent(event) || undefined,
        createdAt: at,
        updatedAt: at,
        transitions: [],
      };
    const fromState = payload.fromState || payload.from || existing.state;
    existing.state = toState;
    existing.updatedAt = at;
    if (payload.agent && !existing.agent) existing.agent = payload.agent;
    if (payload.goal && !existing.goal) existing.goal = payload.goal;
    existing.transitions.push({ from: fromState, to: toState, at });
    items.set(ticketId, existing);
  }

  return Array.from(items.values()).map((item) =>
    Object.assign({}, item, { ageMs: Math.max(0, clock - item.updatedAt) })
  );
}

/** `GET /api/workitems` with `state` / `agent` / `run` filters. */
function getWorkItems(filters, dir, now) {
  const f = filters || {};
  let items = deriveWorkItems(loadEvents(dir), now);
  if (f.state) items = items.filter((item) => item.state === f.state);
  if (f.agent) items = items.filter((item) => item.agent === f.agent);
  if (f.run) items = items.filter((item) => item.runId === f.run);
  return items;
}

// ----------------------------------------------------------------- tokens

function pushGroup(bucket, key, record) {
  if (!key) return;
  let row = bucket.get(key);
  if (!row) {
    row = { input: 0, output: 0, total: 0 };
    bucket.set(key, row);
  }
  row.input += record.input;
  row.output += record.output;
  row.total += record.total;
}

/**
 * Normalize the two on-disk token shapes into flat records:
 * run-level records feed `byRun`/`buckets`, phase records feed `byPhase`,
 * agent records feed `byAgent` (no double counting).
 */
function tokenRecords(dir) {
  const state = readJsonSafe(tokensPath(dir), null);
  if (!state || typeof state !== "object") return [];
  const records = [];

  // Studio shape: { runs: [{ runId, timestamp, byAgent, byPhase, total }] }
  if (Array.isArray(state.runs)) {
    for (const run of state.runs) {
      if (!run || typeof run !== "object") continue;
      const at = typeof run.timestamp === "string" ? run.timestamp : run.timestamp ? new Date(run.timestamp).toISOString() : null;
      const total = num(run.total);
      const input = num(run.input);
      records.push({
        runId: run.runId || "",
        phase: null,
        agent: null,
        at,
        input,
        output: run.output !== undefined ? num(run.output) : Math.max(0, total - input),
        total,
      });
      for (const phase of Array.isArray(run.byPhase) ? run.byPhase : []) {
        if (!phase) continue;
        const t = num(phase.total);
        records.push({ runId: run.runId || "", phase: phase.phase || "", agent: null, at, input: 0, output: t, total: t });
      }
      for (const agent of Array.isArray(run.byAgent) ? run.byAgent : []) {
        if (!agent) continue;
        const t = num(agent.total);
        records.push({ runId: run.runId || "", phase: null, agent: agent.agent || "", at, input: 0, output: t, total: t });
      }
    }
  }

  // Hook shape: { sessions: { <sid>: { runs: [{ run_id, phases: [...] }] } } }
  if (state.sessions && typeof state.sessions === "object") {
    for (const [sessionId, session] of Object.entries(state.sessions)) {
      if (!session || !Array.isArray(session.runs)) continue;
      for (const run of session.runs) {
        if (!run || typeof run !== "object") continue;
        const at = run.completed_at || run.started_at || null;
        const runId = run.run_id || sessionId;
        const total = num(run.total_reported) || num(run.total_estimated);
        const input = num(run.input_tokens);
        records.push({
          runId,
          phase: null,
          agent: null,
          at,
          input,
          output: Math.max(0, total - input),
          total,
        });
        for (const phase of Array.isArray(run.phases) ? run.phases : []) {
          if (!phase || typeof phase !== "object") continue;
          const reported = phase.reported && typeof phase.reported === "object" ? phase.reported : {};
          const phaseTotal = num(reported.total_tokens) || num(phase.estimated_tokens);
          const phaseInput = num(reported.input_tokens);
          records.push({
            runId,
            phase: phase.phase || "",
            agent: phase.agent || "",
            at: phase.timestamp || at,
            input: phaseInput,
            output: reported.output_tokens !== undefined ? num(reported.output_tokens) : Math.max(0, phaseTotal - phaseInput),
            total: phaseTotal,
          });
        }
      }
    }
  }

  return records;
}

function hourBucket(iso) {
  const ms = Date.parse(iso || "");
  if (!Number.isFinite(ms)) return null;
  return `${new Date(ms).toISOString().slice(0, 13)}:00:00.000Z`;
}

/** `GET /api/tokens/aggregates` (architecture §3 TokenAggregates). */
function getTokenAggregates(dir) {
  const records = tokenRecords(dir);
  const byRun = new Map();
  const byPhase = new Map();
  const byAgent = new Map();
  const buckets = new Map();

  for (const record of records) {
    const isRunLevel = !record.phase && !record.agent;
    if (isRunLevel) {
      pushGroup(byRun, record.runId, record);
      const bucket = hourBucket(record.at);
      if (bucket) pushGroup(buckets, bucket, { input: record.input, output: record.output, total: record.total });
    } else if (record.phase && !record.agent) {
      pushGroup(byPhase, record.phase, record);
    } else if (record.agent) {
      pushGroup(byAgent, record.agent, record);
    }
  }

  const toRows = (map, keyName) =>
    Array.from(map.entries())
      .map(([key, value]) => ({ [keyName]: key, input: value.input, output: value.output, total: value.total }))
      .sort((a, b) => String(a[keyName]).localeCompare(String(b[keyName])));

  return {
    byRun: toRows(byRun, "runId"),
    byPhase: toRows(byPhase, "phase"),
    byAgent: toRows(byAgent, "agent"),
    buckets: Array.from(buckets.entries())
      .map(([at, value]) => ({ at, input: value.input, output: value.output, total: value.total }))
      .sort((a, b) => a.at.localeCompare(b.at)),
  };
}

/** Per-run token rollup for the run detail payload. */
function tokensForRun(runId, dir) {
  const row = getTokenAggregates(dir).byRun.find((r) => r.runId === runId);
  return row ? { input: row.input, output: row.output, total: row.total } : undefined;
}

module.exports = {
  PHASE_ORDER,
  TICKET_STATES,
  stateDir,
  runsDir,
  domainEventsPath,
  tokensPath,
  invalidate,
  payloadOf,
  atMs,
  atIso,
  loadIndex,
  runIdOfKey,
  normalizeStatus,
  listRuns,
  loadRun,
  loadRunDetail,
  loadEvents,
  eventsForRun,
  outcomeEvents,
  outcomePayloads,
  evidenceRecords,
  phasesFor,
  gateResults,
  deriveWorkItems,
  getWorkItems,
  getTokenAggregates,
  tokensForRun,
};

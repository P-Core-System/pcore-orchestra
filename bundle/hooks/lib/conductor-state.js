"use strict";

/**
 * Conductor run-state persistence.
 *
 * Each orchestra loop = an isolated, atomic run keyed by
 * (workspaceSlug + sessionId + taskId) with a stable 12-hex task id. A shared
 * `index.json` registry lists live sessions/tasks for `who`/`resume`/stall
 * detection across workspaces and sessions. Concurrent loops never overwrite
 * each other — every write is an atomic tmp+rename.
 *
 * Legacy `~/.config/opencode/state/orchestra-state.json` is migrated exactly
 * once on the first beginRun (stashed on the run, renamed, never re-read).
 *
 * Worktree isolation: when `worktreePath` is provided, conductor runs are stored
 * in `worktreePath/.pcore/state/conductor-runs/` instead of the global
 * directory. This enables per-run isolation for concurrent orchestra runs.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { getSessionId, DEFAULT_SESSION_STATE } = require("./state-manager.js");
const { DEFAULT_STALL_THRESHOLD_MS } = require("./constants.js");

const INDEX_VERSION = 1;
const INDEX_NAME = "index.json";

/** Base directory for the registry + per-run files. */
function getConductorBaseDir(worktreePath) {
  if (process.env.PCORE_CONDUCTOR_STATE_DIR) return process.env.PCORE_CONDUCTOR_STATE_DIR;
  if (worktreePath && typeof worktreePath === "string") {
    return path.join(worktreePath, ".pcore", "state", "conductor-runs");
  }
  return path.join(os.homedir(), ".config", "opencode", "hooks", "state", "conductor-runs");
}

/** Legacy flat state path (overridable for tests). */
function getLegacyStatePath() {
  if (process.env.PCORE_LEGACY_STATE_PATH) return process.env.PCORE_LEGACY_STATE_PATH;
  return path.join(os.homedir(), ".config", "opencode", "state", "orchestra-state.json");
}

/** Resolve workspace root (env override > cwd > PWD) and its filesystem slug. */
function resolveWorkspace(cwd) {
  const root = process.env.PCORE_WORKSPACE_ROOT || cwd || process.cwd() || process.env.PWD;
  const base = path.basename(String(root));
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return { root: String(root), slug: slug || "root" };
}

/** Session id delegates to the shared state-manager chain. */
function resolveSessionId() {
  return getSessionId();
}

/** Stable 12-hex task id: env override, else sha1(goal + startedAt). */
function resolveTaskId(goal, startedAt) {
  if (process.env.PCORE_TASK_ID) return process.env.PCORE_TASK_ID;
  const h = crypto
    .createHash("sha1")
    .update(String(goal || "") + "::" + String(startedAt || ""))
    .digest("hex");
  return h.slice(0, 12);
}

/** Which CLI host is driving this run (null when the env says nothing). */
function detectHostFromEnv() {
  if (process.env.CURSOR_TRACE_ID) return "cursor";
  if (process.env.OPENCODE_SESSION_ID) return "opencode";
  if (process.env.CLAUDE_CODE_SESSION_ID) return "claude-code";
  if (process.env.CODEX_SESSION_ID) return "codex";
  if (process.env.QODER_CLI || process.env.QODER_PID || process.env.QODER_SESSION_ID) return "qoder";
  return null;
}

function runKeyParts(key) {
  const parts = String(key).split("/");
  if (parts.length < 3) return null;
  return { workspaceSlug: parts[0], sessionId: parts[1], taskId: parts.slice(2).join("/") };
}

function runKeyOf(run) {
  return [run.workspaceSlug, run.sessionId, run.taskId].join("/");
}

/** Resolve a per-run file path from a key string, an args object, or a path. */
function resolveRunPath(args) {
  const worktreePath = args && typeof args === "object" ? args.worktreePath : undefined;
  const baseDir = getConductorBaseDir(worktreePath);
  if (typeof args === "string") {
    const parts = runKeyParts(args);
    if (parts) return path.join(baseDir, parts.workspaceSlug, parts.sessionId, `${parts.taskId}.json`);
    return path.isAbsolute(args) ? args : path.join(baseDir, args);
  }
  const slug = args.workspaceSlug || resolveWorkspace(args.workspace).slug;
  const sid = args.sessionId || resolveSessionId();
  const tid = args.taskId || "default";
  return path.join(baseDir, slug, sid, `${tid}.json`);
}

/** Atomic tmp+rename write with 3-retry backoff. */
function atomicWrite(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let attempts = 0;
  for (;;) {
    const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
    try {
      fs.writeFileSync(tmpPath, data);
      fs.renameSync(tmpPath, filePath);
      return;
    } catch (err) {
      attempts += 1;
      if (attempts >= 3) throw err;
      const delay = 2 ** attempts * 10 + Math.floor(Math.random() * 20);
      const end = Date.now() + delay;
      while (Date.now() < end) {
        /* sync backoff */
      }
    }
  }
}

/** Read + parse the registry index; safe fallback to empty on parse errors. */
function loadIndex(worktreePath) {
  const indexPath = path.join(getConductorBaseDir(worktreePath), INDEX_NAME);
  try {
    if (!fs.existsSync(indexPath)) return { version: INDEX_VERSION, updated_at: null, runs: {} };
    return JSON.parse(fs.readFileSync(indexPath, "utf8"));
  } catch {
    return { version: INDEX_VERSION, updated_at: null, runs: {} };
  }
}

/** Atomic write of the registry index. */
function writeIndex(index, worktreePath) {
  index.version = INDEX_VERSION;
  index.updated_at = new Date().toISOString();
  atomicWrite(path.join(getConductorBaseDir(worktreePath), INDEX_NAME), JSON.stringify(index, null, 2));
}

/** Read a run file; null if missing or unparsable. */
function readRun(runKeyOrArgs, worktreePath) {
  const filePath = resolveRunPath(typeof runKeyOrArgs === "object" ? { ...runKeyOrArgs, worktreePath } : runKeyOrArgs);
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

/** Persist a run file + upsert the registry index. */
function saveRun(run, worktreePath) {
  const filePath = resolveRunPath({ ...run, worktreePath });
  atomicWrite(filePath, JSON.stringify(run, null, 2));
  const index = loadIndex(worktreePath);
  index.runs[runKeyOf(run)] = {
    workspace: run.workspace,
    workspaceSlug: run.workspaceSlug,
    sessionId: run.sessionId,
    taskId: run.taskId,
    goal: run.goal,
    phase: run.phase,
    status: run.status,
    host: run.host || null,
    startedAt: run.startedAt,
    lastHeartbeat: run.lastHeartbeat,
    lastUpdatedAt: new Date().toISOString(),
  };
  writeIndex(index, worktreePath);
}

/**
 * Migrate the legacy flat `~/.config/opencode/state/orchestra-state.json` once:
 * read it, stash under run.legacy by beginRun, rename so it is never re-read.
 */
function migrateLegacy() {
  const legacyPath = getLegacyStatePath();
  try {
    if (!fs.existsSync(legacyPath)) return null;
    const data = JSON.parse(fs.readFileSync(legacyPath, "utf8"));
    const renamed = `${legacyPath}.migrated.${Date.now()}`;
    fs.renameSync(legacyPath, renamed);
    return { path: renamed, migratedAt: new Date().toISOString(), data };
  } catch {
    return null;
  }
}

/**
 * Begin (or resume) a run. Idempotent: an existing live run on the same key is
 * resumed and preserves its startedAt. Returns `{ run, resumed }`.
 * @param {object} opts - options including optional worktreePath
 */
function beginRun(opts) {
  const worktreePath = opts.worktreePath;
  const legacy = migrateLegacy();
  const ws = resolveWorkspace(opts.workspace);
  const sessionId = opts.sessionId || resolveSessionId();
  const startedAt = new Date().toISOString();
  const taskId = opts.taskId || resolveTaskId(opts.goal, startedAt);
  const args = { workspaceSlug: ws.slug, sessionId, taskId, worktreePath };
  const existing = readRun(args, worktreePath);

  let run;
  let resumed = false;
  if (existing && existing.status === "active") {
    run = existing;
    run.goal = opts.goal || run.goal;
    run.phase = opts.phase || run.phase;
    if (!run.host) run.host = detectHostFromEnv();
    resumed = true;
  } else {
    run = {
      workspace: ws.root,
      workspaceSlug: ws.slug,
      sessionId,
      taskId,
      goal: opts.goal || "",
      phase: opts.phase || "plan",
      status: "active",
      host: opts.host || detectHostFromEnv(),
      startedAt: existing ? existing.startedAt : startedAt,
      lastHeartbeat: startedAt,
      completedAt: null,
      failReason: null,
      phaseResults: existing && existing.phaseResults ? existing.phaseResults : {},
      resumeAttempts: existing && existing.resumeAttempts ? existing.resumeAttempts : {},
      summary: existing ? existing.summary : null,
    };
    if (existing && existing.legacy) run.legacy = existing.legacy;
    if (legacy) run.legacy = legacy;
  }
  run.lastHeartbeat = new Date().toISOString();
  saveRun(run, worktreePath);
  return { run, resumed };
}

/** Touches the run heartbeat and persists. */
function heartbeat(run, worktreePath) {
  run.lastHeartbeat = new Date().toISOString();
  saveRun(run, worktreePath);
  return run;
}

/**
 * True for a status that counts as a live run. `active` and `in_progress` are
 * live; a missing/undefined status also counts live (matches how beginRun sets
 * `active`). completed/failed/stalled are not live but remain queryable via an
 * explicit status filter.
 */
function isLiveStatus(status) {
  return status === undefined || status === null || status === "active" || status === "in_progress";
}

/**
 * List index entries, optionally filtered by workspace + status. Without an
 * explicit `status` all runs are returned regardless of status; with a
 * `status` only runs matching that exact status are returned.
 * @param {object} [filters] - filters including optional worktreePath
 */
function listRuns(filters) {
  filters = filters || {};
  const worktreePath = filters.worktreePath;
  const index = loadIndex(worktreePath);
  const wsSlug = filters.workspace ? resolveWorkspace(filters.workspace).slug : null;
  return Object.values(index.runs).filter((entry) => {
    if (wsSlug && entry.workspaceSlug !== wsSlug) return false;
    if (filters.status && entry.status !== filters.status) return false;
    return true;
  });
}

/** List only live (active/in_progress) runs, optionally scoped to a workspace. */
function listLiveRuns(filters) {
  filters = filters || {};
  return listRuns({ workspace: filters.workspace, worktreePath: filters.worktreePath }).filter((entry) => isLiveStatus(entry.status));
}

/** Distinct live session ids (active/in_progress), optionally scoped to a workspace. */
function activeSessionIds(filters) {
  filters = filters || {};
  return [...new Set(listLiveRuns({ workspace: filters.workspace, worktreePath: filters.worktreePath }).map((r) => r.sessionId))];
}

/** Find a run for a session (prefers the live/active one). */
function getRunBySession(sessionId, workspace, worktreePath) {
  const entries = listRuns({ workspace, worktreePath });
  const live = entries.find((e) => e.sessionId === sessionId && e.status === "active");
  const any = entries.find((e) => e.sessionId === sessionId);
  return live || any || null;
}

/** True when a run's heartbeat is older than threshold (default 5 min). */
function isStale(run, thresholdMs) {
  if (!run) return false;
  const thresh = thresholdMs || DEFAULT_STALL_THRESHOLD_MS;
  const at = run.lastHeartbeat ? Date.parse(run.lastHeartbeat) : Date.parse(run.startedAt);
  if (Number.isNaN(at)) return true;
  return Date.now() - at > thresh;
}

/** Return all live runs whose heartbeat is stale. */
function findStale(thresholdMs, worktreePath) {
  return listRuns({ status: "active", worktreePath }).filter((entry) => isStale(entry, thresholdMs));
}

/** Mark a run completed with an optional summary. */
function completeRun(run, summary, worktreePath) {
  run.status = "completed";
  run.completedAt = new Date().toISOString();
  if (summary !== undefined) run.summary = summary;
  saveRun(run, worktreePath);
  return run;
}

/** Mark a run failed with a reason. */
function failRun(run, reason, worktreePath) {
  run.status = "failed";
  run.failReason = reason || null;
  run.completedAt = new Date().toISOString();
  saveRun(run, worktreePath);
  return run;
}

/** Garbage-collect stale runs; delete their files when `deleteFiles` is set. */
function gcRuns(opts) {
  opts = opts || {};
  const worktreePath = opts.worktreePath;
  const index = loadIndex(worktreePath);
  const pruned = [];
  for (const key of Object.keys(index.runs)) {
    const entry = index.runs[key];
    if (entry.status !== "active") continue;
    if (!isStale(entry, opts.staleMs || DEFAULT_STALL_THRESHOLD_MS)) continue;
    const filePath = resolveRunPath({ ...entry, worktreePath });
    if (opts.deleteFiles) {
      fs.rmSync(filePath, { force: true });
    } else {
      try {
        const raw = fs.readFileSync(filePath, "utf8");
        const run = JSON.parse(raw);
        run.status = "stalled";
        run.lastHeartbeat = new Date().toISOString();
        atomicWrite(filePath, JSON.stringify(run, null, 2));
      } catch {
        fs.rmSync(filePath, { force: true });
      }
    }
    delete index.runs[key];
    pruned.push(key);
  }
  if (pruned.length) writeIndex(index, worktreePath);
  return pruned;
}

module.exports = {
  INDEX_VERSION,
  INDEX_NAME,
  DEFAULT_STALL_THRESHOLD_MS,
  DEFAULT_SESSION_STATE,
  getConductorBaseDir,
  getLegacyStatePath,
  resolveWorkspace,
  resolveSessionId,
  resolveTaskId,
  loadIndex,
  writeIndex,
  readRun,
  saveRun,
  beginRun,
  heartbeat,
  listRuns,
  listLiveRuns,
  isLiveStatus,
  activeSessionIds,
  getRunBySession,
  isStale,
  findStale,
  completeRun,
  failRun,
  gcRuns,
  migrateLegacy,
};
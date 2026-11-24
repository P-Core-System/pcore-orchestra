"use strict";

/**
 * HOD completion reports (commit-discipline evidence) — SQLite-primary with
 * safe-write JSON fallback.
 *
 * Completion reports live in the `done_reports` table partitioned by
 * `project_slug`. When SQLite is unavailable, falls back to `team-done.json`
 * via safe-write.js.
 *
 * Rows are append-only ({ id, member, team, sha, branch, summary,
 * reportedAt }) — never rewritten in place. `isHexSha` guards the SHA shape
 * (7..40 hex chars).
 */

const path = require("node:path");
const os = require("node:os");
const { getDb, resolveProjectSlug } = require("./session-store.js");
const { withLock, readJsonSafe, writeJson, resolveStateDir } = require("./safe-write.js");

const DONE_FILE = "team-done.json";
const DONE_CAP = 500;

let _seq = 0;

function defaultStateDir() {
  return path.join(os.homedir(), ".config", "opencode", "hooks", "state");
}

function resolveStateDir_() {
  const dir = process.env.PCORE_STATE_DIR;
  if (dir && typeof dir === "string" && dir.length > 0) return dir;
  return defaultStateDir();
}

function doneFile() {
  return path.join(resolveStateDir_(), DONE_FILE);
}

function isHexSha(sha) {
  return typeof sha === "string" && /^[0-9a-f]{7,40}$/i.test(sha.trim());
}

function defaults() {
  return { version: 1, updated_at: null, reports: [] };
}

function loadDone() {
  const parsed = readJsonSafe(doneFile(), defaults());
  if (!parsed || typeof parsed !== "object") return defaults();
  if (!Array.isArray(parsed.reports)) parsed.reports = [];
  return parsed;
}

/**
 * Record a completion report. SQLite-primary, safe-write fallback.
 * Returns { ok:true, report } or { ok:false, code } for a missing member /
 * malformed SHA.
 */
function recordDone(fields) {
  const f = fields || {};
  const member = String(f.member || "").trim();
  if (!member) return { ok: false, code: "DONE_NO_MEMBER" };
  if (!isHexSha(f.sha || "")) return { ok: false, code: "DONE_BAD_SHA" };
  const projectSlug = resolveProjectSlug(f.workspace);
  _seq += 1;
  const now = new Date().toISOString();
  const row = {
    id: `done_${Date.now().toString(36)}${_seq.toString(36)}`,
    member,
    team: String(f.team || "solo"),
    sha: String(f.sha).trim(),
    branch: String(f.branch || ""),
    summary: String(f.summary || ""),
    reportedAt: now,
    projectSlug,
  };

  const db = getDb();
  if (db) {
    try {
      db.prepare(`
        INSERT INTO done_reports (
          id, project_slug, member, team, sha, branch, summary, reported_at
        ) VALUES (
          @id, @projectSlug, @member, @team, @sha, @branch, @summary, @reportedAt
        )
      `).run({
        id: row.id, projectSlug: row.projectSlug, member: row.member, team: row.team,
        sha: row.sha, branch: row.branch, summary: row.summary, reportedAt: row.reportedAt,
      });
      // Enforce cap per project
      pruneCapSqlite(db, row.projectSlug);
      return { ok: true, report: row };
    } catch {
      /* fall through to JSON fallback */
    }
  }

  // JSON fallback
  let stored = null;
  withLock(doneFile(), () => {
    const cur = loadDone();
    cur.reports.push(row);
    while (cur.reports.length > DONE_CAP) cur.reports.shift();
    cur.updated_at = now;
    writeJson(doneFile(), cur);
    stored = row;
    // Fail-open: done.reported event feeds the live WS stream
    try {
      const dm = require("./domain/index.js");
      if (dm && typeof dm.recordDoneOutcome === "function") {
        dm.recordDoneOutcome(row, "reported");
      }
    } catch { /* fail-open */ }
  });
  return { ok: true, report: row };
}

function pruneCapSqlite(db, projectSlug) {
  const rows = db.prepare(`SELECT id, reported_at FROM done_reports WHERE project_slug = @projectSlug ORDER BY reported_at DESC`)
    .all({ projectSlug });
  if (rows.length > DONE_CAP) {
    for (const r of rows.slice(DONE_CAP)) {
      db.prepare(`DELETE FROM done_reports WHERE id = @id AND project_slug = @projectSlug`).run({ id: r.id, projectSlug });
    }
  }
}

/** Latest report per member (for the HOD sweep / release decision). */
function latestByMember(opts) {
  const o = opts || {};
  const projectSlug = resolveProjectSlug(o && o.workspace ? o.workspace : undefined);
  const db = getDb();
  if (db) {
    const rows = db.prepare(`
      SELECT * FROM done_reports WHERE project_slug = @projectSlug
      ORDER BY reported_at DESC
    `).all({ projectSlug });
    const out = {};
    for (const r of rows) {
      if (!r || !r.member) continue;
      if (!out[r.member]) out[r.member] = doneRowToRecord(r);
    }
    return out;
  }
  const cur = loadDone();
  const out = {};
  for (const r of cur.reports) {
    if (r && r.member) out[r.member] = r;
  }
  return out;
}

/** List all completion reports, newest first. */
function listDone(opts) {
  const o = opts || {};
  const projectSlug = resolveProjectSlug(o && o.workspace ? o.workspace : undefined);
  const db = getDb();
  if (db) {
    const rows = db.prepare(`
      SELECT * FROM done_reports WHERE project_slug = @projectSlug
      ORDER BY reported_at DESC
    `).all({ projectSlug });
    return rows.map((r) => doneRowToRecord(r)).filter(Boolean);
  }
  const cur = loadDone();
  return [...cur.reports].reverse();
}

function doneRowToRecord(rec) {
  if (!rec) return null;
  return {
    id: rec.id, member: rec.member, team: rec.team, sha: rec.sha,
    branch: rec.branch, summary: rec.summary, reportedAt: rec.reported_at,
    projectSlug: rec.project_slug,
  };
}

module.exports = {
  DONE_FILE, DONE_CAP, doneFile, isHexSha,
  recordDone, latestByMember, listDone, loadDone,
  /** Backward-compatible alias: report(dir, fields) -> recordDone(fields). */
  report: function(dir, fields) {
    return recordDone(fields || {});
  },
};

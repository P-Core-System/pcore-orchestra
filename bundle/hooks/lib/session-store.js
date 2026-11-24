"use strict";

/**
 * SQLite-backed team session storage for pcore-orchestra.
 *
 * Provides a shared SQLite database at <PCORE_STATE_DIR>/team-sessions.db
 * with tables partitioned by project_slug: teams, members, claims,
 * discussions, wakes, done_reports.
 *
 * Works across CLIs (Cursor, OpenCode, Qoder, Claude, Codex) and is scoped
 * per project via `project_slug` on every table.
 *
 * Fail-open: if `node:sqlite` is unavailable or the DB cannot be opened,
 * `isAvailable()` returns false and callers fall back to the safe-write
 * JSON modules. All errors are caught; this module never throws.
 *
 * Concurrency is handled by SQLite itself (WAL journal mode) — no advisory
 * file locks needed here (invariant 15 satisfied by the fallback modules
 * which use safe-write.js when SQLite is unavailable).
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

let sqlite = null;
let loadErr = null;
try {
  sqlite = require("node:sqlite");
} catch (err) {
  loadErr = err;
}

let db = null;
let dbReady = false;
let dbPathCached = null;

/** Default shared state dir (alongside other state writers). */
function defaultStateDir() {
  return path.join(os.homedir(), ".config", "opencode", "hooks", "state");
}

/** Resolved state dir: PCORE_STATE_DIR wins, never inside the bundle. */
function resolveStateDir() {
  const dir = process.env.PCORE_STATE_DIR;
  if (dir && typeof dir === "string" && dir.length > 0) return dir;
  return defaultStateDir();
}

/** Default DB path: <PCORE_STATE_DIR>/team-sessions.db */
function getDbPath() {
  return path.join(resolveStateDir(), "team-sessions.db");
}

/** True when `node:sqlite` loaded and a DB handle could be opened. */
function isAvailable() {
  return dbReady === true && db !== null;
}

/** Derive the project slug for partitioning. Prefers project.yaml
 *  project.slug, falls back to sanitized workspace basename. */
function resolveProjectSlug(workspace) {
  const root = workspace || process.env.PCORE_WORKSPACE_ROOT || process.cwd() || "root";
  try {
    const identity = require("./project-identity.js");
    const loaded = identity.loadProjectIdentity(root);
    if (loaded && loaded.project && loaded.project.slug) return loaded.project.slug;
  } catch {
    /* fall through to basename slug */
  }
  const base = path.basename(String(root));
  return base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "") || "root";
}

/** Lazy-open the SQLite DB and run schema. Never throws.
 * Honors PCORE_USE_SQLITE=0 to force JSON fallback. */
function getDb() {
  if (process.env.PCORE_USE_SQLITE === "0") return null;
  const dbPath = getDbPath();
  // State dir can change at runtime (PCORE_STATE_DIR in tests / scoped repos).
  // Reopen against the new path instead of serving stale data from the old DB.
  if (dbReady && dbPathCached === dbPath) return db;
  if (dbReady && dbPathCached !== dbPath) {
    try { if (db && typeof db.close === "function") db.close(); } catch { /* best effort */ }
    db = null;
    dbReady = false;
  }
  if (!sqlite) return null;
  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    db = new sqlite.DatabaseSync(dbPath);
    initDb(db);
    dbReady = true;
    dbPathCached = dbPath;
    return db;
  } catch (err) {
    db = null;
    dbReady = false;
    dbPathCached = null;
    return null;
  }
}

function initDb(db) {
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS teams (
      team_id TEXT NOT NULL,
      project_slug TEXT NOT NULL,
      team_display TEXT,
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (team_id, project_slug)
    );
    CREATE TABLE IF NOT EXISTS members (
      member_id TEXT NOT NULL,
      team_id TEXT NOT NULL,
      project_slug TEXT NOT NULL,
      member_display TEXT,
      role TEXT DEFAULT 'member',
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (member_id, project_slug)
    );
    CREATE TABLE IF NOT EXISTS claims (
      claim_key TEXT NOT NULL,
      project_slug TEXT NOT NULL,
      member TEXT NOT NULL,
      member_display TEXT,
      team TEXT NOT NULL,
      team_id TEXT,
      team_display TEXT,
      role TEXT DEFAULT 'member',
      scope TEXT,
      branch TEXT,
      session_id TEXT,
      workspace TEXT,
      workspace_slug TEXT,
      host TEXT,
      server_url TEXT,
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT '',
      heartbeat_at TEXT NOT NULL DEFAULT '',
      renewed INTEGER DEFAULT 0,
      stale INTEGER DEFAULT 0,
      PRIMARY KEY (claim_key, project_slug)
    );
    CREATE TABLE IF NOT EXISTS discussions (
      id TEXT NOT NULL,
      project_slug TEXT NOT NULL,
      kind TEXT NOT NULL,
      topology TEXT,
      from_claim TEXT NOT NULL,
      to_claim TEXT,
      team TEXT,
      topic TEXT,
      thread_id TEXT,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT '',
      resolved_at TEXT,
      resolved_by TEXT,
      reactions TEXT,
      PRIMARY KEY (id, project_slug)
    );
    CREATE TABLE IF NOT EXISTS wakes (
      id TEXT NOT NULL,
      project_slug TEXT NOT NULL,
      from_claim TEXT NOT NULL,
      to_claim TEXT NOT NULL,
      from_member TEXT,
      to_member TEXT,
      team TEXT,
      topic TEXT,
      thread_id TEXT,
      message_id TEXT,
      topology TEXT,
      reason TEXT,
      workspace_slug TEXT,
      status TEXT NOT NULL DEFAULT 'delivered',
      created_at TEXT NOT NULL DEFAULT '',
      acked_at TEXT,
      acked_by TEXT,
      PRIMARY KEY (id, project_slug)
    );
    CREATE TABLE IF NOT EXISTS done_reports (
      id TEXT NOT NULL,
      project_slug TEXT NOT NULL,
      member TEXT NOT NULL,
      team TEXT NOT NULL,
      sha TEXT NOT NULL,
      branch TEXT,
      summary TEXT,
      reported_at TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (id, project_slug)
    );
    CREATE TABLE IF NOT EXISTS activations (
      dedupe_key TEXT NOT NULL,
      event_kind TEXT NOT NULL,
      event_id TEXT NOT NULL,
      recipient_claim TEXT NOT NULL,
      recipient_member TEXT,
      session_id TEXT,
      server_url TEXT,
      project_slug TEXT NOT NULL,
      status TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (dedupe_key)
    );
    CREATE INDEX IF NOT EXISTS idx_claims_project ON claims(project_slug);
    CREATE INDEX IF NOT EXISTS idx_claims_member_team ON claims(member, team, project_slug);
    CREATE INDEX IF NOT EXISTS idx_claims_workspace ON claims(workspace_slug, project_slug);
    CREATE INDEX IF NOT EXISTS idx_claims_heartbeat ON claims(heartbeat_at);
    CREATE INDEX IF NOT EXISTS idx_discussions_project ON discussions(project_slug);
    CREATE INDEX IF NOT EXISTS idx_discussions_team ON discussions(team, project_slug);
    CREATE INDEX IF NOT EXISTS idx_discussions_created ON discussions(created_at);
    CREATE INDEX IF NOT EXISTS idx_wakes_project ON wakes(project_slug);
    CREATE INDEX IF NOT EXISTS idx_wakes_from ON wakes(from_claim, project_slug);
    CREATE INDEX IF NOT EXISTS idx_wakes_to ON wakes(to_claim, project_slug);
    CREATE INDEX IF NOT EXISTS idx_wakes_status ON wakes(status, project_slug);
    CREATE INDEX IF NOT EXISTS idx_done_project ON done_reports(project_slug);
    CREATE INDEX IF NOT EXISTS idx_done_member ON done_reports(member, project_slug);
    CREATE INDEX IF NOT EXISTS idx_done_reported ON done_reports(reported_at);
    CREATE INDEX IF NOT EXISTS idx_activations_project ON activations(project_slug);
    CREATE INDEX IF NOT EXISTS idx_activations_event ON activations(event_kind, event_id);
    CREATE INDEX IF NOT EXISTS idx_activations_recipient ON activations(recipient_claim);
    CREATE INDEX IF NOT EXISTS idx_activations_created ON activations(created_at);
  `);
  migrateSchema(db);
}

/** Add columns introduced after the first release (idempotent, fail-open). */
function migrateSchema(db) {
  try {
    db.exec("ALTER TABLE claims ADD COLUMN server_url TEXT");
  } catch {
    // Duplicate-column is the expected result on an already migrated DB.
    // Any other failure is ignored too: downstream fall back to JSON.
  }
}

/** Close the DB handle (mainly for tests). */
function closeDb() {
  if (db) {
    try { db.close(); } catch { /* best effort */ }
    db = null;
    dbReady = false;
  }
}

module.exports = {
  defaultStateDir,
  resolveStateDir,
  getDbPath,
  isAvailable,
  getDb,
  closeDb,
  initDb,
  resolveProjectSlug,
  sqlite,
  loadErr,
};

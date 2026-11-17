"use strict";

const os = require("node:os");
const path = require("node:path");
const { resolveStateDir } = require("./safe-write.js");

let db = null;
let probed = false;
const DB_NAME = "team-sessions.db";

function resolveStateDir() {
  const def = path.join(os.homedir(), ".config", "opencode", "hooks", "state");
  return resolveStateDir ? resolveStateDir(def) : def;
}
function getDbPath() { return path.join(resolveStateDir(), DB_NAME); }
function resolveProjectSlug(workspaceRoot) {
  if (!workspaceRoot || typeof workspaceRoot !== "string") return null;
  try {
    const identity = require("./project-identity.js");
    if (!identity || typeof identity.loadProjectIdentity !== "function") return null;
    const loaded = identity.loadProjectIdentity(workspaceRoot);
    const slug = loaded && loaded.project && loaded.project.slug;
    return typeof slug === "string" && slug ? slug : null;
  } catch { return null; }
}
function sanitizeSlug(raw) {
  if (raw === undefined || raw === null) return "";
  return String(raw).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
}
function initDb() {
  if (db) return db;
  try {
    const { DatabaseSync } = require("node:sqlite");
    const dbPath = getDbPath();
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    db = new DatabaseSync(dbPath);
    db.exec(schemaDdl());
    probed = true;
    return db;
  } catch {
    db = null;
    probed = true;
    return null;
  }
}
function isAvailable() { return db !== null || initDb() !== null; }
function schemaDdl() {
  return [
    "CREATE TABLE IF NOT EXISTS teams (id TEXT PRIMARY KEY, project_slug TEXT NOT NULL, team_id TEXT NOT NULL, team_display TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);",
    "CREATE INDEX IF NOT EXISTS idx_teams_project ON teams(project_slug);",
    "CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, project_slug TEXT NOT NULL, team_id TEXT NOT NULL, member_key TEXT NOT NULL, member_display TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT 'member', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);",
    "CREATE INDEX IF NOT EXISTS idx_members_project ON members(project_slug);",
    "CREATE INDEX IF NOT EXISTS idx_members_team_member ON members(project_slug, team_id, member_key);",
    "CREATE TABLE IF NOT EXISTS claims (id TEXT PRIMARY KEY, project_slug TEXT NOT NULL, claim_key TEXT NOT NULL UNIQUE, member_key TEXT NOT NULL, team_id TEXT NOT NULL, workspace_slug TEXT NOT NULL DEFAULT 'root', session_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', scope TEXT NOT NULL DEFAULT '[]', branch TEXT NOT NULL DEFAULT '', workspace TEXT NOT NULL DEFAULT '', host TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, heartbeat_at TEXT NOT NULL, renewed INTEGER NOT NULL DEFAULT 0);",
    "CREATE INDEX IF NOT EXISTS idx_claims_project ON claims(project_slug);",
    "CREATE INDEX IF NOT EXISTS idx_claims_member_team ON claims(project_slug, member_key, team_id);",
    "CREATE TABLE IF NOT EXISTS discussions (id TEXT PRIMARY KEY, project_slug TEXT NOT NULL, kind TEXT NOT NULL, topology TEXT NOT NULL, from_claim TEXT NOT NULL, to_claim TEXT, team_id TEXT, topic TEXT, thread_id TEXT, body TEXT NOT NULL, created_at TEXT NOT NULL, resolved_at TEXT, resolved_by TEXT, reactions TEXT NOT NULL DEFAULT '[]');",
    "CREATE INDEX IF NOT EXISTS idx_discussions_project ON discussions(project_slug);",
    "CREATE INDEX IF NOT EXISTS idx_discussions_thread ON discussions(project_slug, thread_id);",
    "CREATE TABLE IF NOT EXISTS wakes (id TEXT PRIMARY KEY, project_slug TEXT NOT NULL, from_claim TEXT NOT NULL, to_claim TEXT NOT NULL, from_member TEXT NOT NULL, to_member TEXT NOT NULL, team_id TEXT NOT NULL, topic TEXT, thread_id TEXT, message_id TEXT, topology TEXT, reason TEXT NOT NULL DEFAULT 'nudge', status TEXT NOT NULL DEFAULT 'delivered', workspace_slug TEXT, created_at TEXT NOT NULL, acked_at TEXT, acked_by TEXT);",
    "CREATE INDEX IF NOT EXISTS idx_wakes_project ON wakes(project_slug);",
    "CREATE INDEX IF NOT EXISTS idx_wakes_from_to ON wakes(project_slug, from_claim, to_claim);",
    "CREATE TABLE IF NOT EXISTS done_reports (id TEXT PRIMARY KEY, project_slug TEXT NOT NULL, member TEXT NOT NULL, team TEXT NOT NULL, sha TEXT NOT NULL, branch TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '', reported_at TEXT NOT NULL);",
    "CREATE INDEX IF NOT EXISTS idx_done_project ON done_reports(project_slug);",
    "CREATE INDEX IF NOT EXISTS idx_done_member ON done_reports(project_slug, member);",
  ].join("\n");
}
const fs = require("node:fs");
module.exports = { DB_NAME, resolveStateDir, getDbPath, resolveProjectSlug, sanitizeSlug, initDb, isAvailable };

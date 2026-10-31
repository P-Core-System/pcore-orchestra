"use strict";

/**
 * Local SQLite store for the MCP knowledge hub.
 *
 * Backs the write side of the knowledge tools (previously a single
 * `knowledge-inbox.json` that grew unbounded and had no locking), plus the
 * new chat-thread / project-pairing surface. One database per user at
 * `~/.pcore/state/knowledge.db`, rows partitioned by `project.slug`, so an
 * MCP connector serving project A never reads project B's threads.
 *
 * `node:sqlite` is loaded lazily and every call degrades gracefully — an
 * unavailable driver (Node < 22.5) or a locked/failed open falls back to the
 * legacy JSON inbox for the knowledge table rather than throwing. Chat and
 * pairing are DB-only: with no database they report unavailable instead of
 * silently dropping messages.
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { resolveStateDir, readJsonSafe, writeJson } = require("./safe-write.js");
const { loadProjectIdentity } = require("./project-identity.js");

const STATE_DIR = () => resolveStateDir(path.join(os.homedir(), ".pcore", "state"));
const DB_PATH = () => path.join(STATE_DIR(), "knowledge.db");
const LEGACY_INBOX = () => path.join(STATE_DIR(), "knowledge-inbox.json");

const LIST_CAP = 200;

let handle = null;
let opened = false;

function dbDisabled() {
  return process.env.PCORE_KNOWLEDGE_DISABLE === "1";
}

function dbPath() {
  return DB_PATH();
}

function openDb() {
  if (opened) return handle;
  opened = true;
  if (dbDisabled()) return null;
  try {
    const target = DB_PATH();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const { DatabaseSync } = require("node:sqlite");
    handle = new DatabaseSync(target);
    try {
      handle.prepare("PRAGMA journal_mode = WAL").run();
    } catch {
      /* WAL unsupported on this build — default journal is fine */
    }
    handle
      .prepare(
        "CREATE TABLE IF NOT EXISTS knowledge (" +
          "id TEXT PRIMARY KEY, project TEXT NOT NULL DEFAULT 'default', ts TEXT NOT NULL, " +
          "title TEXT NOT NULL, body TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', " +
          "source TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending')"
      )
      .run();
    handle.prepare("CREATE INDEX IF NOT EXISTS idx_knowledge_status ON knowledge(status)").run();
    handle.prepare("CREATE INDEX IF NOT EXISTS idx_knowledge_project ON knowledge(project)").run();
    handle.prepare("CREATE INDEX IF NOT EXISTS idx_knowledge_ts ON knowledge(ts)").run();
    handle
      .prepare(
        "CREATE TABLE IF NOT EXISTS chat_threads (" +
          "id TEXT PRIMARY KEY, project TEXT NOT NULL DEFAULT 'default', title TEXT NOT NULL DEFAULT '', " +
          "status TEXT NOT NULL DEFAULT 'open', created_ts TEXT NOT NULL, updated_ts TEXT NOT NULL)"
      )
      .run();
    handle
      .prepare(
        "CREATE TABLE IF NOT EXISTS chat_messages (" +
          "id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, seq INTEGER NOT NULL, role TEXT NOT NULL, " +
          "author TEXT NOT NULL DEFAULT '', content TEXT NOT NULL, ts TEXT NOT NULL)"
      )
      .run();
    handle.prepare("CREATE INDEX IF NOT EXISTS idx_messages_thread ON chat_messages(thread_id, seq)").run();
    handle
      .prepare(
        "CREATE TABLE IF NOT EXISTS pairs (" +
          "project TEXT NOT NULL, external_kind TEXT NOT NULL, external_id TEXT NOT NULL, " +
          "thread_id TEXT NOT NULL, created_ts TEXT NOT NULL, PRIMARY KEY (external_kind, external_id))"
      )
      .run();
    handle.prepare("CREATE INDEX IF NOT EXISTS idx_pairs_project ON pairs(project)").run();
  } catch {
    handle = null;
  }
  return handle;
}

function dbAvailable() {
  return openDb() !== null;
}

/** The project slug an MCP request is operating under (PCORE_MCP_ROOT). */
function projectKey() {
  try {
    const root = process.env.PCORE_MCP_ROOT || process.cwd();
    const identity = loadProjectIdentity(root);
    const slug = identity && identity.project && identity.project.slug;
    return typeof slug === "string" && slug ? slug : "default";
  } catch {
    return "default";
  }
}

function id(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ────────────────────────────── knowledge ──────────────────────────────

/**
 * One-time import of the legacy JSON inbox into the table. Runs whenever the
 * table is empty and a JSON file with entries exists. Never deletes the JSON
 * file — the caller keeps it as a forensic record.
 */
function migrateLegacyInbox(db, project) {
  let entries;
  try {
    const raw = readJsonSafe(LEGACY_INBOX(), null);
    entries = raw && Array.isArray(raw.entries) ? raw.entries : null;
  } catch {
    return 0;
  }
  if (!entries || entries.length === 0) return 0;
  const count = Number(db.prepare("SELECT COUNT(*) AS c FROM knowledge").get().c);
  if (count > 0) return 0;
  const ins = db.prepare(
    "INSERT OR IGNORE INTO knowledge (id, project, ts, title, body, tags, source, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );
  let added = 0;
  for (const e of entries) {
    if (!e || !e.id) continue;
    ins.run(
      String(e.id),
      project,
      String(e.ts || ""),
      String(e.title || ""),
      String(e.body || ""),
      JSON.stringify(Array.isArray(e.tags) ? e.tags : []),
      String(e.source || "legacy-import"),
      String(e.status || "pending")
    );
    added += 1;
  }
  return added;
}

function legacySharePath() {
  return LEGACY_INBOX();
}

/** Append a knowledge entry. Returns { id, status, store }. */
function insertKnowledge({ title, body, tags, source, status, project } = {}) {
  const entry = {
    id: id("kb"),
    project: project || projectKey(),
    ts: new Date().toISOString(),
    title: String(title).slice(0, 200),
    body: String(body).slice(0, 8000),
    tags: Array.isArray(tags) ? tags.map(String).slice(0, 10) : [],
    source: String(source || "mcp-client").slice(0, 80),
    status: status || "pending",
  };
  const db = openDb();
  if (db) {
    migrateLegacyInbox(db, projectKey());
    db.prepare(
      "INSERT INTO knowledge (id, project, ts, title, body, tags, source, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(entry.id, entry.project, entry.ts, entry.title, entry.body, JSON.stringify(entry.tags), entry.source, entry.status);
    return { ...entry, store: "sqlite" };
  }
  // JSON fallback — matches the pre-SQLite inbox shape and cap behavior.
  const inbox = readJsonSafe(legacySharePath(), { entries: [] }) || { entries: [] };
  if (!Array.isArray(inbox.entries)) inbox.entries = [];
  inbox.entries.push(entry);
  writeJson(legacySharePath(), inbox);
  return { ...entry, store: "json" };
}

/** List knowledge, newest last (stable for `.slice(-N)` consumers). */
function queryKnowledge({ status, project, limit = LIST_CAP } = {}) {
  const cap = Math.max(1, Math.min(Number(limit) || LIST_CAP, LIST_CAP));
  const db = openDb();
  if (db) {
    migrateLegacyInbox(db, projectKey());
    const wantedProject = project || projectKey();
    const rows = status
      ? db
          .prepare("SELECT * FROM knowledge WHERE project = ? AND status = ? ORDER BY ts ASC LIMIT ?")
          .all(wantedProject, status, cap)
      : db.prepare("SELECT * FROM knowledge WHERE project = ? ORDER BY ts ASC LIMIT ?").all(wantedProject, cap);
    return rows.map(rowToKnowledge);
  }
  const inbox = readJsonSafe(legacySharePath(), { entries: [] }) || { entries: [] };
  const entries = Array.isArray(inbox.entries) ? inbox.entries : [];
  const filtered = status ? entries.filter((e) => e.status === status) : entries;
  return filtered.slice(-cap);
}

function rowToKnowledge(r) {
  let tags = [];
  try {
    tags = JSON.parse(r.tags || "[]");
  } catch {
    tags = [];
  }
  return {
    id: r.id,
    project: r.project,
    ts: r.ts,
    title: r.title,
    body: r.body,
    tags: Array.isArray(tags) ? tags : [],
    source: r.source,
    status: r.status,
  };
}

/**
 * Promote/demote an entry (pending → approved|rejected|applied). This is the
 * consumer the old inbox lacked: a human or an orchestra phase marks reviewed
 * knowledge, and the local CLI pulls `approved`/`applied` rows back. Returns
 * the updated entry, or null when it is missing or the DB is unavailable.
 */
function setKnowledgeStatus(entryId, status) {
  const db = openDb();
  if (!db) return null;
  const info = db.prepare("UPDATE knowledge SET status = ? WHERE id = ?").run(status, entryId);
  if (!info || info.changes === 0) return null;
  const row = db.prepare("SELECT * FROM knowledge WHERE id = ?").get(entryId);
  return row ? rowToKnowledge(row) : null;
}

// ────────────────────────────── chat threads ──────────────────────────────

function createThread({ title, project, externalKind, externalId } = {}) {
  const db = openDb();
  if (!db) return null;
  const now = new Date().toISOString();
  const thread = {
    id: id("th"),
    project: project || projectKey(),
    title: String(title || "").slice(0, 200),
    status: "open",
    created_ts: now,
    updated_ts: now,
  };
  db.prepare("INSERT INTO chat_threads (id, project, title, status, created_ts, updated_ts) VALUES (?, ?, ?, ?, ?, ?)").run(
    thread.id,
    thread.project,
    thread.title,
    thread.status,
    thread.created_ts,
    thread.updated_ts
  );
  if (externalKind && externalId) {
    upsertPair({ externalKind, externalId, threadId: thread.id, project: thread.project });
  }
  return thread;
}

function addMessage({ threadId, role, content, author } = {}) {
  const db = openDb();
  if (!db) return null;
  const thread = db.prepare("SELECT * FROM chat_threads WHERE id = ?").get(threadId);
  if (!thread) return null;
  const now = new Date().toISOString();
  const next = Number(db.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS s FROM chat_messages WHERE thread_id = ?").get(threadId).s);
  const msg = {
    id: id("msg"),
    thread_id: threadId,
    seq: next,
    role: String(role || "assistant"),
    author: String(author || "").slice(0, 80),
    content: String(content || "").slice(0, 32000),
    ts: now,
  };
  db.prepare("INSERT INTO chat_messages (id, thread_id, seq, role, author, content, ts) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    msg.id,
    msg.thread_id,
    msg.seq,
    msg.role,
    msg.author,
    msg.content,
    msg.ts
  );
  db.prepare("UPDATE chat_threads SET updated_ts = ? WHERE id = ?").run(now, threadId);
  return msg;
}

function getThread(threadId, { messageLimit = 100 } = {}) {
  const db = openDb();
  if (!db) return null;
  const thread = db.prepare("SELECT * FROM chat_threads WHERE id = ?").get(threadId);
  if (!thread) return null;
  const cap = Math.max(1, Math.min(Number(messageLimit) || 100, 500));
  const messages = db
    .prepare("SELECT * FROM chat_messages WHERE thread_id = ? ORDER BY seq ASC LIMIT ?")
    .all(threadId, cap)
    .map((m) => ({ id: m.id, seq: m.seq, role: m.role, author: m.author, content: m.content, ts: m.ts }));
  return { ...thread, messages };
}

function listThreads({ project, status, limit = 50 } = {}) {
  const db = openDb();
  if (!db) return [];
  const cap = Math.max(1, Math.min(Number(limit) || 50, 200));
  const wantedProject = project || projectKey();
  const rows = status
    ? db
        .prepare("SELECT * FROM chat_threads WHERE project = ? AND status = ? ORDER BY updated_ts DESC LIMIT ?")
        .all(wantedProject, status, cap)
    : db.prepare("SELECT * FROM chat_threads WHERE project = ? ORDER BY updated_ts DESC LIMIT ?").all(wantedProject, cap);
  return rows.map((r) => ({ ...r }));
}

// ────────────────────────────── pairing ──────────────────────────────

function upsertPair({ externalKind, externalId, threadId, project } = {}) {
  const db = openDb();
  if (!db) return null;
  const kind = String(externalKind || "chatgpt").slice(0, 40);
  const extId = String(externalId || "").slice(0, 200);
  if (!extId || !threadId) return null;
  db.prepare(
    "INSERT INTO pairs (project, external_kind, external_id, thread_id, created_ts) VALUES (?, ?, ?, ?, ?) " +
      "ON CONFLICT(external_kind, external_id) DO UPDATE SET thread_id = excluded.thread_id, project = excluded.project"
  ).run(project || projectKey(), kind, extId, threadId, new Date().toISOString());
  return getPair({ externalKind: kind, externalId: extId });
}

function getPair({ externalKind, externalId } = {}) {
  const db = openDb();
  if (!db) return null;
  const row = db
    .prepare("SELECT * FROM pairs WHERE external_kind = ? AND external_id = ?")
    .get(String(externalKind || "chatgpt"), String(externalId || ""));
  return row ? { ...row } : null;
}

function listPairs({ project } = {}) {
  const db = openDb();
  if (!db) return [];
  const wantedProject = project || projectKey();
  return db.prepare("SELECT * FROM pairs WHERE project = ? ORDER BY created_ts DESC").all(wantedProject).map((r) => ({ ...r }));
}

module.exports = {
  DB_PATH,
  dbPath,
  dbAvailable,
  projectKey,
  // knowledge
  insertKnowledge,
  queryKnowledge,
  setKnowledgeStatus,
  // chat
  createThread,
  addMessage,
  getThread,
  listThreads,
  // pairing
  upsertPair,
  getPair,
  listPairs,
};

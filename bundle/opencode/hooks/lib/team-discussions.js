"use strict";

/**
 * Team discussion storage with SQLite backend, safe-write JSON fallback.
 *
 * A message store for cross-CLI team chatter: leader->member, member->leader,
 * peer-to-peer, and group broadcasts. Authors are claim keys
 * (team/member/slug/sessionId from team-claims.js) so every message is
 * attributable to a live slot.
 *
 * SQLite-primary: messages live in the `discussions` table partitioned by
 * `project_slug`. Safe-write JSON fallback delegates to `team-discussion.js`.
 */

const { getDb, resolveProjectSlug } = require("./session-store.js");
const discussionLib = require("./team-discussion.js");
const { activateEvent } = require("./team-activation.js");

/** Directional message kinds. */
const DISCUSSION_KINDS = Object.freeze(["m2m", "l2m", "m2l", "l2l", "group"]);

/** Topology names for the list filter. */
const DISCUSSION_TOPOLOGIES = Object.freeze(["2way", "star", "group", "all"]);

/** kind -> topology. */
const KIND_TOPOLOGY = Object.freeze({
  m2m: "2way",
  l2l: "2way",
  l2m: "star",
  m2l: "star",
  group: "group",
});

/** Ring cap for discussion rows per project (oldest trimmed first). */
const DISCUSSION_CAP = 500;

/** Lowercase slug form. */
function sanitizeDiscussionToken(raw) {
  if (raw === undefined || raw === null) return "";
  return String(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isDiscussionKind(kind) {
  return DISCUSSION_KINDS.indexOf(kind) !== -1;
}

function topologyOf(kind) {
  return Object.prototype.hasOwnProperty.call(KIND_TOPOLOGY, kind) ? KIND_TOPOLOGY[kind] : null;
}

/** Sortable message id: `d_<time36><seq><rand>`. */
let _seq = 0;
function newDiscussionId() {
  _seq += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `d_${Date.now().toString(36)}${_seq.toString(36)}${rand}`;
}

/**
 * Build (but do not store) a message record. Pure: no fs, no clock beyond
 * the timestamps it stamps. Throws on unknown kind or empty body/from.
 */
function buildMessage(input) {
  const o = input || {};
  const kind = String(o.kind || "m2m");
  if (!isDiscussionKind(kind)) throw new Error(`team-discussions: unknown kind '${o.kind}'`);
  const from = String(o.from || "");
  if (!from) throw new Error("team-discussions: post needs a claim-key author");
  const body = String(o.body || "");
  if (!body.trim()) throw new Error("team-discussions: post needs a non-empty body");
  const now = new Date().toISOString();
  return {
    id: typeof o.id === "string" && o.id ? o.id : newDiscussionId(),
    kind,
    topology: topologyOf(kind),
    from,
    to: o.to === undefined || o.to === null ? null : String(o.to),
    team: o.team === undefined || o.team === null ? null : String(o.team),
    topic: typeof o.topic === "string" ? o.topic : null,
    threadId: typeof o.threadId === "string" && o.threadId ? o.threadId : (typeof o.topic === "string" && o.topic ? o.topic : null),
    body,
    createdAt: now,
    resolvedAt: null,
    resolvedBy: null,
    reactions: [],
    projectSlug: typeof o.projectSlug === "string" ? o.projectSlug : null,
  };
}

/** Match a message against a filter (see listMessages filter fields). */
function matchMessageFilter(msg, filter) {
  if (!msg || typeof msg !== "object") return false;
  const f = filter && typeof filter === "object" ? filter : {};
  const kinds = Array.isArray(f.kinds) ? f.kinds : (typeof f.kind === "string" && f.kind ? [f.kind] : null);
  if (kinds && kinds.indexOf(msg.kind) === -1) return false;
  const topology = typeof f.topology === "string" ? f.topology : "all";
  if (topology && topology !== "all" && topologyOf(msg.kind) !== topology) return false;
  if (typeof f.team === "string" && f.team && sanitizeDiscussionToken(f.team) !== sanitizeDiscussionToken(msg.team)) return false;
  if (typeof f.member === "string" && f.member) {
    if (msg.kind === "group") {
      if (typeof f.team === "string" && f.team &&
          sanitizeDiscussionToken(f.team) !== sanitizeDiscussionToken(msg.team)) return false;
    } else if ((msg.kind === "m2l" || msg.kind === "l2m") &&
        typeof f.team === "string" && f.team && msg.team &&
        sanitizeDiscussionToken(f.team) === sanitizeDiscussionToken(msg.team)) {
      // same-team star leg: visible to any member-filtered list of that team
    } else {
      const want = sanitizeDiscussionToken(f.member);
      const authorMember = String(msg.from || "").split("/")[1] || "";
      const hit = sanitizeDiscussionToken(authorMember) === want ||
        sanitizeDiscussionToken(msg.to) === want ||
        String(msg.to || "").split("/")[1] === want;
      if (!hit) return false;
    }
  }
  if (typeof f.topic === "string" && f.topic && String(msg.topic || "").indexOf(f.topic) === -1) return false;
  if (!f.includeResolved && msg.resolvedAt) return false;
  return true;
}

/* --- Public API ---------------------------------------------------------- */

/** Append one message. SQLite-primary, safe-write fallback. */
function postMessage(input, worktreePath) {
  if (input && typeof input === "object" && typeof input.worktreePath === "string" && worktreePath === undefined) {
    worktreePath = input.worktreePath;
  }
  const msg = buildMessage(input);
  msg.projectSlug = msg.projectSlug || resolveProjectSlug(input && input.workspace ? input.workspace : undefined);

  const db = getDb();
  let stored;
  if (db) {
    db.prepare(`
      INSERT INTO discussions (
        id, project_slug, kind, topology, from_claim, to_claim, team, topic,
        thread_id, body, created_at, resolved_at, resolved_by, reactions
      ) VALUES (
        @id, @projectSlug, @kind, @topology, @from, @to, @team, @topic,
        @threadId, @body, @createdAt, @resolvedAt, @resolvedBy, @reactions
      )
    `).run({
      id: msg.id, projectSlug: msg.projectSlug, kind: msg.kind, topology: msg.topology,
      from: msg.from, to: msg.to, team: msg.team, topic: msg.topic,
      threadId: msg.threadId, body: msg.body, createdAt: msg.createdAt,
      resolvedAt: msg.resolvedAt, resolvedBy: msg.resolvedBy,
      reactions: JSON.stringify(msg.reactions),
    });
    // Enforce ring cap per project
    pruneCapSqlite(db, msg.projectSlug);
    stored = msg;
  } else {
    stored = discussionLib.postMessage(input, worktreePath);
  }
  // Trigger only after the durable store succeeded. Fail-open by contract.
  // Claims are partitioned by project slug, so resolve the author's workspace
  // from its claim when the caller did not pass one explicitly.
  try {
    const authorClaim = require("./team-claims.js").getClaim(stored.from);
    activateEvent("post", stored, {
      workspace: (input && input.workspace) || (authorClaim && authorClaim.workspace) || undefined,
      worktreePath,
      senderSessionId: authorClaim && authorClaim.sessionId,
    });
  } catch { /* activation never breaks a discussion post */ }
  return stored;
}

function pruneCapSqlite(db, projectSlug) {
  const rows = db.prepare(`
    SELECT id, created_at FROM discussions WHERE project_slug = @projectSlug
    ORDER BY created_at DESC
  `).all({ projectSlug });
  if (rows.length > DISCUSSION_CAP) {
    const toDelete = rows.slice(DISCUSSION_CAP).map((r) => r.id);
    for (const id of toDelete) {
      db.prepare(`DELETE FROM discussions WHERE id = @id AND project_slug = @projectSlug`)
        .run({ id, projectSlug });
    }
  }
}

/** List messages matching a filter, oldest first. */
function listMessages(filter, worktreePath) {
  if (filter && typeof filter === "object" && typeof filter.worktreePath === "string" && worktreePath === undefined) {
    worktreePath = filter.worktreePath;
  }
  const projectSlug = resolveProjectSlug(filter && filter.workspace ? filter.workspace : undefined);
  const db = getDb();
  if (db) {
    let sql = `SELECT * FROM discussions WHERE project_slug = @projectSlug`;
    const params = { projectSlug };
    const clauses = [];
    if (typeof filter.kind === "string" && filter.kind) {
      clauses.push(`kind = @kind`); params.kind = filter.kind;
    }
    if (typeof filter.team === "string" && filter.team) {
      // Stored teams are sanitized claim tokens ("team-alpha"), while the
      // CLI accepts display names ("Team-Alpha"); the JSON fallback applies
      // the same sanitizer in matchMessageFilter. kind/topic stay raw so the
      // SQL branch matches the fallback's exact-kind / substring-topic rules.
      clauses.push(`team = @team`); params.team = sanitizeDiscussionToken(filter.team);
    }
    if (typeof filter.topic === "string" && filter.topic) {
      clauses.push(`topic LIKE @topic`); params.topic = `%${filter.topic}%`;
    }
    if (clauses.length > 0) sql += ` AND ` + clauses.join(` AND `);
    sql += ` ORDER BY created_at ASC`;
    const rows = db.prepare(sql).all(params);
    return rows.map((rec) => rowToMessage(rec)).filter((m) => matchMessageFilter(m, filter));
  }
  return discussionLib.listMessages(filter, worktreePath);
}

function rowToMessage(rec) {
  if (!rec) return null;
  let reactions = rec.reactions;
  if (typeof reactions === "string") {
    try { reactions = JSON.parse(reactions); } catch { reactions = []; }
  }
  if (!Array.isArray(reactions)) reactions = [];
  return {
    id: rec.id,
    kind: rec.kind,
    topology: rec.topology,
    from: rec.from_claim,
    to: rec.to_claim,
    team: rec.team,
    topic: rec.topic,
    threadId: rec.thread_id,
    body: rec.body,
    createdAt: rec.created_at,
    resolvedAt: rec.resolved_at,
    resolvedBy: rec.resolved_by,
    reactions,
    projectSlug: rec.project_slug,
  };
}

/** All durable SQLite messages, oldest first. Read-only, fail-open, and
 *  deliberately WITHOUT JSON fallback: legacy team-discussion.js merges
 *  these rows with its JSONL files itself (and a fallback here would recurse). */
function readStoreMessages() {
  const db = getDb();
  if (!db) return [];
  try {
    return db.prepare(`SELECT * FROM discussions ORDER BY created_at ASC`)
      .all().map((rec) => rowToMessage(rec)).filter(Boolean);
  } catch {
    return [];
  }
}

/** Read one thread: every message whose id, topic, or threadId equals
 *  `threadRef`, oldest first, including resolved. */
function getThread(threadRef, worktreePath) {
  try {
    if (typeof threadRef !== "string" || !threadRef) return [];
    const db = getDb();
    if (db) {
      const rows = db.prepare(`
        SELECT * FROM discussions
        WHERE id = @ref OR topic = @ref OR thread_id = @ref
        ORDER BY created_at ASC
      `).all({ ref: threadRef });
      return rows.map((rec) => rowToMessage(rec)).filter(Boolean);
    }
    return discussionLib.getThread(threadRef, worktreePath);
  } catch {
    return [];
  }
}

/** Mark a message resolved. Null when unknown (never throws). */
function resolveMessage(id, opts, worktreePath) {
  const o = opts && typeof opts === "object" ? opts : {};
  if (o && typeof o.worktreePath === "string" && worktreePath === undefined) worktreePath = o.worktreePath;
  const db = getDb();
  if (db) {
    const row = db.prepare(`SELECT * FROM discussions WHERE id = @id`)
      .get({ id });
    if (!row) return null;
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE discussions SET resolved_at = @resolvedAt, resolved_by = @resolvedBy
      WHERE id = @id
    `).run({ resolvedAt: now, resolvedBy: typeof o.by === "string" && o.by ? o.by : null, id });
    return rowToMessage(Object.assign({}, row, { resolved_at: now, resolved_by: typeof o.by === "string" && o.by ? o.by : null }));
  }
  return discussionLib.resolveMessage(id, o, worktreePath);
}

/** Append an emoji reaction. Null when unknown (never throws). */
function reactMessage(id, opts, worktreePath) {
  const o = opts && typeof opts === "object" ? opts : {};
  if (o && typeof o.worktreePath === "string" && worktreePath === undefined) worktreePath = o.worktreePath;
  const emoji = String(o.emoji || "");
  if (!emoji) throw new Error("team-discussions: react needs a non-empty emoji");
  const by = String(o.by || "");
  if (!by) throw new Error("team-discussions: react needs a claim-key author");
  const db = getDb();
  if (db) {
    const row = db.prepare(`SELECT * FROM discussions WHERE id = @id`)
      .get({ id });
    if (!row) return null;
    const reactions = Array.isArray(JSON.parse(row.reactions || "[]")) ? JSON.parse(row.reactions) : [];
    reactions.push({ by, emoji, at: new Date().toISOString() });
    db.prepare(`
      UPDATE discussions SET reactions = @reactions WHERE id = @id
    `).run({ reactions: JSON.stringify(reactions), id });
    return rowToMessage(Object.assign({}, row, { reactions }));
  }
  return discussionLib.reactMessage(id, o, worktreePath);
}

/** Prune a project's discussion store (remote SQLite line compatibility). */
function pruneDiscussion(opts, worktreePath) {
  const o = opts && typeof opts === "object" ? opts : {};
  if (o && typeof o.worktreePath === "string" && worktreePath === undefined) worktreePath = o.worktreePath;
  const db = getDb();
  if (!db) return discussionLib.pruneDiscussion(o, worktreePath);
  const projectSlug = resolveProjectSlug(o.workspace || (o.filter && o.filter.workspace) || undefined);
  const countSql = `SELECT COUNT(*) AS n FROM discussions WHERE project_slug = @projectSlug`;
  const before = Number(db.prepare(countSql).get({ projectSlug }).n);
  pruneCapSqlite(db, projectSlug);
  const after = Number(db.prepare(countSql).get({ projectSlug }).n);
  return { pruned: Math.max(0, before - after), kept: after };
}

module.exports = {
  DISCUSSION_FILE: discussionLib.DISCUSSION_FILE,
  defaultStateDir: discussionLib.defaultStateDir,
  discussionDir: discussionLib.discussionDir,
  discussionFile: discussionLib.discussionFile,
  sanitizeToken: sanitizeDiscussionToken,
  matchDiscussionFilter: matchMessageFilter,
  pruneDiscussion,
  DISCUSSION_CAP,
  DISCUSSION_KINDS,
  DISCUSSION_TOPOLOGIES,
  KIND_TOPOLOGY,
  sanitizeDiscussionToken,
  isDiscussionKind,
  topologyOf,
  matchMessageFilter,
  newDiscussionId,
  buildMessage,
  postMessage,
  listMessages,
  getThread,
  readStoreMessages,
  readAll: listMessages,
  resolveMessage,
  reactMessage,
};

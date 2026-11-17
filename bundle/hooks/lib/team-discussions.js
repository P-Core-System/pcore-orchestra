ive.some(l => l.id === r.id)) {
      db.prepare("DELETE FROM discussions WHERE id = ?").run(r.id);
    }
  }
  db.exec("COMMIT");
  return { pruned, kept };
}

function postMessage(input, worktreePath) {
  if (input && typeof input === "object" && typeof input.worktreePath === "string" && worktreePath === undefined) {
    worktreePath = input.worktreePath;
  }
  if (store.isAvailable()) {
    const db = store.initDb();
    if (db) return postMessageSqlite(db, input);
  }
  return discussionJson.postMessage(input, worktreePath);
}
function listMessages(filter, worktreePath) {
  if (filter && typeof filter === "object" && typeof filter.worktreePath === "string" && worktreePath === undefined) {
    worktreePath = filter.worktreePath;
  }
  if (store.isAvailable()) {
    const db = store.initDb();
    if (db) return listMessagesSqlite(db, filter);
  }
  return discussionJson.listMessages(filter, worktreePath);
}
function getThread(threadRef, worktreePath) {
  try {
    if (typeof threadRef !== "string" || !threadRef) return [];
    if (store.isAvailable()) {
      const db = store.initDb();
      if (db) return getThreadSqlite(db, threadRef);
    }
    return discussionJson.getThread(threadRef, worktreePath);
  } catch { return []; }
}
function resolveMessage(id, opts, worktreePath) {
  const o = opts && typeof opts === "object" ? opts : {};
  if (o && typeof o.worktreePath === "string" && worktreePath === undefined) worktreePath = o.worktreePath;
  if (store.isAvailable()) {
    const db = store.initDb();
    if (db) return resolveMessageSqlite(db, id, o.by);
  }
  return discussionJson.resolveMessage(id, o, worktreePath);
}
function reactMessage(id, opts, worktreePath) {
  const o = opts && typeof opts === "object" ? opts : {};
  if (o && typeof o.worktreePath === "string" && worktreePath === undefined) worktreePath = o.worktreePath;
  const emoji = String(o.emoji || "");
  if (!emoji) throw new Error("team-discussions: react needs a non-empty --emoji");
  const by = String(o.by || "");
  if (!by) throw new Error("team-discussions: react needs a claim-key author");
  if (store.isAvailable()) {
    const db = store.initDb();
    if (db) return reactMessageSqlite(db, id, by, emoji);
  }
  return discussionJson.reactMessage(id, o, worktreePath);
}
function pruneDiscussion(opts, worktreePath) {
  const o = opts && typeof opts === "object" ? opts : {};
  if (o && typeof o.worktreePath === "string" && worktreePath === undefined) worktreePath = o.worktreePath;
  if (store.isAvailable()) {
    const db = store.initDb();
    if (db) return pruneDiscussionSqlite(db, o);
  }
  return discussionJson.pruneDiscussion(o, worktreePath);
}
module.exports = {
  DISCUSSION_CAP, DISCUSSION_FILE, DISCUSSION_KINDS, DISCUSSION_TOPOLOGIES,
  KIND_TOPOLOGY, defaultStateDir, discussionDir, discussionFile,
  sanitizeToken, isDiscussionKind, topologyOf, newDiscussionId, buildMessage,
  matchDiscussionFilter, postMessage, listMessages, getThread, resolveMessage,
  reactMessage, pruneDiscussion,
};

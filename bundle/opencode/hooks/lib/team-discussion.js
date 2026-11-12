"use strict";

/**
 * Team discussion threads (WI-10 leader/member pairing channel).
 *
 * A tiny JSONL message store for cross-CLI team chatter: a leader can push
 * context to a member, a member can pull/ask, members can talk peer-to-peer,
 * and the whole team shares group broadcasts. Authors are claim keys
 * (`team/member/slug/sessionId` from session-claims.js) so every message is
 * attributable to a live slot; readers filter by topology.
 *
 * Message kinds (directional):
 *   m2m   member -> member  (peer pair, 2way topology)
 *   l2m   leader -> member  (star topology, push leg)
 *   m2l   member -> leader  (star topology, pull leg)
 *   l2l   leader -> leader  (HOD pair, 2way topology)
 *   group team broadcast    (group topology)
 *
 * Topology filter:
 *   2way  m2m + l2l (direct pairs)
 *   star  l2m + m2l (leader-centered)
 *   group group only
 *   all   everything (default)
 *
 * Storage: `<state>/team-discussion.jsonl` — always the shared team dir
 * (carve-out from invariants 30/31: pairing needs one shared thread across
 * sessions; conductor runs and domain events stay partitioned).
 * `worktreePath` is accepted for legacy import only: a pre-unify
 * `<worktree>/.pcore/state/team-discussion.jsonl` is merged into reads
 * (shared wins on id conflict), writes always go shared.
 * DISCUSSION_CAP lines (oldest trimmed first; see pruneDiscussion).
 * Every write goes through safe-write.js (withLock + atomicWrite) — never
 * raw fs writes on shared state (invariant 15). Bad lines read as skipped,
 * never fatal.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { withLock, atomicWrite, resolveStateDir } = require("./safe-write.js");

/** Ring cap for the discussion JSONL file: oldest lines trimmed first. */
const DISCUSSION_CAP = 500;

const DISCUSSION_FILE = "team-discussion.jsonl";

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

let seq = 0;

/** Default shared state dir (alongside the other state writers). */
function defaultStateDir() {
  return path.join(os.homedir(), ".config", "opencode", "hooks", "state");
}

/** Resolved state dir: always the shared team dir (worktreePath is legacy-import only). */
function discussionDir(worktreePath) {
  void worktreePath;
  return resolveStateDir(defaultStateDir());
}

function discussionFile(worktreePath) {
  return path.join(discussionDir(worktreePath), DISCUSSION_FILE);
}

/**
 * Legacy worktree-partitioned thread file (pre-unify layout). Read for
 * import only — writes never target it.
 * @returns {string|null} legacy file path, or null without a worktree
 */
function legacyDiscussionFile(worktreePath) {
  if (worktreePath && typeof worktreePath === "string" && worktreePath.length > 0) {
    return path.join(worktreePath, ".pcore", "state", DISCUSSION_FILE);
  }
  return null;
}

function ensureDiscussionDir(file) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  } catch {
    /* best effort — safe-write surfaces a real error */
  }
}

/** Lowercase slug form (mirrors session-claims.sanitizeName; kept inline so
 * the pure section stays dependency-free and byte-mirrorable). */
function sanitizeDiscussionToken(raw) {
  if (raw === undefined || raw === null) return "";
  return String(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** True for a known directional kind. */
function isDiscussionKind(kind) {
  return DISCUSSION_KINDS.indexOf(kind) !== -1;
}

/** Topology for a kind; unknown kinds map to null (never throw). */
function topologyOf(kind) {
  return Object.prototype.hasOwnProperty.call(KIND_TOPOLOGY, kind) ? KIND_TOPOLOGY[kind] : null;
}

/**
 * Pure filter predicate for one message. All fields optional:
 * kind/kinds, topology (2way|star|group|all), team, member (matches author
 * member slug or `to` — member name or claim key, both directions — plus any
 * same-team m2l/l2m star leg and any same-team `group` broadcast), topic
 * (substring), includeResolved (default hides resolved). A `group`
 * broadcast addresses the whole team, not a member slot: it matches a
 * member-filtered list when the team matches (or no team is filtered).
 * Same-team star legs (m2l/l2m) are leader-centered, not pairwise-private:
 * they match any member-filtered list whose sanitized team equals the
 * message team (both non-empty). m2m/l2l stay pairwise-private (author/to
 * only), and a member filter without a team never leaks another team's
 * star legs. Never throws; a null message never matches.
 */
function matchDiscussionFilter(msg, filter) {
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

/** Sortable message id: `d_<time36><seq><rand>`. */
function newDiscussionId() {
  seq += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `d_${Date.now().toString(36)}${seq.toString(36)}${rand}`;
}

/**
 * Build (but do not store) a message record. Pure: no fs, no clock beyond
 * the timestamps it stamps. Throws on unknown kind or empty body/from.
 */
function buildMessage(input) {
  const o = input || {};
  const kind = String(o.kind || "m2m");
  if (!isDiscussionKind(kind)) throw new Error(`team-discussion: unknown kind '${o.kind}'`);
  const from = String(o.from || "");
  if (!from) throw new Error("team-discussion: post needs a claim-key author (--member/--team claim first)");
  const body = String(o.body || "");
  if (!body.trim()) throw new Error("team-discussion: post needs a non-empty --body");
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
  };
}

/** Parse one JSONL line; null when blank/torn/non-message. Never throws. */
function parseDiscussionLine(line) {
  const s = String(line).trim();
  if (!s) return null;
  try {
    const msg = JSON.parse(s);
    if (msg && typeof msg === "object" && typeof msg.id === "string") return msg;
    return null;
  } catch {
    return null;
  }
}

/** Read raw text lines of a file; missing/unreadable -> []. */
function readDiscussionLines(file) {
  let raw = "";
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  return String(raw).split("\n");
}

/**
 * Read all messages (tolerant: bad lines skipped); corrupt/missing -> [].
 * With worktreePath, a legacy worktree-partitioned file is merged in
 * (shared wins on id conflict) so pre-unify threads stay visible.
 */
function readAll(worktreePath) {
  const seen = new Set();
  const out = [];
  const push = (msg) => {
    if (msg && !seen.has(msg.id)) {
      seen.add(msg.id);
      out.push(msg);
    }
  };
  for (const line of readDiscussionLines(discussionFile(worktreePath))) {
    const msg = parseDiscussionLine(line);
    if (msg) push(msg);
  }
  const legacy = legacyDiscussionFile(worktreePath);
  if (legacy) {
    for (const line of readDiscussionLines(legacy)) {
      const msg = parseDiscussionLine(line);
      if (msg) push(msg);
    }
  }
  return out;
}

/** Serialize + ring-cap (keep newest). Pure. */
function capLines(msgs, cap) {
  const list = Array.isArray(msgs) ? msgs : [];
  const n = Number.isInteger(cap) && cap > 0 ? cap : DISCUSSION_CAP;
  const kept = list.length > n ? list.slice(list.length - n) : list.slice();
  return kept.map((m) => JSON.stringify(m)).join("\n") + (kept.length > 0 ? "\n" : "");
}

/**
 * Append one message under an advisory lock, re-read, ring-cap, write.
 * @returns {object} the stored message
 */
function postMessage(input, worktreePath) {
  if (input && typeof input === "object" && typeof input.worktreePath === "string" && worktreePath === undefined) {
    worktreePath = input.worktreePath;
  }
  const msg = buildMessage(input);
  const file = discussionFile(worktreePath);
  ensureDiscussionDir(file);
  withLock(file, () => {
    const current = readAll(worktreePath);
    current.push(msg);
    atomicWrite(file, capLines(current));
  }, {});
  return msg;
}

/**
 * List messages matching a filter (see matchDiscussionFilter), oldest first.
 * @param {object} [filter]
 * @param {string} [worktreePath]
 */
function listMessages(filter, worktreePath) {
  if (filter && typeof filter === "object" && typeof filter.worktreePath === "string" && worktreePath === undefined) {
    worktreePath = filter.worktreePath;
  }
  return readAll(worktreePath).filter((m) => matchDiscussionFilter(m, filter));
}

/**
 * Read one thread: every message whose id, topic, or threadId equals
 * `threadRef`, oldest first, including resolved. A wake carries
 * threadId/messageId/topic precisely so a nudge re-opens this view —
 * the reader never mutates the store.
 * @param {string} threadRef message id, topic, or threadId
 * @param {string} [worktreePath]
 * @returns {Array} matching messages (possibly empty, never throws)
 */
function getThread(threadRef, worktreePath) {
  try {
    if (typeof threadRef !== "string" || !threadRef) return [];
    if (threadRef && typeof threadRef === "object") return [];
    return readAll(worktreePath).filter((m) =>
      m && (m.id === threadRef || m.topic === threadRef || m.threadId === threadRef));
  } catch {
    return [];
  }
}

/**
 * Mark a message resolved. Null when unknown (never throws).
 * @returns {object|null} the updated message
 */
function resolveMessage(id, opts, worktreePath) {
  const o = opts && typeof opts === "object" ? opts : {};
  if (o && typeof o.worktreePath === "string" && worktreePath === undefined) worktreePath = o.worktreePath;
  const file = discussionFile(worktreePath);
  ensureDiscussionDir(file);
  let updated = null;
  withLock(file, () => {
    const current = readAll(worktreePath);
    const idx = current.findIndex((m) => m && m.id === id);
    if (idx === -1) return;
    const now = new Date().toISOString();
    current[idx] = Object.assign({}, current[idx], {
      resolvedAt: now,
      resolvedBy: typeof o.by === "string" && o.by ? o.by : null,
    });
    updated = current[idx];
    atomicWrite(file, capLines(current));
  }, {});
  return updated;
}

/**
 * Append an emoji reaction. Null when unknown (never throws).
 * @returns {object|null} the updated message
 */
function reactMessage(id, opts, worktreePath) {
  const o = opts && typeof opts === "object" ? opts : {};
  if (o && typeof o.worktreePath === "string" && worktreePath === undefined) worktreePath = o.worktreePath;
  const emoji = String(o.emoji || "");
  if (!emoji) throw new Error("team-discussion: react needs a non-empty --emoji");
  const by = String(o.by || "");
  if (!by) throw new Error("team-discussion: react needs a claim-key author (--member/--team claim first)");
  const file = discussionFile(worktreePath);
  ensureDiscussionDir(file);
  let updated = null;
  withLock(file, () => {
    const current = readAll(worktreePath);
    const idx = current.findIndex((m) => m && m.id === id);
    if (idx === -1) return;
    const reactions = Array.isArray(current[idx].reactions) ? current[idx].reactions.slice() : [];
    reactions.push({ by, emoji, at: new Date().toISOString() });
    current[idx] = Object.assign({}, current[idx], { reactions });
    updated = current[idx];
    atomicWrite(file, capLines(current));
  }, {});
  return updated;
}

/**
 * Prune the JSONL file: drop resolved messages older than `olderThanMs`
 * (default: keep everything resolved) and enforce DISCUSSION_CAP.
 * @returns {{pruned:number, kept:number}}
 */
function pruneDiscussion(opts, worktreePath) {
  const o = opts && typeof opts === "object" ? opts : {};
  if (o && typeof o.worktreePath === "string" && worktreePath === undefined) worktreePath = o.worktreePath;
  const olderThanMs = Number.isFinite(o.olderThanMs) ? o.olderThanMs : null;
  const cap = Number.isInteger(o.cap) && o.cap > 0 ? o.cap : DISCUSSION_CAP;
  const file = discussionFile(worktreePath);
  ensureDiscussionDir(file);
  let pruned = 0;
  let kept = 0;
  withLock(file, () => {
    const current = readAll(worktreePath);
    const now = Date.now();
    let live = current;
    if (olderThanMs !== null) {
      live = current.filter((m) => {
        if (!m.resolvedAt) return true;
        const at = Date.parse(m.resolvedAt);
        if (Number.isNaN(at)) return true;
        if (now - at <= olderThanMs) return true;
        pruned += 1;
        return false;
      });
    }
    if (live.length > cap) {
      pruned += live.length - cap;
      live = live.slice(live.length - cap);
    }
    kept = live.length;
    atomicWrite(file, capLines(live, cap));
  }, {});
  return { pruned, kept };
}

module.exports = {
  DISCUSSION_CAP,
  DISCUSSION_FILE,
  DISCUSSION_KINDS,
  DISCUSSION_TOPOLOGIES,
  KIND_TOPOLOGY,
  defaultStateDir,
  discussionDir,
  discussionFile,
  legacyDiscussionFile,
  sanitizeDiscussionToken,
  isDiscussionKind,
  topologyOf,
  matchDiscussionFilter,
  newDiscussionId,
  buildMessage,
  readAll,
  capLines,
  postMessage,
  listMessages,
  getThread,
  resolveMessage,
  reactMessage,
  pruneDiscussion,
};

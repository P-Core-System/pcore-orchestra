"use strict";

/**
 * Session wake requests (teammate nudge channel) — SQLite-primary with
 * safe-write JSON fallback.
 *
 * A wake is a directed, attributable nudge from one live team-session slot
 * to another: `from` and `to` are claim keys (`team/member/slug/sessionId`
 * from team-claims.js). Wakes carry the discussion context that caused them
 * (`threadId` / `messageId` / `topic` / `topology`) without mutating the
 * discussion store.
 *
 * Scope rule: same team only (fail-closed on team, fail-open on plumbing).
 * Rate rule: at most WAKE_RATE_MAX (5) requested wakes per `from` claim key
 * per rolling hour.
 *
 * SQLite-primary: wakes live in the `wakes` table partitioned by
 * `project_slug`. Safe-write JSON fallback writes `team-wakes.jsonl` via
 * safe-write.js when SQLite is unavailable.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { getDb, resolveProjectSlug } = require("./session-store.js");
const claims = require("./team-claims.js");
const { withLock, readJsonSafe, writeJson, resolveStateDir } = require("./safe-write.js");
const { activateEvent } = require("./team-activation.js");

/** Ring cap for wakes per project. */
const WAKE_CAP = 500;

/** Max requested wakes per `from` claim key per rolling hour. */
const WAKE_RATE_MAX = 5;

/** Rolling rate window: one hour in milliseconds. */
const WAKE_RATE_WINDOW_MS = 60 * 60 * 1000;

/** Deny codes. */
const WAKE_CROSS_SCOPE = "WAKE_CROSS_SCOPE";
const WAKE_NO_CLAIM = "WAKE_NO_CLAIM";
const WAKE_DENIED = "WAKE_DENIED";
const WAKE_THROTTLED = "WAKE_THROTTLED";

const WAKES_FILE = "team-wakes.jsonl";

let _seq = 0;

function defaultStateDir() {
  return path.join(os.homedir(), ".config", "opencode", "hooks", "state");
}

function resolveStateDir_() {
  const dir = process.env.PCORE_STATE_DIR;
  if (dir && typeof dir === "string" && dir.length > 0) return dir;
  return defaultStateDir();
}

function wakesFile() {
  return path.join(resolveStateDir_(), WAKES_FILE);
}

/** Legacy pre-unify wake file (read-only import). Null without a worktree. */
function legacyWakesFile(worktreePath) {
  if (worktreePath && typeof worktreePath === "string" && worktreePath.length > 0) {
    return path.join(worktreePath, ".pcore", "state", WAKES_FILE);
  }
  return null;
}

function newWakeId() {
  _seq += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `w_${Date.now().toString(36)}${_seq.toString(36)}${rand}`;
}

function sanitizeWakeToken(raw) {
  if (raw === undefined || raw === null) return "";
  return String(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function memberOfClaimKey(claimKey) {
  const parts = String(claimKey || "").split("/");
  return sanitizeWakeToken(parts[1] || "");
}

function teamOfClaimKey(claimKey) {
  const parts = String(claimKey || "").split("/");
  return sanitizeWakeToken(parts[0] || "");
}

function isLiveClaim(claim, staleMs) {
  if (!claim || typeof claim !== "object") return false;
  return !claims.isStaleClaim(claim, Date.now(), staleMs);
}

function resolveProjectSlug_(workspaceRoot) {
  return resolveProjectSlug(workspaceRoot);
}

/** Build (but do not store) a wake record. Pure. Throws on empty from/to. */
function buildWake(input) {
  const o = input || {};
  const from = String(o.from || "");
  const to = String(o.to || "");
  if (!from) throw new Error("session-wake: request needs a live author claim");
  if (!to) throw new Error("session-wake: request needs a live target claim");
  const now = new Date().toISOString();
  return {
    id: typeof o.id === "string" && o.id ? o.id : newWakeId(),
    from,
    to,
    fromMember: sanitizeWakeToken(o.fromMember) || memberOfClaimKey(from),
    toMember: sanitizeWakeToken(o.toMember) || memberOfClaimKey(to),
    team: o.team === undefined || o.team === null ? teamOfClaimKey(to) || null : String(o.team),
    topic: typeof o.topic === "string" ? o.topic : null,
    threadId: typeof o.threadId === "string" ? o.threadId : (typeof o.topic === "string" ? o.topic : null),
    messageId: typeof o.messageId === "string" ? o.messageId : null,
    topology: typeof o.topology === "string" ? o.topology : null,
    reason: typeof o.reason === "string" ? o.reason : "nudge",
    projectSlug: typeof o.projectSlug === "string" ? o.projectSlug : null,
    workspaceSlug: typeof o.workspaceSlug === "string" ? o.workspaceSlug : null,
    status: "delivered",
    createdAt: now,
    ackedAt: null,
    ackedBy: null,
  };
}

function parseWakeLine(line) {
  const s = String(line).trim();
  if (!s) return null;
  try {
    const w = JSON.parse(s);
    if (w && typeof w === "object" && typeof w.id === "string") return w;
    return null;
  } catch {
    return null;
  }
}

function readWakeLinesFile() {
  let raw = "";
  try { raw = fs.readFileSync(wakesFile(), "utf8"); } catch { return []; }
  return String(raw).split("\n");
}

function readAllWakesJson(worktreePath) {
  const seen = new Set();
  const out = [];
  const push = (w) => { if (w && !seen.has(w.id)) { seen.add(w.id); out.push(w); } };
  for (const line of readWakeLinesFile()) push(parseWakeLine(line));
  const legacy = legacyWakesFile(worktreePath);
  if (legacy) {
    try {
      for (const line of String(fs.readFileSync(legacy, "utf8")).split(/\r?\n/)) {
        push(parseWakeLine(line));
      }
    } catch { /* legacy file absent — fail-open */ }
  }
  return out;
}

function capLinesJson(wakes, cap) {
  const list = Array.isArray(wakes) ? wakes : [];
  const n = Number.isInteger(cap) && cap > 0 ? cap : WAKE_CAP;
  const kept = list.length > n ? list.slice(list.length - n) : list.slice();
  return kept.map((w) => JSON.stringify(w)).join("\n") + (kept.length > 0 ? "\n" : "");
}

/** Fail-open activation of the wake recipient after durable delivery. */
function activateForWake(wake, o) {
  try {
    const targetClaim = claims.getClaim(wake.to);
    const fromClaim = claims.getClaim(wake.from);
    return activateEvent("wake", wake, {
      workspace: (o && o.workspace) || (targetClaim && targetClaim.workspace) || wake.workspaceSlug || undefined,
      worktreePath: o && o.worktreePath,
      senderSessionId: (o && o.sessionId) || (fromClaim && fromClaim.sessionId) || undefined,
    });
  } catch {
    return null;
  }
}

/** Fail-open domain emit: wake.requested/delivered/denied/throttled. */
function emitWakeOutcome(wake, action) {
  try {
    const domain = require("./domain/index.js");
    if (domain && typeof domain.recordWakeOutcome === "function") {
      return domain.recordWakeOutcome(wake, action);
    }
  } catch { /* fail-open */ }
  return null;
}

/** Rate count for one author inside the rolling hour (pure). */
function rateCount(wakes, fromClaimKey, nowMs) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  let n = 0;
  for (const w of Array.isArray(wakes) ? wakes : []) {
    if (!w || w.from !== fromClaimKey) continue;
    const at = Date.parse(w.createdAt || "");
    if (!Number.isNaN(at) && now - at < WAKE_RATE_WINDOW_MS) n += 1;
  }
  return n;
}

/** Resolve an identity to a live claim record via team-claims (SQLite or JSON fallback). */
function resolveLiveClaim(ref, staleMs, opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  let claim = null;
  try {
    if (typeof ref === "string" && ref.indexOf("/") !== -1) {
      claim = claims.getClaim(ref);
    } else if (ref && typeof ref === "object" && typeof ref.claimKey === "string") {
      claim = claims.getClaim(ref.claimKey);
    } else if (ref && typeof ref === "object") {
      claim = claims.findClaim(Object.assign({}, ref, { workspace: ref.workspace || o.workspace }));
    } else if (typeof ref === "string") {
      const want = sanitizeWakeToken(ref);
      // Bare member names must resolve inside the caller's project. listClaims()
      // partitions by project_slug, so an unscoped scan misses cross-project
      // teammates (e.g. the CLI `wake request --to bob` path).
      claim = (typeof claims.findLiveSlot === "function"
        ? claims.findLiveSlot({ member: want, team: o.team, workspace: o.workspace,
            includeStale: true, staleMs })
        : null) || null;
      if (!claim) {
        const live = claims.listClaims({ includeStale: true, workspace: o.workspace, staleMs });
        claim = live.find((c) => c && sanitizeWakeToken(c.member) === want) || null;
      }
    }
  } catch { return null; }
  if (!claim || claims.isStaleClaim(claim, Date.now(), staleMs)) return null;
  return claim;
}

/**
 * Request a wake from one live slot to another.
 * Returns {ok:true, wake} or {ok:false, code}. Never throws.
 */
function requestWake(opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const staleMs = Number.isFinite(o.staleMs) ? o.staleMs : undefined;
  let fromClaim = null;
  let toClaim = null;
  try {
    fromClaim = resolveLiveClaim(o.from, staleMs, o);
    if (!fromClaim && o.from !== undefined) {
      const ident = o.fromIdentity && typeof o.fromIdentity === "object" ? o.fromIdentity : {};
      fromClaim = resolveLiveClaim(Object.assign({}, ident, {
        workspace: o.workspace || ident.workspace,
        sessionId: o.sessionId || ident.sessionId,
      }), staleMs);
    }
    toClaim = resolveLiveClaim(o.to !== undefined ? o.to : null, staleMs, o);
    if (!toClaim && (o.toMember || o.member)) {
      toClaim = resolveLiveClaim({ member: o.toMember || o.member, team: o.team, workspace: o.workspace }, staleMs, o);
    }
  } catch {
    return { ok: false, code: WAKE_NO_CLAIM, detail: "lookup-failed" };
  }
  if (!fromClaim) return { ok: false, code: WAKE_NO_CLAIM, detail: "from" };
  if (!toClaim) {
    emitWakeOutcome({ id: null, from: claimKeyOf(o.from), to: claimKeyOf(o.to), team: teamOfClaimKey(claimKeyOf(o.to)) || null, reason: "no-live-target" }, "denied");
    return { ok: false, code: WAKE_NO_CLAIM, detail: "to" };
  }

  // Scope guard: same-team slots pair across workspaces and projects —
  // the shared state dir is the trust root (WI-1 unify). A mismatch of two
  // teamed slots stays fail-closed (WAKE_CROSS_SCOPE) in every workspace;
  // unteamed (solo) slots pair only in the same workspace, as before.
  const fromWs = fromClaim.workspaceSlug || null;
  const toWs = toClaim.workspaceSlug || null;
  const fromProj = resolveProjectSlug_(fromClaim.workspace) || (typeof o.projectSlug === "string" ? o.projectSlug : null);
  const toProj = resolveProjectSlug_(toClaim.workspace) || null;
  const fromTeam = sanitizeWakeToken(fromClaim.teamId || fromClaim.team);
  const toTeam = sanitizeWakeToken(toClaim.teamId || toClaim.team);
  const sameTeam = !!fromTeam && fromTeam === toTeam;
  const bothTeamed = !!fromTeam && !!toTeam;
  const crossWorkspace = !!fromWs && !!toWs && fromWs !== toWs;
  const crossProject = !!fromProj && !!toProj && fromProj !== toProj;
  if ((!sameTeam && (bothTeamed || crossWorkspace || crossProject))) {
    emitWakeOutcome({
      id: null, from: fromClaim.claimKey, to: toClaim.claimKey,
      team: toClaim.teamId || toClaim.team || null, reason: WAKE_CROSS_SCOPE,
    }, "denied");
    return { ok: false, code: WAKE_CROSS_SCOPE, detail: crossProject ? "project" : (crossWorkspace ? "workspace" : "team") };
  }

  const db = getDb();
  if (db) {
    // Rate ring via SQLite
    const rows = db.prepare(`SELECT created_at FROM wakes WHERE from_claim = @from AND project_slug = @projectSlug`)
      .all({ from: fromClaim.claimKey, projectSlug: fromProj || "root" });
    const now = Date.now();
    let n = 0;
    for (const r of rows) {
      const at = Date.parse(r.created_at || "");
      if (!Number.isNaN(at) && now - at < WAKE_RATE_WINDOW_MS) n += 1;
    }
    if (n >= WAKE_RATE_MAX) {
      emitWakeOutcome({ id: null, from: fromClaim.claimKey, to: toClaim.claimKey, team: toClaim.teamId || toClaim.team || null, reason: WAKE_THROTTLED }, "throttled");
      return { ok: false, code: WAKE_THROTTLED };
    }

    let wake = null;
    try {
      wake = buildWake({
        from: fromClaim.claimKey, to: toClaim.claimKey,
        fromMember: fromClaim.member, toMember: toClaim.member,
        team: sanitizeWakeToken(o.team) || toClaim.teamId || toClaim.team || teamOfClaimKey(toClaim.claimKey),
        topic: typeof o.topic === "string" ? o.topic : null,
        threadId: typeof o.threadId === "string" ? o.threadId : (typeof o.topic === "string" ? o.topic : null),
        messageId: typeof o.messageId === "string" ? o.messageId : null,
        topology: typeof o.topology === "string" ? o.topology : null,
        reason: typeof o.reason === "string" ? o.reason : "nudge",
        projectSlug: fromProj,
        workspaceSlug: fromWs,
      });
    } catch {
      return { ok: false, code: WAKE_NO_CLAIM, detail: "build-failed" };
    }

    try {
      db.prepare(`
        INSERT INTO wakes (
          id, project_slug, from_claim, to_claim, from_member, to_member, team,
          topic, thread_id, message_id, topology, reason, workspace_slug,
          status, created_at, acked_at, acked_by
        ) VALUES (
          @id, @projectSlug, @from, @to, @fromMember, @toMember, @team,
          @topic, @threadId, @messageId, @topology, @reason, @workspaceSlug,
          @status, @createdAt, @ackedAt, @ackedBy
        )
      `).run({
        id: wake.id, projectSlug: wake.projectSlug || "root", from: wake.from, to: wake.to,
        fromMember: wake.fromMember, toMember: wake.toMember, team: wake.team,
        topic: wake.topic, threadId: wake.threadId, messageId: wake.messageId,
        topology: wake.topology, reason: wake.reason, workspaceSlug: wake.workspaceSlug,
        status: wake.status, createdAt: wake.createdAt, ackedAt: wake.ackedAt, ackedBy: wake.ackedBy,
      });
      // Enforce ring cap
      pruneCapSqlite(db, wake.projectSlug || "root");
    } catch {
      return { ok: false, code: WAKE_NO_CLAIM, detail: "store-failed" };
    }
    emitWakeOutcome(wake, "requested");
    emitWakeOutcome(wake, "delivered");
    activateForWake(wake, o);
    return { ok: true, wake };
  }

  // JSON fallback path
  let current = [];
  try { current = readAllWakesJson(); } catch {
    return { ok: false, code: WAKE_NO_CLAIM, detail: "read-failed" };
  }
  if (rateCount(current, fromClaim.claimKey, Date.now()) >= WAKE_RATE_MAX) {
    emitWakeOutcome({ id: null, from: fromClaim.claimKey, to: toClaim.claimKey, team: toClaim.teamId || toClaim.team || null, reason: WAKE_THROTTLED }, "throttled");
    return { ok: false, code: WAKE_THROTTLED };
  }

  let wake = null;
  try {
    wake = buildWake({
      from: fromClaim.claimKey, to: toClaim.claimKey,
      fromMember: fromClaim.member, toMember: toClaim.member,
      team: sanitizeWakeToken(o.team) || toClaim.teamId || toClaim.team || teamOfClaimKey(toClaim.claimKey),
      topic: typeof o.topic === "string" ? o.topic : null,
      threadId: typeof o.threadId === "string" ? o.threadId : (typeof o.topic === "string" ? o.topic : null),
      messageId: typeof o.messageId === "string" ? o.messageId : null,
      topology: typeof o.topology === "string" ? o.topology : null,
      reason: typeof o.reason === "string" ? o.reason : "nudge",
      projectSlug: fromProj,
      workspaceSlug: fromWs,
    });
  } catch {
    return { ok: false, code: WAKE_NO_CLAIM, detail: "build-failed" };
  }
  try {
    withLock(wakesFile(), () => {
      const live = readAllWakesJson();
      live.push(wake);
      const capped = live.slice(-WAKE_CAP);
      writeJson(wakesFile(), capped.map((w) => JSON.stringify(w)).join("\n") + (capped.length > 0 ? "\n" : ""));
    }, {});
  } catch {
    return { ok: false, code: WAKE_NO_CLAIM, detail: "store-failed" };
  }
  emitWakeOutcome(wake, "requested");
  emitWakeOutcome(wake, "delivered");
  activateForWake(wake, o);
  return { ok: true, wake };
}

function pruneCapSqlite(db, projectSlug) {
  const rows = db.prepare(`SELECT id, created_at FROM wakes WHERE project_slug = @projectSlug ORDER BY created_at DESC`)
    .all({ projectSlug });
  if (rows.length > WAKE_CAP) {
    for (const r of rows.slice(WAKE_CAP)) {
      db.prepare(`DELETE FROM wakes WHERE id = @id AND project_slug = @projectSlug`).run({ id: r.id, projectSlug });
    }
  }
}

function claimKeyOf(ref) {
  try {
    if (typeof ref === "string") return ref;
    if (ref && typeof ref === "object" && typeof ref.claimKey === "string") return ref.claimKey;
  } catch { /* fall through */ }
  return null;
}

/** List wakes matching a filter, oldest first. */
function listWakes(filter, worktreePath) {
  const f = filter && typeof filter === "object" ? filter : {};
  const db = getDb();
  if (db) {
    let sql = `SELECT * FROM wakes`;
    const params = {};
    const clauses = [];
    if (typeof f.projectSlug === "string" && f.projectSlug) {
      clauses.push(`project_slug = @projectSlug`); params.projectSlug = f.projectSlug;
    }
    if (typeof f.team === "string" && f.team) {
      clauses.push(`team = @team`);
      params.team = sanitizeWakeToken(f.team); // CLI may pass "Team-Sea"; stored is "team-sea"
    }
    if (typeof f.topic === "string" && f.topic) { clauses.push(`topic LIKE @topic`); params.topic = `%${f.topic}%`; }
    if (typeof f.threadId === "string" && f.threadId) { clauses.push(`thread_id = @threadId`); params.threadId = f.threadId; }
    if (clauses.length > 0) sql += ` WHERE ` + clauses.join(` AND `);
    sql += ` ORDER BY created_at ASC`;
    const rows = db.prepare(sql).all(params);
    const out = rows.map((r) => wakeRowToRecord(r)).filter((w) => matchWakeFilter(w, f));
    // Merge read-only legacy wakes from a worktree (pre-unify import).
    if (legacyWakesFile(worktreePath)) {
      const seen = new Set(out.map((w) => w.id));
      for (const w of readAllWakesJson(worktreePath)) {
        if (!seen.has(w.id) && matchWakeFilter(w, f)) { seen.add(w.id); out.push(w); }
      }
      out.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    }
    return out;
  }
  const wakes = readAllWakesJson(worktreePath);
  return wakes.filter((w) => matchWakeFilter(w, f));
}

function wakeRowToRecord(rec) {
  if (!rec) return null;
  return {
    id: rec.id, from: rec.from_claim, to: rec.to_claim,
    fromMember: rec.from_member, toMember: rec.to_member, team: rec.team,
    topic: rec.topic, threadId: rec.thread_id, messageId: rec.message_id,
    topology: rec.topology, reason: rec.reason, projectSlug: rec.project_slug,
    workspaceSlug: rec.workspace_slug, status: rec.status,
    createdAt: rec.created_at, ackedAt: rec.acked_at, ackedBy: rec.acked_by,
  };
}

/** Pure filter predicate for one wake. */
function matchWakeFilter(wake, filter) {
  if (!wake || typeof wake !== "object") return false;
  const f = filter && typeof filter === "object" ? filter : {};
  if (typeof f.member === "string" && f.member) {
    const want = sanitizeWakeToken(f.member);
    const hit = sanitizeWakeToken(wake.toMember) === want ||
      sanitizeWakeToken(wake.fromMember) === want ||
      memberOfClaimKey(wake.to) === want ||
      memberOfClaimKey(wake.from) === want;
    if (!hit) return false;
  }
  if (typeof f.team === "string" && f.team && sanitizeWakeToken(f.team) !== sanitizeWakeToken(wake.team)) return false;
  if (typeof f.topic === "string" && f.topic && String(wake.topic || "").indexOf(f.topic) === -1) return false;
  if (typeof f.threadId === "string" && f.threadId && wake.threadId !== f.threadId) return false;
  if (!f.includeAcked && wake.status === "acked") return false;
  return true;
}

/** Acknowledge a wake. Only the target slot's holder can ack. Never throws. */
function ackWake(id, opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  if (!id) return { ok: false, code: WAKE_DENIED, detail: "no-id" };
  let acker = null;
  try {
    acker = resolveLiveClaim(o.by !== undefined ? o.by : null, o.staleMs, o);
    if (!acker && (o.member || o.claimKey)) {
      acker = resolveLiveClaim(Object.assign({}, o), o.staleMs, o);
    }
  } catch {
    return { ok: false, code: WAKE_DENIED, detail: "lookup-failed" };
  }
  if (!acker) return { ok: false, code: WAKE_DENIED, detail: "no-live-acker" };

  const db = getDb();
  if (db) {
    const row = db.prepare(`SELECT * FROM wakes WHERE id = @id`).get({ id });
    if (!row) return { ok: false, code: WAKE_DENIED, detail: "WAKE_UNKNOWN" };
    const wake = wakeRowToRecord(row);
    if (acker.claimKey !== wake.to &&
      memberOfClaimKey(wake.to) !== sanitizeWakeToken(acker.member) &&
      sanitizeWakeToken(wake.toMember) !== sanitizeWakeToken(acker.member)) {
      return { ok: false, code: WAKE_DENIED, detail: "not-target" };
    }
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE wakes SET status = 'acked', acked_at = @ackedAt, acked_by = @ackedBy
      WHERE id = @id
    `).run({ ackedAt: now, ackedBy: acker.claimKey, id });
    return { ok: true, wake: Object.assign({}, wake, { status: "acked", ackedAt: now, ackedBy: acker.claimKey }) };
  }

  // JSON fallback
  let updated = null;
  let denied = WAKE_DENIED;
  try {
    withLock(wakesFile(), () => {
      const current = readAllWakesJson();
      const idx = current.findIndex((w) => w && w.id === id);
      if (idx === -1) { denied = "WAKE_UNKNOWN"; return; }
      const wake = current[idx];
      if (acker.claimKey !== wake.to &&
        memberOfClaimKey(wake.to) !== sanitizeWakeToken(acker.member) &&
        sanitizeWakeToken(wake.toMember) !== sanitizeWakeToken(acker.member)) {
        return;
      }
      const now = new Date().toISOString();
      current[idx] = Object.assign({}, wake, { status: "acked", ackedAt: now, ackedBy: acker.claimKey });
      updated = current[idx];
      writeJson(wakesFile(), current.map((w) => JSON.stringify(w)).join("\n") + (current.length > 0 ? "\n" : ""));
    }, {});
  } catch {
    return { ok: false, code: WAKE_DENIED, detail: "store-failed" };
  }
  if (!updated) return { ok: false, code: denied, detail: "not-target" };
  return { ok: true, wake: updated };
}

/** Extract `@member` mentions from a discussion body. */
function parseMentions(body) {
  const out = [];
  const seen = new Set();
  const text = typeof body === "string" ? body : "";
  const re = /(^|[^a-z0-9_-])@([a-z0-9][a-z0-9-]*)/gi;
  let m = null;
  while ((m = re.exec(text)) !== null) {
    const slug = sanitizeWakeToken(m[2]);
    if (slug && !seen.has(slug)) { seen.add(slug); out.push(slug); }
  }
  return out;
}

/** Discussion-post trigger: every @member gets a wake. Fail-open. */
function triggerWakesForDiscussion(msg, opts) {
  try {
    const o = opts && typeof opts === "object" ? opts : {};
    if (!msg || typeof msg !== "object") return [];
    const mentions = parseMentions(msg.body);
    if (mentions.length === 0) return [];
    const authorMember = memberOfClaimKey(msg.from);
    const out = [];
    for (const mention of mentions) {
      if (mention === authorMember) continue;
      let result = null;
      try {
        result = requestWake({
          from: msg.from, to: mention, team: msg.team, topic: msg.topic,
          threadId: msg.threadId || msg.topic, messageId: msg.id,
          topology: msg.topology, reason: "mention",
          workspace: o.workspace, worktreePath: o.worktreePath,
        });
      } catch { result = { ok: false, code: WAKE_NO_CLAIM, detail: "trigger-failed" }; }
      out.push({ mention, result });
    }
    return out;
  } catch { return []; }
}

/** Dispatch-grant trigger: a granted backlog item wakes the assignee. */
function triggerWakeForGrant(grant, opts) {
  try {
    const o = opts && typeof opts === "object" ? opts : {};
    if (!grant || typeof grant !== "object" || grant.granted !== true) return null;
    if (o.from === undefined || o.from === null) return { ok: false, skipped: "no-from" };
    const member = typeof grant.member === "string" ? grant.member : null;
    if (!member) return null;
    return requestWake({
      from: o.from, to: member, team: grant.team, topic: o.topic || null,
      threadId: o.threadId || o.topic || null, messageId: o.messageId || null,
      topology: o.topology || null, reason: "assign", workspace: o.workspace,
      worktreePath: typeof o.worktreePath === "string" ? o.worktreePath : undefined,
    });
  } catch { return { ok: false, code: WAKE_NO_CLAIM, detail: "trigger-failed" }; }
}

/** Phase-outcome trigger: block/needs_human wakes the team leader/HOD. */
function wakeForPhaseOutcome(state, outcome) {
  try {
    const s = state && typeof state === "object" ? state : {};
    const oc = outcome && typeof outcome === "object" ? outcome : {};
    const decision = oc.decision || null;
    const needsHuman = decision === "block" || decision === "needs_human" || oc.needs_human === true;
    if (!needsHuman) return null;
    const fromRef = s.claimKey || oc.claimKey || null;
    if (!fromRef) return null;
    const fromClaim = resolveLiveClaim(fromRef);
    if (!fromClaim) return null;
    const team = sanitizeWakeToken(oc.team || s.team || fromClaim.teamId || fromClaim.team) || null;
    const live = claims.listClaims({ workspace: fromClaim.workspace, includeStale: false });
    const leaders = live
      .filter((c) => c && (c.role === "leader" || c.role === "hod") &&
        (!team || sanitizeWakeToken(c.teamId || c.team) === team) &&
        (fromClaim.workspaceSlug || null) === (c.workspaceSlug || null))
      .sort((a, b) => String(a.claimKey).localeCompare(String(b.claimKey)));
    if (leaders.length === 0) return null;
    const to = leaders[0];
    if (to.claimKey === fromClaim.claimKey) return null;
    const res = requestWake({
      from: fromClaim.claimKey, to: to.claimKey, team, topic: oc.phase || null,
      threadId: null, messageId: null, topology: null, reason: "escalate",
      workspace: fromClaim.workspace,
    });
    return res && res.ok ? res : null;
  } catch { return null; }
}

/** Record a wake outcome (domain event). Fail-open. */
function recordWakeOutcome(wake, action) {
  return emitWakeOutcome(wake, action);
}

module.exports = {
  WAKE_CAP, WAKE_RATE_MAX, WAKE_RATE_WINDOW_MS, WAKES_FILE,
  WAKE_CROSS_SCOPE, WAKE_NO_CLAIM, WAKE_DENIED, WAKE_THROTTLED,
  defaultStateDir, resolveStateDir: resolveStateDir_, wakesFile,
  sanitizeWakeToken, memberOfClaimKey, teamOfClaimKey, isLiveClaim,
  resolveProjectSlug: resolveProjectSlug_, buildWake,
  readAllWakesJson, readAll: readAllWakesJson, legacyWakesFile, capLinesJson, rateCount, resolveLiveClaim,
  requestWake, listWakes, matchWakeFilter, ackWake,
  parseMentions, triggerWakesForDiscussion, triggerWakeForGrant,
  wakeForPhaseOutcome, recordWakeOutcome,
};

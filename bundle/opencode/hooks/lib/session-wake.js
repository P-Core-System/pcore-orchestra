"use strict";

/**
 * Session wake requests (Wave3 teammate nudge channel).
 *
 * A wake is a directed, attributable nudge from one live team-session slot
 * to another: `from` and `to` are claim keys (`team/member/slug/sessionId`
 * from session-claims.js), so every wake renders with a live author and a
 * live target. Wakes carry the discussion context that caused them
 * (`threadId` / `messageId` / `topic` / `topology`) without mutating the
 * discussion store — the wake is a pointer, the thread stays the record.
 *
 * Scope rule: a wake is requested only between two live slots of the SAME
 * team (fail-closed on team, fail-open on plumbing). Same-team slots pair
 * across workspaces and projects — the shared state dir is the trust root,
 * so one team's sessions always see each other. A team mismatch returns
 * `{ok:false, code:"WAKE_CROSS_SCOPE"}`, stores nothing, and appends a
 * `wake.denied` domain audit — no delivery, never a throw.
 *
 * Rate rule: at most WAKE_RATE_MAX (5) requested wakes per `from` claim
 * key per rolling hour; the excess returns `{ok:false,
 * code:"WAKE_THROTTLED"}` with a `wake.throttled` event. Delivery is
 * same-box file state, so a passed request is stored `delivered` at once
 * (`wake.requested` + `wake.delivered` domain events, fail-open).
 *
 * Storage: `<state>/team-wakes.jsonl` — always the shared team dir
 * (carve-out from invariants 30/31: nudges need one shared inbox across
 * sessions; conductor runs and domain events stay partitioned).
 * `worktreePath` is accepted for legacy import only: a pre-unify
 * `<worktree>/.pcore/state/team-wakes.jsonl` is merged into reads
 * (shared wins on id conflict), writes always go shared.
 * lines (oldest trimmed first). Every write goes through safe-write.js
 * (withLock + atomicWrite) — never raw fs writes on shared state
 * (invariant 15). Bad lines read as skipped, never fatal.
 *
 * Triggers (all fail-open, never throw): discussion `@mention` wakes
 * (`triggerWakesForDiscussion`), dispatch-grant assign wakes
 * (`triggerWakeForGrant`), and phase-outcome block/escalate wakes to the
 * team leader/HOD (`wakeForPhaseOutcome`, called from
 * `recordPhaseOutcome` via a lazy guarded require).
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { withLock, atomicWrite, resolveStateDir } = require("./safe-write.js");

/** Ring cap for the wakes JSONL file: oldest lines trimmed first. */
const WAKE_CAP = 500;

/** Max requested wakes per `from` claim key per rolling hour. */
const WAKE_RATE_MAX = 5;

/** Rolling rate window: one hour in milliseconds. */
const WAKE_RATE_WINDOW_MS = 60 * 60 * 1000;

const WAKES_FILE = "team-wakes.jsonl";

/** Deny code when from/to slots span workspaces or projects (no delivery). */
const WAKE_CROSS_SCOPE = "WAKE_CROSS_SCOPE";

/** Deny code when either slot holds no live claim. */
const WAKE_NO_CLAIM = "WAKE_NO_CLAIM";

/** Deny code when the acker is not the wake target. */
const WAKE_DENIED = "WAKE_DENIED";

/** Deny code when the sender exceeded the hourly rate ring. */
const WAKE_THROTTLED = "WAKE_THROTTLED";

let seq = 0;

/** Default shared state dir (alongside the other state writers). */
function defaultStateDir() {
  return path.join(os.homedir(), ".config", "opencode", "hooks", "state");
}

/** Resolved state dir: always the shared team dir (worktreePath is legacy-import only). */
function wakesDir(worktreePath) {
  void worktreePath;
  return resolveStateDir(defaultStateDir());
}

function wakesFile(worktreePath) {
  return path.join(wakesDir(worktreePath), WAKES_FILE);
}

/**
 * Legacy worktree-partitioned wakes file (pre-unify layout). Read for
 * import only — writes never target it.
 * @returns {string|null} legacy file path, or null without a worktree
 */
function legacyWakesFile(worktreePath) {
  if (worktreePath && typeof worktreePath === "string" && worktreePath.length > 0) {
    return path.join(worktreePath, ".pcore", "state", WAKES_FILE);
  }
  return null;
}

function ensureWakesDir(file) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  } catch {
    /* best effort — safe-write surfaces a real error */
  }
}

/** Sortable wake id: `w_<time36><seq><rand>`. */
function newWakeId() {
  seq += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `w_${Date.now().toString(36)}${seq.toString(36)}${rand}`;
}

/** Lowercase slug form (mirrors session-claims.sanitizeName; kept inline so
 * this module stays dependency-light at load). */
function sanitizeWakeToken(raw) {
  if (raw === undefined || raw === null) return "";
  return String(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Member slug of a claim key (`team/member/slug/session`). */
function memberOfClaimKey(claimKey) {
  const parts = String(claimKey || "").split("/");
  return sanitizeWakeToken(parts[1] || "");
}

/** Team slug of a claim key. */
function teamOfClaimKey(claimKey) {
  const parts = String(claimKey || "").split("/");
  return sanitizeWakeToken(parts[0] || "");
}

/**
 * True when the claim record is live (present + heartbeat inside the
 * threshold). Pure; a null claim is never live.
 */
function isLiveClaim(claim, staleMs) {
  if (!claim || typeof claim !== "object") return false;
  try {
    const claims = require("./session-claims.js");
    return !claims.isStaleClaim(claim, Date.now(), staleMs);
  } catch {
    return false;
  }
}

/**
 * Project slug for a workspace root, read from `<root>/project.yaml`.
 * Fail-open: null when missing/unreadable — the scope check then compares
 * workspace slugs only.
 */
function resolveProjectSlug(workspaceRoot) {
  if (!workspaceRoot || typeof workspaceRoot !== "string") return null;
  try {
    const identity = require("./project-identity.js");
    if (!identity || typeof identity.loadProjectIdentity !== "function") return null;
    const loaded = identity.loadProjectIdentity(workspaceRoot);
    const slug = loaded && loaded.project && loaded.project.slug;
    return typeof slug === "string" && slug ? slug : null;
  } catch {
    return null;
  }
}

/**
 * Build (but do not store) a wake record. Pure: no fs, no clock beyond the
 * timestamp it stamps. Throws on empty from/to.
 */
function buildWake(input) {
  const o = input || {};
  const from = String(o.from || "");
  const to = String(o.to || "");
  if (!from) throw new Error("session-wake: request needs a live author claim (--member/--team claim first)");
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

/** Parse one JSONL line; null when blank/torn/non-wake. Never throws. */
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

/** Read raw lines of a wakes file; missing/unreadable -> []. */
function readWakeLines(file) {
  let raw = "";
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  return String(raw).split("\n");
}

/**
 * Read all wakes (tolerant: bad lines skipped); corrupt/missing -> [].
 * With worktreePath, a legacy worktree-partitioned file is merged in
 * (shared wins on id conflict) so pre-unify nudges stay visible.
 */
function readAll(worktreePath) {
  const seen = new Set();
  const out = [];
  const push = (w) => {
    if (w && !seen.has(w.id)) {
      seen.add(w.id);
      out.push(w);
    }
  };
  for (const line of readWakeLines(wakesFile(worktreePath))) {
    const w = parseWakeLine(line);
    if (w) push(w);
  }
  const legacy = legacyWakesFile(worktreePath);
  if (legacy) {
    for (const line of readWakeLines(legacy)) {
      const w = parseWakeLine(line);
      if (w) push(w);
    }
  }
  return out;
}

/** Serialize + ring-cap (keep newest). Pure. */
function capLines(wakes, cap) {
  const list = Array.isArray(wakes) ? wakes : [];
  const n = Number.isInteger(cap) && cap > 0 ? cap : WAKE_CAP;
  const kept = list.length > n ? list.slice(list.length - n) : list.slice();
  return kept.map((w) => JSON.stringify(w)).join("\n") + (kept.length > 0 ? "\n" : "");
}

/** Requested wakes by one author inside the rolling hour. Pure. */
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

/** Fail-open domain emit: wake.requested/delivered/denied/throttled. */
function emitWakeOutcome(wake, action, worktreePath) {
  try {
    const domain = require("./domain/index.js");
    if (domain && typeof domain.recordWakeOutcome === "function") {
      return domain.recordWakeOutcome(wake, action, worktreePath);
    }
  } catch {
    /* fail-open — the wake store is the record, the domain log is bonus */
  }
  return null;
}

/**
 * Resolve an identity (claim object, claim key, or {member, team, ...})
 * to a live claim record. Returns null when missing or stale.
 */
function resolveLiveClaim(ref, worktreePath, staleMs) {
  let claims = null;
  try {
    claims = require("./session-claims.js");
  } catch {
    return null;
  }
  let claim = null;
  try {
    if (typeof ref === "string" && ref.indexOf("/") !== -1) {
      claim = claims.getClaim(ref, worktreePath);
    } else if (ref && typeof ref === "object" && typeof ref.claimKey === "string") {
      claim = claims.getClaim(ref.claimKey, worktreePath);
    } else if (ref && typeof ref === "object") {
      claim = claims.findClaim(Object.assign({}, ref, { worktreePath }));
      if (claim && ref.worktreePath === undefined && worktreePath !== undefined) {
        claim = claims.getClaim(claim.claimKey, worktreePath);
      }
    } else if (typeof ref === "string") {
      const live = typeof claims.listClaims === "function"
        ? claims.listClaims({ worktreePath, includeStale: true })
        : [];
      const want = sanitizeWakeToken(ref);
      claim = live.find((c) => c && sanitizeWakeToken(c.member) === want) || null;
    }
  } catch {
    return null;
  }
  if (!claim || claims.isStaleClaim(claim, Date.now(), staleMs)) return null;
  return claim;
}

/**
 * Request a wake from one live slot to another.
 *
 * Same team only: a team mismatch returns
 * `{ok:false, code:WAKE_CROSS_SCOPE}` with a `wake.denied` audit and no
 * delivery. Missing/stale slots return `{ok:false, code:WAKE_NO_CLAIM}`.
 * Past WAKE_RATE_MAX requests/hour from the same author returns
 * `{ok:false, code:WAKE_THROTTLED}`. Never throws — every denial is a
 * value, and domain emits are fail-open.
 *
 * @param {object} opts {from, to, team?, worktreePath?, workspace?,
 *   projectSlug?, topic?, threadId?, messageId?, topology?, reason?, staleMs?}
 * @returns {{ok:boolean, code?:string, wake?:object, detail?:string}}
 */
function requestWake(opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const worktreePath = typeof o.worktreePath === "string" ? o.worktreePath : undefined;
  const staleMs = Number.isFinite(o.staleMs) ? o.staleMs : undefined;
  let fromClaim = null;
  let toClaim = null;
  try {
    fromClaim = resolveLiveClaim(o.from, worktreePath, staleMs);
    if (!fromClaim && o.from !== undefined) {
      const claims = require("./session-claims.js");
      const ident = o.fromIdentity && typeof o.fromIdentity === "object" ? o.fromIdentity : {};
      fromClaim = resolveLiveClaim(Object.assign({}, ident, {
        workspace: o.workspace || ident.workspace,
        sessionId: o.sessionId || ident.sessionId,
        worktreePath,
      }), worktreePath, staleMs);
    }
    toClaim = resolveLiveClaim(
      o.to !== undefined ? o.to : null, worktreePath, staleMs
    );
    if (!toClaim && (o.toMember || o.member)) {
      toClaim = resolveLiveClaim({ member: o.toMember || o.member, team: o.team, worktreePath }, worktreePath, staleMs);
    }
  } catch {
    return { ok: false, code: WAKE_NO_CLAIM, detail: "lookup-failed" };
  }
  if (!fromClaim) return { ok: false, code: WAKE_NO_CLAIM, detail: "from" };
  if (!toClaim) {
    emitWakeOutcome({ id: null, from: claimKeyOf(o.from), to: claimKeyOf(o.to), team: teamOfClaimKey(claimKeyOf(o.to)) || null, reason: "no-live-target" }, "denied", worktreePath);
    return { ok: false, code: WAKE_NO_CLAIM, detail: "to" };
  }

  // Scope guard: same-team slots pair across workspaces and projects —
  // the shared state dir is the trust root (WI-1 unify). A team mismatch
  // stays fail-closed (WAKE_CROSS_SCOPE); unteamed (solo) slots pair only
  // in the same workspace, as before.
  const fromWs = fromClaim.workspaceSlug || null;
  const toWs = toClaim.workspaceSlug || null;
  const fromProj = resolveProjectSlug(fromClaim.workspace) || (typeof o.projectSlug === "string" ? o.projectSlug : null);
  const toProj = resolveProjectSlug(toClaim.workspace) || null;
  const fromTeam = sanitizeWakeToken(fromClaim.teamId || fromClaim.team);
  const toTeam = sanitizeWakeToken(toClaim.teamId || toClaim.team);
  const sameTeam = !!fromTeam && fromTeam === toTeam;
  const crossWorkspace = !!fromWs && !!toWs && fromWs !== toWs;
  const crossProject = !!fromProj && !!toProj && fromProj !== toProj;
  if ((crossWorkspace || crossProject) && !sameTeam) {
    emitWakeOutcome({
      id: null, from: fromClaim.claimKey, to: toClaim.claimKey,
      team: toClaim.teamId || toClaim.team || null, reason: WAKE_CROSS_SCOPE,
    }, "denied", worktreePath);
    return { ok: false, code: WAKE_CROSS_SCOPE, detail: crossProject ? "project" : "workspace" };
  }

  // Rate ring: at most WAKE_RATE_MAX requested wakes per author per hour.
  const file = wakesFile(worktreePath);
  ensureWakesDir(file);
  let current = [];
  try {
    current = readAll(worktreePath);
  } catch {
    return { ok: false, code: WAKE_NO_CLAIM, detail: "read-failed" };
  }
  if (rateCount(current, fromClaim.claimKey, Date.now()) >= WAKE_RATE_MAX) {
    emitWakeOutcome({
      id: null, from: fromClaim.claimKey, to: toClaim.claimKey,
      team: toClaim.teamId || toClaim.team || null, reason: WAKE_THROTTLED,
    }, "throttled", worktreePath);
    return { ok: false, code: WAKE_THROTTLED };
  }

  let wake = null;
  try {
    wake = buildWake({
      from: fromClaim.claimKey,
      to: toClaim.claimKey,
      fromMember: fromClaim.member,
      toMember: toClaim.member,
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
    withLock(file, () => {
      const live = readAll(worktreePath);
      live.push(wake);
      atomicWrite(file, capLines(live));
    }, {});
  } catch {
    return { ok: false, code: WAKE_NO_CLAIM, detail: "store-failed" };
  }
  emitWakeOutcome(wake, "requested", worktreePath);
  emitWakeOutcome(wake, "delivered", worktreePath);
  return { ok: true, wake };
}

/** Best-effort claim-key string for audit payloads (never throws). */
function claimKeyOf(ref) {
  try {
    if (typeof ref === "string") return ref;
    if (ref && typeof ref === "object" && typeof ref.claimKey === "string") return ref.claimKey;
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * List wakes matching a filter (see matchWakeFilter), oldest first.
 * @param {object} [filter] {member, team, topic, threadId, includeAcked}
 * @param {string} [worktreePath]
 */
function listWakes(filter, worktreePath) {
  if (filter && typeof filter === "object" && typeof filter.worktreePath === "string" && worktreePath === undefined) {
    worktreePath = filter.worktreePath;
  }
  return readAll(worktreePath).filter((w) => matchWakeFilter(w, filter));
}

/**
 * Pure filter predicate for one wake. All fields optional: member matches
 * either endpoint's member slug, team/topic/threadId substring-or-exact
 * match, includeAcked (default hides acked). Never throws; null never
 * matches.
 */
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

/**
 * Acknowledge a wake. Only the target slot's holder can ack (same member
 * identity, live claim); anyone else gets `{ok:false, code:WAKE_DENIED}`.
 * Never throws.
 * @returns {{ok:boolean, code?:string, wake?:object}}
 */
function ackWake(id, opts, worktreePath) {
  const o = opts && typeof opts === "object" ? opts : {};
  if (o && typeof o.worktreePath === "string" && worktreePath === undefined) worktreePath = o.worktreePath;
  if (!id) return { ok: false, code: WAKE_DENIED, detail: "no-id" };
  const file = wakesFile(worktreePath);
  ensureWakesDir(file);
  let acker = null;
  try {
    acker = resolveLiveClaim(o.by !== undefined ? o.by : null, worktreePath, o.staleMs);
    if (!acker && (o.member || o.claimKey)) {
      acker = resolveLiveClaim(Object.assign({}, o, { worktreePath }), worktreePath, o.staleMs);
    }
  } catch {
    return { ok: false, code: WAKE_DENIED, detail: "lookup-failed" };
  }
  if (!acker) return { ok: false, code: WAKE_DENIED, detail: "no-live-acker" };
  let updated = null;
  let denied = WAKE_DENIED;
  try {
    withLock(file, () => {
      const current = readAll(worktreePath);
      const idx = current.findIndex((w) => w && w.id === id);
      if (idx === -1) {
        denied = "WAKE_UNKNOWN";
        return;
      }
      const wake = current[idx];
      // Holder-first: the exact target slot acks outright. Otherwise the
      // same-member fallback still acks (a renewed slot keeps its key, so
      // the exact hit is the common path; the fallback covers siblings).
      if (acker.claimKey !== wake.to &&
        memberOfClaimKey(wake.to) !== sanitizeWakeToken(acker.member) &&
        sanitizeWakeToken(wake.toMember) !== sanitizeWakeToken(acker.member)) {
        return;
      }
      const now = new Date().toISOString();
      current[idx] = Object.assign({}, wake, { status: "acked", ackedAt: now, ackedBy: acker.claimKey });
      updated = current[idx];
      atomicWrite(file, capLines(current));
    }, {});
  } catch {
    return { ok: false, code: WAKE_DENIED, detail: "store-failed" };
  }
  if (!updated) return { ok: false, code: denied, detail: "not-target" };
  return { ok: true, wake: updated };
}

/**
 * Extract `@member` mentions from a discussion body. Returns unique
 * lowercase member slugs in first-seen order; never throws.
 */
function parseMentions(body) {
  const out = [];
  const seen = new Set();
  const text = typeof body === "string" ? body : "";
  const re = /(^|[^a-z0-9_-])@([a-z0-9][a-z0-9-]*)/gi;
  let m = null;
  while ((m = re.exec(text)) !== null) {
    const slug = sanitizeWakeToken(m[2]);
    if (slug && !seen.has(slug)) {
      seen.add(slug);
      out.push(slug);
    }
  }
  return out;
}

/**
 * Discussion-post trigger: every `@member` in the message body (except the
 * author) gets a wake carrying the message's thread context
 * (threadId/topic/messageId/topology). Fail-open: returns an array of
 * `{mention, result}` (empty when no mentions); never throws.
 */
function triggerWakesForDiscussion(msg, opts) {
  try {
    const o = opts && typeof opts === "object" ? opts : {};
    if (!msg || typeof msg !== "object") return [];
    const mentions = parseMentions(msg.body);
    if (mentions.length === 0) return [];
    const authorMember = memberOfClaimKey(msg.from);
    const worktreePath = typeof o.worktreePath === "string" ? o.worktreePath : undefined;
    const out = [];
    for (const mention of mentions) {
      if (mention === authorMember) continue;
      let result = null;
      try {
        result = requestWake({
          from: msg.from,
          to: mention,
          team: msg.team,
          topic: msg.topic,
          threadId: msg.threadId || msg.topic,
          messageId: msg.id,
          topology: msg.topology,
          reason: "mention",
          workspace: o.workspace,
          worktreePath,
        });
      } catch {
        result = { ok: false, code: WAKE_NO_CLAIM, detail: "trigger-failed" };
      }
      out.push({ mention, result });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Dispatch-grant trigger: a granted backlog item wakes the assignee
 * (`reason: "assign"`). `opts.from` (the dispatching leader's claim or
 * identity) is required — without an attributable author the wake is
 * skipped fail-open. Never throws.
 */
function triggerWakeForGrant(grant, opts) {
  try {
    const o = opts && typeof opts === "object" ? opts : {};
    if (!grant || typeof grant !== "object" || grant.granted !== true) return null;
    if (o.from === undefined || o.from === null) return { ok: false, skipped: "no-from" };
    const member = typeof grant.member === "string" ? grant.member : null;
    if (!member) return null;
    return requestWake({
      from: o.from,
      to: member,
      team: grant.team,
      topic: o.topic || null,
      threadId: o.threadId || o.topic || null,
      messageId: o.messageId || null,
      topology: o.topology || null,
      reason: "assign",
      workspace: o.workspace,
      worktreePath: typeof o.worktreePath === "string" ? o.worktreePath : undefined,
    });
  } catch {
    return { ok: false, code: WAKE_NO_CLAIM, detail: "trigger-failed" };
  }
}

/**
 * Phase-outcome trigger: a `block` / `needs_human` outcome wakes the team's
 * leader/HOD slot so a person triages the stall. `from` is the run's own
 * claim context (`state.claimKey` / `outcome.claimKey`); without an
 * attributable author or a live leader slot there is no wake (null,
 * fail-open). Never throws.
 */
function wakeForPhaseOutcome(state, outcome, worktreePath) {
  try {
    const s = state && typeof state === "object" ? state : {};
    const oc = outcome && typeof outcome === "object" ? outcome : {};
    const decision = oc.decision || null;
    const needsHuman = decision === "block" || decision === "needs_human" || oc.needs_human === true;
    if (!needsHuman) return null;
    const fromRef = s.claimKey || oc.claimKey || null;
    if (!fromRef) return null;
    const fromClaim = resolveLiveClaim(fromRef, worktreePath);
    if (!fromClaim) return null;
    const team = sanitizeWakeToken(oc.team || s.team || fromClaim.teamId || fromClaim.team) || null;
    let claims = null;
    try {
      claims = require("./session-claims.js");
    } catch {
      return null;
    }
    const live = claims.listClaims({ worktreePath });
    const leaders = live
      .filter((c) => c && (c.role === "leader" || c.role === "hod") &&
        (!team || sanitizeWakeToken(c.teamId || c.team) === team) &&
        (fromClaim.workspaceSlug || null) === (c.workspaceSlug || null))
      .sort((a, b) => String(a.claimKey).localeCompare(String(b.claimKey)));
    if (leaders.length === 0) return null;
    const to = leaders[0];
    if (to.claimKey === fromClaim.claimKey) return null;
    const res = requestWake({
      from: fromClaim.claimKey,
      to: to.claimKey,
      team: team,
      topic: oc.phase || s.currentPhase || null,
      threadId: null,
      messageId: null,
      topology: null,
      reason: "escalate",
      workspace: fromClaim.workspace,
      worktreePath,
    });
    return res && res.ok ? res : null;
  } catch {
    return null;
  }
}

module.exports = {
  WAKE_CAP,
  WAKE_RATE_MAX,
  WAKE_RATE_WINDOW_MS,
  WAKES_FILE,
  WAKE_CROSS_SCOPE,
  WAKE_NO_CLAIM,
  WAKE_DENIED,
  WAKE_THROTTLED,
  defaultStateDir,
  wakesDir,
  wakesFile,
  legacyWakesFile,
  sanitizeWakeToken,
  memberOfClaimKey,
  teamOfClaimKey,
  isLiveClaim,
  resolveProjectSlug,
  buildWake,
  readAll,
  capLines,
  rateCount,
  resolveLiveClaim,
  requestWake,
  listWakes,
  matchWakeFilter,
  ackWake,
  parseMentions,
  triggerWakesForDiscussion,
  triggerWakeForGrant,
  wakeForPhaseOutcome,
};

"use strict";

/**
 * Claim management with SQLite backend, safe-write JSON fallback.
 *
 * When `node:sqlite` is available (via session-store.js), claims are stored
 * in the `claims` table partitioned by `project_slug`. When SQLite is
 * unavailable, every function falls back to `session-claims.js` (safe-write).
 *
 * All public APIs match session-claims.js so callers need no SQLite
 * awareness. Claim rows carry `project_slug` for per-project scoping.
 */

const path = require("node:path");
const { getDb, resolveProjectSlug } = require("./session-store.js");
const claimsLib = require("./session-claims.js");
const { normalizeServerUrl } = require("./opencode-synthetic.js");
const { TEAM_ACTIVATION_URL_ENV } = require("./constants.js");

/** 30-minute stale threshold for a member heartbeat. */
const STALE_MS = claimsLib.STALE_MS;

/* --- SQLite claim row shape ---------------------------------------------- */

function claimRowFromRecord(rec) {
  if (!rec) return null;
  let scope = rec.scope;
  if (typeof scope === "string") {
    try { scope = JSON.parse(scope); } catch { scope = []; }
  }
  if (!Array.isArray(scope)) scope = [];
  return {
    claimKey: rec.claim_key,
    member: rec.member,
    memberDisplay: rec.member_display,
    team: rec.team,
    teamId: rec.team_id,
    teamDisplay: rec.team_display,
    role: rec.role,
    scope,
    branch: rec.branch,
    sessionId: rec.session_id,
    workspace: rec.workspace,
    workspaceSlug: rec.workspace_slug,
    host: rec.host,
    serverUrl: rec.server_url || null,
    createdAt: rec.created_at,
    updatedAt: rec.updated_at,
    heartbeatAt: rec.heartbeat_at,
    renewed: rec.renewed === 1,
    stale: rec.stale === 1,
    projectSlug: rec.project_slug,
  };
}

/** Scope prefix overlap (same semantics as session-claims.scopesOverlap). */
function scopesOverlapSql(a, b) {
  const na = claimsLib.normalizeScope(a);
  const nb = claimsLib.normalizeScope(b);
  if (na.length === 0 || nb.length === 0) return false;
  if (na.includes("*") || nb.includes("*")) return true;
  return na.some((x) => nb.some((y) => x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`)));
}

/** Stale check on a claim row. */
function isStaleRow(claim, nowMs, thresh) {
  if (!claim || typeof claim !== "object") return false;
  const at = Date.parse(claim.heartbeatAt || claim.updatedAt || claim.createdAt || "");
  if (Number.isNaN(at)) return true;
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  return now - at > thresh;
}

/* --- Public API ---------------------------------------------------------- */

/**
 * Claim (or renew) a member slot. SQLite-primary, safe-write fallback.
 *
 * Slot reuse (default): when the member holds a LIVE slot for the same
 * team/workspace, renews that slot in place under the same claimKey and
 * returns it with `renewed: true`. Holder identity (claimKey/member/team/
 * sessionId/workspace) is preserved. Pass `{ newSlot: true }` to hatch a
 * parallel slot under a fresh session-scoped key.
 *
 * Throws an Error with `code: "SCOPE_CONFLICT"` when scope overlaps another
 * live member's scope (self-excluded on the renewed key).
 */
function claimSession(opts) {
  const o = opts || {};
  const projectSlug = resolveProjectSlug(o.workspace);
  const sessionId = (typeof o.sessionId === "string" && o.sessionId.length > 0)
    ? o.sessionId : claimsLib.resolveSessionId();
  const member = claimsLib.resolveMemberName(o.member, sessionId);
  const team = claimsLib.resolveTeamName(o.team);
  const role = claimsLib.resolveRole(o.role);
  const scope = claimsLib.normalizeScope(o.scope);
  const workspaceSlug = claimsLib.sanitizeName(o.workspaceSlug) || path.basename(String(o.workspace || process.env.PCORE_WORKSPACE_ROOT || process.cwd() || "root")).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "") || "root";
  const key = claimsLib.claimKey({ team, member, workspaceSlug, sessionId });
  const serverUrl = normalizeServerUrl(o.serverUrl !== undefined ? o.serverUrl : process.env[TEAM_ACTIVATION_URL_ENV]);

  const db = getDb();
  if (db) {
    return claimSessionSqlite(db, { projectSlug, sessionId, member, team, role, scope, workspaceSlug, key, serverUrl, opts: o });
  }
  return claimsLib.claimSession(Object.assign({}, o, { serverUrl }));
}

function claimSessionSqlite(db, { projectSlug, sessionId, member, team, role, scope, workspaceSlug, key, serverUrl, opts }) {
  const now = new Date().toISOString();
  const explicitSession = typeof opts.sessionId === "string" && opts.sessionId.length > 0;
  const newSlot = opts.newSlot === true;

  // Find live slot for reuse
  let reuse = null;
  if (!newSlot) {
    const rows = db.prepare(`
      SELECT * FROM claims
      WHERE member = @member AND team = @team AND workspace_slug = @workspaceSlug
        AND project_slug = @projectSlug
    `).all({
      member, team, workspaceSlug, projectSlug,
    });
    const thresh = Number.isFinite(opts.staleMs) ? opts.staleMs : STALE_MS;
    const nowMs = Date.now();
    for (const rec of rows) {
      const row = claimRowFromRecord(rec);
      if (!row || isStaleRow(row, nowMs, thresh)) continue;
      // Explicit session pinning: an explicit sessionId differing from the
      // holder's mints a fresh slot; implicit renews in place.
      if (explicitSession && row.sessionId !== sessionId) continue;
      reuse = row;
      break;
    }
  }

  const activeKey = reuse ? reuse.claimKey : key;

  // Scope conflict check (under SQLite's own locking; no advisory lock needed)
  if (scope.length > 0 && !opts.allowOverlap) {
    const conflicts = db.prepare(`
      SELECT * FROM claims
      WHERE claim_key != @activeKey AND project_slug = @projectSlug
        AND member != @member AND stale = 0
    `).all({ activeKey, projectSlug, member });
    const nowMs = Date.now();
    const thresh = Number.isFinite(opts.staleMs) ? opts.staleMs : STALE_MS;
    const overlapping = [];
    for (const rec of conflicts) {
      const row = claimRowFromRecord(rec);
      if (!row || isStaleRow(row, nowMs, thresh)) continue;
      if (scopesOverlapSql(row.scope, scope)) overlapping.push(row);
    }
    if (overlapping.length > 0) {
      const err = new Error(
        `scope conflict: ${member}@${workspaceSlug} overlaps ${overlapping.map((c) => `${c.memberDisplay} [${(c.scope || []).join(",")}]`).join("; ")}`
      );
      err.code = "SCOPE_CONFLICT";
      err.conflicts = overlapping.map((c) => c.claimKey);
      throw err;
    }
  }

  const roleExplicit = opts.role !== undefined || !!process.env.PCORE_MEMBER_ROLE;
  const branch = typeof opts.branch === "string" && opts.branch
    ? opts.branch
    : (reuse ? (reuse.branch || claimsLib.memberBranch({ team, member })) : claimsLib.memberBranch({ team, member }));

  let stored;
  if (reuse) {
    stored = {
      claimKey: reuse.claimKey,
      member: reuse.member,
      memberDisplay: reuse.memberDisplay,
      team: reuse.team,
      teamId: reuse.teamId,
      teamDisplay: reuse.teamDisplay,
      role: roleExplicit ? role : reuse.role || role,
      scope: opts.scope === undefined ? reuse.scope : scope,
      branch,
      sessionId: reuse.sessionId,
      workspace: reuse.workspace,
      workspaceSlug: reuse.workspaceSlug,
      host: opts.host || reuse.host || null,
      serverUrl: serverUrl || reuse.serverUrl || null,
      createdAt: reuse.createdAt || now,
      updatedAt: now,
      heartbeatAt: now,
      renewed: true,
      projectSlug,
    };
    db.prepare(`
      UPDATE claims SET
        member_display = @memberDisplay, team = @team, team_id = @teamId,
        team_display = @teamDisplay, role = @role, scope = @scope,
        branch = @branch, host = @host, server_url = @serverUrl,
        updated_at = @updatedAt, heartbeat_at = @heartbeatAt, renewed = 1
      WHERE claim_key = @claimKey AND project_slug = @projectSlug
    `).run({
      memberDisplay: stored.memberDisplay, team: stored.team, teamId: stored.teamId,
      teamDisplay: stored.teamDisplay, role: stored.role,
      scope: JSON.stringify(stored.scope), branch: stored.branch,
      host: stored.host, serverUrl: stored.serverUrl,
      updatedAt: stored.updatedAt, heartbeatAt: stored.heartbeatAt,
      claimKey: stored.claimKey, projectSlug: stored.projectSlug,
    });
  } else {
    stored = {
      claimKey: key,
      member,
      memberDisplay: claimsLib.displayFor({ team, member, workspaceSlug }).display,
      team: team,
      teamId: team,
      teamDisplay: claimsLib.displayFor({ team, member, workspaceSlug }).teamDisplay,
      role,
      scope,
      branch,
      sessionId,
      workspace: opts.workspace || process.env.PCORE_WORKSPACE_ROOT || process.cwd() || "",
      workspaceSlug,
      host: opts.host || null,
      serverUrl: serverUrl || null,
      createdAt: now,
      updatedAt: now,
      heartbeatAt: now,
      renewed: false,
      projectSlug,
    };
    db.prepare(`
      INSERT INTO claims (
        claim_key, project_slug, member, member_display, team, team_id,
        team_display, role, scope, branch, session_id, workspace,
        workspace_slug, host, server_url, created_at, updated_at,
        heartbeat_at, renewed, stale
      ) VALUES (
        @claimKey, @projectSlug, @member, @memberDisplay, @team, @teamId,
        @teamDisplay, @role, @scope, @branch, @sessionId, @workspace,
        @workspaceSlug, @host, @serverUrl, @createdAt, @updatedAt, @heartbeatAt, 0, 0
      )
    `).run({
      claimKey: stored.claimKey, projectSlug: stored.projectSlug, member: stored.member,
      memberDisplay: stored.memberDisplay, team: stored.team, teamId: stored.teamId,
      teamDisplay: stored.teamDisplay, role: stored.role,
      scope: JSON.stringify(stored.scope), branch: stored.branch,
      sessionId: stored.sessionId, workspace: stored.workspace,
      workspaceSlug: stored.workspaceSlug, host: stored.host,
      serverUrl: stored.serverUrl,
      createdAt: stored.createdAt, updatedAt: stored.updatedAt,
      heartbeatAt: stored.heartbeatAt,
    });
  }

  return stored;
}

/**
 * Find a member's LIVE (non-stale) slot by identity — member + team +
 * workspace slug, any session.
 */
function findLiveSlot(opts) {
  const o = opts || {};
  const projectSlug = resolveProjectSlug(o.workspace);
  const sessionId = o.sessionId || claimsLib.resolveSessionId();
  const member = claimsLib.sanitizeName(o.member) || claimsLib.resolveMemberName(o.member, sessionId);
  const team = claimsLib.resolveTeamName(o.team);
  const workspaceSlug = claimsLib.sanitizeName(o.workspaceSlug) || path.basename(String(o.workspace || process.env.PCORE_WORKSPACE_ROOT || process.cwd() || "root")).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "") || "root";

  const db = getDb();
  if (db) {
    const rows = db.prepare(`
      SELECT * FROM claims
      WHERE member = @member AND team = @team AND workspace_slug = @workspaceSlug
        AND project_slug = @projectSlug
    `).all({ member, team, workspaceSlug, projectSlug });
    const thresh = Number.isFinite(o.staleMs) ? o.staleMs : STALE_MS;
    const nowMs = Date.now();
    for (const rec of rows) {
      const row = claimRowFromRecord(rec);
      if (!o.includeStale && isStaleRow(row, nowMs, thresh)) continue;
      return row;
    }
    return null;
  }
  return claimsLib.findLiveSlot(o);
}

/** Touch the heartbeat of an existing claim; null when unknown. */
function heartbeatClaim(opts) {
  const o = opts || {};
  const projectSlug = resolveProjectSlug(o.workspace);
  const sessionId = o.sessionId || claimsLib.resolveSessionId();
  const member = claimsLib.resolveMemberName(o.member, sessionId);
  const team = claimsLib.resolveTeamName(o.team);
  const workspaceSlug = claimsLib.sanitizeName(o.workspaceSlug) || path.basename(String(o.workspace || process.env.PCORE_WORKSPACE_ROOT || process.cwd() || "root")).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "") || "root";
  const key = o.claimKey || claimsLib.claimKey({ team, member, workspaceSlug, sessionId });

  const db = getDb();
  if (db) {
    const now = new Date().toISOString();
    const row = db.prepare(`
      SELECT * FROM claims WHERE claim_key = @claimKey AND project_slug = @projectSlug
    `).get({ claimKey: key, projectSlug });
    if (!row) return null;
    db.prepare(`
      UPDATE claims SET heartbeat_at = @heartbeatAt, updated_at = @updatedAt
      WHERE claim_key = @claimKey AND project_slug = @projectSlug
    `).run({ heartbeatAt: now, updatedAt: now, claimKey: key, projectSlug });
    return claimRowFromRecord(Object.assign({}, row, { heartbeat_at: now, updated_at: now }));
  }
  return claimsLib.heartbeatClaim(o);
}

/** Release a claim; returns true when a claim was removed. */
function releaseClaim(opts) {
  const o = opts || {};
  const projectSlug = resolveProjectSlug(o.workspace);
  const sessionId = o.sessionId || claimsLib.resolveSessionId();
  const member = claimsLib.resolveMemberName(o.member, sessionId);
  const team = claimsLib.resolveTeamName(o.team);
  const workspaceSlug = claimsLib.sanitizeName(o.workspaceSlug) || path.basename(String(o.workspace || process.env.PCORE_WORKSPACE_ROOT || process.cwd() || "root")).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "") || "root";
  const key = o.claimKey || claimsLib.claimKey({ team, member, workspaceSlug, sessionId });

  const db = getDb();
  if (db) {
    // When an explicit claimKey is given, the caller may not know its project
    // (e.g. releaseClaim({claimKey}) from a wake test). Resolve the row first
    // so the DELETE is scoped to the claim's real partition, not the caller's
    // cwd-derived slug — otherwise cross-project releases silently no-op.
    let targetSlug = projectSlug;
    if (o.claimKey && !o.workspace) {
      const found = db.prepare(`SELECT project_slug FROM claims WHERE claim_key = @claimKey LIMIT 1`)
        .get({ claimKey: key });
      if (found && found.project_slug) targetSlug = found.project_slug;
    }
    const result = db.prepare(`
      DELETE FROM claims WHERE claim_key = @claimKey AND project_slug = @projectSlug
    `).run({ claimKey: key, projectSlug: targetSlug });
    return (result.changes || 0) > 0;
  }
  return claimsLib.releaseClaim(o);
}

/** Fetch one claim by key; null when missing. */
function getClaim(claimKeyStr, worktreePath) {
  if (!claimKeyStr) return null;
  const db = getDb();
  if (db) {
    const row = db.prepare(`
      SELECT * FROM claims WHERE claim_key = @claimKey LIMIT 1
    `).get({ claimKey: String(claimKeyStr) });
    return claimRowFromRecord(row);
  }
  return claimsLib.getClaim(claimKeyStr, worktreePath);
}

/**
 * Find a member's claim by identity (member/team/session/workspace) or by
 * explicit claimKey. Null when the member holds no claim.
 */
function findClaim(opts) {
  const o = opts || {};
  if (o.claimKey) return getClaim(o.claimKey, o.worktreePath);
  const projectSlug = resolveProjectSlug(o.workspace);
  const sessionId = o.sessionId || claimsLib.resolveSessionId();
  const member = claimsLib.resolveMemberName(o.member, sessionId);
  const team = claimsLib.resolveTeamName(o.team);
  const workspaceSlug = claimsLib.sanitizeName(o.workspaceSlug) || path.basename(String(o.workspace || process.env.PCORE_WORKSPACE_ROOT || process.cwd() || "root")).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "") || "root";
  const key = claimsLib.claimKey({ team, member, workspaceSlug, sessionId });

  const db = getDb();
  if (db) {
    const row = db.prepare(`
      SELECT * FROM claims WHERE claim_key = @claimKey AND project_slug = @projectSlug
    `).get({ claimKey: key, projectSlug });
    return claimRowFromRecord(row);
  }
  return claimsLib.findClaim(o);
}

/** List claims. By default only live (non-stale); pass { includeStale: true }
 *  for the full roster including stale entries (each annotated `stale`). */
function listClaims(opts) {
  const o = opts || {};
  const projectSlug = resolveProjectSlug(o.workspace);
  const db = getDb();
  if (db) {
    const thresh = Number.isFinite(o.staleMs) ? o.staleMs : STALE_MS;
    const nowMs = Date.now();
    const rows = db.prepare(`
      SELECT * FROM claims WHERE project_slug = @projectSlug
    `).all({ projectSlug });
    let list = rows.map((rec) => {
      const row = claimRowFromRecord(rec);
      if (!row) return null;
      row.stale = isStaleRow(row, nowMs, thresh);
      return row;
    }).filter(Boolean);
    if (!o.includeStale) list = list.filter((c) => !c.stale);
    list.sort((a, b) => String(a.claimKey).localeCompare(String(b.claimKey)));
    return list;
  }
  return claimsLib.listClaims(o);
}

/** Prune stale claims; returns the pruned claim keys. */
function gcClaims(opts) {
  const o = opts || {};
  const projectSlug = resolveProjectSlug(o.workspace);
  const db = getDb();
  if (db) {
    const thresh = Number.isFinite(o.staleMs) ? o.staleMs : STALE_MS;
    const nowMs = Date.now();
    const cutoff = new Date(nowMs - thresh).toISOString();
    const rows = db.prepare(`
      SELECT claim_key, heartbeat_at, updated_at, created_at FROM claims
      WHERE project_slug = @projectSlug
    `).all({ projectSlug });
    const pruned = [];
    for (const rec of rows) {
      const at = Date.parse(rec.heartbeat_at || rec.updated_at || rec.created_at || "");
      if (Number.isNaN(at) || nowMs - at > thresh) {
        db.prepare(`DELETE FROM claims WHERE claim_key = @claimKey AND project_slug = @projectSlug`)
          .run({ claimKey: rec.claim_key, projectSlug });
        pruned.push(rec.claim_key);
      }
    }
    return pruned;
  }
  return claimsLib.gcClaims(o);
}

/** Group claims by team (pure projection, delegates to session-claims). */
function groupByTeam(claimsList) {
  return claimsLib.groupByTeam(claimsList);
}

/** Resolved state dir for shared team claims. */
function claimsDir() {
  return require("./session-store.js").resolveStateDir();
}

/** Default state dir (delegates to session-claims). */
function defaultStateDir() {
  return claimsLib.defaultStateDir();
}

/** Resolve session id (delegates to session-claims). */
function resolveSessionId() {
  return claimsLib.resolveSessionId();
}

/** Find scope conflicts (delegates to session-claims). */
function findScopeConflicts(opts) {
  return claimsLib.findScopeConflicts(opts);
}

/** List claims by options (remote SQLite line compatibility). */
function getClaims(opts) {
  return listClaims(opts);
}

/** Capitalize for display (remote SQLite line compatibility). */
function capName(slug) {
  if (!slug) return "";
  return String(slug).charAt(0).toUpperCase() + String(slug).slice(1);
}

module.exports = {
  CLAIMS_FILE: claimsLib.CLAIMS_FILE,
  claimsFile: claimsLib.claimsFile,
  capName,
  resolveProjectSlug,
  getClaims,
  STALE_MS,
  claimSession,
  findLiveSlot,
  heartbeatClaim,
  releaseClaim,
  getClaim,
  findClaim,
  listClaims,
  gcClaims,
  groupByTeam,
  claimsDir,
  defaultStateDir,
  resolveSessionId,
  findScopeConflicts,
  scopesOverlap: scopesOverlapSql,
  normalizeScope: claimsLib.normalizeScope,
  memberBranch: claimsLib.memberBranch,
  sanitizeName: claimsLib.sanitizeName,
  resolveMemberName: claimsLib.resolveMemberName,
  resolveTeamName: claimsLib.resolveTeamName,
  resolveRole: claimsLib.resolveRole,
  claimKey: claimsLib.claimKey,
  displayFor: claimsLib.displayFor,
  isStaleClaim: claimsLib.isStaleClaim,
  isPathInScope: claimsLib.isPathInScope,
  assertScopeForFiles: claimsLib.assertScopeForFiles,
  isDestructiveGitCommand: claimsLib.isDestructiveGitCommand,
};

"use strict";

/**
 * Team dispatch planner (WI-9 fan-out: `dispatch --team Alpha`).
 *
 * Pure planning layer over `project-manager.backlogByMember`: one dispatch
 * record per member of a team, sorted deterministically by member key so any
 * N (2 now, many later) fans out without hardcoded rosters.
 *
 * Purity contract (invariants 15/19/32/33): no fs, no child_process, no
 * process.env reads. All inputs arrive via arguments; all outputs are plain
 * JSON-safe objects. Side effects (claim, worktree mkdir, spawn) belong to
 * the CLI / conductor caller, which continues past SCOPE_CONFLICT skips
 * (see `shouldSkipOnConflict`).
 */

const path = require("node:path");

/** Exit codes for the dispatch CLI loop. */
const DISPATCH_EXITS = {
  OK: 0,
  PARTIAL: 2,
  ERROR: 1,
};

/**
 * Lowercase slug form (mirrors session-claims.sanitizeName; kept inline so
 * this module has zero requires beyond node:path and stays byte-mirrorable).
 */
function sanitizeDispatchToken(raw) {
  if (raw === undefined || raw === null) return "";
  return String(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Capitalize for display: "john" -> "John". */
function capDispatchToken(slug) {
  if (!slug) return "";
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

/**
 * Normalize a claimed scope: comma-separated string or path-prefix array.
 * "*" claims the whole repo. Empty input claims nothing (never conflicts).
 * @returns {string[]} cleaned scope prefixes ("*" preserved verbatim)
 */
function normalizeDispatchScope(scope) {
  const raw = Array.isArray(scope) ? scope : String(scope || "").split(",");
  const out = [];
  for (const part of raw) {
    if (part === undefined || part === null) continue;
    const s = String(part).trim().replace(/^\.\//, "").replace(/\/+$/, "");
    if (!s) continue;
    if (s === "*") return ["*"];
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

/** Per-member branch name for commit discipline: member/<team>/<member>. */
function dispatchBranch(parts) {
  const p = parts || {};
  const team = sanitizeDispatchToken(p.team) || "solo";
  const member = sanitizeDispatchToken(p.member) || "unknown";
  return `member/${team}/${member}`;
}

/**
 * Derive one member's file scope from its backlog items. Items may carry
 * `scope` (string/array), `files` (array) or `paths` (array); everything is
 * normalized so overlapping members hit the SCOPE_CONFLICT guard instead of
 * silently sharing files. Items without scope info contribute nothing.
 */
function scopeForItems(items) {
  const collected = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== "object") continue;
    if (item.scope !== undefined) {
      const parts = Array.isArray(item.scope) ? item.scope : String(item.scope).split(",");
      for (const p of parts) collected.push(p);
    }
    for (const key of ["files", "paths"]) {
      if (Array.isArray(item[key])) {
        for (const p of item[key]) collected.push(p);
      }
    }
  }
  return normalizeDispatchScope(collected);
}

/**
 * Plan one dispatch record per member of a team.
 *
 * @param {object} opts
 *   - teamId {string} required (sanitized; unknown team -> [])
 *   - teams {object} `backlogByMember(ps).teams` (or the full projection)
 *   - members {string[]} optional allowlist filter (sanitized, sorted)
 *   - sessionId {string} base session id (default "dispatch")
 *   - workspaceSlug {string} (default "root")
 *   - workspace {string} workspace root (informational only)
 *   - worktreeBase {string} optional base dir for per-member worktrees
 * @returns {object[]} dispatch plans sorted by member (deterministic for any N)
 */
function planDispatch(opts) {
  const o = opts || {};
  const teamId = sanitizeDispatchToken(o.teamId);
  if (!teamId) return [];
  const teams = (o.teams && typeof o.teams === "object" ? o.teams : {}) || {};
  const group = teams[teamId];
  if (!group || typeof group !== "object") return [];
  const byMember =
    group.byMember && typeof group.byMember === "object" ? group.byMember : {};
  const rawKeys = Object.keys(byMember).filter(
    (k) => k && Array.isArray(byMember[k])
  );
  rawKeys.sort((a, b) =>
    sanitizeDispatchToken(a).localeCompare(sanitizeDispatchToken(b))
  );
  let selected = rawKeys;
  if (Array.isArray(o.members) && o.members.length > 0) {
    const allow = new Set(
      o.members.map((m) => sanitizeDispatchToken(m)).filter(Boolean)
    );
    selected = rawKeys.filter((k) => allow.has(sanitizeDispatchToken(k)));
  }
  if (selected.length === 0) return [];
  const sessionId =
    typeof o.sessionId === "string" && o.sessionId ? o.sessionId : "dispatch";
  const workspaceSlug = sanitizeDispatchToken(o.workspaceSlug) || "root";
  const workspace = typeof o.workspace === "string" ? o.workspace : null;
  const worktreeBase =
    typeof o.worktreeBase === "string" && o.worktreeBase ? o.worktreeBase : null;
  return selected.map((rawKey) => {
    const member = sanitizeDispatchToken(rawKey);
    const items = Array.isArray(byMember[rawKey]) ? byMember[rawKey] : [];
    const scope = scopeForItems(items);
    const teamDisplay = `${capDispatchToken(teamId)}/${capDispatchToken(member)}@${workspaceSlug}`;
    return {
      team: teamId,
      teamId,
      member,
      memberKey: member,
      memberDisplay: `${capDispatchToken(member)}@${workspaceSlug}`,
      teamDisplay,
      claimKey: [teamId, member, workspaceSlug, String(sessionId)].join("/"),
      branch: dispatchBranch({ team: teamId, member }),
      scope,
      items,
      itemCount: items.length,
      sessionId: String(sessionId),
      workspaceSlug,
      workspace,
      worktreePath: worktreeBase
        ? path.join(worktreeBase, `${teamId}-${member}`)
        : null,
    };
  });
}

/**
 * Guard contract (invariant 32): a SCOPE_CONFLICT claim failure is a skip —
 * the dispatch loop records it and continues with the next member. Any other
 * error is a real failure and must propagate.
 */
function shouldSkipOnConflict(err) {
  return !!err && err.code === "SCOPE_CONFLICT";
}

/**
 * Additive spawn payload (invariant 33): member/team/claimKey ride along
 * without removing caller keys. Explicit payload fields win; dispatch plan
 * fills the rest.
 */
function buildDispatchPayload(plan, extra) {
  const p = plan && typeof plan === "object" ? plan : {};
  const e = extra && typeof extra === "object" ? extra : {};
  return {
    ...e,
    member: typeof e.member === "string" && e.member ? e.member : p.member || null,
    team: typeof e.team === "string" && e.team ? e.team : p.team || null,
    claimKey:
      typeof e.claimKey === "string" && e.claimKey ? e.claimKey : p.claimKey || null,
    branch: typeof e.branch === "string" && e.branch ? e.branch : p.branch || null,
    worktreePath:
      e.worktreePath !== undefined ? e.worktreePath : p.worktreePath || null,
    scope: e.scope !== undefined ? e.scope : p.scope || [],
  };
}

/** Stable JSON serialization of a dispatch plan list (sorted input). */
function serializeDispatch(plans) {
  return JSON.stringify(Array.isArray(plans) ? plans : [], null, 2);
}

module.exports = {
  DISPATCH_EXITS,
  sanitizeDispatchToken,
  normalizeDispatchScope,
  dispatchBranch,
  scopeForItems,
  planDispatch,
  shouldSkipOnConflict,
  buildDispatchPayload,
  serializeDispatch,
};

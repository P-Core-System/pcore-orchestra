"use strict";

/**
 * Named cross-CLI team sessions (John / James / Mark ...).
 *
 * Each member claims a slot keyed by team + member + workspace slug +
 * session id, so the same name in different teams stays distinct:
 *   claimKey = "<team>/<member>/<slug>/<sessionId>"
 * Display forms: "Name@slug" (solo) and "Team/Member@slug" (teamed).
 *
 * Claims live in the unified shared state dir (`PCORE_STATE_DIR` wins via
 * safe-write.resolveStateDir, otherwise the shared
 * `~/.config/opencode/hooks/state` dir). The team roster is intentionally
 * NOT worktree-partitioned: pairing needs one shared roster across sessions
 * (carve-out from invariants 30/31 — conductor runs and domain events stay
 * partitioned). `worktreePath` is accepted for legacy import only: a
 * pre-unify `<worktree>/.pcore/state/team-sessions.json` is merged into
 * reads (shared wins on key conflict), writes always go shared.
 *
 * Every write goes through safe-write.js (withLock + readJsonSafe +
 * writeJson) — never raw fs writes on shared state (invariant 15).
 * Stale claims (heartbeat older than STALE_MS) read as stale and are
 * pruned by gcClaims; a crashed session can never deadlock a team.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { withLock, readJsonSafe, writeJson, resolveStateDir } = require("./safe-write.js");

/** 30-minute stale threshold for a member heartbeat. */
const STALE_MS = 30 * 60 * 1000;

const CLAIMS_FILE = "team-sessions.json";
const FALLBACK_PREFIX = "ses-";

/** Default shared state dir (alongside the other state writers). */
function defaultStateDir() {
  return path.join(os.homedir(), ".config", "opencode", "hooks", "state");
}

/** Resolved state dir: PCORE_STATE_DIR wins, never inside the bundle.
 * Always the shared team dir — worktreePath is legacy-import only. */
function claimsDir(worktreePath) {
  void worktreePath;
  return resolveStateDir(defaultStateDir());
}

function claimsFile(worktreePath) {
  return path.join(claimsDir(worktreePath), CLAIMS_FILE);
}

/**
 * Legacy worktree-partitioned claims file (pre-unify layout). Read for
 * import only — writes never target it.
 * @returns {string|null} legacy file path, or null without a worktree
 */
function legacyClaimsFile(worktreePath) {
  if (worktreePath && typeof worktreePath === "string" && worktreePath.length > 0) {
    return path.join(worktreePath, ".pcore", "state", CLAIMS_FILE);
  }
  return null;
}

/** Read a legacy claims object; corrupt/missing -> {}. */
function readLegacyClaims(worktreePath) {
  const file = legacyClaimsFile(worktreePath);
  if (!file) return {};
  const data = readJsonSafe(file, {});
  return data && typeof data === "object" && !Array.isArray(data) ? data : {};
}

function ensureDir(filePath) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  } catch {
    /* best effort — safe-write surfaces a real error */
  }
}

/**
 * Sanitize a member/team/role token: lowercase slug form.
 * Empty or unsanitizable input yields "".
 */
function sanitizeName(raw) {
  if (raw === undefined || raw === null) return "";
  const out = String(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return out;
}

/** Capitalize for display: "john" -> "John". */
function capName(slug) {
  if (!slug) return "";
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

/** Session id chain (mirrors conductor-state/state-manager precedence). */
function resolveSessionId() {
  return (
    process.env.PCORE_SESSION_ID ||
    process.env.OPENCODE_SESSION_ID ||
    process.env.CLAUDE_SESSION_ID ||
    process.env.CURSOR_TRACE_ID ||
    process.env.QODER_SESSION_ID ||
    process.env.QODER_PID ||
    `pid-${process.pid}`
  );
}

/** Workspace slug chain (mirrors conductor-state.resolveWorkspace). */
function resolveSlug(workspace) {
  const root = process.env.PCORE_WORKSPACE_ROOT || workspace || process.cwd() || process.env.PWD || "root";
  const base = path.basename(String(root));
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return { root: String(root), slug: slug || "root" };
}

/**
 * Resolve the member name: explicit --member wins, then PCORE_MEMBER_NAME,
 * else the ses_xxxx fallback derived from the session id.
 */
function resolveMemberName(explicit, sessionId) {
  const clean = sanitizeName(explicit);
  if (clean) return clean;
  const fromEnv = sanitizeName(process.env.PCORE_MEMBER_NAME);
  if (fromEnv) return fromEnv;
  const sid = String(sessionId || resolveSessionId()).replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  const tail = (sid.slice(-4) || "xxxx").padStart(4, "x");
  return `${FALLBACK_PREFIX}${tail}`;
}

/** Resolve the team: explicit --team wins, then PCORE_TEAM_NAME, else "". */
function resolveTeamName(explicit) {
  const clean = sanitizeName(explicit);
  if (clean) return clean;
  return sanitizeName(process.env.PCORE_TEAM_NAME);
}

/** Resolve the role: explicit --role wins, then PCORE_MEMBER_ROLE, else "member". */
function resolveRole(explicit) {
  const clean = sanitizeName(explicit);
  if (clean) return clean;
  return sanitizeName(process.env.PCORE_MEMBER_ROLE) || "member";
}

/**
 * Stable claim key: team + member + slug + sessionId.
 * Unteamed members key on "-" so solo and teamed claims never collide.
 */
function claimKey(parts) {
  const p = parts || {};
  const team = sanitizeName(p.team) || "-";
  const member = sanitizeName(p.member) || "unknown";
  const slug = sanitizeName(p.workspaceSlug) || "root";
  const sid = String(p.sessionId || "");
  return [team, member, slug, sid].join("/");
}

/** Display forms: { display: "John@slug", teamDisplay: "Team-A/John@slug" }. */
function displayFor(parts) {
  const p = parts || {};
  const member = sanitizeName(p.member);
  const team = sanitizeName(p.team);
  const slug = sanitizeName(p.workspaceSlug) || "root";
  const display = `${capName(member) || "?"}@${slug}`;
  const teamDisplay = team ? `${capName(team)}/${capName(member)}@${slug}` : display;
  return { display, teamDisplay };
}

/** True when the claim heartbeat is older than STALE_MS (default 30 min). */
function isStaleClaim(claim, nowMs, staleMs) {
  if (!claim || typeof claim !== "object") return false;
  const thresh = Number.isFinite(staleMs) ? staleMs : STALE_MS;
  const at = Date.parse(claim.heartbeatAt || claim.updatedAt || claim.createdAt || "");
  if (Number.isNaN(at)) return true;
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  return now - at > thresh;
}

/** Read all claims (object keyed by claimKey); corrupt/missing -> {}.
 * With worktreePath, a legacy worktree-partitioned file is merged in
 * (shared wins on key conflict) so pre-unify slots stay visible. */
function readAll(worktreePath) {
  const data = readJsonSafe(claimsFile(worktreePath), {});
  const shared = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  const legacy = readLegacyClaims(worktreePath);
  const legKeys = Object.keys(legacy);
  if (legKeys.length === 0) return shared;
  const merged = {};
  for (const k of legKeys) merged[k] = legacy[k];
  for (const k of Object.keys(shared)) merged[k] = shared[k];
  return merged;
}

/**
 * Claim (or renew) a member slot. Upserts under an advisory lock.
 * Scope (`--scope`, string or array) declares the files this member will
 * touch: a claim whose scope overlaps another LIVE member's scope conflicts
 * and is blocked unless `allowOverlap` is set — renewing the same claimKey
 * never conflicts with itself. Throws an Error with `code:
 * "SCOPE_CONFLICT"` and a `conflicts` array when blocked.
 */
function claimSession(opts) {
  const o = opts || {};
  const ws = resolveSlug(o.workspace);
  const sessionId = o.sessionId || resolveSessionId();
  const member = resolveMemberName(o.member, sessionId);
  const team = resolveTeamName(o.team);
  const role = resolveRole(o.role);
  const scope = normalizeScope(o.scope);
  const workspaceSlug = sanitizeName(o.workspaceSlug) || ws.slug;
  const key = claimKey({ team, member, workspaceSlug, sessionId });
  const shown = displayFor({ team, member, workspaceSlug });
  const conflicts = findScopeConflicts({
    scope,
    excludeKey: key,
    worktreePath: o.worktreePath,
    staleMs: o.staleMs,
  });
  if (conflicts.length > 0 && !o.allowOverlap) {
    const err = new Error(
      `scope conflict: ${member}@${workspaceSlug} overlaps ${conflicts.map((c) => `${c.memberDisplay} [${(c.scope || []).join(",")}]`).join("; ")}`
    );
    err.code = "SCOPE_CONFLICT";
    err.conflicts = conflicts.map((c) => c.claimKey);
    throw err;
  }
  const now = new Date().toISOString();
  const file = claimsFile(o.worktreePath);
  ensureDir(file);
  let stored = null;
  withLock(
    file,
    () => {
      const current = readAll(o.worktreePath);
      const prev = current[key];
      // Re-check under the lock: a concurrent claim may have landed first.
      if (!o.allowOverlap && scope.length > 0) {
        const raced = Object.values(current).filter(
          (c) => c && c.claimKey !== key && !isStaleClaim(c, Date.now(), o.staleMs) && scopesOverlap(c.scope, scope)
        );
        if (raced.length > 0) {
          const err = new Error(
            `scope conflict: ${member}@${workspaceSlug} overlaps ${raced.map((c) => `${c.memberDisplay} [${(c.scope || []).join(",")}]`).join("; ")}`
          );
          err.code = "SCOPE_CONFLICT";
          err.conflicts = raced.map((c) => c.claimKey);
          throw err;
        }
      }
      stored = {
        claimKey: key,
        member,
        memberDisplay: shown.display,
        team: team || null,
        teamId: team || null,
        teamDisplay: shown.teamDisplay,
        role,
        scope,
        branch: typeof o.branch === "string" && o.branch ? o.branch : memberBranch({ team, member }),
        sessionId,
        workspace: o.workspace || ws.root,
        workspaceSlug,
        host: o.host || null,
        createdAt: (prev && prev.createdAt) || now,
        updatedAt: now,
        heartbeatAt: now,
      };
      current[key] = stored;
      writeJson(file, current);
    },
    { waitMs: o.waitMs }
  );
  return stored;
}

/** Touch the heartbeat of an existing claim; null when unknown. */
function heartbeatClaim(opts) {
  const o = opts || {};
  const file = claimsFile(o.worktreePath);
  ensureDir(file);
  let stored = null;
  withLock(
    file,
    () => {
      const current = readAll(o.worktreePath);
      const key = o.claimKey || claimKey({
        team: resolveTeamName(o.team),
        member: resolveMemberName(o.member, o.sessionId),
        workspaceSlug: sanitizeName(o.workspaceSlug) || resolveSlug(o.workspace).slug,
        sessionId: o.sessionId || resolveSessionId(),
      });
      const prev = current[key];
      if (!prev) return;
      stored = Object.assign({}, prev, {
        heartbeatAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      current[key] = stored;
      writeJson(file, current);
    },
    { waitMs: o.waitMs }
  );
  return stored;
}

/** Release a claim; returns true when a claim was removed. */
function releaseClaim(opts) {
  const o = opts || {};
  const file = claimsFile(o.worktreePath);
  ensureDir(file);
  let removed = false;
  withLock(
    file,
    () => {
      const current = readAll(o.worktreePath);
      const key = o.claimKey || claimKey({
        team: resolveTeamName(o.team),
        member: resolveMemberName(o.member, o.sessionId),
        workspaceSlug: sanitizeName(o.workspaceSlug) || resolveSlug(o.workspace).slug,
        sessionId: o.sessionId || resolveSessionId(),
      });
      if (current[key]) {
        delete current[key];
        removed = true;
        writeJson(file, current);
      }
    },
    { waitMs: o.waitMs }
  );
  return removed;
}

/** Fetch one claim by key; null when missing. */
function getClaim(claimKeyStr, worktreePath) {
  if (!claimKeyStr) return null;
  return readAll(worktreePath)[String(claimKeyStr)] || null;
}

/**
 * Find a member's claim by identity (member/team/session/workspace) or by
 * explicit claimKey. Null when the member holds no claim.
 */
function findClaim(opts) {
  const o = opts || {};
  if (o.claimKey) return getClaim(o.claimKey, o.worktreePath);
  const ws = resolveSlug(o.workspace);
  const sessionId = o.sessionId || resolveSessionId();
  const key = claimKey({
    team: resolveTeamName(o.team),
    member: resolveMemberName(o.member, sessionId),
    workspaceSlug: sanitizeName(o.workspaceSlug) || ws.slug,
    sessionId,
  });
  return getClaim(key, o.worktreePath);
}

/**
 * List claims. By default only live (non-stale) claims; pass
 * { includeStale: true } for the full roster including stale entries
 * (each annotated with `stale: true/false`).
 */
function listClaims(opts) {
  const o = opts || {};
  const all = Object.values(readAll(o.worktreePath));
  const now = Date.now();
  const thresh = Number.isFinite(o.staleMs) ? o.staleMs : STALE_MS;
  const annotated = all.map((c) => Object.assign({}, c, { stale: isStaleClaim(c, now, thresh) }));
  const list = o.includeStale ? annotated : annotated.filter((c) => !c.stale);
  list.sort((a, b) => String(a.claimKey).localeCompare(String(b.claimKey)));
  return list;
}

/** Prune stale claims; returns the pruned claim keys. */
function gcClaims(opts) {
  const o = opts || {};
  const file = claimsFile(o.worktreePath);
  ensureDir(file);
  const pruned = [];
  withLock(
    file,
    () => {
      const current = readAll(o.worktreePath);
      const now = Date.now();
      const thresh = Number.isFinite(o.staleMs) ? o.staleMs : STALE_MS;
      let dirty = false;
      for (const key of Object.keys(current)) {
        if (isStaleClaim(current[key], now, thresh)) {
          delete current[key];
          pruned.push(key);
          dirty = true;
        }
      }
      if (dirty) writeJson(file, current);
    },
    { waitMs: o.waitMs }
  );
  return pruned;
}

/**
 * Group claims by team (pure projection, no I/O): unteamed claims group
 * under "solo". Returns { "<teamId>": { teamId, teamDisplay, members: [] } }.
 */
function groupByTeam(claims) {
  const groups = {};
  for (const c of Array.isArray(claims) ? claims : []) {
    if (!c || typeof c !== "object") continue;
    const id = (c.teamId || c.team || "solo") && sanitizeName(c.teamId || c.team);
    const gid = id || "solo";
    if (!groups[gid]) {
      groups[gid] = {
        teamId: gid,
        teamDisplay: c.team ? capName(sanitizeName(c.team)) : "Solo",
        members: [],
      };
    }
    groups[gid].members.push(c);
  }
  return groups;
}

// --- Scope + WIP protection -----------------------------------------------

/**
 * Normalize a claimed scope: a comma-separated string or an array of path
 * prefixes. "*" claims the whole repo. Empty input claims nothing (a renew
 * or a member with no file scope yet) — it never overlaps.
 * @returns {string[]} cleaned scope prefixes ("*" preserved verbatim)
 */
function normalizeScope(scope) {
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

/** Prefix overlap either direction: "a/b" overlaps "a" and vice versa. */
function prefixesOverlap(a, b) {
  if (a === b) return true;
  return a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

/**
 * True when two normalized scopes overlap. Empty scopes never overlap —
 * claiming nothing cannot conflict. "*" overlaps everything (except nothing).
 */
function scopesOverlap(a, b) {
  const na = normalizeScope(a);
  const nb = normalizeScope(b);
  if (na.length === 0 || nb.length === 0) return false;
  if (na.includes("*") || nb.includes("*")) return true;
  return na.some((x) => nb.some((y) => prefixesOverlap(x, y)));
}

/**
 * Live (non-stale) claims whose scope overlaps the given scope, excluding
 * `excludeKey` (a member renewing its own claim never conflicts with itself).
 * @returns {object[]} conflicting claim records (possibly empty)
 */
function findScopeConflicts(opts) {
  const o = opts || {};
  const scope = normalizeScope(o.scope);
  if (scope.length === 0) return [];
  const now = Date.now();
  const thresh = Number.isFinite(o.staleMs) ? o.staleMs : STALE_MS;
  return listClaims({ worktreePath: o.worktreePath, includeStale: true })
    .filter((c) => !isStaleClaim(c, now, thresh))
    .filter((c) => !o.excludeKey || c.claimKey !== o.excludeKey)
    .filter((c) => scopesOverlap(c.scope, scope));
}

/** Per-member branch name for commit discipline: member/<team>/<member>. */
function memberBranch(parts) {
  const p = parts || {};
  const team = sanitizeName(p.team) || "solo";
  const member = sanitizeName(p.member) || "unknown";
  return `member/${team}/${member}`;
}

/**
 * True when a file path falls inside a claimed scope. "*" covers everything;
 * an empty scope covers nothing (scope-less claims may not touch files).
 */
function isPathInScope(filePath, scope) {
  const list = normalizeScope(scope);
  if (list.includes("*")) return true;
  const f = String(filePath || "").trim().replace(/^\.\//, "").replace(/\/+$/, "");
  if (!f) return false;
  return list.some((prefix) => f === prefix || f.startsWith(`${prefix}/`));
}

/**
 * WIP guard: every file a member is about to touch must sit inside its own
 * claimed scope. Pure — no I/O.
 * @returns {string[]} violating file paths (empty = all inside scope)
 */
function assertScopeForFiles(files, claim) {
  const scope = claim && typeof claim === "object" ? claim.scope : [];
  const list = Array.isArray(files) ? files : [files];
  return list.filter((f) => !isPathInScope(f, scope));
}

/**
 * Destructive-git guard: `stash drop/clear`, `clean`, and `reset --hard`
 * destroy teammate WIP and are never allowed in an orchestra run. Pure.
 * @param {string[]|string} argv git argv (without the leading "git")
 * @returns {{safe:boolean, reason:string|null}}
 */
function isDestructiveGitCommand(argv) {
  const args = (Array.isArray(argv) ? argv : String(argv || "").split(/\s+/)).map((a) => String(a));
  const head = (args[0] || "").toLowerCase();
  const rest = args.slice(1).map((a) => String(a).toLowerCase());
  const no = (reason) => ({ safe: false, reason });
  // Bare `git stash` is a push (safe); drop/clear/pop/branch rewrite shared state.
  const STASH_SAFE = new Set(["push", "list", "show", "store", "create", "apply", "save"]);
  if (head === "stash" && !STASH_SAFE.has(rest[0] || "push")) {
    return no("git stash mutates the shared stash — use per-member branches/commits instead");
  }
  if (head === "clean") return no("git clean deletes untracked files — teammate WIP may live there");
  if (head === "reset" && (rest.includes("--hard") || rest.some((a) => a.startsWith("--hard")))) {
    return no("git reset --hard discards worktree changes — commit your scope instead");
  }
  if (head === "checkout" && rest.includes("--") === false && rest.some((a) => a === "." || a === "-f" || a === "--force")) {
    return no("force checkout discards worktree changes — commit your scope instead");
  }
  return { safe: true, reason: null };
}

module.exports = {
  STALE_MS,
  CLAIMS_FILE,
  defaultStateDir,
  claimsDir,
  claimsFile,
  legacyClaimsFile,
  sanitizeName,
  resolveMemberName,
  resolveTeamName,
  resolveRole,
  resolveSessionId,
  claimKey,
  displayFor,
  isStaleClaim,
  claimSession,
  heartbeatClaim,
  releaseClaim,
  getClaim,
  findClaim,
  listClaims,
  gcClaims,
  groupByTeam,
  normalizeScope,
  scopesOverlap,
  findScopeConflicts,
  memberBranch,
  isPathInScope,
  assertScopeForFiles,
  isDestructiveGitCommand,
};

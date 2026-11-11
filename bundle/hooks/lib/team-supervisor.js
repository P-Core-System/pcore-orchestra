"use strict";

/**
 * HOD supervisor sweep (autonomous loop planner).
 *
 * Pure planning layer: no fs, no child_process, no process.env reads
 * (invariants 15/19). All inputs arrive via arguments; all outputs are
 * plain JSON-safe objects. Side effects (claim, worktree mkdir, spawn)
 * belong to the CLI / conductor caller.
 *
 * `sweep({ backlog, claims, requests, opts })` fuses three inputs:
 *   backlog  backlogByMember-style map { memberKey: { team, items[] } }
 *   claims   live claim rows ([{ memberKey, team, scope[] }])
 *   requests FIFO request rows ([{ id, member, team, topic, status }])
 * and returns deterministic assignments:
 *   [{ member, team, item, branch, claimKey, via }]
 * where `via` is "request" (member asked) or "push" (HOD assigned).
 * Busy members (live claim) are never assigned; unknown members are
 * skipped; ordering is by (team, member) for determinism.
 *
 * `nextAction(memberKey, state)` answers "what should this member do
 * next": { action: "work"|"idle"|"release", ... } — a member with no
 * free item stays idle instead of double-claiming (invariant 32).
 *
 * `memberWorktree(base, team, member)` builds the deterministic
 * per-member worktree path; the CLI mkdirs it (durable, never /tmp —
 * invariant 38; tmp candidates rejected).
 */

const path = require("node:path");

function normToken(raw) {
  if (raw === undefined || raw === null) return "";
  return String(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Per-member branch: member/<team>/<member> (matches team-dispatch). */
function memberBranch(team, member) {
  return `member/${normToken(team) || "solo"}/${normToken(member) || "unknown"}`;
}

/** Claim key the member session should hold for this assignment. */
function memberClaimKey(team, member, sessionId, workspaceSlug) {
  const t = normToken(team) || "solo";
  const m = normToken(member) || "unknown";
  const s = String(sessionId || "hod");
  const w = String(workspaceSlug || "ws");
  return `${t}/${m}/${w}/${s}`;
}

/**
 * Deterministic per-member worktree dir under a base dir.
 * Rejects tmp candidates (invariant 38): falls back to "conductor".
 */
function memberWorktree(base, team, member) {
  const b = String(base || "");
  const isTmp =
    b === "/tmp" || b.startsWith("/tmp/") ||
    b.startsWith("/tmp/opencode") === false && false;
  const safeBase = isTmp ? "conductor" : b || "conductor";
  return path.join(safeBase, `member-${normToken(team) || "solo"}-${normToken(member) || "unknown"}`);
}

function liveMembers(claims) {
  const set = new Set();
  for (const c of Array.isArray(claims) ? claims : []) {
    if (!c || typeof c !== "object") continue;
    const m = normToken(c.memberKey || c.member);
    if (m) set.add(m);
  }
  return set;
}

function pendingRequests(requests) {
  return (Array.isArray(requests) ? requests : [])
    .filter((r) => r && typeof r === "object" && (r.status || "pending") === "pending")
    .slice()
    .sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));
}

/**
 * Pure sweep: grant pending requests first (FIFO), then HOD-push the
 * backlog remainder to free members. Never assigns a busy member.
 */
function sweep(input) {
  const p = input || {};
  const backlog = (p.backlog && typeof p.backlog === "object") ? p.backlog : {};
  const claims = Array.isArray(p.claims) ? p.claims : [];
  const requests = Array.isArray(p.requests) ? p.requests : [];
  const opts = p.opts || {};
  const sessionId = opts.sessionId || "hod";
  const workspaceSlug = opts.workspaceSlug || "ws";
  const busy = liveMembers(claims);
  const out = [];
  const grantedRequestIds = [];
  const consumedMembers = new Set();

  for (const r of pendingRequests(requests)) {
    const m = normToken(r.member);
    if (!m || busy.has(m) || consumedMembers.has(m)) continue;
    const entry = backlog[m] || backlog[r.member];
    const items = entry && Array.isArray(entry.items) ? entry.items : [];
    const item = items[0] || { topic: r.topic || r.task || "requested-work" };
    const team = r.team || (entry && entry.team) || opts.team || "solo";
    out.push({
      member: m,
      team: normToken(team) || "solo",
      item,
      branch: memberBranch(team, m),
      claimKey: memberClaimKey(team, m, sessionId, workspaceSlug),
      via: "request",
      requestId: r.id || null,
    });
    grantedRequestIds.push(r.id || null);
    consumedMembers.add(m);
  }

  const keys = Object.keys(backlog).sort();
  for (const key of keys) {
    const m = normToken(key);
    if (!m || busy.has(m) || consumedMembers.has(m)) continue;
    if (opts.members && Array.isArray(opts.members) && opts.members.length) {
      const allow = opts.members.map(normToken);
      if (!allow.includes(m)) continue;
    }
    const entry = backlog[key] || {};
    const items = Array.isArray(entry.items) ? entry.items : [];
    if (!items.length) continue;
    const team = entry.team || opts.team || "solo";
    out.push({
      member: m,
      team: normToken(team) || "solo",
      item: items[0],
      branch: memberBranch(team, m),
      claimKey: memberClaimKey(team, m, sessionId, workspaceSlug),
      via: "push",
      requestId: null,
    });
    consumedMembers.add(m);
  }
  return { assignments: out, grantedRequestIds: grantedRequestIds.filter(Boolean) };
}

/**
 * Next action for one member: work the first free item, else idle.
 * A busy member with no item releases instead of holding the slot.
 */
function nextAction(memberKey, state) {
  const m = normToken(memberKey);
  const s = state || {};
  const claims = Array.isArray(s.claims) ? s.claims : [];
  const backlog = (s.backlog && typeof s.backlog === "object") ? s.backlog : {};
  const busy = liveMembers(claims);
  const entry = backlog[m] || backlog[memberKey] || {};
  const items = Array.isArray(entry.items) ? entry.items : [];
  if (items.length && !busy.has(m)) {
    return { action: "work", member: m, item: items[0], branch: memberBranch(entry.team, m) };
  }
  if (!items.length && busy.has(m)) {
    return { action: "release", member: m };
  }
  return { action: "idle", member: m };
}

module.exports = {
  sweep,
  nextAction,
  memberBranch,
  memberClaimKey,
  memberWorktree,
  liveMembers,
  pendingRequests,
};

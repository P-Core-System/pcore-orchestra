#!/usr/bin/env bash
# team-sessions.sh — thin CLI over bundle/*/hooks/lib/session-claims.js.
# Named cross-CLI team sessions: claim --member/--team/--role, heartbeat,
# release, list/who (grouped by team), gc. Self-locating: works from any cwd;
# PCORE_PLATFORM=opencode selects the opencode mirror lib path.
# Human output by default; --json for machine. Exit non-zero on error.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)"

if [ "${PCORE_PLATFORM:-}" = "opencode" ]; then
  LIB_PATH="$REPO_ROOT/bundle/opencode/hooks/lib/session-claims.js"
else
  LIB_PATH="$REPO_ROOT/bundle/hooks/lib/session-claims.js"
fi

if [ ! -f "$LIB_PATH" ]; then
  echo "team-sessions.sh: lib not found: $LIB_PATH" >&2
  exit 1
fi

CMD="${1:-}"
[ $# -gt 0 ] && shift

unset PCORE_MEMBER_NAME PCORE_TEAM_NAME PCORE_MEMBER_ROLE PCORE_WS \
      PCORE_CLAIM_KEY PCORE_SESSION_OVERRIDE PCORE_JSON PCORE_STALE_MIN \
      PCORE_WORKTREE PCORE_SCOPE PCORE_FILES PCORE_DRY_RUN PCORE_WORKTREE_BASE \
      PCORE_KIND PCORE_TO PCORE_TOPIC PCORE_BODY PCORE_EMOJI PCORE_MSG_ID \
      PCORE_TOPOLOGY PCORE_ALL PCORE_FREE_ONLY PCORE_REASON PCORE_THREAD \
      PCORE_MESSAGE PCORE_DECISION PCORE_BY PCORE_OUTCOME PCORE_LESSONS 2>/dev/null || true

case "$CMD" in
  claim|heartbeat|release|list|who|check|gc|dispatch|discuss|request|wake|learning)
    ;;
  -h|--help|help)
    cat <<'EOF'
Usage: bash scripts/team-sessions.sh <command> [flags]

  claim     --member M [--team T] [--role R] [--scope S] [--workspace W]   claim/renew slot
  heartbeat --member M [--team T] [--workspace W]              touch heartbeat
  release   --member M [--team T] [--workspace W]               drop claim
  list      [--team T]                                         live claims (grouped)
  who       [--team T]                                         live roster, team-grouped
  check     --member M [--team T] [--claim KEY] -- <files...>  WIP scope check (exit 1 on violation)
  gc                                                       prune stale claims
  dispatch  --team T [--member M,J...] [--session S] [--worktree-base D]
            [--dry-run] [--free-only] [--json]            fan out one session per member from backlog
  discuss   post --member M [--team T] --kind K --body B [--to X] [--topic T]
            list [--team T] [--kind K] [--topology 2way|star|group|all] [--member M] [--all]
            react --id ID --emoji E --member M [--team T]
            resolve --id ID --member M [--team T]        team discussion channel
  request   --member M [--team T] [--session S] [--json] member pull: next backlog item when free
  wake      request --member M --to N [--team T] [--reason R] [--topic T]
            [--thread REF] [--message ID] [--topology X] [--json]  teammate nudge
            list [--member M] [--team T] [--topic T] [--thread REF] [--all] [--json]
            ack --id ID --member M [--team T] [--json]      acknowledge a wake
  learning  record --member M [--team T] --lessons L [--outcome O]
            [--thread REF] [--json]                  record a session learning
            distill [--json]                    distill candidates to review
            approve --id ID --decision approved|rejected --by NAME [--json]
                                                   human gate, never applies

  --member takes a comma-separated filter for dispatch ("john,james");
  single member elsewhere. --dry-run plans with zero side effects.
  dispatch exits 0 (all claimed), 2 (some skipped on SCOPE_CONFLICT), 1 (error).
  wake request/ack exits 2 on deny (cross-scope, no live claim, throttled,
  wrong acker); learning approve exits 2 without a human decision+by.
  --free-only pushes to members with no live claim (leader push to idle slots).
  discuss post claims/renews the author slot first (claim lifecycle); a
  SCOPE_CONFLICT there is a SKIP (exit 2), like dispatch. --kind is one of
  m2m|l2m|m2l|l2l|group. request exits 2 when the member is busy or the
  backlog is empty, 0 with the granted item + claimKey/branch when free.

  --scope takes a comma-separated path list ("app-a/,lib-b/"); "*" claims
  the whole repo. Overlapping live scopes block a claim (scope conflict).
  --json adds machine-readable JSON. --claim KEY selects a claim directly.
  PCORE_MEMBER_NAME / PCORE_TEAM_NAME / PCORE_MEMBER_ROLE set identity via env.
  PCORE_WORKTREE selects worktree-isolated state.
EOF
    exit 0
    ;;
  *)
    echo "team-sessions.sh: unknown command: $CMD" >&2
    exit 1
    ;;
esac

while [ $# -gt 0 ]; do
  case "$1" in
    --json) PCORE_JSON=1; shift ;;
    --member) PCORE_MEMBER_NAME="${2:-}"; shift 2 ;;
    --team) PCORE_TEAM_NAME="${2:-}"; shift 2 ;;
    --role) PCORE_MEMBER_ROLE="${2:-}"; shift 2 ;;
    --workspace) PCORE_WS="${2:-}"; shift 2 ;;
    --claim) PCORE_CLAIM_KEY="${2:-}"; shift 2 ;;
    --session) PCORE_SESSION_OVERRIDE="${2:-}"; shift 2 ;;
    --stale-min) PCORE_STALE_MIN="${2:-}"; shift 2 ;;
    --worktree) PCORE_WORKTREE="${2:-}"; shift 2 ;;
    --worktree-base) PCORE_WORKTREE_BASE="${2:-}"; shift 2 ;;
    --dry-run) PCORE_DRY_RUN=1; shift ;;
    --free-only) PCORE_FREE_ONLY=1; shift ;;
    --all) PCORE_ALL=1; shift ;;
    --scope) PCORE_SCOPE="${2:-}"; shift 2 ;;
    --kind) PCORE_KIND="${2:-}"; shift 2 ;;
    --to) PCORE_TO="${2:-}"; shift 2 ;;
    --topic) PCORE_TOPIC="${2:-}"; shift 2 ;;
    --body) PCORE_BODY="${2:-}"; shift 2 ;;
    --emoji) PCORE_EMOJI="${2:-}"; shift 2 ;;
    --id) PCORE_MSG_ID="${2:-}"; shift 2 ;;
    --topology) PCORE_TOPOLOGY="${2:-}"; shift 2 ;;
    --reason) PCORE_REASON="${2:-}"; shift 2 ;;
    --thread) PCORE_THREAD="${2:-}"; shift 2 ;;
    --message) PCORE_MESSAGE="${2:-}"; shift 2 ;;
    --decision) PCORE_DECISION="${2:-}"; shift 2 ;;
    --by) PCORE_BY="${2:-}"; shift 2 ;;
    --outcome) PCORE_OUTCOME="${2:-}"; shift 2 ;;
    --lessons) PCORE_LESSONS="${2:-}"; shift 2 ;;
    --) shift; while [ $# -gt 0 ]; do PCORE_FILES="${PCORE_FILES:+$PCORE_FILES
}$1"; shift; done ;;
    --*) echo "team-sessions.sh: unknown flag: $1" >&2; exit 1 ;;
    *) PCORE_FILES="${PCORE_FILES:+$PCORE_FILES
}$1"; shift ;;
  esac
done

export PCORE_MEMBER_NAME PCORE_TEAM_NAME PCORE_MEMBER_ROLE PCORE_WS \
       PCORE_CLAIM_KEY PCORE_SESSION_OVERRIDE PCORE_JSON PCORE_STALE_MIN \
       PCORE_WORKTREE PCORE_SCOPE PCORE_FILES PCORE_DRY_RUN PCORE_WORKTREE_BASE \
       PCORE_KIND PCORE_TO PCORE_TOPIC PCORE_BODY PCORE_EMOJI PCORE_MSG_ID \
       PCORE_TOPOLOGY PCORE_ALL PCORE_FREE_ONLY PCORE_REASON PCORE_THREAD \
       PCORE_MESSAGE PCORE_DECISION PCORE_BY PCORE_OUTCOME PCORE_LESSONS
export PCORE_CMD="$CMD"

NODE_PROGRAM=$(cat <<'NODEOF'
"use strict";
const claims = require("LIB_PATH_PLACEHOLDER");
const domain = (() => { try { return require("DOMAIN_PATH_PLACEHOLDER"); } catch { return null; } })();
const wakeLib = (() => { try { return require("WAKE_PATH_PLACEHOLDER"); } catch { return null; } })();
const learnLib = (() => { try { return require("LEARN_PATH_PLACEHOLDER"); } catch { return null; } })();
const artifactLib = (() => { try { return require("ARTIFACT_PATH_PLACEHOLDER"); } catch { return null; } })();
const env = process.env;

function out(obj) {
  if (env.PCORE_JSON) { console.log(JSON.stringify(obj.json !== undefined ? obj.json : obj)); return; }
  console.log(obj.text !== undefined ? obj.text : JSON.stringify(obj));
}
function die(msg) {
  console.error("team-sessions.sh: " + msg);
  process.exit(1);
}

function opts() {
  return {
    member: env.PCORE_MEMBER_NAME || undefined,
    team: env.PCORE_TEAM_NAME || undefined,
    role: env.PCORE_MEMBER_ROLE || undefined,
    workspace: env.PCORE_WS || undefined,
    sessionId: env.PCORE_SESSION_OVERRIDE || undefined,
    claimKey: env.PCORE_CLAIM_KEY || undefined,
    scope: env.PCORE_SCOPE || undefined,
    worktreePath: env.PCORE_WORKTREE || undefined,
  };
}

function staleMs() {
  const n = parseInt(env.PCORE_STALE_MIN || "30", 10);
  return (Number.isFinite(n) && n > 0 ? n : 30) * 60000;
}

function record(action, claim) {
  if (!domain || typeof domain.recordSessionOutcome !== "function" || !claim) return;
  try {
    domain.recordSessionOutcome(claim, action, claim && opts().worktreePath);
  } catch {
    /* fail-open: domain log never breaks the CLI */
  }
}

function wakeForMentions(msg) {
  if (!wakeLib || !msg) return;
  try {
    wakeLib.triggerWakesForDiscussion(msg, { workspace: env.PCORE_WS || env.PCORE_WORKSPACE_ROOT || process.cwd(), worktreePath: opts().worktreePath });
  } catch {
    /* fail-open: the wake channel never breaks the discuss post */
  }
}

function wakeForAssign(member, team) {
  if (!wakeLib || !member) return;
  try {
    const from = claims.findClaim(opts());
    if (!from) return;
    wakeLib.triggerWakeForGrant({ granted: true, member, team }, { from: from.claimKey, workspace: from.workspace || env.PCORE_WS || process.cwd(), worktreePath: opts().worktreePath });
  } catch {
    /* fail-open: the wake channel never breaks the dispatch */
  }
}

switch (env.PCORE_CMD) {
  case "claim": {
    const o = opts();
    let claim;
    try {
      claim = claims.claimSession(o);
    } catch (err) {
      if (err && err.code === "SCOPE_CONFLICT") {
        out({ json: { conflict: true, conflicts: err.conflicts || [] }, text: `CONFLICT ${err.message}` });
        process.exit(2);
      }
      throw err;
    }
    record("claimed", claim);
    out({ json: claim, text: `OK claim ${claim.claimKey} (${claim.teamDisplay}) role=${claim.role}` });
    break;
  }
  case "heartbeat": {
    const claim = claims.heartbeatClaim(opts());
    if (!claim) die("no claim found; claim first");
    record("heartbeat", claim);
    out({ json: claim, text: `OK heartbeat ${claim.claimKey}` });
    break;
  }
  case "release": {
    const o = opts();
    const before = o.claimKey ? claims.getClaim(o.claimKey, o.worktreePath) : null;
    const removed = claims.releaseClaim(o);
    if (before) record("released", before);
    out({ json: { removed, claimKey: o.claimKey || null }, text: removed ? "OK release" : "no claim found" });
    break;
  }
  case "list":
  case "who": {
    const o = opts();
    let list = claims.listClaims({ worktreePath: o.worktreePath, staleMs: staleMs(), includeStale: env.PCORE_ALL === "1" });
    if (o.team) {
      const want = claims.sanitizeName(o.team);
      list = list.filter((c) => (c.teamId || c.team || null) === (want || null));
    }
    const groups = claims.groupByTeam(list);
    const lines = Object.keys(groups).sort().map((gid) => {
      const g = groups[gid];
      const members = g.members.map((m) => `  - ${m.teamDisplay} [${m.role}] ${m.sessionId}`).join("\n");
      return `${g.teamDisplay} (${g.members.length}):\n${members}`;
    });
    out({ json: { claims: list, groups }, text: lines.join("\n") || "no live claims" });
    break;
  }
  case "dispatch": {
    const dispatch = require("DISPATCH_PATH_PLACEHOLDER");
    const pm = require("PM_PATH_PLACEHOLDER");
    const nodePath = require("path");
    const nodeFs = require("fs");
    const teamId = dispatch.sanitizeDispatchToken(env.PCORE_TEAM_NAME);
    if (!teamId) die("dispatch needs --team <name>");
    const sessionId = env.PCORE_SESSION_OVERRIDE || claims.resolveSessionId();
    const wsRoot = env.PCORE_WS || env.PCORE_WORKSPACE_ROOT || process.cwd();
    const workspaceSlug = dispatch.sanitizeDispatchToken(nodePath.basename(String(wsRoot))) || "root";
    const fullState = pm.loadProjectState(undefined, sessionId);
    const agg = pm.getAggregatedProjectState(fullState);
    const bb = pm.backlogByMember(agg);
    const memberFilter = String(env.PCORE_MEMBER_NAME || "").split(",").map((s) => s.trim()).filter(Boolean);
    const planOpts = {
      teamId,
      teams: bb.teams,
      members: memberFilter,
      sessionId,
      workspaceSlug,
      workspace: wsRoot,
      worktreeBase: env.PCORE_WORKTREE_BASE || null,
    };
    let plans = dispatch.planDispatch(planOpts);
    const freeOnly = env.PCORE_FREE_ONLY === "1";
    if (freeOnly) {
      const liveClaims = claims.listClaims({ worktreePath: opts().worktreePath, staleMs: staleMs() });
      plans = dispatch.filterFreePlans(plans, liveClaims);
    }
    if (plans.length === 0) die(`dispatch: no members with backlog for team '${teamId}'`);
    if (env.PCORE_DRY_RUN === "1") {
      out({ json: { dryRun: true, team: teamId, freeOnly, plans }, text: plans.map((p) => `would dispatch ${p.teamDisplay} [${p.itemCount} item(s)] scope=[${p.scope.join(",")}]`).join("\n") });
      break;
    }
    const dispatched = [];
    const skipped = [];
    for (const plan of plans) {
      try {
        const claim = claims.claimSession({ member: plan.member, team: plan.team, scope: plan.scope, sessionId: plan.sessionId, workspace: wsRoot, workspaceSlug: plan.workspaceSlug });
        record("claimed", claim);
        if (plan.worktreePath) {
          try { nodeFs.mkdirSync(nodePath.join(plan.worktreePath, ".pcore", "state"), { recursive: true }); } catch { /* best effort */ }
        }
        const payload = dispatch.buildDispatchPayload(plan, { claimKey: claim.claimKey, branch: claim.branch || plan.branch });
        dispatched.push({ member: plan.member, claimKey: claim.claimKey, branch: claim.branch || plan.branch, sessionId: claim.sessionId, workspaceSlug: claim.workspaceSlug, worktreePath: plan.worktreePath, scope: plan.scope, itemCount: plan.itemCount, payload });
        wakeForAssign(plan.member, plan.team);
      } catch (err) {
        if (dispatch.shouldSkipOnConflict(err)) { skipped.push({ member: plan.member, reason: "SCOPE_CONFLICT" }); continue; }
        throw err;
      }
    }
    out({ json: { dryRun: false, team: teamId, freeOnly, dispatched, skipped }, text: dispatched.map((d) => `OK dispatch ${d.member} ${d.claimKey} ${d.branch}`).concat(skipped.map((s) => `SKIP ${s.member} ${s.reason}`)).join("\n") || "no members dispatched" });
    if (skipped.length > 0) process.exitCode = 2;
    break;
  }
  case "discuss": {
    const discussion = require("DISCUSSION_PATH_PLACEHOLDER");
    const sub = String(env.PCORE_FILES || "").split("\n").map((s) => s.trim()).filter(Boolean)[0] || "";
    if (sub !== "post" && sub !== "list" && sub !== "react" && sub !== "resolve") die("discuss needs an action: post|list|react|resolve");
    const recordDiscussion = (action, msg) => {
      if (!domain || typeof domain.recordDiscussionOutcome !== "function" || !msg) return;
      try {
        domain.recordDiscussionOutcome(msg, action, opts().worktreePath);
      } catch {
        /* fail-open: domain log never breaks the CLI */
      }
    };
    if (sub === "list") {
      const filter = {
        kind: env.PCORE_KIND || undefined,
        topology: env.PCORE_TOPOLOGY || "all",
        team: env.PCORE_TEAM_NAME || undefined,
        member: env.PCORE_MEMBER_NAME && env.PCORE_MEMBER_NAME.indexOf(",") === -1 ? env.PCORE_MEMBER_NAME : undefined,
        includeResolved: env.PCORE_ALL === "1" ? true : undefined,
        worktreePath: opts().worktreePath,
      };
      const msgs = discussion.listMessages(filter, opts().worktreePath);
      out({ json: { messages: msgs }, text: msgs.map((m) => `${m.resolvedAt ? "[resolved] " : ""}${m.id} [${m.kind}] ${m.from}${m.to ? " -> " + m.to : ""}${m.topic ? " #" + m.topic : ""}: ${m.body}`).join("\n") || "no messages" });
      break;
    }
    if (sub === "react") {
      const o = opts();
      const author = claims.findClaim(o);
      if (!author) die("no claim found for this member; claim first");
      const id = env.PCORE_MSG_ID;
      if (!id) die("discuss react needs --id <message-id>");
      if (!env.PCORE_EMOJI) die("discuss react needs --emoji <emoji>");
      const updated = discussion.reactMessage(id, { by: author.claimKey, emoji: env.PCORE_EMOJI }, o.worktreePath);
      if (!updated) die(`no message found: ${id}`);
      recordDiscussion("reaction", updated);
      out({ json: updated, text: `OK react ${updated.id} ${env.PCORE_EMOJI} by ${author.claimKey}` });
      break;
    }
    if (sub === "resolve") {
      const o = opts();
      const author = claims.findClaim(o);
      if (!author) die("no claim found for this member; claim first");
      const id = env.PCORE_MSG_ID;
      if (!id) die("discuss resolve needs --id <message-id>");
      const updated = discussion.resolveMessage(id, { by: author.claimKey }, o.worktreePath);
      if (!updated) die(`no message found: ${id}`);
      recordDiscussion("resolved", updated);
      out({ json: updated, text: `OK resolve ${updated.id}` });
      break;
    }
    // sub === "post": claim lifecycle first — renew the author slot so the
    // message carries a live claim key; a SCOPE_CONFLICT is a SKIP (exit 2).
    const o = opts();
    if (!env.PCORE_SCOPE) {
      const existing = claims.findClaim(o);
      if (existing && Array.isArray(existing.scope)) o.scope = existing.scope;
    }
    let author;
    try {
      author = claims.claimSession(o);
    } catch (err) {
      if (err && err.code === "SCOPE_CONFLICT") {
        out({ json: { skipped: true, reason: "SCOPE_CONFLICT", conflicts: err.conflicts || [] }, text: `SKIP post ${err.message}` });
        process.exit(2);
      }
      throw err;
    }
    record("claimed", author);
    const kind = env.PCORE_KIND || "m2m";
    if (!discussion.isDiscussionKind(kind)) die(`discuss post needs --kind one of ${discussion.DISCUSSION_KINDS.join("|")}`);
    if (!env.PCORE_BODY) die("discuss post needs --body <text>");
    const msg = discussion.postMessage({
      kind,
      from: author.claimKey,
      to: env.PCORE_TO || null,
      team: claims.sanitizeName(o.team) || null,
      topic: env.PCORE_TOPIC || null,
      body: env.PCORE_BODY,
    }, o.worktreePath);
    recordDiscussion("posted", msg);
    wakeForMentions(msg);
    out({ json: msg, text: `OK post ${msg.id} [${msg.kind}] ${msg.from}` });
    break;
  }
  case "request": {
    const dispatch = require("DISPATCH_PATH_PLACEHOLDER");
    const pm = require("PM_PATH_PLACEHOLDER");
    const member = dispatch.sanitizeDispatchToken(env.PCORE_MEMBER_NAME);
    if (!member) die("request needs --member <name>");
    const teamId = dispatch.sanitizeDispatchToken(env.PCORE_TEAM_NAME) || "solo";
    const sessionId = env.PCORE_SESSION_OVERRIDE || claims.resolveSessionId();
    const wsRoot = env.PCORE_WS || env.PCORE_WORKSPACE_ROOT || process.cwd();
    const nodePath = require("path");
    const workspaceSlug = dispatch.sanitizeDispatchToken(nodePath.basename(String(wsRoot))) || "root";
    const fullState = pm.loadProjectState(undefined, sessionId);
    const agg = pm.getAggregatedProjectState(fullState);
    const bb = pm.backlogByMember(agg);
    const liveClaims = claims.listClaims({ worktreePath: opts().worktreePath, staleMs: staleMs() });
    const grant = dispatch.requestWork({
      member,
      team: teamId,
      teams: bb.teams,
      liveClaims,
      sessionId,
      workspaceSlug,
    });
    if (!grant.granted) {
      out({ json: grant, text: `SKIP request ${member}: ${grant.reason}` });
      process.exit(2);
    }
    out({ json: Object.assign({ sessionId, workspaceSlug }, grant), text: `OK request ${grant.member} item=${grant.item && grant.item.id} claim=${grant.claimKey} branch=${grant.branch} session=${sessionId} slug=${workspaceSlug}` });
    break;
  }
  case "wake": {
    if (!wakeLib) die("wake channel unavailable");
    const sub = String(env.PCORE_FILES || "").split("\n").map((s) => s.trim()).filter(Boolean)[0] || "";
    if (sub !== "request" && sub !== "list" && sub !== "ack") die("wake needs an action: request|list|ack");
    const o = opts();
    const deny = (res) => {
      out({ json: res, text: `DENIED wake ${res.code || "WAKE_DENIED"}${res.detail ? ` (${res.detail})` : ""}` });
      process.exitCode = 2;
    };
    if (sub === "list") {
      const wakes = wakeLib.listWakes({
        member: env.PCORE_MEMBER_NAME && env.PCORE_MEMBER_NAME.indexOf(",") === -1 ? env.PCORE_MEMBER_NAME : undefined,
        team: env.PCORE_TEAM_NAME || undefined,
        topic: env.PCORE_TOPIC || undefined,
        threadId: env.PCORE_THREAD || undefined,
        includeAcked: env.PCORE_ALL === "1" ? true : undefined,
      }, o.worktreePath);
      out({ json: { wakes }, text: wakes.map((w) => `${w.status === "acked" ? "[acked] " : ""}${w.id} ${w.from} -> ${w.to}${w.topic ? ` #${w.topic}` : ""} (${w.reason})`).join("\n") || "no wakes" });
      break;
    }
    if (sub === "request") {
      const from = claims.findClaim(o);
      if (!from) die("wake request needs a live claim for this member; claim first");
      if (!env.PCORE_TO) die("wake request needs --to <member>");
      const res = wakeLib.requestWake({
        from: from.claimKey,
        to: env.PCORE_TO,
        team: env.PCORE_TEAM_NAME || undefined,
        topic: env.PCORE_TOPIC || undefined,
        threadId: env.PCORE_THREAD || env.PCORE_TOPIC || undefined,
        messageId: env.PCORE_MESSAGE || undefined,
        topology: env.PCORE_TOPOLOGY || undefined,
        reason: env.PCORE_REASON || "nudge",
        workspace: from.workspace || env.PCORE_WS || env.PCORE_WORKSPACE_ROOT || process.cwd(),
        worktreePath: o.worktreePath,
      });
      if (!res.ok) {
        deny(res);
        break;
      }
      out({ json: res.wake, text: `OK wake ${res.wake.id} ${res.wake.from} -> ${res.wake.to}` });
      break;
    }
    // sub === "ack": only the target slot holder can acknowledge.
    const by = claims.findClaim(o);
    if (!by) die("wake ack needs a live claim for this member; claim first");
    if (!env.PCORE_MSG_ID) die("wake ack needs --id <wake-id>");
    const acked = wakeLib.ackWake(env.PCORE_MSG_ID, { by: by.claimKey, worktreePath: o.worktreePath });
    if (!acked.ok) {
      deny(acked);
      break;
    }
    out({ json: acked.wake, text: `OK ack ${acked.wake.id} by ${by.claimKey}` });
    break;
  }
  case "learning": {
    if (!learnLib) die("learning channel unavailable");
    const sub = String(env.PCORE_FILES || "").split("\n").map((s) => s.trim()).filter(Boolean)[0] || "";
    if (sub !== "record" && sub !== "distill" && sub !== "approve") die("learning needs an action: record|distill|approve");
    const o = opts();
    const artifactDir = (() => {
      if (env.PCORE_ARTIFACT_DIR) return env.PCORE_ARTIFACT_DIR;
      try {
        if (artifactLib && typeof artifactLib.resolveArtifactDir === "function") {
          const wsRoot = env.PCORE_WS || env.PCORE_WORKSPACE_ROOT || process.cwd();
          return artifactLib.resolveArtifactDir({ workspaceRoot: wsRoot }).dir;
        }
      } catch {
        /* fall through */
      }
      return null;
    })();
    if (sub === "record") {
      const claim = claims.findClaim(o);
      if (!claim) die("learning record needs a live claim for this member; claim first");
      if (!env.PCORE_LESSONS) die("learning record needs --lessons <text>");
      const event = learnLib.recordLearning(claim, {
        outcome: env.PCORE_OUTCOME || undefined,
        lessons: env.PCORE_LESSONS,
        threadRef: env.PCORE_THREAD || env.PCORE_TOPIC || undefined,
      }, o.worktreePath);
      if (!event) die("learning record failed (domain unavailable)");
      out({ json: event, text: `OK learning ${event.id} [${event.type}]` });
      break;
    }
    if (!artifactDir) die("learning needs an artifact dir (PCORE_ARTIFACT_DIR or a workspace data/conductor)");
    if (sub === "distill") {
      let events = [];
      try {
        if (domain && domain.store && typeof domain.store.loadEvents === "function") {
          events = domain.store.loadEvents(o.worktreePath);
        }
      } catch {
        events = [];
      }
      const stored = learnLib.distillAndSave(events, artifactDir);
      out({ json: { dir: artifactDir, count: stored.length, candidates: stored }, text: `OK distill ${stored.length} candidate(s) -> ${artifactDir}` });
      break;
    }
    // sub === "approve": the human gate — explicit decision + human name,
    // never auto-applied (approve only flips candidate status).
    if (!env.PCORE_MSG_ID) die("learning approve needs --id <candidate-id>");
    const res = learnLib.approveCandidate(artifactDir, env.PCORE_MSG_ID, { decision: env.PCORE_DECISION, by: env.PCORE_BY });
    if (!res.ok) {
      out({ json: res, text: `DENIED learning approve ${res.code || "LEARNING_UNKNOWN"}` });
      process.exitCode = 2;
      break;
    }
    out({ json: res.candidate, text: `OK approve ${res.candidate.id} -> ${res.candidate.status} by ${res.candidate.decidedBy}` });
    break;
  }
  case "check": {
    const o = opts();
    const claim = claims.findClaim(o);
    if (!claim) die("no claim found for this member; claim first");
    const files = String(env.PCORE_FILES || "").split("\n").map((s) => s.trim()).filter(Boolean);
    if (files.length === 0) die("check needs file paths after --");
    const violations = claims.assertScopeForFiles(files, claim);
    if (violations.length > 0) {
      out({ json: { ok: false, violations, scope: claim.scope || [] }, text: `SCOPE VIOLATION outside [${(claim.scope || []).join(",")}]: ${violations.join(", ")}` });
      process.exit(2);
    }
    out({ json: { ok: true, violations: [], scope: claim.scope || [] }, text: `OK scope [${(claim.scope || []).join(",")}] covers ${files.length} file(s)` });
    break;
  }
  case "gc": {
    const pruned = claims.gcClaims({ worktreePath: opts().worktreePath, staleMs: staleMs() });
    out({ json: pruned, text: "gc pruned: " + pruned.length });
    break;
  }
  default:
    die("unknown command " + env.PCORE_CMD);
}
NODEOF
)

DOMAIN_LIB="${LIB_PATH%session-claims.js}domain/index.js"
DISPATCH_LIB="${LIB_PATH%session-claims.js}team-dispatch.js"
PM_LIB="${LIB_PATH%session-claims.js}project-manager.js"
DISCUSSION_LIB="${LIB_PATH%session-claims.js}team-discussion.js"
WAKE_LIB="${LIB_PATH%session-claims.js}session-wake.js"
LEARN_LIB="${LIB_PATH%session-claims.js}distill-learnings.js"
ARTIFACT_LIB="${LIB_PATH%session-claims.js}plan-artifact.js"
NODE_PROGRAM="${NODE_PROGRAM//LIB_PATH_PLACEHOLDER/"$LIB_PATH"}"
NODE_PROGRAM="${NODE_PROGRAM//DOMAIN_PATH_PLACEHOLDER/"$DOMAIN_LIB"}"
NODE_PROGRAM="${NODE_PROGRAM//DISPATCH_PATH_PLACEHOLDER/"$DISPATCH_LIB"}"
NODE_PROGRAM="${NODE_PROGRAM//PM_PATH_PLACEHOLDER/"$PM_LIB"}"
NODE_PROGRAM="${NODE_PROGRAM//DISCUSSION_PATH_PLACEHOLDER/"$DISCUSSION_LIB"}"
NODE_PROGRAM="${NODE_PROGRAM//WAKE_PATH_PLACEHOLDER/"$WAKE_LIB"}"
NODE_PROGRAM="${NODE_PROGRAM//LEARN_PATH_PLACEHOLDER/"$LEARN_LIB"}"
NODE_PROGRAM="${NODE_PROGRAM//ARTIFACT_PATH_PLACEHOLDER/"$ARTIFACT_LIB"}"

node -e "$NODE_PROGRAM"

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
      PCORE_WORKTREE PCORE_SCOPE PCORE_FILES 2>/dev/null || true

case "$CMD" in
  claim|heartbeat|release|list|who|check|gc)
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
    --scope) PCORE_SCOPE="${2:-}"; shift 2 ;;
    --) shift; while [ $# -gt 0 ]; do PCORE_FILES="${PCORE_FILES:+$PCORE_FILES
}$1"; shift; done ;;
    --*) echo "team-sessions.sh: unknown flag: $1" >&2; exit 1 ;;
    *) PCORE_FILES="${PCORE_FILES:+$PCORE_FILES
}$1"; shift ;;
  esac
done

export PCORE_MEMBER_NAME PCORE_TEAM_NAME PCORE_MEMBER_ROLE PCORE_WS \
       PCORE_CLAIM_KEY PCORE_SESSION_OVERRIDE PCORE_JSON PCORE_STALE_MIN \
       PCORE_WORKTREE PCORE_SCOPE PCORE_FILES
export PCORE_CMD="$CMD"

NODE_PROGRAM=$(cat <<'NODEOF'
"use strict";
const claims = require("LIB_PATH_PLACEHOLDER");
const domain = (() => { try { return require("DOMAIN_PATH_PLACEHOLDER"); } catch { return null; } })();
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
    let list = claims.listClaims({ worktreePath: o.worktreePath, staleMs: staleMs() });
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
NODE_PROGRAM="${NODE_PROGRAM//LIB_PATH_PLACEHOLDER/"$LIB_PATH"}"
NODE_PROGRAM="${NODE_PROGRAM//DOMAIN_PATH_PLACEHOLDER/"$DOMAIN_LIB"}"

node -e "$NODE_PROGRAM"

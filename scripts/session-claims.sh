#!/usr/bin/env bash
# session-claims.sh — track concurrent AI sessions editing P-Core repos.
#
# Every agent session claims the repo (optionally a path scope) it is working
# in; other sessions can list/check claims to avoid clobbering live work.
# Claims die automatically when their heartbeat goes stale (default 30 min).
#
# Usage:
#   session-claims.sh claim  <repo> [--scope "dir1,dir2"] [--task "text"]   # create/renew
#   session-claims.sh renew  <repo>                                          # heartbeat only
#   session-claims.sh release [repo] [--force]                               # drop own claim
#   session-claims.sh list   [repo|-a]                                       # active claims
#   session-claims.sh check  <repo> [paths...]                               # conflict? exit 1 if yes
#   session-claims.sh gc                                                     # purge stale everywhere
set -euo pipefail

STALE_MIN="${PCORE_CLAIM_STALE_MIN:-30}"
PCORE_ROOT="${PCORE_ROOT:-$HOME/projects}"

_now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

detect_tool() {
  if [ -n "${OPENCODE_SERVER_URL:-}${OPENCODE_SESSION_ID:-}" ]; then echo "opencode"
  elif [ -n "${CLAUDE_SESSION_ID:-}${CLAUDECODE:-}" ]; then echo "claude-code"
  elif [ -n "${CURSOR_TRACE_ID:-}${CURSOR_AGENT:-}" ]; then echo "cursor"
  else echo "unknown"; fi
}

session_id() {
  local sid="${OPENCODE_SESSION_ID:-${CLAUDE_SESSION_ID:-${CURSOR_TRACE_ID:-}}}"
  [ -n "$sid" ] && echo "$sid" || echo "pid-$$"
}

claims_file() { printf '%s/.pcore/session-claims.json' "$1"; }

_py() { python3 - "$@"; }

cmd_claim() {
  local repo="$1"; shift
  local scope="*" task=""
  while [ $# -gt 0 ]; do case "$1" in
    --scope) scope="$2"; shift 2 ;;
    --task)  task="$2";  shift 2 ;;
    *) shift ;;
  esac; done
  mkdir -p "$repo/.pcore"
  _py "$repo" "$scope" "$task" <<'EOF'
import json, os, subprocess, sys, datetime
repo, scope, task = sys.argv[1], sys.argv[2], sys.argv[3]
sid = os.environ.get("PCORE_SESSION_ID") or os.environ.get("OPENCODE_SESSION_ID") or os.environ.get("CLAUDE_SESSION_ID") \
      or os.environ.get("CURSOR_TRACE_ID") or f"pid-{os.getpid()}"
tool = ("opencode" if os.environ.get("PCORE_SESSION_ID","").startswith("oc-") or os.environ.get("OPENCODE_SESSION_ID")
        else "claude-code" if os.environ.get("CLAUDE_SESSION_ID","" ) or os.environ.get("CLAUDECODE")
        else "cursor" if os.environ.get("CURSOR_TRACE_ID") else "unknown")
now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
branch = ""
try:
    branch = subprocess.run(["git","-C",repo,"rev-parse","--abbrev-ref","HEAD"],
                            capture_output=True,text=True).stdout.strip()
except Exception: pass
path = os.path.join(repo,".pcore","session-claims.json")
data = {}
if os.path.exists(path):
    try: data = json.load(open(path))
    except Exception: data = {}
data[sid] = {"id":sid,"tool":tool,"agent":os.environ.get("PCORE_AGENT","main"),
             "model":os.environ.get("PCORE_MODEL",""),"repo":os.path.basename(repo.rstrip("/")),
             "branch":branch,"scope":scope,"task":task,
             "started_at":data.get(sid,{}).get("started_at",now),
             "heartbeat_at":now}
json.dump(data, open(path,"w"), indent=2)
print(f"[claim] {sid} -> {data[sid]['repo']} ({branch}) scope={scope}")
EOF
}

cmd_renew() { cmd_claim "$1" --scope "${PCORE_SCOPE:-*}" --task "${PCORE_TASK:-}"; }

cmd_release() {
  local repo="${1:-$PWD}"; local force=""
  [ "${2:-}" = "--force" ] && force="yes"
  _py "$repo" "$force" <<'EOF'
import json, os, sys
repo, force = sys.argv[1], sys.argv[2]
path = os.path.join(repo,".pcore","session-claims.json")
if not os.path.exists(path): print("[release] no claims file"); sys.exit(0)
sid = os.environ.get("PCORE_SESSION_ID") or os.environ.get("OPENCODE_SESSION_ID") or os.environ.get("CLAUDE_SESSION_ID") \
      or os.environ.get("CURSOR_TRACE_ID") or f"pid-{os.getpid()}"
data = json.load(open(path))
if force:
    n=len(data); data={}
    print(f"[release] dropped ALL {n} claims")
elif sid in data:
    del data[sid]; print(f"[release] {sid}")
else:
    print(f"[release] no claim for {sid}"); 
json.dump(data, open(path,"w"), indent=2)
EOF
}

stale_iso() { python3 -c "import datetime; d=datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(minutes=$STALE_MIN); print(d.strftime('%Y-%m-%dT%H:%M:%SZ'))"; }

cmd_list() {
  local target="${1:--a}"; shift || true
  local json_output=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --json) json_output=1; shift ;;
      *) shift ;;
    esac
  done
  local repos=()
  if [ "$target" = "-a" ]; then
    for d in "$PCORE_ROOT"/*/; do [ -f "$(claims_file "${d%/}")" ] && repos+=("${d%/}"); done
  else
    repos+=("$target")
  fi
  local stale; stale=$(stale_iso)
  if [ "$json_output" = "1" ]; then
    _py "$stale" "${repos[@]}" <<'EOF'
import json,os,sys
stale=sys.argv[1]
repos=sys.argv[2:]
output = {}
for r in repos:
    p=os.path.join(r,".pcore","session-claims.json")
    claims = []
    if os.path.exists(p):
        try: data=json.load(open(p))
        except Exception: data={}
        for sid,c in data.items():
            state = "LIVE" if c["heartbeat_at"]>=stale else "STALE"
            claims.append({"session_id": sid, "repo": c["repo"], "tool": c["tool"], "agent": c["agent"], "branch": c["branch"], "scope": c["scope"], "task": c["task"], "heartbeat_at": c["heartbeat_at"], "started_at": c["started_at"], "state": state})
    output[os.path.basename(r)] = claims
print(json.dumps(output))
EOF
  else
    printf "%-6.6s %-14.14s %-24.24s %-11.11s %-10.10s %-17.17s %s\n" STATE REPO SESSION TOOL BRANCH HEARTBEAT TASK
    for r in "${repos[@]}"; do
      _py "$r" "$stale" <<'EOF'
import json,os,sys
r,stale=sys.argv[1],sys.argv[2]
p=os.path.join(r,".pcore","session-claims.json")
rows=[]
if os.path.exists(p):
    try: data=json.load(open(p))
    except Exception: data={}
    for sid,c in data.items():
        state="" if c["heartbeat_at"]>=stale else "STALE "
        rows.append((state or "LIVE",c["repo"],c["id"][:22],c["tool"],c["branch"],c["heartbeat_at"],(c["task"] or "")[:40]))
for row in sorted(rows):
    print(f"{row[0]:<6} {row[1]:<14.14s} {row[2]:<23.23s} {row[3]:<11.11s} {row[4]:<8.8s} {row[5]} {row[6]}")
EOF
    done
  fi
}

cmd_check() {
  local repo="$1"; shift
  local paths=() json_output=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --json) json_output=1; shift ;;
      *) paths+=("$1"); shift ;;
    esac
  done
  local stale; stale=$(stale_iso)
  _py "$repo" "$stale" "$json_output" "${paths[@]:-}" <<'EOF'
import json,os,sys,fnmatch
repo,stale,json_output = sys.argv[1], sys.argv[2], int(sys.argv[3])
mine_paths=[p for p in sys.argv[4:] if p]
p=os.path.join(repo,".pcore","session-claims.json")
result = {"conflicts": [], "has_conflicts": False}
if os.path.exists(p):
    try: data=json.load(open(p))
    except Exception: data={}
    me=os.environ.get("OPENCODE_SESSION_ID") or os.environ.get("CLAUDE_SESSION_ID") \
       or os.environ.get("CURSOR_TRACE_ID") or f"pid-{os.getpid()}"
    for sid,c in data.items():
        if sid==me: continue
        if c["heartbeat_at"]<stale: continue
        hit=False
        if c["scope"]=="*" or not mine_paths: hit=True
        else:
            for sc in c["scope"].split(","):
                sc=sc.strip()
                for mp in mine_paths:
                    if fnmatch.fnmatch(mp,sc) or mp.startswith(sc.rstrip("/")+"/"): hit=True
        if hit:
            result["conflicts"].append({"session_id": sid, "tool": c["tool"], "agent": c["agent"], "scope": c["scope"], "task": c["task"][:60]})
            result["has_conflicts"] = True
if json_output:
    print(json.dumps(result))
else:
    if result["has_conflicts"]:
        print("[info] another LIVE session is working here:")
        for c in result["conflicts"]:
            print(f"  - {c['session_id']} ({c['tool']}/{c['agent']}) on [{c['scope']}] task={c['task']}")
    else:
        print("[check] no live conflicts")
sys.exit(0)
EOF
}

cmd_gc() {
  local stale; stale=$(stale_iso); local n=0
  for d in "$PCORE_ROOT"/*/; do
    r="${d%/}"; f="$(claims_file "$r")"
    [ -f "$f" ] || continue
    before=$(python3 -c "import json;print(len(json.load(open('$f'))))" 2>/dev/null || echo 0)
    _py "$r" "$stale" <<'EOF' >/dev/null
import json,os,sys
r,stale=sys.argv[1],sys.argv[2]
p=os.path.join(r,".pcore","session-claims.json")
d=json.load(open(p))
d={k:v for k,v in d.items() if v["heartbeat_at"]>=stale}
json.dump(d,open(p,"w"),indent=2)
EOF
    after=$(python3 -c "import json;print(len(json.load(open('$f'))))" 2>/dev/null || echo 0)
    [ "$before" != "$after" ] && { echo "[gc] $r: $before -> $after"; n=$((n+1)); }
  done
  [ "$n" = "0" ] && echo "[gc] nothing stale"
}

case "${1:-help}" in
  claim)   shift; cmd_claim "$@" ;;
  renew)   shift; cmd_renew "$@" ;;
  release) shift; cmd_release "$@" ;;
  list)    shift; cmd_list "$@" ;;
  check)   shift; cmd_check "$@" ;;
  gc)      cmd_gc ;;
  *) sed -n '3,15p' "$0" ;;
esac

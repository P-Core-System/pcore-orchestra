#!/usr/bin/env bash
# conductor-state.sh — thin bash CLI over bundle/*/hooks/lib/conductor-state.js.
# Self-locating: works from any cwd; PCORE_PLATFORM=opencode selects the
# opencode mirror lib path, otherwise the default (cursor) lib is used.
# Human output by default; --json for machine. Exit non-zero on error.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)"

if [ "${PCORE_PLATFORM:-}" = "opencode" ]; then
  LIB_PATH="$REPO_ROOT/bundle/opencode/hooks/lib/conductor-state.js"
else
  LIB_PATH="$REPO_ROOT/bundle/hooks/lib/conductor-state.js"
fi

if [ ! -f "$LIB_PATH" ]; then
  echo "conductor-state.sh: lib not found: $LIB_PATH" >&2
  exit 1
fi

CMD="${1:-}"
[ $# -gt 0 ] && shift

# Clear option env that would leak a stale task id into fresh-tracking.
unset PCORE_GOAL PCORE_PHASE PCORE_TASK_ID PCORE_SUMMARY PCORE_STATUS PCORE_WS \
      PCORE_STATUS_FILTER PCORE_SESSION PCORE_REASON PCORE_STALE_MIN PCORE_DELETE \
      PCORE_REUSE PCORE_JSON 2>/dev/null || true

case "$CMD" in
  begin|save|heartbeat|list|who|resume|complete|fail|gc)
    ;;
  -h|--help|help)
    cat <<'EOF'
Usage: bash scripts/conductor-state.sh <command> [flags]

  begin --goal G [--phase P] [--task T] [--reuse]
  save  [--phase P] [--task T] [--summary S] [--status S]
  heartbeat [--task T]
  list  [--workspace W] [--status S]
  who   [--workspace W]
  resume [--session S] [--workspace W]
  complete [--task T] [--summary S]
  fail  --reason R [--task T]
  gc    [--stale-min N] [--delete]

  --json adds machine-readable JSON output.
  PCORE_SESSION_ID / OPENCODE_SESSION_ID set the session; PCORE_PLATFORM=opencode
  selects the opencode mirror lib.
EOF
    exit 0
    ;;
  *)
    echo "conductor-state.sh: unknown command: $CMD" >&2
    exit 1
    ;;
esac

i=0
set -- "$@"
while [ $# -gt 0 ]; do
  case "$1" in
    --json) PCORE_JSON=1; shift ;;
    --reuse) PCORE_REUSE=1; shift ;;
    --delete) PCORE_DELETE=1; shift ;;
    --goal) PCORE_GOAL="${2:-}"; shift 2 ;;
    --phase) PCORE_PHASE="${2:-}"; shift 2 ;;
    --task) PCORE_TASK_ID="${2:-}"; shift 2 ;;
    --summary) PCORE_SUMMARY="${2:-}"; shift 2 ;;
    --status) PCORE_STATUS="${2:-}"; shift 2 ;;
    --workspace) PCORE_WS="${2:-}"; shift 2 ;;
    --session) PCORE_SESSION="${2:-}"; shift 2 ;;
    --reason) PCORE_REASON="${2:-}"; shift 2 ;;
    --stale-min) PCORE_STALE_MIN="${2:-}"; shift 2 ;;
    *)
      echo "conductor-state.sh: unknown flag: $1" >&2
      exit 1
      ;;
  esac
  i=$((i + 1))
done

export PCORE_GOAL PCORE_PHASE PCORE_TASK_ID PCORE_SUMMARY PCORE_STATUS PCORE_WS \
       PCORE_STATUS_FILTER PCORE_SESSION PCORE_REASON PCORE_STALE_MIN PCORE_DELETE \
       PCORE_REUSE PCORE_JSON
export PCORE_CMD="$CMD"

NODE_PROGRAM=$(cat <<'NODEOF'
"use strict";
const c = require("LIB_PATH_PLACEHOLDER");
const env = process.env;

function out(obj) {
  if (env.PCORE_JSON) { console.log(JSON.stringify(obj.json !== undefined ? obj.json : obj)); return; }
  console.log(obj.text !== undefined ? obj.text : JSON.stringify(obj));
}
function die(msg) {
  console.error("conductor-state.sh: " + msg);
  process.exit(1);
}

function currentRun() {
  const sid = c.resolveSessionId();
  if (env.PCORE_TASK_ID) {
    const r = c.readRun({ workspace: env.PCORE_WS, sessionId: sid, taskId: env.PCORE_TASK_ID });
    if (!r) die("no run found for task " + env.PCORE_TASK_ID);
    return r;
  }
  const entry = c.getRunBySession(sid, env.PCORE_WS);
  if (!entry) die("no live run for this session; run begin first");
  const r = c.readRun(entry);
  if (!r) die("run file missing for live run");
  return r;
}

function keyOf(r) { return [r.workspaceSlug, r.sessionId, r.taskId].join("/"); }

switch (env.PCORE_CMD) {
  case "begin": {
    const goal = env.PCORE_GOAL || "";
    const phase = env.PCORE_PHASE || "plan";
    let taskId = env.PCORE_TASK_ID || undefined;
    if (env.PCORE_REUSE) {
      const live = c.getRunBySession(c.resolveSessionId(), env.PCORE_WS);
      if (live) taskId = live.taskId;
    }
    if (!taskId) taskId = c.resolveTaskId(goal, new Date().toISOString() + process.pid);
    const { run, resumed } = c.beginRun({ goal, phase, workspace: env.PCORE_WS, taskId });
    if (env.PCORE_REUSE && resumed) {
      const key = run.phase || "plan";
      run.resumeAttempts[key] = (run.resumeAttempts[key] || 0) + 1;
      c.saveRun(run);
    }
    const obj = { op: "begin", run, resumed };
    out({ json: obj, text: `OK begin ${keyOf(run)} phase=${run.phase} resumed=${resumed}` });
    break;
  }
  case "save": {
    const run = currentRun();
    if (env.PCORE_PHASE) run.phase = env.PCORE_PHASE;
    if (env.PCORE_STATUS) run.status = env.PCORE_STATUS;
    if (env.PCORE_SUMMARY !== undefined) run.summary = env.PCORE_SUMMARY;
    c.saveRun(run);
    out({ json: run, text: `OK save ${keyOf(run)} phase=${run.phase} status=${run.status}` });
    break;
  }
  case "heartbeat": {
    const run = currentRun();
    c.heartbeat(run);
    out({ json: run, text: `OK heartbeat ${keyOf(run)}` });
    break;
  }
  case "list": {
    const runs = c.listRuns({ workspace: env.PCORE_WS, status: env.PCORE_STATUS_FILTER || env.PCORE_STATUS });
    out({ json: runs, text: "runs count: " + runs.length });
    break;
  }
  case "who": {
    const runs = c.listRuns({ workspace: env.PCORE_WS, status: "active" });
    out({ json: runs, text: runs.map((r) => `${r.sessionId} ${keyOf(r)} ${r.phase}`).join("\n") || "no live runs" });
    break;
  }
  case "resume": {
    const sid = env.PCORE_SESSION || c.resolveSessionId();
    const entry = c.getRunBySession(sid, env.PCORE_WS);
    if (!entry) die("no run to resume for session " + sid);
    out({ json: entry, text: `${entry.workspaceSlug}/${entry.sessionId}/${entry.taskId} phase=${entry.phase} goal=${entry.goal}` });
    break;
  }
  case "complete": {
    const run = currentRun();
    c.completeRun(run, env.PCORE_SUMMARY);
    out({ json: run, text: `OK complete ${keyOf(run)}` });
    break;
  }
  case "fail": {
    if (!env.PCORE_REASON) die("--reason required for fail");
    const run = currentRun();
    c.failRun(run, env.PCORE_REASON);
    out({ json: run, text: `OK fail ${keyOf(run)}` });
    break;
  }
  case "gc": {
    const staleMs = (parseInt(env.PCORE_STALE_MIN || "5", 10) || 5) * 60000;
    const pruned = c.gcRuns({ staleMs, deleteFiles: !!env.PCORE_DELETE });
    out({ json: pruned, text: "gc pruned: " + pruned.length });
    break;
  }
  default:
    die("unknown command " + env.PCORE_CMD);
}
NODEOF
)

NODE_PROGRAM="${NODE_PROGRAM//LIB_PATH_PLACEHOLDER/"$LIB_PATH"}"

node -e "$NODE_PROGRAM"
#!/usr/bin/env bash
# Regression test for #25: orchestra-health.js must (a) treat the memory file as
# optional ("created on first run", never MISS/fail on a fresh install) and (b)
# cross-check ALL agents from bundle/agent-registry.json (160), not a hard-coded 27.
# Real --cursor install into a throwaway HOME, then inspect health output.
set -uo pipefail

GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
PASS=0; FAIL=0
ok()  { echo "${GREEN}PASS${NC}: $1"; PASS=$((PASS+1)); }
bad() { echo "${RED}FAIL${NC}: $1"; FAIL=$((FAIL+1)); }

command -v node >/dev/null 2>&1 || { echo "SKIP: node not available"; exit 0; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
INSTALL="$ROOT/install.sh"
HEALTH_REL=".cursor/hooks/orchestra-health.js"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export HOME="$WORK/home"
export XDG_STATE_HOME="$WORK/state"
export XDG_CONFIG_HOME="$WORK/config"
export PCORE_ORCHESTRA_REPO="$ROOT"
mkdir -p "$HOME"

echo "=== orchestra-health.js agent/memory test (#25) ==="

bash "$INSTALL" --cursor --skip-opencode-upgrade >"$WORK/install.log" 2>&1 \
  && ok "install.sh --cursor exited 0" \
  || { bad "install failed: $(tail -5 "$WORK/install.log")"; echo "cannot continue"; exit 1; }

HEALTH="$HOME/$HEALTH_REL"
[[ -f "$HEALTH" ]] && ok "installed health script present" || { bad "no health script at $HEALTH"; exit 1; }

# --- 1. fresh install (no memory file) -> INFO, not MISS, and not a hard failure ---
out="$(node "$HEALTH" 2>&1 || true)"
echo "$out" | grep -A1 "=== Long-term Memory ===" | grep -q "created on first run" \
  && ok "missing memory file is reported as 'created on first run' (optional)" \
  || bad "memory file not treated as optional: $(echo "$out" | grep -A1 'Long-term Memory')"
# It must NOT be flagged as a hard MISS any more.
echo "$out" | grep -A1 "=== Long-term Memory ===" | grep -q "MISS " \
  && bad "memory still prints a MISS line" \
  || ok "memory no longer prints a MISS line on fresh install"

# --- 2. full-registry cross-check (160), not the legacy 27 ---
TOTAL="$(node -e "process.stdout.write(String(require('$ROOT/bundle/agent-registry.json').agents.length))")"
echo "$out" | grep -q "$TOTAL/$TOTAL present (full registry)" \
  && ok "health reports all $TOTAL registry agents present (fresh install)" \
  || bad "health did not report $TOTAL/$TOTAL: $(echo "$out" | grep -A3 '=== Agents')"
echo "$out" | grep -q "27 present, " \
  && bad "health still uses the legacy 27-agent count" \
  || ok "legacy '27 present' hard-coded count is gone"

# --- 3. deleting a non-legacy agent is DETECTED (proves it checks beyond the 27) ---
VICTIM="$(node -e '
  const fs=require("fs"),path=require("path");
  const reg=require("'"$ROOT"'/bundle/agent-registry.json");
  const agentsDir=process.argv[1];
  const legacy=new Set(fs.readdirSync(agentsDir,{recursive:true}).filter(f=>f.endsWith(".md")).map(f=>f.replace(/\.md$/,"")));
  // pick a registry agent that was NOT in the old hard-coded list (so removal proves full coverage)
  const legacyNames=new Set(["orchestra-planner","orchestra-implementer","orchestra-verifier","orchestra-reviewer","business-analyst","product-manager","architect","tech-lead","project-manager","backend-engineer","frontend-engineer","full-stack-engineer","database-engineer","qa-engineer","automation-engineer","performance-engineer","accessibility-reviewer","security-engineer","documentation-writer","release-manager","devops-engineer","platform-engineer","cloud-engineer","infrastructure-engineer","sre","observer","code-reviewer"]);
  const target=reg.agents.find(n=>!legacyNames.has(n));
  if(!target)process.exit(3);
  function find(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory()){const r=find(p);if(r)return r;}else if(e.name===target+".md")return p;}return null;}
  const f=find(agentsDir);
  if(f)fs.unlinkSync(f);
  process.stdout.write(target);
' "$HOME/.cursor/agents" 2>/dev/null)" || true
if [[ -n "${VICTIM:-}" ]]; then
  out2="$(node "$HEALTH" 2>&1 || true)"
  echo "$out2" | grep -q "$((TOTAL-1))/$TOTAL present (full registry)" \
    && ok "removing a non-legacy agent drops the count to $((TOTAL-1))/$TOTAL (full enumeration works)" \
    || bad "count did not react to the removed agent: $(echo "$out2" | grep -A3 '=== Agents')"
  echo "$out2" | grep -q "MISSING:.*$VICTIM" \
    && ok "health names the missing agent ($VICTIM) in its output" \
    || bad "missing agent $VICTIM not surfaced"
  echo "$out2" | grep -q "Some checks failed" \
    && ok "a missing registry agent makes health fail (non-zero path)" \
    || bad "health did not fail on a missing agent"
else
  bad "could not pick a non-legacy agent to remove (test setup)"
fi

echo ""
echo "health agents/memory test: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}"
[[ "$FAIL" -eq 0 ]] || exit 1

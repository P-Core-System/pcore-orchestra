#!/usr/bin/env bash
# fix-opencode-response.sh — heal OpenCode "no response" after orchestra install / CLI upgrade
#
# Common causes (1.18.19 → 1.18.21 + pcore-orchestra):
#   - Desktop sidecar out of sync with CLI (restart app)
#   - Dead/silent free models on default agents (see update-free-models.sh --check)
#   - Remote MCP servers blocking session start (neon, n8n)
#   - Orchestra conductor using Cursor Task syntax instead of OpenCode task tool
#   - orchestra.md not installed (install only copied orchestra-*.md)
#
# Usage:
#   bash scripts/fix-opencode-response.sh
#   bash scripts/fix-opencode-response.sh --disable-remote-mcp
#   bash scripts/fix-opencode-response.sh --skip-probe
#   bash scripts/fix-opencode-response.sh --kill-stale
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OPENCODE="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
DISABLE_MCP=0
SKIP_PROBE=0
KILL_STALE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --disable-remote-mcp) DISABLE_MCP=1; shift ;;
    --skip-probe) SKIP_PROBE=1; shift ;;
    --kill-stale) KILL_STALE=1; shift ;;
    -h|--help)
      sed -n '2,14p' "$0"
      exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

echo "==> OpenCode response fix (pcore-orchestra)"

# 0a. Kill stale background opencode run (from interrupted probes — causes hangs/RAM)
if [[ "$KILL_STALE" -eq 1 ]] || pgrep -f 'opencode run' >/dev/null 2>&1; then
  if pgrep -f 'opencode run' >/dev/null 2>&1; then
    echo "==> Stale opencode run detected — stopping background processes"
    pkill -f 'timeout.*opencode run' 2>/dev/null || true
    pkill -f 'opencode run' 2>/dev/null || true
    sleep 2
    pkill -9 -f 'opencode run' 2>/dev/null || true
    echo "     Done. Run: bash scripts/diagnose-opencode.sh"
  fi
fi

# 0. Ensure CLI matches npm latest (desktop sidecar must match)
bash "$ROOT/scripts/ensure-opencode-latest.sh" || echo "WARN OpenCode upgrade skipped"

# 1. Sync conductor + phase agents (orchestra.md was missing from install glob)
mkdir -p "$OPENCODE/agents"
cp -f "$ROOT/bundle/opencode/agents/orchestra.md" "$OPENCODE/agents/"
cp -f "$ROOT/bundle/opencode/agents/orchestra-"*.md "$OPENCODE/agents/"
mkdir -p "$OPENCODE/agents/references"
cp -f "$ROOT/bundle/agents/references/orchestra-spawn-matrix.md" "$OPENCODE/agents/references/" 2>/dev/null || true

# 2. Sync orchestra-loop skill
mkdir -p "$OPENCODE/skills/orchestra-loop"
cp -f "$ROOT/bundle/opencode/skills/orchestra-loop/SKILL.md" "$OPENCODE/skills/orchestra-loop/"
cp -f "$ROOT/bundle/skills/orchestra-loop/SKILL.md" "$ROOT/bundle/opencode/skills/orchestra-loop/" 2>/dev/null || true

# 2b. Sync health check (validates orchestra.md + mode: primary)
cp -f "$ROOT/bundle/opencode/hooks/orchestra-health-opencode.js" "$OPENCODE/hooks/" 2>/dev/null || true

# 3. Merge autonomy (models, task permissions, hidden subagents)
node "$ROOT/scripts/merge-autonomy-config.js" --opencode --opencode-home "$OPENCODE"

# 4. Optional: disable remote MCP that hang desktop startup
if [[ "$DISABLE_MCP" -eq 1 ]] && [[ -f "$OPENCODE/opencode.json" ]]; then
  node -e "
    const fs = require('fs');
    const p = process.argv[1];
    const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!cfg.mcp) process.exit(0);
    let n = 0;
    for (const [k, v] of Object.entries(cfg.mcp)) {
      if (v && v.type === 'remote' && v.enabled !== false) {
        v.enabled = false;
        n++;
        console.log('  Disabled remote MCP:', k);
      }
    }
    if (n) fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n');
  " "$OPENCODE/opencode.json"
fi

# 5. Sanitize config for installed OpenCode version
node "$ROOT/scripts/sanitize-opencode-config.js" --heal --opencode-home "$OPENCODE" 2>/dev/null || \
  node "$ROOT/scripts/sanitize-opencode-config.js" --opencode-home "$OPENCODE"

# 6. Health check
node "$OPENCODE/hooks/orchestra-health-opencode.js" 2>/dev/null || \
  node "$ROOT/bundle/opencode/hooks/orchestra-health-opencode.js" || true

probe_opencode() {
  local spec="$1"
  local out
  local tmp
  tmp="$(mktemp)"
  if [[ "$spec" == "orchestra" ]]; then
    timeout 120 opencode run --agent orchestra --format json "Reply OK" >"$tmp" 2>&1 || true
  else
    timeout 120 opencode run -m "$spec" --format json "Reply OK" >"$tmp" 2>&1 || true
  fi
  out="$(cat "$tmp")"
  rm -f "$tmp"
  local input_tokens=""
  input_tokens="$(echo "$out" | grep -oE '"input":[0-9]+' | tail -1 | cut -d: -f2)"
  if echo "$out" | grep -qE '"type":"text"'; then
    if [[ -n "$input_tokens" ]]; then
      echo "  OK   $spec (input_tokens=${input_tokens})"
    else
      echo "  OK   $spec"
    fi
    return 0
  fi
  if echo "$out" | grep -qE '"type":"reasoning"'; then
    echo "  WARN $spec — reasoning only (desktop may look blank); input_tokens=${input_tokens:-?}"
    return 0
  fi
  echo "  FAIL $spec"
  echo "$out" | tail -5
  return 1
}

# 7. Quick model probe (primary + conductor)
if [[ "$SKIP_PROBE" -eq 0 ]] && command -v opencode &>/dev/null; then
  echo ""
  echo "==> Quick response probe (CLI; desktop needs app restart after this)"
  probe_opencode "opencode/mimo-v2.6-flash-free" || true
  probe_opencode "orchestra" || true
fi

VER="$(opencode --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || echo unknown)"
echo ""
echo "==> Done (OpenCode CLI $VER)"
echo "    Restart the OpenCode **desktop app** now (sidecar must match CLI $VER)."
echo "    Entry agent: orchestra (default). Phase agents are hidden — conductor spawns via task tool."
echo "    If desktop still silent: wait 30–60s (free tier models can be slow), then try a new session."
echo "    Fallback test: opencode run --agent general \"hello\" (bypasses orchestra conductor)."
echo "    If still silent: bash scripts/fix-opencode-response.sh --disable-remote-mcp"

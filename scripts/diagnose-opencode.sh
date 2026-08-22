#!/usr/bin/env bash
# diagnose-opencode.sh — find why OpenCode CLI looks like "no response"
#
# Checks: stuck background runs, network, config, single clean probe.
#
# Usage:
#   bash scripts/diagnose-opencode.sh
#   bash scripts/diagnose-opencode.sh --kill-stale
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OPENCODE="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
KILL_STALE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --kill-stale) KILL_STALE=1; shift ;;
    -h|--help)
      sed -n '2,10p' "$0"
      exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

echo "==> OpenCode diagnose"
echo ""

# ── 1. Stale background processes ─────────────────────────────────────────
echo "--- Background opencode processes ---"
mapfile -t STALE < <(pgrep -af 'opencode run' 2>/dev/null || true)
if [[ ${#STALE[@]} -eq 0 ]] || [[ -z "${STALE[0]:-}" ]]; then
  echo "OK   none (good — stale runs cause hangs and high RAM)"
else
  echo "WARN ${#STALE[@]} opencode run process(es) still running:"
  for line in "${STALE[@]}"; do echo "     $line"; done
  echo "     These often come from interrupted Cursor/CI probes (timeout + opencode run)."
  echo "     They compete for CPU/RAM and can block new sessions."
  if [[ "$KILL_STALE" -eq 1 ]]; then
    pkill -f 'timeout.*opencode run' 2>/dev/null || true
    pkill -f 'opencode run' 2>/dev/null || true
    sleep 2
    if pgrep -f 'opencode run' >/dev/null 2>&1; then
      pkill -9 -f 'opencode run' 2>/dev/null || true
    fi
    echo "     Killed stale opencode run processes (--kill-stale)."
  else
    echo "     Fix: bash scripts/diagnose-opencode.sh --kill-stale"
  fi
fi
echo ""

# ── 2. Network (not usually the blocker) ───────────────────────────────────
echo "--- Network ---"
if command -v curl >/dev/null 2>&1; then
  code_time="$(curl -sS -o /dev/null -w '%{http_code} %{time_total}' --max-time 20 https://opencode.ai/ 2>&1)" || code_time="FAIL"
  echo "     opencode.ai: HTTP $code_time"
  if [[ "$code_time" == FAIL* ]] || [[ "$code_time" == "000"* ]]; then
    echo "WARN network/DNS failure — check proxy/VPN/firewall"
  elif awk -v t="${code_time#* }" 'BEGIN{exit !(t+0>5)}' 2>/dev/null; then
    echo "WARN slow network (>5s) — responses feel frozen; not a config bug"
  else
    echo "OK   reachable"
  fi
else
  echo "     (curl not found — skip)"
fi
echo ""

# ── 3. Config sanity ───────────────────────────────────────────────────────
echo "--- Config ---"
if [[ -f "$OPENCODE/opencode.json" ]]; then
  node -e "
    const fs=require('fs');
    const p=process.argv[1];
    const c=JSON.parse(fs.readFileSync(p,'utf8'));
    const orch=c.agent?.orchestra;
    console.log('     default_agent:', c.default_agent||'(unset)');
    console.log('     model:', c.model||'(unset)');
    console.log('     orchestra.mode:', orch?.mode||'MISSING');
    console.log('     instructions:', (c.instructions||[]).length, 'glob(s)');
    if (c.default_agent==='orchestra' && orch?.mode!=='primary') {
      console.log('WARN orchestra default_agent requires agent.orchestra.mode=primary');
      process.exit(1);
    }
  " "$OPENCODE/opencode.json" && echo "OK   config basics" || echo "WARN config issue above"
else
  echo "MISS no opencode.json at $OPENCODE"
fi
echo ""

# ── 4. Single clean probe (JSON — only reliable way to see text) ───────────
echo "--- CLI probe (one run, lightning model, JSON) ---"
if ! command -v opencode >/dev/null 2>&1; then
  echo "FAIL opencode CLI not in PATH"
  exit 1
fi
VER="$(opencode --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || echo unknown)"
echo "     OpenCode CLI $VER"

if pgrep -f 'opencode run' >/dev/null 2>&1; then
  echo "SKIP probe while other opencode run processes active (use --kill-stale first)"
  exit 1
fi

TMP="$(mktemp)"
START="$(date +%s)"
if timeout 90 opencode run --auto --format json -m opencode/mimo-v2.5-free "Reply exactly: OK" >"$TMP" 2>&1; then
  ELAPSED=$(( $(date +%s) - START ))
  if grep -q '"type":"text"' "$TMP" && grep -q '"text":"OK"' "$TMP"; then
    INPUT="$(grep -oE '"input":[0-9]+' "$TMP" | tail -1 | cut -d: -f2)"
    echo "OK   text=OK elapsed=${ELAPSED}s input_tokens=${INPUT:-?}"
  elif grep -q '"type":"reasoning"' "$TMP"; then
    echo "WARN reasoning only — UI may look blank ${ELAPSED}s (wait or use --format json)"
  else
    echo "FAIL no text in JSON output (${ELAPSED}s)"
    tail -3 "$TMP"
    rm -f "$TMP"
    exit 1
  fi
else
  echo "FAIL timeout or CLI error (90s)"
  tail -5 "$TMP" 2>/dev/null || true
  rm -f "$TMP"
  exit 1
fi
rm -f "$TMP"
echo ""

echo "==> Summary"
echo "  • 'No response' is usually NOT network — opencode.ai reachable but slow."
echo "  • Main local causes: stale background 'opencode run', default TUI format hiding text,"
echo "    huge input context (~20k+ tokens), or desktop sidecar out of sync."
echo "  • Reliable test: opencode run --auto --format json -m opencode/mimo-v2.5-free \"hello\""
echo "  • Heal: bash scripts/fix-opencode-response.sh --disable-remote-mcp"
echo "  • Plain 'opencode run' may only show '> orchestra · model' without printing OK — use --format json"

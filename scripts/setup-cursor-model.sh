#!/usr/bin/env bash
# setup-cursor-model.sh — Pin Composer 2.5 as the cheap/best default for Cursor
#
# Usage:
#   bash scripts/setup-cursor-model.sh
#
# This script is safe to re-run. It does NOT write to the binary IDE state
# database (state.vscdb) directly; instead it guides the user through the
# model picker and updates the CLI config if needed.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✓${NC} $*"; }
info() { echo -e "${CYAN}ℹ${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC} $*"; }
err()  { echo -e "${RED}✗${NC} $*"; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

CLI_CONFIG="${HOME}/.cursor/cli-config.json"
IDE_STATE="${HOME}/.config/Cursor/User/globalStorage/state.vscdb"

TARGET_MODEL="composer-2.5"

echo "Cursor model setup — pinning ${TARGET_MODEL} as the cheap/best default"
echo ""

# ── Check CLI config ─────────────────────────────────────────────────
if [[ -f "$CLI_CONFIG" ]]; then
  CURRENT_MODEL=$(python3 -c "
import json, sys
try:
    c = json.load(open('${CLI_CONFIG}'))
    print(c.get('model', {}).get('modelId', '') or c.get('selectedModel', {}).get('modelId', ''))
except Exception as e:
    print('')
" 2>/dev/null || true)
  if [[ "$CURRENT_MODEL" == "$TARGET_MODEL" ]]; then
    ok "CLI config (${CLI_CONFIG}) already uses ${TARGET_MODEL}"
  else
    warn "CLI config is currently '${CURRENT_MODEL:-(unset)}'"
    info "To switch via CLI, run:"
    info "  agent --model '${TARGET_MODEL}' <prompt>"
    info "Or open Cursor Settings > Models and select '${TARGET_MODEL}' (standard)."
  fi
else
  warn "No CLI config found at ${CLI_CONFIG}"
fi

# ── Check IDE state (read-only) ──────────────────────────────────────
if command -v sqlite3 >/dev/null 2>&1 && [[ -f "$IDE_STATE" ]]; then
  IDE_MODEL=$(sqlite3 "$IDE_STATE" "SELECT value FROM ItemTable WHERE key = 'cursor/lastSingleModelPreference'" 2>/dev/null || true)
  if [[ "$IDE_MODEL" == *"${TARGET_MODEL}"* ]]; then
    ok "IDE last model preference already points to ${TARGET_MODEL}"
  else
    info "IDE last model preference: ${IDE_MODEL:-(not found)}"
    info "Open the Cursor model picker (top of chat/agent panel) and select '${TARGET_MODEL}' (standard, not Fast)."
  fi
else
  info "Cannot read IDE state (${IDE_STATE}) — open the Cursor model picker and select '${TARGET_MODEL}' manually."
fi

# ── Check agent frontmatter ───────────────────────────────────────────
AGENTS_DIR="${REPO_ROOT}/bundle/agents"
ALLOWED_CURSOR_MODELS="composer-2\.5|grok-4\.6|grok-4\.5"
MISSING=0
for f in $(find "${AGENTS_DIR}" -name '*.md' -not -path '*/references/*' | sort); do
  rel=$(basename "$f")
  if [[ -f "$f" ]]; then
    model=$(grep -oE "^model:\s*(${ALLOWED_CURSOR_MODELS})" "$f" | sed -E 's/^model:\s*//')
    if [[ -n "$model" ]]; then
      ok "Agent frontmatter ${rel} pinned to Cursor model ${model}"
    else
      err "Agent frontmatter ${rel} is missing a Cursor Models pool model (composer-2.5 / grok-4.6 / grok-4.5)"
      MISSING=$((MISSING + 1))
    fi
  fi
done

# ── Install/update bundle ─────────────────────────────────────────────
echo ""
info "To apply these agents to your local Cursor, run:"
info "  cd ${REPO_ROOT} && bash install.sh --cursor"

if [[ "$MISSING" -gt 0 ]]; then
  echo ""
  err "Some agents are not pinned. Fix the agent frontmatter before installing."
  exit 1
fi

echo ""
ok "Cursor setup guidance complete. Select ${TARGET_MODEL} in the IDE and re-run this script anytime."

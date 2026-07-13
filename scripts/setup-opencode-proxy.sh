#!/usr/bin/env bash
# setup-opencode-proxy.sh — Configure OpenCode free model routing + multi-key rotation
#
# Sets up OpenCode with free Zen models, fallback chains, and optional
# multi-key rotation to bypass rate limits on free tier.
#
# Usage:
#   bash setup-opencode-proxy.sh              interactive setup
#   bash setup-opencode-proxy.sh --check      check current OpenCode config
#   bash setup-opencode-proxy.sh --free       configure free Zen models only
#   bash setup-opencode-proxy.sh --multi-key  guide for multi-key rotation
#   bash setup-opencode-proxy.sh --help       show help
set -euo pipefail

# ── Colors ──────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${CYAN}▸${NC} $*"; }
ok()    { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
err()   { echo -e "${RED}✗${NC} $*"; }

# ── Paths ───────────────────────────────────────────────────────────
OPENCODE_CONFIG_DIR="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
OPENCODE_CONFIG="$OPENCODE_CONFIG_DIR/opencode.json"

# ── Help ────────────────────────────────────────────────────────────
show_help() {
  cat <<'EOF'
setup-opencode-proxy.sh — OpenCode free model + multi-key rotation setup

Configure OpenCode to use free Zen models with automatic failover, or
set up multi-key rotation to bypass rate limits.

Usage:
  bash setup-opencode-proxy.sh              Interactive setup
  bash setup-opencode-proxy.sh --check      Check current OpenCode config
  bash setup-opencode-proxy.sh --free       Configure free Zen models only
  bash setup-opencode-proxy.sh --multi-key  Guide for multi-key rotation
  bash setup-opencode-proxy.sh --restore    Restore config from backup
  bash setup-opencode-proxy.sh --help       Show this help

Free Zen models (as of July 2026):
  minimax-m2.5-free, big-pickle, north-mini-code-free,
  mimo-v2.5-free, qwen3.6-plus-free, nemotron-3-super-free,
  ling-2.6-flash, hy3-preview-free

Multi-key rotation tools:
  opencode-go-multi-auth  — Go + Zen multi-key proxy (recommended)
  mux                     — OpenRouter multi-key routing
  opencode-openai-multi-auth — Multiple ChatGPT accounts

⚠ Free models may use data for training. Do not use for sensitive code.
EOF
}

# ── Detect OpenCode ─────────────────────────────────────────────────
detect_opencode() {
  if [[ -d "$OPENCODE_CONFIG_DIR" ]]; then
    ok "OpenCode config dir: $OPENCODE_CONFIG_DIR"
  else
    err "OpenCode config dir not found at $OPENCODE_CONFIG_DIR"
    echo "  Install OpenCode first: https://opencode.ai"
    return 1
  fi

  if [[ -f "$OPENCODE_CONFIG" ]]; then
    ok "Config file: $OPENCODE_CONFIG"
  else
    warn "No opencode.json found at $OPENCODE_CONFIG"
    info "Will create one during setup"
  fi
}

# ── Check config ────────────────────────────────────────────────────
check_config() {
  echo ""
  echo -e "${BOLD}=== OpenCode Config Check ===${NC}"
  echo ""

  detect_opencode || return 1

  if [[ -f "$OPENCODE_CONFIG" ]]; then
    echo ""
    info "Current providers configured:"
    # Extract provider names from opencode.json
    if command -v node &>/dev/null; then
      node -e "
        const cfg = JSON.parse(require('fs').readFileSync('$OPENCODE_CONFIG','utf8'));
        const providers = cfg.provider || cfg.providers || {};
        const names = Object.keys(providers);
        if (names.length === 0) { console.log('  (none)'); process.exit(0); }
        names.forEach(n => {
          const p = providers[n];
          const models = Object.keys(p.models || {});
          const base = p.options?.baseURL || 'built-in';
          console.log('  ' + n);
          console.log('    base: ' + base);
          console.log('    models: ' + (models.length > 0 ? models.join(', ') : '(none)'));
        });
      " 2>/dev/null || info "Could not parse opencode.json"
    else
      cat "$OPENCODE_CONFIG"
    fi
  fi

  echo ""
  info "Orchestra agents:"
  local agent_count
  agent_count=$(ls "$OPENCODE_CONFIG_DIR/agents/"orchestra-*.md 2>/dev/null | wc -l || echo "0")
  echo "  Installed: $agent_count"

  info "Orchestra skill:"
  if [[ -f "$OPENCODE_CONFIG_DIR/skills/orchestra-loop/SKILL.md" ]]; then
    echo "  Installed"
  else
    echo "  Not found"
  fi

  echo ""
  info "To check your API key: opencode auth status"
  echo ""
}

# ── Backup existing config ──────────────────────────────────────────
backup_config() {
  if [[ -f "$OPENCODE_CONFIG" ]]; then
    local backup="$OPENCODE_CONFIG.backup.$(date +%Y%m%d%H%M%S)"
    cp "$OPENCODE_CONFIG" "$backup"
    ok "Backed up to $backup"
  fi
}

# ── Configure free Zen models ───────────────────────────────────────
configure_free() {
  echo ""
  echo -e "${BOLD}=== Configure Free Zen Models ===${NC}"
  echo ""

  detect_opencode || return 1

  echo ""
  echo "  Free Zen models available:"
  echo "    minimax-m2.5-free      (good for general coding)"
  echo "    big-pickle             (balanced)"
  echo "    north-mini-code-free   (best for code)"
  echo "    mimo-v2.5-free         (fast)"
  echo "    qwen3.6-plus-free      (strong reasoning)"
  echo "    nemotron-3-super-free  (balanced)"
  echo "    ling-2.6-flash         (fast, lightweight)"
  echo "    hy3-preview-free       (experimental)"
  echo ""
  echo -e "${YELLOW}⚠ Free models may use data for training. Not for sensitive code.${NC}"
  echo ""

  read -rp "Proceed with free model setup? [Y/n]: " confirm
  if [[ "${confirm,,}" == "n" ]]; then
    echo "Aborted."
    return 0
  fi

  # Check for existing config
  if [[ -f "$OPENCODE_CONFIG" ]]; then
    echo ""
    warn "Existing opencode.json found."
    read -rp "Create a fresh config (backs up existing)? [Y/n]: " do_backup
    if [[ "${do_backup,,}" != "n" ]]; then
      backup_config
    fi
  fi

  echo ""
  info "Writing free model provider config..."

  mkdir -p "$OPENCODE_CONFIG_DIR"

  cat > "$OPENCODE_CONFIG" <<'FREECONFIG'
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "opencode-free-zen": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "OpenCode Zen Free",
      "options": {
        "baseURL": "https://opencode.ai/zen/v1"
      },
      "models": {
        "north-mini-code-free": {},
        "minimax-m2.5-free": {},
        "big-pickle": {},
        "mimo-v2.5-free": {},
        "qwen3.6-plus-free": {},
        "nemotron-3-super-free": {},
        "ling-2.6-flash": {},
        "hy3-preview-free": {}
      }
    }
  }
}
FREECONFIG

  ok "Free model config written to $OPENCODE_CONFIG"

  echo ""
  echo -e "${BOLD}=== Next Steps ===${NC}"
  echo ""
  echo "  1. Ensure you have an OpenCode API key:"
  echo "     opencode auth login"
  echo ""
  echo "  2. Test a free model:"
  echo "     opencode run --model opencode-free-zen/north-mini-code-free 'write hello world'"
  echo ""
  echo "  3. For orchestration, use north-mini-code-free or minimax-m2.5-free"
  echo "     as they handle multi-step tasks better."
  echo ""
  echo "  4. For production work, consider upgrading to OpenCode Go ($10/mo)"
  echo "     for zero-retention, stronger models."
  echo ""
}

# ── Multi-key rotation guide ────────────────────────────────────────
configure_multi_key() {
  echo ""
  echo -e "${BOLD}=== Multi-Key Rotation Guide ===${NC}"
  echo ""

  echo "  Multi-key rotation lets you pool multiple API keys with"
  echo "  automatic failover when one key hits rate limits."
  echo ""
  echo "  Recommended tools:"
  echo ""
  echo "  1. opencode-go-multi-auth (best for Go + Zen)"
  echo "     - Plugin mode: auto-starts with OpenCode"
  echo "     - Strategies: priority_failover, round_robin, weighted_cycle"
  echo "     - Web dashboard on localhost:18904"
  echo "     - Install: https://github.com/Rishabh-Bajpai/opencode-go-multi-auth"
  echo ""
  echo "  2. mux (OpenRouter multi-key)"
  echo "     - Works with OpenRouter API keys"
  echo "     - /mux command in OpenCode"
  echo "     - Auto-switches when credits low"
  echo "     - Install: https://github.com/hacimertgokhan/mux"
  echo ""
  echo "  3. opencode-openai-multi-auth (ChatGPT accounts)"
  echo "     - Multiple ChatGPT Plus/Pro accounts"
  echo "     - OAuth authentication"
  echo "     - Per-model rate tracking"
  echo "     - Install: https://github.com/Emilvooo/opencode-openai-multi-auth"
  echo ""
  echo -e "${BOLD}── Quick Start: opencode-go-multi-auth ──${NC}"
  echo ""
  echo "  # 1. Install the plugin"
  echo "  # Follow instructions at the GitHub link above"
  echo ""
  echo "  # 2. Add providers to ~/.config/opencode/opencode.json"
  echo '  # (merge with existing config — this script does not overwrite):'
  echo ""
  echo "  Add these provider blocks to your opencode.json:"
  echo ""
  echo '  "opencode-go": {'
  echo '    "options": { "baseURL": "http://localhost:18905" },'
  echo '    "models": { "deepseek-v4-flash": {} }'
  echo "  }"
  echo ""
  echo '  "multi-auth-zen": {'
  echo '    "npm": "@ai-sdk/openai-compatible",'
  echo '    "name": "OpenCode Zen (multi-auth)",'
  echo '    "options": { "baseURL": "http://localhost:18905/zen" },'
  echo '    "models": {'
  echo '      "deepseek-v4-flash-free": {},'
  echo '      "mimo-v2.5-free": {},'
  echo '      "qwen3.6-plus-free": {},'
  echo '      "minimax-m3-free": {},'
  echo '      "nemotron-3-ultra-free": {},'
  echo '      "north-mini-code-free": {}'
  echo "    }"
  echo "  }"
  echo ""
  echo -e "${YELLOW}  ⚠ Provider name must be unique. Do NOT use 'opencode-zen' or 'opencode'${NC}"
  echo -e "${YELLOW}    — those collide with built-in providers.${NC}"
  echo ""
  echo "  # 3. Start using — proxy auto-routes between free and paid"
  echo ""

  echo -e "${BOLD}── Strategy Comparison ──${NC}"
  echo ""
  echo "  priority_failover (default):"
  echo "    Keep one account warm for cache reuse. Best for single user."
  echo ""
  echo "  round_robin:"
  echo "    Rotate through accounts on each request. Even load distribution."
  echo ""
  echo "  weighted_cycle:"
  echo "    Proportional traffic. Use when accounts have different quotas."
  echo ""
}

# ── Restore from backup ─────────────────────────────────────────────
restore_config() {
  echo ""
  info "Available backups:"
  local backups=()
  while IFS= read -r f; do
    backups+=("$f")
  done < <(ls -t "$OPENCODE_CONFIG_DIR/opencode.json.backup."* 2>/dev/null || true)

  if [[ ${#backups[@]} -eq 0 ]]; then
    err "No backups found at $OPENCODE_CONFIG_DIR/opencode.json.backup.*"
    return 1
  fi

  local i=1
  for b in "${backups[@]}"; do
    echo "  $i. $(basename "$b")"
    ((i++))
  done

  read -rp "Restore which backup? [1-${#backups[@]}]: " choice
  local idx=$((choice - 1))

  if [[ $idx -lt 0 || $idx -ge ${#backups[@]} ]]; then
    err "Invalid selection"
    return 1
  fi

  cp "${backups[$idx]}" "$OPENCODE_CONFIG"
  ok "Restored ${backups[$idx]} to $OPENCODE_CONFIG"
}

# ── Interactive setup ───────────────────────────────────────────────
interactive_setup() {
  echo ""
  echo -e "${BOLD}╔══════════════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}║   OpenCode Free Model + Multi-Key Setup         ║${NC}"
  echo -e "${BOLD}╚══════════════════════════════════════════════════╝${NC}"
  echo ""

  detect_opencode || return 1

  echo ""
  echo -e "${BOLD}Choose setup mode:${NC}"
  echo ""
  echo "  1) Free Zen models only (zero cost, rate-limited)"
  echo "  2) Multi-key rotation guide (pool keys, bypass limits)"
  echo "  3) Check current config"
  echo "  4) Restore config from backup"
  echo ""

  read -rp "Choice [1-4]: " mode

  case "$mode" in
    1) configure_free ;;
    2) configure_multi_key ;;
    3) check_config ;;
    4) restore_config ;;
    *) err "Invalid choice"; return 1 ;;
  esac
}

# ── Main ────────────────────────────────────────────────────────────
case "${1:-}" in
  --help|-h)     show_help ;;
  --check)       check_config ;;
  --free)        configure_free ;;
  --multi-key)   configure_multi_key ;;
  --restore)     restore_config ;;
  *)             interactive_setup ;;
esac

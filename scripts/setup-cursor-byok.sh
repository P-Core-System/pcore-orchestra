#!/usr/bin/env bash
# setup-cursor-byok.sh — Guide and helper for Cursor BYOK (Bring Your Own Key)
# Bypasses Cursor's monthly fast-request cap by routing through your own API key.
#
# Usage:
#   bash setup-cursor-byok.sh              # interactive guide
#   bash setup-cursor-byok.sh --check      # check current Cursor config
#   bash setup-cursor-byok.sh --litellm    # set up LiteLLM proxy for GPT-5.5
#   bash setup-cursor-byok.sh --help       # show help
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

# ── Help ────────────────────────────────────────────────────────────
show_help() {
  cat <<'EOF'
setup-cursor-byok.sh — Cursor BYOK (Bring Your Own Key) setup helper

Bypasses Cursor's monthly fast-request cap by routing requests through
your own API key. Cursor's counter stops incrementing when BYOK is active.

Usage:
  bash setup-cursor-byok.sh              Interactive guide
  bash setup-cursor-byok.sh --check      Check current Cursor config
  bash setup-cursor-byok.sh --litellm    Set up LiteLLM proxy for GPT-5.5
  bash setup-cursor-byok.sh --help       Show this help

What is BYOK?
  Cursor supports "Bring Your Own Key" — you paste your own API key
  (OpenAI, Anthropic, Google, or any OpenAI-compatible provider) into
  Cursor Settings → Models. Requests then go directly to the provider,
  bypassing Cursor's metered pool entirely.

Options:
  --check     Detect if Cursor is installed and show current hooks/config
  --litellm   Install and configure LiteLLM as a local proxy relay
              (needed for GPT-5.5 which Cursor's BYOK rejects)

Examples:
  # Interactive setup guide
  bash setup-cursor-byok.sh

  # Just check if Cursor is found on this machine
  bash setup-cursor-byok.sh --check

  # Set up LiteLLM proxy for blocked models
  bash setup-cursor-byok.sh --litellm
EOF
}

# ── Detect Cursor ───────────────────────────────────────────────────
detect_cursor() {
  local cursor_dirs=()
  local home="${HOME:-${USERPROFILE:-$HOME}}"

  # Standard locations
  [[ -d "$home/.cursor" ]] && cursor_dirs+=("$home/.cursor")
  [[ -d "$home/AppData/Roaming/Cursor" ]] && cursor_dirs+=("$home/AppData/Roaming/Cursor")
  [[ -d "$home/Library/Application Support/Cursor" ]] && cursor_dirs+=("$home/Library/Application Support/Cursor")

  if [[ ${#cursor_dirs[@]} -eq 0 ]]; then
    err "Cursor not found in standard locations"
    echo "  Searched: ~/.cursor, ~/AppData/Roaming/Cursor, ~/Library/Application Support/Cursor"
    return 1
  fi

  ok "Cursor found at: ${cursor_dirs[0]}"
  return 0
}

# ── Check current config ────────────────────────────────────────────
check_config() {
  local home="${HOME:-${USERPROFILE:-$HOME}}"
  local cursor_dir="$home/.cursor"

  echo ""
  echo -e "${BOLD}=== Cursor BYOK Config Check ===${NC}"
  echo ""

  # Check if Cursor exists
  if ! detect_cursor; then
    return 1
  fi

  # Check hooks.json
  local hooks_json="$cursor_dir/hooks.json"
  if [[ -f "$hooks_json" ]]; then
    ok "hooks.json found at $hooks_json"
    # Count orchestra hooks
    local orchestra_count
    orchestra_count=$(grep -c "orchestra" "$hooks_json" 2>/dev/null || echo "0")
    info "Orchestra hooks: $orchestra_count entries"
  else
    warn "No hooks.json found at $hooks_json"
  fi

  # Check for orchestra state
  local state_file="$cursor_dir/hooks/state/orchestra.json"
  if [[ -f "$state_file" ]]; then
    ok "Orchestra state found"
    local phase
    phase=$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('$state_file','utf8')).phase||'unknown')}catch{console.log('unknown')}" 2>/dev/null || echo "unknown")
    info "Current phase: $phase"
  else
    info "No orchestra state (not initialized yet)"
  fi

  # Check for agents
  local agent_count
  agent_count=$(ls "$cursor_dir/agents/"orchestra-*.md 2>/dev/null | wc -l || echo "0")
  info "Orchestra agents installed: $agent_count"

  echo ""
  echo -e "${BOLD}=== BYOK Status ===${NC}"
  echo ""
  info "BYOK is configured through Cursor's UI (Settings → Models)."
  info "This script cannot read Cursor's internal BYOK state."
  echo ""
  info "To check BYOK manually:"
  info "  1. Open Cursor"
  info "  2. Go to Settings (gear icon) → Models"
  info "  3. Look for API key fields and 'Override OpenAI Base URL' toggle"
  echo ""
}

# ── Interactive BYOK guide ──────────────────────────────────────────
interactive_guide() {
  echo ""
  echo -e "${BOLD}╔══════════════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}║   Cursor BYOK Setup Guide                       ║${NC}"
  echo -e "${BOLD}║   Bypass monthly fast-request limits             ║${NC}"
  echo -e "${BOLD}╚══════════════════════════════════════════════════╝${NC}"
  echo ""

  detect_cursor || true
  echo ""

  echo -e "${BOLD}Step 1: Choose a provider${NC}"
  echo ""
  echo "  Option A: Direct provider key (simplest)"
  echo "    - OpenAI:  platform.openai.com/api-keys"
  echo "    - Anthropic: console.anthropic.com"
  echo "    - Google: aistudio.google.com/apikey"
  echo ""
  echo "  Option B: OpenAI-compatible proxy (recommended)"
  echo "    - Hypereal:  hypereal.cloud (GPT-5.4, Claude Opus 4.7, Gemini 3)"
  echo "    - LLM Gateway: llmgateway.io (200+ models)"
  echo "    - OpenRouter: openrouter.ai (multi-provider)"
  echo ""
  echo -e "${YELLOW}  ⚠ GPT-5.5 BYOK is broken in Cursor (as of May 2026).${NC}"
  echo -e "${YELLOW}    Use Claude Opus 4.7, Sonnet 4.6, or Gemini 3 Pro.${NC}"
  echo ""

  echo -e "${BOLD}Step 2: Configure Cursor${NC}"
  echo ""
  echo "  1. Open Cursor IDE"
  echo "  2. Settings (gear icon) → Models"
  echo "  3. Find the provider section (OpenAI API Key / Anthropic / etc.)"
  echo "  4. Paste your API key"
  echo ""
  echo "  For custom OpenAI-compatible endpoint:"
  echo "  5. Toggle 'Override OpenAI Base URL'"
  echo "  6. Enter the base URL (e.g., https://api.hypereal.cloud/v1)"
  echo "  7. Enable desired models in the model list"
  echo "  8. Click 'Verify' — should show green checkmark"
  echo ""

  echo -e "${BOLD}Step 3: Verify${NC}"
  echo ""
  echo "  Send any prompt in Cursor Agent. Check that:"
  echo "  - Request completes (not queued in slow pool)"
  echo "  - Settings → Usage shows no increment on fast requests"
  echo ""

  echo -e "${BOLD}Step 4: Optimize${NC}"
  echo ""
  echo "  Optional: disable Tab completions to save provider costs:"
  echo "  Settings → Cursor Tab → Disable"
  echo ""
  echo "  Tab completions consume tokens from YOUR provider, not Cursor."
  echo ""

  # Provider-specific examples
  echo -e "${BOLD}═══ Quick Setup Examples ═══${NC}"
  echo ""

  echo -e "${GREEN}Hypereal (recommended for most users):${NC}"
  echo "  Base URL:  https://api.hypereal.cloud/v1"
  echo "  Models:    gpt-5.4, claude-opus-4-7, claude-sonnet-4-6, gemini-3-pro-preview"
  echo "  Cost:      ~\$80-150/mo for heavy use (pay-per-token)"
  echo ""

  echo -e "${GREEN}LiteLLM local proxy (for GPT-5.5):${NC}"
  echo "  Run:       bash setup-cursor-byok.sh --litellm"
  echo "  Base URL:  http://localhost:4000/v1"
  echo "  Cost:      Same as upstream provider + $0"
  echo ""
}

# ── LiteLLM proxy setup ────────────────────────────────────────────
setup_litellm() {
  echo ""
  echo -e "${BOLD}=== LiteLLM Proxy Setup (for GPT-5.5 in Cursor) ===${NC}"
  echo ""

  # Check Python
  if ! command -v python3 &>/dev/null && ! command -v python &>/dev/null; then
    err "Python not found. Install Python 3.8+ first."
    echo "  https://www.python.org/downloads/"
    return 1
  fi

  local python_cmd="python3"
  command -v python3 &>/dev/null || python_cmd="python"

  # Check pip
  if ! command -v pip3 &>/dev/null && ! command -v pip &>/dev/null; then
    err "pip not found. Install pip first."
    return 1
  fi

  local pip_cmd="pip3"
  command -v pip3 &>/dev/null || pip_cmd="pip"

  info "Python: $($python_cmd --version 2>&1)"
  info "pip: $($pip_cmd --version 2>&1)"
  echo ""

  # Prompt for provider details
  echo -e "${BOLD}Enter your provider details:${NC}"
  echo ""

  read -rp "Provider base URL [https://api.hypereal.cloud/v1]: " provider_url
  provider_url="${provider_url:-https://api.hypereal.cloud/v1}"

  read -rp "Provider API key (ck_...): " provider_key
  if [[ -z "$provider_key" ]]; then
    err "API key is required"
    return 1
  fi

  read -rp "Model to proxy [gpt-5.5]: " model_name
  model_name="${model_name:-gpt-5.5}"

  read -rp "Local proxy port [4000]: " proxy_port
  proxy_port="${proxy_port:-4000}"

  echo ""
  info "Installing LiteLLM..."
  $pip_cmd install "litellm[proxy]" --quiet 2>/dev/null || {
    err "Failed to install LiteLLM"
    return 1
  }

  echo ""
  info "Creating startup script..."

  local script_dir
  script_dir="$(cd "$(dirname "$0")" && pwd)"
  local litellm_script="$script_dir/start-litellm-proxy.sh"

  cat > "$litellm_script" <<LITELLM
#!/usr/bin/env bash
# Start LiteLLM proxy for Cursor BYOK
# Routes Cursor requests through provider to bypass model restrictions.
#
# Usage:
#   bash start-litellm-proxy.sh          Start proxy in foreground
#   bash start-litellm-proxy.sh --bg     Start proxy in background
set -euo pipefail

export OPENAI_API_BASE="$provider_url"
export OPENAI_API_KEY="$provider_key"

echo "Starting LiteLLM proxy on port $proxy_port..."
echo "  Model:  $model_name"
echo "  Upstream: $provider_url"
echo "  Cursor base URL: http://localhost:$proxy_port/v1"
echo ""
echo "Configure Cursor: Settings → Models → Override OpenAI Base URL"
echo "  Base URL: http://localhost:$proxy_port/v1"
echo "  API Key:  (any non-empty string)"
echo ""

if [[ "\${1:-}" == "--bg" ]]; then
  nohup python3 -m litellm.proxy.proxy_cli \\
    --model "$model_name" \\
    --port "$proxy_port" \\
    > /tmp/litellm-proxy.log 2>&1 &
  echo "PID: \$!"
  echo "Logs: /tmp/litellm-proxy.log"
else
  python3 -m litellm.proxy.proxy_cli \\
    --model "$model_name" \\
    --port "$proxy_port"
fi
LITELLM

  chmod +x "$litellm_script"
  ok "Startup script created: $litellm_script"

  echo ""
  echo -e "${BOLD}=== Setup Complete ===${NC}"
  echo ""
  echo "  To start the proxy:"
  echo "    bash $litellm_script        # foreground"
  echo "    bash $litellm_script --bg   # background (detached)"
  echo ""
  echo "  Then in Cursor:"
  echo "    Settings → Models → Override OpenAI Base URL"
  echo "    Base URL: http://localhost:$proxy_port/v1"
  echo "    API Key:  (any non-empty string)"
  echo ""
  echo "  Cursor's fast-request counter will stop incrementing."
  echo ""
}

# ── Main ────────────────────────────────────────────────────────────
case "${1:-}" in
  --help|-h)  show_help ;;
  --check)    check_config ;;
  --litellm)  setup_litellm ;;
  *)          interactive_guide ;;
esac

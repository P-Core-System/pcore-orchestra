#!/usr/bin/env bash
# setup-opencode-optimal.sh — Generate an optimized opencode.json for token efficiency
#
# Creates a cost-optimized OpenCode config with:
# - Phase-specific model routing (cheap planner, capable implementer)
# - Aggressive compaction and pruning
# - Agent step limits to prevent runaway costs
# - Reasoning effort variants
# - Small model for titles/summaries
#
# Usage:
#   bash setup-opencode-optimal.sh                  interactive setup
#   bash setup-opencode-optimal.sh --budget         free/ultra-cheap config
#   bash setup-opencode-optimal.sh --balanced       balanced cost/quality
#   bash setup-opencode-optimal.sh --premium        best quality, cost-aware
#   bash setup-opencode-optimal.sh --check          show current config analysis
#   bash setup-opencode-optimal.sh --help           show help
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
setup-opencode-optimal.sh — Generate optimized OpenCode config for token efficiency

Creates cost-optimized opencode.json with phase-specific model routing,
aggressive compaction, agent step limits, and reasoning variants.

Usage:
  bash setup-opencode-optimal.sh                  Interactive (choose profile)
  bash setup-opencode-optimal.sh --budget         Free/ultra-cheap models
  bash setup-opencode-optimal.sh --balanced       Budget planner + capable implementer
  bash setup-opencode-optimal.sh --premium        Premium models, cost-aware
  bash setup-opencode-optimal.sh --check          Analyze current config
  bash setup-opencode-optimal.sh --restore        Restore from backup
  bash setup-opencode-optimal.sh --help           Show this help

Profiles:
  budget     Uses mimo-v2.5-free for all phases. ~$0.00-0.03/cycle
  balanced   Flash for read-only, kimi-k2.5 for implementation. ~$0.03-0.11/cycle
  premium    Sonnet 5 for implementation, flash for others. ~$0.10-0.30/cycle

Expected savings: 50-70% token reduction vs default config.

Docs: docs/token-optimization.md
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
}

# ── Backup ──────────────────────────────────────────────────────────
backup_config() {
  if [[ -f "$OPENCODE_CONFIG" ]]; then
    local backup="$OPENCODE_CONFIG.backup.$(date +%Y%m%d%H%M%S)"
    cp "$OPENCODE_CONFIG" "$backup"
    ok "Backed up to $backup"
  fi
}

# ── Check current config ────────────────────────────────────────────
check_config() {
  echo ""
  echo -e "${BOLD}=== OpenCode Config Analysis ===${NC}"
  echo ""

  detect_opencode || return 1

  if [[ ! -f "$OPENCODE_CONFIG" ]]; then
    warn "No opencode.json found. Run --balanced to create one."
    return 0
  fi

  echo ""
  info "Current config:"
  echo ""

  if command -v node &>/dev/null; then
    node -e "
      const cfg = JSON.parse(require('fs').readFileSync('$OPENCODE_CONFIG','utf8'));
      
      // Model
      console.log('  Main model:  ' + (cfg.model || '(not set)'));
      console.log('  Small model: ' + (cfg.small_model || '(not set)'));
      
      // Compaction
      const comp = cfg.compaction || {};
      console.log('  Compaction:  auto=' + (comp.auto !== false) + ' prune=' + (comp.prune === true) + ' reserved=' + (comp.reserved || 10000));
      
      // Agents
      const agents = cfg.agent || {};
      const names = Object.keys(agents);
      console.log('  Agents:      ' + (names.length > 0 ? names.join(', ') : '(none configured)'));
      
      for (const [name, a] of Object.entries(agents)) {
        const model = a.model || cfg.model || '(inherit)';
        const steps = a.steps || '(no limit)';
        console.log('    ' + name + ': model=' + model + ' steps=' + steps);
      }
      
      // Provider
      const providers = Object.keys(cfg.provider || {});
      console.log('  Providers:   ' + (providers.length > 0 ? providers.join(', ') : '(default)'));
      
      // Watcher
      const watch = cfg.watcher || {};
      console.log('  Watcher ignore: ' + (watch.ignore ? watch.ignore.length + ' patterns' : '(default)'));
      
      // Snapshot
      console.log('  Snapshot:    ' + (cfg.snapshot !== false ? 'enabled' : 'disabled'));
    " 2>/dev/null || info "Could not parse config"
  fi

  echo ""
  info "Optimization opportunities:"
  echo ""

  # Check for common inefficiencies
  if [[ -f "$OPENCODE_CONFIG" ]]; then
    node -e "
      const cfg = JSON.parse(require('fs').readFileSync('$OPENCODE_CONFIG','utf8'));
      const issues = [];
      
      if (!cfg.small_model) issues.push('No small_model set — titles use your expensive main model');
      if (!cfg.compaction || !cfg.compaction.prune) issues.push('compaction.prune is off — old tool outputs stay in context');
      if (!cfg.compaction || cfg.compaction.reserved > 10000) issues.push('compaction.reserved is high — more aggressive compaction saves tokens');
      
      const agents = cfg.agent || {};
      for (const [name, a] of Object.entries(agents)) {
        if (!a.steps) issues.push('Agent ' + name + ' has no steps limit — can run indefinitely');
        if (!a.permission) issues.push('Agent ' + name + ' has no permission restrictions — all tools enabled');
      }
      
      if (!cfg.watcher || !cfg.watcher.ignore) issues.push('No watcher ignore patterns — monitoring node_modules/git overhead');
      if (cfg.snapshot === undefined) issues.push('Snapshot enabled by default — disable for large repos');
      
      if (issues.length === 0) {
        console.log('  Config looks well-optimized!');
      } else {
        issues.forEach(i => console.log('  ' + i));
      }
    " 2>/dev/null || true
  fi

  echo ""
}

# ── Generate config ─────────────────────────────────────────────────
generate_config() {
  local profile="$1"

  detect_opencode || return 1

  echo ""
  echo -e "${BOLD}=== Generate Optimized Config ($profile) ===${NC}"
  echo ""

  if [[ -f "$OPENCODE_CONFIG" ]]; then
    warn "Existing opencode.json found."
    read -rp "Create fresh config (backs up existing)? [Y/n]: " confirm
    if [[ "${confirm,,}" == "n" ]]; then
      echo "Aborted."
      return 0
    fi
    backup_config
  fi

  mkdir -p "$OPENCODE_CONFIG_DIR"

  local config=""

  case "$profile" in
    budget)
      config='{
  "$schema": "https://opencode.ai/config.json",
  "model": "opencode/mimo-v2.5-free",
  "small_model": "opencode/mimo-v2.5-free",
  "compaction": {
    "auto": true,
    "prune": true,
    "reserved": 8000
  },
  "watcher": {
    "ignore": ["node_modules/**", "dist/**", ".git/**", "build/**", "coverage/**"]
  },
  "snapshot": false,
  "agent": {
    "orchestra": {
      "model": "opencode/mimo-v2.5-free",
      "steps": 40,
      "permission": { "task": "allow", "bash": "allow", "edit": "deny", "websearch": "allow", "webfetch": "allow" }
    },
    "orchestra-planner": {
      "model": "opencode/mimo-v2.5-free",
      "steps": 6,
      "permission": { "edit": "deny", "bash": "allow", "websearch": "allow", "webfetch": "allow" }
    },
    "orchestra-implementer": {
      "model": "opencode/mimo-v2.5-free",
      "steps": 20
    },
    "orchestra-verifier": {
      "model": "opencode/mimo-v2.5-free",
      "steps": 8,
      "permission": { "edit": "deny", "bash": "allow", "websearch": "deny", "webfetch": "deny" }
    },
    "orchestra-reviewer": {
      "model": "opencode/mimo-v2.5-free",
      "steps": 4,
      "permission": { "edit": "deny", "bash": "allow", "websearch": "allow", "webfetch": "allow" }
    }
  },
  "provider": {
    "opencode": {
      "models": {
        "mimo-v2.5-free": {
          "variants": {
            "fast": { "reasoningEffort": "low", "textVerbosity": "low" }
          }
        },
        "mimo-v2.5-free (ox-alpha)": {
          "variants": {
            "fast": { "reasoningEffort": "low", "textVerbosity": "low" }
          }
        }
      }
    }
  }
}'

      echo -e "${GREEN}Budget profile:${NC}"
      echo "  All phases: mimo-v2.5-free (ox-alpha) (free, reliable text output)"
      echo "  Cost per cycle: ~\$0.00-0.03"
      echo "  Limitation: rate-limited, may hit limits mid-loop"
      ;;

    balanced)
      config='{
  "$schema": "https://opencode.ai/config.json",
  "model": "opencode/deepseek-v4-flash",
  "small_model": "opencode/mimo-v2.5-free",
  "compaction": {
    "auto": true,
    "prune": true,
    "reserved": 8000
  },
  "watcher": {
    "ignore": ["node_modules/**", "dist/**", ".git/**", "build/**", "coverage/**"]
  },
  "snapshot": false,
  "agent": {
    "orchestra-planner": {
      "model": "opencode/deepseek-v4-flash",
      "steps": 8,
      "permission": { "edit": "deny", "bash": "allow", "websearch": "deny" }
    },
    "orchestra-implementer": {
      "model": "opencode/kimi-k2.5",
      "steps": 25
    },
    "orchestra-verifier": {
      "model": "opencode/deepseek-v4-flash",
      "steps": 10,
      "permission": { "edit": "deny", "bash": "allow" }
    },
    "orchestra-reviewer": {
      "model": "opencode/deepseek-v4-flash",
      "steps": 5,
      "permission": { "edit": "deny", "bash": "allow", "websearch": "deny", "webfetch": "deny" }
    }
  },
  "provider": {
    "opencode": {
      "models": {
        "deepseek-v4-flash": {
          "variants": {
            "fast": { "reasoningEffort": "low", "textVerbosity": "low" },
            "thorough": { "reasoningEffort": "high" }
          }
        }
      }
    }
  }
}'

      echo -e "${GREEN}Balanced profile:${NC}"
      echo "  Planner/Verifier/Reviewer: deepseek-v4-flash ($0.14/$0.28 per 1M)"
      echo "  Implementer: kimi-k2.5 ($0.60/$3.00 per 1M)"
      echo "  Cost per cycle: ~$0.03-0.11"
      echo "  Best for: daily coding, most projects"
      ;;

    premium)
      config='{
  "$schema": "https://opencode.ai/config.json",
  "model": "opencode/claude-sonnet-5",
  "small_model": "opencode/mimo-v2.5-free",
  "compaction": {
    "auto": true,
    "prune": true,
    "reserved": 10000
  },
  "watcher": {
    "ignore": ["node_modules/**", "dist/**", ".git/**", "build/**", "coverage/**"]
  },
  "snapshot": true,
  "agent": {
    "orchestra-planner": {
      "model": "opencode/deepseek-v4-flash",
      "steps": 8,
      "permission": { "edit": "deny", "bash": "allow", "websearch": "deny" }
    },
    "orchestra-implementer": {
      "model": "opencode/claude-sonnet-5",
      "steps": 30
    },
    "orchestra-verifier": {
      "model": "opencode/deepseek-v4-flash",
      "steps": 10,
      "permission": { "edit": "deny", "bash": "allow" }
    },
    "orchestra-reviewer": {
      "model": "opencode/claude-sonnet-5",
      "steps": 5,
      "permission": { "edit": "deny", "bash": "allow", "websearch": "deny", "webfetch": "deny" }
    }
  },
  "provider": {
    "opencode": {
      "models": {
        "claude-sonnet-5": {
          "variants": {
            "fast": {
              "thinking": { "type": "enabled", "budgetTokens": 4000 }
            },
            "thorough": {
              "thinking": { "type": "enabled", "budgetTokens": 16000 }
            }
          }
        },
        "deepseek-v4-flash": {
          "variants": {
            "fast": { "reasoningEffort": "low", "textVerbosity": "low" }
          }
        }
      }
    }
  }
}'

      echo -e "${GREEN}Premium profile:${NC}"
      echo "  Planner/Verifier: deepseek-v4-flash (budget)"
      echo "  Implementer/Reviewer: claude-sonnet-5 (premium)"
      echo "  Cost per cycle: ~$0.10-0.30"
      echo "  Best for: complex projects, critical code"
      ;;
  esac

  echo "$config" > "$OPENCODE_CONFIG"
  ok "Config written to $OPENCODE_CONFIG"

  echo ""
  echo -e "${BOLD}=== Next Steps ===${NC}"
  echo ""
  echo "  1. Restart OpenCode to apply the new config"
  echo "  2. Run an orchestra cycle to test token usage"
  echo "  3. Monitor cost in OpenCode dashboard"
  echo ""
  echo "  For details: docs/token-optimization.md"
  echo ""
}

# ── Restore ─────────────────────────────────────────────────────────
restore_config() {
  echo ""
  info "Available backups:"
  local backups=()
  while IFS= read -r f; do
    backups+=("$f")
  done < <(ls -t "$OPENCODE_CONFIG_DIR/opencode.json.backup."* 2>/dev/null || true)

  if [[ ${#backups[@]} -eq 0 ]]; then
    err "No backups found"
    return 1
  fi

  local i=1
  for b in "${backups[@]}"; do
    echo "  $i. $(basename "$b")"
    ((i++))
  done

  read -rp "Restore which? [1-${#backups[@]}]: " choice
  local idx=$((choice - 1))

  if [[ $idx -lt 0 || $idx -ge ${#backups[@]} ]]; then
    err "Invalid selection"
    return 1
  fi

  cp "${backups[$idx]}" "$OPENCODE_CONFIG"
  ok "Restored"
}

# ── Interactive ─────────────────────────────────────────────────────
interactive_setup() {
  echo ""
  echo -e "${BOLD}╔══════════════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}║   OpenCode Token Optimization Setup             ║${NC}"
  echo -e "${BOLD}╚══════════════════════════════════════════════════╝${NC}"
  echo ""

  detect_opencode || return 1

  echo ""
  echo -e "${BOLD}Choose optimization profile:${NC}"
  echo ""
  echo "  1) Budget     — All free models (~\$0.00-0.03/cycle)"
  echo "  2) Balanced   — Budget read-only + capable coding (~\$0.03-0.11/cycle)"
  echo "  3) Premium    — Premium implementation (~\$0.10-0.30/cycle)"
  echo "  4) Check      — Analyze current config"
  echo "  5) Restore    — Restore from backup"
  echo ""

  read -rp "Choice [1-5]: " choice

  case "$choice" in
    1) generate_config "budget" ;;
    2) generate_config "balanced" ;;
    3) generate_config "premium" ;;
    4) check_config ;;
    5) restore_config ;;
    *) err "Invalid choice"; return 1 ;;
  esac
}

# ── Main ────────────────────────────────────────────────────────────
case "${1:-}" in
  --help|-h)     show_help ;;
  --check)       check_config ;;
  --budget)      generate_config "budget" ;;
  --balanced)    generate_config "balanced" ;;
  --premium)     generate_config "premium" ;;
  --restore)     restore_config ;;
  *)             interactive_setup ;;
esac

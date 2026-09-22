#!/usr/bin/env bash
# Install Orchestra bundle to ~/.cursor AND ~/.config/opencode (global, all projects)
# Usage:
#   bash install.sh              # install both Cursor + OpenCode (default)
#   bash install.sh --all        # same as default
#   bash install.sh --cursor     # Cursor only
#   bash install.sh --opencode   # OpenCode only
#   bash install.sh --project    # also install project bridge in current repo
#   bash install.sh --all --project
#   bash install.sh --skip-opencode-upgrade   # skip npm/bun OpenCode CLI upgrade
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BUNDLE="$ROOT/bundle"
CURSOR="${CURSOR_HOME:-$HOME/.cursor}"
OPENCODE="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
AGENTS_SKILLS="${AGENTS_SKILLS:-$HOME/.agents/skills}"

INSTALL_CURSOR=0
INSTALL_OPENCODE=0
INSTALL_PROJECT=0
SKIP_OPENCODE_UPGRADE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all)        INSTALL_CURSOR=1; INSTALL_OPENCODE=1; shift ;;
    --cursor)     INSTALL_CURSOR=1; shift ;;
    --opencode)   INSTALL_OPENCODE=1; shift ;;
    --project)    INSTALL_PROJECT=1; shift ;;
    --skip-opencode-upgrade) SKIP_OPENCODE_UPGRADE=1; shift ;;
    -h|--help)
      cat <<'HELP'
Usage: bash install.sh [--all|--cursor|--opencode] [--project] [--skip-opencode-upgrade]

Options:
  --all        Install for both Cursor and OpenCode (default)
  --cursor     Install for Cursor IDE only
  --opencode   Install for OpenCode CLI only
  --project    Also install project bridge (.cursor/) in current repo
  --skip-opencode-upgrade  Skip upgrading OpenCode CLI to latest (npm/bun)

OpenCode: upgrades CLI via scripts/ensure-opencode-latest.sh unless skipped.
          Set OPENCODE_CHANNEL=beta|dev for pre-release builds.
          Runs free-model refresh + --apply once, then installs the weekly
          schedule (systemd user timer; cron fallback if systemd missing).
          Restart the OpenCode desktop app after install (sidecar sync).

No flags = --all. Restart IDE/editor after install.
HELP
      exit 0 ;;
    *) echo "Unknown option: $1 (try --help)"; exit 1 ;;
  esac
done

# Default: both
if [[ "$INSTALL_CURSOR" -eq 0 && "$INSTALL_OPENCODE" -eq 0 ]]; then
  INSTALL_CURSOR=1
  INSTALL_OPENCODE=1
fi

echo "============================================"
echo " Orchestra Installer (Cursor + OpenCode)"
echo "============================================"
echo ""

###############################################################################
# Cursor installation
###############################################################################
install_cursor() {
  echo "==> Installing Cursor Orchestra to $CURSOR"

  command -v node >/dev/null 2>&1 || { echo "ERROR: 'node' required (install Node.js 18+)"; exit 1; }

  mkdir -p "$CURSOR/hooks/state" "$CURSOR/agents" "$CURSOR/skills" "$CURSOR/skills-cursor" "$CURSOR/rules"

  # Hook scripts + lib modules (replace lib entirely — cp -rf into existing dir nests lib/lib/)
  cp -f "$BUNDLE/hooks/"orchestra-*.js "$CURSOR/hooks/"
  rm -rf "$CURSOR/hooks/lib"
  cp -rf "$BUNDLE/hooks/lib" "$CURSOR/hooks/lib"

  # Default state (don't overwrite)
  if [[ ! -f "$CURSOR/hooks/state/orchestra.json" ]]; then
    cp -f "$BUNDLE/hooks/state/orchestra.json" "$CURSOR/hooks/state/orchestra.json"
  fi

  # Agents, rule, docs
  cp -f "$BUNDLE/agents/orchestra.md" "$CURSOR/agents/" 2>/dev/null || true
  cp -f "$BUNDLE/agents/"orchestra-*.md "$CURSOR/agents/"
  if [[ -d "$BUNDLE/agents/references" ]]; then
    mkdir -p "$CURSOR/agents/references"
    cp -f "$BUNDLE/agents/references/"*.md "$CURSOR/agents/references/" 2>/dev/null || true
  fi
  # Copy enterprise agent category directories (01-idea … 10-review)
  for agent_dir in "$BUNDLE/agents"/*/; do
    [ -d "$agent_dir" ] || continue
    dir_name=$(basename "$agent_dir")
    mkdir -p "$CURSOR/agents/$dir_name"
    cp -rf "$agent_dir"* "$CURSOR/agents/$dir_name/"
  done
  cp -f "$BUNDLE/rules/"*.mdc "$CURSOR/rules/"
  cp -f "$BUNDLE/ORCHESTRA.md" "$CURSOR/ORCHESTRA.md"

  # Copy all Cloudflare skills (orchestra-loop + cloudflare, agents-sdk, etc.)
  for skill_dir in "$BUNDLE/skills"/*/; do
    skill_name=$(basename "$skill_dir")
    rm -rf "$CURSOR/skills/$skill_name"
    mkdir -p "$CURSOR/skills/$skill_name"
    cp -rf "$skill_dir"* "$CURSOR/skills/$skill_name/"
  done

  # Copy all Cursor built-in skills
  if [ -d "$BUNDLE/skills-cursor" ]; then
    for skill_dir in "$BUNDLE/skills-cursor"/*/; do
      skill_name=$(basename "$skill_dir")
      rm -rf "$CURSOR/skills-cursor/$skill_name"
      mkdir -p "$CURSOR/skills-cursor/$skill_name"
      cp -rf "$skill_dir"* "$CURSOR/skills-cursor/$skill_name/"
    done
  fi

  # Merge hooks.json (dedup by command name)
  node - "$CURSOR" "$BUNDLE/hooks.json" <<'MERGE'
const fs = require("fs");
const path = require("path");
const cursor = process.argv[2];
const srcPath = process.argv[3];
const destPath = path.join(cursor, "hooks.json");
const src = JSON.parse(fs.readFileSync(srcPath, "utf8"));
let dest = { version: 1, hooks: {} };
if (fs.existsSync(destPath)) {
  try { dest = JSON.parse(fs.readFileSync(destPath, "utf8")); } catch {}
  dest.hooks = dest.hooks || {};
}
for (const [event, entries] of Object.entries(src.hooks || {})) {
  const existing = dest.hooks[event] || [];
  const names = new Set(existing.map((e) => e.command));
  for (const entry of entries) {
    if (!names.has(entry.command)) existing.push(entry);
  }
  dest.hooks[event] = existing;
}
fs.writeFileSync(destPath, JSON.stringify(dest, null, 2) + "\n");
console.log("  Merged hooks.json ->", destPath);
MERGE

  # Link skills for external discovery (Agent Skills compat path)
  mkdir -p "$AGENTS_SKILLS"
  for link_skill in orchestra-loop prompt-intake verification-before-completion \
      ui-ux-pro-max brand design-system ui-styling; do
    if [[ -d "$CURSOR/skills/$link_skill" ]]; then
      rm -rf "$AGENTS_SKILLS/$link_skill"
      ln -sf "$CURSOR/skills/$link_skill" "$AGENTS_SKILLS/$link_skill" 2>/dev/null || \
        cp -r "$CURSOR/skills/$link_skill" "$AGENTS_SKILLS/$link_skill"
    fi
  done

  # Autonomy: CLI + permissions.json + sandbox.json (preserves auth/model)
  node "$ROOT/scripts/merge-autonomy-config.js" --cursor --cursor-home "$CURSOR"

  echo "  Cursor agents:    $CURSOR/agents/orchestra.md + orchestra-*.md"
  echo "  Cursor hooks:     $CURSOR/hooks/"
  echo "  Cursor skills:    $CURSOR/skills/ (orchestra-loop + intake/verify + UI + Cloudflare)"
  echo "  Cursor built-in:  $CURSOR/skills-cursor/ (17 skills)"
  echo "  Cursor autonomy:  $CURSOR/cli-config.json + permissions.json + sandbox.json"
  echo "  Agents skills:    $AGENTS_SKILLS/{orchestra-loop,prompt-intake,verification-before-completion,ui-ux-pro-max,brand,design-system,ui-styling}"
}

###############################################################################
# OpenCode installation
###############################################################################
install_opencode() {
  echo "==> Installing OpenCode Orchestra to $OPENCODE"

  if [[ "$SKIP_OPENCODE_UPGRADE" -eq 0 ]]; then
    bash "$ROOT/scripts/ensure-opencode-latest.sh" || {
      echo "WARN OpenCode upgrade failed — continuing with existing CLI if present"
    }
  fi

  # Free-model refresh + dynamic apply (before agent copy + autonomy merge so
  # installed files carry the current light/heavy free-pool assignment).
  echo "==> Free-model refresh + apply"
  if bash "$ROOT/scripts/update-free-models.sh" --refresh --apply; then
    echo "  Free models: global model set; agent hardcodes stripped (inherit)"
  else
    echo "WARN free-model refresh/apply failed (offline first-run?) — keeping existing model IDs"
  fi

  mkdir -p "$OPENCODE/agents" "$OPENCODE/skills" "$OPENCODE/state" "$OPENCODE/hooks"

  # Copy OpenCode agents (conductor + core + enterprise category dirs)
  cp -f "$BUNDLE/opencode/agents/orchestra.md" "$OPENCODE/agents/" 2>/dev/null || true
  cp -f "$BUNDLE/opencode/agents/"orchestra-*.md "$OPENCODE/agents/" 2>/dev/null || true
  if [[ -d "$BUNDLE/agents/references" ]]; then
    mkdir -p "$OPENCODE/agents/references"
    cp -f "$BUNDLE/agents/references/orchestra-spawn-matrix.md" "$OPENCODE/agents/references/" 2>/dev/null || true
  fi
  for agent_dir in "$BUNDLE/opencode/agents"/*/; do
    [ -d "$agent_dir" ] || continue
    dir_name=$(basename "$agent_dir")
    mkdir -p "$OPENCODE/agents/$dir_name"
    cp -rf "$agent_dir"* "$OPENCODE/agents/$dir_name/"
  done

  # Inherit: strip agent frontmatter model: after copy so subagents use global model
  find "$OPENCODE/agents" -name '*.md' -print0 2>/dev/null | while IFS= read -r -d '' f; do
    if grep -qE '^model:[[:space:]]*opencode/' "$f" 2>/dev/null; then
      python3 - "$f" <<'PY'
import re, sys
path = sys.argv[1]
text = open(path, encoding='utf-8').read()
bom = ''
if text.startswith('﻿'):
    bom, text = '﻿', text[1:]
m = re.match(r'^---\n(.*?)\n---\n(.*)$', text, re.S)
if not m:
    sys.exit(0)
fm, rest = m.group(1), m.group(2)
new_fm, n = re.subn(r'(?m)^model:[ \t]*opencode/[A-Za-z0-9_.-]+[ \t]*\n?', '', fm)
if n:
    new_fm = re.sub(r'\n{3,}', '\n\n', new_fm)
    open(path, 'w', encoding='utf-8').write(bom + '---\n' + new_fm + '\n---\n' + rest)
PY
    fi
  done

  # Copy all OpenCode skills (orchestra-loop + Cloudflare)
  for skill_dir in "$BUNDLE/opencode/skills"/*/; do
    skill_name=$(basename "$skill_dir")
    rm -rf "$OPENCODE/skills/$skill_name"
    mkdir -p "$OPENCODE/skills/$skill_name"
    cp -rf "$skill_dir"* "$OPENCODE/skills/$skill_name/"
  done

  # Copy all OpenCode hooks + lib (not just health check)
  cp -f "$BUNDLE/opencode/hooks/"orchestra-*.js "$OPENCODE/hooks/"
  rm -rf "$OPENCODE/hooks/lib"
  cp -rf "$BUNDLE/opencode/hooks/lib" "$OPENCODE/hooks/lib"
  cp -f "$ROOT/scripts/lib/opencode-config-sanitize.js" "$ROOT/scripts/lib/opencode-version.js" \
    "$OPENCODE/hooks/lib/" 2>/dev/null || true
  # Default state (don't overwrite) — runtime reads hooks/state/orchestra.json
  mkdir -p "$OPENCODE/hooks/state"
  if [[ ! -f "$OPENCODE/hooks/state/orchestra.json" ]]; then
    cp -f "$BUNDLE/opencode/state/orchestra.json" "$OPENCODE/hooks/state/orchestra.json"
  fi

  # Global AGENTS.md (don't overwrite — user may have customized)
  if [[ ! -f "$OPENCODE/AGENTS.md" ]]; then
    cp -f "$BUNDLE/config/opencode/AGENTS.md" "$OPENCODE/AGENTS.md"
  fi

  # Link to external skills directory
  mkdir -p "$AGENTS_SKILLS"
  for link_skill in orchestra-loop prompt-intake verification-before-completion \
      ui-ux-pro-max brand design-system ui-styling; do
    if [[ -d "$OPENCODE/skills/$link_skill" ]]; then
      rm -rf "$AGENTS_SKILLS/$link_skill"
      ln -sf "$OPENCODE/skills/$link_skill" "$AGENTS_SKILLS/$link_skill" 2>/dev/null || \
        cp -r "$OPENCODE/skills/$link_skill" "$AGENTS_SKILLS/$link_skill"
    fi
  done

  # Autonomy: merge permission/agent into opencode.json (preserves mcp secrets)
  node "$ROOT/scripts/merge-autonomy-config.js" --opencode --opencode-home "$OPENCODE"

  # Weekly free-model schedule: systemd user timer; cron fallback if missing
  if bash "$ROOT/scripts/update-free-models.sh" --schedule; then
    echo "  Free-model schedule: weekly refresh+apply installed"
  else
    echo "WARN could not install weekly free-model schedule — add manually:"
    echo "      17 4 * * 1 bash $ROOT/scripts/update-free-models.sh --refresh --apply"
  fi

  echo "  OpenCode agents:  $OPENCODE/agents/ (core + enterprise)"
  echo "  OpenCode skills:  $OPENCODE/skills/ (orchestra-loop + intake/verify + UI + Cloudflare)"
  echo "  OpenCode state:   $OPENCODE/state/orchestra.json"
  echo "  OpenCode autonomy:$OPENCODE/opencode.json (permission + agents; mcp preserved)"
  echo "  OpenCode CLI:     run 'opencode --version' — restart desktop app after upgrade"
}

###############################################################################
# Health checks
###############################################################################
health_cursor() {
  if [[ -f "$CURSOR/hooks/orchestra-health.js" ]]; then
    echo ""
    echo "==> Cursor health check"
    node "$CURSOR/hooks/orchestra-health.js" || true
  fi
}

health_opencode() {
  echo ""
  echo "==> OpenCode health check"
  if [[ -f "$OPENCODE/hooks/orchestra-health-opencode.js" ]]; then
    node "$OPENCODE/hooks/orchestra-health-opencode.js" || true
  else
    echo "WARN: health check script not found at $OPENCODE/hooks/orchestra-health-opencode.js"
  fi
}

###############################################################################
# Project bridge
###############################################################################
install_project_bridge() {
  REPO_ROOT="$(cd "$ROOT/.." && pwd)"
  echo "==> Installing project bridge to $REPO_ROOT/.cursor"
  mkdir -p "$REPO_ROOT/.cursor/hooks"
  cp -f "$ROOT/project-bridge/hooks.json" "$REPO_ROOT/.cursor/hooks.json"
  cp -f "$ROOT/project-bridge/hooks/bridge.js" "$REPO_ROOT/.cursor/hooks/bridge.js"
}

###############################################################################
# Repo scoping (cross-tool ignore files)
###############################################################################
install_scoping() {
  echo "==> Installing repo scoping (cross-tool ignore files)"

  # Install setup-repo-scoping.sh to ~/.local/bin
  mkdir -p "$HOME/.local/bin"
  if [[ -f "$ROOT/scripts/setup-repo-scoping.sh" ]]; then
    rm -f "$HOME/.local/bin/setup-repo-scoping.sh"
    cp -f "$ROOT/scripts/setup-repo-scoping.sh" "$HOME/.local/bin/setup-repo-scoping.sh"
    chmod +x "$HOME/.local/bin/setup-repo-scoping.sh"
    echo "  Global script:   ~/.local/bin/setup-repo-scoping.sh"
  fi

  # Install opencode-maintenance.sh to ~/.local/bin
  if [[ -f "$ROOT/scripts/opencode-maintenance.sh" ]]; then
    rm -f "$HOME/.local/bin/opencode-maintenance.sh"
    cp -f "$ROOT/scripts/opencode-maintenance.sh" "$HOME/.local/bin/opencode-maintenance.sh"
    chmod +x "$HOME/.local/bin/opencode-maintenance.sh"
    echo "  Maintenance:     ~/.local/bin/opencode-maintenance.sh"
  fi

  # Global gitignore — excludes common heavy dirs from all repos
  mkdir -p "$HOME/.config/git"
  local GITIGNORE="$HOME/.config/git/ignore"
  if [[ ! -f "$GITIGNORE" ]]; then
    cat > "$GITIGNORE" <<'GITEOF'
node_modules/
vendor/
dist/
build/
coverage/
.next/
.turbo/
.cache/
.ruff_cache/
.mypy_cache/
.pytest_cache/
__pycache__/
venv/
.venv/
env/
*.pyc
*.log
.DS_Store
GITEOF
    echo "  Global gitignore: $GITIGNORE"
  else
    echo "  Global gitignore: $GITIGNORE (exists, kept)"
  fi

  # Tell git to use it
  if command -v git >/dev/null 2>&1; then
    git config --global core.excludesfile "$GITIGNORE"
    echo "  git excludesfile: $(git config --global core.excludesfile)"
  fi

  echo "  Usage:           setup-repo-scoping.sh /path/to/any/repo"
  echo "  Auto-detects:    single-repo vs monorepo, generates .ignore + .cursorignore"
}

###############################################################################
# Main
###############################################################################
if [[ "$INSTALL_CURSOR" -eq 1 ]]; then
  install_cursor
fi

if [[ "$INSTALL_OPENCODE" -eq 1 ]]; then
  install_opencode
fi

if [[ "$INSTALL_PROJECT" -eq 1 ]]; then
  install_project_bridge
fi

# Repo scoping (always install — benefits all tools on the device)
install_scoping

# Health checks
if [[ "$INSTALL_CURSOR" -eq 1 ]]; then
  health_cursor
fi
if [[ "$INSTALL_OPENCODE" -eq 1 ]]; then
  health_opencode
fi

echo ""
echo "============================================"
echo " Orchestra installed!"
echo ""
if [[ "$INSTALL_CURSOR" -eq 1 ]]; then
  echo "  Cursor global:   $CURSOR"
  echo "  Cursor hooks:    Settings → Hooks (restart Cursor IDE)"
  echo "  Cursor autonomy: permissions.json + sandbox.json + cli-config (merged)"
  echo "  Cursor Approvals: Settings → Agents → Approvals → Auto-review"
  echo "  Cursor test:     node $CURSOR/hooks/orchestra-health.js"
  echo "  Cursor status:   node $CURSOR/hooks/orchestra-enable.js status"
fi
if [[ "$INSTALL_OPENCODE" -eq 1 ]]; then
  echo "  OpenCode global: $OPENCODE"
  echo "  OpenCode tip:    opencode --auto  (session auto-approve; denies still bind)"
  echo "  OpenCode test:   node $OPENCODE/hooks/orchestra-health-opencode.js"
  echo "  Free models:     bash scripts/update-free-models.sh --refresh --apply (weekly via systemd/cron)"
fi
echo "  Repo scoping:    ~/.local/bin/setup-repo-scoping.sh (run on any repo)"
echo "  Maintenance:    ~/.local/bin/opencode-maintenance.sh --apply (clean DB/logs)"
echo "  Global gitignore: ~/.config/git/ignore (node_modules, vendor, venv, caches)"
echo ""
echo "  Docs: docs/autonomous-workflow.md"
echo "  Restart Cursor IDE or opencode for changes to take effect."
echo "============================================"

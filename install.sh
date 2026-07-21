#!/usr/bin/env bash
# Install Orchestra bundle to ~/.cursor AND ~/.config/opencode (global, all projects)
# Usage:
#   bash install.sh              # install both Cursor + OpenCode (default)
#   bash install.sh --all        # same as default
#   bash install.sh --cursor     # Cursor only
#   bash install.sh --opencode   # OpenCode only
#   bash install.sh --project    # also install project bridge in current repo
#   bash install.sh --all --project
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BUNDLE="$ROOT/bundle"
CURSOR="${CURSOR_HOME:-$HOME/.cursor}"
OPENCODE="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
AGENTS_SKILLS="${AGENTS_SKILLS:-$HOME/.agents/skills}"

INSTALL_CURSOR=0
INSTALL_OPENCODE=0
INSTALL_PROJECT=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all)        INSTALL_CURSOR=1; INSTALL_OPENCODE=1; shift ;;
    --cursor)     INSTALL_CURSOR=1; shift ;;
    --opencode)   INSTALL_OPENCODE=1; shift ;;
    --project)    INSTALL_PROJECT=1; shift ;;
    -h|--help)
      cat <<'HELP'
Usage: bash install.sh [--all|--cursor|--opencode] [--project]

Options:
  --all        Install for both Cursor and OpenCode (default)
  --cursor     Install for Cursor IDE only
  --opencode   Install for OpenCode CLI only
  --project    Also install project bridge (.cursor/) in current repo

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
  cp -f "$BUNDLE/agents/"orchestra-*.md "$CURSOR/agents/"
  # Copy enterprise agent category directories (01-idea … 10-review)
  for agent_dir in "$BUNDLE/agents"/*/; do
    [ -d "$agent_dir" ] || continue
    dir_name=$(basename "$agent_dir")
    mkdir -p "$CURSOR/agents/$dir_name"
    cp -rf "$agent_dir"* "$CURSOR/agents/$dir_name/"
  done
  cp -f "$BUNDLE/rules/orchestra-loop.mdc" "$CURSOR/rules/"
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
  for link_skill in orchestra-loop prompt-intake verification-before-completion; do
    if [[ -d "$CURSOR/skills/$link_skill" ]]; then
      rm -rf "$AGENTS_SKILLS/$link_skill"
      ln -sf "$CURSOR/skills/$link_skill" "$AGENTS_SKILLS/$link_skill" 2>/dev/null || \
        cp -r "$CURSOR/skills/$link_skill" "$AGENTS_SKILLS/$link_skill"
    fi
  done

  echo "  Cursor agents:    $CURSOR/agents/orchestra-*.md"
  echo "  Cursor hooks:     $CURSOR/hooks/"
  echo "  Cursor skills:    $CURSOR/skills/ (orchestra-loop + intake/verify + Cloudflare)"
  echo "  Cursor built-in:  $CURSOR/skills-cursor/ (17 skills)"
  echo "  Agents skills:    $AGENTS_SKILLS/{orchestra-loop,prompt-intake,verification-before-completion}"
}

###############################################################################
# OpenCode installation
###############################################################################
install_opencode() {
  echo "==> Installing OpenCode Orchestra to $OPENCODE"

  mkdir -p "$OPENCODE/agents" "$OPENCODE/skills" "$OPENCODE/state" "$OPENCODE/hooks"

  # Copy OpenCode agents (core + enterprise category dirs)
  cp -f "$BUNDLE/opencode/agents/"orchestra-*.md "$OPENCODE/agents/" 2>/dev/null || true
  for agent_dir in "$BUNDLE/opencode/agents"/*/; do
    [ -d "$agent_dir" ] || continue
    dir_name=$(basename "$agent_dir")
    mkdir -p "$OPENCODE/agents/$dir_name"
    cp -rf "$agent_dir"* "$OPENCODE/agents/$dir_name/"
  done

  # Copy all OpenCode skills (orchestra-loop + Cloudflare)
  for skill_dir in "$BUNDLE/opencode/skills"/*/; do
    skill_name=$(basename "$skill_dir")
    rm -rf "$OPENCODE/skills/$skill_name"
    mkdir -p "$OPENCODE/skills/$skill_name"
    cp -rf "$skill_dir"* "$OPENCODE/skills/$skill_name/"
  done

  # Copy health check
  cp -f "$BUNDLE/opencode/hooks/orchestra-health-opencode.js" "$OPENCODE/hooks/"

  # Default state (don't overwrite)
  if [[ ! -f "$OPENCODE/state/orchestra.json" ]]; then
    cp -f "$BUNDLE/opencode/state/orchestra.json" "$OPENCODE/state/orchestra.json"
  fi

  # Link to external skills directory
  mkdir -p "$AGENTS_SKILLS"
  for link_skill in orchestra-loop prompt-intake verification-before-completion; do
    if [[ -d "$OPENCODE/skills/$link_skill" ]]; then
      rm -rf "$AGENTS_SKILLS/$link_skill"
      ln -sf "$OPENCODE/skills/$link_skill" "$AGENTS_SKILLS/$link_skill" 2>/dev/null || \
        cp -r "$OPENCODE/skills/$link_skill" "$AGENTS_SKILLS/$link_skill"
    fi
  done

  echo "  OpenCode agents:  $OPENCODE/agents/ (core + enterprise)"
  echo "  OpenCode skills:  $OPENCODE/skills/ (orchestra-loop + intake/verify + Cloudflare)"
  echo "  OpenCode state:   $OPENCODE/state/orchestra.json"
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
  echo "  Cursor test:     node $CURSOR/hooks/orchestra-health.js"
  echo "  Cursor status:   node $CURSOR/hooks/orchestra-enable.js status"
fi
if [[ "$INSTALL_OPENCODE" -eq 1 ]]; then
  echo "  OpenCode global: $OPENCODE"
  echo "  OpenCode test:   node $OPENCODE/hooks/orchestra-health-opencode.js"
fi
echo ""
echo "  Restart Cursor IDE or opencode for changes to take effect."
echo "============================================"

#!/usr/bin/env bash
# Install Cursor Orchestra bundle to ~/.cursor (global, all projects)
# Usage:
#   bash cursor-orchestra/install.sh
#   bash cursor-orchestra/install.sh --project   # also install project bridge in current repo
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BUNDLE="$ROOT/bundle"
CURSOR="${CURSOR_HOME:-$HOME/.cursor}"
INSTALL_PROJECT=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) INSTALL_PROJECT=1; shift ;;
    -h|--help)
      echo "Usage: bash cursor-orchestra/install.sh [--project]"
      exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "ERROR: '$1' required (install Node.js 18+)"; exit 1; }
}
need_cmd node

echo "==> Installing Cursor Orchestra to $CURSOR"

mkdir -p "$CURSOR/hooks/state" "$CURSOR/agents" "$CURSOR/skills" "$CURSOR/rules"

# Hooks scripts
cp -f "$BUNDLE/hooks/"orchestra-*.js "$CURSOR/hooks/"

# Default state (don't overwrite if exists)
if [[ ! -f "$CURSOR/hooks/state/orchestra.json" ]]; then
  cp -f "$BUNDLE/hooks/state/orchestra.json" "$CURSOR/hooks/state/orchestra.json"
fi

# Agents, skill, rule, docs
cp -f "$BUNDLE/agents/"orchestra-*.md "$CURSOR/agents/"
mkdir -p "$CURSOR/skills/orchestra-loop"
cp -f "$BUNDLE/skills/orchestra-loop/SKILL.md" "$CURSOR/skills/orchestra-loop/"
cp -f "$BUNDLE/rules/orchestra-loop.mdc" "$CURSOR/rules/"
cp -f "$BUNDLE/ORCHESTRA.md" "$CURSOR/ORCHESTRA.md"

# Optional: link skill for .agents/skills discovery
AGENTS_SKILLS="${AGENTS_SKILLS:-$HOME/.agents/skills}"
mkdir -p "$AGENTS_SKILLS"
if [[ ! -e "$AGENTS_SKILLS/orchestra-loop" ]]; then
  ln -sf "$CURSOR/skills/orchestra-loop" "$AGENTS_SKILLS/orchestra-loop" 2>/dev/null || \
    cp -r "$CURSOR/skills/orchestra-loop" "$AGENTS_SKILLS/orchestra-loop"
fi

# Merge hooks.json
node - "$CURSOR" "$BUNDLE/hooks.json" <<'NODE'
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
console.log("Merged hooks.json ->", destPath);
NODE

if [[ "$INSTALL_PROJECT" -eq 1 ]]; then
  REPO_ROOT="$(pwd)"
  echo "==> Installing project bridge to $REPO_ROOT/.cursor"
  mkdir -p "$REPO_ROOT/.cursor/hooks"
  cp -f "$ROOT/project-bridge/hooks.json" "$REPO_ROOT/.cursor/hooks.json"
  cp -f "$ROOT/project-bridge/hooks/bridge.js" "$REPO_ROOT/.cursor/hooks/bridge.js"
fi

echo ""
echo "==> Health check"
node "$CURSOR/hooks/orchestra-health.js" || true

echo ""
echo "============================================"
echo " Cursor Orchestra installed!"
echo "  Global:  $CURSOR"
echo "  Docs:    $CURSOR/ORCHESTRA.md"
echo ""
echo "  Restart Cursor IDE, then check Settings → Hooks"
echo ""
echo "  Test:    node $CURSOR/hooks/orchestra-health.js"
echo "  Status:  node $CURSOR/hooks/orchestra-enable.js status"
echo "  Off:     node $CURSOR/hooks/orchestra-enable.js ambient-off"
echo "  Bootstrap context: bash $ROOT/scripts/init-context.sh /path/to/project"
echo "============================================"

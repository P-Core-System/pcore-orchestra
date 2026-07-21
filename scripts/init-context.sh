#!/usr/bin/env bash
# Bootstrap Six-File Context in a target project (JavaScript Mastery methodology).
# Usage:
#   bash scripts/init-context.sh /path/to/project
#   bash scripts/init-context.sh /path/to/project --bridge
#   bash scripts/init-context.sh /path/to/project --force
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATES="$ROOT/templates"
TARGET="${1:-.}"
BRIDGE=false
FORCE=false

shift || true
for arg in "$@"; do
  case "$arg" in
    --bridge) BRIDGE=true ;;
    --force) FORCE=true ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

TARGET="$(cd "$TARGET" && pwd)"
CTX="$TARGET/context"

echo "==> Six-File Context bootstrap"
echo "    Target: $TARGET"
mkdir -p "$CTX"

copy_if_missing() {
  local src="$1" dest="$2"
  if [[ -f "$dest" && "$FORCE" != true ]]; then
    echo "    skip (exists): $dest"
    return
  fi
  cp "$src" "$dest"
  echo "    wrote: $dest"
}

for f in project-overview.md architecture.md code-standards.md ai-workflow-rules.md ui-context.md progress-tracker.md project-setup.md; do
  copy_if_missing "$TEMPLATES/context/$f" "$CTX/$f"
done

mkdir -p "$CTX/specs"
copy_if_missing "$TEMPLATES/context/specs/README.md" "$CTX/specs/README.md"
copy_if_missing "$TEMPLATES/context/specs/_unit-spec.template.md" "$CTX/specs/_unit-spec.template.md"

copy_if_missing "$TEMPLATES/AGENTS.md" "$TARGET/AGENTS.md"

if [[ "$BRIDGE" == true ]]; then
  echo "==> Installing project bridge"
  mkdir -p "$TARGET/.cursor/hooks"
  cp "$ROOT/project-bridge/hooks.json" "$TARGET/.cursor/hooks.json"
  cp "$ROOT/project-bridge/hooks/bridge.js" "$TARGET/.cursor/hooks/bridge.js"
  echo "    wrote: $TARGET/.cursor/hooks.json"
fi

echo ""
echo "==> Done. Fill in context/*.md using your planning conversation."
echo "    Entry point: $TARGET/AGENTS.md"
echo "    Install global orchestra: bash $ROOT/install.sh"

#!/usr/bin/env bash
# migrate-studio-scope.sh — one-shot migration of global studio state into a
# repo partition: <global>/ -> <global>/repos/<scope>/.
#
#   bash scripts/migrate-studio-scope.sh [--scope NAME] [--apply]
#
# Default is --dry-run (lists what would move). --apply copies (never deletes
# the global originals, so unscoped dashboards keep working until you remove
# them). Re-runs are idempotent: files that already exist at the destination
# with identical bytes are skipped.
#
# Migrated entries: conductor-runs/, domain-events.json, orchestra-tokens.json,
# team-sessions.json, orchestra-history.json, review-queue.json, wake + discuss
# state — i.e. every *.json top-level file plus conductor-runs/.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/scripts/lib/repo-scope.sh"

SCOPE=""
APPLY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --scope) SCOPE="${2:-}"; shift 2 ;;
    --scope=*) SCOPE="${1#--scope=}"; shift ;;
    --apply) APPLY=1; shift ;;
    -h|--help)
      echo "Usage: bash scripts/migrate-studio-scope.sh [--scope NAME] [--apply]"
      echo "  --scope NAME  repo scope (default: current repo slug)"
      echo "  --apply       copy into repos/<scope>/ (default: dry-run list only)"
      exit 0 ;;
    *) echo "Unknown option: $1 (try --help)"; exit 1 ;;
  esac
done

if [[ -z "$SCOPE" ]]; then
  SCOPE="$(pcore_repo_scope)"
fi
SLUG="$(printf '%s' "$SCOPE" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' | cut -c1-32 | sed -E 's/-+$//')"
[[ -z "$SLUG" ]] && SLUG="default"

GLOBAL="$(pcore_global_state_dir)"
DEST="$GLOBAL/repos/$SLUG"

echo "== studio scope migration =="
echo "  global: $GLOBAL"
echo "  scope:  $SLUG"
echo "  dest:   $DEST"
echo "  mode:   $([[ "$APPLY" -eq 1 ]] && echo APPLY || echo dry-run)"

if [[ ! -d "$GLOBAL" ]]; then
  echo "  nothing to migrate: global state dir does not exist"
  exit 0
fi

MOVED=0
SKIPPED=0
migrate_path() { # $1 = relative path
  local rel="$1" src="$GLOBAL/$rel" dst="$DEST/$rel"
  [[ -e "$src" ]] || return 0
  if [[ -e "$dst" ]] && cmp -s "$src" "$dst"; then
    echo "  skip (identical): $rel"
    SKIPPED=$((SKIPPED + 1))
    return 0
  fi
  if [[ "$APPLY" -eq 1 ]]; then
    mkdir -p "$(dirname "$dst")"
    cp -r "$src" "$dst"
    echo "  copied: $rel"
  else
    echo "  would copy: $rel"
  fi
  MOVED=$((MOVED + 1))
}

for entry in "$GLOBAL"/*.json; do
  [[ -e "$entry" ]] || continue
  case "$(basename "$entry")" in
    studio-ports.json) continue ;; # registry stays global — it maps every scope
    *) migrate_path "$(basename "$entry")" ;;
  esac
done
migrate_path "conductor-runs"

echo ""
if [[ "$APPLY" -eq 1 ]]; then
  echo "migrated $MOVED entr$( [[ "$MOVED" -eq 1 ]] && echo y || echo ies ) into $DEST ($SKIPPED identical skipped)"
  echo "global originals kept in place — remove them only after the scoped dashboard is verified."
else
  echo "dry-run: $MOVED would move, $SKIPPED identical. Re-run with --apply to copy."
fi

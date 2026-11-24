#!/usr/bin/env bash
# repo-scope.sh — shell source of truth for global-studio repo scoping.
#   source "$REPO_ROOT/scripts/lib/repo-scope.sh"
#   scope="$(pcore_repo_scope)"            # explicit $PCORE_REPO_SCOPE, else git/cwd slug
#   root="$(pcore_orchestra_repo)"         # single clone: env > /opt > ~/pcore > script parent
#   port="$(pcore_scope_port "$scope")"    # 3110+hash, pinned in <global>/studio-ports.json
#
# Pure bash except port allocation, which delegates to the bundle's
# studio-scope.js (node is already a hard install requirement).

# Single clone resolution (never copy the bundle per repo):
# PCORE_ORCHESTRA_REPO > /opt/pcore-orchestra > ~/pcore-orchestra > ~/pcore > caller.
pcore_orchestra_repo() {
  if [[ -n "${PCORE_ORCHESTRA_REPO:-}" ]]; then
    printf '%s' "$PCORE_ORCHESTRA_REPO"
    return 0
  fi
  local c
  for c in "/opt/pcore-orchestra" "$HOME/pcore-orchestra" "$HOME/pcore"; do
    if [[ -d "$c" ]]; then
      printf '%s' "$c"
      return 0
    fi
  done
  printf '%s' "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
}

# Sanitized scope slug: explicit env wins, else git top-level basename, else cwd.
pcore_repo_scope() {
  if [[ -n "${PCORE_REPO_SCOPE:-}" ]]; then
    printf '%s' "$PCORE_REPO_SCOPE" | tr '[:upper:]' '[:lower:]' \
      | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' | cut -c1-32 | sed -E 's/-+$//'
    return 0
  fi
  local top=""
  top="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  local base
  if [[ -n "${PCORE_REPO_SCOPE:-}" ]]; then
    base="$PCORE_REPO_SCOPE"
  elif [[ -n "$top" ]]; then
    base="$(basename "$top")"
  else
    base="$(basename "$PWD")"
  fi
  local out
  out="$(printf '%s' "$base" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' | cut -c1-32 | sed -E 's/-+$//')"
  if [[ -z "$out" ]]; then
    printf 'default'
  else
    printf '%s' "$out"
  fi
}

# Global state dir (unscoped root; per-repo partitions live under repos/).
pcore_global_state_dir() {
  if [[ -n "${PCORE_STATE_DIR:-}" ]]; then
    printf '%s' "$PCORE_STATE_DIR"
  else
    printf '%s' "$HOME/.config/opencode/hooks/state"
  fi
}

# Stable port for a scope (allocates + persists via studio-scope.js).
pcore_scope_port() {
  local scope="${1:-$(pcore_repo_scope)}"
  local root
  root="$(pcore_orchestra_repo)"
  node -e '
    const lib = require(process.argv[1]);
    const scope = process.argv[2] || "default";
    const globalDir = process.env.PCORE_STATE_DIR || require("os").homedir() + "/.config/opencode/hooks/state";
    process.stdout.write(String(lib.allocatePort(scope, globalDir)));
  ' "$root/bundle/hooks/lib/studio-scope.js" "$scope"
}

# Read-only port resolution (no registry write).
pcore_resolve_port() {
  local scope="${1:-$(pcore_repo_scope)}"
  local root
  root="$(pcore_orchestra_repo)"
  node -e '
    const lib = require(process.argv[1]);
    const scope = process.argv[2] || "default";
    const globalDir = process.env.PCORE_STATE_DIR || require("os").homedir() + "/.config/opencode/hooks/state";
    process.stdout.write(String(lib.resolvePort(scope, globalDir)));
  ' "$root/bundle/hooks/lib/studio-scope.js" "$scope"
}

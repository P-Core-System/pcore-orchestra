#!/usr/bin/env bash
# gws.sh — thin Git-Bash wrapper over scripts/google-workspace/gws.js.
# Opt-in Google Workspace connector: default DRY-RUN, --apply executes.
# Works from any cwd; cygpath-safe for native win32 node.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)"
GWS_JS="$REPO_ROOT/scripts/google-workspace/gws.js"

# Windows Git Bash: a native win32 node cannot require() a POSIX /d/... path.
# Convert to mixed form (D:/...) when node is win32 and cygpath exists;
# POSIX stays a byte-identical passthrough.
if node -e 'process.exit(process.platform === "win32" ? 0 : 1)' 2>/dev/null; then
  if command -v cygpath >/dev/null 2>&1; then
    GWS_JS="$(cygpath -m "$GWS_JS")"
  fi
fi

if [ ! -f "$GWS_JS" ]; then
  echo "gws.sh: connector not found: $GWS_JS" >&2
  exit 1
fi

node "$GWS_JS" "$@"

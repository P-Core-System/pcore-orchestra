#!/usr/bin/env bash
# setup-google-workspace.sh — opt-in installer for the GWS connector.
# Installs subdir deps (npm ci), creates the OS-protected creds dir with
# 600 perms. NEVER run by install.sh (explicit opt-in only).
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)"
GWS_DIR="$REPO_ROOT/scripts/google-workspace"
CREDS_DIR="${PCORE_GWS_CREDS_DIR:-$HOME/.config/pcore/gws}"

echo "GWS setup: installing connector deps (opt-in, local only)..."
if ! command -v npm >/dev/null 2>&1; then
  echo "setup-google-workspace.sh: npm not found; install Node.js first" >&2
  exit 1
fi

(cd -- "$GWS_DIR" && npm ci --ignore-scripts)

mkdir -p "$CREDS_DIR"
chmod 700 "$CREDS_DIR" 2>/dev/null || true
# Harden any existing creds files (no secrets are written by this script).
for f in "$CREDS_DIR"/gws-tokens.json "$CREDS_DIR"/gws-client*.json; do
  [ -e "$f" ] || continue
  chmod 600 "$f" 2>/dev/null || true
done
# Windows ACL: restrict to the current user when icacls exists.
if command -v icacls >/dev/null 2>&1; then
  icacls "$CREDS_DIR" /inheritance:r /grant:r "$USERNAME:(OI)(CI)F" >/dev/null 2>&1 || true
fi

cat <<EOF
GWS setup complete.
  connector : $GWS_DIR
  creds dir : $CREDS_DIR (700, files 600)
Next: place your OAuth client JSON at
  $CREDS_DIR/gws-client.json
then run:  bash scripts/gws.sh auth login
Status:    bash scripts/gws.sh auth status
Docs:      docs/google-workspace-setup.md
EOF

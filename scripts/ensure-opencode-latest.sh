#!/usr/bin/env bash
# ensure-opencode-latest.sh — install or upgrade OpenCode CLI to latest (or channel).
#
# Targets @opencode/cli (OpenCode v2). The legacy `opencode-ai` npm package is
# the v1 line and is never installed over a v2 CLI (downgrade guard below).
#
# Usage:
#   bash scripts/ensure-opencode-latest.sh
#   OPENCODE_CHANNEL=beta bash scripts/ensure-opencode-latest.sh
#   bash scripts/ensure-opencode-latest.sh --check
#
# Channels: stable (default), beta, dev (npm dist-tags on @opencode/cli)
set -euo pipefail

CHANNEL="${OPENCODE_CHANNEL:-stable}"
CHECK_ONLY=0
ALLOW_REMOTE_SCRIPT=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) CHECK_ONLY=1; shift ;;
    --allow-remote-script) ALLOW_REMOTE_SCRIPT=1; shift ;;
    --channel) CHANNEL="${2:-stable}"; shift 2 ;;
    -h|--help)
      cat <<'EOF'
Usage: bash scripts/ensure-opencode-latest.sh [--check] [--channel stable|beta|dev] [--allow-remote-script]

Upgrades OpenCode CLI before orchestra install. Default channel: stable (npm latest).

Options:
  --check                 Print current vs target version and exit (no install).
  --allow-remote-script  Permit the https://opencode.ai/install (curl | bash)
                         fallback if both bun and npm upgrade paths fail.

Environment:
  OPENCODE_CHANNEL   stable | beta | dev

After upgrade, restart the OpenCode desktop app so its sidecar matches the CLI.
EOF
      exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

parse_version() {
  opencode --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true
}

npm_tag_for_channel() {
  case "$CHANNEL" in
    stable) echo "latest" ;;
    beta)   echo "beta" ;;
    dev)    echo "dev" ;;
    *) echo "Unknown channel: $CHANNEL" >&2; exit 1 ;;
  esac
}

# OpenCode v2 ships as @opencode/cli. The legacy opencode-ai package tops out
# at 1.x — installing it over a v2 CLI clobbers the `opencode` bin and is a
# downgrade, so always target the v2 package and never step down a major.
PKG="@opencode/cli"

BEFORE="$(parse_version || true)"
TAG="$(npm_tag_for_channel)"
TARGET="$(npm view "${PKG}@${TAG}" version 2>/dev/null || true)"

# Refuse auto-downgrades (e.g. npm `latest` pointing at the v1 line).
if [[ -n "$BEFORE" && -n "$TARGET" ]]; then
  BEFORE_MAJOR="${BEFORE%%.*}"
  TARGET_MAJOR="${TARGET%%.*}"
  if (( 10#$BEFORE_MAJOR > 10#$TARGET_MAJOR )); then
    echo "WARN refusing downgrade: $BEFORE -> $TARGET ($PKG@$TAG) — keeping $BEFORE"
    echo "    (v2 lives in $PKG; v1 lives in opencode-ai — check the npm tag)"
    exit 1
  fi
fi

echo "==> OpenCode CLI (channel: $CHANNEL, npm tag: $TAG)"
if [[ -n "$BEFORE" ]]; then
  echo "    Current: $BEFORE"
else
  echo "    Current: (not installed)"
fi
[[ -n "$TARGET" ]] && echo "    Target:  $TARGET"

if [[ "$CHECK_ONLY" -eq 1 ]]; then
  if [[ -z "$BEFORE" ]]; then
    echo "WARN OpenCode CLI not found — run install.sh or this script without --check"
    exit 1
  fi
  echo "OK   OpenCode CLI $BEFORE"
  exit 0
fi

if [[ -n "$BEFORE" && -n "$TARGET" && "$BEFORE" == "$TARGET" ]]; then
  echo "OK   Already on $TARGET"
  exit 0
fi

# Try bun, then npm — each wrapped in `if` so a non-zero exit is handled here
# (and NOT mistaken for success). #23: never set installed=1 on a failed command.
upgraded=0
if command -v bun >/dev/null 2>&1; then
  echo "    Upgrading via bun (${PKG}@${TAG})..."
  if bun install -g "${PKG}@${TAG}"; then
    upgraded=1
  else
    echo "    bun install -g failed (exit $?); trying npm..."
  fi
fi

if [[ "$upgraded" -eq 0 ]] && command -v npm >/dev/null 2>&1; then
  echo "    Upgrading via npm (${PKG}@${TAG})..."
  if npm install -g "${PKG}@${TAG}"; then
    upgraded=1
  else
    echo "    npm install -g failed (exit $?)."
  fi
fi

# curl | bash fallback is OFF by default (#23: piping a remote script to a shell).
if [[ "$upgraded" -eq 0 ]]; then
  if [[ "$ALLOW_REMOTE_SCRIPT" -eq 1 ]]; then
    echo "    Installing via https://opencode.ai/install (--allow-remote-script)..."
    if curl -fsSL https://opencode.ai/install | bash; then
      upgraded=1
    else
      echo "ERROR: remote installer (curl | bash) failed."
      exit 1
    fi
  else
    echo "ERROR: neither bun nor npm could upgrade ${PKG}@${TAG}."
    echo "       The curl | bash fallback is disabled by default. Re-run with"
    echo "       --allow-remote-script, or install ${PKG} manually."
    exit 1
  fi
fi

AFTER="$(parse_version || true)"
if [[ -n "$AFTER" ]]; then
  echo "OK   OpenCode CLI now $AFTER (channel $CHANNEL)"
  # #23: verify the install actually landed the requested version.
  if [[ -n "$TARGET" && "$AFTER" != "$TARGET" ]]; then
    echo "WARN expected $TARGET but got $AFTER (registry tag may have moved, or install did not take effect)"
  fi
else
  echo "WARN Could not verify opencode --version after install"
  exit 1
fi

if [[ "$CHANNEL" == "stable" && -n "$AFTER" ]]; then
  ROOT="$(cd "$(dirname "$0")/.." && pwd)"
  node -e "
    const { supportsToolOutput, MIN_TOOL_OUTPUT_VERSION } = require(process.argv[1]);
    const v = process.argv[2];
    if (!supportsToolOutput(v)) {
      console.log('NOTE tool_output requires OpenCode >=' + MIN_TOOL_OUTPUT_VERSION + '; stable is ' + v + ' — sanitizer strips it until then.');
      console.log('     Early access: OPENCODE_CHANNEL=beta bash scripts/ensure-opencode-latest.sh');
    }
  " "$ROOT/scripts/lib/opencode-version.js" "$AFTER" 2>/dev/null || true
fi

echo "    Restart the OpenCode desktop app after CLI upgrade (sidecar sync)."

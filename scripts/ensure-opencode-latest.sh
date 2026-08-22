#!/usr/bin/env bash
# ensure-opencode-latest.sh — install or upgrade OpenCode CLI to latest (or channel).
#
# Usage:
#   bash scripts/ensure-opencode-latest.sh
#   OPENCODE_CHANNEL=beta bash scripts/ensure-opencode-latest.sh
#   bash scripts/ensure-opencode-latest.sh --check
#
# Channels: stable (default), beta, dev (npm dist-tags on opencode-ai)
set -euo pipefail

CHANNEL="${OPENCODE_CHANNEL:-stable}"
CHECK_ONLY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) CHECK_ONLY=1; shift ;;
    --channel) CHANNEL="${2:-stable}"; shift 2 ;;
    -h|--help)
      cat <<'EOF'
Usage: bash scripts/ensure-opencode-latest.sh [--check] [--channel stable|beta|dev]

Upgrades OpenCode CLI before orchestra install. Default channel: stable (npm latest).

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

BEFORE="$(parse_version || true)"
TAG="$(npm_tag_for_channel)"
TARGET="$(npm view "opencode-ai@${TAG}" version 2>/dev/null || true)"

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

installed=0
if command -v bun >/dev/null 2>&1; then
  echo "    Upgrading via bun (opencode-ai@${TAG})..."
  if bun install -g "opencode-ai@${TAG}"; then
    installed=1
  fi
fi

if [[ "$installed" -eq 0 ]] && command -v npm >/dev/null 2>&1; then
  echo "    Upgrading via npm (opencode-ai@${TAG})..."
  npm install -g "opencode-ai@${TAG}"
  installed=1
fi

if [[ "$installed" -eq 0 ]]; then
  echo "    Installing via https://opencode.ai/install ..."
  curl -fsSL https://opencode.ai/install | bash
  installed=1
fi

AFTER="$(parse_version || true)"
if [[ -n "$AFTER" ]]; then
  echo "OK   OpenCode CLI now $AFTER (channel $CHANNEL)"
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

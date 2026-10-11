#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS=0
FAIL=0

inc_pass() { PASS=$((PASS + 1)); }
inc_fail() { FAIL=$((FAIL + 1)); }

# Setup
TMP_HOME=$(mktemp -d)
export HOME="$TMP_HOME"
export XDG_STATE_HOME="$TMP_HOME/.local/state"
export XDG_CONFIG_HOME="$TMP_HOME/.config"
# Repo root = this script's parent (override for cross-machine/CI runs).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PCORE_ORCHESTRA_REPO="${PCORE_ORCHESTRA_REPO:-$(cd "$SCRIPT_DIR/.." && pwd)}"
export ORCHESTRA_STUDIO_BACKEND="nohup"

SERVICE_SCRIPT="$PCORE_ORCHESTRA_REPO/scripts/studio-service.sh"
TEST_PORT=31199

echo "=== studio-service.sh test suite (HOME=$TMP_HOME) ==="

# Test 1: --help
echo "Test 1: --help"
"$SERVICE_SCRIPT" --help
echo "PASS: --help exit 0"
PASS=$((PASS + 1))

output=$("$SERVICE_SCRIPT" --help 2>&1)
[[ "$output" == *"install"* ]] && echo "PASS: help shows install" && PASS=$((PASS + 1)) || { echo "FAIL: help shows install"; FAIL=$((FAIL + 1)); }
[[ "$output" == *"start"* ]] && echo "PASS: help shows start" && PASS=$((PASS + 1)) || { echo "FAIL: help shows start"; FAIL=$((FAIL + 1)); }
[[ "$output" == *"status"* ]] && echo "PASS: help shows status" && PASS=$((PASS + 1)) || { echo "FAIL: help shows status"; FAIL=$((FAIL + 1)); }
[[ "$output" == *"uninstall"* ]] && echo "PASS: help shows uninstall" && PASS=$((PASS + 1)) || { echo "FAIL: help shows uninstall"; FAIL=$((FAIL + 1)); }
[[ "$output" == *"enable-autostart"* ]] && echo "PASS: help shows enable-autostart" && PASS=$((PASS + 1)) || { echo "FAIL: help shows enable-autostart"; FAIL=$((FAIL + 1)); }
[[ "$output" == *"disable-autostart"* ]] && echo "PASS: help shows disable-autostart" && PASS=$((PASS + 1)) || { echo "FAIL: help shows disable-autostart"; FAIL=$((FAIL + 1)); }

# Test 2: dry-run install
echo "Test 2: dry-run install"
"$SERVICE_SCRIPT" install --port "$TEST_PORT" --dry-run
echo "PASS: dry-run install exit 0"
PASS=$((PASS + 1))

output=$("$SERVICE_SCRIPT" install --port "$TEST_PORT" --dry-run 2>&1)
[[ "$output" == *"nohup backend"* ]] && echo "PASS: dry-run shows backend" && PASS=$((PASS + 1)) || { echo "FAIL: dry-run shows backend"; FAIL=$((FAIL + 1)); }

# Test 3: install (real)
echo "Test 3: install"
"$SERVICE_SCRIPT" install --port "$TEST_PORT"
echo "PASS: install exit 0"
PASS=$((PASS + 1))

[[ "$TEST_PORT" == "$(cat "$TMP_HOME/.local/state/orchestra-studio/studio.port" 2>/dev/null || echo "")" ]] && echo "PASS: port file written" && PASS=$((PASS + 1)) || { echo "FAIL: port file written"; FAIL=$((FAIL + 1)); }
[[ -d "$TMP_HOME/.local/state/orchestra-studio" ]] && echo "PASS: runtime dir created" && PASS=$((PASS + 1)) || { echo "FAIL: runtime dir created"; FAIL=$((FAIL + 1)); }
[[ -d "$TMP_HOME/.local/log/orchestra-studio" ]] && echo "PASS: log dir created" && PASS=$((PASS + 1)) || { echo "FAIL: log dir created"; FAIL=$((FAIL + 1)); }

# Test 4: status (not running)
echo "Test 4: status (not running)"
ACTUAL=0
"$SERVICE_SCRIPT" status || ACTUAL=$?
if [[ "1" == "$ACTUAL" ]]; then
  echo "PASS: status exit 1"
  PASS=$((PASS + 1))
else
  echo "FAIL: status exit $ACTUAL (expected 1)"
  FAIL=$((FAIL + 1))
fi

# Test 5: uninstall
echo "Test 5: uninstall"
"$SERVICE_SCRIPT" uninstall
echo "PASS: uninstall exit 0"
PASS=$((PASS + 1))

ACTUAL=0
"$SERVICE_SCRIPT" status || ACTUAL=$?
if [[ "1" == "$ACTUAL" ]]; then
  echo "PASS: status after uninstall exit 1"
  PASS=$((PASS + 1))
else
  echo "FAIL: status after uninstall exit $ACTUAL (expected 1)"
  FAIL=$((FAIL + 1))
fi

[[ ! -d "$TMP_HOME/.local/state/orchestra-studio" ]] && echo "PASS: runtime dir removed on uninstall" && PASS=$((PASS + 1)) || { echo "FAIL: runtime dir removed on uninstall"; FAIL=$((FAIL + 1)); }

# Test 6: stale pidfile
echo "Test 6: stale pidfile"
mkdir -p "$TMP_HOME/.local/state/orchestra-studio"
echo "999999" > "$TMP_HOME/.local/state/orchestra-studio/studio.pid"
output=$("$SERVICE_SCRIPT" status 2>&1 || true)
[[ "$output" == *"stale"* ]] && echo "PASS: stale pidfile detected" && PASS=$((PASS + 1)) || { echo "FAIL: stale pidfile detected"; FAIL=$((FAIL + 1)); }

# Test 7: systemd unit template
[[ -f "$PCORE_ORCHESTRA_REPO/scripts/systemd/orchestra-studio.service" ]] && echo "PASS: systemd unit template exists" && PASS=$((PASS + 1)) || { echo "FAIL: systemd unit template exists"; FAIL=$((FAIL + 1)); }

# Test 8: launchd plist template
[[ -f "$PCORE_ORCHESTRA_REPO/scripts/launchd/org.pcore.orchestra-studio.plist" ]] && echo "PASS: launchd plist template exists" && PASS=$((PASS + 1)) || { echo "FAIL: launchd plist template exists"; FAIL=$((FAIL + 1)); }

# Test 9: server foreground test
echo "Test 9: server foreground test"
output=$(timeout 3 node "$PCORE_ORCHESTRA_REPO/server/studio-api.js" --port 31299 2>&1 || true)
[[ "$output" == *"STUDIO_API_LISTENING"* ]] && echo "PASS: server starts and listens" && PASS=$((PASS + 1)) || { echo "FAIL: server starts and listens"; FAIL=$((FAIL + 1)); }

rm -rf "$TMP_HOME"

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[[ $FAIL -eq 0 ]] && exit 0 || exit 1

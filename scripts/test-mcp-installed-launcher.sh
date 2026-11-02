#!/usr/bin/env bash
# Regression test for #16: install.sh --mcp must produce an installed mcp-server.js
# that resolves @modelcontextprotocol/sdk (Node's upward walk from <host>/hooks/lib
# never reaches the clone's node_modules). This installs --cursor --mcp into a
# throwaway HOME against the real clone, then boots the launcher the way a host hook
# does (require -> expect .start/.McpServer), and checks the missing-SDK guard.
set -uo pipefail

GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
PASS=0; FAIL=0
ok()  { echo "${GREEN}PASS${NC}: $1"; PASS=$((PASS+1)); }
bad() { echo "${RED}FAIL${NC}: $1"; FAIL=$((FAIL+1)); }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
INSTALL="$ROOT/install.sh"

command -v node >/dev/null 2>&1 || { echo "SKIP: node not available"; exit 0; }
# The clone must already have the SDK (CI runs `npm ci`); otherwise the install
# would hit the network, so we skip rather than make CI flaky.
if ! node -e "require.resolve('@modelcontextprotocol/sdk/server/index.js', { paths: ['$ROOT/node_modules'] })" >/dev/null 2>&1; then
  echo "SKIP: @modelcontextprotocol/sdk not present in $ROOT/node_modules (run npm ci)"
  exit 0
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export HOME="$WORK/home"
export XDG_STATE_HOME="$WORK/state"
export XDG_CONFIG_HOME="$WORK/config"
export PCORE_ORCHESTRA_REPO="$ROOT"
mkdir -p "$HOME"

echo "=== install.sh --mcp launcher test (#16) ==="

# --- 1. real scoped install of Cursor + MCP into the throwaway HOME ------------
if bash "$INSTALL" --cursor --mcp --skip-opencode-upgrade >"$WORK/install.log" 2>&1; then
  ok "install.sh --cursor --mcp exited 0"
else
  bad "install.sh --cursor --mcp failed: $(tail -5 "$WORK/install.log")"
fi
grep -q "SDK resolves" "$WORK/install.log" \
  && ok "install reported the SDK-resolves boot check" \
  || bad "install did not report SDK resolution: $(tail -8 "$WORK/install.log")"

LAUNCHER="$HOME/.cursor/hooks/lib/mcp-server.js"
[[ -f "$LAUNCHER" ]] && ok "installed launcher exists" || bad "no launcher at $LAUNCHER"

# --- 2. boot the launcher exactly as a host hook does --------------------------
# A plain copy would throw "Cannot find module '@modelcontextprotocol/sdk/…'" here.
if node -e "
  const m = require(process.argv[1]);
  if (typeof m.start !== 'function')   { console.error('no .start');   process.exit(2); }
  if (typeof m.McpServer !== 'function'){ console.error('no .McpServer'); process.exit(3); }
  if (typeof m.startHttp !== 'function'){ console.error('no .startHttp'); process.exit(4); }
" "$LAUNCHER" 2>"$WORK/boot.err"; then
  ok "installed launcher boots and exports the server API"
else
  bad "launcher boot failed: $(cat "$WORK/boot.err")"
fi

# --- 3. the SDK is NOT vendored into the host dir (launcher delegates) ---------
if [[ ! -e "$HOME/.cursor/hooks/lib/node_modules" ]]; then
  ok "no node_modules copied into the host hooks dir"
else
  bad "unexpected node_modules under host hooks/lib"
fi

# --- 4. the missing-SDK guard fails loudly (bogus repo root) -------------------
BOGUS="$WORK/bogus"
mkdir -p "$BOGUS"
cat >"$BOGUS/mcp-server.js" <<EOF
'use strict';
const path = require('path'); const fs = require('fs');
const ROOT = process.env.PCORE_ORCHESTRA_REPO || "$ROOT";
const sdk = path.join(ROOT, 'node_modules', '@modelcontextprotocol', 'sdk');
if (!fs.existsSync(sdk)) { console.error('[orchestra-mcp] SDK missing at ' + sdk); process.exit(1); }
EOF
if out="$(PCORE_ORCHESTRA_REPO="$WORK/empty-repo" node "$BOGUS/mcp-server.js" 2>&1)"; then
  bad "guard did not fail on a missing SDK dir"
else
  grep -q "orchestra-mcp" <<<"$out" \
    && ok "guard prints a clear SDK-missing error and exits non-zero" \
    || bad "guard failed without the expected message: $out"
fi

echo ""
echo "mcp launcher test: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}"
[[ "$FAIL" -eq 0 ]] || exit 1

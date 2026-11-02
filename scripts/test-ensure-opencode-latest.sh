#!/usr/bin/env bash
# Test for scripts/ensure-opencode-latest.sh (#23): npm/bun exit-code checks,
# the --allow-remote-script gate on the curl|bash fallback, and --check preview.
# Runs entirely against stubbed opencode/npm/bun/curl on PATH — no network, no
# real global install.
set -euo pipefail

GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
PASS=0; FAIL=0
ok()   { echo "${GREEN}PASS${NC}: $1"; PASS=$((PASS+1)); }
bad()  { echo "${RED}FAIL${NC}: $1"; FAIL=$((FAIL+1)); }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_SCRIPT="$SCRIPT_DIR/ensure-opencode-latest.sh"
[[ -f "$TARGET_SCRIPT" ]] || { echo "missing $TARGET_SCRIPT"; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
CURL_LOG="$WORK/curl.calls"
OC_FILE="$WORK/opencode.version"   # stubbed `opencode --version` reports this

# --- stub builders --------------------------------------------------------
make_stub() { # name body
  printf '#!/usr/bin/env bash\n%s\n' "$2" > "$STUBDIR/$1"
  chmod +x "$STUBDIR/$1"
}

new_stubdir() { STUBDIR="$WORK/stub"; rm -rf "$STUBDIR"; mkdir -p "$STUBDIR"; }

# opencode + npm are always present; bun present only if $4=1; curl always present.
# A successful install (npm exit 0, or curl with the flag) rewrites OC_FILE to
# STUB_OC_AFTER — so the script's post-install version check sees the new value.
setup_stubs() { # before_version target npm_exit bun_present curl_exit
  export STUB_NPM_TARGET="$2" STUB_NPM_EXIT="$3" STUB_BUN_PRESENT="$4" STUB_CURL_EXIT="$5"
  export STUB_OC_AFTER="${STUB_OC_AFTER:-$2}"
  printf '%s\n' "$1" > "$OC_FILE"       # version before any install runs
  : > "$CURL_LOG"
  make_stub opencode 'if [[ "${1:-}" == "--version" ]]; then cat "'"$OC_FILE"'"; exit 0; fi; exit 0'
  make_stub npm 'case "$1" in
      view) echo "$STUB_NPM_TARGET"; exit 0 ;;
      install) if [[ "$STUB_NPM_EXIT" -eq 0 ]]; then echo "$STUB_OC_AFTER" > "'"$OC_FILE"'"; fi; exit "$STUB_NPM_EXIT" ;;
    esac; exit 0'
  make_stub curl 'echo "$*" >> "'"$CURL_LOG"'"; if [[ "$STUB_CURL_EXIT" -eq 0 ]]; then echo "$STUB_OC_AFTER" > "'"$OC_FILE"'"; printf ": # remote installer (noop)\n"; fi; exit "$STUB_CURL_EXIT"'
  # ALWAYS stub bun. When it is "present" it fails (forcing fallthrough to npm);
  # when absent it is a no-op that exits 127 so the script treats it as not-found.
  # Never let the real system bun run — tests must not touch global installs.
  if [[ "$STUB_BUN_PRESENT" -eq 1 ]]; then
    make_stub bun 'exit 1'   # bun present but always fails in these tests
  else
    make_stub bun 'exit 127' # treated as "command not found" by the script's guard
  fi
  # a stub `node` so the tool_output NOTE block is exercised harmlessly
  make_stub node 'exit 0'
}

run() { # args...
  PATH="$STUBDIR:$PATH" OPENCODE_CHANNEL=stable bash "$TARGET_SCRIPT" "$@"
}

echo "=== ensure-opencode-latest.sh test suite ==="

# Test 1: --check prints current vs target, exit 0
new_stubdir; setup_stubs "1.0.0" "2.1.0" 0 0 0
out="$(run --check 2>&1 || true)"
grep -q "Current: 1.0.0" <<<"$out" && grep -q "Target:  2.1.0" <<<"$out" \
  && ok "--check prints current vs target" || bad "--check preview: $out"

# Test 2: already on target -> "Already on", exit 0
new_stubdir; setup_stubs "2.1.0" "2.1.0" 0 0 0
out="$(run 2>&1 || true)"; rc=$?
grep -q "Already on 2.1.0" <<<"$out" && ok "no-op when already on target" || bad "already-on: $out"

# Test 3: #23 core — npm fails, bun fails, NO --allow-remote-script ->
# exit 1, fallback message, and curl was NOT invoked.
new_stubdir; setup_stubs "1.0.0" "2.1.0" 1 1 0
out="$( { run; } 2>&1 || true )"
grep -q "npm install -g failed" <<<"$out" && ok "npm failure detected (exit code checked)" || bad "npm failure not reported: $out"
grep -q "disabled by default" <<<"$out" && ok "curl|bash gated behind --allow-remote-script" || bad "fallback gate missing: $out"
if [[ -s "$CURL_LOG" ]]; then bad "curl was invoked without the flag"; else ok "curl NOT invoked without the flag"; fi

# Test 4: --allow-remote-script permits the curl|bash fallback.
new_stubdir; setup_stubs "1.0.0" "2.1.0" 1 1 0
out="$( { run --allow-remote-script; } 2>&1 || true )"
if [[ -s "$CURL_LOG" ]]; then ok "curl|bash runs WITH the flag"; else bad "curl not run despite flag: $out"; fi
grep -q "opencode.ai/install (--allow-remote-script)" <<<"$out" && ok "explicit --allow-remote-script message" || bad "flag message missing: $out"

# Test 5: #23 — successful npm install whose version does not match the registry
# tag surfaces a WARN (verifies the result, not just the exit code).
new_stubdir; export STUB_OC_AFTER="2.0.9"   # install "succeeded" but landed a different version
setup_stubs "1.0.0" "2.1.0" 0 0 0
out="$( { run; } 2>&1 || true )"
grep -q "WARN expected 2.1.0 but got 2.0.9" <<<"$out" && ok "version-mismatch after install is surfaced" || bad "no mismatch warning: $out"

# Test 6: downgrade guard still fires (BEFORE major > TARGET major).
new_stubdir; setup_stubs "2.1.0" "1.9.0" 0 0 0
out="$( { run; } 2>&1 || true )"
grep -q "refusing downgrade" <<<"$out" && ok "downgrade still refused" || bad "downgrade guard broken: $out"

echo ""
echo "ensure-opencode-latest.sh: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}"
[[ "$FAIL" -eq 0 ]] || exit 1

#!/usr/bin/env bash
# test-update-free-models-paths.sh — no-network gates for Windows/Git Bash safety
#
# Guards the class of defect where a POSIX path is interpolated into
# `python3 -c` source: MSYS converts argv paths for a native Windows python3
# but NOT string literals inside the -c script, so /c/..., /d/... and /tmp/...
# raise FileNotFoundError. update-free-models.sh must therefore route every
# such path through py_path().
#
# Checks:
#   1. `bash -n` on the script (syntax gate).
#   2. No `open('$VAR` / `getmtime('$VAR` path interpolation inside -c code.
#   3. py_path() normalization: absolute on win32 (cygpath), POSIX passthrough.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET="$SCRIPT_DIR/update-free-models.sh"

pass=0
fail=0
ok()   { echo "  PASS  $*"; pass=$((pass + 1)); }
bad()  { echo "  FAIL  $*"; fail=$((fail + 1)); }

echo "── update-free-models.sh path-safety gates ──"

if [[ ! -f "$TARGET" ]]; then
  bad "target script missing: $TARGET"
  echo ""
  echo "FAILED ($fail failures)"
  exit 1
fi

# 1) syntax gate
if bash -n "$TARGET" 2>/dev/null; then
  ok "bash -n clean"
else
  bad "bash -n reported a syntax error"
fi

# 2) no raw path interpolation inside python -c source
#    (paths must go through py_path -> *_path variables)
RAW_PATH_VARS='CACHE_FILE|PROBES_FILE|POOLS_FILE|CACHE_DIR|config_file|tmp|probe_jsonl|SYSTEM_CONFIG|EXAMPLE_CONFIG'
hits="$(grep -nE "(open|getmtime)\\('\\\$($RAW_PATH_VARS)[^_]" "$TARGET" || true)"
if [[ -z "$hits" ]]; then
  ok "no raw path interpolation inside -c (all routed through py_path)"
else
  bad "raw path interpolated into python -c (wrap with py_path):"
  printf '%s\n' "$hits"
fi

# py_path helper must exist and be used at every -c path site
if grep -q '^py_path() {' "$TARGET"; then
  ok "py_path() helper defined"
else
  bad "py_path() helper missing"
fi
if grep -q 'PY_IS_WIN=1' "$TARGET"; then
  ok "PY_IS_WIN detection present"
else
  bad "PY_IS_WIN detection missing"
fi
uses="$(grep -c 'py_path "' "$TARGET" || true)"
if [[ "$uses" -ge 9 ]]; then
  ok "py_path used at $uses -c path sites"
else
  bad "py_path used only $uses times (expected >= 9)"
fi

# 3) py_path behavior (extracted from the script, no execution of main)
PYFN="$(sed -n '/^py_path() {/,/^}/p' "$TARGET")"
if [[ -z "$PYFN" ]]; then
  bad "could not extract py_path() body"
else
  if command -v cygpath >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1 \
      && python3 -c 'import sys; sys.exit(0 if sys.platform=="win32" else 1)' 2>/dev/null; then
    PY_IS_WIN=1
    eval "$PYFN"
    out="$(py_path /tmp/pcore-test.json)"
    case "$out" in
      [A-Za-z]:/*) ok "py_path /tmp -> absolute Windows path ($out)" ;;
      *)           bad "py_path /tmp not absolute on win32: '$out'" ;;
    esac
    out2="$(py_path /c/Users/test/file.json)"
    case "$out2" in
      [A-Za-z]:/*) ok "py_path /c/... -> absolute Windows path ($out2)" ;;
      *)           bad "py_path /c/... not absolute on win32: '$out2'" ;;
    esac
  else
    PY_IS_WIN=0
    eval "$PYFN"
    out="$(py_path /tmp/pcore-test.json)"
    if [[ "$out" == "/tmp/pcore-test.json" ]]; then
      ok "py_path is a byte-identical POSIX passthrough (skip: no native win32 python3)"
    else
      bad "POSIX passthrough changed the path: '$out'"
    fi
  fi
fi

echo ""
echo "── atomic-write + probe-shape gates ──"

# 4) atomic_write must force LF newlines (CRLF from a Windows python breaks bash consumers)
if grep -q "newline='\\\\n'" "$TARGET"; then
  ok "atomic_write forces newline LF"
else
  bad "atomic_write missing newline='\\n' (CRLF risk on native Windows python3)"
fi

# 5) probe JSONL must carry a real JSON boolean, not 1/0 (the loop reads `is True`)
if grep -q 'echo True || echo False' "$TARGET"; then
  ok "probe reachable serializes as a JSON boolean (True/False -> true/false)"
else
  bad "probe reachable not a JSON boolean (check_probe_reachability reads identity)"
fi
if grep -q "'reachable': \$reachable," "$TARGET"; then
  bad "raw 1/0 reachable interpolation still present"
else
  ok "no raw 1/0 reachable interpolation"
fi

echo ""
if [[ "$fail" -ne 0 ]]; then
  echo "FAILED ($fail failures, $pass passes)"
  exit 1
fi
echo "PASS ($pass checks)"

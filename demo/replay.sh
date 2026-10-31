#!/usr/bin/env bash
# demo/replay.sh — scripted REPLAY of a P-Core Orchestra run, used by demo/demo.tape.
#
# IMPORTANT: this is a replay of a real run, sped up. It is NOT a live agent session.
# A live orchestra run is slow and non-deterministic, so the stage text below is
# scripted to mirror the real stage names (orchestra-planner -> orchestra-implementer ->
# orchestra-verifier -> orchestra-reviewer) and verdict tokens (PLAN_READY,
# IMPLEMENT_DONE, VERIFY_PASS, ORCHESTRA_COMPLETE) defined in bundle/agents/orchestra-*.md.
# What IS real: the fix is genuinely applied to a throw-away temp copy of demo/app and
# the real `node --test` suite is run before and after, so red -> green is genuine.
# The committed demo/app is never modified.
#
# Usage:
#   bash demo/replay.sh red        # just run the real, committed (failing) tests, concisely
#   bash demo/replay.sh            # waits for you to type the prompt (what the tape does)
#   REPLAY_FAST=1 bash demo/replay.sh </dev/null   # no pauses, auto-prompt (for checks)
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$HERE/app"
PROMPT_TEXT="fix the login bug"
REPO_URL="https://github.com/P-Core-System/pcore-orchestra"

if [ -t 1 ] || [ "${REPLAY_COLOR:-}" = "1" ]; then
  B=$'\033[1m'; D=$'\033[2m'; R=$'\033[31m'; G=$'\033[32m'; Y=$'\033[33m'; C=$'\033[36m'; M=$'\033[35m'; Z=$'\033[0m'
else
  B=""; D=""; R=""; G=""; Y=""; C=""; M=""; Z=""
fi

nap() { [ "${REPLAY_FAST:-0}" = "1" ] || sleep "$1"; }

stage() { # stage <colour> <agent> <caption>
  printf '\n%s▶ %s%s  %s%s%s\n' "$1" "$2" "$Z" "$D" "$3" "$Z"
}

# Run the REAL test suite in a directory, print a compact colourised summary, return its exit code.
run_tests() {
  local dir="$1" out rc
  out="$(cd "$dir" && node --test --test-reporter=spec 2>&1)"; rc=$?
  printf '%s\n' "$out" | sed '/failing tests:/,$d' | grep -E '^\s*(✔|✖)' | sed -e "s/✔/${G}✔${Z}/" -e "s/✖/${R}✖${Z}/" | sed 's/ ([0-9.]*ms)//'
  if [ "$rc" -eq 0 ]; then
    printf '  %s%s%s\n' "$G" "$(printf '%s\n' "$out" | grep -E '^ℹ (pass|fail)' | sed 's/ℹ //' | tr '\n' ' ')" "$Z"
  else
    printf '  %s%s%s\n' "$R" "$(printf '%s\n' "$out" | grep -E '^ℹ (pass|fail)' | sed 's/ℹ //' | tr '\n' ' ')" "$Z"
  fi
  return "$rc"
}

command -v node >/dev/null 2>&1 || { echo "node is required (18+)"; exit 1; }

if [ "${1:-}" = "red" ]; then # real run of the committed demo/app tests (expected: red)
  printf '%s$ node --test%s  %s(demo/app)%s\n' "$D" "$Z" "$D" "$Z"
  run_tests "$APP"; RC=$?
  printf '  %sassertion: login("alice", "") returned true, expected false%s\n' "$R" "$Z"
  exit "$RC"
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cp -r "$APP" "$WORK/app"

# ---- banner + prompt (the tape types the prompt here) -----------------------
printf '%sP-Core Orchestra%s  %sreplay of a real run, sped up%s\n' "$B$C" "$Z" "$Y" "$Z"
printf '%splan → implement → verify → review%s\n\n' "$D" "$Z"
if [ -t 0 ]; then
  IFS= read -r -p "${B}> ${Z}" LINE
else
  LINE="$PROMPT_TEXT"; printf '%s> %s%s\n' "$B" "$Z" "$LINE"
fi
nap 0.6
printf '%s[orchestra]%s ambient trigger: "fix" → starting loop for: %s\n' "$M" "$Z" "${LINE:-$PROMPT_TEXT}"
nap 0.8

# ---- 1. planner ---------------------------------------------------------------
stage "$C" "orchestra-planner" "plan"
nap 0.5
printf '  1. Reproduce: login("alice", "") must be rejected\n'; nap 0.7
printf '  2. Fix the password check in demo/app/auth.js\n'; nap 0.7
printf '  3. Re-run the tests, then review the diff\n'; nap 0.7
printf '  %sPLAN_READY%s\n' "$G" "$Z"
nap 1.0

# ---- 2. implementer -----------------------------------------------------------
stage "$C" "orchestra-implementer" "edits auth.js"
nap 0.8
printf '  Root cause: an empty password matches the "|| password === \\"\\"" branch\n'; nap 1.0
# Genuinely apply the one-line fix to the temp copy and show the real diff.
cp "$WORK/app/auth.js" "$WORK/auth.js.orig"
sed -i '/BUG:/c\  return password !== "" \&\& password === expected;' "$WORK/app/auth.js"
( cd "$WORK" && diff -u --label a/demo/app/auth.js --label b/demo/app/auth.js auth.js.orig app/auth.js ) \
  | tail -n +3 | sed -e "s/^-/${R}-/" -e "s/^+/${G}+/" -e "s/$/${Z}/" | sed 's/^/  /'
nap 1.5
printf '  %sIMPLEMENT_DONE%s\n' "$G" "$Z"
nap 0.8

# ---- 3. verifier: tests red -> green (both runs are real) ---------------------
stage "$C" "orchestra-verifier" "tests rerun: red → green"
nap 0.6
printf '  %sbefore fix%s  (pristine copy)\n' "$D" "$Z"
cp -r "$APP" "$WORK/before"
run_tests "$WORK/before" | sed 's/^/    /'; nap 1.2
printf '  %safter fix%s\n' "$D" "$Z"
nap 0.6
run_tests "$WORK/app" | sed 's/^/    /'; RC=${PIPESTATUS[0]}
nap 0.8
if [ "$RC" -eq 0 ]; then
  printf '  %sVERIFY_PASS%s\n' "$G" "$Z"
else
  printf '  %sVERIFY_FAIL%s\n' "$R" "$Z"; exit 1
fi
nap 0.8

# ---- 4. reviewer --------------------------------------------------------------
stage "$C" "orchestra-reviewer" "approves"
nap 0.6
printf '  %s✔%s one-line change, scoped to the reported bug\n' "$G" "$Z"; nap 0.6
printf '  %s✔%s the empty-password test now passes; no tests were edited\n' "$G" "$Z"; nap 0.6
printf '  %sORCHESTRA_COMPLETE%s\n' "$B$G" "$Z"
nap 1.0

# ---- closing card -------------------------------------------------------------
printf '\n%s──────────────────────────────────────────────────────────────────────%s\n' "$D" "$Z"
printf '  %sP-Core Orchestra%s — plan → implement → verify → review, automatically\n' "$B" "$Z"
printf '  %sInstall:%s git clone %s.git && cd pcore-orchestra && bash install.sh\n' "$Y" "$Z" "$REPO_URL"
printf '  %sRepo:%s    %s\n' "$Y" "$Z" "$REPO_URL"
printf '  %s(replay of a real run, sped up)%s\n' "$D" "$Z"
printf '%s──────────────────────────────────────────────────────────────────────%s\n' "$D" "$Z"

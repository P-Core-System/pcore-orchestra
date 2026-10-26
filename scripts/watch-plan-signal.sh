#!/usr/bin/env bash
# watch-plan-signal.sh — detect new plan/spec work in a target repo and emit a signal
# that the OpenCode conductor / Cursor hook can pick up to auto-start the orchestra loop.
#
# Detection sources (scoped, cheap):
#   1. context/specs/*.md            — new or mtime-changed files
#   2. context/progress-tracker.md   — "Next Steps" section hash changed
#   3. *plan* files                  — new files under context/ or docs/
#
# State lives in <target>/.pcore/signal-state.txt; detections append JSON lines to
# <target>/.pcore/signals.log and write <target>/.pcore/pending-signal.json.
# First run is always baseline: record state, emit no signal.
#
# Usage:
#   bash scripts/watch-plan-signal.sh --watch [--dir /path/to/repo]   # loop mode (polling)
#   bash scripts/watch-plan-signal.sh --once  [--dir /path/to/repo]   # single sweep
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PCORE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEFAULT_TARGET="${PCORE_WATCH_TARGET:-$PCORE_ROOT/../pcore-orchestra}"

MODE=""
TARGET=""

while [ $# -gt 0 ]; do case "$1" in
  --watch) MODE="watch"; shift ;;
  --once)  MODE="once";  shift ;;
  --dir)   TARGET="$2"; shift 2 ;;
  *) echo "Unknown arg: $1" >&2; exit 2 ;;
esac; done

[ -n "$MODE" ] || { echo "Usage: $0 --watch|--once [--dir PATH]" >&2; exit 2; }
TARGET="${TARGET:-$DEFAULT_TARGET}"
TARGET="$(cd "$TARGET" && pwd)"

STATE_FILE="$TARGET/.pcore/signal-state.txt"
LOG_FILE="$TARGET/.pcore/signals.log"
PENDING="$TARGET/.pcore/pending-signal.json"
DEBOUNCE_SECS="${PCORE_SIGNAL_DEBOUNCE:-2}"

_now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

snapshot() {
  # Emit "kind<TAB>key<TAB>hash" lines for every tracked source in TARGET.
  local f
  # 1. spec files (mtime-changed)
  while IFS= read -r -d '' f; do
    printf 'spec\t%s\t%s\n' "${f#"$TARGET"/}" "$(stat -c '%Y' "$f")"
  done < <(find "$TARGET/context/specs" -maxdepth 1 -name '*.md' -type f -print0 2>/dev/null | sort -z)
  # 2. progress-tracker "Next Steps" section hash
  if [ -f "$TARGET/context/progress-tracker.md" ]; then
    printf 'next-steps\tcontext/progress-tracker.md\t%s\n' \
      "$(sed -n '/^## Next Steps/,/^## /p' "$TARGET/context/progress-tracker.md" \
         | sed '$d' | md5sum | cut -d' ' -f1)"
  fi
  # 3. new *plan* files under context/ or docs/
  while IFS= read -r -d '' f; do
    printf 'plan-file\t%s\tnew\n' "${f#"$TARGET"/}"
  done < <(find "$TARGET/context" "$TARGET/docs" -maxdepth 1 -name '*plan*' -type f -print0 2>/dev/null | sort -z)
}

emit_signal() {
  local source="$1" kind="$2"
  mkdir -p "$TARGET/.pcore"
  local ts; ts="$(_now)"
  printf '{"ts":"%s","source":"%s","kind":"%s"}\n' "$ts" "$source" "$kind" >> "$LOG_FILE"
  cat > "$PENDING" <<EOF
{
  "ts": "$ts",
  "source": "$source",
  "kind": "$kind",
  "target": "$TARGET",
  "goal": "Review detected change ($kind from $source) and run the orchestra loop if implementation work is needed."
}
EOF
  echo "[plan-signal] $kind detected in $source ($TARGET)"
  echo "Suggested start:"
  echo "  opencode \"Run the orchestra loop for goal: act on $kind in $source (repo: $TARGET). Read pending-signal.json at $PENDING for details.\""
}

check_changes() {
  local snap current diff_out baseline=false
  [ -f "$STATE_FILE" ] || baseline=true
  snap="$(snapshot)"
  if $baseline; then
    mkdir -p "$TARGET/.pcore"
    printf '%s\n' "$snap" > "$STATE_FILE"
    return
  fi
  current="$snap"
  diff_out="$(printf '%s\n' "$(cat "$STATE_FILE")" | diff - <(printf '%s\n' "$current") || true)"
  [ -z "$diff_out" ] && { printf '%s\n' "$current" > "$STATE_FILE"; return; }
  printf '%s\n' "$current" > "$STATE_FILE"
  # Classify each added/changed line
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    case "$line" in '>'*) ;; *) continue ;; esac
    line="${line#> }"
    kind="${line%%$'\t'*}"; rest="${line#*$'\t'}"
    key="${rest%%$'\t'*}"
    case "$kind" in
      spec)       emit_signal "$key" "spec-change" ;;
      next-steps) emit_signal "$key" "next-steps-update" ;;
      plan-file)  emit_signal "$key" "new-plan-file" ;;  # diff '>' = newly appeared file
    esac
    sleep "$DEBOUNCE_SECS"
  done <<< "$diff_out"
}

if [ "$MODE" = "once" ]; then
  cp -f "$STATE_FILE" "$STATE_FILE.prev" 2>/dev/null || true
  check_changes
  rm -f "$STATE_FILE.prev"
else
  trap 'echo "[plan-signal] stopping"; exit 0' INT TERM
  while true; do
    cp -f "$STATE_FILE" "$STATE_FILE.prev" 2>/dev/null || true
    check_changes
    rm -f "$STATE_FILE.prev"
    sleep "$DEBOUNCE_SECS"
  done
fi

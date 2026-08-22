#!/usr/bin/env bash
# opencode-maintenance.sh — housekeeping for the opencode AI stack
#
# Cleans: legacy snapshots, oversized logs, stale sessions in opencode.db.
# Safe to run while opencode is open (skips DB VACUUM if sessions are live).
#
# Usage:
#   bash scripts/opencode-maintenance.sh              # dry-run (report only)
#   bash scripts/opencode-maintenance.sh --apply       # actually clean
#   bash scripts/opencode-maintenance.sh --apply --vacuum  # also VACUUM DB (needs no live sessions)
set -euo pipefail

OPENCODE_DATA="${OPENCODE_DATA:-$HOME/.local/share/opencode}"
OPENCODE_CONFIG="${OPENCODE_CONFIG:-$HOME/.config/opencode}"
DB="$OPENCODE_DATA/opencode.db"
LOG="$OPENCODE_DATA/log/opencode.log"
SNAPSHOT_DIR="$OPENCODE_DATA/snapshot"

APPLY=0
DO_VACUUM=0
SESSION_AGE_DAYS=30

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1; shift ;;
    --vacuum) DO_VACUUM=1; shift ;;
    --age) SESSION_AGE_DAYS="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

echo "==> OpenCode maintenance $([[ $APPLY -eq 1 ]] && echo '(APPLY)' || echo '(dry-run)') $([[ $DO_VACUUM -eq 1 ]] && echo '+VACUUM')"
echo "    Data dir:  $OPENCODE_DATA"
echo "    DB:        $DB"
echo "    Log:       $LOG"
echo ""

# ── 1. Legacy snapshots ────────────────────────────────────────────────────
echo "--- Snapshots ---"
if [[ -d "$SNAPSHOT_DIR" ]]; then
  SNAPSHOT_COUNT=$(find "$SNAPSHOT_DIR" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l)
  SNAPSHOT_SIZE=$(du -sh "$SNAPSHOT_DIR" 2>/dev/null | cut -f1)
  if [[ "$SNAPSHOT_COUNT" -gt 0 ]]; then
    echo "    Found $SNAPSHOT_COUNT snapshot(s), $SNAPSHOT_SIZE"
    if [[ "$APPLY" -eq 1 ]]; then
      rm -rf "$SNAPSHOT_DIR"/* 2>/dev/null || true
      echo "    REMOVED all legacy snapshots"
    else
      echo "    (dry-run) would remove all"
    fi
  else
    echo "    OK none"
  fi
else
  echo "    OK dir not present"
fi
echo ""

# ── 2. Log truncation ──────────────────────────────────────────────────────
echo "--- Log ---"
if [[ -f "$LOG" ]]; then
  LOG_SIZE=$(stat -c%s "$LOG" 2>/dev/null || echo 0)
  LOG_HUMAN=$(du -sh "$LOG" 2>/dev/null | cut -f1)
  if [[ "$LOG_SIZE" -gt 10485760 ]]; then
    echo "    Log is $LOG_HUMAN (>10 MB)"
    if [[ "$APPLY" -eq 1 ]]; then
      truncate -s 0 "$LOG" 2>/dev/null || true
      echo "    TRUNCATED log to 0 bytes"
    else
      echo "    (dry-run) would truncate to 0"
    fi
  else
    echo "    OK $LOG_HUMAN (under 10 MB)"
  fi
else
  echo "    OK no log file"
fi
echo ""

# ── 3. Stale sessions ──────────────────────────────────────────────────────
echo "--- Stale sessions (older than $SESSION_AGE_DAYS days) ---"
if [[ -f "$DB" ]] && command -v sqlite3 >/dev/null 2>&1; then
  CUTOFF_MS=$(( $(date +%s) * 1000 - SESSION_AGE_DAYS * 86400000 ))
  STALE_COUNT=$(sqlite3 "$DB" \
    "SELECT COUNT(*) FROM session WHERE time_updated < $CUTOFF_MS;" 2>/dev/null || echo "error")
  TOTAL_COUNT=$(sqlite3 "$DB" "SELECT COUNT(*) FROM session;" 2>/dev/null || echo "error")
  echo "    Total sessions:   $TOTAL_COUNT"
  echo "    Stale (>$SESSION_AGE_DAYS d): $STALE_COUNT"

  if [[ "$APPLY" -eq 1 ]] && [[ "$STALE_COUNT" != "error" ]] && [[ "$STALE_COUNT" -gt 0 ]]; then
    sqlite3 "$DB" \
      "DELETE FROM part WHERE message_id IN (SELECT id FROM message WHERE session_id IN (SELECT id FROM session WHERE time_updated < $CUTOFF_MS));
       DELETE FROM message WHERE session_id IN (SELECT id FROM session WHERE time_updated < $CUTOFF_MS);
       DELETE FROM session WHERE time_updated < $CUTOFF_MS;" 2>/dev/null || true
    echo "    DELETED $STALE_COUNT stale sessions (+ orphaned messages/parts)"
  elif [[ "$STALE_COUNT" != "error" ]] && [[ "$STALE_COUNT" -gt 0 ]]; then
    echo "    (dry-run) would delete $STALE_COUNT sessions + orphaned messages/parts"
  fi
else
  echo "    SKIP (sqlite3 not found or DB missing)"
fi
echo ""

# ── 4. VACUUM (only if no live opencode sessions) ───────────────────────────
echo "--- VACUUM ---"
if [[ "$DO_VACUUM" -eq 1 ]]; then
  LIVE=$(pgrep -x opencode 2>/dev/null | wc -l)
  if [[ "$LIVE" -gt 0 ]]; then
    echo "    SKIP $LIVE live opencode session(s) running — VACUUM would lock DB"
    echo "    Close all opencode sessions, then re-run with --vacuum"
  else
    if [[ "$APPLY" -eq 1 ]] && [[ -f "$DB" ]]; then
      BEFORE=$(du -sh "$DB" | cut -f1)
      sqlite3 "$DB" "VACUUM;" 2>/dev/null || true
      AFTER=$(du -sh "$DB" | cut -f1)
      echo "    VACUUMED DB: $BEFORE -> $AFTER"
    else
      echo "    (dry-run) would VACUUM (no live sessions detected)"
    fi
  fi
else
  echo "    SKIP (pass --vacuum to enable; requires no live sessions)"
fi
echo ""

# ── 5. Summary ─────────────────────────────────────────────────────────────
echo "==> Summary"
echo "    Data dir size: $(du -sh "$OPENCODE_DATA" 2>/dev/null | cut -f1)"
if [[ "$APPLY" -eq 0 ]]; then
  echo "    (dry-run — re-run with --apply to clean)"
fi

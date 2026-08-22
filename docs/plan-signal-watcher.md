# Plan-Signal Watcher

`scripts/watch-plan-signal.sh` watches a target repo for signals that new plan/spec
work exists, and writes a `pending-signal.json` that the OpenCode conductor or a
Cursor hook can read to auto-start the orchestra loop.

## Usage

```bash
bash scripts/watch-plan-signal.sh --once                 # single sweep (default target: ../p-core-monorepo)
bash scripts/watch-plan-signal.sh --watch                # polling loop
bash scripts/watch-plan-signal.sh --watch --dir /path/to/repo
```

- `--once` — snapshot, compare to last state, emit any signals, exit.
- `--watch` — poll every 2s (`PCORE_SIGNAL_DEBOUNCE` overrides). Pure polling — no `inotifywait` dependency.
- `--dir` — target repo (default: repo root of this script → sibling `p-core-monorepo`).

## Detection sources (scoped)

1. **New/mtime-changed files** in `<dir>/context/specs/*.md` → `kind: spec-change`
2. **"Next Steps" section** of `<dir>/context/progress-tracker.md` changed (hash-compare) → `kind: next-steps-update`
3. **New `*plan*` files** under `<dir>/context/` or `<dir>/docs/` → `kind: new-plan-file`

First run is always baseline: state is recorded, no signal is emitted.

## Artifacts (in `<dir>/.pcore/`, gitignored)

| File | Purpose |
|---|---|
| `signal-state.txt` | Last-seen snapshot hashes |
| `signals.log` | Append-only JSON lines `{ts, source, kind}` |
| `pending-signal.json` | Latest signal + suggested goal; consumed by the conductor |

## Auto-starting the orchestra loop

**OpenCode conductor:** at session start (or via a scheduled prompt), read
`.pcore/pending-signal.json`; if present and fresh, feed its `goal` into the
orchestra loop:

```
Read <repo>/.pcore/pending-signal.json. If a signal exists, run the orchestra loop:
plan → implement → verify → review for that goal in the signal's target repo.
Delete pending-signal.json after consuming it.
```

**Cursor hook:** any ambient hook (e.g. session-start) can check the same file and
inject the goal as a task for the conductor agent.

## Cron / systemd examples

Cron (single sweep every 10 min):

```cron
*/10 * * * * bash ~/Documents/Project/pcore/pcore-orchestra/scripts/watch-plan-signal.sh --once >> /tmp/plan-signal.log 2>&1
```

systemd user unit (`~/.config/systemd/user/plan-signal.service`):

```ini
[Unit]
Description=Plan-signal watcher

[Service]
ExecStart=%h/Documents/Project/pcore/pcore-orchestra/scripts/watch-plan-signal.sh --watch
Restart=on-failure

[Install]
WantedBy=default.target
```

Enable with `systemctl --user enable --now plan-signal`.

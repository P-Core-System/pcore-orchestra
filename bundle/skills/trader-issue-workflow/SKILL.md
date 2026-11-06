---
name: trader-issue-workflow
description: Fix pcore-trader issues end-to-end — GitHub issues plus docs/issues/OBS-* files. Use when told to "fix open issues", triage observer-reported problems, or ship per-issue commits with tests. Covers triage order, per-issue commit discipline, duplicate-issue folding, and verification commands.
---

# P-Core Trader Issue Workflow

## Intake

```bash
gh issue list --repo P-Core-System/pcore-trader --state open --limit 60 \
  --json number,title --jq '.[] | "#\(.number) \(.title)"'
```

Also read `docs/issues/OBS-YYYYMMDD-*.md` (agent-filed issues with evidence tables) and
`docs/issues/INDEX.md`. Docs files reference commits by hash — check whether the fix commit
already exists in the merged tree before implementing:

```bash
git log --oneline | grep -i <hash-prefix>
```

Many "open" issues are already fixed on `main` but not deployed or not closed — verify first,
then close with the commit reference instead of re-implementing.

## Discipline

- **One commit per issue/task.** Message: `fix(scope): <what> (#NNN)`; body explains root cause.
- Fold duplicates (e.g. two "zero limit orders" files with the same cause) into one fix and
  reference all IDs in the commit.
- Each fix needs a regression test beside it when behavior (not docs) changes; run the focused
  suite before committing: `python -m pytest tools/crypto/tests/test_<area>.py -q -p no:cacheprovider`.
- Merge remote before pushing (`git pull --no-rebase`): the server auto-commits deploys and
  agents push concurrently — expect non-fast-forward rejections.
- After code fixes: deploy per the `trader-ops` skill (git pull on server + restart services),
  then close/label issues and update `context/progress-tracker.md`.

## Triage order

1. Crash-level: services in `failed` state, syntax errors in merged `main` (compile the whole
   hot path: `venv/bin/python -m py_compile tools/crypto/*.py` on the server before restarting).
2. P0 data/trading (wrong signals, orders never placed, quota overruns).
3. P1 ops (fail-open probes, unproven ids, alert quality).
4. P2 enhancements (strategy upgrades, event-driven triggers) — each may be its own PR cycle.

## Signal-gate debugging (recurring theme)

Zero signals = a gate chain rejects everything. Walk gates in order with `signal_bot --scan`
output: MTF cascade (3/4 TFs) → conviction gate (`CRYPTO_SIGNAL_MIN_CONFIDENCE`, code default
0.35 but server `.env` may pin higher) → range/ADX/quorum gates. Bypass paths (1d-trend +
15m-entry) must run **before** hard skips; ordering bugs made them dead code (OBS-20261106-a1b2c3d4).

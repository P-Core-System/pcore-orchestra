# Spec: conductor-state-isolation

## Goal

Each orchestra loop persists its run state as an isolated, atomic run keyed by (workspace + session + 12-hex task id), with a shared registry listing live sessions/tasks — so concurrent loops in different workspaces/sessions never overwrite each other and a loop can always be resumed instead of restarted from scratch.

## Context

- Related overview/architecture sections: `context/architecture.md` (System boundaries → `conductor-state.js`; Storage model → 'Conductor runs' + 'Conductor run index' rows), `bundle/hooks/lib/conductor-state.js`, `bundle/opencode/hooks/lib/conductor-state.js` (byte-identical mirror), `scripts/conductor-state.sh`, `scripts/test-conductor-state.js`
- Replaces the previous flat `~/.config/opencode/state/orchestra-state.json` heredoc write (auto-migrated once on first `begin`)
- Out of scope: cross-session shared memory, distributed coordination, UI, DB migration

## Requirements

1. Run file `<baseDir>/<workspaceSlug>/<sessionId>/<taskId>.json`; `baseDir = PCORE_CONDUCTOR_STATE_DIR || ~/.config/opencode/hooks/state/conductor-runs` (via `os.homedir()`)
2. Run key = `workspaceSlug/sessionId/taskId`; task id = `PCORE_TASK_ID` else stable 12-hex `sha1(goal + startedAt)`
3. Workspace slug = basename lowercased, `[^a-z0-9-]`→`-`, collapse hyphens, empty → `root`
4. Registry `<baseDir>/index.json` = `{ version, updated_at, runs: { "<ws>/<sid>/<tid>": {...} } }`; upserted on every `saveRun`
5. `beginRun` idempotent: an existing live run on the same key resumes and preserves `startedAt`; `--reuse` keeps the same file across resumes, no-reuse creates a fresh task file
6. Every write atomic: `.tmp.{pid}.{ts}` + `renameSync`, 3-retry backoff; missing dirs created recursively; parse errors → safe empty fallback
7. `isStale(run, thresholdMs)` default `DEFAULT_STALL_THRESHOLD_MS` (5 min); `findStale` lists stale live runs; `gcRuns({staleMs, deleteFiles})` prunes them
8. `migrateLegacy()` migrates `~/.config/opencode/state/orchestra-state.json` exactly once on first `beginRun` (read → stash under `run.legacy` → rename `.migrated.<ts>`); never re-read
9. CLI `scripts/conductor-state.sh` (self-locating; `PCORE_PLATFORM=opencode` picks the mirror lib): `begin/save/heartbeat/list/who/resume/complete/fail/gc` with `--json` for machine output; exit non-zero on error

## Acceptance criteria

- [ ] Two sessions with different ids → separate run files, registry lists both
- [ ] Same session + same task → same run file path; second `beginRun` returns `resumed: true` and preserves `startedAt`
- [ ] `who`/`listRuns`/`activeSessionIds` reflect active runs correctly
- [ ] A planted run with an old `lastHeartbeat` is `isStale` and found by `findStale`
- [ ] Legacy `orchestra-state.json` read once, renamed to `.migrated.<ts>`, never re-read
- [ ] No `.tmp.*` residue after any operation; every run JSON parses
- [ ] `bundle/hooks/lib/conductor-state.js` and `bundle/opencode/hooks/lib/conductor-state.js` are byte-identical
- [ ] No `cat > ~/.config/opencode/state/orchestra-state.json` heredoc remains in `bundle/agents/orchestra.md` / `bundle/opencode/agents/orchestra.md`

## Done when (verifiable)

- Command: `node scripts/test-conductor-state.js` → all PASS
- Command: `PCORE_CONDUCTOR_STATE_DIR=/tmp/cr1 PCORE_SESSION_ID=a bash scripts/conductor-state.sh begin --goal g1` then `PCORE_SESSION_ID=b ... begin --goal g2` → `who --json` lists 2; `ls /tmp/cr1/*/a/` disjoint from `/b/`
- Command: `find /tmp/cr1 -name '*.tmp*'` → empty; each run JSON parses
- Command: `bash -n scripts/conductor-state.sh` → OK
- Command: `cmp bundle/hooks/lib/conductor-state.js bundle/opencode/hooks/lib/conductor-state.js` → identical

## Files (expected)

- `bundle/hooks/lib/conductor-state.js` — per-run conductor state + registry + atomic writes
- `bundle/opencode/hooks/lib/conductor-state.js` — byte-identical mirror
- `scripts/conductor-state.sh` — thin bash CLI wrapper
- `scripts/test-conductor-state.js` — Node self-check
- `bundle/agents/orchestra.md`, `bundle/opencode/agents/orchestra.md` — CLI-driven state persistence sections

## Risks

- Task-id collision from identical (goal, startedAt) in the same millisecond with no `PCORE_TASK_ID` (mitigated: `--reuse` reuses the live run's task id; fresh begins include `process.pid` in the hash seed)
- Disk growth from abandoned runs (mitigated: `gc --stale-min N [--delete]`)
- Atomic rename on network filesystems (mitigated: local dev assumption; tmp+rename is best-effort)
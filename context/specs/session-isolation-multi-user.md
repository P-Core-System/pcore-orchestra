# Spec: session-isolation-multi-user

## Goal

All orchestra state managers (state, memory, tokens, project, daily, version) are session-namespaced so concurrent Cursor/OpenCode sessions on the same machine — or multiple developers on a shared machine — have isolated state with no cross-session contamination or lock contention.

## Context

- Related overview/architecture sections: `context/architecture.md` (Storage model → session-namespaced keyed by session ID with migrateToSessions()), `bundle/hooks/lib/state-manager.js` (getSessionId, migrateToSessions, createSessionState, loadState, saveState), `bundle/hooks/lib/memory-manager.js`, `bundle/hooks/lib/token-tracker.js`, `bundle/hooks/lib/version-manager.js`, `bundle/opencode/hooks/lib/*.js` (OpenCode mirrors)
- Out of scope: Cross-session shared memory (intentional isolation), distributed session coordination, session persistence across machine reboots (state files survive reboot)

## Requirements

1. `state-manager.js`: `getSessionId()` resolves session ID from env chain: `PCORE_SESSION_ID` → `OPENCODE_SESSION_ID` → `CLAUDE_SESSION_ID` → `CURSOR_TRACE_ID` → `pid-{process.pid}`
2. State file structure: `{ version: 3, sessions: { "<session-id>": <session-state> } }` — flat legacy auto-migrated by `migrateToSessions()`
3. `loadState(rootDir, sessionId)` ensures requested session exists (creates default if missing); normalizes all sessions (legacy phase fields, required objects)
4. `saveState(rootDir, state, sessionId)` writes full sessions object atomically; normalizes target session before write
5. All 6 state managers use `getSessionId()` for their namespace: `orchestra.json`, `orchestra-memory.json`, `orchestra-tokens.json`, `orchestra-project.json`, `orchestra-daily.json`, `orchestra-version.json`
6. `memory-manager.js`: long-term memory capped at 100 goals per session; `memory-index.json` inverted index per session
7. `token-tracker.js`: per-run estimates + aggregates per session; improvement tips per session
8. `version-manager.js`: semver/changelog/release per session; atomic writes + retry for daily/version (high contention)
9. `daily-manager.js` (implied): daily journal, progress reports, metrics per session; atomic write + retry
10. OpenCode mirrors: `bundle/opencode/hooks/lib/*.js` identical session isolation logic
11. Legacy flat state (pre-V3) auto-migrated on first load — no data loss

## Acceptance criteria

- [ ] `getSessionId()` returns env-specific ID when `PCORE_SESSION_ID` set
- [ ] `getSessionId()` falls back through env chain to `pid-{pid}`
- [ ] `loadState()` on legacy flat file → returns `{ version: 3, sessions: { "<id>": <migrated-state> } }`
- [ ] `loadState()` with `sessionId` param → creates/returns that session's state
- [ ] Two parallel Node processes with different `PCORE_SESSION_ID` → separate session states in same `orchestra.json`
- [ ] `saveState()` is atomic (write to temp + rename) — no partial writes
- [ ] `orchestra-memory.json` has `sessions` object with per-session memory arrays
- [ ] `orchestra-tokens.json` tracks per-session usage
- [ ] `orchestra-daily.json` and `orchestra-version.json` use atomic write + retry

## Done when (verifiable)

- Command: `node -e "const s=require('./bundle/hooks/lib/state-manager.js'); console.log(s.getSessionId())"` → prints session ID
- Command: `PCORE_SESSION_ID=test123 node -e "const s=require('./bundle/hooks/lib/state-manager.js'); console.log(s.getSessionId())"` → `test123`
- Command: Create legacy flat `orchestra.json`, run `loadState()` → returns sessions-wrapped structure
- Command: `node -e "const s=require('./bundle/hooks/lib/state-manager.js'); const state=s.loadState(); s.saveState(null, state); console.log('ok')"` → ok (atomic write)
- Command: `ls bundle/opencode/hooks/lib/` → mirrors exist (state-manager.js, memory-manager.js, etc.)

## Files (expected)

- `bundle/hooks/lib/state-manager.js` — session-namespaced state CRUD + migration
- `bundle/hooks/lib/memory-manager.js` — per-session memory + index
- `bundle/hooks/lib/token-tracker.js` — per-session token tracking
- `bundle/hooks/lib/version-manager.js` — per-session versioning + atomic write
- `bundle/hooks/lib/daily-manager.js` — per-session daily journal (implied)
- `bundle/opencode/hooks/lib/state-manager.js` — OpenCode mirror
- `bundle/opencode/hooks/lib/memory-manager.js` — OpenCode mirror
- `bundle/opencode/hooks/lib/token-tracker.js` — OpenCode mirror
- `bundle/opencode/hooks/lib/version-manager.js` — OpenCode mirror

## Risks

- Session ID collision if PID reused quickly (mitigated: env vars preferred, PID fallback last resort)
- Disk space growth from many sessions (mitigated: caps per session — memory 100 goals, history 50 runs, lifecycle 200 events)
- Atomic write on network filesystems (mitigated: local dev machine assumption; temp+rename is best effort)
- OpenCode desktop + CLI sidecar share config but not session (mitigated: `OPENCODE_SESSION_ID` distinguishes)
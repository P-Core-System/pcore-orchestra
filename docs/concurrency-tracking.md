# Concurrent Session Tracking (session-claims)

P-Core repos are edited by multiple AI sessions (OpenCode, Cursor, Claude Code)
— sometimes at the same time. `scripts/session-claims.sh` is the lightweight
registry that answers: **who is working on what, right now?**

## How it works

- Each session writes a claim to `<repo>/.pcore/session-claims.json`:
  `{ id, tool, agent, model, repo, branch, scope, task, started_at, heartbeat_at }`
- Identity comes from `PCORE_SESSION_ID` (recommended — set once per session),
  falling back to `OPENCODE_SESSION_ID` / `CLAUDE_SESSION_ID` / `CURSOR_TRACE_ID`,
  then `pid-<pid>` as last resort.
- Claims older than `PCORE_CLAIM_STALE_MIN` (default 30) minutes are treated as
  dead by `check`/`gc` — crashed sessions never deadlock a repo.
- `.pcore/` should be git-ignored in consumer repos (runtime state, not code).

## Commands

| Command | Purpose |
|---|---|
| `claim <repo> [--scope a,b] [--task t]` | create/renew claim for this session |
| `renew <repo>` | heartbeat only |
| `release [repo]` | drop this session's claim (`--force` drops all) |
| `list [repo|-a]` | table of live + stale claims (all pcore repos with `-a`) |
| `check <repo> [paths...]` | exit 1 if another LIVE claim overlaps paths/scope |
| `gc` | purge stale claims across all repos |

## Orchestra integration

- **Conductor** (orchestra.md): runs `list -a` before spawning phases; surfaces
  conflicts to the user.
- **Implementer**: `claim` at phase start → work → commit gate → `release`.
- **Verifier/Reviewer**: read-only; may call `check` before running tests that
  mutate shared state.

## Install note

`install.sh` copies scripts into the toolkit; consumer agents reference it via
the orchestra repo path or `~/.pcore/bin/session-claims.sh` if symlinked.

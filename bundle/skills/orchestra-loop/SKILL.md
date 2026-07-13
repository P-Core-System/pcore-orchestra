---
name: orchestra-loop
description: >-
  Ambient multi-agent orchestra for Cursor — auto plan → implement → verify →
  review on build/fix/refactor prompts without /orchestra. Use when coding in
  Cursor Agent, implementing features, fixing bugs, deploying, or when user
  mentions orchestra, agent loop, or multi-step implementation.
---

# Orchestra Loop (ambient, global)

Runs on **this machine** via `~/.cursor/`. **You do not need `/orchestra`** — hooks auto-start on implementation-style prompts.

## Ambient mode (default ON)

When the user asks to **add, fix, build, refactor, deploy, install, configure, migrate, integrate, debug, continue, or finish** something:

1. `beforeSubmitPrompt` hook auto-activates orchestra state.
2. Parent agent launches **orchestra-planner** (Task).
3. Hooks chain implement → verify → review via `subagentStop`.

**Skipped for:** explain-only questions, "what is/how does", "no orchestra", "just explain", trivial hi/thanks.

## Phases

| # | Subagent | Role | Git workflow |
|---|----------|------|-------------|
| 1 | `orchestra-planner` | Plan only (`readonly`) | No commit — plan is output text |
| 2 | `orchestra-implementer` | Minimal implementation | **Commits all changes** with `<type>(<scope>): <desc>` |
| 3 | `orchestra-verifier` | Tests / lint / smoke | No commit — checks only, verifies clean tree |
| 4 | `orchestra-reviewer` | Final gate (`readonly`) | No commit — reviews diff, suggests final message |

`FIX_REQUIRED` / `VERIFY_FAIL` → hooks loop back to **orchestra-implementer** (which commits fixes).

## Git commit convention

All commits follow: `<type>(<scope>): <description>`

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`

- **Planner** includes commit strategy in the plan
- **Implementer** commits after ALL changes (not mid-implementation)
- **Verifier** checks `git status --porcelain` for clean tree
- **Reviewer** reviews commit messages and suggests final commit if ORCHESTRA_COMPLETE

## Self-review & error-free rules

Each subagent has a self-review checklist and error-free rules:

| Subagent | Key self-review | Error-free rule |
|----------|----------------|-----------------|
| Planner | Goal clear, files exist, done-when testable | No assumptions about undocumented behavior |
| Implementer | All plan items done, no scope creep, committed | Zero tolerance: syntax, debug code, secrets |
| Verifier | All checks run, git clean, verdict clear | Never skip, never assume PASS, never fix code |
| Reviewer | Read actual diff, findings are file:line, verdict matches | Never approve if tests fail or secrets in code |

## User commands

| Command | Action |
|---------|--------|
| *(normal coding prompt)* | Auto-orchestrate if implement/fix/build |
| `/orchestra <goal>` | Force start |
| `/orchestra stop` | Stop active loop |
| `disable orchestra` | Turn ambient off |
| `enable orchestra` | Turn ambient on |
| `no orchestra` | Skip for this prompt |

## CLI

```powershell
node $env:USERPROFILE\.cursor\hooks\orchestra-enable.js status
node $env:USERPROFILE\.cursor\hooks\orchestra-enable.js ambient-off
node $env:USERPROFILE\.cursor\hooks\orchestra-enable.js ambient-on
node $env:USERPROFILE\.cursor\hooks\orchestra-enable.js stop
```

## Parent agent rules

- Use Task with **`orchestra-*` names** — hooks matchers require exact names.
- Do not nest orchestra inside orchestra.
- After `ORCHESTRA_COMPLETE`, summarize and run `orchestra-enable.js stop`.
- **Do not modify files between phases** — let subagents handle their own work.
- **Do not commit between phases** — implementer commits, others are read-only.
- Works in **Cursor IDE Agent** (user hooks). Not cloud agents unless project hooks copied.

## Hooks

| Event | Role |
|-------|------|
| `sessionStart` | Inject ambient policy every session |
| `beforeSubmitPrompt` | Auto-start on implement prompts |
| `subagentStop` | Chain next phase |
| `stop` | Nudge if parent stalled |

## Opt out

Say **"no orchestra"** or run `ambient-off`. Pure Q&A never triggers the chain.

## Heartbeat & stall detection

Heartbeat timestamps are written on every hook execution. If a phase runs >5min (configurable), stall detection emits recovery nudges. After 2 stalls, orchestration aborts.

## Memory

- **Short-term**: Tracked during each run (phases, files, errors, decisions). Available to subagents.
- **Long-term**: Persistent `~/.cursor/hooks/state/orchestra-memory.json`. Planner reads past goals/errors; reviewer writes lessons.

```bash
node ~/.cursor/hooks/orchestra-enable.js memory          # View
node ~/.cursor/hooks/orchestra-enable.js memory clear    # Clear
```

## Resumable tasks

- **Crash recovery**: `sessionStart` detects stale state, offers resume via "resume orchestra"
- **Manual pause/resume**: `pause [reason]` / `resume` commands or chat
- **Checkpoint**: `checkpoint` saves state without pausing

## Lifecycle events

Every phase transition recorded to state. Last 200 events retained. Phase durations tracked.

## Six-File Context

If the workspace has `context/project-overview.md` (Six-File Context Methodology), hooks inject read order at session start. Subagents read present `context/*.md` files before acting.

Bootstrap in any project:

```bash
bash /path/to/pcore-agents/scripts/init-context.sh /path/to/your-app --bridge
```

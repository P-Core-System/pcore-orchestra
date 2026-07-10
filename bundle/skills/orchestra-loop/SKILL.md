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

| # | Subagent | Role |
|---|----------|------|
| 1 | `orchestra-planner` | Plan only (`readonly`) |
| 2 | `orchestra-implementer` | Minimal implementation |
| 3 | `orchestra-verifier` | Tests / lint / smoke |
| 4 | `orchestra-reviewer` | Final gate (`readonly`) |

`FIX_REQUIRED` / `VERIFY_FAIL` → hooks loop back to **orchestra-implementer**.

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

## Six-File Context

If the workspace has `context/project-overview.md` (Six-File Context Methodology), hooks inject read order at session start. Subagents read present `context/*.md` files before acting.

Bootstrap in any project:

```bash
bash /path/to/cursor-orchestra/scripts/init-context.sh /path/to/your-app --bridge
```

# Global Cursor Orchestra Loop (ambient)

Machine-wide agent orchestration — **runs automatically** when you code in Cursor Agent. No `/orchestra` required.

## How it works now

```
You: "fix the signal bot import error"
        ↓
beforeSubmitPrompt hook → auto-starts orchestra
        ↓
Agent → orchestra-planner → implementer → verifier → reviewer
        ↓
hooks chain each phase (subagentStop)
```

## What triggers auto-orchestration

**Yes:** add, fix, build, create, refactor, deploy, install, setup, configure, migrate, integrate, debug, continue, write tests, ship…

**No:** explain, what is, how does, summarize, hi/thanks, "no orchestra", "just explain"

## Quick commands

| Say / run | Effect |
|-----------|--------|
| *(just code normally)* | Orchestra when appropriate |
| `disable orchestra` | Turn ambient off |
| `enable orchestra` | Turn ambient on |
| `/orchestra stop` | Stop active loop |

```powershell
node $env:USERPROFILE\.cursor\hooks\orchestra-enable.js status
node $env:USERPROFILE\.cursor\hooks\orchestra-enable.js ambient-off
```

## Files

| Path | Role |
|------|------|
| `hooks.json` | sessionStart + **beforeSubmitPrompt** + subagentStop + stop |
| `hooks/orchestra-prompt.js` | Auto-detect implement prompts |
| `hooks/state/orchestra.json` | `ambient: true` by default |
| `agents/orchestra-*.md` | 4 subagents (proactive descriptions) |
| `rules/orchestra-loop.mdc` | Always-on agent instructions |
| `skills/orchestra-loop/` | Full skill reference |

## After update

**Restart Cursor** so hooks load (global + project).

```powershell
node $env:USERPROFILE\.cursor\hooks\orchestra-health.js
```

Check: **Settings → Hooks** — 4 hooks (global) or 4 via project bridge in `crypto-trader/.cursor/hooks.json`.

## Project bridge (crypto-trader)

This repo includes `.cursor/hooks.json` → `bridge.js` → your global `~/.cursor/hooks/`.
Same ambient orchestra when this project is open (also helps cloud agents that load **project** hooks).

## OpenCode / CLI note

Ambient hooks apply to **Cursor IDE Agent** (`~/.cursor/hooks.json`). Cursor CLI cloud agents do not load user hooks — copy hooks to project `.cursor/` for repo-specific ambient mode.

# Architecture

## Stack

| Layer | Technology | Role |
|-------|------------|------|
| IDE integration | Cursor hooks API | `sessionStart`, `beforeSubmitPrompt`, `subagentStop`, `stop` |
| Hook runtime | Node.js 18+ | Cross-platform hook scripts |
| Agent definitions | Markdown frontmatter | `~/.cursor/agents/orchestra-*.md` |
| Persistent state | JSON file | `~/.cursor/hooks/state/orchestra.json` |
| Project context | Markdown six files | `context/*.md` in target repos |
| Install | Bash + PowerShell | `install.sh`, `install.ps1`, `scripts/init-context.*` |

## System boundaries

| Path | Owns |
|------|------|
| `bundle/hooks/orchestra-lib.js` | State, prompt classification, phase chain, context detection |
| `bundle/hooks/orchestra-*.js` | Individual hook handlers |
| `bundle/agents/` | Subagent prompts (planner readonly; others writable) |
| `bundle/rules/orchestra-loop.mdc` | Always-on agent policy |
| `bundle/skills/orchestra-loop/` | Skill documentation |
| `project-bridge/` | Repo-local delegation only — no duplicate logic |
| `templates/context/` | Blank templates — never installed to `~/.cursor/` |
| `context/` | This repo's own six-file context (dogfooding) |

## Storage model

| Data | Location | Notes |
|------|----------|-------|
| Orchestra state | `~/.cursor/hooks/state/orchestra.json` | Machine-local; not committed |
| Installed bundle | `~/.cursor/hooks`, `agents`, `skills`, `rules` | Copied from `bundle/` on install |
| Target project context | `<project>/context/*.md` | Created by `init-context` or manually |
| Target entry point | `<project>/AGENTS.md` | Points agents to six files |

## Auth and access

No network auth in orchestra itself. Hooks run locally with the user's Cursor session permissions. Do not store secrets in `orchestra.json` or hook scripts.

## Phase model

```
idle → plan (planner) → implement → verify → review → done
                              ↑                    |
                              └── FIX_REQUIRED ────┘
```

`subagentStop` hook reads subagent name, advances phase, emits follow-up user message for parent agent to launch next subagent via Task tool.

## Invariants

1. Hook scripts must exit quickly and emit valid JSON on stdout; never throw uncaught errors (use `.catch(() => emit({}))`).
2. `orchestra-planner` is **readonly** — no file edits in plan phase.
3. Installed global hooks merge into existing `hooks.json`; never overwrite unrelated hook entries.
4. `init-context` must not overwrite existing `context/` or `AGENTS.md` files without explicit `--force`.
5. Six-file read order is fixed: overview → architecture → code-standards → ui-context → ai-workflow-rules → progress-tracker.
6. Context injection references paths relative to workspace root, not absolute machine paths.

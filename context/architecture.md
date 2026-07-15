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
| `bundle/hooks/orchestra-lib.js` | Facade — re-exports all lib/* modules for backward compatibility |
| `bundle/hooks/orchestra-*.js` | Individual hook handlers |
| `bundle/hooks/lib/constants.js` | Named constants (no magic numbers) |
| `bundle/hooks/lib/io.js` | stdin/stdout helpers (`readStdinJson`, `emit`) |
| `bundle/hooks/lib/state-manager.js` | State CRUD (`loadState`, `saveState`, `startOrchestra`) |
| `bundle/hooks/lib/prompt-classifier.js` | Prompt extraction and classification |
| `bundle/hooks/lib/phase-engine.js` | Phase chain definition and transitions |
| `bundle/hooks/lib/lifecycle-recorder.js` | Lifecycle events and phase timers |
| `bundle/hooks/lib/heartbeat-monitor.js` | Stall detection and heartbeat |
| `bundle/hooks/lib/memory-manager.js` | Short-term and long-term memory |
| `bundle/hooks/lib/history-recorder.js` | Orchestration run history |
| `bundle/hooks/lib/checkpoint-manager.js` | Resumable tasks and crash recovery |
| `bundle/hooks/lib/context-detector.js` | Six-file workspace context detection |
| `bundle/agents/` | Subagent prompts (planner readonly; others writable) |
| `bundle/rules/orchestra-loop.mdc` | Always-on agent policy |
| `bundle/skills/orchestra-loop/` | Skill documentation |
| `project-bridge/` | Repo-local delegation only — no duplicate logic |
| `templates/context/` | Blank templates — never installed to `~/.cursor/` |
| `context/` | This repo's own six-file context (dogfooding) |

## Storage model

| Data | Location | Notes |
|------|----------|-------|
| Orchestra state | `~/.cursor/hooks/state/orchestra.json` | V2: lifecycle, heartbeat, memory, resumable |
| Long-term memory | `~/.cursor/hooks/state/orchestra-memory.json` | Persistent across sessions, capped at 100 goals |
| Installed bundle | `~/.cursor/hooks`, `agents`, `skills`, `rules` | Copied from `bundle/` on install |
| Target project context | `<project>/context/*.md` | Created by `init-context` or manually |
| Target entry point | `<project>/AGENTS.md` | Points agents to six files |

## Auth and access

No network auth in orchestra itself. Hooks run locally with the user's Cursor session permissions. Do not store secrets in `orchestra.json` or hook scripts.

## System Design & Infrastructure

This project uses no external infrastructure — all hook scripts run locally on the developer machine. The following table documents why each concept is N/A or reserved for future use.

| Concept | Status | Notes |
|---------|--------|-------|
| **Compute** | Local Node.js only | Scripts run on `node` via Cursor hooks — no server |
| **Object Storage** | N/A | No file uploads or media |
| **CDN** | N/A | No static assets served |
| **Caching** | N/A | State is read from local JSON on each hook call |
| **Queue / Async** | N/A | Hooks are synchronous per event |
| **Rate Limiting** | N/A | Runs locally — no network endpoint to protect |
| **Database** | N/A | Persistence is local JSON files only |
| **Load Balancing** | N/A | Single-machine tool |
| **Microservices** | N/A | Monolithic hook scripts |
| **Observability** | Minimal | stdout/console + JSON state file. No external telemetry |
| **Search** | N/A | No search feature |
| **Streaming / Realtime** | N/A | Event-driven hooks, no streaming |

## Phase model

```
idle → plan (planner) → implement → verify → review → done
  ↑        ↑                                      |
  |        └──────── FIX_REQUIRED ─────────────────┘
  │
  └── resume (from checkpoint)
```

`subagentStop` hook reads subagent name, advances phase, emits follow-up user message for parent agent to launch next subagent via Task tool.

## Agent Architecture: Harness > Scaffold > Loop

Cursor Orchestra implements a three-layer agent architecture (see `context/harness-scaffold-loop.md` for full details):

- **Loop:** Phase chain (plan → implement → verify → review)
- **Scaffold:** Agent prompts, context injection, ambient policy  
- **Harness:** Hook scripts, state management, error handling

The harness calls the scaffold, which defines the loop behavior.

## Invariants

1. Hook scripts must exit quickly and emit valid JSON on stdout; never throw uncaught errors (use `.catch(() => emit({}))`).
2. `orchestra-planner` is **readonly** — no file edits in plan phase.
3. Installed global hooks merge into existing `hooks.json`; never overwrite unrelated hook entries.
4. `init-context` must not overwrite existing `context/` or `AGENTS.md` files without explicit `--force`.
5. Six-file read order is fixed: overview → architecture → code-standards → ui-context → ai-workflow-rules → progress-tracker.
6. Context injection references paths relative to workspace root, not absolute machine paths.

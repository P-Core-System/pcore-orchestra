# Cursor Orchestra

## Overview

Cursor Orchestra is a portable, ambient multi-agent workflow for Cursor IDE. It automatically chains four specialized subagents — planner, implementer, verifier, reviewer — on build/fix/refactor prompts without requiring `/orchestra`. It integrates the **Six-File Context Methodology** so target projects with a `context/` folder give agents stable product, architecture, and workflow grounding across sessions.

## Goals

1. Auto-run plan → implement → verify → review on implementation prompts (ambient mode ON by default).
2. Adaptive routing: default **core** 4-phase loop; **enterprise** SDLC for `/enterprise` or high-complexity signals; short/informal goals still start **core** with planner context inference (no clarify block).
3. Install globally to `~/.cursor/` from one repo, usable on any machine (Windows, macOS, Linux).
4. Bootstrap six-file `context/` + `AGENTS.md` in any project via `scripts/init-context.sh`.
5. Inject project context into hooks when `context/` exists in the open workspace.
6. Stay opt-out friendly: `no orchestra`, `disable orchestra`, `/orchestra stop`.

## Core User Flow

1. Developer clones `pcore-orchestra` and runs `install.sh` (or `install.ps1`).
2. Developer restarts Cursor; hooks register in Settings → Hooks.
3. Developer opens any project; optionally runs `init-context.sh` to add six context files.
4. Developer asks Agent to "fix the login bug" — orchestra auto-starts planner subagent.
5. Hooks chain implementer → verifier → reviewer; `FIX_REQUIRED` loops back to implementer.
6. On completion, `progress-tracker.md` in the target project should be updated (implementer responsibility).

## Features

### Orchestration

- Ambient prompt classification (implement verbs, multistep, explicit `/orchestra`).
- Phase state in `~/.cursor/hooks/state/orchestra.json`.
- Subagent chaining via `subagentStop` hook follow-up messages.
- Max iteration guard (default 8).

### Context integration

- Detect `context/` six files in workspace roots at session start.
- Inject read order into agent context (matches AGENTS.md entry point).
- Planner/implementer/verifier/reviewer agents mandate context reads when present.
- Blank templates from JavaScript Mastery Six-File Context Methodology in `templates/context/`.

### Distribution

- `install.sh` / `install.ps1` — global install, optional `--project` bridge.
- `project-bridge/` — repo-local `.cursor/hooks.json` delegating to global hooks.
- `scripts/init-context.sh` / `init-context.ps1` — scaffold context in target repos.

## Scope

### In Scope

- Cursor IDE hooks, subagents, skills, rules.
- Node.js hook scripts (no Python runtime dependency).
- Six-file context templates and bootstrap scripts.
- Documentation for install, usage, uninstall.

### Out of Scope

- Cursor product internals or undocumented APIs.
- Hosting a web UI for orchestra (CLI/hooks only).
- Replacing project-specific CI/CD or test runners.
- Bundling LLM API keys or cloud agent infrastructure.

## Success Criteria

1. `node ~/.cursor/hooks/orchestra-health.js` passes on a fresh install.
2. A build/fix prompt in Cursor Agent auto-launches orchestra-planner without `/orchestra`.
3. `init-context.sh <dir>` creates six files + `AGENTS.md` without overwriting existing files.
4. Opening a project with `context/` injects six-file read instructions at session start.
5. Standalone git repo installs independently of crypto-trader.

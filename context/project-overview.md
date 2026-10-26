# P-Core Orchestra

## Overview

P-Core Orchestra is a portable, ambient multi-agent workflow for **Cursor**, **OpenCode CLI**, and **Qoder CLI**. It automatically chains four specialized subagents — planner, implementer, verifier, reviewer — on build/fix/refactor prompts without requiring `/orchestra`. It integrates the **Six-File Context Methodology** so target projects with a `context/` folder give agents stable product, architecture, and workflow grounding across sessions.

## Goals

1. Auto-run plan → implement → verify → review on implementation prompts (ambient mode ON by default).
2. Adaptive routing: default **core** 4-phase loop; **enterprise** SDLC for `/enterprise` or high-complexity signals; short/informal goals still start **core** with planner context inference (no clarify block).
3. Install globally to `~/.cursor/` from one repo, usable on any machine (Windows, macOS, Linux).
4. Bootstrap six-file `context/` + `AGENTS.md` in any project via `scripts/init-context.sh`.
5. Inject project context into hooks when `context/` exists in the open workspace.
6. Stay opt-out friendly: `no orchestra`, `disable orchestra`, `/orchestra stop`.

## Core User Flow

1. Developer clones `pcore-orchestra` and runs `install.sh` (or `install.ps1`).
2. Developer restarts the host — Cursor, OpenCode desktop/CLI, or a Qoder session — so hooks and the ambient plugin load.
3. Developer opens any project; optionally runs `init-context.sh` to add six context files.
4. Developer asks "fix the login bug" — ambient hooks (Cursor/Qoder) or the OpenCode conductor starts the planner.
5. Hooks chain implementer → verifier → reviewer; `FIX_REQUIRED` loops back to implementer.
6. On completion, `progress-tracker.md` in the target project should be updated (implementer responsibility).

## Features

### Orchestration

- Ambient prompt classification (implement verbs, multistep, explicit `/orchestra`).
- Phase state in `<host-hooks>/state/orchestra.json` (`~/.cursor/`, `~/.config/opencode/`, or `~/.qoder/`; `PCORE_STATE_DIR` overrides).
- Subagent chaining via `subagentStop` hook follow-up messages.
- Max iteration guard (default 8).
- **Project-type specialist routing**: medium/complex core loops auto-insert the type's missing specialists (product-owner, product-manager, ui-ux-designer, project-manager, architect, type engineers/testers/reviewers) into the plan→implement→verify→review spine based on `project.yaml` `type`. The `ai-agent` type routes design to product-owner → prompt-engineer, planning to project-manager, implement to ml-engineer + backend-engineer, verify to qa-engineer + model-evaluator, and review to code-reviewer + ai-safety-engineer; its SDLC template is `templates/architectures/29-ai-agent-sdlc.md`.
- **Corporate tier**: large org / multi-team / program / portfolio signals escalate to coordination + governance agents (agent-selector, project-type-classifier, workflow-orchestrator, per-track scrum-master/project-manager, governance committee, corporate close).
- **Hard production checklist gate**: `ORCHESTRA_COMPLETE` is blocked until all production-readiness items pass — required quality gates green (build/tests/lint/security/reviewer-approval/docs-updated/memory-updated), security scan clean, progress-tracker referenced/updated, six-file context present. Enforced by `evaluateProductionChecklist` in `orchestra-quality-gate.js`, recorded as the `production-checklist` quality gate (invariant 24, fail closed).
- **Registry-gate tool-surface access control**: tool access restrictions are enforced by a descriptor flag (`saleOnly`) on tool registration + a single-preset gate key in `checkPermissions`, keyed by slug with no role escape. The dispatch layer (`executeTools`, `getJsonSchemas`) is never edited for access control; the system prompt is aligned to the actual tool surface. Reference: a sibling project's product-search tools marked `saleOnly: true`, removed from general context (absent, not refusal-guarded).
- **Studio dashboard**: Separate read-only React/Vite app (`studio/`) that visualizes WorkItems, conductor runs, gate evidence, human reviews, and token usage. Discovers global and worktree-partitioned state directories. Installs via `install.sh --studio`, launches via `orchestra-studio` (serves on http://localhost:3110).

### Context integration

- Detect `context/` six files in workspace roots at session start.
- Inject read order into agent context (matches AGENTS.md entry point).
- Planner/implementer/verifier/reviewer agents mandate context reads when present.
- Blank templates from JavaScript Mastery Six-File Context Methodology in `templates/context/`.
- **Hybrid memory recall**: completed goals are indexed twice — a JSON inverted index and a SQLite FTS5 mirror (`node:sqlite`, no native deps) — and fused by reciprocal rank fusion. The FTS side is best-effort: absent `node:sqlite`, an unwritable state dir, or `PCORE_FTS_DISABLE=1` degrades silently to JSON-only.

### Distribution

- `install.sh` / `install.ps1` — global install, optional `--project` bridge.
- `project-bridge/` — repo-local `.cursor/hooks.json` delegating to global hooks.
- `scripts/init-context.sh` / `init-context.ps1` — scaffold context in target repos.

### Cross-tool repo scoping

- `scripts/setup-repo-scoping.sh` — auto-detects single-repo vs monorepo, generates `.ignore` + `.cursorignore`.
- `install.sh` auto-installs scoping to `~/.local/bin/` + global gitignore on any device.
- Prevents AI tools (OpenCode, Cursor, ripgrep, fd, ag) from scanning `node_modules/`, `vendor/`, `venv/`, caches.
- `scripts/opencode-maintenance.sh` — DB/log/snapshot housekeeping (dry-run/apply/vacuum).

## Scope

### In Scope

- Hooks, subagents, skills, and rules for Cursor, OpenCode CLI, and Qoder CLI.
- Node.js hook scripts (no Python runtime dependency).
- Six-file context templates and bootstrap scripts.
- Local read-only Studio dashboard (`server/` + `studio/`).
- Documentation for install, usage, uninstall.

### Out of Scope

- Cursor product internals or undocumented APIs.
- Hosting a multi-tenant web service (Studio runs on localhost and only reads hook state).
- Replacing project-specific CI/CD or test runners.
- Bundling LLM API keys or cloud agent infrastructure.

## Success Criteria

1. `node ~/.cursor/hooks/orchestra-health.js` passes on a fresh install.
2. A build/fix prompt auto-launches `orchestra-planner` without `/orchestra` in Cursor, OpenCode, and Qoder CLI.
3. `init-context.sh <dir>` creates six files + `AGENTS.md` without overwriting existing files.
4. Opening a project with `context/` injects six-file read instructions at session start.
5. Standalone git repo installs independently of any sibling project.

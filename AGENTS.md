# Cursor Orchestra — agent notes

## Application building context

Read the following files in order before implementing or making architectural decisions:

1. `context/project-overview.md` — product definition, goals, features, scope
2. `context/architecture.md` — system structure, boundaries, storage, invariants
3. `context/code-standards.md` — Node hook scripts, agent markdown, install conventions
4. `context/ui-context.md` — N/A for this repo (CLI/hooks only); skip unless editing docs site
5. `context/ai-workflow-rules.md` — scoping, doc sync, verification, six-file integration
6. `context/progress-tracker.md` — current phase, completed work, next steps

Update `context/progress-tracker.md` after each meaningful implementation change. If architecture or scope changes, update the relevant context file before continuing.

## Layout

| Path | Role |
|------|------|
| `bundle/` | Source payload installed to `~/.cursor/` |
| `bundle/hooks/` | Node hook scripts (session, prompt, subagent, stop) |
| `bundle/agents/` | Four orchestra subagent definitions |
| `bundle/skills/orchestra-loop/` | Ambient orchestration skill |
| `bundle/rules/orchestra-loop.mdc` | Always-on Cursor rule |
| `project-bridge/` | Per-repo `.cursor` bridge to global hooks |
| `templates/context/` | Blank six-file context templates (JavaScript Mastery methodology) |
| `templates/AGENTS.md` | Entry-point template for target projects |
| `scripts/init-context.sh` | Bootstrap `context/` + `AGENTS.md` in any repo |
| `install.sh` / `install.ps1` | Install bundle to global `~/.cursor/` |

## Commands

```bash
# Install orchestra globally
bash install.sh
bash install.sh --project   # also install project bridge in cwd

# Bootstrap six-file context in a project (orchestra-aware)
bash scripts/init-context.sh /path/to/your-project
bash scripts/init-context.sh /path/to/your-project --bridge

# Health / control
node ~/.cursor/hooks/orchestra-health.js
node ~/.cursor/hooks/orchestra-enable.js status
```

## Six-file context + orchestra

Projects with a `context/` folder (six files) get automatic context injection at session start and when orchestra activates. The planner reads all six files before planning; implementer follows `code-standards.md` and `architecture.md` invariants; verifier checks against spec/progress-tracker; reviewer confirms doc sync per `ai-workflow-rules.md`.

Bootstrap templates: `bash scripts/init-context.sh <project-dir>`

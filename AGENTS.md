# Cursor Orchestra — agent notes

## Application building context

Read the following files in order before implementing or making architectural decisions:

0. `context/harness-scaffold-loop.md` — agent architecture hierarchy (harness, scaffold, loop)
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
| `bundle/` | Source payload installed to `~/.cursor/` and `~/.config/opencode/` |
| `bundle/hooks/` | Node hook scripts (session, prompt, subagent, stop) — Cursor only |
| `bundle/agents/` | Cursor orchestra subagent definitions |
| `bundle/skills/orchestra-loop/` | Cursor ambient orchestration skill |
| `bundle/rules/orchestra-loop.mdc` | Cursor always-on rule |
| `bundle/opencode/` | OpenCode agents, skill, health check, state |
| `bundle/opencode/agents/` | OpenCode orchestra subagent definitions |
| `bundle/opencode/skills/orchestra-loop/` | OpenCode orchestration skill |
| `bundle/opencode/hooks/` | OpenCode health check script |
| `bundle/opencode/state/` | Default shared state file |
| `project-bridge/` | Per-repo `.cursor` bridge to global hooks |
| `templates/context/` | Blank six-file context templates (JavaScript Mastery methodology) |
| `templates/AGENTS.md` | Entry-point template for target projects |
| `scripts/init-context.sh` | Bootstrap `context/` + `AGENTS.md` in any repo |
| `install.sh` / `install.ps1` | Install bundle to global `~/.cursor/` + `~/.config/opencode/` |

## Commands

```bash
# Install orchestra globally (both Cursor + OpenCode)
bash install.sh
bash install.sh --all        # both (default)
bash install.sh --cursor     # Cursor only
bash install.sh --opencode   # OpenCode only
bash install.sh --project    # + project bridge in cwd

# Bootstrap six-file context in a project (orchestra-aware)
bash scripts/init-context.sh /path/to/your-project
bash scripts/init-context.sh /path/to/your-project --bridge

# Health / control (Cursor)
node ~/.cursor/hooks/orchestra-health.js
node ~/.cursor/hooks/orchestra-enable.js status

# Health (OpenCode)
node ~/.config/opencode/hooks/orchestra-health-opencode.js
```

## Six-file context + orchestra

Projects with a `context/` folder (six files) get automatic context injection at session start and when orchestra activates. The planner reads all six files before planning; implementer follows `code-standards.md` and `architecture.md` invariants; verifier checks against spec/progress-tracker; reviewer confirms doc sync per `ai-workflow-rules.md`.

Bootstrap templates: `bash scripts/init-context.sh <project-dir>`

## OpenCode integration

OpenCode uses a skill-driven approach instead of hooks:

- **Agents** are defined as markdown files in `~/.config/opencode/agents/`
- **Skill** at `~/.config/opencode/skills/orchestra-loop/SKILL.md` teaches the main agent to chain phases
- **State** is shared at `~/.config/opencode/state/orchestra.json`
- **External discovery** via symlink at `~/.agents/skills/orchestra-loop`

The OpenCode agents mirror the Cursor agents but use OpenCode's frontmatter format (`mode: subagent` instead of `readonly: true`).

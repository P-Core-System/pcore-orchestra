# AGENTS.md Authoring Guide

A practical guide to writing `AGENTS.md` (and equivalent) files that coding agents
across tools actually follow. Follows the emerging **open `AGENTS.md` standard**:
a root-level markdown file that tells an AI agent how to work in this repo. Keep
it short, structured, and scannable — agents read it at session start.

## Core Sections (open standard)

Use these sections in order. Omit a section only if it genuinely doesn't apply.

### Project Overview
One paragraph: what the project is, who uses it, and the one-sentence goal.
Name the language/runtime and the primary deploy target.

### Tech Stack (version pins)
Pin versions — agents break on implicit "latest".

```markdown
- Node.js 18.19+   (CI uses 20.x)
- TypeScript 5.4
- Postgres 16
- Hono 4.x  (not Express)
- pnpm 9
```

### Setup Commands
The exact sequence to go from clone to running.

```bash
pnpm install
pnpm db:migrate
pnpm dev        # http://localhost:3000
```

### Code Style
Concrete rules, not "clean code". Reference the linter/formatter as the source of
truth and call out the non-obvious (e.g. "tabs not spaces", "no default exports").

### Testing Instructions
How to run the suite, and the gate that must pass before commit/PR.

```bash
pnpm test         # unit
pnpm test:e2e     # playwright
# PR gate: `pnpm test` + `pnpm lint` must be green.
```

### Architecture Notes
Folder logic + module boundaries (see `templates/architectures/26-folder-structure.md`).
Document what each module owns, its public API, and forbidden imports. This is
where unstated boundaries go to die.

```markdown
## Architecture Notes
- `src/modules/orders/` owns order lifecycle; public API = index.ts.
- `shared/` is infra only — no domain logic.
- orders may import auth; auth MUST NOT import orders.
```

### PR & Commit Guidelines
Use **Conventional Commits** so history is machine-readable.

```markdown
## PR & Commit Guidelines
- Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
- Scope optional: `feat(auth): add MFA`.
- PRs need one approving review; `pnpm test` + `pnpm lint` green.
- Keep PRs focused; one concern per PR.
```

### Optional: `## Agents` subagent block
If your tool supports named subagents, declare them here with their remit and
boundaries. Cursor/OpenCode read `.cursor/agents/` + `~/.config/opencode/agents/`
separately, but a top-level `## Agents` section documents intent for any tool.

```markdown
## Agents
- `planner` — research only, never edits. Reads context/ before planning.
- `implementer` — writes code, commits before done.
- `reviewer` — scope + doc-sync check, no edits.
```

## Per-Tool Notes

Different tools discover and consume these files differently. Cover all you ship.

### Cursor
- **Primary:** `.cursor/rules/*.mdc` — the **modern** rule format (not the legacy
  single `.cursorrules` file, which is deprecated). Place always-on rules as
  `alwaysApply: true` `.mdc` files under `.cursor/rules/`.
- `AGENTS.md` at the repo root is also read by Cursor's agent mode.
- Subagents live in `.cursor/agents/`; skills in `.cursor/skills/`.

### OpenCode
- **Discovery order:** project-root `AGENTS.md` → global `~/.config/opencode/AGENTS.md`
  → `CLAUDE.md` fallback.
- `opencode.json` supports an `"instructions"` field with **glob patterns** for
  monorepos, mapping file paths to which instruction blocks apply.
- `/init` generates an `AGENTS.md` for the current project.
- Agents in `~/.config/opencode/agents/`; skills in `~/.config/opencode/skills/`.

```json
// opencode.json (monorepo example)
{
  "instructions": {
    "context": "**/context/**",
    "templates": "**/templates/**"
  }
}
```

### Claude Code
- **Native:** `CLAUDE.md` with hierarchical discovery — repo root, then
  subdirectories can have their own `CLAUDE.md` that merges downward.
- Skills live in `.claude/skills/` (project) and `~/.claude/skills/` (global).
- Also reads `AGENTS.md` when present; `CLAUDE.md` is the first-class file.

### GitHub Copilot
- **Primary:** `.github/copilot-instructions.md` at repo root.
- Skills in `.github/skills/` (project-specific custom instructions/skills).
- Copilot also respects `.github/instructions/*.md` with `applyTo` globs in newer
  versions. Keep `.github/copilot-instructions.md` as the entry pointer.

### Codex (OpenAI)
- **Reads `AGENTS.md` natively** — drop a standards-compliant `AGENTS.md` at the
  repo root and Codex picks it up with no extra config.

## Minimal Template

```markdown
# <Project Name>

## Project Overview
<One paragraph: what, who, goal.>

## Tech Stack
- <Lang> <version pin>
- <Framework> <version pin>

## Setup Commands
```bash
<install>
<run>
```

## Code Style
- <Formatter> is source of truth.
- <Non-obvious rule>.

## Testing Instructions
```bash
<test command>
```
PR gate: <what must pass>.

## Architecture Notes
- <Module> owns <domain>; public API = index.ts.
- Forbidden: <import rule>.

## PR & Commit Guidelines
- Conventional Commits (`feat:`, `fix:`, ...).
- <Review / CI gate>.
```

## Best Practices

- **Short beats exhaustive** — agents skim; a 400-line AGENTS.md gets ignored.
- **Version pins over "latest"** — ambiguity is where agents err.
- **Boundaries in Architecture Notes** — explicit forbidden imports prevent sprawl.
- **One file per tool where needed** — Cursor `.mdc`, OpenCode `AGENTS.md`,
  Claude `CLAUDE.md`, Copilot `.github/copilot-instructions.md`, Codex `AGENTS.md`.
- **Keep AGENTS.md the lingua franca** — every tool except Claude/Copilot reads it;
  let those two point back at it.

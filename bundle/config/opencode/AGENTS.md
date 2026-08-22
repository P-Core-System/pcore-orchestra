# P-Core Orchestra — OpenCode global guidance

Global agent guidance for OpenCode. Project-specific rules live in each repo's
root `AGENTS.md`. This file sets defaults and points at the methodology.

## Read order for any project

1. Repo-root `AGENTS.md` (if present)
2. `context/` six-file set (if present) — `context/architecture.md` defines
   module boundaries and invariants
3. `templates/architectures/` — pick the template matching `project.yaml` `type`

## New guidance templates (pcore-orchestra)

- `templates/architectures/25-design-tokens.md` — DTCG 3-tier token architecture
- `templates/architectures/26-folder-structure.md` — feature/monorepo layout
- `templates/architectures/27-system-design.md` — C4-lite system design doc
- `templates/AGENTS.authoring.md` — how to write AGENTS.md across all five tools

## Methodology

Six-File Context Methodology (JavaScript Mastery). Bootstrap with
`scripts/init-context.sh <project>`. Authoring standard: open `AGENTS.md`.

## Instructions

Monorepo globs are configured in `~/.config/opencode/opencode.json`
(`instructions` field). Keep this file minimal — project context belongs in the
project, not here.

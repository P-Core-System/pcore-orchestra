# GitHub Copilot Instructions — pcore-orchestra

This repository is **pcore-orchestra** — ambient multi-agent orchestration for
Cursor IDE and OpenCode CLI.

## Authoritative guidance

Read the repo-root **`AGENTS.md`** first — it defines the orchestra layout, the
six-file context order, and the commands. Claude Code and OpenCode also use it.

## New guidance templates (2026)

- `templates/architectures/25-design-tokens.md` — W3C DTCG 3-tier token architecture
- `templates/architectures/26-folder-structure.md` — feature-based / monorepo structure
- `templates/architectures/27-system-design.md` — C4-lite system design doc
- `templates/AGENTS.authoring.md` — authoring AGENTS.md for OpenCode / Cursor /
  Claude / Copilot / Codex

## Conventions

- Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).
- Update `context/progress-tracker.md` after meaningful changes.
- Node 18+ hook scripts under `bundle/hooks/`; agents/skills under `bundle/`.

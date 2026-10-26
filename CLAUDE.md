# P-Core Orchestra

This repository is **pcore-orchestra** — ambient multi-agent orchestration for
Cursor, OpenCode CLI, and Qoder CLI. Claude Code reads this file natively; OpenCode falls
back to it when no `AGENTS.md` is present.

## Start here

- `AGENTS.md` — orchestra layout, commands, and the six-file context order
- `bundle/ORCHESTRA.md` — harness/loop architecture
- `docs/` — feature, security, and onboarding docs

## New guidance templates (2026)

- `templates/architectures/25-design-tokens.md` — W3C DTCG 3-tier token architecture
- `templates/architectures/26-folder-structure.md` — feature-based / monorepo structure
- `templates/architectures/27-system-design.md` — C4-lite system design doc
- `templates/AGENTS.authoring.md` — authoring AGENTS.md for OpenCode / Cursor /
  Claude / Copilot / Codex

## Conventions

- Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).
- Update `context/progress-tracker.md` after meaningful changes.
- Keep this file as the Claude-native entry point and OpenCode fallback.

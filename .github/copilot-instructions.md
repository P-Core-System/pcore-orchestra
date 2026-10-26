# GitHub Copilot Instructions — pcore-orchestra

This repository is **pcore-orchestra** — ambient multi-agent orchestration for
Cursor, OpenCode CLI, and Qoder CLI.

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

## Model routing

This repo's orchestra agents are pinned to cheap, capable models per platform:

- **Cursor:** default to `composer-2.5` standard; escalate to `grok-4.6` standard only for hard / long-horizon tasks. Avoid Fast variants and Claude/GPT/Gemini as defaults — they burn the limited Other Models pool.
- **OpenCode:** use free models only. Run `bash scripts/update-free-models.sh --check` to validate all agents stay on the free Zen tier.

Helpers: `bash scripts/setup-cursor-model.sh` (Cursor) and `bash scripts/update-free-models.sh --check` (OpenCode).
See `docs/token-optimization.md` and `docs/orchestra-cross-platform.md` for full policy.

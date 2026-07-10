# AI Workflow Rules

## Approach

Build this project incrementally using spec-driven workflow aligned with the **Six-File Context Methodology**. Context files define what orchestra is, how hooks fit together, and current progress. Orchestra subagents read target project `context/` when present before acting.

## Scoping rules

- Work on one concern per change: hooks, agents, install, or init-context — not all at once unless tightly coupled.
- Prefer small verifiable increments (health check passes after each hook change).
- Do not combine unrelated project bridges with agent prompt rewrites in one commit.

## When to split work

Split if a change combines:

- Hook logic changes and new subagent behavior definitions.
- Install script changes and template content generation.
- crypto-trader pointer updates and standalone repo feature work (separate repos).

## Handling missing requirements

- Do not invent Cursor hook payload fields — inspect behavior or document assumptions in `progress-tracker.md`.
- If a target project lacks `context/`, orchestra still works; context injection is optional.
- Ambiguous product behavior: resolve in `project-overview.md` before implementing.

## Protected files

Do not modify without explicit instruction:

- User's existing `~/.cursor/hooks.json` entries unrelated to orchestra (install merges only).
- User projects' filled `context/*.md` when running `init-context` (no `--force`).

## Keeping docs in sync

Update when implementation changes:

- `context/architecture.md` — new hooks, state fields, invariants.
- `context/progress-tracker.md` — every meaningful merge-ready change.
- `README.md` — install URLs, command flags.
- `templates/` — only when template structure intentionally changes.

## Six-file integration rules

1. `init-context` copies blanks from `templates/context/`; never copies this repo's filled `context/`.
2. Planner must read all six files (or note missing files) before `PLAN_READY`.
3. Implementer must respect `architecture.md` invariants and `code-standards.md` in the target project.
4. Verifier runs checks listed in target `ai-workflow-rules.md` when present.
5. Reviewer confirms `progress-tracker.md` update requirement before `ORCHESTRA_COMPLETE`.

## Before moving to the next unit

1. `node bundle/hooks/orchestra-health.js` passes (or global install health after copy).
2. No invariant in `architecture.md` violated.
3. `progress-tracker.md` updated.
4. README reflects new commands or paths.

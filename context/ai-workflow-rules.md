# AI Workflow Rules

## Repo type detection

Before any task, determine the repo type:

- **Single-repo** — one project, one `package.json` / `composer.json` / `pyproject.toml` at root. Scope all reads to this repo root.
- **Monorepo** — multiple subprojects in subdirectories, each with its own `AGENTS.md` or `package.json`. **Never glob `**/` from the monorepo root** — it triggers scans of thousands of files. Work in one subproject at a time; read that subproject's `AGENTS.md` and `context/` individually.

If the workspace root has subdirectories with their own `AGENTS.md` files, treat it as a monorepo. Use `.ignore` / `.cursorignore` / `.gitignore` at the root to exclude heavy subtrees.

## Performance scoping

- Use `rg` (respects `.ignore`) for search — not bare `find` or `grep -r`.
- Read only the files needed for the current task — do not dump-read directories.
- Cap tool output: `tool_output.max_lines=300, max_bytes=12288` (already set via `applyTokenProfile`).
- For monorepos: open the subproject directory, not the root, when possible.
- **Monorepo `opencode.json` `instructions` scoping**: `NARROW_INSTRUCTIONS` uses `**/AGENTS.md` etc. which match every subproject. In large monorepos, this can still inflate tokens. Best practice: scope `instructions` per subproject (e.g., `subproject1/AGENTS.md`, `subproject2/AGENTS.md`) in each subproject's `opencode.json` rather than relying on root-level globs. The `BROAD_INSTRUCTION_GLOBS` denylist (`**/**`, `**/templates/**`, `**/context/**`) is enforced by `filterBroadInstructions()` to strip known token-inflating patterns. Watcher ignores and tool output caps already bound memory/CPU.

## Approach

Build this project incrementally using spec-driven workflow aligned with the **Six-File Context Methodology**. Context files define what orchestra is, how hooks fit together, and current progress. Orchestra subagents read target project `context/` when present before acting.

## Scoping rules

- Work on one concern per change: hooks, agents, install, or init-context — not all at once unless tightly coupled.
- Prefer small verifiable increments (health check passes after each hook change).
- Do not combine unrelated project bridges with agent prompt rewrites in one commit.

## Repo-type scoping (single-repo vs monorepo)

**Single repo** (this repo, pcore-orchestra):
- Scope all reads and globs to this repo root.
- Use project-relative paths: `AGENTS.md`, `context/*.md`, `bundle/**/*.js` — not `**/AGENTS.md`.
- `.ignore` / `.cursorignore` / `.gitignore` at root exclude `node_modules/`, caches, and skill bundle copies. Respect them.

**Monorepo** (e.g., `pcore/` root containing 10 subprojects):
- Work in ONE subproject at a time. Read that subproject's `AGENTS.md` and `context/` individually.
- Never glob `**/` from the monorepo root — it scans 4,700+ files across subprojects.
- The monorepo root has `.ignore` / `.cursorignore` / `.gitignore` that exclude heavy subtrees (`p-core-monorepo/`, `pcore-real-estate/`, `vendor/`, `node_modules/`). Respect them.
- Use `rg` (respects `.ignore`) for search — not bare `find` or `grep -r`.
- Generate scoping files for any new repo: `bash scripts/setup-repo-scoping.sh /path/to/repo`.

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

Update when implementation changes — **mandatory, not optional**:

| If you change... | Update this file |
|---|---|
| Hook scripts, lib modules | `context/architecture.md` (system boundaries) + `context/progress-tracker.md` |
| Agent prompts | `context/architecture.md` (agents section) + `context/progress-tracker.md` |
| Install scripts | `README.md` (commands) + `context/architecture.md` + `context/progress-tracker.md` |
| Templates | `templates/` content + `context/progress-tracker.md` |
| Scoping/ignore files | `context/ai-workflow-rules.md` (scoping rules) + `context/architecture.md` + `context/progress-tracker.md` |
| Code standards | `context/code-standards.md` + `context/progress-tracker.md` |
| Project scope/features | `context/project-overview.md` + `context/progress-tracker.md` |

**Rule:** A commit that changes code but doesn't update the relevant context file is incomplete. The reviewer MUST flag it.

**Progress-tracker format:** `- YYYY-MM-DD — Description. Files: \`path\`. Impact: what changed.`

## Six-file integration rules

1. `init-context` copies blanks from `templates/context/`; never copies this repo's filled `context/`.
2. Planner must read all six files (or note missing files) before `PLAN_READY`.
3. Implementer must respect `architecture.md` invariants and `code-standards.md` in the target project.
4. Verifier runs checks listed in target `ai-workflow-rules.md` when present.
5. Reviewer confirms `progress-tracker.md` update requirement before `ORCHESTRA_COMPLETE`.

## Git workflow rules

- **Only the implementer commits** — planner, verifier, reviewer are read-only.
- Commits follow `<type>(<scope>): <description>` convention.
- Implementer commits after ALL changes, not mid-implementation.
- Verifier checks `git status --porcelain` for clean working tree.
- Reviewer reviews commit messages and suggests final commit on ORCHESTRA_COMPLETE.
- On FIX_REQUIRED loop, implementer commits fixes as a separate commit.
- Parent agent does NOT modify files or commit between phases.

## System design triggers

This project is local-only infrastructure (no servers, no network endpoints). System design concerns (object storage, CDN, caching, queues, rate limiting, load balancing, microservices, observability) are N/A for the hook scripts themselves. If adding a new service or external dependency, document it in `architecture.md` > System Design & Infrastructure first.

## Before moving to the next unit

1. `node bundle/hooks/orchestra-health.js` passes (or global install health after copy).
2. No invariant in `architecture.md` violated.
3. `progress-tracker.md` updated.
4. README reflects new commands or paths.

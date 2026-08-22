# Spec: cross-tool-repo-scoping

## Goal

Running `setup-repo-scoping.sh` on any repository generates `.ignore` and `.cursorignore` that prevent AI tools (OpenCode, Cursor, ripgrep, fd, ag) from scanning `node_modules/`, `vendor/`, `venv/`, caches, and build artifacts. In monorepos, it auto-detects subprojects and writes per-subproject ignore files.

## Context

- Related overview/architecture sections: `context/architecture.md` (Stack → Repo scoping row, System boundaries → Scoping scripts), `context/ai-workflow-rules.md` (Repo type detection, Performance scoping, Monorepo opencode.json instructions scoping), `context/project-overview.md` (Cross-tool repo scoping feature)
- Out of scope: Generating `.gitignore` (handled by global gitignore), modifying existing ignore files without `--force`

## Requirements

1. Auto-detect repo type: monorepo (≥2 subdirs with project markers: `package.json`, `composer.json`, `pyproject.toml`, `requirements.txt`, `.git`) vs single-repo
2. Write common patterns to `.ignore` and `.cursorignore`: `node_modules/`, `vendor/`, `dist/`, `build/`, `coverage/`, `.next/`, `.turbo/`, `.cache/`, `*.pyc`, `*.log`, `.DS_Store`, `venv/`, `.venv/`, `env/`, `__pycache__/`, `.pytest_cache/`, `.mypy_cache/`, `.ruff_cache/`
3. Monorepo root: add heavy subproject subtrees to root ignores (so tools skip them unless opened directly)
4. Monorepo: write per-subproject `.ignore` + `.cursorignore` in each detected subproject
5. Single-repo: write only root ignore files
6. `opencode-token-profile.js`: `NARROW_INSTRUCTIONS` uses root-relative paths (`AGENTS.md`, `context/*.md`) — no `**/` prefixes
7. `opencode-token-profile.js`: `BROAD_INSTRUCTION_GLOBS` denylist strips `**/**`, `**/templates/**`, `**/context/**` from instructions
8. `opencode-token-profile.js`: `applyTokenProfile()` sets `permission.skill` deny-by-default with orchestra skills allowlisted
9. `opencode-token-profile.js`: `tool_output` caps at 300 lines / 12 KB; `compaction` with `prune: true`, `reserved: 6000`, `tail_turns: 12`
10. `opencode-token-profile.js`: phase-specific `reasoningEffort` (conductor/verifier low, planner/implementer/reviewer medium)

## Acceptance criteria

- [ ] `bash scripts/setup-repo-scoping.sh /path/to/single-repo` → writes `.ignore` + `.cursorignore` with common patterns
- [ ] `bash scripts/setup-repo-scoping.sh /path/to/monorepo` → writes root ignores with subproject subtrees + per-subproject ignores
- [ ] `bash scripts/setup-repo-scoping.sh --single /path/to/monorepo` → forces single-repo mode
- [ ] `bash scripts/setup-repo-scoping.sh --monorepo /path/to/single` → forces monorepo mode
- [ ] `node -e "const p=require('./scripts/lib/opencode-token-profile.js'); console.log(p.NARROW_INSTRUCTIONS)"` → all paths root-relative, no `**/`
- [ ] `node -e "const p=require('./scripts/lib/opencode-token-profile.js'); console.log(p.filterBroadInstructions(['**/AGENTS.md','AGENTS.md']))"` → returns `['AGENTS.md']`
- [ ] `applyTokenProfile(cfg)` sets `compaction`, `tool_output`, `instructions`, `permission.skill`, `agent.reasoning`, `provider.variants`

## Done when (verifiable)

- Command: `bash scripts/setup-repo-scoping.sh /tmp/test-single && cat /tmp/test-single/.ignore` → contains `node_modules/` and no subproject entries
- Command: `bash scripts/setup-repo-scoping.sh /tmp/test-mono && cat /tmp/test-mono/.ignore` → contains subproject names under "# Heavy subproject subtrees"
- Command: `node scripts/lib/opencode-token-profile.js` (as module test) → exports all constants and functions

## Files (expected)

- `scripts/setup-repo-scoping.sh` — auto-detect + ignore generation
- `scripts/lib/opencode-token-profile.js` — token/quality profile for OpenCode
- `scripts/opencode-maintenance.sh` — DB/log/snapshot housekeeping (companion)
- `templates/AGENTS.md` — documents repo-type detection + scoping rules for new projects

## Risks

- Monorepo detection false positive if 2+ subdirs happen to have `package.json` but aren't real subprojects
- Per-subproject ignores not updated when new subprojects added (doc: re-run script)
- `opencode.json` `instructions` globs at monorepo root still match all subprojects if not scoped per-subproject (mitigated by denylist + per-subproject config guidance in ai-workflow-rules.md)
- `tool_output` caps require OpenCode ≥ 1.19.0
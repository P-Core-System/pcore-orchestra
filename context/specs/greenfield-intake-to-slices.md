# Spec: greenfield-intake-to-slices

## Goal

When a user says "let's build a note app" (or any greenfield product goal), orchestra detects the empty repo, classifies the product type, recommends a stack, emits an `init-project` scaffold instruction, then proceeds through enterprise discovery → small MVP slices → core loop per slice with phase commit gates.

## Context

- Related overview/architecture sections: `context/architecture.md` (System boundaries → `greenfield-scaffold.js`, `greenfield-intake.js`, Universal Project Identity, Phase Model enterprise SDLC), `docs/greenfield-and-gaps.md` (Intended UX, What you already have, High — product creation gaps, Anti-patterns)
- Out of scope: Interactive stack picker UI (gap), slice backlog file auto-write (gap), production checklist hard gate (gap)

## Requirements

1. `greenfield-intake.js`: `detectAppType(goal)` classifies goal into app type (notes, todo, api, saas, etc.) with stack recommendation
2. `greenfield-scaffold.js`: `shouldAutoScaffold(cwd)` returns true when cwd has no `project.yaml`/`project.json`, no `context/`, no source indicators (src/, app/, package.json, etc.)
3. `greenfield-scaffold.js`: `buildScaffoldInstruction(appType, goal)` emits bash command to run `init-project.sh` with inferred `--type` and `--name`
4. `orchestra-prompt.js` (Cursor + OpenCode): on prompt, if greenfield detected + empty cwd, inject scaffold instruction into planner context
5. Enterprise SDLC route: greenfield triggers `loopMode: enterprise` (32 phases from idea → production-release)
6. After `init-project` runs: six-file context + `project.yaml` exist → intake gathers requirements → small MVP slices
7. Each slice: core loop `plan → implement → COMMIT → verify → review` (phase commit gate enforced)
8. Loop until production checklist green (currently soft checklist in docs/production-loop.md)

## Acceptance criteria

- [ ] `shouldAutoScaffold("/empty/dir")` → `true`
- [ ] `shouldAutoScaffold("/dir/with/package.json")` → `false`
- [ ] `shouldAutoScaffold("/dir/with/context")` → `false`
- [ ] `shouldAutoScaffold("/dir/with/project.yaml")` → `false`
- [ ] `detectAppType("let's build a note app")` → `{ type: "notes", ... }`
- [ ] `detectAppType("create a REST api for payments")` → `{ type: "api", ... }`
- [ ] `buildScaffoldInstruction("notes", "build a note app")` → contains `init-project.sh --type web --name "Note App"`
- [ ] `orchestra-prompt.js` injects scaffold instruction when greenfield + empty cwd detected
- [ ] Enterprise SDLC phases available when `loopMode: enterprise`
- [ ] Phase commit gate runs between each phase (implementer commits before verifier)

## Done when (verifiable)

- Command: `node -e "const g=require('./bundle/hooks/lib/greenfield-scaffold.js'); console.log(g.shouldAutoScaffold('/tmp/empty'))"` → `true`
- Command: `mkdir -p /tmp/test-greenfield && node -e "const g=require('./bundle/hooks/lib/greenfield-scaffold.js'); console.log(g.buildScaffoldInstructionFromGoal('build a todo app'))"` → contains `init-project.sh --type`
- Command: `bash install.sh --all` → `greenfield-scaffold.js` and `greenfield-intake.js` copied to `~/.cursor/hooks/lib/`

## Files (expected)

- `bundle/hooks/lib/greenfield-intake.js` — app type detection + stack catalog
- `bundle/hooks/lib/greenfield-scaffold.js` — empty repo detection + scaffold instruction
- `bundle/hooks/orchestra-prompt.js` — prompt hook injection (Cursor)
- `bundle/opencode/hooks/orchestra-prompt.js` — prompt hook injection (OpenCode)
- `bundle/skills/greenfield-product/` — skill documentation
- `scripts/init-project.sh` / `init-project.ps1` — bootstrap project identity + six-file context
- `docs/greenfield-and-gaps.md` — gap analysis (reference)

## Risks

- Stack recommendation may not match user's actual preference (mitigated: interactive `init-project` guided setup)
- Scaffold instruction requires user to run command manually (hook-quick-exit invariant: hooks don't execute scripts)
- `SOURCE_INDICATORS` list may miss obscure project types
- Monorepo: empty subdir detection needs per-subproject cwd
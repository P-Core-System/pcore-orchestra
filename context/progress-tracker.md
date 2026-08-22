# Progress Tracker

Update this file after every meaningful implementation change.

## How to update (mandatory)

Add a new entry at the top of "Current Phase" with:
- **Date** (YYYY-MM-DD)
- **Description** of what changed
- **Key files** touched (`path/to/file`)
- **Impact**: what changed for users/agents

```markdown
- YYYY-MM-DD — Description. Files: `path/file1`, `path/file2`. Impact: what changed.
```

Also update these files if the change affects them:
- `context/architecture.md` — new hooks, modules, boundaries, invariants
- `context/project-overview.md` — new features, scope changes
- `context/code-standards.md` — new conventions, doc update protocol
- `context/ai-workflow-rules.md` — new scoping rules, workflow changes
- `README.md` — new commands, paths, install steps

**Rule:** A commit without a progress-tracker entry is incomplete.

## Current Phase

- 2026-08-22 — Cross-tool monorepo scoping: fixed OpenCode `instructions` globs (project-relative, no `**/`), expanded `watcher.ignore` (15 patterns), added `tool_output` caps (300 lines/12KB), reclaimed 6.2 GB disk (legacy snapshots + log). Created tool-agnostic scoping at `pcore/` monorepo root (`AGENTS.md`, `.ignore`, `.cursorignore`, `.gitignore`, `context/project-overview.md`) and at all 10 subprojects. New `scripts/setup-repo-scoping.sh` auto-detects single-repo vs monorepo and generates `.ignore` + `.cursorignore`. Updated `templates/AGENTS.md` with repo-type detection, `init-context.sh` to generate scoping files, `context/ai-workflow-rules.md` with repo-type scoping rules. New `scripts/opencode-maintenance.sh` for DB/log/snapshot housekeeping.
- 2026-08-22 — Full Cursor + OpenCode platform split: all 23 enterprise specialists in `bundle/agents/01-idea/` through `10-review/` now have `model:` (Cursor) + `opencode_model:` (OpenCode) frontmatter and `## Models` sections. Hard roles (architect, tech-lead, security, performance) default to `grok-4.6`; others to `composer-2.5`. OpenCode models are free only. `scripts/sync-opencode-agents.js` updated to emit `model:`; `scripts/update-free-models.sh --check` now validates OpenCode agent markdowns; `scripts/setup-cursor-model.sh` validates all Cursor agents. Fixed syntax error in `bundle/opencode/hooks/orchestra-health-opencode.js` so `install.sh --opencode` health check passes.
- 2026-08-22 — Cursor cheap/best model routing: Composer 2.5 standard as daily default, Grok 4.6 standard escalation for hard tasks, `setup-cursor-model.sh`, `bundle/agents/orchestra-*.md` frontmatter `model: composer-2.5`, updated `orchestra-loop` skill + `.mdc` rule + token/cross-platform docs.
- V3.7.3 — ox-alpha + muse-spark models, free-model preflight & fallbacks, conductor-first routing
- 2026-08-22 — OpenCode no-response fix: `fix-opencode-response.sh`; conductor uses OpenCode **task** tool (not Cursor Task); phase agents `hidden: true`; task permission `orchestra-*` only; install copies `orchestra.md`; merge patches dead models (x-preview/hy3/muse-spark); primary nemotron-3-ultra-free
- 2026-08-22 — New guidance templates: `25-design-tokens.md` (DTCG 3-tier), `26-folder-structure.md` (feature/monorepo), `27-system-design.md` (C4-lite), `AGENTS.authoring.md` (five-tool authoring). Wired into five agent tools: OpenCode global `AGENTS.md` + `opencode.json` instructions globs, repo `CLAUDE.md`, `.github/copilot-instructions.md`, and registered 25/26/27 in `project-identity.js` ARCHITECTURE_CATALOG.

## Current Goal

- Focus pcore-orchestra only; crypto-trader decommissioned on server-a (migrating to new host)

## Completed

- **V3.7.3**
  - System config: implementer model → x-preview-f-free; global model → x-preview-f-free
  - All orchestra-* agents: added `## Model` sections with primary + fallback chains
  - SKILL.md: conductor-first entry point + Models & preflight subsection
  - `scripts/update-free-models.sh` — fetch/validate free models against live API
  - Auto pool generation: `--refresh` writes `model-pools.json` (frontend/heavy/light) from live Zen catalog; `--pools` prints them; `--check` verifies configured models exist in appropriate pools (STALE-POOL warnings)
  - autonomy.json: dead deepseek-v4-flash-free refs → x-preview-f-free mapping
  - docs/opencode.json.example: model→x-preview-f-free, small_model→nemotron-3.5-lightning-free
  - setup scripts: refreshed free model IDs to live set
  - docs/token-optimization.md §6.2: updated budget row + preflight pointer
  - bundle/ORCHESTRA.md: flow diagrams → conductor-first
  - README.md: orchestra conductor row as entry point; 4 phases marked internal
  - bundle/opencode/agents/orchestra.md: copy of installed conductor
  - bundle implementation engineers: Model sections added + pool note
- **V3.7.1**
  - Vendored `ui-ux-pro-max`, `brand`, `design-system`, `ui-styling` (real assets, MIT) into Cursor + OpenCode skill trees
  - Install links UI skills into `~/.agents/skills`; `THIRD_PARTY.md` attribution
  - `templates/context/ui-context.md` Skills section + AGENTS/architecture/README notes (Python 3 optional for search.py only)
- **Ops (2026-07-23) — autonomous workflow config**
  - Local: expanded `~/.cursor/cli-config.json` allowlist; `autoAcceptWebSearch`; `webFetchDomainAllowlist: *`
  - Local: created `~/.cursor/permissions.json` (terminal/MCP allow + Auto-review steer; block force-push/secrets/prod)
  - Removed redundant `cashflow/.cursor/cli.json`; cleared stale crypto-trader repo from orchestra idle state
  - Docs: OpenCode planner/reviewer `bash: allow` (edit still deny) in example + feature docs
- **Ops (2026-07-23) — Cursor/OpenCode autonomy deep pass**
  - Research: Auto-review + `permissions.json`/`sandbox.json`; OpenCode `--auto` + granular `permission` + agent overrides
  - OpenCode agents: `bash: ask` → `bash: allow` (bundle + installed); setup-opencode-optimal aligned
  - Live `~/.config/opencode/opencode.json` merged autonomy profile; Neon token → `{env:NEON_API_KEY}`
  - `~/.cursor/sandbox.json` (shared cache + hooks/skills paths); permissions MCP/allowlist expanded
  - Doc: `docs/autonomous-workflow.md`
- **V3.7.2**
  - `bundle/config/{cursor,opencode}/` autonomy templates; `scripts/merge-autonomy-config.js`
  - `install.sh` / `install.ps1` merge CLI + permissions + sandbox (Cursor) and opencode.json autonomy (MCP preserved)
  - Docs/AGENTS/architecture/README updated; autonomy applied on every install

- V3.2 adaptive loop; V3.3 OpenCode mirrors / evidence gates / intake+verify skills / specs templates
- V3.3.1 install `lib/` replace fix; slim enterprise agents
- V3.3.2 dogfood specs, health adaptive checks, agents-skills links
- **V3.3.3**
  - Short/informal (`fix it`, `pls`, `next improve`) → core + `informal_inferred`
  - Complexity beats informal (`migrate architecture`, `security audit` → enterprise)
  - Tests: startOrchestra core→plan; docs synced (no clarify-block route)
  - Prompt hook + planner expand informal goals from progress-tracker/git
- **V3.3.4**
  - Added `docs/token-optimization.md` (8 techniques, tool-call + web-search policy, orchestra budgets)
  - Core agents + orchestra-loop skill: per-phase token efficiency rules
  - OpenCode agents/skills synced with same token guidance
- **V3.3.5**
  - `lib/token-tracker.js` — per-phase usage, rolling aggregates, auto improvement tips
  - `orchestra-tokens.json`; `orchestra-enable.js tokens` CLI
  - Session start injects token trends; history + memory include token stats
- **Ops (2026-07-22)**
  - Stopped orchestra loop (was stuck on crypto-trader goal)
  - server-a: all `crypto-trader-*` services/timers stopped, disabled, unit files removed
  - server-a: `cloudflared` stopped/disabled; `crypto-bot` CLI + `/etc/crypto-trader` removed
  - `~/crypto-trader` (584M) left on disk for migration to new server
- **V3.3.6**
  - `docs/agent-harness-recommendations.md` — Cursor/OpenCode, harness/loop/prompts, STEM, roadmap
  - `docs/opencode.json.example` — balanced orchestra profile
  - `orchestra-loop.mdc` — parent handoff template + doc links
- **V3.3.7**
  - Agent identity split → `bundle/agents/references/*-identity.md`; core agents slimmed (~28 lines each)
  - Cache-shaped `sessionStart`: static prefix (ambient + handoff + six-file) before dynamic state/memory/tokens
  - `orchestra-enable.js metrics` — combined dashboard (history, tokens, memory, observability)
  - `sync-opencode-agents.js --force-core`; OpenCode hooks/agents mirrored
- **V3.3.8**
  - `lib/orchestra-config.js` — `project.yaml` orchestra block (route, max_iterations, plan_only, token_budgets)
  - `lib/handoff-enforcer.js` — compact parent handoff in prompt + subagent-stop chain messages
  - Plan-only mode: pauses after planner; resume via `continue orchestra` / `approve plan`
  - Evidence preflight: `runEvidenceChecks` injected when advancing to verify phase
  - Dogfood `project.yaml` at repo root; template updated with `orchestra:` section
- **V3.3.9** (dogfood orchestra cycle)
  - Enterprise phase picker: `getPhasesForState()` filters SDLC by `orchestra.phases`; filtered start phase
  - `validatePhaseFilter()` — unknown ids warned in config summary
  - Evidence → quality gates: `applyEvidenceToGates` on `orchestra-verifier` complete
  - `orchestra-enable.js start` loads `project.yaml` from cwd (identity + orchestraConfig)
- **V3.4.0** (dogfood orchestra cycle)
  - `lib/workspace-identity.js` — sync project identity from workspace `project.yaml`
  - `sessionStart`: idle → full identity + orchestraConfig refresh; stale slug notice injected
  - `orchestra-prompt` + `orchestra-enable start`: use shared sync (fixes crypto-trader stale state)
  - Active run: identityFile path only (no mid-run project swap)
- **V3.5.0** (dogfood + research)
  - `lib/semantic-memory.js` — BM25-lite recall on past goals/errors (no embedding deps)
  - Goal-aware memory inject on prompt + session start; `memory recall "<query>"` CLI
  - `docs/agent-orchestra-rag-research.md` — 2026 harness/RAG/context gaps + P3–P5 roadmap
- **V3.6.0** (production loop — no-interrupt batch)
  - `lib/plan-artifact.js` — planner output → `.cursor/orchestra-plan.md` + state backup
  - `lib/cycle-report.js` — per-cycle JSON audit (`cycles` CLI); gates/tokens/phases
  - `lib/memory-index.js` — inverted index on memory flush (scales recall)
  - Handoff injects plan path; implementer/verifier/reviewer read plan file
  - `docs/production-loop.md` — production checklist per cycle
- **V3.6.1**
  - Phase commit gate: commit each loop part before next (`lib/phase-commit-gate.js`)
  - Parent/handoff/verifier enforce clean `git status` (except plan file)
  - Implementer must commit before `IMPLEMENT_DONE`; FIX_REQUIRED commits before re-verify
  - Docs commit after `ORCHESTRA_COMPLETE` if progress-tracker dirty
- **V3.7.0**
  - Greenfield intake: "build a note app" → stack recommendations + requirements gather
  - `lib/greenfield-intake.js` + skill `greenfield-product`; enterprise discovery first
  - Small-task production loop documented; `docs/greenfield-and-gaps.md` gap analysis

- **V3.7.1** (cross-platform orchestra)
  - `docs/orchestra-cross-platform.md` — Cursor Task vs OpenCode task spawn matrix
  - `bundle/hooks/lib/orchestra-spawn-matrix.js` — shared handoff/ambient text for hooks
  - Cursor conductor `bundle/agents/orchestra.md`; install copies conductor + references
  - orchestra-loop skill + mdc updated for both platforms; identity refs → spawn matrix
- **V3.7.2** (OpenCode desktop no-response)
  - `agent.orchestra.mode: primary` + `reasoningEffort: low` in autonomy merge (required for `default_agent`)
  - Health check validates conductor + `--heal` patches missing mode
  - `fix-opencode-response.sh` upgrades CLI, syncs health script, improved probe
- **V3.7.3** (OpenCode token + quality profile)
  - `scripts/lib/opencode-token-profile.js` — narrow instructions, skill deny-by-default, phase reasoning
  - Removed `**/templates/**` from instructions merge (was unioned forever, ~160k input tokens)
  - Planner/implementer `reasoningEffort: medium` for accuracy; conductor/verifier low for speed

## Next Up

1. Auto-scaffold empty cwd via init-project when greenfield + no project.yaml
2. Write `context/specs/` slice backlog from MVP intake
3. Hard production checklist gate on final review
4. P4: SQLite FTS / hybrid embeddings / worktrees

## Open Questions

- `project.yaml` vs `project.json`?

## Architecture Decisions

- Install replaces directory trees; never nest `lib/lib`
- Core ambient default; enterprise opt-in
- Short/informal → infer from context (do not clarify-block)
- Evidence gates on final review only

## 2026-08-22 — Concurrent session tracking
- New `scripts/session-claims.sh`: per-repo claim registry (.pcore/session-claims.json) — claim/renew/release/list/check/gc; stale-after-30min auto-expiry; identity via PCORE_SESSION_ID → tool session envs → pid.
- Wired into: templates/context/ai-workflow-rules.md, both orchestra-loop skills (opencode + cursor), conductor agent (bundle/opencode/agents/orchestra.md).
- Docs: docs/concurrency-tracking.md.
- Motivation: two live sessions collided in pcore-monitor (Go scaffold committed over a Python-frozen stack mid-docs-work).

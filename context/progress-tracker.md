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
- 2026-09-22 — Docs fix: aligned `--apply` self-heal wording to actual behavior (fetches first if cache missing/empty; aborts only if fetch fails with no cache) across `scripts/update-free-models.sh` header comment, `context/specs/model-routing-per-platform.md` (req 3, acceptance, risk), and stale parenthetical in prior progress entry. Flipped all 8 verified acceptance checkboxes to `- [x]`. Docs/comment-only — no shell logic changes. Files: `scripts/update-free-models.sh`, `context/specs/model-routing-per-platform.md`, `context/progress-tracker.md`. Impact: docs match real `--apply` self-heal behavior; spec acceptance boxes reflect verified state.
- 2026-09-22 — Weekly OpenCode free-model refresh + dynamic model assignment: `scripts/update-free-models.sh` gained `--apply` (picks primary = light free-pool head + heavy fallback from `state/free-models.json` + `model-pools.json`, no hardcoded IDs; atomically rewrites `bundle/config/opencode/autonomy.json`, `docs/opencode.json.example`, installed free-tier `opencode/*` refs, and agent frontmatter `model:` lines; aborts only if fetch fails with no cache) and `--schedule` (systemd user timer `scripts/systemd/pcore-free-models.{service,timer}` with `OnCalendar=weekly` + `@REPO_ROOT@` substitution; cron fallback Mon 04:17). `scripts/merge-autonomy-config.js` now prefers cache-backed replacements (free-tier models absent from live cache → cache primary/heavy; static deny-list only when cache absent; custom/paid models untouched). `install.sh` / `install.ps1` OpenCode path runs `--refresh --apply` once then installs the schedule (non-fatal offline; schtasks on Windows). Fixed stale hardcoded free-model IDs across `scripts/setup-opencode-proxy.sh`, `scripts/fix-opencode-response.sh`, both `orchestra-loop` SKILL.md tables, `docs/orchestra-cross-platform.md`, README, and `context/specs/model-routing-per-platform.md` → dynamic pool references. Files: `scripts/update-free-models.sh`, `scripts/systemd/pcore-free-models.{service,timer}`, `scripts/merge-autonomy-config.js`, `install.sh`, `install.ps1`, `bundle/config/opencode/autonomy.json`, `docs/opencode.json.example`, `bundle/opencode/agents/**`, docs/context sync. Impact: free-model IDs auto-refresh weekly; installs no longer pin stale region-blocked models; first-run offline degrades gracefully (warn + keep existing IDs).

- 2026-09-15 — Dynamic step allocation system: replaced fixed per-phase step limits with a conductor-managed dynamic allocation. Formula: base × complexity_multiplier (files × 0.05 + components × 0.1), capped at 80% of remaining. Phase weights: core loop (plan 15%, implement 40%, verify 20%, review 10%, reserve 15%) and full delivery (plan 10%, product/ux 10%, arch 10%, execute 35%, verify 15%, uat 10%, reserve 10%). All 4 subagents (planner 300→500, implementer 400→500, verifier 200→500, reviewer 150→500) now receive step budgets in task prompts and adapt behavior. Conductor tracks allocations in orchestra-state.json. Files: `bundle/opencode/agents/orchestra.md`, `bundle/opencode/agents/orchestra-{planner,implementer,verifier,reviewer}.md`. Impact: orchestrations no longer waste steps on trivial tasks or stall on complex ones — budget scales with plan complexity.

- 2026-09-14 — Agent step limits increased + merge-safe install: conductor=500, implementer=400, planner=300, general=300, verifier=200, reviewer=150, explore=100. Fixed mergeOrchestraAgents() in scripts/merge-autonomy-config.js to preserve higher user step counts via Math.max(bundleSteps, userSteps) instead of full overwrite. Added general and explore agents to bundle config. Files: undle/config/opencode/autonomy.json, scripts/merge-autonomy-config.js. Impact: orchestra agents no longer hit max steps during complex multi-file tasks; install merge no longer resets user-customized step limits.

- 2026-09-04 — Free-model audit + server sync: live probes (local + sg-ec2) showed only mimo-v2.6-flash-free, big-pickle, laguna-s-2.1-free work on sg-ec2 (Myanmar-local); local also works with ling-3.0-flash-fin-free. Fixed `scripts/merge-autonomy-config.js` DEAD_OR_UNRELIABLE_MODELS: removed erroneous mimo-v2.6-flash-free entry (was the only working model — circular replacement) and expanded to 11 verified-bad free models (x-preview-f-free, hy3-free, muse-spark-1.2/1.3-contributor-free, laguna-s-2.1-free, deepseek-v4-flash-free, nemotron-3-ultra-free, nemotron-3.5-lightning-free, north-mini-code-free, ling-3.0-flash-free). RELIABLE_HEAVY→ling-3.0-flash-fin-free, RELIABLE_LIGHT→mimo-v2.6-flash-free. autonomy.json: added missing general+explore agents, all agents default to mimo-v2.6-flash-free (universal), provider variants cleaned. Removed dead hy3-free/kimi-k2.5-free/big-pickle fallback refs from 4 orchestra agent markdowns + both orchestra-loop SKILL.md tables. Files: `scripts/merge-autonomy-config.js`, `bundle/config/opencode/autonomy.json`, `bundle/opencode/agents/orchestra-{planner,implementer,verifier,reviewer}.md`, `bundle/opencode/skills/orchestra-loop/SKILL.md`, `bundle/skills/orchestra-loop/SKILL.md`. Impact: config merge no longer flags working default as dead; region-blocked/stale models removed; fresh installs default to verified-working free models. Local reinstalled; sg-ec2 + awsserver opencode upgraded (1.18.26/1.18.18 → 1.18.27) and configs patched.


- 2026-08-24 — Health-check path resolution fix: both health checks now locate the source repo via `findRepoRoot()` (PCORE_ORCHESTRA_REPO env → sentinel walk up from `__dirname` max 4 levels → cwd fallback), replacing broken relative/hardcoded paths (`~/Documents/Project/pcore/...`) for `session-claims.sh`, `templates/project.yaml`, sanitizer, and HEAL bundle candidates. Missing session-claims/templates now print INFO instead of failing; OpenCode `state/orchestra.json` absent is INFO ("created on first orchestration run") instead of ok=false. Files: `bundle/hooks/orchestra-health.js`, `bundle/opencode/hooks/orchestra-health-opencode.js`, `context/progress-tracker.md`. Impact: health checks no longer report false failures on fresh installs or non-default clone locations; env var override enables checks from anywhere.
- 2026-08-24 — UTF-8 BOM fix for Windows PowerShell 5.1 parsing: `install.ps1` failed with ParserError ("string is missing the terminator") because BOM-less UTF-8 was read as ANSI, corrupting `→` characters into quote-like bytes. Re-saved as UTF-8 with BOM (encoding only, no content change): `install.ps1`, `scripts/init-project.ps1`, `scripts/ensure-opencode-latest.ps1`. Also fixed a latent PS 5.1 parse bug in `scripts/init-project.ps1` (`$msg:` inside strings → `${msg}`). All 4 repo .ps1 files now pass `Parser::ParseFile`. Files: `install.ps1`, `scripts/init-project.ps1`, `scripts/ensure-opencode-latest.ps1`, `context/progress-tracker.md`. Impact: `powershell -File install.ps1` works on PS 5.1 machines without pwsh.
- 2026-08-24 — Performance-engineering skill: added "AI Performance Engineer — Master Prompt" as a new skill, mirrored identically for Cursor + OpenCode. Full 20-section master prompt (measure → diagnose → optimize → verify) copied verbatim with YAML frontmatter (`name: performance-engineering`). Install already copies arbitrary `bundle/skills/*/` and `bundle/opencode/skills/*/` dirs — no install.sh change needed. Files: `bundle/skills/performance-engineering/SKILL.md`, `bundle/opencode/skills/performance-engineering/SKILL.md`, `context/architecture.md`, `context/progress-tracker.md`. Impact: agents can invoke evidence-based performance investigation methodology on slow-app/latency/memory problems instead of guessing optimizations.
- 2026-08-22 — Specs slice backlog: created 9 unit-spec files in `context/specs/` grounded in existing docs (methodology Part 3). 4 new: `model-routing-per-platform.md` (Cursor composer-2.5/grok-4.6 + OpenCode free-model policy), `phase-commit-gate-workflow.md` (git commit gate between every phase), `enterprise-orchestra-switch.md` (core 4-phase vs enterprise 32-phase SDLC opt-in + phase filter), `session-isolation-multi-user.md` (session-namespaced state managers across 6 files). 5 pre-existing: `context-sixfile-detection.md`, `distribution-install-workflow.md`, `cross-tool-repo-scoping.md`, `greenfield-intake-to-slices.md`, `quality-evidence-gates.md`. All follow `_unit-spec.template.md` sections (Goal, Context, Requirements, Acceptance criteria, Done when, Files, Risks). Files: `context/specs/model-routing-per-platform.md`, `context/specs/phase-commit-gate-workflow.md`, `context/specs/enterprise-orchestra-switch.md`, `context/specs/session-isolation-multi-user.md`, `context/specs/context-sixfile-detection.md`, `context/specs/distribution-install-workflow.md`, `context/specs/cross-tool-repo-scoping.md`, `context/specs/greenfield-intake-to-slices.md`, `context/specs/quality-evidence-gates.md`, `context/progress-tracker.md`. Impact: planner/implementer/verifier/reviewer now have verifiable unit specs for all core orchestra behaviors — enables spec-driven cycles and evidence-based verification.
- 2026-08-22 — Greenfield auto-scaffold: new `bundle/hooks/lib/greenfield-scaffold.js` with `shouldAutoScaffold(cwd)` + `buildScaffoldInstruction()`; wired into `orchestra-prompt.js` (Cursor + OpenCode) to emit init-project instruction when greenfield prompt + empty cwd (no project.yaml, no context/, no source dirs). Files: `bundle/hooks/lib/greenfield-scaffold.js`, `bundle/opencode/hooks/lib/greenfield-scaffold.js`, `bundle/hooks/orchestra-prompt.js`, `bundle/opencode/hooks/orchestra-prompt.js`, `bundle/hooks/orchestra-health.js`, `bundle/opencode/hooks/orchestra-health.js`, `context/architecture.md`, `docs/greenfield-and-gaps.md`. Impact: fresh repos with "build a X app" prompts now auto-suggest `init-project` command with inferred project type/name — no manual scaffold step needed.
- 2026-08-22 — Fix OpenCode config instruction globs: replaced `**/` prefixes with root-relative paths (`AGENTS.md`, `CLAUDE.md`, `context/*.md`) in installed config, template, and token profile; expanded `watcher.ignore` with 15 monorepo patterns; added `BROAD_INSTRUCTION_GLOBS` denylist for legacy globs. Files: `~/.config/opencode/opencode.json`, `docs/opencode.json.example`, `scripts/lib/opencode-token-profile.js`. Impact: agents no longer scan entire monorepo on trivial prompts — instructions are project-scoped, watcher ignores build/vendor/cache dirs across subprojects.
- 2026-08-22 — Monorepo perf audit: verified `BROAD_INSTRUCTION_GLOBS` denylist semantics in `scripts/lib/opencode-token-profile.js` — `filterBroadInstructions()` correctly strips `**/**`, `**/templates/**`, `**/context/**`. Added monorepo instruction-glob scoping guidance to `context/ai-workflow-rules.md` and `templates/context/ai-workflow-rules.md`: recommends per-subproject `opencode.json` `instructions` to avoid root-level `**/AGENTS.md` matching hundreds of subprojects; notes watcher.ignore + tool_output caps already bound memory. Files: `context/ai-workflow-rules.md`, `templates/context/ai-workflow-rules.md`. Impact: monorepo users get clear guidance on avoiding token inflation from broad instruction globs.
- 2026-08-22 — OpenCode multi-session isolation: all 6 state managers (state, memory, tokens, project, daily, version) session-namespaced via getSessionId() env chain (PCORE_SESSION_ID → OPENCODE_SESSION_ID → CLAUDE_SESSION_ID → CURSOR_TRACE_ID → pid), legacy flat migration, atomic writes + retry for daily/version; opencode lib mirrors synced. Files: bundle/hooks/lib/*.js, bundle/opencode/hooks/lib/*.js. Impact: parallel OpenCode sessions get isolated state — no cross-session contamination or lock contention.
- 2026-08-22 — Added GitHub Copilot instructions model routing: updated `.github/copilot-instructions.md` with Cursor `composer-2.5` / `grok-4.6` escalation and OpenCode free-model policy, plus helper commands. Impact: Copilot in this repo gets the same model-routing guidance as the orchestra agents.
- 2026-08-22 — README + docs sync for Cursor/OpenCode model routing: updated `README.md` feature table, token optimization table, and bypass limits; updated `docs/01-OVERVIEW-AND-ARCHITECTURE.md`, `docs/02-FEATURES-HOOKS-COMPONENTS-AGENTS.md`, and `docs/agent-harness-recommendations.md` to document platform-aware model routing. Impact: users see the cheap default Cursor model (`composer-2.5`) and OpenCode free model policy directly in the README and architecture docs.
- 2026-08-22 — Device install + DB cleanup + bug fix: ran `install.sh` on local device (Cursor + OpenCode + repo scoping all installed). Truncated 6.6 GB `event` table in `opencode.db`, deleted 1,005 stale sessions, VACUUM'd DB from 8.0 GB → 438 MB. Total opencode data dir: 15 GB → 1.2 GB (13.8 GB reclaimed). Fixed `DEFAULT_STATE` → `DEFAULT_SESSION_STATE` bug in `bundle/hooks/lib/state-manager.js` (was causing `ReferenceError` on Cursor health check). Updated `install.sh` + `install.ps1` to auto-install repo scoping (`setup-repo-scoping.sh`, `opencode-maintenance.sh`, global gitignore) on any device. Bootstrapped AGENTS.md + 6-file context + `.ignore` + `.cursorignore` on all 20 local projects. Files: `bundle/hooks/lib/state-manager.js`, `install.sh`, `install.ps1`, `scripts/setup-repo-scoping.sh`, `scripts/opencode-maintenance.sh`. Impact: any device running `install.sh` gets cross-tool scoping automatically; Cursor health check passes; DB is clean and fast.
- 2026-08-22 — Doc-update protocol: added mandatory doc-sync rules to all 6 context files. `code-standards.md` has a change-type → file-to-update table + pre-commit checklist. `ai-workflow-rules.md` has explicit doc-sync table. `architecture.md` added repo scoping to stack table. `project-overview.md` added cross-tool scoping as a feature. `progress-tracker.md` has "How to update" section. `templates/context/ai-workflow-rules.md` mirrors protocol for new projects. Impact: any agent or human now has enforceable rules for keeping docs in sync with code.
- 2026-08-22 — Cross-tool monorepo scoping: fixed OpenCode `instructions` globs (project-relative, no `**/`), expanded `watcher.ignore` (15 patterns), added `tool_output` caps (300 lines/12KB), reclaimed 6.2 GB disk (legacy snapshots + log). Created tool-agnostic scoping at `pcore/` monorepo root (`AGENTS.md`, `.ignore`, `.cursorignore`, `.gitignore`, `context/project-overview.md`) and at all 10 subprojects. New `scripts/setup-repo-scoping.sh` auto-detects single-repo vs monorepo and generates `.ignore` + `.cursorignore`. Updated `templates/AGENTS.md` with repo-type detection, `init-context.sh` to generate scoping files, `context/ai-workflow-rules.md` with repo-type scoping rules. New `scripts/opencode-maintenance.sh` for DB/log/snapshot housekeeping.
- 2026-08-22 — Full Cursor + OpenCode platform split: all 23 enterprise specialists in `bundle/agents/01-idea/` through `10-review/` now have `model:` (Cursor) + `opencode_model:` (OpenCode) frontmatter and `## Models` sections. Hard roles (architect, tech-lead, security, performance) default to `grok-4.6`; others to `composer-2.5`. OpenCode models are free only. `scripts/sync-opencode-agents.js` updated to emit `model:`; `scripts/update-free-models.sh --check` now validates OpenCode agent markdowns; `scripts/setup-cursor-model.sh` validates all Cursor agents. Fixed syntax error in `bundle/opencode/hooks/orchestra-health-opencode.js` so `install.sh --opencode` health check passes.
- 2026-08-22 — Cursor cheap/best model routing: Composer 2.5 standard as daily default, Grok 4.6 standard escalation for hard tasks, `setup-cursor-model.sh`, `bundle/agents/orchestra-*.md` frontmatter `model: composer-2.5`, updated `orchestra-loop` skill + `.mdc` rule + token/cross-platform docs.
- V3.7.3 — ox-alpha + muse-spark models, free-model preflight & fallbacks, conductor-first routing
- 2026-08-22 — OpenCode no-response fix: `fix-opencode-response.sh`; conductor uses OpenCode **task** tool (not Cursor Task); phase agents `hidden: true`; task permission `orchestra-*` only; install copies `orchestra.md`; merge patches dead models (x-preview/hy3/muse-spark); primary mimo-v2.6-flash-free
- 2026-08-22 — New guidance templates: `25-design-tokens.md` (DTCG 3-tier), `26-folder-structure.md` (feature/monorepo), `27-system-design.md` (C4-lite), `AGENTS.authoring.md` (five-tool authoring). Wired into five agent tools: OpenCode global `AGENTS.md` + `opencode.json` instructions globs, repo `CLAUDE.md`, `.github/copilot-instructions.md`, and registered 25/26/27 in `project-identity.js` ARCHITECTURE_CATALOG.

## Current Goal

- Focus pcore-orchestra only; crypto-trader decommissioned on awsserver (migrating to new host)

## Completed

- **Dead model x-preview-f-free replaced (2026-08-27)**: all hardcoded x-preview-f-free references replaced with mimo-v2.6-flash-free (works globally without VPN). Subagents no longer hardcode model: in frontmatter � they inherit from global model/small_model config. muse-spark-1.2-contributor-free only documented as region-blocked option. autonomy.json cleaned (no per-agent model overrides, duplicate entries removed, trailing comma fixed). 4 commits pushed to origin/main (59bdb7a, 59c9986, 9c3075f, 4655e93). Local install completed � opencode.json has model: mimo-v2.6-flash-free, conductor explicit, 4 subagents inherited.
- **V3.7.3**
  - System config: implementer model → mimo-v2.6-flash-free; global model → mimo-v2.6-flash-free
  - All orchestra-* agents: added `## Model` sections with primary + fallback chains
  - SKILL.md: conductor-first entry point + Models & preflight subsection
  - `scripts/update-free-models.sh` — fetch/validate free models against live API
  - Auto pool generation: `--refresh` writes `model-pools.json` (frontend/heavy/light) from live Zen catalog; `--pools` prints them; `--check` verifies configured models exist in appropriate pools (STALE-POOL warnings)
  - autonomy.json: dead deepseek-v4-flash-free refs → mimo-v2.6-flash-free mapping
  - docs/opencode.json.example: model→mimo-v2.6-flash-free, small_model→mimo-v2.6-flash-free
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
  - awsserver: all `crypto-trader-*` services/timers stopped, disabled, unit files removed
  - awsserver: `cloudflared` stopped/disabled; `crypto-bot` CLI + `/etc/crypto-trader` removed
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

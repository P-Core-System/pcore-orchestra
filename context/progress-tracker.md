# Progress Tracker

Update this file after every meaningful implementation change.

## Current Phase

- V3.7.1 — vendored UI/UX Pro Max core skills + install/docs wiring

## Current Goal

- Focus pcore-orchestra only; crypto-trader decommissioned on server-a (migrating to new host)

## Completed

- **V3.7.1**
  - Vendored `ui-ux-pro-max`, `brand`, `design-system`, `ui-styling` (real assets, MIT) into Cursor + OpenCode skill trees
  - Install links UI skills into `~/.agents/skills`; `THIRD_PARTY.md` attribution
  - `templates/context/ui-context.md` Skills section + AGENTS/architecture/README notes (Python 3 optional for search.py only)
- **Ops (2026-07-23) — autonomous workflow config**
  - Local: expanded `~/.cursor/cli-config.json` allowlist; `autoAcceptWebSearch`; `webFetchDomainAllowlist: *`
  - Local: created `~/.cursor/permissions.json` (terminal/MCP allow + Auto-review steer; block force-push/secrets/prod)
  - Removed redundant `cashflow/.cursor/cli.json`; cleared stale crypto-trader repo from orchestra idle state
  - Docs: OpenCode planner/reviewer `bash: allow` (edit still deny) in example + feature docs

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

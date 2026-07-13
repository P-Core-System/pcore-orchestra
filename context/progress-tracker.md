# Progress Tracker

Update this file after every meaningful implementation change.

## Current Phase

- Feature completion + git/review/workflow enhancements

## Current Goal

- Complete remaining enhancements: git commit workflow, self-review checklists, error-free rules, orchestration history, abort mechanism

## Completed

- Standalone repo (cursor-orchestra)
- Six-File Context templates + `init-context` scripts
- Hook/agent enhancements for context injection
- Global `~/.cursor/` install refreshed on dev machine
- crypto-trader docs point to standalone repo
- Git: `main` with 2 commits locally
- Harness > Scaffold > Loop architecture documentation
- Bypass limit strategies: `docs/bypass-strategies.md` (Cursor BYOK + OpenCode free models)
- Cursor BYOK setup script: `scripts/setup-cursor-byok.sh` (--check, --litellm, interactive)
- OpenCode proxy setup script: `scripts/setup-opencode-proxy.sh` (--free, --multi-key, --restore)
- OpenCode skill updated with model routing section
- README updated with Bypass Limits section + repo layout
- Token optimization guide: `docs/token-optimization.md` (compaction, model routing, variants, step limits)
- Optimized config generator: `scripts/setup-opencode-optimal.sh` (--budget, --balanced, --premium)
- OpenCode agents updated: steps limits (planner:8, implementer:25, verifier:10, reviewer:5), token-efficient prompts
- OpenCode skill updated with comprehensive token optimization section
- README updated with Token Optimization section + updated repo layout
- **V2 State Model** — lifecycle, heartbeat, memory, resumable sections with deep merge migration
- **Lifecycle Events** — `orchestra-lifecycle.js` records phase transitions, errors, completions
- **Heartbeat** — `orchestra-heartbeat.js` detects stalls (5min threshold), auto-aborts after 2 stalls
- **Memory System** — short-term (per-run) + long-term (`orchestra-memory.json`, persistent, capped at 100 goals)
- **Resumable Tasks** — crash recovery via `sessionStart`, manual pause/resume CLI, checkpoints
- **Health Check** — extended to verify all new systems (9 scripts, hooks.json entries, state version, memory)
- **Agent Definitions** — memory-aware planner, implementer memory updates, reviewer lessons
- **Documentation** — ORCHESTRA.md, skills, architecture.md all updated with new features
- **Code Review Fixes** — C1-C3 critical bugs, I1-I6 important issues all resolved
- **ReAct pattern in agents** — planner reflection, implementer reason-act-observe-reflect loop, verifier risk-first reasoning
- **Orchestration patterns doc** — `docs/orchestration-patterns.md` documenting patterns used and rationale
- **Git commit workflow** — implementer commits, planner includes strategy, verifier checks clean tree, reviewer reviews diff
- **Self-review checklists** — all 4 subagents have mandatory self-review steps
- **Error-free rules** — zero-tolerance rules for syntax, secrets, debug code, skipped tests, false verdicts
- **Orchestration history** — `orchestra-history.json` tracks past runs (50 max) with outcomes, durations, files
- **Abort mechanism** — `abort [reason]` command saves checkpoint and records history entry
- **SMART & SWOT audit** — `docs/audit-smart-swot.md` with gap analysis and recommendations
- **Loop contract** — skill now defines goal, scope, verifier, budget, escalation before starting
- **Convergence criteria** — tests pass, diff empty, lint clean, judge passes (exit conditions)
- **Stall detection in agents** — verifier detects identical failures, suggests strategy change, escalates after 3rd
- **Human checkpoints** — reviewer triggers for auth/payments/security/scope-creep/budget-exhaustion
- **Token budgets per agent** — planner:10k, implementer:30k, verifier:15k, reviewer:8k (63k max/cycle)
- **Code quality standards** — clean code checklist, single responsibility, early returns, descriptive names
- **Setup skill** — `bundle/opencode/skills/setup/SKILL.md` for new machine/new project setup
- **Setup guide** — `docs/setup-guide.md` with complete setup instructions
- **Doc metadata** — YAML metadata (title, description, tags, related) on all docs
- **Doc TL;DR summaries** — quick reference at top of each doc
- **README improvements** — badges, requirements, uninstall, contributing, project status

## In Progress

- Updating OpenCode skill with git/review/workflow rules
- Updating `bundle/rules/orchestra-loop.mdc` with git workflow and quality gates

## Next Up

1. Re-auth GitHub CLI, then push
2. Optional: `git tag v1.0.0 && git push origin v1.0.0`
3. Optional: add `context/specs/` template (methodology Part 3 — unit spec files)
4. Consider adding Cursor-specific best practices to skill (plan mode integration, background agents, .cursorrules template)
5. Consider adding RAG capabilities or guidance for codebase indexing

## Open Questions

- Whether to add `context/specs/` template for unit spec files (methodology Part 3)

## Architecture Decisions

- V2 state model with deep merge for backward compatibility
- Lifecycle events capped at 200 entries, long-term memory capped at 100 goals/50 files/50 errors
- Heartbeat stall threshold default: 5 minutes, auto-abort after 2 consecutive stalls
- Memory injection at orchestration start (prompt.js) and session start
- Crash recovery: detect stale active state, offer resume via "resume orchestra" prompt
- Standalone repo name: `cursor-orchestra`
- crypto-trader keeps `.cursor/` project bridge + filled `context/` (orchestra auto-injects)
- **Prompt Chaining + ReAct**: sequential pipeline with reasoning inside each agent (simplicity + adaptability)
- **Flat agent structure**: no hierarchical delegation — each agent has one clear job
- **Git workflow**: only implementer commits, others are read-only
- **Orchestration history**: capped at 50 runs, tracks outcomes/durations/files/errors
- **Operator Loop Stack**: harness → contract → state → checker → human checkpoint (Jack Njoroge pattern)
- **Convergence criteria**: tests pass > diff empty > lint clean > judge passes (strongest first)
- **Stall detection**: identical failure feedback 2x → try different strategy → 3rd → escalate to human
- **Human checkpoints**: auth/payments/security/scope-creep/budget-exhaustion require human review
- **Token budgets**: planner:10k, implementer:30k, verifier:15k, reviewer:8k (63k max per cycle)

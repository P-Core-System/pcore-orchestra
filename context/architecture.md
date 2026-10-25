# Architecture

## Stack

| Layer | Technology | Role |
|-------|------------|------|
| IDE integration | Cursor hooks API | `sessionStart`, `beforeSubmitPrompt`, `subagentStop`, `stop` |
| Hook runtime | Node.js 18+ | Cross-platform hook scripts |
| Agent definitions | Markdown frontmatter | `~/.cursor/agents/orchestra-*.md` |
| Persistent state | JSON file | `~/.cursor/hooks/state/orchestra.json` |
| Project context | Markdown six files | `context/*.md` in target repos |
| Install | Bash + PowerShell | `install.sh`, `install.ps1`, `scripts/init-context.*`, `scripts/merge-autonomy-config.js` |
| Free-model ops | Bash + systemd/cron | `scripts/update-free-models.sh` (`--refresh`/`--apply`/`--check`/`--schedule`), `scripts/systemd/pcore-free-models.{service,timer}` (weekly OnCalendar; cron fallback) |
| Repo scoping | `.ignore` + `.cursorignore` + `.gitignore` | Cross-tool ignore files prevent scanning `node_modules/`, `vendor/`, `venv/`, caches |
| Harness observability | Node.js + JSON | `bundle/hooks/lib/harness-observability.js` — fail-open input/spawn/permission event log (`input.received`, `input.classified`, `spawn.attempted`, `spawn.result`, `permission.denied`), ring-capped `harness-observability.json`, `PCORE_STATE_DIR`-aware; byte-identical Cursor/OpenCode mirrors (invariant 18) |
| Scoping scripts | Bash | `scripts/setup-repo-scoping.sh` (auto-detect single vs monorepo), `scripts/opencode-maintenance.sh` (DB/log housekeeping) |

## System boundaries

| Path | Owns |
|------|------|
| `bundle/hooks/orchestra-*.js` | Individual hook handlers |
| `bundle/hooks/lib/constants.js` | Named constants (no magic numbers) |
| `bundle/hooks/lib/io.js` | stdin/stdout helpers (`readStdinJson`, `emit`) |
| `bundle/hooks/lib/state-manager.js` | State CRUD (`loadState`, `saveState`, `startOrchestra`) |
| `bundle/hooks/lib/conductor-state.js` | Per-run conductor state (atomic, isolation-keyed by workspace+session+task) + registry + CLI |
| `bundle/hooks/lib/prompt-classifier.js` | Prompt extraction and classification |
| `bundle/hooks/lib/phase-engine.js` | Phase chain definition and transitions |
| `bundle/hooks/lib/lifecycle-recorder.js` | Lifecycle events and phase timers |
| `bundle/hooks/lib/heartbeat-monitor.js` | Stall detection and heartbeat |
| `bundle/hooks/lib/memory-manager.js` | Short-term and long-term memory |
| `bundle/hooks/lib/history-recorder.js` | Orchestration run history |
| `bundle/hooks/lib/checkpoint-manager.js` | Resumable tasks and crash recovery |
| `bundle/hooks/lib/context-detector.js` | Six-file workspace context detection |
| `bundle/hooks/lib/greenfield-scaffold.js` | Greenfield auto-scaffold (empty repo → init-project instruction) |
| `bundle/hooks/lib/version-manager.js` | Semver, changelog, release automation |
| `scripts/studio-service.sh`       | Studio v2 service manager (systemd/launchd/nohup)           |
| `bundle/hooks/lib/evidence-runner.js` | Command-evidence checks for quality gates |
| `bundle/hooks/lib/domain/constants.js` | Domain vocabulary: TICKET_STATES (10), additive-only ALLOWED_TRANSITIONS, SESSION_STATES/ACTIONS, DOMAIN_EVENT_TYPES (incl. `phase.outcome`), DOMAIN_EVENT_CAP |
| `bundle/hooks/lib/domain/entities.js` | 11 entity factories (`createTicket/Plan/Task/Session/AgentRun/Event/Evidence/Verification/Review/Checkpoint/MemoryRef`) + `validateEntity` + `appendRing` |
| `bundle/hooks/lib/domain/state-machine.js` | Explicit ticket/session transitions: `canTransition`, `transition` (invalid → `{ok:false, code:"invalid_transition"}`, input never mutated), `reopen` (only COMPLETED→IN_PROGRESS path), `sessionTransition` (terminal rejection) |
| `bundle/hooks/lib/domain/completion.js` | Claimed-vs-verified gate: `claimDone`, `startVerification`/`recordVerification` (records commit+diffHash), `evaluateCompletion` → `{complete, reasons[], checks}`, `applyCompletion` |
| `bundle/hooks/lib/domain/store.js` | safe-write-only JSON store: `appendEvent` (withLock + readJsonSafe + ring cap + writeJson), `loadEvents` (corrupt → `.corrupt-<ts>` quarantine + defaults), `saveCheckpoint`/`loadCheckpoint` (session-filtered) |
| `bundle/hooks/lib/domain/index.js` | Domain barrel + `recordPhaseOutcome(state, outcome, subagentType)` → `phase.outcome` event |
| `bundle/opencode/hooks/lib/domain/` | Byte-identical mirror of all six domain modules |
| `bundle/agents/` | Subagent prompts (divided by phase category) |
| `bundle/agents/01-idea/` | Idea → Analysis agents |
| `bundle/agents/02-requirements/` | Requirements agents |
| `bundle/agents/03-architecture/` | Architecture agents |
| `bundle/agents/04-planning/` | Sprint/Task planning agents |
| `bundle/agents/05-implementation/` | Implementation agents |
| `bundle/agents/06-testing/` | Testing agents |
| `bundle/agents/07-security/` | Security agents |
| `bundle/agents/08-deployment/` | DevOps/Deployment agents |
| `bundle/agents/09-observability/` | Observability agents |
| `bundle/agents/10-review/` | Review agents |
| `bundle/rules/orchestra-loop.mdc` | Always-on agent policy |
| `bundle/skills/orchestra-loop/` | Skill documentation |
| `bundle/skills/prompt-intake/` | Vague-goal intake before planning |
| `bundle/skills/verification-before-completion/` | Evidence-required verification |
| `bundle/skills/performance-engineering/` | Evidence-based performance investigation master prompt (measure → diagnose → optimize → verify) |
| `bundle/skills/{ui-ux-pro-max,brand,design-system,ui-styling}/` | Vendored UI skills (real assets; MIT — see `THIRD_PARTY.md`) |
| `bundle/config/cursor/` | CLI autonomy patch + `permissions.json` + `sandbox.json` |
| `bundle/config/opencode/autonomy.json` | OpenCode native-V2 profile — `agents` / `permissions[]` / `providers` (install merges via `scripts/lib/opencode-v2.js`; preserves `mcp`; legacy V1 configs are migrated in place) |
| `scripts/merge-autonomy-config.js` | Install-time merge for Cursor + OpenCode autonomy (cache-backed free-model replacement; static deny-list offline fallback) |
| `scripts/update-free-models.sh` | Free-model catalog ops: `--refresh` (fetch+generate pools), `--check` (DEAD/UNREACHABLE/STALE validation), `--apply` (global model only — primary = highest-stability probe-reachable free model via `KNOWN_FREE` + probes; strips agent frontmatter hardcodes in **bundle + installed** `~/.config/opencode/agents` for inherit), `--pools`, `--probe` (persist reachability/stability to probes.json), `--schedule` (weekly timer/cron) |
| `scripts/systemd/pcore-free-models.{service,timer}` | Weekly user timer (`OnCalendar=weekly`) invoking `--refresh --apply`; unit template uses `@REPO_ROOT@` substituted by `--schedule`; cron fallback when systemd missing |
| `bundle/opencode/agents/` | OpenCode mirrors (core + enterprise) |
| `bundle/qoder/agents/` | Qoder CLI conversions (all 160 agents; generated by `scripts/sync-qoder-agents.js` from `bundle/agents/` — `--check` enforced in CI) |
| `templates/context/specs/` | Unit spec blanks (methodology Part 3) |
| `project-bridge/` | Repo-local delegation only — no duplicate logic |
| `templates/context/` | Blank templates — never installed to `~/.cursor/` |
| `context/` | This repo's own six-file context (dogfooding) |

## Storage model

| Data | Location | Notes |
|------|----------|-------|
| Orchestra state | `~/.cursor/hooks/state/orchestra.json` | V3: full SDLC state, project management, versioning; session-namespaced keyed by session ID with `migrateToSessions()` |
| Conductor runs | `~/.config/opencode/hooks/state/conductor-runs/<ws>/<sid>/<tid>.json` | One atomic JSON per orchestra run; keyed by workspace (slug) + session + 12-hex task id (`conductor-state.js`) |
| Conductor run index | `~/.config/opencode/hooks/state/conductor-runs/index.json` | `{ version, updated_at, runs: { "<ws>/<sid>/<tid>": {...} } }` registry of live sessions/tasks for `who`/`resume`/stall detection |
| Long-term memory | `~/.cursor/hooks/state/orchestra-memory.json` | Persistent across sessions, capped at 100 goals |
| Studio service PID/port/log | `~/.local/state/orchestra-studio/` + `~/.local/log/orchestra-studio/` | Managed by studio-service.sh |
| Token usage | `~/.cursor/hooks/state/orchestra-tokens.json` | Per-run estimates, aggregates, improvement tips |
| Plan artifact | `<project>/.cursor/orchestra-plan.md` | Approved plan for implement→verify→review (gitignored) |
| Agent registry | `bundle/agent-registry.json` | Generated SSOT (160 agent files, 27 hook agents, 160/side coverage) — also regenerates the conductor `permission.task` allowlist; `--check` gate in CI |
| Domain events | `<state>/domain-events.json` (`bundle/hooks/state/` in-repo, `PCORE_STATE_DIR` redirect in tests/CI) | Ring-capped domain event log (`DOMAIN_EVENT_CAP` = 500, oldest trimmed) — written **only** by `domain/store.js` via safe-write; every subagent stop appends a `phase.outcome` |
| Domain checkpoint | `<state>/domain-checkpoint.json` | Resume checkpoint (Scenario J domain half): sessionId, ticketId, completed/running/pendingTasks, lastEventId, lastVerifiedCommit, createdAt; session-filtered on load. Both files gitignored as `domain-*.json` |
| Cycle reports | `~/.cursor/hooks/state/cycles/{run_id}.json` | Production audit per completed run |
| Memory index | `~/.cursor/hooks/state/memory-index.json` | Inverted index for fast goal recall |
| Project management | `~/.cursor/hooks/state/orchestra-project.json` | Epics, milestones, stories, tasks, velocity, backlog |
| Daily planner | `~/.cursor/hooks/state/orchestra-daily.json` | Daily journal, progress reports, metrics |
| Version/release | `~/.cursor/hooks/state/orchestra-version.json` | Semver, changelog, release notes |
| Installed bundle | `~/.cursor/hooks`, `agents`, `skills`, `rules` | Copied from `bundle/` on install |
| Free-model cache | `~/.config/opencode/state/free-models.json` | Live Zen free catalog (written by `--refresh`; source of truth for `--apply` + merge) |
| Free-model pools | `~/.config/opencode/state/model-pools.json` | frontend/heavy/light pools (regenerated each `--refresh`; ordered by probes reachability/stability; `--apply` sets global `model`/`small_model` only — agents inherit) |
| Probe results | `~/.config/opencode/state/probes.json` | Model reachability + stability (`{modelId: {reachable, timestamp, error?, stability_score?}}`); feeds pool ordering and primary selection |
| Target project context | `<project>/context/*.md` | Created by `init-context` or manually |
| Target entry point | `<project>/AGENTS.md` | Points agents to six files |
| Project identity | `<project>/project.yaml` | Universal project identity, version, lifecycle, team, stack, environments |

## Auth and access

No network auth in orchestra itself. Hooks run locally with the user's Cursor session permissions. Do not store secrets in `orchestra.json` or hook scripts.

## System Design & Infrastructure

This project uses no external infrastructure — all hook scripts run locally on the developer machine.

| Concept | Status | Notes |
|---------|--------|-------|
| **Compute** | Local Node.js only | Scripts run on `node` via Cursor hooks — no server |
| **Database** | N/A (local JSON) | V3 uses structured JSON files with ring-buffer caps |
| **CI/CD** | Template generation | Auto-generates GitHub Actions, GitLab CI, Jenkins pipelines |
| **IaC** | Template generation | Auto-generates Docker, K8s, Terraform, Cloudflare configs |
| **Observability** | Local metrics | JSON-based metrics, health checks, daily reports |

## Phase Model — Adaptive Loops (V3.2)

### Core loop (default ambient)

```
plan → implement → verify → review
```

Agents: `orchestra-planner` → `orchestra-implementer` → `orchestra-verifier` → `orchestra-reviewer`.

**Project-type specialist inserts (core loop):** for medium/complex `PROJECT SCOPE`, the core spine stays fixed but the conductor inserts the project type's missing specialists — requirements/design (product-owner, product-manager, architect, ui-ux-designer per `project.yaml` `type`) + planning (project-manager) before implement; type's engineer pairs implementer; type's tester pairs verifier; type's reviewer pairs reviewer. Each insert ends with its own token (`DESIGN_SPEC_COMPLETE`, `TASK_BREAKDOWN_COMPLETE`). Routing table lives in `bundle/opencode/agents/orchestra.md` and `bundle/agents/orchestra.md`.

### Corporate tier (large org / multi-team)

Escalated via scope signals (`project.type: enterprise`, `team.members` > 4, multi-service, program/portfolio). Conductor wires the coordination + governance agents: `agent-selector` (team roster) → `project-type-classifier` (pipeline template) → `workflow-orchestrator` (multi-track plan) → per-track Full Delivery loops each with its own `scrum-master` + `project-manager`, then a governance committee (`business-strategist`, `product-owner`, `product-manager`, `stakeholder-advocate` at design; `compliance-officer`, `legal-advisor`, `security-executive-advisor` at release), closed out by `release-manager`, `ops-manager`, `documentation-writer`, `sre`/`observer`, `incident-responder`. Tokens: `TEAM_SELECTED`, `PROJECT_CLASSIFIED`, `WORKFLOW_PLAN_READY`, `GOVERNANCE_PASS`, `CORPORATE_RELEASE_COMPLETE`.

### Enterprise SDLC (opt-in)

Activated by `/enterprise` or complexity signals (architecture, migration, multi-service, security audit, etc.).

```
idea → analysis → requirements → functional-req → nonfunctional-req →
user-stories → acceptance-criteria → use-cases → domain-model →
risk-analysis → architecture-review → tech-selection → folder-structure →
coding-standards → sprint-planning → milestone-planning → task-breakdown →
implementation → unit-testing → integration-testing → regression-testing →
performance-testing → security-review → accessibility-review →
documentation → release-candidate → production-release →
monitoring → analytics → maintenance → retrospective → continuous-improvement
```

State fields: `loopMode` (`core` | `enterprise`), canonical `currentPhase` (legacy `phase` dual-written on save).
### Phase Categories

| Category | Phases | Agents |
|----------|--------|--------|
| **Discovery** (01-idea → 04-nonfunctional-req) | idea, analysis, requirements, functional-req, nonfunctional-req | business-analyst, product-manager |
| **Design** (05-user-stories → 12-coding-standards) | user-stories, acceptance-criteria, use-cases, domain-model, risk-analysis, architecture-review, tech-selection, folder-structure, coding-standards | architect, tech-lead |
| **Planning** (13-sprint-planning → 15-task-breakdown) | sprint-planning, milestone-planning, task-breakdown | project-manager |
| **Execution** (16-implementation → 17-unit-testing) | implementation, unit-testing | backend-engineer, frontend-engineer, full-stack-engineer, database-engineer |
| **Quality** (18-integration-testing → 21-security-review) | integration-testing, regression-testing, performance-testing, security-review, accessibility-review | qa-engineer, automation-engineer, security-engineer |
| **Release** (22-documentation → 24-production-release) | documentation, release-candidate, production-release | documentation-writer, release-manager, devops-engineer |
| **Operations** (25-monitoring → 31-continuous-improvement) | monitoring, analytics, maintenance, retrospective, continuous-improvement | sre, observer, project-manager |

## Agent Architecture: Harness > Scaffold > Loop

Cursor Orchestra implements a three-layer agent architecture:

- **Loop:** Adaptive phase chain (core 4-phase default; enterprise 32-phase opt-in)
- **Scaffold:** Agent prompts (core orchestra-* + enterprise specialists), context injection, ambient policy
- **Harness:** Hook scripts, state management, quality gates, error handling

The harness calls the scaffold, which defines the loop behavior.

## Enterprise Quality Gates

Every orchestration must pass all applicable gates before completion:

1. ✓ Build passes
2. ✓ Tests pass
3. ✓ Coverage acceptable
4. ✓ Lint passes
5. ✓ Security passes
6. ✓ Reviewer approves
7. ✓ Documentation updated
8. ✓ Version updated
9. ✓ Changelog updated
10. ✓ Roadmap updated
11. ✓ Project memory updated
12. ✓ Daily journal updated
13. ✓ Release notes updated
14. ✓ Technical debt recorded

## Version Management

Automatic semantic versioning:

| Change Type | Bump | Example |
|------------|------|---------|
| Breaking API/behavior change | MAJOR | 1.2.3 → 2.0.0 |
| New feature (backward compatible) | MINOR | 1.2.3 → 1.3.0 |
| Bug fix / patch | PATCH | 1.2.3 → 1.3.4 |

Build number auto-increments. Format: `MAJOR.MINOR.PATCH+BUILD` (e.g., `1.4.2+106`).

Release names follow theme-based naming (e.g., 1.0.0 "Genesis", 2.0.0 "Evolution").

## Universal Project Identity System (V3.1)

Every managed project declares its identity in `project.yaml` (or `project.json` as fallback) at the project root.

### Schema Categories

| Section | Fields | Managed By |
|---------|--------|------------|
| `project` | name, slug, display_name, type, category, owner, description | Developer |
| `version` | current, channel, release_name, build_number | Orchestra (auto-bump) |
| `lifecycle` | stage, status, started, updated | Orchestra (stage transitions) |
| `team` | lead, members (name, role, contact) | Developer |
| `repository` | url, branch, provider, visibility | Developer |
| `stack` | languages, frameworks, databases, infrastructure, package_manager, runtime | Developer |
| `environments` | development, staging, production (url, branch, auto_deploy) | Developer |
| `integrations` | ci_cd, monitoring, analytics, error_tracking, logs | Developer |
| `ai` | assistant, context_dir, entry_point, rules | Orchestra |
| `infrastructure` | cloud, regions, dns, cdn | Developer |
| `security` | authentication, authorization, audit_log, secrets_manager | Developer |
| `compliance` | standards, data_region | Developer |
| `observability` | health_endpoint, metrics, tracing, alerting | Developer |
| `backup` | strategy, retention_days, schedule | Developer |
| `disaster_recovery` | rpo_minutes, rto_minutes, plan | Developer |
| `_pcore` | version, initialized, last_orchestration, orchestration_count | Orchestra (auto) |

### Library Module

`bundle/hooks/lib/project-identity.js` provides:

- `loadProjectIdentity(rootDir)` — reads `project.yaml` (YAML) or `project.json` (JSON), merges with defaults
- `validateProjectIdentity(identity)` — validates required fields, warns on non-standard values
- `identityToState(identity)` — maps identity fields to orchestra state format
- `buildIdentitySummary(identity)` — human-readable summary for context injection
- `findProjectIdentity(rootDir)` — finds identity file in project root

### Context Detection Integration

The context detector now checks for `project.yaml` alongside six-file context:

- `detectProjectYamlInWorkspaces(input)` — finds project.yaml in workspace roots
- `buildProjectYamlInjection(projectIdentity)` — builds context injection string
- `detectFullWorkspaceContext(input)` — detects both six-file and project identity

### Project Type Taxonomy

The system supports 12 project types: web, mobile, api, ai, devops, library, saas, internal-tool, oss, cli, game, data.

### Bootstrap

```bash
# Bash
bash scripts/init-project.sh /path/to/project
bash scripts/init-project.sh /path/to/project --type api --name "Auth Service"

# PowerShell
powershell -File scripts/init-project.ps1 -Target . -Type web -Name "My App"
```

## Agent Team Structure

| # | Agent | Category | Readonly | Responsibility |
|---|-------|----------|----------|----------------|
| 1 | business-analyst | Discovery | Yes | Idea collection, business analysis, requirements |
| 2 | product-manager | Discovery | Yes | Functional/non-functional reqs, user stories |
| 3 | architect | Design | Yes | Domain model, risk analysis, architecture review |
| 4 | tech-lead | Design | Yes | Tech selection, folder structure, coding standards |
| 5 | project-manager | Planning | Yes | Sprint/milestone planning, task breakdown |
| 6 | backend-engineer | Execution | No | Backend implementation |
| 7 | frontend-engineer | Execution | No | Frontend implementation |
| 8 | full-stack-engineer | Execution | No | Full-stack implementation |
| 9 | database-engineer | Execution | No | Database schema, migrations, optimization |
| 10 | qa-engineer | Quality | Yes | Integration, regression, smoke tests |
| 11 | automation-engineer | Quality | Yes | E2E, performance, chaos tests |
| 12 | security-engineer | Quality | Yes | Security review, threat modeling |
| 13 | accessibility-reviewer | Quality | Yes | Accessibility audit |
| 14 | documentation-writer | Release | Yes | All documentation |
| 15 | release-manager | Release | Yes | Release candidate, production release |
| 16 | devops-engineer | Release | Yes | CI/CD, IaC, deployment |
| 17 | sre | Operations | Yes | Monitoring, SLOs, incident response |
| 18 | observer | Operations | Yes | Analytics, performance dashboard |
| 19 | code-reviewer | Review | Yes | Code review, quality gates |
| 20 | performance-engineer | Quality | Yes | Performance testing, profiling |
| 21 | platform-engineer | Infrastructure | Yes | Cloud infrastructure, Kubernetes |
| 22 | cloud-engineer | Infrastructure | Yes | Cloud provider config |
| 23 | infrastructure-engineer | Infrastructure | Yes | IaC, networking, security groups |
| 24 | planner | Core | Yes | Research codebase, produce implementation plan |
| 25 | implementer | Core | No | Execute plan, write code |
| 26 | verifier | Core | Yes | Run checks, validate quality |
| 27 | reviewer | Core | Yes | Final approval/rejection |

## Invariants

1. Hook scripts must exit quickly and emit valid JSON on stdout; never throw uncaught errors (use `.catch(() => emit({}))`).
2. All planning/analysis agents are **readonly** — no file edits.
3. Installed global hooks merge into existing `hooks.json`; never overwrite unrelated hook entries.
4. `init-context` must not overwrite existing `context/` or `AGENTS.md` files without explicit `--force`.
5. Six-file read order is fixed: overview → architecture → code-standards → ui-context → ai-workflow-rules → progress-tracker.
6. Context injection references paths relative to workspace root, not absolute machine paths.
7. Every orchestration must pass all applicable quality gates before marking complete.
8. Version must be bumped according to semver rules on every orchestration that changes code.
9. Changelog must be updated on every orchestration.
10. Technical debt must be recorded if any shortcuts were taken.
11. All agents must output structured data for downstream consumption.
12. Phase chain is extensible — new phases can be added by creating agent + hook entry.
13. Orchestra hooks remain **Node.js only** — no Python hook runtime. Optional Python 3 is a skill dependency for `ui-ux-pro-max` `search.py` (and related design scripts), not for install/health.
14. Vendored UI skills ship **real directories** (`data/`, `scripts/`) — never symlink stubs into the bundle.
15. State writes are atomic: all non-conductor state goes through `bundle/hooks/lib/safe-write.js` (`atomicWrite` tmp+rename; `updateState` with advisory lock) — never raw `fs.writeFile` on shared state, never silent corrupt-reset (quarantine + backup instead).
16. A phase only advances when `bundle/hooks/lib/phase-outcome.js` approves: correct end token (`PLAN_READY` / `IMPLEMENT_DONE` / `VERIFY_PASS|VERIFY_FAIL` / `ORCHESTRA_COMPLETE|FIX_REQUIRED`) AND, at the gate-enforced phases **verify** and **review** (`GATE_ENFORCED_PHASES`), no failed quality gates. Failed gates block with `phase_blocked` + corrective follow-up and `state.last_outcome = failed-gates`. **plan/implement are not gate-enforced**: they advance on their own end token while red evidence stays visible (verify re-runs evidence on entry; the implementer cannot clear gates, so blocking them would deadlock the fix loop). Failed-gates is evaluated **before** the empty-output advance, so silent/whitespace output can never finish a run with red gates; empty output at a non-gate-enforced phase (or with green gates) still advances with a warning (never bricks the loop).
17. `permission.task` on both conductors is **deny-first** (`"*": deny` first rule, `edit: deny`, `readonly: true` on Cursor) and generated from `bundle/agent-registry.json` between BEGIN/END markers — coverage must stay 160/160, additive only.
18. `bundle/hooks/**` and `bundle/opencode/hooks/**` stay byte-identical per file (only the health entry differs: `orchestra-health.js` vs `orchestra-health-opencode.js`); enforced by `scripts/test-mirror-sync.js`.
19. **Domain writes are safe-write-only**: `bundle/hooks/lib/domain/store.js` is the sole writer of `domain-events.json` / `domain-checkpoint.json` (withLock + readJsonSafe + writeJson; corrupt files quarantine to a `.corrupt-<ts>` sibling, never silent reset; ring-capped). The domain module is **fail-open** from the hooks' point of view (lazy guarded `require` + `try/catch`) and must never change stdout, quality gates, or the `orchestra.json` shape — Phase 2 domain data lives only in the `domain-*.json` files. The default state dir is `~/.config/opencode/hooks/state` (shared with the other state writers), NEVER a path inside the shipped bundle — `PCORE_STATE_DIR` overrides it, and `.gitignore` covers `bundle/{hooks,opencode/hooks}/lib/state/` as defence in depth.
20. **Completion is claimed-vs-verified**: an agent setting `agent_status: "claimed_done"` (`claimDone`) NEVER completes a ticket — `evaluateCompletion` requires passed verification recorded at the current commit, required acceptance results, required human review (when `humanReview.required`), and green gates; staleness is only asserted when BOTH commits are known (`null` = unknown, not stale). `ALLOWED_TRANSITIONS` is additive-only (extension point); `reopen()` is the only COMPLETED→IN_PROGRESS path.
21. **Evidence records are immutable and ring-capped**: a verify/review run appends one `evidence.run` event (`domain/evidence.js` → `store.appendEvent`) holding per-gate records `{gate, command, args, exitCode, durationMs, ok, stdoutExcerpt, stderrExcerpt, startedAt}` **plus a `details` field** — the human-readable verdict, clamped to `DETAILS_MAX` (`evidence-record.js`) because the security-FAIL path embeds a whole `generateSecurityReport` and was unbounded in `state.qualityGates`, the evidence report and the domain log alike. Those records are produced by `buildEvidenceRecord` itself, called from `applyEvidenceToGates` — the builder is wired in, not merely documented and unit-tested, and `runCmd` carries `command`/`args`/`startedAt` so the provenance is real (a verdict derived from git OUTPUT passes its own ok/fail through `derived()`, so a `git diff` exit code never stands in for the gate verdict). The shape is asserted at the **hook boundary** (`scripts/test-evidence-runner.js` reads `domain-events.json` after a real hook run), because a pure-function assertion cannot see what the hooks actually persist. Records are append-only — a stored record is never rewritten in place, excerpts are clamped (`EXCERPT_MAX`) and secret material is redacted before it is persisted, and the host log stays bounded by `DOMAIN_EVENT_CAP` (oldest trimmed first). `evidenceDigest` is stable over **sorted** gates, so the same set of gates always hashes identically regardless of completion order.
22. **The docs-updated gate is diff-derived and fails closed**: its verdict comes from `evidenceDocsUpdated`, which diffs the **real** git range for doc-ish paths against, in order, `state.baseCommit` (explicit caller contract), the **run-start** `state.diffBase` (written by `recordRunDiffBase` from `startOrchestra`), or `HEAD` **plus the last commit** (`HEAD~1..HEAD`). The base is recorded at **run start, never at gate time**: with a gate-time `HEAD` default the committed range `HEAD...HEAD` is empty, so the gate could only ever see the uncommitted worktree and blocked every implementer who COMMITTED their docs — at verify AND review — with `reason: "no-doc-changes"`. A recorded base that does not resolve in the current tree (worktree/rebase drift) degrades to `HEAD` (state drift is not a git error), while an **explicit** `baseCommit` git cannot resolve still fails closed. The last-commit fallback only applies to a session with no recorded run base, so a real run never borrows the previous commit's docs as its own evidence. A git failure **inside** a repository is a FAIL with `reason: "git-error"` (fail closed, never an implicit pass); only a directory that is not a git repository at all yields `SKIPPED: skip-no-git`. The "progress-tracker mentioned in the summary" probe in `orchestra-quality-gate.js` is an **additional accept signal only** — it can add a pass, never mask a diff-derived FAIL.
23. **The security scan is core-loop and blocking on critical/high**: `security` is in `CORE_REQUIRED_GATES` (`evidence-runner.js`), so the default core loop scans on every final review — not enterprise-only. The scan walks dot-directories (`.github/...` included) and extensionless files (`.env`, `Dockerfile`), understands unquoted `KEY=value` secrets, and calls `checkOwaspTop10` (surfaced as **advisory** categories, never blocking). Only **critical/high** block (`evidenceSecurity.ok === false`); medium/low are reported as non-blocking. Self-scan false positives must be declared in `SELF_SCAN_EXCLUSIONS` with an id, a documented reason, a scoping file regex **and a rule/label regex** — a file-only entry silences every rule at every severity in that file, which is how a planted GitHub token in `security-scanner.js` stayed invisible (audit B3).
24. **CI secret scan and shellcheck are blocking, and CI cannot disagree with the loop**: `.github/workflows/ci.yml` runs `node scripts/scan-secrets.js --dir . --fail-on=high` as a required step — exit 1 on any high/critical finding, exit 2 on a usage error or an undocumented allowlist entry. `scripts/scan-secrets.js` is a thin CLI over the **same** `security-scanner.js` the loop uses, and the two now share its scope (the **workspace root**) and its allowlist reader (`loadSecretScanAllow`/`isAllowedFinding`/`parseAllowPattern` in `security-scanner.js`), so the in-loop `evidenceSecurity` gate and CI can never disagree: a `ghp_` token in `scripts/` blocks both, and an allowlist entry silences the same finding in both. False positives belong in `.secret-scan-allow` as `pattern | reason` (an entry with no reason is a hard error in BOTH); the narrow form `file:<sub> + label:<sub>` is required for executable trees, because a directory entry would silently allow a real secret dropped into it; findings inside the allowlist itself are reported as a non-blocking self-scan. `shellcheck` runs **blocking at `--severity=error`** (real shell defects: `local` outside a function, `$10` without braces); `node --check` covers `scripts/**`, `bundle/hooks/**` and `bundle/opencode/hooks/**`.
25. **The human-review queue has a real producer**: `pendingReview()` (`domain/review-queue.js`) is a pure projection of `store.loadEvents()` and opens on `review.requested` **or a `phase.outcome` with a `block` / `needs_human` decision**, closing on `review.resolved` or an `advance`. `block` is an opener because that is the decision `phase-outcome.js` really emits for a red required gate (`advance|block|fix`); with `needs_human` as the only opener the queue disagreed with `needsHuman()` in `orchestra-quality-gate.js` (which already treats `block` as needing a person), held nothing, and rendered "nothing is queued for triage" on every run — an inert feature. Since 2026-10-26 `recordPhaseOutcome` also **emits** the opener: every `phase.outcome` carries `payload.ticketId` (minted at intake by `startOrchestra` into `state.memory.ticketId`, `acCount` filled from the plan's `## Done when` by `countAcceptanceCriteria`), and a `block`/`needs_human` decision appends a `review.requested` event — ticket from memory, else a `BLOCKED` ticket with `humanReview.required` is created — so queue items dedup on a stable ticket key (`keyOf`). `scripts/test-review-queue.js` asserts that every decision `phase-outcome.js` can emit is classified by one side of the queue; `scripts/test-review-queue-producer.js` asserts the producer end-to-end. Rendering stays best-effort: lazy + try/catch, never able to change a gate verdict, the stdout envelope or the exit code (invariant 19).

26. **Handoff includes an evidence digest and work-item context**: the 2500-char handoff (`handoff-enforcer.js`) emitted at verify/review boundaries now carries a structured evidence digest (gate names + pass/fail, e.g. `tests:PASS docs-updated:FAIL security:PASS`) built by `buildHandoffEnforcement`, plus a work-item summary (`ticketId` from `state.memory.ticketId` or `state.goal`, AC count if available) so the next agent resumes with concrete proof, not bare bullets. The digest is clamped with `... [+N chars]` when it would exceed the limit.

27. **Six-file context is validated at verify entry**: `context-detector.validateSixFileContext(cwd)` is invoked by `orchestra-subagent-stop.js` when the verify phase starts; it reads all six `context/*.md` files and returns `{files: [...], missing: [], progressTrackerTouched: boolean}` where `progressTrackerTouched` compares `progress-tracker.md` mtime against `state.memory.progressTrackerClaimedAt`. The result is recorded as `state.memory.progressTrackerTouchedAt` and any missing files are surfaced via `state.qualityGates.missingContext` for the verifier to see. A missing context file does not block the phase but is a visible quality signal.

28. **Memory retrieval is wired into session start and prompt building**: `memory-manager.buildMemoryContext(state)` calls `memory-index.searchMemoryIndex` with a query derived from `state.goal` / `state.activeWorkItem`, caps results at 3, and injects them as `state.memory.context`. `orchestra-prompt.js` and `orchestra-session-start.js` both call `buildMemoryContext` so the retrieved memories are available to the next agent. `semantic-memory.js` provides scoring for relevance (cosine over embedded keywords) and is covered by `scripts/test-memory-retrieval.js` — the path is exercised end-to-end, not merely unit-tested.

29. **Progress-tracker is touched when a phase claims it**: at verify entry, `progressTrackerClaimedAt` is set to `Date.now()` (or the existing `state.memory.progressTrackerClaimedAt` if already set), and `progressTrackerTouchedAt` records the validation timestamp. This allows `validateSixFileContext` to detect whether the file was modified since the claim — a meaningful proxy for "the verifier actually read it". The claim timestamp persists across the loop via `state.memory`.

30. **Git worktree isolation per run**: each orchestra run creates a git worktree at `.pcore/worktrees/<runId>/` checked out at the base commit (`worktree-manager.js`). This provides complete filesystem isolation between concurrent runs — each run has its own working directory, its own `.pcore/state/` for domain events, conductor runs, and review queues. The worktree is created at run start (`ensureWorktree` in `orchestra-subagent-stop.js`) and cleaned up at run end (`cleanupWorktree`). `detectWorkspaceRoot` in `evidence-runner.js` uses `state.worktreePath` when available so evidence checks run in the correct worktree.

31. **Run-state partitioning by worktree**: domain events (`domain/store.js`), conductor runs (`conductor-state.js`), and review queues (`domain/review-queue.js`) all accept an optional `worktreePath` parameter. When provided, they read/write from `worktreePath/.pcore/state/` instead of the global state dir. This ensures concurrent runs have fully isolated state — domain events, review queues, and conductor run records never cross-contaminate.

32. **Parallel phase execution safety**: phases can run in parallel when the agent registry proves independence (`orchestra-spawn-matrix.js` `canRunInParallel`). Independence is determined by comparing files touched, gates accessed, and state keys used — no shared resources means safe parallelism. Gate enforcement still applies: a phase with failed gates blocks its dependents. The conductor (`orchestra-subagent-stop.js`) spawns independent phases concurrently when `canRunInParallel` returns true.

33. **Host-agnostic spawn adapter**: `spawn-adapter.js` abstracts subagent spawning across Cursor (Task tool), OpenCode (task tool), Qoder (Agent tool + `subagent_type`; hook stdin `agent_type` normalized by `io.js` `normalizeHookInput()`), Claude Code (MCP tools/call), and Codex (MCP tools/call). All hosts return a normalized `{success, result, error, artifacts}` response. The adapter is a pure abstraction — platform-specific logic is confined to the adapter, keeping the conductor platform-agnostic. **Wired into hook chain**: `orchestra-subagent-stop.js` calls `spawnSubagent()` (which uses `spawnAdapter.spawn()`) at every phase transition (plan→implement→implement→verify→verify→review, FIX_REQUIRED loops, parallel phases) with host detection via environment variables and `state.host`.

34. **MCP read-only server contract**: the MCP server (`mcp-server.js`) exposes run/status/gates/history via read-only resources (`run://<runId>`, `run://<runId>/gates`, `run://<runId>/evidence`, `run://<runId>/handoff`) and tools (`get_run_status`, `get_gate_results`, `get_evidence`, `list_runs`). It reads from worktree-partitioned state (conductor-runs, domain-events) and never mutates state. **Auto-started on run start** via `orchestra-prompt.js` (after `startOrchestra()`, port 0 = stdio transport), **stopped on run end** via `orchestra-subagent-stop.js` (ORCHESTRA_COMPLETE, max_iterations, FIX_REQUIRED at cap). Module-level `Map` tracks instances per `runId`; `process.on('exit'/'SIGTERM'/'SIGINT')` ensures cleanup on crash.

35. **Studio is a separate read-only application that consumes the run store (conductor-runs, domain-events, orchestra-tokens, orchestra-history) without writing to any hook state. It discovers worktree-partitioned state directories server-side — `server/state-dirs.js` is the sole discovery owner, exposed to the client via `GET /api/state-dirs`; the former client module `studio/src/lib/stateResolver.ts` was deleted (Node `fs`/`child_process` cannot run in the browser) — and provides a visual dashboard for WorkItems, runs, gates, evidence, reviews, and tokens. Studio installs via `install.sh --studio` and launches via `orchestra-studio`.**

36. **Studio v2 server is read-only over hook state.** `server/studio-api.js` binds `127.0.0.1` (never a remote interface by default — no `--host` flag), serves the SPA plus `/api/*`, and reads conductor/domain/token state through the moved data-layer readers only (`server/readers.js`, ported from `studio/src/lib/`) — no raw writes to any hook state file, and none in `server/` at all. The single write path is `PATCH /api/workitems/:id`, which validates the domain transition (table-driven by `ALLOWED_TRANSITIONS`, with TRIAGE↔DRAFT and NEEDS_HUMAN↔BLOCKED mapped) and appends a domain event through `store.appendEvent` (invariant 19's sole writer). `server/ws.js` replays derived `phase.*` / `gate.*` / `run.completed` events at `/api/ws` and accepts no mutations; `server/graph-builder.js` is a pure function (no fs, no clock, deterministic). State files are written only by hooks via Phase 0 safe-write; the server never bypasses `store.appendEvent`. Spec: `docs/studio-v2-architecture.md` §8.

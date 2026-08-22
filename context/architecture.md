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
| Repo scoping | `.ignore` + `.cursorignore` + `.gitignore` | Cross-tool ignore files prevent scanning `node_modules/`, `vendor/`, `venv/`, caches |
| Scoping scripts | Bash | `scripts/setup-repo-scoping.sh` (auto-detect single vs monorepo), `scripts/opencode-maintenance.sh` (DB/log housekeeping) |

## System boundaries

| Path | Owns |
|------|------|
| `bundle/hooks/orchestra-*.js` | Individual hook handlers |
| `bundle/hooks/lib/constants.js` | Named constants (no magic numbers) |
| `bundle/hooks/lib/io.js` | stdin/stdout helpers (`readStdinJson`, `emit`) |
| `bundle/hooks/lib/state-manager.js` | State CRUD (`loadState`, `saveState`, `startOrchestra`) |
| `bundle/hooks/lib/prompt-classifier.js` | Prompt extraction and classification |
| `bundle/hooks/lib/phase-engine.js` | Phase chain definition and transitions |
| `bundle/hooks/lib/lifecycle-recorder.js` | Lifecycle events and phase timers |
| `bundle/hooks/lib/heartbeat-monitor.js` | Stall detection and heartbeat |
| `bundle/hooks/lib/memory-manager.js` | Short-term and long-term memory |
| `bundle/hooks/lib/history-recorder.js` | Orchestration run history |
| `bundle/hooks/lib/checkpoint-manager.js` | Resumable tasks and crash recovery |
| `bundle/hooks/lib/context-detector.js` | Six-file workspace context detection |
| `bundle/hooks/lib/version-manager.js` | Semver, changelog, release automation |
| `bundle/hooks/lib/evidence-runner.js` | Command-evidence checks for quality gates |
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
| `bundle/skills/{ui-ux-pro-max,brand,design-system,ui-styling}/` | Vendored UI skills (real assets; MIT — see `THIRD_PARTY.md`) |
| `bundle/config/cursor/` | CLI autonomy patch + `permissions.json` + `sandbox.json` |
| `bundle/config/opencode/autonomy.json` | OpenCode permission/agent profile (install merges; preserves `mcp`) |
| `scripts/merge-autonomy-config.js` | Install-time merge for Cursor + OpenCode autonomy |
| `bundle/opencode/agents/` | OpenCode mirrors (core + enterprise) |
| `templates/context/specs/` | Unit spec blanks (methodology Part 3) |
| `project-bridge/` | Repo-local delegation only — no duplicate logic |
| `templates/context/` | Blank templates — never installed to `~/.cursor/` |
| `context/` | This repo's own six-file context (dogfooding) |

## Storage model

| Data | Location | Notes |
|------|----------|-------|
| Orchestra state | `~/.cursor/hooks/state/orchestra.json` | V3: full SDLC state, project management, versioning |
| Long-term memory | `~/.cursor/hooks/state/orchestra-memory.json` | Persistent across sessions, capped at 100 goals |
| Token usage | `~/.cursor/hooks/state/orchestra-tokens.json` | Per-run estimates, aggregates, improvement tips |
| Plan artifact | `<project>/.cursor/orchestra-plan.md` | Approved plan for implement→verify→review (gitignored) |
| Cycle reports | `~/.cursor/hooks/state/cycles/{run_id}.json` | Production audit per completed run |
| Memory index | `~/.cursor/hooks/state/memory-index.json` | Inverted index for fast goal recall |
| Project management | `~/.cursor/hooks/state/orchestra-project.json` | Epics, milestones, stories, tasks, velocity, backlog |
| Daily planner | `~/.cursor/hooks/state/orchestra-daily.json` | Daily journal, progress reports, metrics |
| Version/release | `~/.cursor/hooks/state/orchestra-version.json` | Semver, changelog, release notes |
| Installed bundle | `~/.cursor/hooks`, `agents`, `skills`, `rules` | Copied from `bundle/` on install |
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

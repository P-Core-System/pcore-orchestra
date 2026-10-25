# Orchestra spawn matrix (Cursor + OpenCode + Qoder)

## Cursor IDE

- **Spawn:** `Task` tool, `subagent_type="orchestra-planner"` (etc.)
- **Chain:** Hooks `subagentStop` advance phases when markers appear
- **Entry:** Ambient parent agent OR `orchestra` conductor agent
- **Do not use:** wrong `subagent_type` names when custom agents work

### Cursor Task limitation (conductor fallback)

If `Task` rejects `subagent_type=orchestra-*` (enum / unknown agent), the parent **MUST** run conductor fallback: execute phases itself **or** spawn `generalPurpose` with instructions from `~/.cursor/agents/orchestra-*.md`. Do **not** stop the loop. Hooks still match `orchestra-*` names when custom agents are available.

**Anti-stop:** While orchestra is active or user said continue-until-finish, do **not** pause for “Done / Next” menus — chain plan→implement→verify→review→handoff goals in the same run until the user goal is finished or user says stop.

## OpenCode

- **Spawn:** `task` tool, agent=`orchestra-planner` (etc.)
- **Chain:** `orchestra` conductor calls task once per phase — no hooks
- **Entry:** `default_agent: orchestra` only
- **Phase agents:** `hidden: true` — not in @ menu

## Qoder CLI

- **Spawn:** `Agent` tool, `subagent_type="orchestra-planner"` (etc.)
- **Chain:** Hooks in `~/.qoder/settings.json` — PascalCase events (`SessionStart`, `UserPromptSubmit`, `SubagentStop`, `Stop`) advance phases when markers appear
- **Entry:** Ambient parent agent OR `orchestra` conductor agent (`qoder --agent orchestra`)
- **Agents:** `~/.qoder/agents/` — converted frontmatter via `scripts/sync-qoder-agents.js`
- **Hook input:** stdin JSON carries `agent_type`; `lib/io.js` `normalizeHookInput()` maps it to `subagent_type` so the shared Cursor hooks work unchanged

## Core Phase Agents (4)

`orchestra-planner` → `orchestra-implementer` → `orchestra-verifier` → `orchestra-reviewer`

## Enterprise Specialist Agents (35)

### 01-idea
- `business-analyst` — idea collection, business analysis, scope
- `stakeholder-advocate` — business/ops/customer impact review
- `market-researcher` — competitive analysis, user research, market sizing

### 02-requirements
- `product-manager` — functional/non-functional requirements, user stories
- `product-owner` — backlog prioritization, scope decisions, acceptance criteria

### 03-architecture
- `architect` — system design, contracts, boundaries
- `tech-lead` — technical decisions, tech stack validation
- `adr-archivist` — architecture decision records, decision log management

### 04-planning
- `project-manager` — scope, sequencing, dependencies, risks
- `scrum-master` — sprint planning, velocity tracking, retrospectives, impediments

### 05-implementation
- `backend-engineer` — APIs, services, business logic
- `frontend-engineer` — UI components, state, integration (web + mobile)
- `mobile-engineer` — Ionic, React Native, Capacitor, native mobile
- `full-stack-engineer` — end-to-end feature implementation
- `database-engineer` — schema, migrations, query optimization
- `ui-ux-designer` — user journeys, information architecture, design spec

### 06-testing
- `qa-engineer` — independent verification, regression, negative paths
- `automation-engineer` — test automation, CI integration
- `performance-engineer` — load testing, profiling, optimization
- `accessibility-reviewer` — WCAG compliance, screen reader, keyboard nav
- `api-contract-validator` — API contract testing, schema validation, breaking changes
- `regression-tester` — regression suite management, flaky test detection

### 07-security
- `security-engineer` — threat modeling, vulnerability scanning, OWASP
- `security-performance-reviewer` — combined security + performance + reliability audit

### 08-deployment
- `release-manager` — build/release readiness, rollback plans
- `devops-engineer` — CI/CD, deployment, infrastructure
- `documentation-writer` — docs, API docs, analytics, support notes
- `platform-engineer` — platform services, containerization
- `cloud-engineer` — cloud infrastructure, serverless
- `infrastructure-engineer` — networking, compute, storage

### 09-observability
- `sre` — production health, monitoring, incident response
- `observer` — smoke tests, error rate monitoring, alerting
- `incident-responder` — incident triage, RCA, postmortem, runbooks

### 10-review
- `code-reviewer` — code quality, patterns, maintainability
- `technical-debt-tracker` — debt identification, prioritization, paydown planning

## Full Delivery Workflow (8 phases + quality gates)

```
PLAN → [G1] → PRODUCT/UX → [G2] → ARCHITECTURE → [G3] → EXECUTE → [G4] → VERIFY → [G5] → UAT → [G6] → DEPLOY → [G7] → POST-DEPLOY → [G8]
```

| Phase | Specialists | Parallel? |
|-------|------------|-----------|
| plan | orchestra-planner | No |
| product/ux | stakeholder-advocate, market-researcher, product-owner, ui-ux-designer | Yes |
| architecture | architect, tech-lead, adr-archivist | Yes |
| execute | orchestra-implementer + backend/frontend/mobile/database/fullstack-engineer | Yes (per file) |
| verify | orchestra-verifier + regression-tester, api-contract-validator, technical-debt-tracker | Yes |
| uat | qa-engineer, security-performance-reviewer | Yes |
| deploy | release-manager, devops-engineer, documentation-writer, scrum-master | Yes |
| post-deploy | sre, observer, incident-responder | Yes |

## Quality Gates

| Gate | Criteria | Blocks |
|------|----------|--------|
| G1: Plan | Goal clear, files identified, risks assessed | Product/UX |
| G2: Product | Acceptance criteria defined, scope decided | Architecture |
| G3: Architecture | ADRs created, contracts defined | Execute |
| G4: Execute | Code committed, tests pass, clean tree | Verify |
| G5: Verify | All tests pass, no regressions | UAT |
| G6: UAT | No P0/P1 blockers, security/perf passed | Deploy |
| G7: Deploy | Deployment successful, rollback tested | Post-Deploy |
| G8: Post-Deploy | Health checks pass, monitoring active | Complete |

## Handoff (both)

Goal (1 line) + plan bullets + prior failures only. No full chat history.

## Full doc

`docs/orchestra-cross-platform.md`




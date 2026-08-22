# Spec: enterprise-orchestra-switch

## Goal

Orchestra supports two adaptive loops: **core** (4 phases: plan → implement → verify → review) as default ambient, and **enterprise** (32-phase SDLC from idea → production-release) opt-in via `/enterprise` command or complexity signals (architecture, migration, multi-service, security audit, greenfield product). Phase filter in `project.yaml` can restrict enterprise phases.

## Context

- Related overview/architecture sections: `context/architecture.md` (Phase Model — Adaptive Loops V3.2, Phase Categories table, State fields loopMode/currentPhase), `context/project-overview.md` (Goals #2 adaptive routing), `context/ai-workflow-rules.md` (Approach — enterprise SDLC for high-complexity), `bundle/hooks/lib/phase-engine.js` (getPhasesForState, validatePhaseFilter), `bundle/hooks/lib/orchestra-config.js` (project.yaml orchestra block)
- Out of scope: Dynamic phase insertion at runtime (config-driven only), per-project custom phase definitions

## Requirements

1. Default loop mode: `core` (ambient auto-start on implement verbs)
2. Enterprise trigger: explicit `/enterprise` in prompt OR complexity signals detected by prompt classifier (keywords: architecture, migration, multi-service, security audit, greenfield, refactor system, compliance)
3. Enterprise loop: 32 phases across 7 categories (Discovery → Design → Planning → Execution → Quality → Release → Operations)
4. State fields: `loopMode` (`core` | `enterprise`), `currentPhase` (canonical), legacy `phase` dual-written for backward compat
5. `phase-engine.js`: `getPhasesForState({ loopMode, orchestraConfig })` returns filtered phase list; `getPhaseIdsForState()` returns id array; `validatePhaseFilter()` warns on unknown phase ids in `project.yaml` orchestra.phases
6. `startOrchestra()` in `state-manager.js`: reads `orchestraConfig.route` + `orchestraConfig.max_iterations`; enterprise default max_iterations = 16 (vs core 8)
7. Phase filter: `project.yaml` `orchestra.phases: [idea, requirements, architecture-review, ...]` restricts enterprise to subset; filtered start phase = first in filtered list
8. Agent set: core uses `orchestra-planner/implementer/verifier/reviewer`; enterprise uses 23 specialists (business-analyst → continuous-improvement)
9. Quality gates: enterprise requires all 14 QUALITY_GATES; core requires 6 CORE_REQUIRED_GATES (evidence-runner.js)
10. OpenCode mirror: same phase logic in `bundle/opencode/hooks/lib/phase-engine.js`

## Acceptance criteria

- [ ] Prompt "fix the login bug" → `loopMode: core`, starts at `plan`
- [ ] Prompt "/enterprise migrate to microservices" → `loopMode: enterprise`, starts at `idea`
- [ ] Prompt "refactor the authentication architecture" (no /enterprise) → `loopMode: enterprise` (complexity signal)
- [ ] `project.yaml` with `orchestra.phases: [requirements, architecture-review, implementation]` → filtered enterprise phases, start at `requirements`
- [ ] `validatePhaseFilter()` warns on unknown ids (e.g., `orchestra.phases: [unknown-phase]`)
- [ ] `getPhasesForState({ loopMode: 'core' })` → 4 phases (plan, implement, verify, review)
- [ ] `getPhasesForState({ loopMode: 'enterprise' })` → 32 phases
- [ ] Enterprise default `max_iterations: 16`; core default `max_iterations: 8`

## Done when (verifiable)

- Command: `node -e "const p=require('./bundle/hooks/lib/phase-engine.js'); console.log(p.getPhaseIdsForState({loopMode:'core'}))"` → `['plan','implement','verify','review']`
- Command: `node -e "const p=require('./bundle/hooks/lib/phase-engine.js'); console.log(p.getPhaseIdsForState({loopMode:'enterprise'}).length)"` → `32`
- Command: `node -e "const p=require('./bundle/hooks/lib/phase-engine.js'); p.validatePhaseFilter({orchestraConfig:{phases:['idea','unknown']}})"` → warns "Unknown phase ids: unknown"
- Command: `grep "LOOP_MODE_ENTERPRISE" bundle/hooks/lib/constants.js` → constant defined

## Files (expected)

- `bundle/hooks/lib/phase-engine.js` — phase chain config, filtering, validation
- `bundle/hooks/lib/state-manager.js` — startOrchestra reads orchestraConfig
- `bundle/hooks/lib/orchestra-config.js` — project.yaml orchestra block parser
- `bundle/hooks/lib/prompt-classifier.js` — complexity signal detection
- `bundle/opencode/hooks/lib/phase-engine.js` — OpenCode mirror
- `bundle/agents/01-idea/` through `10-review/` — enterprise specialist agents
- `project.yaml` — dogfood example with `orchestra:` block
- `docs/orchestra-cross-platform.md` — enterprise vs core comparison

## Risks

- Complexity signal false positives (mitigated: conservative keyword list, user can override with core)
- Phase filter misconfiguration (mitigated: validatePhaseFilter warns, doesn't fail)
- Enterprise specialists not installed (mitigated: install.sh copies all category dirs)
- State migration between loop modes mid-run (not supported: loopMode fixed at startOrchestra)
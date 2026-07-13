# Cursor Orchestra — SMART & SWOT Audit

## SMART Analysis

| Criteria | Assessment | Score |
|----------|------------|-------|
| **Specific** | Clear goal: ambient multi-agent orchestration for Cursor + OpenCode with plan→implement→verify→review pipeline | 8/10 |
| **Measurable** | Step limits, token budgets, health checks, iteration caps | 7/10 |
| **Achievable** | Core features built; gaps in convergence criteria and human checkpoints | 7/10 |
| **Relevant** | Agent orchestration is the dominant pattern in 2026 (Loop Engineering) | 9/10 |
| **Time-bound** | **No deadlines, no milestones, no release schedule** — major gap | 3/10 |

**Overall SMART Score: 6.8/10**

**Key gap:** Time-bound. Without milestones, work drifts. Recommendation: add versioned releases (v1.0, v1.1) with specific feature targets.

---

## SWOT Analysis

### Strengths
1. **Clean architecture** — four agents with clear separation of concerns
2. **Token optimization built-in** — step limits, model routing, compaction guidance
3. **Free model support** — OpenCode proxy with multi-key rotation
4. **State persistence** — V2 schema with lifecycle, heartbeat, memory
5. **Health checks** — automated verification of system integrity
6. **Documentation** — comprehensive docs for each feature

### Weaknesses
1. **No convergence criteria** — loop exits on max iterations, not on success
2. **No test enforcement** — Verifier doesn't require tests to pass before PASS
3. **No human checkpoints** — Operator Loop Stack requires this for safety
4. **No stall detection in agents** — only heartbeat at state level
5. **No budget enforcement** — tokens/cost not tracked per run
6. **Skills are instructions, not durable workflows** — no checkpoint/resume within skills
7. **No branch isolation** — agents edit directly, no worktree protection

### Opportunities
1. **Add Stop hook equivalent** — prevent premature completion (Kunal Ganglani pattern)
2. **Add convergence criteria** — "tests must pass" as exit condition
3. **Add Operator Loop Stack** — harness, contract, state, checker, human checkpoint
4. **Make skills durable** — step-level checkpointing (Inngest pattern)
5. **Add budget tracking** — tokens consumed per phase, cumulative total
6. **Add branch isolation** — git worktree per agent run
7. **Add MVP mode** — simplified 3-agent pipeline for rapid prototyping

### Threats
1. **Automating drift** — loops that can't prove they're done
2. **Cost explosion** — without budget caps, loops burn money
3. **Stale context** — long runs lose relevance
4. **Scope creep** — agents edit beyond their mandate
5. **Model degradation** — free models may produce lower quality over time

---

## Competitive Analysis: How Others Build Agent Loops (2026)

### Jack Njoroge — Operator Loop Stack
```
Harness → Loop Contract → State Layer → Checker → Human Checkpoint
```
**Key insight:** "If the agent cannot prove it is done, you are not engineering a loop; you are automating drift."

### Inngest — Durable Agent Loops
```
Loop (unit of work) → Skill (asset) → Orchestrator (durable execution)
```
**Key insight:** "Skills compound. Each new skill makes every loop more capable."

### Kunal Ganglani — Claude Code Loop Engineering
```
CLAUDE.md (conventions) → Skills (repeatable procedures) → Subagents (isolation) → Hooks (automation)
```
**Key insight:** "Stop hook that checks test results — this single hook eliminated the most common failure mode."

### freeCodeCamp — Software Factory Pattern
```
7 specialized agents + 1 orchestrator = full pipeline
```
Agents: researcher → story-writer → spec-writer → backend-builder → frontend-builder → test-verifier → validator

### Anthropic — Build Effective Agents
```
Gather context → Take action → Verify results → Repeat
```
**Key insight:** "Agents without a feedback signal plateau fast."

### Product Rocket — MVP Agent Orchestration
```
Ingest → Reason → Act → Verify → Deliver
```
**Key insight:** "Resist multi-agent swarms until a linear pipeline breaks."

---

## Gap Analysis: What We're Missing

| Pattern | Industry Standard | Cursor Orchestra | Gap |
|---------|-------------------|------------------|-----|
| Convergence criteria | Tests must pass, diff must be empty | Max iterations only | **Critical** |
| Human checkpoints | Required for consequential actions | None | **Critical** |
| Budget enforcement | Tokens + cost + time limits | Step limits only | **High** |
| Stall detection | Identical failure feedback = stuck | Heartbeat only | **High** |
| Branch isolation | Git worktree per agent | Direct edits | **Medium** |
| Durable skills | Checkpoint/resume within skills | Static instructions | **Medium** |
| Operator Loop Stack | 5-layer framework | Ad-hoc | **Medium** |

---

## Recommendations (Priority Order)

### P0 — Critical (must fix)
1. **Add convergence criteria** — Verifier must require tests to pass before PASS
2. **Add human checkpoints** — skill should pause for approval on high-risk changes
3. **Add budget tracking** — tokens consumed per phase, abort if exceeded

### P1 — High (should fix)
4. **Add stall detection** — if verifier fails with same feedback twice, abort
5. **Add Operator Loop Stack** — formalize harness, contract, state, checker, checkpoint
6. **Add MVP mode** — 3-agent pipeline (plan→build→verify) for rapid prototyping

### P2 — Medium (nice to have)
7. **Add branch isolation** — git worktree per agent run
8. **Make skills durable** — step-level checkpointing
9. **Add version releases** — v1.0, v1.1 with feature targets

---

## Token Optimization Audit

### Current State
- Step limits: planner(8), implementer(25), verifier(10), reviewer(5)
- Model routing: budget for planner/verifier/reviewer, capable for implementer
- Compaction: guidance to enable prune:true

### Gaps
1. **No token counting** — agents don't track tokens consumed
2. **No cost estimation** — no idea how much each run costs
3. **No context pruning** — agents read files but don't drop old context
4. **No output limits** — agents can produce verbose output

### Recommendations
1. Add token budget per agent (planner: 10k, implementer: 30k, verifier: 15k, reviewer: 8k)
2. Add cost estimation based on model pricing
3. Add output line limits (planner: 50, implementer: 100, verifier: 30, reviewer: 30)
4. Add context loading guidance (read only what you need, grep over read)

---

## Code Quality Audit

### Current State
- Code standards documented in `context/code-standards.md`
- Architecture documented in `context/architecture.md`
- Progress tracked in `context/progress-tracker.md`

### Gaps
1. **No linting enforcement** — Verifier runs lint but doesn't fail on warnings
2. **No type checking** — Verifier doesn't run TypeScript checks
3. **No test coverage** — no minimum coverage requirement
4. **No security scanning** — no dependency audit

### Recommendations
1. Add lint warnings as FAIL condition
2. Add TypeScript type check to Verifier
3. Add test coverage threshold (80% minimum)
4. Add `npm audit` to Verifier checklist

---

## Balance Assessment

### What's Balanced
- Agent responsibilities (clear separation)
- Token budgets (step limits)
- Documentation (comprehensive)

### What's Imbalanced
- **Too much automation, too little human oversight** — need HITL checkpoints
- **Too much flexibility, too little convergence** — need test-enforced exit
- **Too much optimism, too little verification** — need stall detection
- **Too much scope, too little focus** — need MVP mode

### Target State
- 70% automation, 30% human checkpoints
- 100% convergence criteria (tests must pass)
- 100% stall detection (identical failure = abort)
- 80% focused scope (MVP mode for simple tasks)

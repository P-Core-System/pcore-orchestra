---
title: SMART & SWOT Audit
description: Strategic analysis of pcore-agents — strengths, weaknesses, opportunities, threats, and gap recommendations with resolution status.
last_updated: 2026-07-13
tags: [audit, smart, swot, analysis, gap-analysis]
related: [orchestration-patterns.md, token-optimization.md]
---

# P-Core Agents — SMART & SWOT Audit

> **TL;DR:** SMART score improved from 6.8→7.4/10. All 3 critical gaps (convergence, human checkpoints, budget) resolved. 2 medium gaps remain (durable skills, branch isolation).

---

## SMART Analysis

| Criteria | Assessment | Score | Status |
|----------|------------|-------|--------|
| **Specific** | Clear goal: ambient multi-agent orchestration for Cursor + OpenCode with plan→implement→verify→review pipeline | 8/10 | ✅ |
| **Measurable** | Step limits, token budgets, health checks, iteration caps | 8/10 | ✅ Improved |
| **Achievable** | Core features built; convergence criteria and human checkpoints added | 9/10 | ✅ Improved |
| **Relevant** | Agent orchestration is the dominant pattern in 2026 (Loop Engineering) | 9/10 | ✅ |
| **Time-bound** | **No deadlines, no milestones, no release schedule** — gap remains | 3/10 | ⚠️ |

**Overall SMART Score: 7.4/10** (was 6.8/10)

**Key gap:** Time-bound. Without milestones, work drifts. Recommendation: add versioned releases (v1.0, v1.1) with specific feature targets.

---

## SWOT Analysis

### Strengths ✅

| # | Strength | Status |
|---|----------|--------|
| 1 | **Clean architecture** — four agents with clear separation of concerns | ✅ |
| 2 | **Token optimization built-in** — step limits, model routing, compaction guidance | ✅ Enhanced |
| 3 | **Free model support** — OpenCode proxy with multi-key rotation | ✅ |
| 4 | **State persistence** — V2 schema with lifecycle, heartbeat, memory | ✅ |
| 5 | **Health checks** — automated verification of system integrity | ✅ |
| 6 | **Documentation** — comprehensive docs for each feature | ✅ Enhanced |
| 7 | **Convergence criteria** — tests pass, diff empty, lint clean, judge passes | ✅ NEW |
| 8 | **Stall detection** — identical failures → strategy change → escalate | ✅ NEW |
| 9 | **Human checkpoints** — auth/payments/security require human review | ✅ NEW |
| 10 | **Token budgets per agent** — 63k max per cycle | ✅ NEW |

### Weaknesses (Resolved) ✅

| # | Weakness | Resolution | Status |
|---|----------|------------|--------|
| 1 | No convergence criteria | Added tests pass, diff empty, lint clean, judge | ✅ Resolved |
| 2 | No test enforcement | Verifier now requires tests to pass before PASS | ✅ Resolved |
| 3 | No human checkpoints | Reviewer triggers for high-risk changes | ✅ Resolved |
| 4 | No stall detection in agents | Verifier detects identical failures, escalates after 3rd | ✅ Resolved |
| 5 | No budget enforcement | Token budgets per agent (63k max/cycle) | ✅ Resolved |

### Weaknesses (Remaining) ⚠️

| # | Weakness | Priority | Impact |
|---|----------|----------|--------|
| 6 | Skills are instructions, not durable workflows | Medium | No checkpoint/resume within skills |
| 7 | No branch isolation | Medium | Agents edit directly, no worktree protection |

### Opportunities (Pursued) ✅

| # | Opportunity | Status |
|---|-------------|--------|
| 1 | Add convergence criteria | ✅ Implemented |
| 2 | Add Operator Loop Stack | ✅ Documented |
| 3 | Add stall detection | ✅ Implemented |
| 4 | Add human checkpoints | ✅ Implemented |
| 5 | Add token budgets | ✅ Implemented |

### Opportunities (Remaining) 🔜

| # | Opportunity | Priority | Effort |
|---|-------------|----------|--------|
| 6 | Make skills durable (checkpoint/resume) | Medium | High |
| 7 | Add branch isolation (git worktree) | Medium | Medium |
| 8 | Add MVP mode (3-agent pipeline) | Low | Low |
| 9 | Add version releases (v1.0, v1.1) | Low | Low |

### Threats (Mitigated) ✅

| # | Threat | Mitigation |
|---|--------|------------|
| 1 | Automating drift | Convergence criteria + stall detection |
| 2 | Cost explosion | Token budgets + step limits |
| 3 | Stale context | Heartbeat + session refresh |
| 4 | Scope creep | Reviewer checks scope, human checkpoints |

### Threats (Remaining) ⚠️

| # | Threat | Mitigation |
|---|--------|------------|
| 5 | Model degradation | Use proven models, monitor quality |

---

## Competitive Analysis: How Others Build Agent Loops (2026)

### Jack Njoroge — Operator Loop Stack
```
Harness → Loop Contract → State Layer → Checker → Human Checkpoint
```
**Key insight:** "If the agent cannot prove it is done, you are not engineering a loop; you are automating drift."

**Status:** ✅ Adopted — we follow this pattern

### Inngest — Durable Agent Loops
```
Loop (unit of work) → Skill (asset) → Orchestrator (durable execution)
```
**Key insight:** "Skills compound. Each new skill makes every loop more capable."

**Status:** ⚠️ Partially adopted — skills are instructions, not durable workflows

### Kunal Ganglani — Claude Code Loop Engineering
```
CLAUDE.md (conventions) → Skills (repeatable procedures) → Subagents (isolation) → Hooks (automation)
```
**Key insight:** "Stop hook that checks test results — this single hook eliminated the most common failure mode."

**Status:** ✅ Adopted — hooks enforce verification

### freeCodeCamp — Software Factory Pattern
```
7 specialized agents + 1 orchestrator = full pipeline
```
Agents: researcher → story-writer → spec-writer → backend-builder → frontend-builder → test-verifier → validator

**Status:** ⚠️ Not adopted — our 4-agent pipeline is simpler, which is intentional

### Anthropic — Build Effective Agents
```
Gather context → Take action → Verify results → Repeat
```
**Key insight:** "Agents without a feedback signal plateau fast."

**Status:** ✅ Adopted — ReAct pattern in each agent

### Product Rocket — MVP Agent Orchestration
```
Ingest → Reason → Act → Verify → Deliver
```
**Key insight:** "Resist multi-agent swarms until a linear pipeline breaks."

**Status:** ✅ Adopted — we use linear pipeline

---

## Gap Analysis: What We're Missing

| Pattern | Industry Standard | Cursor Orchestra | Gap | Status |
|---------|-------------------|------------------|-----|--------|
| Convergence criteria | Tests must pass, diff must be empty | ✅ Added | None | ✅ Resolved |
| Human checkpoints | Required for consequential actions | ✅ Added | None | ✅ Resolved |
| Budget enforcement | Tokens + cost + time limits | ✅ Added (tokens) | Cost/time tracking | ⚠️ Partial |
| Stall detection | Identical failure feedback = stuck | ✅ Added | None | ✅ Resolved |
| Branch isolation | Git worktree per agent | Direct edits | Not implemented | ⚠️ Remaining |
| Durable skills | Checkpoint/resume within skills | Static instructions | Not implemented | ⚠️ Remaining |
| Operator Loop Stack | 5-layer framework | ✅ Adopted | None | ✅ Resolved |

---

## Recommendations (Priority Order)

### P0 — Critical (ALL RESOLVED) ✅

| # | Recommendation | Status |
|---|----------------|--------|
| 1 | Add convergence criteria — Verifier must require tests to pass before PASS | ✅ Done |
| 2 | Add human checkpoints — skill should pause for approval on high-risk changes | ✅ Done |
| 3 | Add budget tracking — tokens consumed per phase, abort if exceeded | ✅ Done |

### P1 — High (PARTIALLY RESOLVED)

| # | Recommendation | Status |
|---|----------------|--------|
| 4 | Add stall detection — if verifier fails with same feedback twice, abort | ✅ Done |
| 5 | Add Operator Loop Stack — formalize harness, contract, state, checker, checkpoint | ✅ Done |
| 6 | Add MVP mode — 3-agent pipeline (plan→build→verify) for rapid prototyping | ⚠️ Remaining |

### P2 — Medium (REMAINING)

| # | Recommendation | Status |
|---|----------------|--------|
| 7 | Add branch isolation — git worktree per agent run | ⚠️ Remaining |
| 8 | Make skills durable — step-level checkpointing | ⚠️ Remaining |
| 9 | Add version releases — v1.0, v1.1 with feature targets | ⚠️ Remaining |

---

## Token Optimization Audit

### Before
- Step limits: planner(8), implementer(25), verifier(10), reviewer(5)
- Model routing: budget for planner/verifier/reviewer, capable for implementer
- Compaction: guidance to enable prune:true

### After ✅
- Token budgets per agent: planner(10k), implementer(30k), verifier(15k), reviewer(8k)
- Total per cycle: ~63k max (was unlimited)
- Cost estimation: $0.03-0.11 per cycle (budget mix)

### Remaining Gaps
1. **No cost tracking** — agents don't report tokens consumed
2. **No time tracking** — no wall-clock budget enforcement

---

## Code Quality Audit

### Before
- Code standards documented in `context/code-standards.md`
- Architecture documented in `context/architecture.md`
- Progress tracked in `context/progress-tracker.md`

### After ✅
- Clean code checklist added to code standards
- Single responsibility, early returns, descriptive names enforced
- Verifier requires tests to pass before PASS

### Remaining Gaps
1. **No test coverage threshold** — no minimum coverage requirement
2. **No security scanning** — no dependency audit

---

## Balance Assessment

### What's Balanced
- Agent responsibilities (clear separation)
- Token budgets (step limits + token limits)
- Documentation (comprehensive)

### What Was Imbalanced (Now Fixed) ✅
- **Too much automation, too little human oversight** → Added human checkpoints
- **Too much flexibility, too little convergence** → Added test-enforced exit
- **Too much optimism, too little verification** → Added stall detection

### What's Still Imbalanced ⚠️
- **Too much scope, too little focus** — need MVP mode for simple tasks

### Target State
- 70% automation, 30% human checkpoints ✅
- 100% convergence criteria (tests must pass) ✅
- 100% stall detection (identical failure = abort) ✅
- 80% focused scope (MVP mode for simple tasks) ⚠️

---

## Progress Since Last Audit

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| SMART Score | 6.8/10 | 7.4/10 | +0.6 |
| Critical gaps | 3 | 0 | -3 |
| High gaps | 2 | 1 | -1 |
| Medium gaps | 3 | 3 | 0 |
| Convergence criteria | ❌ | ✅ | +1 |
| Stall detection | ❌ | ✅ | +1 |
| Human checkpoints | ❌ | ✅ | +1 |
| Token budgets | Unlimited | 63k/cycle | -100% |

---
title: Orchestration Patterns
description: How cursor-orchestra chains agents, why we chose Prompt Chaining + ReAct, and how to adapt it for your own workflows.
last_updated: 2026-07-13
tags: [orchestration, patterns, react, prompt-chaining, agent-loop]
related: [audit-smart-swot.md, token-optimization.md]
---

# Orchestration Patterns

How cursor-orchestra chains agents, why we chose this pattern, and how to adapt it.

> **TL;DR:** We use Prompt Chaining (plan→implement→verify→review) with ReAct (reason→act→observe→reflect) inside each agent. This gives us simplicity + adaptability without the complexity of full supervisor-worker patterns.

## The Pattern We Use: Prompt Chaining + ReAct

```
┌─────────────────────────────────────────────────────────────┐
│                     User Prompt                              │
│               "fix the login bug"                            │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  orchestra-planner                                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ THOUGHT: What files are involved? What's the bug?   │   │
│  │ ACTION: grep for auth patterns, read relevant files  │   │
│  │ OBSERVATION: Found null check missing in auth.ts:42  │   │
│  │ REFLECT: Simple fix, no architecture changes needed  │   │
│  └─────────────────────────────────────────────────────┘   │
│  Output: structured plan (50 lines max)                     │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  orchestra-implementer                                      │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ THOUGHT: Add null check before session access       │   │
│  │ ACTION: edit auth.ts:42                              │   │
│  │ OBSERVATION: Edit applied successfully               │   │
│  │ REFLECT: Run syntax check to verify                  │   │
│  └─────────────────────────────────────────────────────┘   │
│  Output: files changed + validation results                 │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  orchestra-verifier                                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ THOUGHT: What could this change break?               │   │
│  │ ACTION: run auth tests, check for null pointer       │   │
│  │ OBSERVATION: All 12 auth tests pass                  │   │
│  │ REFLECT: Convergence criteria met (tests pass)       │   │
│  └─────────────────────────────────────────────────────┘   │
│  Output: VERIFY_PASS                                        │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  orchestra-reviewer                                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ THOUGHT: Is this change reversible? Scope correct?   │   │
│  │ ACTION: review diff, check for security issues       │   │
│  │ OBSERVATION: Clean fix, no scope creep               │   │
│  │ REFLECT: Approve — low risk, high confidence         │   │
│  └─────────────────────────────────────────────────────┘   │
│  Output: ORCHESTRA_COMPLETE                                 │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  User receives summary of changes                           │
└─────────────────────────────────────────────────────────────┘
```

---

## Patterns Considered

### 1. Prompt Chaining (what we use)

**Fixed sequence: plan → implement → verify → review**

```
Input → [Agent 1] → [Agent 2] → [Agent 3] → [Agent 4] → Output
```

| Aspect | Assessment |
|--------|------------|
| **Simplicity** | ★★★★★ Easiest to implement and debug |
| **Reliability** | ★★★★☆ Predictable behavior, clear failure modes |
| **Token efficiency** | ★★★★☆ Each agent only sees its input |
| **Adaptability** | ★★★☆☆ Fixed sequence may not suit all tasks |
| **Parallelism** | ★★☆☆☆ Sequential by nature |

**When to use:**
- Deterministic workflows with clear phase transitions
- Each phase has a single well-defined output
- Simple error handling (retry last phase)

### 2. ReAct (embedded in each agent)

**Reason → Act → Observe → Reflect cycle**

```
┌─────────────────────────────────────┐
│  Agent (e.g., implementer)          │
│                                     │
│  ┌─────────────────────────────┐   │
│  │ THOUGHT: What should I do?  │   │
│  │         ↓                   │   │
│  │ ACTION: Execute tool call   │   │
│  │         ↓                   │   │
│  │ OBSERVATION: What happened? │   │
│  │         ↓                   │   │
│  │ REFLECT: Did it work?       │   │
│  │         ↓                   │   │
│  │ [loop back to THOUGHT]      │   │
│  └─────────────────────────────┘   │
└─────────────────────────────────────┘
```

| Aspect | Assessment |
|--------|------------|
| **Simplicity** | ★★★☆☆ Requires clear reflection prompts |
| **Reliability** | ★★★★☆ Catches errors early |
| **Token efficiency** | ★★★☆☆ Reasoning overhead per step |
| **Adaptability** | ★★★★★ Can change strategy based on observations |
| **Parallelism** | ★★★☆☆ Single agent, sequential actions |

**When to use:**
- Complex tasks requiring adaptive behavior
- Tasks where the agent needs to recover from errors
- Multi-step operations with uncertain outcomes

### 3. Supervisor Pattern

**Central coordinator delegates to workers**

```
         ┌──────────────┐
         │  Supervisor   │
         └──────┬───────┘
    ┌───────────┼───────────┐
    ▼           ▼           ▼
┌────────┐ ┌────────┐ ┌────────┐
│Worker 1│ │Worker 2│ │Worker 3│
└────────┘ └────────┘ └────────┘
    │           │           │
    └───────────┼───────────┘
                ▼
         ┌──────────────┐
         │   Results     │
         └──────────────┘
```

| Aspect | Assessment |
|--------|------------|
| **Simplicity** | ★★★☆☆ Coordination overhead |
| **Reliability** | ★★★★☆ Worker failures don't block whole task |
| **Token efficiency** | ★★★☆☆ Each worker gets own context |
| **Adaptability** | ★★★★☆ Workers can be specialized |
| **Parallelism** | ★★★★★ True parallel execution |

**When to use:**
- Multiple independent subtasks
- Results need aggregation or comparison
- Worker failures should not block the whole task

### 4. Hierarchical (orchestrator-workers)

**Multi-level delegation**

```
         ┌──────────────┐
         │  Orchestrator │
         └──────┬───────┘
    ┌───────────┼───────────┐
    ▼           ▼           ▼
┌────────┐ ┌────────┐ ┌────────┐
│Sub-Org │ │Sub-Org │ │Sub-Org │
└───┬────┘ └───┬────┘ └───┬────┘
    │          │          │
    ▼          ▼          ▼
┌────────┐ ┌────────┐ ┌────────┐
│Workers │ │Workers │ │Workers │
└────────┘ └────────┘ └────────┘
```

| Aspect | Assessment |
|--------|------------|
| **Simplicity** | ★☆☆☆☆ Complex to implement |
| **Reliability** | ★★★☆☆ Deep chains hard to debug |
| **Token efficiency** | ★★☆☆☆ High coordination overhead |
| **Adaptability** | ★★★★★ Each level specialized |
| **Parallelism** | ★★★★★ Scales to complex projects |

**When to use:**
- Very large tasks with many independent components
- Need for deep specialization at each level
- Enterprise-scale workflows

---

## Why Cursor Orchestra Uses Prompt Chaining + ReAct

### Decision Matrix

| Criterion | Chaining | ReAct | Supervisor | Hierarchical |
|-----------|----------|-------|------------|--------------|
| Implementation difficulty | ★ | ★★★ | ★★★★ | ★★★★★ |
| Debugging ease | ★ | ★★★ | ★★★ | ★★★★★ |
| Token efficiency | ★★ | ★★★ | ★★★ | ★★★★ |
| Adaptability | ★★ | ★★★★★ | ★★★★ | ★★★★★ |
| **Our choice** | ✅ | ✅ | Partial | ❌ |

### Rationale

1. **Simplicity**: Prompt chaining is the easiest to implement, debug, and maintain.
2. **Reliability**: Fixed phases mean predictable behavior and clear failure modes.
3. **Token efficiency**: Each agent only receives its specific input, not full history.
4. **Adaptability**: ReAct inside each agent allows error recovery without breaking the pipeline.
5. **Clear ownership**: Each phase has one job — no ambiguity about who does what.

### Why not pure ReAct?

A pure ReAct agent (single agent doing everything) works for simple tasks but:
- Token costs explode with context growth
- Hard to enforce constraints (e.g., "read-only reviewer")
- No clear separation of concerns

### Why not full supervisor-workers?

Full supervisor pattern with parallel workers:
- Adds coordination complexity
- Requires result aggregation logic
- Overkill for most coding tasks (sequential by nature)

---

## Error Handling

### Phase-level errors

| Error | Response |
|-------|----------|
| `VERIFY_FAIL` | Re-run implementer with numbered fixes from verifier |
| `FIX_REQUIRED` | Re-run implementer with numbered fixes from reviewer |
| Max iterations (8) | Abort and escalate to human |

### Agent-level errors

| Error | Response |
|-------|----------|
| Step limit reached | Agent summarizes work, recommends next steps |
| Tool call fails | Agent reflects, tries alternative approach |
| Identical failure 2x | Stall detected — try different strategy |
| Identical failure 3x | Abort — escalate to human |

### Recovery strategies

1. **Retry last phase**: Most common — implementer fixes what verifier found
2. **Fresh context**: Summarize failures, start clean (long failed transcripts poison attempts)
3. **Different strategy**: Plan step must propose materially different approach
4. **Abort to human**: File the issue, post summary, stop

---

## Convergence Criteria

The loop exits when ANY of these are true:

| Signal | Strength | Description | Example |
|--------|----------|-------------|---------|
| Tests pass | Strongest | All relevant tests pass | `pytest` returns 0 |
| Diff empty | Strong | No changes in last iteration | `git diff` shows nothing |
| Lint clean | Medium | Zero lint errors | `eslint` returns 0 |
| Judge passes | Weakest | Reviewer approves | `ORCHESTRA_COMPLETE` |

**Key insight**: Check for **progress**, not just completion. If verification fails with identical feedback 2 iterations in a row, the loop is stuck, not converging.

---

## Stall Detection

```
Iteration 1: FAIL — "null pointer in auth.ts:42"
Iteration 2: FAIL — "null pointer in auth.ts:42"  ← STALL DETECTED
    │
    ├─► Try different strategy (fresh context, alternative approach)
    │
    ▼
Iteration 3: FAIL — "null pointer in auth.ts:42"  ← 3RD FAILURE
    │
    └─► ABORT — escalate to human
```

**Why this matters**: Without stall detection, a loop that fails identically burns tokens without progress. The Operator Test: "If the agent cannot prove it is done, you are not engineering a loop; you are automating drift."

---

## Human Checkpoints

Required for:
- **Auth/payments/security changes** — high-risk, need human judgment
- **Budget exhaustion** — max iterations/tokens/time hit
- **Unresolvable failures** — 3rd identical error
- **Scope creep** — agent touching out-of-scope files

---

## Token Budgets

| Agent | Max Tokens | Max Output | Model | Why |
|-------|------------|------------|-------|-----|
| Planner | 10,000 | 50 lines | Budget | Read-only, simple task |
| Implementer | 30,000 | 100 lines | Capable | Complex coding |
| Verifier | 15,000 | 30 lines | Budget | Run checks, report results |
| Reviewer | 8,000 | 30 lines | Budget | Read-only, simple task |

**Total per cycle:** ~63k tokens max

---

## References

- [ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629)
- [Building Effective Agents — Anthropic](https://docs.anthropic.com/en/docs/build-with-claude/agent-patterns)
- [Loop Engineering — Jack Njoroge](https://www.jacknjoroge.com/loop-engineering/)
- [The Agent Loop Architecture — Inngest](https://www.inngest.com/blog/agent-loop-architecture)
- [Loop Engineering — Kunal Ganglani](https://www.kunalganglani.com/blog/loop-engineering-agent-loops)
- [How to Build a Software Factory — freeCodeCamp](https://www.freecodecamp.org/news/how-to-build-software-factory-with-claude-code/)

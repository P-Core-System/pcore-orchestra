# Orchestration Patterns

This document explains the orchestration patterns used in cursor-orchestra and the research behind these choices.

## Patterns considered

### 1. Prompt Chaining (sequential pipeline)

**What:** Fixed sequence of agents, each output feeds the next.

**Used in cursor-orchestra:** Yes — our core loop is `plan → implement → verify → review`.

**When to use:**
- Deterministic workflows with clear phase transitions
- Each phase has a single well-defined output
- Simple error handling (retry last phase)

**Pros:**
- Simple to implement and reason about
- Easy to debug (clear input/output per phase)
- Low token overhead (each agent only sees its input)

**Cons:**
- No mid-phase corrections
- Fixed sequence may not suit all tasks
- Errors propagate to next phase

### 2. ReAct (Reason + Act)

**What:** Agent reasons about what to do, acts, observes result, reflects, then decides next step.

**Used in cursor-orchestra:** Yes — embedded within each agent.

**When to use:**
- Complex tasks requiring adaptive behavior
- Tasks where the agent needs to recover from errors
- Multi-step operations with uncertain outcomes

**Pros:**
- Catches errors early (reflect after each action)
- Adaptible — can change strategy based on observations
- Reduces cascading mistakes

**Cons:**
- Higher token cost per step (reasoning overhead)
- Can overthink simple tasks
- Requires clear reflection prompts

### 3. Supervisor pattern

**What:** Central coordinator that delegates to specialized workers and synthesizes results.

**Used in cursor-orchestra:** Partially — the main agent acts as supervisor launching subagents.

**When to use:**
- Multiple independent subtasks
- Results need aggregation or comparison
- Worker failures should not block the whole task

**Pros:**
- Parallel execution possible
- Clear ownership per subtask
- Easy to add/remove workers

**Cons:**
- Supervisor needs to understand all worker outputs
- Coordination overhead
- Worker results may conflict

### 4. Hierarchical (orchestrator-workers)

**What:** Multi-level delegation — orchestrator delegates to sub-orchestrators, who delegate to workers.

**Used in cursor-orchestra:** No — flat structure preferred for simplicity.

**When to use:**
- Very large tasks with many independent components
- Need for deep specialization at each level
- Enterprise-scale workflows

**Pros:**
- Scales to complex projects
- Each level has clear responsibility

**Cons:**
- Complex to implement
- High coordination overhead
- Deep delegation chains hard to debug

## Why cursor-orchestra uses Prompt Chaining + ReAct

### Chosen architecture

```
User prompt
    ↓
[Supervisor: main agent]
    ↓
orchestra-planner (ReAct inside)
    ↓ plan
orchestra-implementer (ReAct inside)
    ↓ changes
orchestra-verifier (ReAct inside)
    ↓ verdict
orchestra-reviewer (ReAct inside)
    ↓ verdict
User gets summary
```

### Rationale

1. **Simplicity**: Prompt chaining is the easiest to implement, debug, and maintain.
2. **Reliability**: Fixed phases mean predictable behavior and clear failure modes.
3. **Token efficiency**: Each agent only receives its specific input, not full history.
4. **Adaptability within phases**: ReAct inside each agent allows error recovery without breaking the pipeline.
5. **Clear ownership**: Each phase has one job — no ambiguity about who does what.

### Why not pure ReAct loop?

A pure ReAct agent (single agent doing everything) works for simple tasks but:
- Token costs explode with context growth
- Hard to enforce constraints (e.g., "read-only reviewer")
- No clear separation of concerns

### Why not full supervisor-workers?

Full supervisor pattern with parallel workers:
- Adds coordination complexity
- Requires result aggregation logic
- Overkill for most coding tasks (sequential by nature)

## ReAct in practice

Each agent follows this internal loop:

```
1. THOUGHT: What's the current situation? What should I do next?
2. ACTION: Execute one tool call (read, edit, bash, grep)
3. OBSERVATION: What happened? Any errors?
4. REFLECT: Did it work? What did I learn? What's next?
```

This is embedded in agent prompts without requiring framework support.

## Error handling

### Phase-level errors

- **VERIFY_FAIL**: Re-run implementer with numbered fixes from verifier
- **FIX_REQUIRED**: Re-run implementer with numbered fixes from reviewer
- **Max iterations**: 8 (prevents infinite loops)

### Agent-level errors

- Each agent has step limits (planner: 8, implementer: 25, verifier: 10, reviewer: 5)
- Agents return structured output with clear success/failure signals
- Parent agent decides whether to continue or abort

### Recovery strategies

1. **Retry last phase**: Most common — implementer fixes what verifier found
2. **Skip to review**: If verifier passes but reviewer finds issues
3. **Abort**: If max iterations reached or unrecoverable error

## References

- [ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629)
- [Building Effective Agents — Anthropic](https://docs.anthropic.com/en/docs/build-with-claude/agent-patterns)
- [Prompt Chaining for Complex Workflows](https://www.anthropic.com/engineering/building-effective-agents)
- [Agent Loop Optimization](https://opencode.ai/docs/agents)

# Harness > Scaffold > Loop Architecture

## Overview

Cursor Orchestra implements a three-layer agent architecture:

```
┌─────────────────────────────────────────────────────────────┐
│                        HARNESS                              │
│  (execution, state, error handling, orchestration)          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    SCAFFOLD                         │   │
│  │  (prompts, tools, context, memory)                  │   │
│  │  ┌─────────────────────────────────────────────┐   │   │
│  │  │                  LOOP                       │   │   │
│  │  │  (think → act → observe → repeat)           │   │   │
│  │  └─────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Layer Definitions

### Loop (Core)

The innermost layer: the ReAct pattern implementation.

- **What it does:** Implements the ReAct cycle: think → act → observe → repeat until done
- **In cursor-orchestra:** The phase chain (plan → implement → verify → review)
- **Files:** `bundle/hooks/orchestra-lib.js` (PHASE_CHAIN, state transitions)

### Scaffold (Structural)

The behavior-defining layer around the loop.

- **What it does:** Defines system prompts, tool descriptions, context management, memory
- **In cursor-orchestra:** Agent markdown files, six-file context injection, ambient policy
- **Files:** `bundle/agents/*.md`, `bundle/skills/orchestra-loop/`, context detection

### Harness (Execution)

The complete software layer that makes the agent run.

- **What it does:** Calls the model, handles tool invocations, manages state, error recovery
- **In cursor-orchestra:** Hook scripts, state persistence, phase chaining, error handling
- **Files:** `bundle/hooks/*.js`, `~/.cursor/hooks/state/orchestra.json`, install scripts

## Mapping to Cursor Orchestra

| Layer | Cursor Orchestra Component | Responsibility |
|-------|---------------------------|----------------|
| **Loop** | Phase chain (plan→implement→verify→review) | Execution cycle |
| **Scaffold** | Agent prompts, context injection, ambient policy | Behavior definition |
| **Harness** | Hook scripts, state management, error handling | Runtime execution |

## Design Principles

1. **Harness thickness:** Start thin, add structure only when failure patterns recur
2. **Scaffold portability:** Agent prompts should work across different harnesses
3. **Loop determinism:** Phase transitions should be predictable and auditable

## References

- HuggingFace Agent Glossary — "Agentic Design Patterns" (https://huggingface.co/docs/transformers/agents)
- Addy Osmani — "Building AI Agent Harnesses" (Chrome DevRel / AI engineering blog)
- Martin Fowler — "Harness Engineering" (martinfowler.com)
- Anthropic — Claude Code documentation (https://docs.anthropic.com/en/docs/claude-code)

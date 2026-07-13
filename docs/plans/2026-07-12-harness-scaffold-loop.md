# Harness > Scaffold > Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Explicitly document and structure the harness > scaffold > loop hierarchy in cursor-orchestra, standardizing terminology and adding conceptual architecture documentation.

**Architecture:** Add a new context file explaining the three-layer architecture (harness, scaffold, loop), update existing documentation to use consistent terminology, and potentially refactor code to explicitly reflect these layers.

**Tech Stack:** Markdown documentation, Node.js hooks, existing cursor-orchestra infrastructure

---

## Context: The Hierarchy

Based on 2026 AI agent engineering research:

- **Harness** = complete software layer around the model (execution, state, error handling, orchestration)
- **Scaffold** = structural layer (prompts, tools, context, memory)  
- **Loop** = core ReAct pattern (think → act → observe → repeat)

The cursor-orchestra system already implements these concepts implicitly. This plan makes them explicit.

---

### Task 1: Create Architecture Documentation

**Files:**
- Create: `context/harness-scaffold-loop.md`

- [ ] **Step 1: Write the failing test**

```markdown
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

- **What it does:** Calls the model, executes tool calls, feeds results back, repeats until done
- **In cursor-orchestra:** The phase chain (plan → implement → verify → review)
- **Files:** `orchestra-lib.js` (PHASE_CHAIN, state transitions)

### Scaffold (Structural)

The behavior-defining layer around the loop.

- **What it does:** Defines system prompts, tool descriptions, context management, memory
- **In cursor-orchestra:** Agent markdown files, six-file context injection, ambient policy
- **Files:** `bundle/agents/*.md`, `bundle/skills/orchestra-loop/`, context detection

### Harness (Execution)

The complete software layer that makes the agent run.

- **What it does:** Calls the model, handles tool invocations, manages state, error recovery
- **In cursor-orchestra:** Hook scripts, state persistence, phase chaining, error handling
- **Files:** `bundle/hooks/*.js`, `orchestra.json`, install scripts

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

- HuggingFace Agent Glossary (2026)
- Addy Osmani's Agent Harness Engineering
- Martin Fowler's Harness Engineering article
- Anthropic's Claude Code documentation
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cat context/harness-scaffold-loop.md`
Expected: File not found

- [ ] **Step 3: Write minimal implementation**

Create the file with the content from Step 1.

- [ ] **Step 4: Run test to verify it passes**

Run: `cat context/harness-scaffold-loop.md`
Expected: File exists with the architecture documentation

- [ ] **Step 5: Commit**

```bash
git add context/harness-scaffold-loop.md
git commit -m "docs: add harness > scaffold > loop architecture documentation"
```

---

### Task 2: Update Architecture Context File

**Files:**
- Modify: `context/architecture.md`

- [ ] **Step 1: Write the failing test**

```markdown
Add a new section to architecture.md:

## Agent Architecture: Harness > Scaffold > Loop

Cursor Orchestra implements a three-layer agent architecture (see `context/harness-scaffold-loop.md` for full details):

- **Loop:** Phase chain (plan → implement → verify → review)
- **Scaffold:** Agent prompts, context injection, ambient policy  
- **Harness:** Hook scripts, state management, error handling

The harness calls the scaffold, which defines the loop behavior.
```

- [ ] **Step 2: Run test to verify it fails**

Run: `grep -n "Harness > Scaffold > Loop" context/architecture.md`
Expected: No matches

- [ ] **Step 3: Write minimal implementation**

Add the new section to architecture.md.

- [ ] **Step 4: Run test to verify it passes**

Run: `grep -n "Harness > Scaffold > Loop" context/architecture.md`
Expected: Found the new section

- [ ] **Step 5: Commit**

```bash
git add context/architecture.md
git commit -m "docs: reference harness > scaffold > loop in architecture context"
```

---

### Task 3: Update README with Architecture Section

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Write the failing test**

```markdown
Add a new section after "How it works":

## Architecture: Harness > Scaffold > Loop

Cursor Orchestra implements a three-layer agent architecture:

- **Loop:** The execution cycle (plan → implement → verify → review)
- **Scaffold:** Behavior definition (agent prompts, context injection)
- **Harness:** Runtime execution (hooks, state management, error handling)

See `context/harness-scaffold-loop.md` for full details.
```

- [ ] **Step 2: Run test to verify it fails**

Run: `grep -n "Harness > Scaffold > Loop" README.md`
Expected: No matches

- [ ] **Step 3: Write minimal implementation**

Add the new section to README.md.

- [ ] **Step 4: Run test to verify it passes**

Run: `grep -n "Harness > Scaffold > Loop" README.md`
Expected: Found the new section

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: add harness > scaffold > loop section to README"
```

---

### Task 4: Update AGENTS.md with Architecture Reference

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Write the failing test**

```markdown
Add to the "Read the following files in order" section:

0. `context/harness-scaffold-loop.md` — agent architecture hierarchy (harness, scaffold, loop)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `grep -n "harness-scaffold-loop" AGENTS.md`
Expected: No matches

- [ ] **Step 3: Write minimal implementation**

Add the reference to AGENTS.md.

- [ ] **Step 4: Run test to verify it passes**

Run: `grep -n "harness-scaffold-loop" AGENTS.md`
Expected: Found the reference

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md
git commit -m "docs: add harness-scaffold-loop to AGENTS.md context read order"
```

---

### Task 5: Update Code Standards with Terminology

**Files:**
- Modify: `context/code-standards.md`

- [ ] **Step 1: Write the failing test**

```markdown
Add a new section:

## Terminology: Harness > Scaffold > Loop

Use consistent terminology when discussing agent architecture:

- **Loop:** The execution cycle (ReAct pattern: think → act → observe)
- **Scaffold:** Behavior definition (prompts, tools, context, memory)
- **Harness:** Complete software layer (execution, state, error handling)

When modifying hook scripts, you are working on the **harness** layer.
When modifying agent prompts, you are working on the **scaffold** layer.
When modifying phase transitions, you are working on the **loop** layer.
```

- [ ] **Step 2: Run test to verify it fails**

Run: `grep -n "Harness > Scaffold > Loop" context/code-standards.md`
Expected: No matches

- [ ] **Step 3: Write minimal implementation**

Add the new section to code-standards.md.

- [ ] **Step 4: Run test to verify it passes**

Run: `grep -n "Harness > Scaffold > Loop" context/code-standards.md`
Expected: Found the new section

- [ ] **Step 5: Commit**

```bash
git add context/code-standards.md
git commit -m "docs: add harness > scaffold > loop terminology to code standards"
```

---

### Task 6: Update Progress Tracker

**Files:**
- Modify: `context/progress-tracker.md`

- [ ] **Step 1: Write the failing test**

```markdown
Add to "Completed" section:

- Harness > Scaffold > Loop architecture documentation
```

- [ ] **Step 2: Run test to verify it fails**

Run: `grep -n "Harness > Scaffold > Loop" context/progress-tracker.md`
Expected: No matches

- [ ] **Step 3: Write minimal implementation**

Add the completion entry to progress-tracker.md.

- [ ] **Step 4: Run test to verify it passes**

Run: `grep -n "Harness > Scaffold > Loop" context/progress-tracker.md`
Expected: Found the entry

- [ ] **Step 5: Commit**

```bash
git add context/progress-tracker.md
git commit -m "docs: update progress tracker with harness > scaffold > loop completion"
```

---

### Task 7: Verify Health Check Passes

**Files:**
- None (verification only)

- [ ] **Step 1: Run health check**

Run: `node bundle/hooks/orchestra-health.js`
Expected: PASS

- [ ] **Step 2: Verify no broken references**

Run: `grep -r "harness-scaffold-loop" bundle/`
Expected: No broken references (documentation only, no code changes)

- [ ] **Step 3: Final commit if needed**

```bash
git add -A
git commit -m "docs: finalize harness > scaffold > loop documentation"
```

---

## Self-Review

**1. Spec coverage:** 
- [x] Create architecture documentation
- [x] Update architecture context
- [x] Update README
- [x] Update AGENTS.md
- [x] Update code standards
- [x] Update progress tracker
- [x] Verify health check

**2. Placeholder scan:** 
- No TBD/TODO placeholders
- All steps have concrete content

**3. Type consistency:** 
- Consistent terminology: harness, scaffold, loop
- Consistent file references: `context/harness-scaffold-loop.md`

---

## Execution Handoff

**Plan complete and saved to `docs/plans/2026-07-12-harness-scaffold-loop.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**

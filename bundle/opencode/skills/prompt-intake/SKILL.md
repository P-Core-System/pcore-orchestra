---
name: prompt-intake
description: >-
  Expand short/informal user goals into a concrete plan before coding. Use when
  the prompt is vague, casual, multi-goal, or missing success criteria. Prefer
  inferring from progress-tracker/git over blocking the user.
---

# Prompt intake (planner-first)

Use this skill **before** launching implementer. Short/informal text still starts the core loop — expand the goal; do not stall.

## When to use

- Short/informal ("fix it", "pls", "next improve", "build it")
- Multiple unrelated asks in one message
- User says "next all" / "do everything" without prioritization
- Ambiguous enterprise vs small-fix scope

## Intake checklist

1. **Assumed goal** — one sentence (from user text + `context/progress-tracker.md` + git)
2. **Scope** — files/areas in; what must NOT change
3. **Route** — `core` default; `enterprise` only for `/enterprise` or clear complexity
4. **Verifier** — commands or checks that prove done
5. **Conflict?** — only ask the user if 2+ equally likely goals conflict

## Output template

```markdown
## Intake
- Assumed goal: ...
- Source: user text | progress-tracker | git status
- Scope in: ...
- Scope out: ...
- Route: core | enterprise
- Done when: ...
- First agent: orchestra-planner
```

## Rules

- Prefer **core** for normal implement/fix/build — even when wording is casual
- Prefer **enterprise** only for `/enterprise` or clear complexity signals
- Infer from repo context first; ask the user only on real ambiguity
- Then launch **orchestra-planner** — never implementer first
- State assumed goal + success criteria explicitly in PLAN_READY

---
name: greenfield-product
description: >-
  Greenfield product intake when user wants to build a new app (notes, todo,
  SaaS, API). Recommend stack, gather requirements, scaffold, then small-task
  orchestra loops until production. Use for "build a note app", "new project",
  "from scratch", "let's build".
---

# Greenfield product → production loop

Triggered when orchestra classifies **greenfield** (`build a … app`, `new project`, `from scratch`).

## Flow

```text
User idea
  → Present recommended stack + alternatives
  → Gather intake (or accept "recommended" / "defaults")
  → Write project-overview + project.yaml (init-project)
  → Discovery/plan (enterprise idea → … → task-breakdown)
  → MVP slices: each slice = plan→implement→commit→verify→review
  → Repeat until production checklist green
```

## Stack presentation (parent)

1. Show **recommended** stack with one-line why (from hook briefing).
2. Show 1–2 alternatives.
3. Ask intake questions OR accept defaults if user says `recommended` / `just ship`.

## After stack locked

1. Scaffold empty repo:
   - `bash <pcore-orchestra>/scripts/init-project.sh . --type web --name "Notes App"`
   - or `powershell -File init-project.ps1`
2. Fill `context/project-overview.md` with MVP features + out-of-scope.
3. Break into **small vertical slices** (one E2E feature per orchestra cycle).
4. Run core loop per slice; **commit before next phase**.
5. Research online only when templates lack guidance (one targeted search).

## Production checklist (stop when all pass)

- [ ] Auth works if required
- [ ] Core MVP features demoable
- [ ] Tests + lint/health green
- [ ] Deploy config present
- [ ] README + progress-tracker updated
- [ ] No secrets in repo
- [ ] Phase commit gate clean

## Rules

- Never jump to implementer before stack + MVP locked
- Prefer recommended pcore stacks (Next/Hono/Prisma) unless user overrides
- Prefer Context7 / six-file / templates over broad web search
- One slice per cycle — no mega-PRs

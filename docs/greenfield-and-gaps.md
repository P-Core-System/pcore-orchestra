# Greenfield + agent-driven gaps (2026)

What happens when a user says **"let's build a note app"**, and what pcore-orchestra still lacks vs industry.

**Related:** `docs/agent-orchestra-rag-research.md`, `docs/production-loop.md`, skill `greenfield-product`

---

## Intended UX (now supported — V3.7)

```text
"let's build a note app"
  → classify greenfield → enterprise route
  → inject stack recommendations (Next/Hono/Prisma …)
  → parent presents recommended + alternatives
  → gather intake OR accept "recommended"/"defaults"
  → init-project scaffold + six-file context
  → discovery → small MVP slices
  → each slice: plan→implement→COMMIT→verify→review
  → loop until production checklist green
```

Hook: `lib/greenfield-intake.js` · Skill: `greenfield-product`

---

## Research: industry patterns

| Pattern | Source | Orchestra mapping |
|---------|--------|-------------------|
| Idea → PRD → architecture → scaffold | arc-ready | Greenfield intake + enterprise SDLC |
| Staff-engineer recommendations `(recommended)` | claude-greenfield | Stack catalog with why |
| Spec-first then tickets | copilot-bootstrap | Intake → overview → small slices |
| Harness > prompt | Faros / Tosea 2026 | Hooks, gates, commit gate |
| Vertical slices to production | Loop engineering | Core cycle per feature |

---

## What you already have

- Ambient loop + enterprise SDLC
- Greenfield detection + stack recommendations
- Plan artifacts, phase commit gates, cycle reports
- Semantic memory recall, evidence gates, token budgets
- Six-file context + init-project / init-context
- OpenCode parity

---

## What you're still missing (ranked)

### High — product creation

| Gap | Why | Next |
|-----|-----|------|
| **Interactive stack picker UI** | Users answer in chat; no structured form | Optional `orchestra.intake` JSON artifact |
| **Auto init-project from hooks** | Parent must run script | Hook/skill that scaffolds when cwd empty |
| **Slice backlog file** | `context/specs/` or tickets per MVP feature | Auto-write `context/specs/01-mvp-notes.md` |
| **Production checklist gate** | Soft checklist today | Hard fail review until checklist IDs pass |

### High — agent-driven quality

| Gap | Why | Next |
|-----|-----|------|
| **Eval harness** | No score on agent cycles | Golden tasks + pass rates |
| **Security scan on every cycle** | Evidence optional for core | Always-on secret/deps scan |
| **Parallel worktrees** | One implementer at a time | Package-level parallel Tasks |
| **Model tier per phase** | Cost | When Cursor Task API allows |

### Medium — knowledge / RAG

| Gap | Why | Next |
|-----|-----|------|
| **Code RAG index** | Large greenfield repos | FTS on scaffolded tree |
| **SQLite FTS memory** | Scale past JSON | memory.db |
| **Transcript learning** | Repeat mistakes | Index agent-transcripts |
| **MCP stack docs** | Prefer Context7 — wire skill reminder | Auto-query on greenfield stack lock |

### Lower — nice to have

| Gap | Notes |
|-----|-------|
| Visual kanban of phases | CLI `cycles` is enough for now |
| Multi-repo orchestra | Monorepo first |
| Human approval UI | `plan_only` + greenfield pause cover this |

---

## Anti-patterns to avoid

1. Jumping to implementer on "build a note app" before stack lock
2. One mega-PR for entire product — use small slices
3. Broad web research every turn — templates + Context7 first
4. Skipping verify/commit gates for speed

---

*V3.7 — greenfield intake shipped; gaps listed for P4.*

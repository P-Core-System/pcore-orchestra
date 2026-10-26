# Production Orchestra Loop (V3.7)

How pcore-orchestra runs a **production-grade** plan→implement→verify→review cycle with durable artifacts, gates, and observability.

**Related:** `docs/agent-orchestra-rag-research.md`, `bundle/skills/orchestra-loop/SKILL.md`

---

## One cycle (core)

```text
User prompt → classify → startOrchestra
    → planner (readonly) → .cursor/orchestra-plan.md
    → implementer → git commit (required) → clean tree
    → verifier → evidence gates (FAIL if dirty)
    → reviewer → ORCHESTRA_COMPLETE
    → parent docs commit if progress-tracker dirty
    → cycle report JSON + memory flush + token finalize
```

---

## Artifacts per cycle

| Artifact | Location | Purpose |
|----------|----------|---------|
| **Plan** | `.cursor/orchestra-plan.md` | Implementer/verifier/reviewer read this — not chat history |
| **Plan backup** | `~/.cursor/hooks/state/plans/{run_id}.md` | Survives workspace switches |
| **Cycle report** | `~/.cursor/hooks/state/cycles/{run_id}.json` | Production audit: gates, tokens, phases, outcome |
| **Cycle index** | `~/.cursor/hooks/state/cycles/index.json` | Last 100 runs |
| **State** | `orchestra.json` | Active run, phase, planArtifact pointer |
| **Memory** | `orchestra-memory.json` + `memory-index.json` + `memory-fts.db` | Episodic memory, inverted-index recall, and an FTS5 mirror fused by reciprocal rank fusion |
| **Tokens** | `orchestra-tokens.json` | Cost + improvement tips |

---

## Phase commit gate

**Hard rule:** commit each loop part that changes the repo **before** the next part starts.

| Boundary | Requirement |
|----------|-------------|
| After implement | `git status --porcelain` empty (except plan file) |
| Before verify | Parent + verifier enforce clean tree |
| After FIX_REQUIRED fixes | Implementer commits again before re-verify |
| After ORCHESTRA_COMPLETE | Parent commits dirty docs (`docs(context): ...`) |

Hook: `lib/phase-commit-gate.js` — injected into phase handoffs.

---

## Production checklist (each cycle)

### Planner
- [ ] Reads six-file context when present
- [ ] Outputs structured plan + `PLAN_READY` (includes commit strategy)
- [ ] Hook saves plan to `.cursor/orchestra-plan.md`

### Parent (between phases)
- [ ] Handoff ≤2500 chars: goal + plan path + failures only
- [ ] Does NOT edit files between phases
- [ ] **`git status --porcelain` clean** before launching next subagent
- [ ] Launches correct `orchestra-*` subagent via Task

### Implementer
- [ ] Reads `.cursor/orchestra-plan.md` first
- [ ] Commits with conventional message **before** `IMPLEMENT_DONE`
- [ ] Ends with `IMPLEMENT_DONE` only when porcelain is empty

### Verifier
- [ ] Evidence preflight injected on phase entry
- [ ] `applyEvidenceToGates` on verify complete
- [ ] Dirty tree → `VERIFY_FAIL`
- [ ] Ends with `VERIFY_PASS` or `VERIFY_FAIL`

### Reviewer
- [ ] Confirms plan scope + progress-tracker sync
- [ ] Ends with `ORCHESTRA_COMPLETE` or `FIX_REQUIRED`
- [ ] Suggests docs commit if tracker dirty

### Harness (automatic)
- [ ] Token tracking per phase
- [ ] Cycle report written on complete/max_iterations
- [ ] Memory flush + semantic index update
- [ ] Workspace identity sync on session (idle)
- [ ] Phase commit gate message in handoffs

---

## CLI

```bash
node ~/.cursor/hooks/orchestra-enable.js cycles      # recent cycle reports
node ~/.cursor/hooks/orchestra-enable.js metrics     # dashboard
node ~/.cursor/hooks/orchestra-enable.js memory recall "query"
node ~/.cursor/hooks/orchestra-health.js             # install smoke
```

---

## project.yaml production profile

```yaml
orchestra:
  route: core
  max_iterations: 8
  plan_only: false          # true = pause after planner for human approve
  token_budgets:
    planner: 10000
    implementer: 30000
    verifier: 15000
    reviewer: 8000
    cycle: 63000
```

---

## Upgrade path (P4+)

- ~~SQLite FTS5 memory~~ — done: `memory-fts.js` (`<state>/memory-fts.db`), RRF-fused with the JSON index
- Hybrid local embeddings on memory-index
- Per-phase model tier (when Cursor Task API supports)
- Worktree parallel implementers

---

*V3.6 — plan artifact + cycle reports + memory index*

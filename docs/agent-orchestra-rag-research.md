# Agent Orchestra, RAG & Harness Research (2026)

Research synthesis for **pcore-orchestra**: agent-driven loops, retrieval/memory, context engineering, and gaps vs industry practice.

**Related:** `docs/agent-harness-recommendations.md`, `docs/token-optimization.md`, `context/harness-scaffold-loop.md`

**Sources:** Cursor Subagents docs, Real Python context engineering, Lance Martin context engineering, Faros harness engineering, Tosea loop engineering, AI Builder Club 5 layers, arxiv Harness Effect, AgentMemory/BM25 patterns, DEV subagent orchestration post.

---

## Table of contents

1. [Industry stack: 5 layers](#1-industry-stack-5-layers)
2. [What pcore-orchestra already has](#2-what-pcore-orchestra-already-has)
3. [Context engineering: Curate / Distill / Delegate / Externalize](#3-context-engineering-curate--distill--delegate--externalize)
4. [RAG & memory — what to build next](#4-rag--memory--what-to-build-next)
5. [Orchestra loop improvements](#5-orchestra-loop-improvements)
6. [What you're missing (ranked)](#6-what-youre-missing-ranked)
7. [Roadmap P3–P4](#7-roadmap-p3p4)
8. [References](#8-references)

---

## 1. Industry stack: 5 layers

| Layer | Question | Orchestra mapping |
|-------|----------|-------------------|
| **Prompt** | What single instruction? | Agent markdown bodies, phase-specific rules |
| **Context** | What does the model see? | Six-file context, sessionStart injection, handoff |
| **Harness** | What controls one run? | Hooks, state.json, phase-engine, quality gates |
| **Loop** | What repeats without you? | plan→implement→verify→review, subagentStop chain |
| **Graph** | Many agents wired? | Enterprise SDLC phases, optional phase picker |

**2026 consensus:** Don't prompt harder — **harness harder**. The model is a reasoning calculator; safety, memory, verification, and iteration live in infrastructure ([Faros](https://www.faros.ai/blog/harness-engineering), [Tosea loop engineering](https://tosea.ai/blog/loop-engineering-ai-agents-complete-guide-2026)).

---

## 2. What pcore-orchestra already has

| Capability | Status | Location |
|------------|--------|----------|
| Closed-loop control (plan→verify→review) | ✅ | phase-engine, subagentStop |
| Context isolation (subagents) | ✅ | Cursor Task + orchestra agents |
| Compact parent handoff | ✅ V3.3.8 | handoff-enforcer.js |
| Cache-shaped session injection | ✅ V3.3.7 | sessionStart static→dynamic |
| Token budgets + tracker | ✅ V3.3.5 | token-tracker.js |
| Evidence gates (build/test/lint) | ✅ V3.3.9 | evidence-runner.js |
| Project.yaml orchestra profiles | ✅ V3.3.8 | orchestra-config.js |
| Workspace identity sync | ✅ V3.4.0 | workspace-identity.js |
| Episodic memory (goals, files, errors) | ✅ | orchestra-memory.json |
| **Semantic recall (BM25-lite)** | ✅ V3.5.0 | semantic-memory.js |
| **Hybrid recall (JSON index + SQLite FTS5)** | ✅ V3.7.0 | memory-fts.js + memory-index.js, RRF fusion |
| Six-file externalized context | ✅ | context-detector.js |
| Enterprise SDLC route | ✅ | SDLC_PHASES + phase picker |
| Stall detection / heartbeat | ✅ | heartbeat-monitor.js |
| OpenCode parity | ✅ | bundle/opencode/ |

**Strong fit:** Orchestra is already a **Loop + Harness** product. You're not missing the concept — you're refining layers 3–4 and adding selective RAG.

---

## 3. Context engineering: Curate / Distill / Delegate / Externalize

From [Real Python context engineering](https://realpython.com/python-context-engineering-ai/) and [Lance Martin](https://rlancemartin.github.io/2025/06/23/context_engineering/):

| Strategy | Meaning | Orchestra today | Gap |
|----------|---------|-----------------|-----|
| **Curate** | Pick what enters the window | six-file, project.yaml, memory inject | Per-repo RAG index (code chunks) |
| **Distill** | Shrink what's already there | handoff 2500 char cap, slim agents | Auto-compaction of phase outputs in state |
| **Delegate** | Separate context per task | orchestra-* subagents | Parallel implementers + worktrees |
| **Externalize** | Persist outside window | progress-tracker, AGENTS.md, specs/ | Structured plan artifacts between phases |

**Key insight:** Subagents exist because **delegation beats infinite context**. Parent must pass 5–10 lines of verified context, not chat history ([DEV 16-subagent post](https://dev.to/baolin_tikool_43da6f2b56f/orchestrating-16-cursor-subagents-in-a-single-session-what-actually-stuck-546m)).

---

## 4. RAG & memory — what to build next

### Memory types (cognitive model)

| Type | Content | Orchestra storage | Retrieval |
|------|---------|-------------------|-----------|
| **Episodic** | Past runs, outcomes | `completed_goals[]` | Recent + semantic recall |
| **Semantic** | Facts, patterns | `error_patterns`, lessons | Keyword overlap (V3.5.0) |
| **Procedural** | How to work | agents, skills, rules | Always-on / progressive load |
| **Code index** | Repo chunks | ❌ not yet | grep/glob (agent-driven) |

### RAG tiers (pragmatic path)

| Tier | Tech | When |
|------|------|------|
| **T0** | Keyword overlap on goals/errors | ✅ V3.5.0 — zero deps |
| **T1** | SQLite FTS5 (BM25) on memory + transcripts | P3 — portable, local-first |
| **T2** | Hybrid BM25 + local embeddings (Ollama/fastembed) | P4 — optional |
| **T3** | Code chunk index (tree-sitter + FTS) | P4 — monorepo scale |

**Industry pattern:** Start BM25-only; add embeddings only when keyword recall fails ([AgentMemory](https://github.com/smysle/agent-memory), [TRW-Memory](https://github.com/wallter/trw-memory)). Avoid mandatory vector DB for a CLI harness.

### V3.5.0 semantic recall

- `semantic-memory.js` — token overlap + recency boost on `completed_goals` and `error_patterns`
- Injected when `buildMemoryContext(ltm, { query: goal })` on prompt/session start
- CLI: `orchestra-enable.js memory recall "<query>"`

### V3.7.0 hybrid recall

- `memory-fts.js` — SQLite FTS5 mirror of indexed goals via the built-in `node:sqlite` (no native deps, no install step)
- `memory-index.js` — writes both stores, prunes both, and fuses results with reciprocal rank fusion (K=60); each hit reports `sources` (`json`, `fts`)
- Strictly best-effort: missing `node:sqlite`, an unwritable state dir, or `PCORE_FTS_DISABLE=1` falls back to JSON-only without throwing
- Covered by `scripts/test-memory-hybrid.js`; mirrored byte-identically to `bundle/opencode/hooks/lib/`

---

## 5. Orchestra loop improvements

### Harness Effect (arxiv 2607.06906)

Orchestration can **reduce** total tokens vs monolithic agent if phases use fresh context and readonly phases skip write tools. Orchestra already aligns; continue:

- Keep planner/verifier/reviewer **readonly**
- Enforce **handoff compactness** (done)
- **Per-phase token budgets** from project.yaml (done)

### Loop engineering checklist ([Tosea](https://tosea.ai/blog/loop-engineering-ai-agents-complete-guide-2026))

| Pattern | Orchestra |
|---------|-----------|
| ReAct (reason→act→observe) | Each subagent phase |
| Verifier loop | orchestra-verifier + evidence gates |
| Max retries / saturation | max_iterations, FIX_REQUIRED |
| Stop condition | ORCHESTRA_COMPLETE, reviewer gate |
| Human-in-the-loop | plan_only mode |
| Ratchet (never same mistake twice) | error_patterns + semantic recall |

### Cursor subagent best practices

- **Description = routing** — "Use proactively when…" in agent frontmatter ✅
- **Readonly auditors** — verifier, reviewer ✅
- **Background for long work** — Task `run_in_background` (parent responsibility)
- **Resume subagents** — not yet in hooks (Cursor feature; document in skill)

---

## 6. What you're missing (ranked)

### P3 — High value, feasible

| Gap | Why it matters | Suggested approach |
|-----|----------------|-------------------|
| **Structured plan artifact** | Planner output lost in chat; implementer re-reads repo | Write `.cursor/orchestra-plan.md` or `context/specs/active-plan.md` on PLAN_READY |
| ~~SQLite FTS memory~~ | ✅ Done V3.7.0 | `memory-fts.js` → `<state>/memory-fts.db` (FTS5 over `node:sqlite`); JSON index stays as the source of truth and the fail-open fallback |
| **Transcript indexing** | Planner learns from past *approaches*, not just goals | Index agent-transcripts deltas (see agents-memory-updater skill) |
| **Compaction of phase outputs** | Parent context bloat across 4 phases | Store 200-char summary in `state.memory.phases_completed` only (partial ✅) |
| **Per-phase model tier** | Cost optimization | Blocked on Cursor Task API; document desired mapping |

### P4 — Medium term

| Gap | Why | Approach |
|-----|-----|----------|
| **Code RAG index** | Faster planner on large repos | Optional `scripts/index-context.js` → FTS on context/ + key paths |
| **Parallel implementers** | Monorepo packages | Worktree orchestration (Addy Osmani pattern) |
| **MCP memory server** | External tool for recall | Expose semantic-memory via MCP |
| **Observability export** | FinOps dashboards | Prometheus from orchestra-metrics.json |
| **Self-improving harness** | Ratchet automation | Hook failures → auto-append to error_patterns + rules |

### P5 — Research / optional

| Gap | Notes |
|-----|-------|
| Knowledge graph (memoirs) | Alejandria-style semantic links |
| Cross-session agent resume | Cursor subagent resume IDs |
| STEM lab-report export | Cycle as hypothesis→method→results |
| Full graph orchestration | LangGraph / AutoGen — only if enterprise customers need DAG |

### Anti-patterns to avoid

1. **RAG everything** — pollutes context; curate beats retrieve-all ([harness 2026](https://medium.com/@visrow/harness-engineering-for-ai-agents-in-2026-114fcb8edf9e))
2. **Mega agent prompts** — identity split fixed this; keep bodies <100 lines
3. **Skipping verifier** — #1 production failure mode in loop engineering guides
4. **Unbounded memory** — always cap + decay (MEMORY_MAX_* constants ✅)

---

## 7. Roadmap P3–P4

### P3 (next sprints)

1. ✅ Semantic recall BM25-lite (V3.5.0)
2. Structured plan artifact between phases
3. SQLite FTS5 memory backend (optional migration)
4. Transcript delta indexing for planner
5. Model tier mapping doc (when API available)

### P4

1. Hybrid embeddings (local Ollama) — opt-in in project.yaml
2. Code chunk index for context/ + bundle/
3. Worktree parallel implementers
4. MCP memory recall tool
5. Harness metrics → Grafana/PostHog

---

## 8. References

| Resource | Topic |
|----------|-------|
| [Cursor Subagents](https://cursor.com/docs/subagents) | Isolation, built-in explore/bash/browser |
| [Cursor Agent Best Practices](https://cursor.com/blog/agent-best-practices) | Rules vs skills |
| [Real Python Context Engineering](https://realpython.com/python-context-engineering-ai/) | Curate/Distill/Delegate/Externalize |
| [Lance Martin Context Engineering](https://rlancemartin.github.io/2025/06/23/context_engineering/) | Memory selection challenges |
| [Faros Harness Engineering](https://www.faros.ai/blog/harness-engineering) | 5 harness layers, KPIs |
| [Tosea Loop Engineering](https://tosea.ai/blog/loop-engineering-ai-agents-complete-guide-2026) | Loop vs harness nesting |
| [AI Builder Club 5 Layers](https://www.aibuilderclub.com/blog/five-layers-ai-engineering) | Prompt→Graph stack |
| [Harness Effect arxiv](https://arxiv.org/html/2607.06906) | Token economics |
| [AgentMemory (BM25)](https://github.com/smysle/agent-memory) | Local-first hybrid memory |
| [LanceDB Hermes plugin](https://www.lancedb.com/blog/semantic-memory-for-hermes-agent-with-lancedb) | Semantic + hybrid recall |
| [16 Cursor subagents post](https://dev.to/baolin_tikool_43da6f2b56f/orchestrating-16-cursor-subagents-in-a-single-session-what-actually-stuck-546m) | Handoff template, compaction |
| `docs/agent-harness-recommendations.md` | Orchestra-specific roadmap |
| `docs/token-optimization.md` | Tool-call + budget policy |

---

*Last updated: V3.5.0 — semantic recall + research synthesis.*

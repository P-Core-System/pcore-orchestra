# Token Optimization for AI Agents

Practical guide for reducing token spend in Cursor Orchestra, OpenCode, and custom agent loops — with emphasis on **tool calls**, **web search**, and **multi-agent orchestration**.

**Expected savings:** 50–70% vs unoptimized defaults when combined with `setup-opencode-optimal.sh` profiles; up to 80–95% with full stack (caching + routing + compaction + external state).

---

## Table of contents

1. [Where tokens go](#1-where-tokens-go)
2. [Eight core techniques](#2-eight-core-techniques)
3. [Tool call optimization](#3-tool-call-optimization)
4. [Web search and fetch](#4-web-search-and-fetch)
5. [Orchestra-specific budgets](#5-orchestra-specific-budgets)
6. [OpenCode configuration](#6-opencode-configuration)
7. [Cursor-specific patterns](#7-cursor-specific-patterns)
8. [Monitoring and budgets](#8-monitoring-and-budgets)
9. [Implementation checklist](#9-implementation-checklist)
10. [References](#10-references)

---

## 1. Where tokens go

Most agent runs waste tokens in three places:

| Source | Typical cost | Orchestra impact |
|--------|--------------|------------------|
| **System prompts + tool schemas** | 5k–40k per call (large MCP/toolsets) | Subagent prompts, skill lists, hook injections |
| **Tool call outputs** | 200–8k per call (grep, read, web search) | Planner search, implementer file reads, verifier logs |
| **Conversation history** | Grows every turn | Parent + 4 subagent phases per cycle |

A single orchestra cycle (plan → implement → verify → review) can trigger **3–10× more LLM calls** than a direct chat completion. Token discipline is not optional at scale.

**Rule of thumb:** Every tool response is a context injection. Size it for the agent's **next decision**, not for completeness.

---

## 2. Eight core techniques

Synthesized from production research (MindStudio, Zylos, Ability.ai, agentpatterns.ai, LLM Book §27.6).

### 2.1 Semantic compression

Summarize large tool outputs before they enter context. Use a fast/cheap model (Haiku, GPT-4o Mini, Flash) only when content exceeds ~1,000 tokens.

- **When:** Web fetch results, long `grep` output, CI logs, API dumps
- **How:** Threshold-based — small outputs pass through; large ones get compressed to decision-relevant facts
- **Savings:** 70–90% on compressed outputs

### 2.2 Retrieval-based context (RTK / RAG)

Replace static knowledge in system prompts with dynamic retrieval.

- **When:** Large docs, policy files, skill libraries, six-file context
- **How:** Chunk + embed; inject top-k chunks (300–800 tokens) per query
- **Savings:** 98%+ vs loading full knowledge base every call

Orchestra already does this partially: hooks inject six-file **read order**, not full file contents. Subagents read only what they need.

### 2.3 External state (not in the prompt)

Move logs, action history, and intermediate state to persistent storage. Query on demand.

- **Orchestra:** `orchestra.json`, `orchestra-memory.json`, lifecycle events (last 200), checkpoint state
- **Pattern:** Agent writes state via tools; reads `SELECT … LIMIT N` instead of carrying full history
- **Savings:** 40–70% on long-running sessions

### 2.4 Capped thinking budgets

Extended thinking models burn 5k–20k tokens per call if uncapped.

| Task type | Thinking budget |
|-----------|-----------------|
| Lookup / classification | 0 (disable) |
| Moderate reasoning | 1k–2k |
| Multi-step implementation | 5k–8k |
| Hard analysis | 10k–16k |

Route by phase: planner/reviewer = low; implementer = medium only when needed.

### 2.5 Prompt caching

Structure prompts so **static content comes first** (system prompt, tool schemas, six-file pointers). Dynamic content (user message, tool results) after cache breakpoints.

- Anthropic `cache_control: ephemeral` — ~90% off cached input tokens
- OpenAI cached prefixes — similar for stable system blocks
- **Orchestra win:** Identical subagent system prompts across cycles

### 2.6 Rolling summarization

For multi-turn parent sessions, keep last N turns verbatim; summarize older history into a compact memory block.

- Trigger every 5–10 turns
- **Savings:** 75–85% on history block

Orchestra's long-term memory (`orchestra-memory.json`) serves a similar role across sessions.

### 2.7 Structured / compact output

Enforce schemas between agents. Short field names, omit nulls, batch arrays.

```json
{"status":"fail","check":"lint","file":"src/a.ts","line":45}
```

vs a paragraph describing the same failure — ~40% fewer tokens, easier parsing.

### 2.8 Model routing by complexity

| Tier | Use for | Examples |
|------|---------|----------|
| 1 — Fast/cheap | Classification, summaries, read-only scan | Planner, reviewer, verifier |
| 2 — Mid | Implementation, moderate reasoning | Implementer |
| 3 — Frontier | Architecture, security audit, novel debugging | Enterprise route only |

60–70% of production traffic can sit on Tier 1 with minimal quality loss.

---

## 3. Tool call optimization

### 3.1 Design principles (agentpatterns.ai)

1. **Return only the next decision's inputs** — CI status → `"3 passed, 1 failed: lint"`, not full API JSON
2. **Eliminate functional overlap** — one search tool, not three overlapping ones
3. **Precise descriptions** — ambiguous tool docs force extra reasoning tokens
4. **Cap toolset size** — 30+ tools ≈ 55k tokens in definitions alone (Anthropic); dynamic loading cuts 70–90%

### 3.2 Dynamic tool loading

Do not inject every MCP/server tool on every request. Select top-k by:

- Keyword overlap (cheap)
- Embedding similarity (production)
- Phase-based allowlists (orchestra pattern)

```text
Planner:   read, grep, glob — no edit, no web
Implementer: read, write, shell — web only if plan requires external docs
Verifier:  shell only — no file edits
Reviewer:  read, diff — no web, no shell unless needed
```

OpenCode `permission` blocks in `opencode.json` enforce this.

### 3.3 Parallel vs sequential calls

| Pattern | When |
|---------|------|
| **Parallel** | Independent reads (multiple files, unrelated greps) |
| **Sequential** | Output of A feeds B (grep then read matched file) |

Batch independent tool calls in a single turn. Dependency-graph scheduling reduces round-trips.

### 3.4 Result trimming

| Tool | Trim strategy |
|------|---------------|
| `grep` | `head_limit`, narrow `glob`, specific `path` |
| `read` | `offset` + `limit` for large files |
| `glob` | Specific patterns, not `**/*` |
| Shell | Pipe through `head`, `tail`, `grep` for logs |
| WebSearch | One focused query; synthesize; do not chain broad searches |

### 3.5 Tool result caching

Cache deterministic calls (file metadata, unchanged reads) keyed by `(tool, args)` hash with TTL.

- Semantic cache for near-duplicate search queries — use carefully (order IDs, timestamps break equivalence)
- Track `hit_rate`; aim for >30% on repetitive workflows

### 3.6 Anti-patterns

| Anti-pattern | Fix |
|--------------|-----|
| Full API response passthrough | Map to summary fields |
| Reading entire files when grep suffices | Grep first, read matched regions |
| Re-reading same file every phase | Parent passes file list; subagent reads once |
| 10 web searches for one fact | One precise query + optional single fetch |
| Dumping terminal output verbatim | Extract error lines only |

---

## 4. Web search and fetch

Web tools are among the most expensive per call (latency + 2k–8k tokens per result).

### 4.1 When to use web search

| Use | Skip |
|-----|------|
| Library API changed after model cutoff | Code already in repo |
| Security CVE / breaking change verification | Internal architecture questions |
| Official docs for unfamiliar dependency | Six-file context answers the question |

**Default for orchestra core loop:** codebase first. Web only when plan explicitly requires external docs.

### 4.2 Search discipline

1. **One query per gap** — combine keywords; avoid "search all and more"
2. **Prefer official docs** — add `site:docs.vendor.com` or version in query
3. **Fetch selectively** — WebSearch snippets often enough; WebFetch only for one canonical URL
4. **Compress before context** — extract 3–7 bullet facts; discard HTML/nav boilerplate
5. **Deny by phase** — OpenCode `websearch: deny` on planner/reviewer (see `setup-opencode-optimal.sh`)

### 4.3 Fetch vs search

```text
WebSearch  → discover URLs, recent changes, error messages
WebFetch   → one target page when snippet is insufficient
```

Never fetch multiple pages when one primary doc suffices.

### 4.4 Orchestra web policy

| Phase | Web search | Web fetch |
|-------|------------|-----------|
| Planner | Avoid — search repo | Avoid |
| Implementer | Only if plan cites external API | One URL max |
| Verifier | Never | Never |
| Reviewer | Never | Never |

---

## 5. Orchestra-specific budgets

Per-agent token budgets (design targets for subagent prompts + tool output):

| Agent | Budget | Search iterations | Tool focus |
|-------|--------|-------------------|------------|
| `orchestra-planner` | 10,000 | ≤3 | Targeted grep/glob; parallel reads |
| `orchestra-implementer` | 30,000 | ≤25 | Read surrounding code; minimal re-reads |
| `orchestra-verifier` | 15,000 | ≤8 | Shell checks; summarize failures |
| `orchestra-reviewer` | 8,000 | ≤3 | `git diff` only; no full file re-reads |

**Max per cycle:** ~63,000 tokens (excluding parent overhead).

### 5.1 Phase-specific rules

**Planner**

- Read six-file context in order; stop when goal is clear
- Grep before read; `head_limit` on all searches
- No web unless user goal requires external knowledge
- Plan ≤100 lines (Cursor) / ≤80 lines (OpenCode)

**Implementer**

- Implement plan items only — no exploratory searches
- Read function/class scope, not whole modules
- Batch file reads in parallel when independent

**Verifier**

- Run only checks listed in plan + `ai-workflow-rules.md`
- One-line per failure: `file:line — message`
- Do not paste full test output

**Reviewer**

- Review diff stat + changed hunks
- Flag doc sync; do not re-implement or re-verify

### 5.2 Loop cost controls

| Control | Location | Default |
|---------|----------|---------|
| Max fix iterations | `orchestra-subagent-stop.js` | Prevents VERIFY_FAIL loops |
| Stall timeout | heartbeat monitor | 5 min → nudge; 2 stalls → abort |
| Step limits | `opencode.json` `agent.*.steps` | 4–25 per phase |
| Goal truncation | `orchestra.json` | 2000 chars |

---

## 6. OpenCode configuration

Generate an optimized config:

```bash
bash scripts/setup-opencode-optimal.sh --balanced   # recommended
bash scripts/setup-opencode-optimal.sh --budget     # free models
bash scripts/setup-opencode-optimal.sh --premium    # quality + cost-aware
bash scripts/setup-opencode-optimal.sh --check      # audit current config
```

### 6.1 Key settings

```json
{
  "small_model": "opencode/gpt-5-nano",
  "compaction": { "auto": true, "prune": true, "reserved": 8000 },
  "snapshot": false,
  "watcher": { "ignore": ["node_modules/**", "dist/**", ".git/**"] }
}
```

| Setting | Why |
|---------|-----|
| `small_model` | Titles/summaries off main model |
| `compaction.prune` | Drop stale tool outputs from context |
| `compaction.reserved` | Lower = more aggressive pruning |
| `snapshot: false` | Large repos — avoid full-tree snapshots |
| `agent.*.steps` | Hard cap on tool loops per phase |
| `permission.websearch: deny` | Block expensive web on read-only agents |

### 6.2 Profile comparison

| Profile | Planner/Verifier/Reviewer | Implementer | Est. cost/cycle |
|---------|---------------------------|-------------|-----------------|
| budget | deepseek-v4-flash-free | same | ~$0.00–0.03 |
| balanced | deepseek-v4-flash | kimi-k2.5 | ~$0.03–0.11 |
| premium | deepseek-v4-flash | claude-sonnet | ~$0.10–0.30 |

---

## 7. Cursor-specific patterns

### 7.1 Parent agent (orchestrator)

- Launch subagents via Task — do not duplicate their work
- Do not read files between phases
- Do not commit between phases
- Pass **concise** goal + plan summary to next phase, not full transcripts

### 7.2 Skills and rules

- Skills load on demand — avoid referencing unused skills in prompts
- `orchestra-loop` skill is the canonical policy doc
- Six-file context: read order injection, not full paste

### 7.3 MCP servers

Each MCP server adds tool schemas to context. Audit:

```text
How many tools are registered?
How many are used per typical task?
Can servers be scoped per project?
```

Prefer project-scoped MCP over global "install everything."

### 7.4 Subagent isolation

Subagents start fresh — good for token hygiene. Bad if parent dumps entire history into Task prompt. Parent should pass:

```markdown
Goal: [one sentence]
Plan summary: [3–5 bullets]
Files: [list]
Prior failures: [if FIX_REQUIRED loop]
```

---

## 8. Monitoring and budgets

### 8.0 Built-in token tracker (Orchestra V3.3.5+)

Orchestra records per-phase token usage automatically on each `subagentStop`:

| Storage | Path |
|---------|------|
| Per-run history + aggregates + tips | `~/.cursor/hooks/state/orchestra-tokens.json` |
| Active run (in progress) | `~/.cursor/hooks/state/orchestra.json` → `tokens` |

**How it works**

1. Each phase: estimates tokens from subagent output text (~chars/4); uses API `usage` fields when Cursor exposes them.
2. Compares against per-agent budgets (10k / 30k / 15k / 8k).
3. On cycle complete: writes run summary, rolling aggregates, and **improvement tips** for the next session.
4. `sessionStart` injects recent averages + top tips into agent context.

**CLI**

```bash
node ~/.cursor/hooks/orchestra-enable.js tokens        # full report
node ~/.cursor/hooks/orchestra-enable.js tokens clear  # reset history
node ~/.cursor/hooks/orchestra-enable.js history       # includes token column
```

**Tips generated automatically**

- Phase over budget → agent-specific action (grep first, diff-only review, etc.)
- Cycle over 63k → model routing + compaction suggestions
- Spike vs rolling average → trend warning
- High iteration count → tighten planner / single-pass fixes

### 8.1 Metrics to track

| Metric | Target |
|--------|--------|
| Tokens per orchestra cycle | Trend down after optimization |
| Tool calls per phase | Planner <10, Implementer <30 |
| Unnecessary call rate | <10% |
| Web search calls per cycle | 0–1 (core route) |
| Cache hit rate (if implemented) | >30% |
| FIX_REQUIRED iterations | ≤2 |

### 8.2 API logging

Log `prompt_tokens`, `completion_tokens`, `total_tokens` per subagent invocation. Aggregate by phase to find the 10% of workflows consuming 50% of budget.

### 8.3 Hard guards

- `max_iterations` on orchestra loop
- `agent.steps` in OpenCode
- Thinking budget caps per model variant
- Deny web/edit permissions on read-only phases

---

## 9. Implementation checklist

Ordered by ROI (fastest wins first):

- [ ] **Prompt caching** — static system blocks first; stable subagent prompts
- [ ] **OpenCode optimal config** — `setup-opencode-optimal.sh --balanced`
- [ ] **Permission gates** — deny web on planner/reviewer/verifier
- [ ] **Compaction + prune** — enable in OpenCode; review Cursor session length
- [ ] **Tool output trimming** — grep limits, read offsets, log head/tail
- [ ] **Parallel independent reads** — batch in one turn
- [ ] **Web search policy** — codebase first; one query per gap
- [ ] **Model routing** — cheap models for read-only phases
- [ ] **External state** — use orchestra memory, not prompt dumps
- [ ] **Token logging** — per-phase dashboards

---

## 10. References

| Source | Topic |
|--------|-------|
| [MindStudio — 8 Token Reduction Techniques](https://www.mindstudio.ai/blog/token-reduction-strategies-ai-agents-cut-costs) | Semantic compression, RTK, SQLite state, caching |
| [Zylos — AI Agent Cost Optimization](https://zylos.ai/research/2026-02-19-ai-agent-cost-optimization-token-economics/) | FinOps, prompt caching, model routing |
| [Ability.ai — AI Token Reduction](https://www.ability.ai/blog/ai-token-reduction-strategies) | RTK minification, context monitoring |
| [agentpatterns.ai — Token-Efficient Tool Design](https://agentpatterns.ai/token-engineering/token-efficient-tool-design/) | Tool output sizing, overlap, descriptions |
| [LLM Book §27.6 — Tool Economy](https://llmbook.apartsin.com/part-6-agentic-ai/module-27-tool-use-protocols/section-27.6.html) | Dynamic loading, caching, parallel DAGs |
| `scripts/setup-opencode-optimal.sh` | Orchestra OpenCode profiles |
| `bundle/skills/orchestra-loop/SKILL.md` | Ambient loop + token section |
| `docs/02-FEATURES-HOOKS-COMPONENTS-AGENTS.md` | Per-agent budgets |

---

*Last updated: 2026-07-22 — Orchestra V3.3.3*

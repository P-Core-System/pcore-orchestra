# AI Agent SDLC Architecture
*Prompt lifecycle, guardrails, evaluation, and multi-agent coordination for LLM-powered agents*

**Type mapping:** `type: ai-agent`
**Category:** AI agent SDLC

The AI Agent SDLC template covers the full lifecycle of LLM-powered agents: from prompt engineering and tool schema design, through evaluation and safety guardrails, to streaming deployment and human-in-the-loop oversight. It is optimized for agents that reason, call tools, and operate with bounded autonomy.

## Architectural Overview

```text
[ AI Agent SDLC ]
    ├── 1 Agent Architecture Patterns   — ReAct, Plan-Execute, Multi-agent
    ├── 2 Prompt Lifecycle              — dev → eval → prod
    ├── 3 Tool/Function Schema Design   — typed inputs, strict validation
    ├── 4 Evaluation Harness            — unit / integration / behavioral
    ├── 5 Guardrails & Safety           — PII, hallucination, refusal
    ├── 6 Memory & Context              — short/long-term, RAG
    ├── 7 Multi-Agent Coordination      — handoffs, shared state
    ├── 8 Observability                 — traces, metrics, latency
    ├── 9 Deployment                    — streaming, batch, human-in-loop
    ├── 10 Integration with Project Identity
    ├── 11 Output
    ├── 12 Best Practices
    └── 13 Complements
```

## 1. Agent Architecture Patterns

- **ReAct (Reason + Act):** the agent interleaves reasoning traces with tool calls, observes the result, and reasons again until the task completes. Best for open-ended, tool-heavy tasks.
- **Plan-Execute:** a planner produces a step-by-step plan up front, an executor runs each step (often with its own tool set), and a checker validates each result. Best for deterministic, multi-step workflows.
- **Multi-agent:** multiple specialized agents (planner, coder, tester, reviewer) coordinate via message passing or a shared blackboard, with one orchestrator routing work. Best for complex tasks that benefit from role separation.

Pick the pattern by task shape: ReAct for exploration, Plan-Execute for reliability, Multi-agent for scale.

## 2. Prompt Lifecycle (dev → eval → prod)

- **dev:** write the system prompt and few-shot examples; iterate locally against a scratchpad of real user turns.
- **eval:** run every prompt change through the evaluation harness (section 4) before it ships; gate on regression, not just improvement.
- **prod:** deploy prompts as versioned artifacts (not inline strings); roll back on behavioral regression; A/B test candidate prompts on a traffic slice.

Each prompt version carries its model, temperature, tool set, and eval baseline so a prod prompt can be reproduced exactly.

## 3. Tool/Function Schema Design

- Every tool exposes a strict Zod/TypedSchema-style JSON Schema: name, description, typed parameters, required fields.
- Tool names must match `^[a-zA-Z0-9_-]{1,64}$` — no dots or spaces — so every provider and OpenAI-compatible gateway accepts them.
- Validate every tool call server-side before execution; reject unknown tools and malformed arguments with a structured error the agent can recover from.
- Document side effects (read-only vs state-changing) in the schema description so the planner and guardrails know what requires confirmation.

## 4. Evaluation Harness (unit/integration/behavioral)

- **Unit:** prompt rendering, schema validation, and response parsing in isolation (no model calls).
- **Integration:** full turn through the agent with a stubbed/recorded model; assert tool call sequence, final answer shape, and token budget.
- **Behavioral:** real-model or recorded-turn tests scoring helpfulness, correctness, refusal, and safety on a fixed golden set; run on every prompt or model change.

Keep the harness fast enough to run in CI; behavioral tests are the only ones allowed real model calls and they run on a schedule, not every commit.

## 5. Guardrails & Safety (PII, hallucination)

- **PII:** redact emails, phones, keys, and addresses before they leave the client; never log raw user text containing PII; scan both prompt input and model output.
- **Hallucination:** cite sources for factual claims, ground answers in retrieved context (RAG) where possible, and refuse when confidence is low rather than confabulate.
- **Refusal:** define a safe refusal template for out-of-scope, disallowed, or unsafe requests; never leak system instructions or tool internals.

Safety rules are enforced server-side (never client-only) and tested as part of the behavioral harness.

## 6. Memory & Context (short/long-term, RAG)

- **Short-term:** the current conversation window, pruned/summarized when it approaches the context limit.
- **Long-term:** user preferences, facts, and past decisions stored in a structured memory index and recalled by relevance to the current goal.
- **RAG:** retrieve relevant documents (code, docs, tickets) into the context window before generation; rank by recency and semantic similarity.

Memory is scoped per user/project and never shared across unrelated contexts.

## 7. Multi-Agent Coordination

- Agents hand off work via structured messages (task, context, expected output) rather than shared mutable state.
- A single orchestrator owns routing; sub-agents report completion or escalation back to it.
- Every handoff carries an evidence digest (what was done, what was verified) so the receiving agent resumes with proof, not guesses.

## 8. Observability (traces, metrics)

- Trace every turn end-to-end: user message → reasoning → tool calls → model response → final answer, with latency per step.
- Emit metrics: token usage (input/output/cache), tool call count and failure rate, refusal rate, turn duration, and error rate.
- Alert on latency spikes, repeated tool failures, and elevated refusal or error rates.

Traces are keyed by turn/run id so a single user complaint can be replayed exactly.

## 9. Deployment (streaming, batch, human-in-loop)

- **Streaming:** stream model tokens to the client as they arrive; surface tool-call progress and intermediate reasoning as UI events.
- **Batch:** run agent jobs offline (document processing, report generation) with retries and a dead-letter queue for failed turns.
- **Human-in-loop:** route high-stakes or ambiguous turns to a human for approval before state-changing actions execute; record the decision in the audit log.

## 10. Integration with Project Identity

Persist durable agent choices — default model, system prompt version, tool set, safety policy, memory scope — into the project's `project.yaml` (`ai` section) and `context/ai-agent-context.md` when present. Agents load these at session start and build from the persisted values rather than inventing per-turn configuration.

## 11. Output

- Versioned system prompts and few-shot examples
- Tool/function schemas with validation
- Evaluation harness (unit/integration/behavioral) + golden set
- Guardrail rules + redaction policy
- Memory index + RAG retrieval config
- Observability dashboards (traces, metrics, alerts)
- Deployed streaming/batch endpoints with human-in-loop gates

## 12. Best Practices

- **Version every prompt** — never edit prod prompts inline
- **Gate prompts on eval** — no behavior change without harness green
- **Validate tools server-side** — never trust the model's arguments
- **Redact PII before it leaves the client** — input and output
- **Refuse rather than confabulate** — low confidence → safe refusal
- **Trace every turn** — keyed by run id for replay
- **Human-in-loop for state changes** — approval before mutation

## 13. Complements

- [`28-web-design-master.md`](28-web-design-master.md) — design system standard for agent UI surfaces
- [`27-system-design.md`](27-system-design.md) — C4-lite system design for agent backends
- [`25-design-tokens.md`](25-design-tokens.md) — DTCG 3-tier token architecture (design tokens for agent chat UI)

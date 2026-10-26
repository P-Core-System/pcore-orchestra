# P-Core Orchestra — Docs Index

> **Docs version:** 3.7 (October 2026)

## Core documentation

Start with the [README](../README.md) for install and quick start, then:

| Doc | Covers |
|---|---|
| [01 — Overview & Architecture](01-OVERVIEW-AND-ARCHITECTURE.md) | Executive summary, tech stack, folder structure, application architecture |
| [02 — Features, Hooks, Components & Agents](02-FEATURES-HOOKS-COMPONENTS-AGENTS.md) | Feature documentation, hooks API, agent roster |
| [03 — Database, Security, Testing & Limitations](03-DATABASE-SECURITY-TESTING-LIMITATIONS.md) | State storage, security model, testing strategy, known limitations |
| [04 — AI Context, Onboarding & Statistics](04-AI-CONTEXT-ONBOARDING-STATISTICS.md) | AI context export, onboarding guide, usage statistics |

## Topic guides

| Doc | Covers |
|---|---|
| [production-loop.md](production-loop.md) | Production-grade plan→implement→verify→review cycle with durable artifacts and gates |
| [autonomous-workflow.md](autonomous-workflow.md) | Cursor/OpenCode autonomy profiles, permissions, sandbox |
| [agent-permissions.md](agent-permissions.md) | OpenCode agent frontmatter permission contract |
| [orchestra-cross-platform.md](orchestra-cross-platform.md) | Cursor vs OpenCode vs Qoder spawn matrix |
| [mcp-chatgpt.md](mcp-chatgpt.md) | MCP knowledge server: docs/context read tools, share inbox, Streamable HTTP front for ChatGPT connectors |
| [token-optimization.md](token-optimization.md) | Token spend reduction, cache-hit measurement, budgets |
| [concurrency-tracking.md](concurrency-tracking.md) | Session claims and multi-session isolation |
| [greenfield-and-gaps.md](greenfield-and-gaps.md) | Greenfield intake flow and gap analysis |
| [studio-v2-architecture.md](studio-v2-architecture.md) / [studio-v2-design-spec.md](studio-v2-design-spec.md) | Studio dashboard backend architecture and design spec |
| [agent-harness-recommendations.md](agent-harness-recommendations.md) | Harness/loop/prompt recommendations |
| [agent-orchestra-rag-research.md](agent-orchestra-rag-research.md) | RAG/context research and roadmap |
| [plan-signal-watcher.md](plan-signal-watcher.md) | Cross-repo plan signal watcher usage |
| [master-engineering-prompt.md](master-engineering-prompt.md) | Master engineering & verification implementation prompt |
| [opencode.json.example](opencode.json.example) | Reference OpenCode V2 config for an orchestra install |

## Historical artifacts (dated — not maintained)

`audit/` and `plans/` freeze point-in-time reviews and implementation plans from specific
commits/versions. They are kept for provenance; do not treat them as current truth —
the living spec is `context/` + `AGENTS.md` + the docs above.

- [audit/agent-architecture-audit.md](audit/agent-architecture-audit.md)
- [audit/hook-runtime-audit.md](audit/hook-runtime-audit.md)
- [audit/security-observability-audit.md](audit/security-observability-audit.md)
- [audit/workflow-tests-git-audit.md](audit/workflow-tests-git-audit.md)
- [audit/pcore-orchestra-deep-architecture-workflow-audit.md](audit/pcore-orchestra-deep-architecture-workflow-audit.md)
- [plans/2026-07-12-harness-scaffold-loop.md](plans/2026-07-12-harness-scaffold-loop.md)
- [plans/2026-07-13-events-heartbeat-memory-resumable.md](plans/2026-07-13-events-heartbeat-memory-resumable.md)
- [plans/phase5-multiagent-execution-plan.md](plans/phase5-multiagent-execution-plan.md)

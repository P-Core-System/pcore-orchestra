# Orchestra — Cursor vs OpenCode

Same four phases, different spawn syntax and chaining.

## Entry point

| Platform | Who the user talks to | Phase agents |
|----------|----------------------|--------------|
| **Cursor** | Main Agent (hooks ambient) or `orchestra` conductor | `orchestra-*` via Task |
| **OpenCode** | `orchestra` conductor only (`default_agent`) | Hidden `orchestra-*` via **task** tool |

Never @-mention or pick `orchestra-planner` / implementer / verifier / reviewer on OpenCode — they are `hidden: true`.

## Spawn syntax

### Cursor IDE

```text
Task(subagent_type="orchestra-planner", prompt="Goal: …\nHandoff: …")
```

- Tool name: **Task** (capital T)
- Parameter: **subagent_type** = `orchestra-planner` | `orchestra-implementer` | `orchestra-verifier` | `orchestra-reviewer`
- Hooks **auto-chain** the next phase on `subagentStop` when markers appear (`PLAN_READY`, `IMPLEMENT_DONE`, …)

### OpenCode CLI / desktop

```text
task(agent="orchestra-planner", prompt="Goal: …\nHandoff: …")
```

- Tool name: **task** (lowercase — OpenCode permission key)
- Parameter: **agent** = same four names
- **No hooks** — the `orchestra` conductor must call **task** for each phase in order and wait for markers

## Phase flow (shared)

```text
orchestra-planner      → PLAN_READY
orchestra-implementer  → IMPLEMENT_DONE (+ git commit)
orchestra-verifier     → VERIFY_PASS | VERIFY_FAIL
orchestra-reviewer     → ORCHESTRA_COMPLETE | FIX_REQUIRED
```

On `VERIFY_FAIL` / `FIX_REQUIRED`: implementer → verifier again (max 3 loops).

## Tools & permissions

| Capability | Cursor | OpenCode |
|------------|--------|----------|
| Spawn subagent | Task + subagent_type | task + agent name |
| Conductor | Optional `~/.cursor/agents/orchestra.md` | Required `~/.config/opencode/agents/orchestra.md` |
| Auto phase chain | `subagentStop` hooks | Conductor task loop |
| Web / docs | Settings + permissions.json | `websearch` / `webfetch` in agent permission |
| Skills | `~/.cursor/skills/orchestra-loop/` | `~/.config/opencode/skills/orchestra-loop/` |
| MCP | Cursor MCP | `opencode.json` mcp (disable remote if startup hangs) |

## Models by platform

### Cursor

Cursor subscriptions include a **Cursor Models** pool with generous usage: `composer-2.5`, `grok-4.6`, `grok-4.5`. Third-party models (Claude, GPT, Gemini) live in the smaller **Other Models** pool and should not be daily defaults.

| Task | Primary | Escalation |
|------|---------|------------|
| Daily agent / plan / implement / review / verify | `composer-2.5` (standard, not Fast) | `grok-4.6` standard, `effort: high` |
| Hard / long-horizon / architecture | `grok-4.6` standard, `effort: high` | — |
| Avoid as default | Fast variants, Claude/GPT/Gemini | They burn Other Models 3–6× faster |

**Set the default:** use the Cursor model picker, run `bash scripts/setup-cursor-model.sh`, or add `model: composer-2.5` to agent frontmatter.

Enterprise specialists in `bundle/agents/01-idea/` through `10-review/` also carry the platform split: `model:` for Cursor and `opencode_model:` for OpenCode. Hard roles (architecture, security, performance) default to `grok-4.6` on Cursor; all others default to `composer-2.5`.

### OpenCode

Preflight:

```bash
bash scripts/update-free-models.sh --refresh
bash scripts/update-free-models.sh --probe
```

| Role | Primary | Notes |
|------|---------|--------|
| planner / implementer / reviewer / conductor | `x-preview-f-free` (ox-alpha) | Reliable text on OpenCode Zen |
| verifier / small_model | `mimo-v2.5-free` | Fast checks |
| Avoid as primary | `x-preview-f-free`, `hy3-free`, `muse-spark-*` | Silent, timeout, or region-blocked |

## Fix “no response”

### CLI works, desktop silent (most common)

1. **Sidecar mismatch** — CLI upgraded but desktop app not restarted:
   ```bash
   opencode --version   # note version
   # Quit OpenCode desktop completely, reopen
   ```
2. **Missing `mode: primary`** on `agent.orchestra` when `default_agent: orchestra` — desktop may not route. Fix:
   ```bash
   bash scripts/fix-opencode-response.sh
   node ~/.config/opencode/hooks/orchestra-health-opencode.js --heal
   ```
3. **Slow free model** — free models can take **30–90s** before text appears; desktop looks frozen. Orchestra agent uses `reasoningEffort: low` after merge.
4. **Reasoning-only flash** — some models emit reasoning tokens before text; UI may look blank briefly.

### OpenCode

```bash
bash scripts/fix-opencode-response.sh --disable-remote-mcp
# Restart OpenCode desktop app (sidecar must match CLI)
```

### Cursor

```bash
bash install.sh --cursor
node ~/.cursor/hooks/orchestra-health.js
# Restart Cursor
```

## Install / sync

```bash
bash install.sh --all          # Cursor + OpenCode bundle
bash install.sh --cursor       # hooks, agents, skills, rules
bash install.sh --opencode     # agents, skills, opencode.json merge

node scripts/sync-opencode-agents.js   # Cursor → OpenCode markdown (optional; core skipped by default)
```

Reference: `bundle/agents/references/orchestra-spawn-matrix.md`

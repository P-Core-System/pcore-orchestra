# Orchestra — Cursor vs OpenCode vs Qoder

Same four phases, different spawn syntax and chaining.

## Entry point

| Platform | Who the user talks to | Phase agents |
|----------|----------------------|--------------|
| **Cursor** | Main Agent (hooks ambient) or `orchestra` conductor | `orchestra-*` via Task |
| **OpenCode** | `orchestra` conductor only (`default_agent`) | Hidden `orchestra-*` via **task** tool |
| **Qoder CLI** | Main Agent (hooks ambient) or `orchestra` conductor | `orchestra-*` via **Agent** tool |

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

### Qoder CLI

```text
Agent(subagent_type="orchestra-planner", prompt="Goal: …\nHandoff: …")
```

- Tool name: **Agent**
- Parameter: **subagent_type** = same four names (agents live in `~/.qoder/agents/`)
- Hooks registered in `~/.qoder/settings.json` under PascalCase events (`SessionStart`, `UserPromptSubmit`, `SubagentStop`, `Stop`) — **auto-chain** like Cursor
- Hook stdin carries `agent_type` (not `subagent_type`); `bundle/hooks/lib/io.js` `normalizeHookInput()` maps it so the shared Cursor hooks work unchanged

## Phase flow (shared)

```text
orchestra-planner      → PLAN_READY
orchestra-implementer  → IMPLEMENT_DONE (+ git commit)
orchestra-verifier     → VERIFY_PASS | VERIFY_FAIL
orchestra-reviewer     → ORCHESTRA_COMPLETE | FIX_REQUIRED
```

On `VERIFY_FAIL` / `FIX_REQUIRED`: implementer → verifier again (max 3 loops).

## Tools & permissions

| Capability | Cursor | OpenCode | Qoder CLI |
|------------|--------|----------|-----------|
| Spawn subagent | Task + subagent_type | task + agent name | Agent + subagent_type |
| Conductor | Optional `~/.cursor/agents/orchestra.md` | Required `~/.config/opencode/agents/orchestra.md` | Optional `~/.qoder/agents/orchestra.md` |
| Auto phase chain | `subagentStop` hooks | Conductor task loop | `SubagentStop` hooks (settings.json) |
| Web / docs | Settings + permissions.json | `websearch` / `webfetch` in agent permission | WebSearch / WebFetch tools (agent `tools:` frontmatter) |
| Skills | `~/.cursor/skills/orchestra-loop/` | `~/.config/opencode/skills/orchestra-loop/` | `~/.qoder/skills/orchestra-loop/` |
| MCP | Cursor MCP | `opencode.json` mcp (disable remote if startup hangs) | `settings.json` mcpServers or `.mcp.json` |
| Hooks config | `~/.cursor/hooks.json` | none (conductor-driven) | `~/.qoder/settings.json` `hooks` (PascalCase events) |
| Agent frontmatter | Cursor format | `permission:` V1 objects, `hidden:` | Qoder format (`disallowedTools`, `maxTurns`, `permissionMode`, `effort`) via `scripts/sync-qoder-agents.js` |

### OpenCode permission fix scope (RC1–RC5)

The OpenCode permission surface was reworked across five release candidates (verified
via `opencode debug agents` at `v2.0.29`):

- **RC1 — ID-namespaced conductor allowlist.** Bare-name globs matched 0/42 specialists; namespaced `dir/*` globs achieve 160/160. The conductor `permission.task` allowlist is regenerated from `bundle/agent-registry.json`.
- **RC2 — Frontmatter syntax standard.** V1 `permission:` objects in agent frontmatter are the reliable per-agent form (V2 arrays are dropped when `name:` is present, and all 160 agents carry `name:`). `tools:` is deprecated and unused.
- **RC3 — Deny-first root strip.** `"*": deny` first rule, keep `read*` allow + `shell* allow` (builtin bash default is ask; stripping read/shell causes prompt loops).
- **RC4 — Default-export ambient plugin.** `{id, setup}` via `ctx.session.hook("context")` + SystemPart; `install.sh`/`install.ps1` MUST copy `bundle/opencode/plugins/`.
- **RC5 — Fail-open observability log.** `harness-observability.js` logs `input.received`, `input.classified`, `spawn.attempted`, `spawn.result`, `permission.denied` to `harness-observability.json` (ring-capped, fail-open, `PCORE_STATE_DIR`-aware).

**Agents covered:** all 160 OpenCode agents (`bundle/opencode/agents/`), including the conductor `orchestra` and the four hidden phase agents
`orchestra-planner`, `orchestra-implementer`, `orchestra-verifier`, `orchestra-reviewer`.

**Cursor side:** byte-identical (`bundle/agents/**`, `bundle/hooks/**`, `bundle/config/cursor/**`) — kept working, no changes.

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
bash scripts/update-free-models.sh --apply     # assign primary+heavy from live pools
bash scripts/update-free-models.sh --probe
bash scripts/update-free-models.sh --schedule  # weekly refresh+apply timer
```

Model IDs are **dynamic** (no hardcoded free-model IDs): `--apply` picks the
highest-stability probe-reachable free model (all pools; falls back to light
pool head) as primary and the top reachable heavy/free model as fallback from
`~/.config/opencode/state/{free-models,model-pools,probes}.json`, then rewrites
`autonomy.json`, `docs/opencode.json.example`, installed free-tier refs, and
agent frontmatter.

| Role | Primary | Notes |
|------|---------|--------|
| all agents (inherit global) | global `model` (stability-ordered primary via `--apply`) | Inspect installed `opencode.json` top-level `model` / `agents.title.model` |
| verifier / small_model | global `small_model` (same inherit) | Fast checks |
| heavy fallback | heavy free pool head (set by `--apply` into `small_model` when distinct) | Used when primary errors |
| Avoid as primary | any ID that `--check` marks DEAD | Not in live free cache (dead/region-blocked) |

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

### Qoder CLI

```bash
bash install.sh --qoder
node scripts/merge-qoder-settings.js --qoder-home ~/.qoder --dry-run   # inspect hook merge
node ~/.qoder/hooks/orchestra-health.js
# Restart any running qoder sessions
```

## Install / sync

```bash
bash install.sh --all          # Cursor + OpenCode + Qoder bundle
bash install.sh --cursor       # hooks, agents, skills, rules
bash install.sh --opencode     # agents, skills, opencode.json merge
bash install.sh --qoder        # hooks, converted agents, skills, settings.json merge

node scripts/sync-opencode-agents.js   # Cursor → OpenCode markdown (optional; core skipped by default)
node scripts/sync-qoder-agents.js      # Cursor → Qoder frontmatter (bundle/qoder/agents/; --check for drift)
node scripts/merge-qoder-settings.js   # merge orchestra hooks into ~/.qoder/settings.json (idempotent)
```

Reference: `bundle/agents/references/orchestra-spawn-matrix.md`

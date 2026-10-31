# Orchestra — Cursor vs OpenCode vs Qoder vs Claude Code vs Codex

Same four phases, different spawn syntax and chaining.

## Entry point

| Platform | Who the user talks to | Phase agents |
|----------|----------------------|--------------|
| **Cursor** | Main Agent (hooks ambient) or `orchestra` conductor | `orchestra-*` via Task |
| **OpenCode** | `orchestra` conductor only (`default_agent`) | Hidden `orchestra-*` via **subagent** tool |
| **Qoder CLI** | Main Agent (hooks ambient) or `orchestra` conductor | `orchestra-*` via **Agent** tool |
| **Claude Code** | Main Agent (hooks ambient) or `orchestra` agent | `orchestra-*` via **Agent** tool (`Task` alias) |
| **Codex CLI** | Main session (`multi_agent` stable/on) | `orchestra-*` via **spawn_agent** tool |

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
subagent(agent="orchestra-planner", description="plan login fix", prompt="Goal: …\nHandoff: …")
```

- Tool name: **subagent** (OpenCode V2 native; `task` is the deprecated V1 alias)
- Required parameters: **agent** = same four names, **description** (3–5 words), **prompt** (V2 uses `agent`, not `subagent_type`; `sessionID` continues a prior child)
- **No hooks** — the `orchestra` conductor must call **subagent** for each phase in order and wait for markers

#### OpenCode versions (V1 vs V2)

The orchestra runtime requires **OpenCode V2** (`@opencode/cli`; verified against 2.1.4). The conductor contract — `subagent` tool shape, `sessionID` resume, plugin ambient-context API, `agents/` discovery — is V2; none of it runs on the V1 CLI (`opencode-ai`, which tops out at 1.19.x).

- **Install always targets V2.** `install.sh` (default) upgrades to the npm `latest` via `scripts/ensure-opencode-latest.sh`, with a downgrade guard that refuses to step onto the V1 line. `--skip-opencode-upgrade` keeps the current CLI — if that CLI is V1, orchestra will not drive it.
- **V1 configs are handled, not abandoned.** V2 reads supported V1 `opencode.json` without rewriting; the installer additionally migrates the tree to native V2 shape (`permission`→`permissions`, `bash`→`shell`, `task`→`subagent`, `agent`→`agents`, MCP restructure) via `scripts/lib/opencode-v2.js` before merging autonomy profiles — idempotent, round-trip tested (`scripts/test-opencode-v2.js`).
- **V1 frontmatter ≠ V1 CLI.** Agent files deliberately keep the V1 `permission:` object form because current V2 CLIs honor it most reliably (V2 arrays are dropped when `name:` is present — see `docs/agent-permissions.md`, RC2).
- **The three V1→V2 breaking changes** (plugin API, server/SDK API, config form) do not affect the bundle: we ship only V2 default-export plugins (`{id, setup}` + `ctx.session.hook("context")`), never call OpenCode's HTTP server, and migrate config as above. If you carried V1 plugins from another setup they will not run under V2 — port them.
- **Do not keep the legacy `opencode-ai` 1.x package installed alongside** `@opencode/cli` — both provide the `opencode` bin and the wrong one may win.

### Qoder CLI

```text
Agent(subagent_type="orchestra-planner", prompt="Goal: …\nHandoff: …")
```

- Tool name: **Agent**
- Parameter: **subagent_type** = same four names (agents live in `~/.qoder/agents/`)
- Hooks registered in `~/.qoder/settings.json` under PascalCase events (`SessionStart`, `UserPromptSubmit`, `SubagentStop`, `Stop`) — **auto-chain** like Cursor
- Hook stdin carries `agent_type` (not `subagent_type`); `bundle/hooks/lib/io.js` `normalizeHookInput()` maps it so the shared Cursor hooks work unchanged
- Session identity: hook payload `session_id`, else `QODER_SESSION_ID`, else `QODER_PID` — every event in one Qoder conversation shares one state session instead of a `pid-*` session per hook process
- Host detection: `QODER_CLI` / `QODER_PID` / `QODER_SESSION_ID`, or an installed `~/.qoder` hook path, selects the **Agent** spawn adapter (not Cursor's **Task**)
- `node ~/.qoder/hooks/orchestra-health.js` validates `settings.json` (lifecycle, memory, heartbeat, quality gate, 27-agent matcher) because Qoder has no `hooks.json`

### Claude Code CLI

```text
Agent(subagent_type="orchestra-planner", description="plan login fix", prompt="Goal: …\nHandoff: …")
```

- Tool name: **Agent** (v2.1.63 renamed `Task` → `Agent`; `Task` remains an accepted alias)
- Parameter: **subagent_type** = same four names; agent definitions are `.claude/agents/*.md` (project) or `~/.claude/agents/*.md` with `name` + `description` frontmatter — the same markdown our `bundle/agents/` tree uses
- Hooks live in `.claude/settings.json` / `~/.claude/settings.json` under PascalCase events (`PreToolUse`, `PostToolUse`, `SubagentStop`, `Stop`, `SessionStart`, `SessionEnd`, …) — same nested `{matcher, hooks:[{type,command}]}` schema as Qoder; hook stdin carries `agent_type` inside subagents, which `lib/io.js` normalizes
- Installer: `bash install.sh --claude` writes 160 flat agents to `~/.claude/agents` (`scripts/sync-claude-agents.js`), copies hooks + skills, and merges the four events into `~/.claude/settings.json` (`scripts/merge-claude-settings.js`, backup + idempotent). Writable agents carry `permissionMode: acceptEdits`; readonly agents carry `disallowedTools: Write, Edit, NotebookEdit`
- `SubagentStop` hook JSON with `decision:"block"` + `reason` **keeps the subagent running and delivers the reason as its next instruction** — the natural verify→implement channel
- MCP: consumes `.mcp.json` / `claude mcp add` (stdio + HTTP; SSE deprecated) and can itself serve `claude mcp serve`
- Headless loops: `claude -p --output-format stream-json --include-hook-events`, `--agents '{…}'`, `--max-turns`, `--allowedTools`

### Codex CLI

```text
spawn_agent(agent_type="orchestra-planner", message="Goal: …\nHandoff: …")
```

- Tool name: **spawn_agent** (`[features] multi_agent` is stable and default-on; also `send_input` / `resume_agent` / `wait_agent` / `close_agent`; `/subagents` lists threads)
- Parameter: **agent_type** = name of a built-in (`default`, `worker`, `explorer`) or custom agent; custom agents are `.codex/agents/<name>.toml` with `name`, `description`, `developer_instructions` (TOML, not markdown frontmatter) — `bash install.sh --codex` generates all 160 via `scripts/sync-codex-agents.js`
- Subagents inherit the parent sandbox/approval policy: `sandbox_mode = "workspace-write"`, `approval_policy = "on-request"` (or `"never"` for headless `codex exec --sandbox workspace-write --ask-for-approval never --json`)
- Hooks exist (`~/.codex/hooks.json` / `.codex/hooks.json`, gated by `features.hooks`, events include `SubagentStart`/`SubagentStop`) but the installer intentionally leaves them unwired — the conductor drives phases with completion markers
- AGENTS.md is read natively (global `~/.codex/AGENTS.md` → repo root-down chain, 32 KiB cap); MCP is client-only: `[mcp_servers.name] command=…` or `url=…` + `bearer_token_env_var` in `config.toml`

## Phase flow (shared)

```text
orchestra-planner      → PLAN_READY
orchestra-implementer  → IMPLEMENT_DONE (+ git commit)
orchestra-verifier     → VERIFY_PASS | VERIFY_FAIL
orchestra-reviewer     → ORCHESTRA_COMPLETE | FIX_REQUIRED
```

On `VERIFY_FAIL` / `FIX_REQUIRED`: implementer → verifier again (max 3 loops).

## Tools & permissions

| Capability | Cursor | OpenCode | Qoder CLI | Claude Code | Codex CLI |
|------------|--------|----------|-----------|-------------|-----------|
| Spawn subagent | Task + subagent_type | **subagent** + agent name + description | Agent + subagent_type | Agent (`Task` alias) + subagent_type | **spawn_agent** + agent_type + message |
| Conductor | Optional `~/.cursor/agents/orchestra.md` | Required `~/.config/opencode/agents/orchestra.md` | Optional `~/.qoder/agents/orchestra.md` | Optional `~/.claude/agents/orchestra.md` | `AGENTS.md` + 160 TOML agents (`~/.codex/agents/`) |
| Auto phase chain | `subagentStop` hooks | Conductor subagent loop | `SubagentStop` hooks (settings.json) | `SubagentStop` hooks (block+reason resumes the agent) | Not wired (hooks gated by `features.hooks`) |
| Web / docs | Settings + permissions.json | `websearch` / `webfetch` in agent permission | WebSearch / WebFetch tools (agent `tools:` frontmatter) | WebFetch / WebSearch tools | `web_search` tool + `codex mcp` |
| Skills | `~/.cursor/skills/orchestra-loop/` | `~/.config/opencode/skills/orchestra-loop/` | `~/.qoder/skills/orchestra-loop/` | `~/.claude/skills/<name>/SKILL.md` | `.agents/skills/<name>/SKILL.md` |
| MCP | Cursor MCP | `opencode.json` mcp (disable remote if startup hangs) | `settings.json` mcpServers or `.mcp.json` | `.mcp.json` + `claude mcp add` (also `claude mcp serve`) | `config.toml` `[mcp_servers.x]` stdio + `url=` HTTP |
| Hooks config | `~/.cursor/hooks.json` (`version: 1`) | none (conductor-driven) | `~/.qoder/settings.json` `hooks` (PascalCase events) | `.claude/settings.json` / `~/.claude/settings.json` (PascalCase events) | `~/.codex/hooks.json` / `.codex/hooks.json` (`features.hooks`) |
| Agent frontmatter | Cursor format | `permission:` V1 objects, `hidden:` | Qoder format (`disallowedTools`, `maxTurns`, `permissionMode`, `effort`) via `scripts/sync-qoder-agents.js` | md frontmatter (`name`, `description`, `tools`, `permissionMode` / `disallowedTools`) via `scripts/sync-claude-agents.js` | TOML (`name`, `description`, `developer_instructions`) via `scripts/sync-codex-agents.js` |

### Codex agent mirror (#38)

`scripts/sync-codex-agents.js` generates the 160 `~/.codex/agents/*.toml` files from the
Cursor markdown agents. Because a Codex custom agent inherits the session model and
spawns via `spawn_agent` (not Cursor's `Task` + `subagent_type` or OpenCode's `subagent`),
the Cursor/OpenCode-only `## Model` / `## Models` section — `composer-2.5`/`grok-4.6`,
the "Other Models" pool, and the "Cursor Task vs OpenCode task" spawn note — is
**stripped** and replaced with a Codex-neutral "uses the model configured for the session"
note. Non-model role lines ("You are the … subagent") are preserved. `test-codex-sync.js`
asserts that no generated TOML mentions any of those Cursor phrases.

Remaining intentional difference: the conductor `orchestra.toml` keeps a
`## Cursor cross-reference` section that points here — it documents how the same loop maps
to Cursor/OpenCode rather than instructing the Codex agent to use them.

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

# P-Core Orchestra

> Ambient multi-agent orchestration for **Cursor**, **OpenCode CLI**, **Qoder CLI**,
> **Claude Code**, and **Codex CLI** — plan → implement → verify → review,
> automatically on build/fix/refactor prompts

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js 18+](https://img.shields.io/badge/Node.js-18+-339933.svg)](https://nodejs.org/)
[![Cursor IDE](https://img.shields.io/badge/Cursor-IDE-000000.svg)](https://cursor.com)
[![OpenCode](https://img.shields.io/badge/OpenCode-CLI-FF6B35.svg)](https://opencode.ai)
[![Qoder CLI](https://img.shields.io/badge/Qoder-CLI-6C5CE7.svg)](https://qoder.com)
[![Claude Code](https://img.shields.io/badge/Claude_Code-CLI-D97757.svg)](https://claude.com/claude-code)
[![Codex CLI](https://img.shields.io/badge/Codex-CLI-10A37F.svg)](https://developers.openai.com/codex/)
[![Release](https://img.shields.io/github/v/release/P-Core-System/pcore-orchestra?label=release&color=6C5CE7)](https://github.com/P-Core-System/pcore-orchestra/releases/tag/v3.9.0)

**Repository:** [github.com/P-Core-System/pcore-orchestra](https://github.com/P-Core-System/pcore-orchestra)
**Docs map:** [docs/index.md](docs/index.md)

**Status:** Production-ready (lifecycle stage: `production`, channel: `stable`) | **Version:** 3.9.0 | **Last updated:** 2026-10-31

---

## Quick Start (2 minutes)

```bash
# 1. Clone the stable release tag and install (all five hosts; hooks + skills + agents + settings merge)
git clone --branch v3.9.0 --depth 1 https://github.com/P-Core-System/pcore-orchestra.git
cd pcore-orchestra
bash install.sh
# One host only: bash install.sh --cursor | --opencode | --qoder | --claude | --codex
# Preview changes: bash install.sh --dry-run
# Skip CLI upgrade: bash install.sh --skip-opencode-upgrade
# Track latest (unstable) instead of a pinned tag: drop `--branch v3.9.0` to clone main
# Remove later: bash install.sh --uninstall  (scope with --cursor etc.; add --studio to tear down Studio)
# Windows: powershell -ExecutionPolicy Bypass -File install.ps1

# 2. Restart Cursor → Settings → Agents → Approvals → Auto-review
#    OpenCode: restart desktop app + opencode --auto
#    Qoder: restart sessions + qoder --agent orchestra
#    Claude Code / Codex: restart the session (agents + hooks are discovered at startup)

# 3. Use it (no special commands)
fix the login bug
add install script
deploy to VPS
```

Orchestra auto-runs: **planner → implementer → verifier → reviewer**.

---

## Requirements

| Requirement | Version | Purpose |
|-------------|---------|---------|
| Node.js | 18+ (22.5+ for hybrid recall) | Hook scripts; SQLite FTS5 memory uses the built-in `node:sqlite`, so on older Node recall stays JSON-only |
| Cursor | Latest | IDE Agent mode or Cursor CLI |
| OpenCode CLI | **V2 required** (`@opencode/cli`, latest) | Optional; `install.sh` upgrades automatically and migrates V1 `opencode.json` to V2 — V1 (`opencode-ai` 1.x) cannot run orchestra |
| Qoder CLI | Latest | Optional; installs to `~/.qoder` (agents, skills, hooks in settings.json) |
| Claude Code | Latest | Optional; installs to `~/.claude` (agents, skills, hooks in settings.json) |
| Codex CLI | Latest | Optional; installs 160 TOML agents to `~/.codex/agents` (hooks stay unwired) |
| Git | 2.x | Version control |
| Python 3 | Optional | Only for `ui-ux-pro-max` / design-system `search.py` scripts — not required for orchestra hooks |

Install also vendors UI skills (`ui-ux-pro-max`, `brand`, `design-system`, `ui-styling`, `web-design-master`) into `~/.cursor/skills` and links them under `~/.agents/skills`. See `THIRD_PARTY.md`.

---

## Interactive Project Init

Create a new project with full P-Core Orchestra context — including version tracking, daily plans, tasks, and team setup — via a guided interview:

```bash
# Interactive guided setup (recommended for new projects)
bash scripts/init-project.sh
bash scripts/init-project.sh /path/to/project

# Silent mode (flags only)
bash scripts/init-project.sh /path/to/project --type web --name "Auth Service" --arch 04-frontend-react

# PowerShell
powershell -File scripts/init-project.ps1
powershell -File scripts/init-project.ps1 -Target . -Type web -Name "My App"
```

The interactive mode walks through **11 steps**: project basics, description & goals, features & scope, team, technology stack, architecture, environments, security, deployment, observability, and timeline. It auto-fills all context files, seeds `project.yaml`, creates a daily plan, and initializes version tracking (0.1.0/dev).

## Universal Project Identity System

Every project declares its identity in `project.yaml` at the project root. This file captures the full software engineering context — from lifecycle stage and version to team, stack, infrastructure, security, and compliance.

**What `project.yaml` covers:** project metadata, semantic versioning, lifecycle stage (idea→production→sunset), team roles, repository config, technology stack, environments (dev/staging/prod), integrations (CI/CD, monitoring, analytics), AI assistant config, infrastructure, security/auth, compliance, observability, backup/DR, and P-Core managed fields.

Orchestra auto-detects `project.yaml` in any workspace and injects its identity into agent context.

---

## What You Get

| Feature | Description |
|---------|-------------|
| **Conductor** | `orchestra` — entry point; spawns all phases internally |
| **4 Subagents** | `orchestra-planner`, `orchestra-implementer`, `orchestra-verifier`, `orchestra-reviewer` (internal, do not invoke directly) |
| **Convergence Criteria** | Build/tests/lint/security/docs-reviewed green → reviewer approval → production checklist |
| **Stall Detection** | Heartbeat threshold 5 min → nudge → second consecutive stall aborts |
| **Human Checkpoints** | Auth/payments/security/scope-creep require human review |
| **Production Checklist Gate** | `ORCHESTRA_COMPLETE` blocked until build/tests/lint/security/reviewer-approval/docs-updated/memory-updated green, security clean, progress-tracker referenced, six-file context present |
| **Token Budgets** | planner:10k, implementer:30k, verifier:15k, reviewer:8k |
| **Model Routing** | Cursor: `composer-2.5` default, `grok-4.6` for hard tasks; OpenCode: free models only, dynamically assigned weekly (`--apply`); Qoder: converted agents inherit the host model |
| **8 Hook Commands** | Session, prompt, subagent-stop, lifecycle, memory, quality-gate, stop, heartbeat |
| **Six-File Context** | Stable grounding across sessions (JavaScript Mastery methodology) |
| **Free Model Support** | OpenCode Zen free models + multi-key rotation + weekly dynamic refresh (`--schedule`) |
| **Works With** | Cursor (IDE + CLI), OpenCode CLI, Qoder CLI, Claude Code, Codex CLI, any Node.js project; all five hosts have installer support (`--cursor` / `--opencode` / `--qoder` / `--claude` / `--codex`) — see `docs/orchestra-cross-platform.md` |
| **Install Skill** | `orchestra-install` — agents can install, verify, repair, or upgrade orchestra on any machine |

---

## How It Works

```
User: "fix the login bug"
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│  Orchestra Loop                                         │
│                                                         │
│  1. PLANNER ──► researches codebase, outputs plan       │
│       │                                                 │
│  2. IMPLEMENTER ──► writes code, runs syntax check      │
│       │                                                 │
│  3. VERIFIER ──► runs tests, lint, type check           │
│       │                                                 │
│  4. REVIEWER ──► checks scope, security, docs           │
│       │                                                 │
│       ▼                                                 │
│  IF FAIL ──► implementer fixes ──► loop back to step 3  │
│  IF PASS ──► ORCHESTRA_COMPLETE                         │
└─────────────────────────────────────────────────────────┘
```

---

## Where It's Set Up

### Cursor (global)
```
~/.cursor/
├── hooks/                    # 8 hook commands + lib/
├── agents/                   # conductor + 4 core subagents + 155 specialists + references
├── skills/orchestra-loop/    # orchestration skill
├── rules/orchestra-loop.mdc  # always-on rule
└── hooks.json                # event bindings
```

### OpenCode CLI
```
~/.config/opencode/
├── agents/                   # conductor + 4 core subagents + 155 specialists
├── skills/orchestra-loop/    # orchestration skill
├── hooks/                    # byte-identical hook mirror + health check
├── plugins/orchestra-ambient.js  # session policy injection
└── state/
    ├── orchestra.json        # runtime state
    └── conductor-runs/       # per-run conductor state + registry (begin/save/who/resume)
```

### Qoder CLI
```
~/.qoder/
├── hooks/                    # 8 hook commands (shared with Cursor; lib/io.js normalizes agent_type)
├── agents/                   # 161 converted files (core + specialists + spawn matrix)
├── skills/orchestra-loop/    # orchestration skill
├── ORCHESTRA.md              # entry doc
└── settings.json             # hooks merged under SessionStart/UserPromptSubmit/SubagentStop/Stop
```

### Claude Code
```
~/.claude/
├── hooks/                    # 8 hook commands + lib/ (SubagentStop emits decision:block + reason)
├── agents/                   # 160 flat markdown agents (conductor + phases + specialists)
├── skills/orchestra-loop/    # orchestration skill
├── ORCHESTRA.md              # entry doc
└── settings.json             # hooks merged under SessionStart/UserPromptSubmit/SubagentStop/Stop
```

### Codex CLI
```
~/.codex/
├── agents/                   # 160 flat TOML agents (name, description, developer_instructions)
└── ORCHESTRA.md              # entry doc
~/.agents/skills/             # shared Agent Skills links (orchestra-loop, orchestra-install, UI, Cloudflare)
```
Codex hooks stay unwired because `features.hooks` is still gated; the conductor drives phases with completion markers.

### Per-project (with context/)
```
your-project/
├── AGENTS.md                 # entry point
└── context/
    ├── project-overview.md   # product definition
    ├── architecture.md       # system structure
    ├── code-standards.md     # conventions
    ├── ui-context.md         # UI guidelines
    ├── ai-workflow-rules.md  # verification rules
    └── progress-tracker.md   # current state
```

---

## Orchestra Studio (Dashboard)

A separate read-only React/Vite dashboard that visualizes orchestra runs, WorkItems, gate evidence, human reviews, and token usage.

### Install Studio

```bash
# Install with Studio (builds dashboard + creates launcher)
bash install.sh --studio

# Preview what the installer would do
bash install.sh --studio --dry-run
```

### Launch Studio

```bash
orchestra-studio                    # start service (or `orchestra-studio start`)
orchestra-studio status             # check if running (exit 0=healthy, 1=not running)
orchestra-studio stop               # stop service
orchestra-studio restart            # restart service
orchestra-studio logs               # follow logs (journalctl or file)
orchestra-studio uninstall          # remove service + cleanup
orchestra-studio enable-autostart   # enable autostart on login (systemd/launchd)
orchestra-studio disable-autostart  # disable autostart
orchestra-studio --foreground       # run server directly (dev mode)

# Or bypass the service and serve the built SPA by hand:
npx serve -l 0 ~/.config/opencode/studio/dist
# Or Cursor: npx serve -l 0 ~/.cursor/studio/dist
```

The service runs on **http://localhost:3110** by default (`install.sh --studio`
installs it with `--port 3110`); the manual `npx serve` fallback picks its own
port and prints it.

### Studio Features

| View | Description |
|------|-------------|
| **WorkItems** | Kanban board (Triage → Done) with 10 ticket states |
| **Runs** | Conductor run list + detail (phases, gates, evidence, handoff, tokens) |
| **Evidence** | Gate evidence table with search/sort/pagination + detail modal |
| **Reviews** | Human review inbox from phase outcomes |
| **Tokens** | Token aggregates by agent/phase + trend charts |

### State Discovery

Studio automatically discovers:
- **Global state**: `~/.config/opencode/hooks/state/` (or `PCORE_STATE_DIR`)
- **Worktree state**: `.pcore/state/` in each git worktree (partitioned per run)

Use the sidebar dropdown to switch between state directories.

---

## Commands

| Command | Effect |
|---------|--------|
| `no orchestra` | Skip for one prompt |
| `disable orchestra` | Turn ambient off |
| `enable orchestra` | Turn ambient on |
| `/orchestra stop` | Stop active loop |
| `/orchestra <goal>` | Force start with goal |
| `abort [reason]` | Save checkpoint and abort |

### Self-check (repo maintainers)

```bash
node scripts/gen-agent-registry.js            # regenerate agent-registry.json + conductor allowlist + hook matcher
node scripts/gen-agent-registry.js --check    # fail if anything generated is stale (CI)
node scripts/enrich-agent-capabilities.js     # write explicit tools: allowlists from readonly policy
node scripts/enrich-agent-capabilities.js --check  # drift gate (install.sh runs this)
node scripts/sync-qoder-agents.js --check     # bundle/qoder tree matches bundle/agents
node scripts/test-agent-capabilities.js       # capability + skill-metadata + installed-tree invariants
node scripts/test-e2e-suite.js                # run EVERY scripts/test-*.js and summarize
npm run test:e2e                              # same, via npm
node scripts/test-safe-write.js               # atomic state writes + quarantine
node scripts/test-state-manager-compat.js     # state-manager/lib compatibility
node scripts/test-conductor-state.js          # per-run isolation CLI
node scripts/test-phase-outcome.js            # end-token / failed-gate phase blocking
node scripts/test-agent-registry.js           # registry SSOT
node scripts/test-handshake-contract.js       # selector/orchestrator end tokens
node scripts/test-mirror-sync.js              # bundle/hooks == bundle/opencode/hooks
node scripts/test-mcp-knowledge.js            # MCP knowledge tools + HTTP front (ChatGPT)
node scripts/test-permission-review.js        # deny-first conductor allowlist, 160/160 coverage
node scripts/test-adaptive-loop.js            # phase model / adaptive loops
node scripts/test-domain-model.js             # domain entities + ticket/session state machine
node scripts/test-domain-completion.js        # claimed-vs-verified completion gate
node scripts/test-domain-store.js             # domain JSON store + checkpoint + hook append
node scripts/test-domain-evidence.js          # evidence run records appended on verify/review
node scripts/test-domain-state-dir.js         # domain state dir stays outside the bundle
node scripts/test-evidence-runner.js          # diff-derived docs-updated gate, fails closed on git errors
node scripts/test-review-queue.js             # human-review queue + hook context injection
node scripts/test-security-scanner.js         # scanner coverage, redaction, blocking CLI
node scripts/scan-secrets.js --dir . --fail-on=high   # blocking secret scan (CI runs this too)
```

The list above is the core subset; `node scripts/test-e2e-suite.js` runs every
`scripts/test-*.js` suite in isolation with a PASS/FAIL summary. CI runs 41 Node suites
plus the bash service suite on every PR; the capability suite and the e2e runner are
local gates. See `CONTRIBUTING.md` §3 for the full command set.

---

## Setup Your Project

```bash
# Full interactive guided setup (recommended)
bash scripts/init-project.sh /path/to/your-app

# Quick context files only
bash scripts/init-context.sh /path/to/your-app
bash scripts/init-context.sh /path/to/your-app --bridge   # with project bridge
```

---

## Knowledge Server (MCP → ChatGPT / remote)

The MCP server also speaks **Streamable HTTP**, so remote connectors like ChatGPT
developer mode can read your project docs/context and share knowledge back through
a reviewed inbox. Loopback needs no token; any other bind requires `PCORE_MCP_TOKEN`.

```bash
# serve the current project on http://127.0.0.1:8765/mcp
node scripts/mcp-knowledge-server.js --root "$PWD" --port 8765

# then front it with a tunnel for ChatGPT:
#   cloudflared tunnel --url http://localhost:8765
```

Tools: `search_docs`, `read_doc`, `read_context`, `search_memory` (read-only,
allowlisted) + `share_knowledge`, `list_knowledge` (pending inbox only — the
server never edits docs or context). Full setup, auth, and ChatGPT connector
steps: [`docs/mcp-chatgpt.md`](docs/mcp-chatgpt.md).

---

## Token Optimization

| Agent | Max Tokens | Cursor (default) | OpenCode (free) |
|-------|------------|------------------|-----------------|
| Planner | 10,000 | `composer-2.5` | free primary (stability-ordered via `--apply`) |
| Implementer | 30,000 | `composer-2.5` (or `grok-4.6` for hard tasks) | free primary (stability-ordered via `--apply`) |
| Verifier | 15,000 | `composer-2.5` | free primary (stability-ordered via `--apply`) |
| Reviewer | 8,000 | `composer-2.5` | free primary (stability-ordered via `--apply`) |

**Total per cycle:** ~63k tokens max.

```bash
# Pin the cheapest strong Cursor model
bash scripts/setup-cursor-model.sh

# Auto-generate optimized OpenCode config
bash scripts/setup-opencode-optimal.sh --balanced   # recommended
bash scripts/setup-opencode-optimal.sh --budget     # free models only
bash scripts/setup-opencode-optimal.sh --premium    # best quality
```

---

## Bypass Limits

### Cursor: Cheap built-in models
Use the included **Cursor Models** pool by default:
```bash
bash scripts/setup-cursor-model.sh            # pin composer-2.5 + validate agents
bash scripts/setup-cursor-model.sh --check    # audit only
```

For BYOK or premium models, see:
```bash
bash scripts/setup-cursor-byok.sh          # interactive guide
bash scripts/setup-cursor-byok.sh --litellm # GPT-5.5 proxy
```

### OpenCode: Free Models
```bash
bash scripts/setup-opencode-proxy.sh --free       # free Zen models (from live cache)
bash scripts/setup-opencode-proxy.sh --multi-key  # rotation guide
bash scripts/update-free-models.sh --check        # validate all agents stay on the free tier
bash scripts/update-free-models.sh --refresh --apply  # dynamic primary+heavy from live pools
bash scripts/update-free-models.sh --pools        # print frontend/heavy/light pools
bash scripts/update-free-models.sh --schedule     # weekly refresh+apply (systemd timer; cron fallback)
```

Weekly automation: `scripts/systemd/pcore-free-models.timer` (`OnCalendar=weekly`)
runs `--refresh --apply` via `pcore-free-models.service`. Installed by
`install.sh --opencode` or `--schedule`. **Cron fallback** (when systemd is missing):

```cron
17 4 * * 1 /bin/bash $HOME/projects/pcore-orchestra/scripts/update-free-models.sh --refresh --apply >> $HOME/.cache/pcore-free-models.log 2>&1
```

### Plan-Signal Watcher
```bash
bash scripts/watch-plan-signal.sh --once   # detect new plan/spec work → pending-signal.json (docs/plan-signal-watcher.md)
```

---

## Architecture: Operator Loop Stack

```
┌─────────────────────────────────────────────────────────┐
│  Harness (runtime)                                      │
│  ├── hooks (8 commands; gates + memory)                 │
│  ├── state (orchestra.json, memory.json)                │
│  └── error handling (stall detection, abort)            │
├─────────────────────────────────────────────────────────┤
│  Loop Contract                                          │
│  ├── Goal: what success looks like (testable)           │
│  ├── Scope: files in scope, what must NOT change        │
│  ├── Verifier: which tests/checks prove completion      │
│  ├── Budget: max iterations (8), tokens (63k), time     │
│  └── Escalation: when to pause for human                │
├─────────────────────────────────────────────────────────┤
│  State Layer                                            │
│  ├── Short-term: current run (phases, files, errors)    │
│  ├── Long-term: orchestra-memory.json (past goals)      │
│  └── History: orchestra-history.json (last 50 runs)     │
├─────────────────────────────────────────────────────────┤
│  Checker                                                │
│  ├── Convergence: build/tests/lint/security/docs green  │
│  ├── Stall detection: heartbeat timeout → nudge → abort  │
│  └── Human checkpoints: high-risk changes               │
├─────────────────────────────────────────────────────────┤
│  Human Checkpoint                                      │
│  ├── Auth/payments/security changes                     │
│  ├── Budget exhaustion                                  │
│  └── Blocked gates requiring a decision                 │
└─────────────────────────────────────────────────────────┘
```

---

## Documentation

| Doc | Purpose |
|-----|---------|
| [01-OVERVIEW-AND-ARCHITECTURE.md](docs/01-OVERVIEW-AND-ARCHITECTURE.md) | System architecture, operator loop stack, agent design |
| [02-FEATURES-HOOKS-COMPONENTS-AGENTS.md](docs/02-FEATURES-HOOKS-COMPONENTS-AGENTS.md) | Features, hooks, components, and agent definitions |
| [03-DATABASE-SECURITY-TESTING-LIMITATIONS.md](docs/03-DATABASE-SECURITY-TESTING-LIMITATIONS.md) | Database, security, testing, and known limitations |
| [04-AI-CONTEXT-ONBOARDING-STATISTICS.md](docs/04-AI-CONTEXT-ONBOARDING-STATISTICS.md) | AI context onboarding, statistics, and usage guide |
| [docs/index.md](docs/index.md) | Full docs map, topic guides, and dated historical artifacts |

### New guidance templates (2026)

| Template | Topic |
|----------|-------|
| [`templates/architectures/25-design-tokens.md`](templates/architectures/25-design-tokens.md) | Design tokens — W3C DTCG 3-tier architecture |
| [`templates/architectures/26-folder-structure.md`](templates/architectures/26-folder-structure.md) | Feature-based / monorepo folder structure |
| [`templates/architectures/27-system-design.md`](templates/architectures/27-system-design.md) | C4-lite system design document |
| [`templates/AGENTS.authoring.md`](templates/AGENTS.authoring.md) | Authoring `AGENTS.md` across OpenCode / Cursor / Claude / Copilot / Codex |

Agent-tool wiring: OpenCode global `AGENTS.md` + `opencode.json` instructions file list; repo-root `CLAUDE.md`; `.github/copilot-instructions.md`. See `templates/AGENTS.authoring.md`.

---

## Uninstall

`install.sh` uses the bundle as a manifest of what it installed, so `--uninstall`
removes only Orchestra's files (never your own agents/skills) and restores the
merged `settings.json` / `hooks.json` / `opencode.json` from the backups the
installers wrote.

```bash
# Remove from all five hosts + global helper scripts (Studio service kept unless --studio)
bash install.sh --uninstall

# Scope it: a single host, or add the Studio service teardown
bash install.sh --uninstall --cursor
bash install.sh --uninstall --all --studio

# Manual fallback (if you prefer, or if you installed from a different clone path):
rm -rf ~/.cursor/hooks/orchestra-* ~/.cursor/agents/orchestra-* ~/.cursor/ORCHESTRA.md
rm -rf ~/.qoder/hooks/orchestra-*  ~/.qoder/agents/orchestra-*  ~/.qoder/ORCHESTRA.md
rm -f  ~/.cursor/hooks.json  # then re-add any non-orchestra hooks you had
```

> The global gitignore (`~/.config/git/ignore`) and `git config core.excludesfile`
> are intentionally left in place on uninstall — they may contain your own entries.
>
> **On install**, `core.excludesfile` is set to `~/.config/git/ignore` only if you
> don't already have a global excludes file configured; an existing value is never
> overwritten (the installer prints what it kept). To combine both, append the
> lines from `~/.config/git/ignore` to your own excludes file.

> `--project` installs the Cursor project bridge into the **current repo**
> (`$PWD/.cursor`); use `--project-dir PATH` to target another repo, or
> `--force-project` to allow the orchestra clone itself as the target.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full self-check suite, mirror rule, generated-block rules, and commit conventions.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat(orchestra): add amazing feature'` — see [CONTRIBUTING.md](CONTRIBUTING.md) for commit conventions, and add a line to [CHANGELOG.md](CHANGELOG.md) under **Unreleased**)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

Community standards: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

---

## Project Status

| Milestone | Status |
|-----------|--------|
| Core orchestration loop | ✅ Complete |
| Convergence criteria | ✅ Complete |
| Stall detection | ✅ Complete |
| Human checkpoints | ✅ Complete |
| Token budgets | ✅ Complete |
| Documentation | ✅ Complete |
| Enterprise SDLC (V3) | ✅ Complete |
| Universal Project Identity (V3.1) | ✅ Complete |
| Qoder CLI support | ✅ Complete |
| Hybrid memory recall (JSON + FTS5) | ✅ Complete |
| Studio dashboard | ✅ Complete |
| Branch/worktree isolation | ✅ Complete |
| Durable skills | 🔜 Planned |
| MVP mode | 🔜 Planned |

---

## Part of P-Core

P-Core Orchestra is part of the **P-Core** project ecosystem:

- **pcore-orchestra** (this repo) — ambient multi-agent orchestration
- **pcore-cli** — unified CLI for P-Core tools (planned)

---

## Credits

- **Six-File Context Methodology** — JavaScript Mastery
- **Operator Loop Stack** — Jack Njoroge
- **Loop Engineering** — Kunal Ganglani, Addy Osmani, Peter Steinberger

---

## License

MIT — see [LICENSE](LICENSE)

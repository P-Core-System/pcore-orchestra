# P-Core Orchestra

> Ambient multi-agent orchestration for **Cursor IDE** and **OpenCode CLI**
> plan → implement → verify → review — automatically on build/fix/refactor prompts

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js 18+](https://img.shields.io/badge/Node.js-18+-339933.svg)](https://nodejs.org/)
[![Cursor IDE](https://img.shields.io/badge/Cursor-IDE-000000.svg)](https://cursor.com)
[![OpenCode](https://img.shields.io/badge/OpenCode-CLI-FF6B35.svg)](https://opencode.ai)

**Repository:** [github.com/peterlianpi/pcore-orchestra](https://github.com/peterlianpi/pcore-orchestra)

**Status:** Production-ready | **Version:** 1.0 | **Last updated:** July 2026

---

## Quick Start (2 minutes)

```bash
# 1. Clone and install (hooks + skills + CLI/permissions/OpenCode autonomy)
git clone https://github.com/peterlianpi/pcore-orchestra.git
cd pcore-orchestra
bash install.sh
# Windows: powershell -ExecutionPolicy Bypass -File install.ps1

# 2. Restart Cursor → Settings → Agents → Approvals → Auto-review
#    OpenCode: opencode --auto

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
| Node.js | 18+ | Hook scripts |
| Cursor IDE | Latest | Agent mode (for Cursor) |
| OpenCode CLI | Latest | Optional (for OpenCode) |
| Git | 2.x | Version control |
| Python 3 | Optional | Only for `ui-ux-pro-max` / design-system `search.py` scripts — not required for orchestra hooks |

Install also vendors UI skills (`ui-ux-pro-max`, `brand`, `design-system`, `ui-styling`) into `~/.cursor/skills` and links them under `~/.agents/skills`. See `THIRD_PARTY.md`.

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
| **4 Subagents** | `orchestra-planner`, `implementer`, `verifier`, `reviewer` |
| **Convergence Criteria** | Tests pass → diff empty → lint clean → judge passes |
| **Stall Detection** | Identical failures 2x → strategy change → 3rd → escalate |
| **Human Checkpoints** | Auth/payments/security/scope-creep require human review |
| **Token Budgets** | planner:10k, implementer:30k, verifier:15k, reviewer:8k |
| **6 Hooks** | Session, prompt, stop, heartbeat, lifecycle, subagent-stop |
| **Six-File Context** | Stable grounding across sessions (JavaScript Mastery methodology) |
| **Free Model Support** | OpenCode Zen free models + multi-key rotation |
| **Works With** | Cursor IDE, OpenCode CLI, any Node.js project |

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

### Cursor IDE (global)
```
~/.cursor/
├── hooks/                    # 6 event hooks
├── agents/                   # 4 subagent definitions
├── skills/orchestra-loop/    # orchestration skill
├── rules/orchestra-loop.mdc  # always-on rule
└── hooks.json                # event bindings
```

### OpenCode CLI
```
~/.config/opencode/
├── agents/                   # 4 subagent definitions
├── skills/orchestra-loop/    # orchestration skill
├── hooks/                    # health check
└── state/orchestra.json      # runtime state
```

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

## Commands

| Command | Effect |
|---------|--------|
| `no orchestra` | Skip for one prompt |
| `disable orchestra` | Turn ambient off |
| `enable orchestra` | Turn ambient on |
| `/orchestra stop` | Stop active loop |
| `/orchestra <goal>` | Force start with goal |
| `abort [reason]` | Save checkpoint and abort |

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

## Token Optimization

| Agent | Max Tokens | Model |
|-------|------------|-------|
| Planner | 10,000 | Budget (deepseek-v4-flash) |
| Implementer | 30,000 | Capable (kimi-k2.5, claude-sonnet-5) |
| Verifier | 15,000 | Budget |
| Reviewer | 8,000 | Budget |

**Total per cycle:** ~63k tokens max

```bash
# Auto-generate optimized config
bash scripts/setup-opencode-optimal.sh --balanced   # recommended
bash scripts/setup-opencode-optimal.sh --budget     # free models only
bash scripts/setup-opencode-optimal.sh --premium    # best quality
```

---

## Bypass Limits

### Cursor: BYOK
```bash
bash scripts/setup-cursor-byok.sh          # interactive guide
bash scripts/setup-cursor-byok.sh --litellm # GPT-5.5 proxy
```

### OpenCode: Free Models
```bash
bash scripts/setup-opencode-proxy.sh --free       # free Zen models
bash scripts/setup-opencode-proxy.sh --multi-key  # rotation guide
```

---

## Architecture: Operator Loop Stack

```
┌─────────────────────────────────────────────────────────┐
│  Harness (runtime)                                      │
│  ├── hooks (session, prompt, stop, heartbeat, lifecycle)│
│  ├── state (orchestra.json, memory.json)                │
│  └── error handling (stall detection, abort)            │
├─────────────────────────────────────────────────────────┤
│  Loop Contract                                         │
│  ├── Goal: what success looks like (testable)           │
│  ├── Scope: files in scope, what must NOT change        │
│  ├── Verifier: which tests/checks prove completion      │
│  ├── Budget: max iterations (8), tokens (63k), time     │
│  └── Escalation: when to pause for human                │
├─────────────────────────────────────────────────────────┤
│  State Layer                                           │
│  ├── Short-term: current run (phases, files, errors)    │
│  ├── Long-term: orchestra-memory.json (past goals)      │
│  └── History: orchestra-history.json (last 50 runs)     │
├─────────────────────────────────────────────────────────┤
│  Checker                                               │
│  ├── Convergence: tests pass > diff empty > lint clean  │
│  ├── Stall detection: identical failures → escalate     │
│  └── Human checkpoints: high-risk changes               │
├─────────────────────────────────────────────────────────┤
│  Human Checkpoint                                      │
│  ├── Auth/payments/security changes                     │
│  ├── Budget exhaustion                                  │
│  └── Unresolvable failures (3rd identical error)        │
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

---

## Uninstall

```bash
# Remove Cursor hooks
rm -rf ~/.cursor/hooks/orchestra-*
rm -rf ~/.cursor/agents/orchestra-*
rm -rf ~/.cursor/skills/orchestra-loop
rm -rf ~/.cursor/rules/orchestra-loop.mdc
rm -f ~/.cursor/hooks.json

# Remove OpenCode files
rm -rf ~/.config/opencode/agents/orchestra-*
rm -rf ~/.config/opencode/skills/orchestra-loop
rm -f ~/.config/opencode/hooks/orchestra-health-opencode.js

# Remove symlink
rm -rf ~/.agents/skills/orchestra-loop
```

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

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
| Durable skills | 🔜 Planned |
| Branch isolation | 🔜 Planned |
| MVP mode | 🔜 Planned |

---

## Part of P-Core

P-Core Orchestra is part of the **P-Core** project ecosystem:

- **pcore-orchestra** (this repo) — ambient multi-agent orchestration
- **pcore-trader** — crypto trading bot with AI agents
- **pcore-cli** — unified CLI for P-Core tools (planned)

---

## Credits

- **Six-File Context Methodology** — JavaScript Mastery
- **Operator Loop Stack** — Jack Njoroge
- **Loop Engineering** — Kunal Ganglani, Addy Osmani, Peter Steinberger

---

## License

MIT — see [LICENSE](LICENSE)

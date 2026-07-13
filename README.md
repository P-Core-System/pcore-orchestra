# Cursor Orchestra

Ambient multi-agent orchestration for **Cursor IDE** and **OpenCode CLI**: plan → implement → verify → review — automatically on build/fix/refactor prompts. Integrates the **Six-File Context Methodology** so projects with a `context/` folder give agents stable grounding across sessions.

**Repository:** [github.com/peterlianpi/cursor-orchestra](https://github.com/peterlianpi/cursor-orchestra)

## What you get

| Component | Purpose |
|-----------|---------|
| **4 subagents** | `orchestra-planner`, `implementer`, `verifier`, `reviewer` |
| **Convergence criteria** | Tests pass → diff empty → lint clean → judge passes |
| **Stall detection** | Identical failures 2x → strategy change → 3rd → escalate |
| **Human checkpoints** | Auth/payments/security/scope-creep require human review |
| **Token budgets** | planner:10k, implementer:30k, verifier:15k, reviewer:8k (63k max/cycle) |
| **6 hooks** | Session start, prompt, subagent stop, stop, heartbeat, lifecycle |
| **Six-file bootstrap** | `scripts/init-context.sh` — templates → `context/` + `AGENTS.md` |
| **Skill + rule** | Agent instructions for ambient mode |
| **CLI** | `orchestra-enable.js` — start/stop/status/ambient on/off |

## Where it's set up

### Cursor IDE (global install)
```
~/.cursor/
├── hooks/                    # hook scripts
│   ├── orchestra-*.js        # 6 event hooks
│   ├── state/orchestra.json  # runtime state
│   └── state/orchestra-memory.json  # long-term memory
├── agents/                   # subagent definitions
│   ├── orchestra-planner.md
│   ├── orchestra-implementer.md
│   ├── orchestra-verifier.md
│   └── orchestra-reviewer.md
├── skills/orchestra-loop/    # orchestration skill
├── rules/orchestra-loop.mdc  # always-on rule
└── hooks.json                # event bindings
```

### OpenCode CLI
```
~/.config/opencode/
├── agents/                   # subagent definitions (same agents)
├── skills/orchestra-loop/    # orchestration skill
├── hooks/orchestra-health-opencode.js  # health check
└── state/orchestra.json      # runtime state
```

### Per-project (with context/)
```
your-project/
├── AGENTS.md                 # entry point — tells agents what to read
├── context/
│   ├── project-overview.md   # product definition, goals, features
│   ├── architecture.md       # system structure, boundaries, invariants
│   ├── code-standards.md     # conventions, patterns, quality rules
│   ├── ui-context.md         # UI/design guidelines (N/A for CLI)
│   ├── ai-workflow-rules.md  # scoping, doc sync, verification
│   └── progress-tracker.md   # current phase, completed work, next steps
└── .cursor/                  # project bridge (optional)
    └── hooks.json            # delegates to global hooks
```

## Where it's used

### Automatic triggers
Orchestra auto-runs when you prompt with these verbs:
- `add`, `fix`, `build`, `create`, `refactor`, `deploy`, `install`, `setup`, `configure`, `migrate`, `integrate`, `debug`, `continue`, `ship`

### Manual commands
| Command | Effect |
|---------|--------|
| `no orchestra` | Skip for one prompt |
| `disable orchestra` | Turn ambient off |
| `enable orchestra` | Turn ambient on |
| `/orchestra stop` | Stop active loop |
| `/orchestra <goal>` | Force start with specific goal |
| `abort [reason]` | Save checkpoint and abort |

### Projects using it
- **cursor-orchestra** (this repo) — dogfooding with full context/
- **crypto-trader** — production trading bot with project bridge

## Quick start

```bash
git clone https://github.com/peterlianpi/cursor-orchestra.git
cd cursor-orchestra
bash install.sh
```

**Windows:**

```powershell
git clone https://github.com/peterlianpi/cursor-orchestra.git
cd cursor-orchestra
powershell -ExecutionPolicy Bypass -File install.ps1
```

Restart Cursor → **Settings → Hooks** → verify orchestra hooks.

## Six-File Context in your project

Bootstrap blank context files (from JavaScript Mastery methodology templates):

```bash
bash /path/to/cursor-orchestra/scripts/init-context.sh /path/to/your-app
bash /path/to/cursor-orchestra/scripts/init-context.sh /path/to/your-app --bridge
```

This creates:

```
your-app/
  AGENTS.md              # entry point — tells agents what to read
  context/
    project-overview.md
    architecture.md
    code-standards.md
    ui-context.md
    ai-workflow-rules.md
    progress-tracker.md
```

When `context/` exists, orchestra hooks inject the read order at session start and when orchestra activates. Subagents read these files before planning and implementing.

Fill templates using the AI prompts in the Six-File Context Methodology guide, or copy from a project like [crypto-trader](https://github.com/peterlianpi/crypto-trader) that already uses this pattern.

## Architecture: Operator Loop Stack

Cursor Orchestra follows the Operator Loop Stack pattern (Jack Njoroge, 2026):

```
┌─────────────────────────────────────────────────────────┐
│  Harness (runtime)                                      │
│  ├── hooks (session, prompt, stop, heartbeat, lifecycle)│
│  ├── state (orchestra.json, memory.json)                │
│  └── error handling (stall detection, abort)            │
├─────────────────────────────────────────────────────────┤
│  Loop Contract (define before starting)                 │
│  ├── Goal: what success looks like (testable)           │
│  ├── Scope: files in scope, what must NOT change        │
│  ├── Verifier: which tests/checks prove completion      │
│  ├── Budget: max iterations (8), tokens (63k), time     │
│  └── Escalation: when to pause for human                │
├─────────────────────────────────────────────────────────┤
│  State Layer (persistence)                              │
│  ├── Short-term: current run (phases, files, errors)    │
│  ├── Long-term: orchestra-memory.json (past goals)      │
│  └── History: orchestra-history.json (last 50 runs)     │
├─────────────────────────────────────────────────────────┤
│  Checker (verification)                                 │
│  ├── Convergence: tests pass > diff empty > lint clean  │
│  ├── Stall detection: identical failures → escalate     │
│  └── Human checkpoints: high-risk changes               │
├─────────────────────────────────────────────────────────┤
│  Human Checkpoint ( judgment gate)                      │
│  ├── Auth/payments/security changes                     │
│  ├── Budget exhaustion                                  │
│  └── Unresolvable failures (3rd identical error)        │
└─────────────────────────────────────────────────────────┘
```

## Convergence criteria

The loop exits when ANY of these are true:

| Signal | Strength | Description |
|--------|----------|-------------|
| Tests pass | Strongest | All relevant tests pass |
| Diff empty | Strong | No changes in last iteration (fixed-point) |
| Lint clean | Medium | Zero lint errors |
| Judge passes | Weakest | Reviewer approves (use last) |

**If verifier fails with identical feedback 2x → try different strategy → 3rd → abort to human.**

## Token optimization

| Agent | Max tokens | Max output | Model |
|-------|------------|------------|-------|
| Planner | 10,000 | 50 lines | Budget (deepseek-v4-flash) |
| Implementer | 30,000 | 100 lines | Capable (kimi-k2.5, claude-sonnet-5) |
| Verifier | 15,000 | 30 lines | Budget |
| Reviewer | 8,000 | 30 lines | Budget |

**Total per cycle:** ~63k tokens max (vs unlimited before)

```bash
bash scripts/setup-opencode-optimal.sh --balanced  # recommended
bash scripts/setup-opencode-optimal.sh --budget    # free models only
bash scripts/setup-opencode-optimal.sh --premium   # best quality
```

## Bypass Limits

Orchestra runs multiple subagents per cycle, which burns through API quotas fast. Two strategies to keep orchestration free or uncapped:

### Cursor: BYOK (Bring Your Own Key)

Cursor supports custom API keys — requests bypass the monthly fast-request counter entirely.

```bash
bash scripts/setup-cursor-byok.sh          # interactive guide
bash scripts/setup-cursor-byok.sh --litellm # GPT-5.5 proxy (blocked models)
```

Setup: Cursor → Settings → Models → paste key → Override Base URL → Verify. See `docs/bypass-strategies.md` for providers and cost comparison.

### OpenCode: Free Zen Models + Multi-Key Rotation

Use free models for orchestration, or pool multiple keys to bypass rate limits.

```bash
bash scripts/setup-opencode-proxy.sh --free       # free Zen models
bash scripts/setup-opencode-proxy.sh --multi-key  # rotation guide
```

Best free models for orchestration: `north-mini-code-free`, `minimax-m2.5-free`. For production: OpenCode Go ($10/mo) with `opencode-go-multi-auth` rotation.

See `docs/bypass-strategies.md` for full details.

## Documentation

| Doc | Purpose |
|-----|---------|
| `docs/audit-smart-swot.md` | SMART & SWOT analysis with gap recommendations |
| `docs/orchestration-patterns.md` | Patterns used (Prompt Chaining + ReAct) and rationale |
| `docs/bypass-strategies.md` | Cursor BYOK + OpenCode free model bypass reference |
| `docs/token-optimization.md` | Token efficiency guide (compaction, model routing, budgets) |
| `context/harness-scaffold-loop.md` | Three-layer architecture (Harness > Scaffold > Loop) |

## Credits

- **Six-File Context Methodology** — JavaScript Mastery (templates in `templates/context/`)
- **Operator Loop Stack** — Jack Njoroge (harness, contract, state, checker, checkpoint)
- **Loop Engineering** — Kunal Ganglani, Addy Osmani, Peter Steinberger
- Originally developed alongside [crypto-trader](https://github.com/peterlianpi/crypto-trader); now standalone

## License

MIT — see [LICENSE](LICENSE)

# Orchestra

Ambient multi-agent orchestration for **Cursor IDE** and **OpenCode CLI**: plan → implement → verify → review — automatically on build/fix/refactor prompts. Integrates the **Six-File Context Methodology** so projects with a `context/` folder give agents stable grounding across sessions.

**Repository:** [github.com/peterlianpi/cursor-orchestra](https://github.com/peterlianpi/cursor-orchestra)

## What you get

| Component | Purpose |
|-----------|---------|
| **4 subagents** | `orchestra-planner`, `implementer`, `verifier`, `reviewer` |
| **Cursor hooks** | Auto-start on prompts, chain phases, inject six-file context |
| **OpenCode skill** | Skill-driven orchestration for CLI agent |
| **Six-file bootstrap** | `scripts/init-context.sh` — templates → `context/` + `AGENTS.md` |
| **CLI** | `orchestra-enable.js` — start/stop/status/ambient on/off |
| **Shared state** | Both tools share `~/.config/opencode/state/orchestra.json` |

## Requirements

- **Cursor IDE** (Agent mode) and/or **OpenCode CLI**
- **Node.js 18+** (hook scripts)

## Quick start

```bash
git clone https://github.com/peterlianpi/cursor-orchestra.git
cd cursor-orchestra
bash install.sh              # installs both Cursor + OpenCode
```

**Install options:**

```bash
bash install.sh --all        # both (default)
bash install.sh --cursor     # Cursor only
bash install.sh --opencode   # OpenCode only
bash install.sh --project    # + project bridge in cwd
```

**Windows:**

```powershell
git clone https://github.com/peterlianpi/cursor-orchestra.git
cd cursor-orchestra
powershell -ExecutionPolicy Bypass -File install.ps1
```

Restart Cursor → **Settings → Hooks** → verify orchestra hooks.
Restart OpenCode → agents and skill auto-loaded.

## How it works

### Cursor IDE (hooks-driven)

```
User: "fix the login bug"
  → beforeSubmitPrompt hook auto-classifies
  → orchestra-planner → implementer → verifier → reviewer
  → hooks chain each phase on subagentStop
```

### OpenCode CLI (skill-driven)

```
User: "fix the login bug"
  → orchestra-loop skill classifies as implement prompt
  → Main agent launches orchestra-planner (Task)
  → Chains: implementer → verifier → reviewer
  → FIX_REQUIRED loops back (max 8 iterations)
```

### Both tools share

- Same 4 agent definitions (Cursor format + OpenCode format)
- Same state file (`~/.config/opencode/state/orchestra.json`)
- Same six-file context integration

## Architecture: Harness > Scaffold > Loop

Cursor Orchestra implements a three-layer agent architecture:

- **Loop:** The execution cycle (plan → implement → verify → review)
- **Scaffold:** Behavior definition (agent prompts, context injection)
- **Harness:** Runtime execution (hooks, state management, error handling)

See `context/harness-scaffold-loop.md` for full details.

## What triggers auto-orchestration

**Yes:** add, fix, build, create, refactor, deploy, install, setup, configure, migrate, integrate, debug, continue, write tests, ship…

**No:** explain, what is, how does, summarize, hi/thanks, "no orchestra", "just explain"

## User commands

| Command | Effect |
|---------|--------|
| *(just code normally)* | Orchestra when appropriate |
| `no orchestra` | Skip for one prompt |
| `disable orchestra` | Turn ambient off |
| `enable orchestra` | Turn ambient on |
| `/orchestra stop` | Stop active loop (Cursor) |
| `/orchestra <goal>` | Force start |

### CLI (Cursor)

```bash
node ~/.cursor/hooks/orchestra-enable.js status
node ~/.cursor/hooks/orchestra-enable.js ambient-off
node ~/.cursor/hooks/orchestra-enable.js ambient-on
node ~/.cursor/hooks/orchestra-enable.js stop
```

### Health check

```bash
# Cursor
node ~/.cursor/hooks/orchestra-health.js

# OpenCode
node ~/.config/opencode/hooks/orchestra-health-opencode.js
```

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

## Project bridge (per-repo)

Copy `project-bridge/` into your repo's `.cursor/`, or use `init-context.sh --bridge`. The bridge delegates to global `~/.cursor/hooks/` scripts (needed for cloud agents in some setups).

## Repo layout

```
cursor-orchestra/
├── AGENTS.md                      # this repo's entry point
├── context/                       # filled six files (dogfooding)
├── bundle/
│   ├── agents/                    # Cursor orchestra subagents
│   ├── hooks/                     # Cursor hook scripts
│   ├── skills/orchestra-loop/     # Cursor skill
│   ├── rules/orchestra-loop.mdc  # Cursor rule
│   ├── opencode/                  # OpenCode agents, skill, state
│   └── ORCHESTRA.md               # Global docs
├── templates/context/             # blank templates for init-context
├── project-bridge/
├── scripts/init-context.*
├── install.sh / install.ps1
└── README.md
```

## Credits

- **Six-File Context Methodology** — JavaScript Mastery (templates in `templates/context/`)
- Originally developed alongside [crypto-trader](https://github.com/peterlianpi/crypto-trader); now standalone

## License

MIT — see [LICENSE](LICENSE)

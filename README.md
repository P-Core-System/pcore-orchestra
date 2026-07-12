# Cursor Orchestra

Ambient multi-agent orchestration for **Cursor IDE**: plan → implement → verify → review — automatically on build/fix/refactor prompts. Integrates the **Six-File Context Methodology** so projects with a `context/` folder give agents stable grounding across sessions.

**Repository:** [github.com/peterlianpi/cursor-orchestra](https://github.com/peterlianpi/cursor-orchestra)

## What you get

| Component | Purpose |
|-----------|---------|
| **4 subagents** | `orchestra-planner`, `implementer`, `verifier`, `reviewer` |
| **4 hooks** | Auto-start on prompts, chain phases, inject six-file context |
| **Six-file bootstrap** | `scripts/init-context.sh` — templates → `context/` + `AGENTS.md` |
| **Skill + rule** | Agent instructions for ambient mode |
| **CLI** | `orchestra-enable.js` — start/stop/status/ambient on/off |

## Requirements

- [Cursor IDE](https://cursor.com) (Agent mode)
- **Node.js 18+** (hook scripts)

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

## Usage (no special commands)

```
fix the login bug
add install script
deploy to VPS
```

Orchestra auto-runs: planner → implementer → verifier → reviewer.

| Command | Effect |
|---------|--------|
| `no orchestra` | Skip for one prompt |
| `disable orchestra` | Turn ambient off |
| `enable orchestra` | Turn ambient on |
| `/orchestra stop` | Stop active loop |

```bash
node ~/.cursor/hooks/orchestra-enable.js status
```

## Install options

```bash
bash install.sh              # global ~/.cursor/
bash install.sh --project    # + project bridge in cwd
```

```powershell
powershell -File install.ps1 -Project
```

## Project bridge (per-repo)

Copy `project-bridge/` into your repo's `.cursor/`, or use `init-context.sh --bridge`. The bridge delegates to global `~/.cursor/hooks/` scripts (needed for cloud agents in some setups).

## Repo layout

```
cursor-orchestra/
├── AGENTS.md                 # this repo's entry point
├── context/                  # filled six files (dogfooding)
├── templates/context/        # blank templates for init-context
├── bundle/                   # → ~/.cursor/ on install
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

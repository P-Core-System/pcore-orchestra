---
name: setup
description: >-
  Setup pcore-agents on a new machine or configure it for a new project.
  Use when: setting up orchestra, installing on new machine, adding to project,
  configuring context files, or troubleshooting setup issues.
---

# P-Core Agents Setup Skill

Setup pcore-agents globally on any machine and configure it for any project.

## When invoked

1. Determine setup type (new machine, new project, or troubleshoot)
2. Run appropriate setup commands
3. Verify installation with health check
4. Configure project-specific settings

---

## New Machine Setup

### Quick setup (recommended)

```bash
# Clone and install globally
git clone https://github.com/peterlianpi/pcore-agents.git /tmp/pcore-agents
cd /tmp/pcore-agents
bash install.sh

# Clean up
rm -rf /tmp/pcore-agents
```

### Full setup with OpenCode

```bash
# Clone
git clone https://github.com/peterlianpi/pcore-agents.git /tmp/pcore-agents
cd /tmp/pcore-agents

# Install for both Cursor and OpenCode
bash install.sh --all

# Or install for OpenCode only
bash install.sh --opencode

# Verify
node ~/.cursor/hooks/orchestra-health.js
node ~/.config/opencode/hooks/orchestra-health-opencode.js
```

### Windows setup

```powershell
# Clone
git clone https://github.com/peterlianpi/pcore-agents.git C:\temp\pcore-agents
cd C:\temp\pcore-agents

# Install
powershell -ExecutionPolicy Bypass -File install.ps1

# Clean up
Remove-Item -Recurse C:\temp\pcore-agents
```

---

## New Project Setup

### Method 1: Bootstrap context files

```bash
# From anywhere (if orchestra is installed globally)
bash ~/.cursor/scripts/init-context.sh /path/to/your-project

# With project bridge (for cloud agents)
bash ~/.cursor/scripts/init-context.sh /path/to/your-project --bridge
```

This creates:
```
your-project/
├── AGENTS.md              # entry point for agents
└── context/
    ├── project-overview.md
    ├── architecture.md
    ├── code-standards.md
    ├── ui-context.md
    ├── ai-workflow-rules.md
    └── progress-tracker.md
```

### Method 2: Copy from existing project

```bash
# Copy context files from an existing project
cp -r /path/to/existing-project/context/ /path/to/new-project/context/
cp /path/to/existing-project/AGENTS.md /path/to/new-project/AGENTS.md
```

### Method 3: Use templates

```bash
# Templates are in the repo
cp -r /tmp/pcore-agents/templates/context/ /path/to/new-project/context/
cp /tmp/pcore-agents/templates/AGENTS.md /path/to/new-project/AGENTS.md
```

---

## Global Configuration

### Where files are installed

```
~/.cursor/                          # Cursor (global)
├── hooks/orchestra-*.js            # Event hooks
├── hooks/state/orchestra.json      # Runtime state
├── hooks/state/orchestra-memory.json  # Long-term memory
├── agents/orchestra-*.md           # Subagent definitions
├── skills/orchestra-loop/SKILL.md  # Orchestration skill
├── rules/orchestra-loop.mdc        # Always-on rule
├── scripts/init-context.sh         # Project bootstrap
└── hooks.json                      # Event bindings

~/.config/opencode/                 # OpenCode (global)
├── agents/orchestra-*.md           # Subagent definitions
├── skills/orchestra-loop/SKILL.md  # Orchestration skill
├── hooks/orchestra-health-opencode.js  # Health check
├── state/orchestra.json            # Runtime state
└── opencode.json                   # Configuration

~/.agents/skills/orchestra-loop/    # External discovery (symlink)
└── SKILL.md                        # Points to OpenCode skill
```

### Verify installation

```bash
# Check Cursor hooks
ls ~/.cursor/hooks/orchestra-*.js

# Check Cursor agents
ls ~/.cursor/agents/orchestra-*.md

# Check OpenCode agents
ls ~/.config/opencode/agents/orchestra-*.md

# Run health checks
node ~/.cursor/hooks/orchestra-health.js
node ~/.config/opencode/hooks/orchestra-health-opencode.js
```

---

## Project Configuration

### Fill context files

After bootstrapping, fill the context files with your project details:

1. **project-overview.md** — product definition, goals, features, scope
2. **architecture.md** — system structure, boundaries, storage, invariants
3. **code-standards.md** — Node hook scripts, agent markdown, install conventions
4. **ui-context.md** — N/A for CLI-only projects
5. **ai-workflow-rules.md** — scoping, doc sync, verification
6. **progress-tracker.md** — current phase, completed work, next steps

### Add to AGENTS.md

Add this to your project's `AGENTS.md`:

```markdown
# Agent Notes

## Cursor Orchestra

This project uses Cursor Orchestra for ambient multi-agent orchestration.

### Context files (read in order)
0. `context/harness-scaffold-loop.md` — agent architecture hierarchy
1. `context/project-overview.md` — product definition
2. `context/architecture.md` — system structure
3. `context/code-standards.md` — conventions
4. `context/ui-context.md` — UI guidelines (if applicable)
5. `context/ai-workflow-rules.md` — verification rules
6. `context/progress-tracker.md` — current state

### Commands
- `no orchestra` — skip for one prompt
- `disable orchestra` — turn ambient off
- `/orchestra stop` — stop active loop
```

---

## Reusable Across Projects

Once installed globally, orchestra works for any project:

1. **Install once** on your machine
2. **Bootstrap context** for each project (one command)
3. **Fill templates** with project-specific details
4. **Use normally** — orchestra auto-runs on build/fix/refactor prompts

### Per-project customization

Each project can customize:
- Which agents are enabled (in `hooks.json`)
- Model routing (in `opencode.json` per project)
- Token budgets (in agent frontmatter)
- Convergence criteria (in verifier config)

### Share with team

```bash
# Add context files to git
git add context/ AGENTS.md
git commit -m "chore: add orchestra context files"
git push

# Team members clone and get orchestra automatically
git clone <repo>
# Context files are already there
```

---

## Troubleshooting

### Health check fails

```bash
# Reinstall
cd /path/to/cursor-orchestra
bash install.sh

# Check hooks.json
cat ~/.cursor/hooks.json
```

### Agents not found

```bash
# Verify agent files exist
ls ~/.cursor/agents/orchestra-*.md
ls ~/.config/opencode/agents/orchestra-*.md

# Reinstall if missing
bash install.sh
```

### Context not injected

```bash
# Check context files exist
ls /path/to/your-project/context/

# Bootstrap if missing
bash ~/.cursor/scripts/init-context.sh /path/to/your-project
```

### OpenCode skill not found

```bash
# Check skill exists
ls ~/.config/opencode/skills/orchestra-loop/SKILL.md

# Check symlink
ls -la ~/.agents/skills/orchestra-loop

# Reinstall if missing
bash install.sh --opencode
```

---

## Quick Reference

| Command | Purpose |
|---------|---------|
| `bash install.sh` | Install globally (Cursor) |
| `bash install.sh --all` | Install both Cursor + OpenCode |
| `bash install.sh --opencode` | Install OpenCode only |
| `bash install.sh --project` | + project bridge in cwd |
| `bash init-context.sh <dir>` | Bootstrap context files |
| `node ~/.cursor/hooks/orchestra-health.js` | Health check (Cursor) |
| `node ~/.config/opencode/hooks/orchestra-health-opencode.js` | Health check (OpenCode) |

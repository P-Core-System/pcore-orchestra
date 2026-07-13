---
title: Setup Guide
description: Complete guide to setup cursor-orchestra on any machine and configure it for any project — global installation, project bootstrap, and reusable workflows.
last_updated: 2026-07-13
tags: [setup, installation, configuration, new-project, new-machine]
related: [bypass-strategies.md, token-optimization.md]
---

# Setup Guide

Complete guide to setup cursor-orchestra on any machine and configure it for any project.

> **TL;DR:** Install globally once (`bash install.sh`), bootstrap context for each project (`bash init-context.sh <dir>`), use normally.

---

## Table of Contents

- [Quick Start](#quick-start)
- [New Machine Setup](#new-machine-setup)
- [New Project Setup](#new-project-setup)
- [Global Configuration](#global-configuration)
- [Project Configuration](#project-configuration)
- [Reusable Across Projects](#reusable-across-projects)
- [Team Setup](#team-setup)
- [Troubleshooting](#troubleshooting)

---

## Quick Start {#quick-start}

### On a new machine

```bash
# One command installs everything
git clone https://github.com/peterlianpi/cursor-orchestra.git /tmp/orchestra
cd /tmp/orchestra && bash install.sh && cd - && rm -rf /tmp/orchestra

# Verify
node ~/.cursor/hooks/orchestra-health.js
```

### On a new project

```bash
# One command bootstraps context
bash ~/.cursor/scripts/init-context.sh /path/to/your-project

# Fill the 6 context files with your project details
# Then use normally — orchestra auto-runs on build/fix/refactor prompts
```

---

## New Machine Setup {#new-machine-setup}

### Option A: Quick install (Cursor only)

```bash
git clone https://github.com/peterlianpi/cursor-orchestra.git /tmp/cursor-orchestra
cd /tmp/cursor-orchestra
bash install.sh
rm -rf /tmp/cursor-orchestra
```

### Option B: Full install (Cursor + OpenCode)

```bash
git clone https://github.com/peterlianpi/cursor-orchestra.git /tmp/cursor-orchestra
cd /tmp/cursor-orchestra
bash install.sh --all
rm -rf /tmp/cursor-orchestra
```

### Option C: With project bridge

```bash
git clone https://github.com/peterlianpi/cursor-orchestra.git /tmp/cursor-orchestra
cd /tmp/cursor-orchestra
bash install.sh --project
rm -rf /tmp/cursor-orchestra
```

### Option D: Windows

```powershell
git clone https://github.com/peterlianpi/cursor-orchestra.git C:\temp\cursor-orchestra
cd C:\temp\cursor-orchestra
powershell -ExecutionPolicy Bypass -File install.ps1
Remove-Item -Recurse C:\temp\cursor-orchestra
```

### Verify installation

```bash
# Check files exist
ls ~/.cursor/hooks/orchestra-*.js
ls ~/.cursor/agents/orchestra-*.md
ls ~/.config/opencode/agents/orchestra-*.md

# Run health checks
node ~/.cursor/hooks/orchestra-health.js
node ~/.config/opencode/hooks/orchestra-health-opencode.js
```

---

## New Project Setup {#new-project-setup}

### Method 1: Bootstrap (recommended)

```bash
# From anywhere (orchestra is global)
bash ~/.cursor/scripts/init-context.sh /path/to/your-project

# With project bridge (for cloud agents)
bash ~/.cursor/scripts/init-context.sh /path/to/your-project --bridge
```

Creates:
```
your-project/
├── AGENTS.md              # entry point for agents
└── context/
    ├── project-overview.md   # product definition, goals, features
    ├── architecture.md       # system structure, boundaries
    ├── code-standards.md     # conventions, patterns
    ├── ui-context.md         # UI guidelines (N/A for CLI)
    ├── ai-workflow-rules.md  # verification rules
    └── progress-tracker.md   # current state
```

### Method 2: Copy from existing project

```bash
cp -r /path/to/existing-project/context/ /path/to/new-project/context/
cp /path/to/existing-project/AGENTS.md /path/to/new-project/AGENTS.md
```

### Method 3: Manual setup

```bash
mkdir -p /path/to/your-project/context

# Create AGENTS.md
cat > /path/to/your-project/AGENTS.md << 'EOF'
# Agent Notes

## Context files (read in order)
1. `context/project-overview.md` — product definition
2. `context/architecture.md` — system structure
3. `context/code-standards.md` — conventions
4. `context/ui-context.md` — UI guidelines
5. `context/ai-workflow-rules.md` — verification rules
6. `context/progress-tracker.md` — current state
EOF

# Create context files (copy from templates or existing project)
```

---

## Global Configuration {#global-configuration}

### File locations

```
~/.cursor/                          # Cursor (global)
├── hooks/orchestra-*.js            # Event hooks (6 files)
├── hooks/state/orchestra.json      # Runtime state
├── hooks/state/orchestra-memory.json  # Long-term memory
├── agents/orchestra-*.md           # Subagent definitions (4 files)
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

### Configuration files

#### Cursor: hooks.json

```json
{
  "sessionCreated": ["orchestra-session-start.js"],
  "userPrompted": ["orchestra-prompt.js"],
  "subagentStopped": ["orchestra-subagent-stop.js"],
  "sessionStopped": ["orchestra-stop.js"]
}
```

#### OpenCode: opencode.json

```json
{
  "compaction": {
    "auto": true,
    "prune": true,
    "reserved": 8000
  },
  "agent": {
    "orchestra-planner": {
      "model": "opencode/deepseek-v4-flash",
      "steps": 8,
      "permission": { "edit": "deny", "bash": "ask" }
    },
    "orchestra-implementer": {
      "model": "opencode/kimi-k2.5",
      "steps": 25
    },
    "orchestra-verifier": {
      "model": "opencode/deepseek-v4-flash",
      "steps": 10,
      "permission": { "edit": "deny", "bash": "allow" }
    },
    "orchestra-reviewer": {
      "model": "opencode/deepseek-v4-flash",
      "steps": 5,
      "permission": { "edit": "deny", "bash": "ask" }
    }
  }
}
```

---

## Project Configuration {#project-configuration}

### Fill context files

After bootstrapping, fill the 6 context files:

#### 1. project-overview.md

```markdown
# Project Overview

## Product
[What is this product?]

## Goals
- [Goal 1]
- [Goal 2]

## Features
- [Feature 1]
- [Feature 2]

## Scope
- In scope: [list]
- Out of scope: [list]
```

#### 2. architecture.md

```markdown
# Architecture

## System structure
[Description]

## Boundaries
[What's allowed, what's not]

## Storage
[Database, files, cache]

## Invariants
[Things that must always be true]
```

#### 3. code-standards.md

```markdown
# Code Standards

## Language
[Language and version]

## Conventions
[Naming, formatting, patterns]

## Testing
[Test framework, coverage requirements]

## Quality
[Linting, type checking, security]
```

#### 4. ui-context.md (if applicable)

```markdown
# UI Context

## Framework
[React, Vue, etc.]

## Styling
[Tailwind, CSS, etc.]

## Components
[Component library]

## Design
[Design system, tokens]
```

#### 5. ai-workflow-rules.md

```markdown
# AI Workflow Rules

## Scoping
- Only modify files in the current task scope
- Do not touch files outside the task without explicit instruction

## Verification
- Run tests after every change
- Run linter before committing
- Check git status before finalizing

## Documentation
- Update progress-tracker.md after completing work
- Update architecture.md if structure changes
```

#### 6. progress-tracker.md

```markdown
# Progress Tracker

## Current Phase
[What phase are we in?]

## Completed
- [ ] [Task 1]
- [ ] [Task 2]

## Next Up
- [ ] [Task 3]
- [ ] [Task 4]

## Blockers
- [Any blockers]
```

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

## Reusable Across Projects {#reusable-across-projects}

Once installed globally, orchestra works for any project:

### Workflow

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

### Project-specific opencode.json

Create `.opencode/opencode.json` in your project root:

```json
{
  "agent": {
    "orchestra-implementer": {
      "model": "opencode/claude-sonnet-5"
    }
  }
}
```

This overrides the global config for this project only.

---

## Team Setup {#team-setup}

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

### Team installation script

Create `scripts/setup-orchestra.sh` in your project:

```bash
#!/bin/bash
set -euo pipefail

echo "Setting up Cursor Orchestra..."

# Check if orchestra is installed globally
if [ ! -f ~/.cursor/hooks/orchestra-session-start.js ]; then
    echo "Orchestra not found. Installing..."
    git clone https://github.com/peterlianpi/cursor-orchestra.git /tmp/cursor-orchestra
    cd /tmp/cursor-orchestra
    bash install.sh
    cd -
    rm -rf /tmp/cursor-orchestra
fi

# Check if context files exist
if [ ! -f AGENTS.md ]; then
    echo "Bootstrapping context files..."
    bash ~/.cursor/scripts/init-context.sh .
fi

echo "Setup complete!"
echo "Fill context/ files with your project details."
echo "Then use normally — orchestra auto-runs on build/fix/refactor prompts."
```

### Onboarding checklist

Add to your project's `README.md`:

```markdown
## Development Setup

### Cursor Orchestra (ambient AI agent)

1. Install orchestra: `bash scripts/setup-orchestra.sh`
2. Fill `context/` files with project details
3. Restart Cursor
4. Use normally: "fix the login bug", "add install script", etc.

### Commands
- `no orchestra` — skip for one prompt
- `disable orchestra` — turn ambient off
- `/orchestra stop` — stop active loop
```

---

## Troubleshooting {#troubleshooting}

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

### Orchestra not triggering

1. Check `hooks.json` is correct
2. Restart Cursor/OpenCode
3. Check context files exist
4. Run health check

---

## Quick Reference {#quick-reference}

| Command | Purpose |
|---------|---------|
| `bash install.sh` | Install globally (Cursor) |
| `bash install.sh --all` | Install both Cursor + OpenCode |
| `bash install.sh --opencode` | Install OpenCode only |
| `bash install.sh --project` | + project bridge in cwd |
| `bash init-context.sh <dir>` | Bootstrap context files |
| `node ~/.cursor/hooks/orchestra-health.js` | Health check (Cursor) |
| `node ~/.config/opencode/hooks/orchestra-health-opencode.js` | Health check (OpenCode) |

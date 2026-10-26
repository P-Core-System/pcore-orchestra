---
name: orchestra-install
description: >-
  Install, set up, repair, or upgrade P-Core Orchestra on a machine or repo.
  Covers Cursor, OpenCode, Qoder, Claude Code, and Codex: installer flags,
  dry runs, health checks, drift regeneration, project context setup, and
  troubleshooting hooks that do not fire. Use when the user says install /
  setup / configure / repair / upgrade orchestra, or moves to a new machine.
---

# Orchestra Install & Setup

Install the same four-phase loop (plan → implement → verify → review) for any
supported host. Work from the repository root; run `--dry-run` before changing a
machine, and verify with the host health check afterward.

## Supported hosts

| Host | Flag | Config home | Spawn contract |
|------|------|-------------|----------------|
| Cursor | `--cursor` | `~/.cursor` (`CURSOR_HOME`) | `Task` + `subagent_type` |
| OpenCode | `--opencode` | `~/.config/opencode` (`OPENCODE_CONFIG_DIR`) | `subagent` + `agent` + `description` |
| Qoder CLI | `--qoder` | `~/.qoder` (`QODER_CONFIG_DIR`) | `Agent` + `subagent_type` |
| Claude Code | `--claude` | `~/.claude` (`CLAUDE_CONFIG_DIR`) | `Agent` (`Task` alias) + `subagent_type` |
| Codex CLI | `--codex` | `~/.codex` (`CODEX_HOME`) | `spawn_agent` + `agent_type` |

`bash install.sh` with no flags installs all five. Codex hooks are intentionally
not wired (`features.hooks` is gated); the conductor drives phases with
completion markers.

## 1. Preflight

```bash
node --version            # 18+ required (22.5+ for SQLite hybrid recall)
git --version
bash install.sh --help    # flags and host notes
bash install.sh --dry-run # list what would be touched, change nothing
```

- Do not install over uncommitted user settings without a backup: the settings
  mergers write `settings.json.bak-<timestamp>` automatically.
- Never commit `.env`, tokens, or host-specific secrets from an install session.
- Existing user-authored agents in `~/.claude/agents` and `~/.codex/agents` are
  never deleted by the installer.

## 2. Install

```bash
# All hosts (default)
bash install.sh

# One host at a time
bash install.sh --cursor
bash install.sh --opencode --skip-opencode-upgrade
bash install.sh --qoder
bash install.sh --claude
bash install.sh --codex

# Cursor + Claude, plus project bridge and Studio
bash install.sh --cursor --claude --project --studio
```

Windows (PowerShell):

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1 -All
powershell -ExecutionPolicy Bypass -File install.ps1 -Claude
powershell -ExecutionPolicy Bypass -File install.ps1 -Codex
```

The installer regenerates derived agent mirrors before copying (`scripts/sync-*.js`
`--check`), so a fresh clone never installs stale agents.

## 3. Verify

```bash
# Host health
node scripts/health-claude.js --home ~/.claude
node scripts/health-codex.js  --home ~/.codex
node ~/.cursor/hooks/orchestra-health.js
node ~/.config/opencode/hooks/orchestra-health-opencode.js
node ~/.qoder/hooks/orchestra-enable.js status

# Mirrors + registry in sync (CI gates)
node scripts/sync-qoder-agents.js --check
node scripts/sync-claude-agents.js --check
node scripts/sync-codex-agents.js --check
node scripts/gen-agent-registry.js --check
```

Restart the host app after install: Cursor IDE, OpenCode desktop, Qoder
sessions, Claude Code session, Codex session. Claude hooks are registered in
`~/.claude/settings.json`; verify the four events exist:

```bash
node -e 'const s=require(process.env.HOME+"/.claude/settings.json");console.log(Object.keys(s.hooks||{}))'
```

Expected: `SessionStart`, `UserPromptSubmit`, `SubagentStop`, `Stop`.

## 4. Per-project setup

Global installs add the agents; project files give the loop its ground truth.

```bash
bash scripts/init-project.sh /path/to/project            # guided; writes AGENTS.md + context/
bash scripts/init-context.sh /path/to/project --bridge   # Six-File Context only
bash scripts/setup-repo-scoping.sh /path/to/repo         # .ignore + .cursorignore
```

Then run a normal prompt ("fix the login bug") — no `/orchestra` needed when
ambient hooks are active.

## Repair and upgrade

```bash
git pull
bash install.sh --all            # re-copy agents/hooks/skills; settings merged idempotently
node scripts/sync-qoder-agents.js
node scripts/sync-claude-agents.js
node scripts/sync-codex-agents.js
node scripts/gen-agent-registry.js
```

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Hooks do not fire | Restart the host; confirm the event list in `settings.json` / `hooks.json`; check the hook command path is absolute and exists |
| `Unknown option` from installer | Use a documented flag; run `bash install.sh --help` |
| Qoder agent load error | `bundle/qoder/agents/references` must not be installed; re-run `bash install.sh --qoder` |
| Claude subagent ignores a block | The block path emits `{decision:"block", reason}`; confirm `CLAUDE_CODE_SESSION_ID` is set and hooks are registered |
| Codex agent not found | Agents are flat `~/.codex/agents/<name>.toml`; run `--codex` and check `name` matches the file stem |
| Mirror drift in CI | Regenerate with the matching `sync-*.js`, never hand-edit generated trees |
| Specialist agents missing | `node scripts/enrich-agent-capabilities.js` then `node scripts/gen-agent-registry.js` |

## Safety

- Prefer `--dry-run` and minimum flags on shared machines.
- Do not delete `~/.claude/agents` or `~/.codex/agents`; the installer copies over
  only the files it owns.
- Do not rewrite `settings.json` by hand — use the merger so other keys
  (model, permissions, env, MCP servers) are preserved.

Docs: `docs/orchestra-cross-platform.md` · `docs/autonomous-workflow.md` ·
`README.md` (Quick Start).

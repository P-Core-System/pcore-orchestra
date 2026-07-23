# Autonomous Cursor + OpenCode workflow

How pcore-orchestra tunes longer agent runs with fewer approval prompts, while keeping provider-level safety and explicit denies for destructive actions.

## Install (source of truth)

```bash
bash install.sh          # or: powershell -File install.ps1
node scripts/merge-autonomy-config.js --all   # autonomy only
```

Install merges:

| Target | From bundle | Behavior |
|--------|-------------|----------|
| `~/.cursor/cli-config.json` | `bundle/config/cursor/cli-autonomy.json` | Merges allowlist + approval/web flags; **keeps** auth/model caches |
| `~/.cursor/permissions.json` | `bundle/config/cursor/permissions.json` | Unions allowlists + autoRun instructions |
| `~/.cursor/sandbox.json` | `bundle/config/cursor/sandbox.json` | Expands `$HOME`; unions paths/network |
| `~/.config/opencode/opencode.json` | `bundle/config/opencode/autonomy.json` | Merges permission/agent/compaction; **keeps** `mcp` secrets |

## Cursor (IDE + CLI)

| Knob | Location | Purpose |
|------|----------|---------|
| Run Mode | **Settings → Agents → Approvals & Execution** | Prefer **Auto-review**. |
| CLI approval | `~/.cursor/cli-config.json` → `approvalMode: unrestricted` | CLI tools auto-run. |
| Web | `autoAcceptWebSearch`, `webFetchDomainAllowlist` | Fewer search/fetch prompts. |
| Allowlists + classifier | `~/.cursor/permissions.json` | Terminal/MCP + `autoRun` steer. |
| Sandbox | `~/.cursor/sandbox.json` | Shared build cache; hooks/skills paths. |

### Manual step (required once)

Set **Auto-review** in Cursor Settings after install, then reload.

## OpenCode

| Knob | Location | Purpose |
|------|----------|---------|
| Global permissions | `opencode.json` → `permission` | Allow with `.env` / force-push denies; `doom_loop: ask`. |
| Orchestra agents | `agent.*` + markdown | Readonly: `edit: deny`, `bash: allow`. |
| Session auto | `opencode --auto` | Approves remaining `ask`; **deny still binds**. |

Example: `docs/opencode.json.example` (from `bundle/config/opencode/autonomy.json`).

## Safety kept intact

Provider policies; `.env` denies; force-push / hard-reset / mass-delete denies; prod DB / SSH / remote kubectl block instructions.

## Quick verify

```bash
node scripts/merge-autonomy-config.js --all
node ~/.cursor/hooks/orchestra-health.js
node ~/.config/opencode/hooks/orchestra-health-opencode.js
```

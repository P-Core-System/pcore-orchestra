# Autonomous Cursor + OpenCode workflow

How pcore-orchestra tunes longer agent runs with fewer approval prompts, while keeping provider-level safety and explicit denies for destructive actions.

## Install (source of truth)

```bash
bash install.sh          # or: powershell -File install.ps1
node scripts/merge-autonomy-config.js --all   # autonomy only
```

Install upgrades OpenCode CLI to latest (`scripts/ensure-opencode-latest.sh`) unless you pass `--skip-opencode-upgrade`. Pre-release: `OPENCODE_CHANNEL=beta bash install.sh`. **Restart the OpenCode desktop app** after install so the sidecar matches the CLI.

| Target | From bundle | Behavior |
|--------|-------------|----------|
| `~/.cursor/cli-config.json` | `bundle/config/cursor/cli-autonomy.json` | Merges allowlist + approval/web flags; **keeps** auth/model caches |
| `~/.cursor/permissions.json` | `bundle/config/cursor/permissions.json` | Unions allowlists + autoRun instructions |
| `~/.cursor/sandbox.json` | `bundle/config/cursor/sandbox.json` | Expands `$HOME`; unions paths/network |
| `~/.config/opencode/opencode.json` | `bundle/config/opencode/autonomy.json` | Merges permission/agent/compaction; **keeps** `mcp` secrets; merges `tool_output` when OpenCode ≥ 1.19.0, else strips (ConfigInvalidError on older sidecar) |

If OpenCode fails to start or **shows no response** after install/upgrade:

```bash
bash scripts/fix-opencode-response.sh              # sync agents, merge config, probe
bash scripts/fix-opencode-response.sh --disable-remote-mcp   # also disable hanging remote MCP
bash scripts/ensure-opencode-latest.sh          # upgrade CLI
node scripts/sanitize-opencode-config.js --heal # strip gated keys on old runtime
# Restart OpenCode desktop app (sidecar sync)
node ~/.config/opencode/hooks/orchestra-health-opencode.js --heal
```

## Cross-platform spawn (Cursor ↔ OpenCode)

Same phase agents (`orchestra-planner` … `orchestra-reviewer`), different tools:

| Platform | Spawn | Chain |
|----------|-------|-------|
| Cursor | **Task** + `subagent_type` | Hooks `subagentStop` |
| OpenCode | **task** + agent name | `orchestra` conductor loops |

Full matrix: [`docs/orchestra-cross-platform.md`](orchestra-cross-platform.md)

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

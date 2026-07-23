# Autonomous Cursor + OpenCode workflow

How this machine is tuned for longer agent runs with fewer approval prompts, while keeping provider-level safety and explicit denies for destructive actions.

## Cursor (IDE + CLI)

| Knob | Location | Purpose |
|------|----------|---------|
| Run Mode | **Settings → Agents → Approvals & Execution** | Prefer **Auto-review** (allowlist → sandbox → classifier). Use **Run Everything** only if you accept zero prompts. |
| CLI approval | `~/.cursor/cli-config.json` → `approvalMode: unrestricted` | CLI tools auto-run; broad `permissions.allow` is the fallback. |
| Web | same file → `autoAcceptWebSearch`, `webFetchDomainAllowlist` | Fewer search/fetch prompts. |
| Allowlists + classifier steer | `~/.cursor/permissions.json` | Terminal/MCP allowlists + `autoRun.allow_instructions` / `block_instructions`. |
| Sandbox network/paths | `~/.cursor/sandbox.json` | Shared build cache; hooks/skills paths; network default allow with metadata deny. |

**Do not** commit secrets into project `.cursor/permissions.json` unless the team agrees. Prefer user-global files.

### Manual step (required once)

Cursor Run Mode is UI-only. Set **Auto-review** after updating these files, then reload the window.

## OpenCode

| Knob | Location | Purpose |
|------|----------|---------|
| Global permissions | `~/.config/opencode/opencode.json` → `permission` | Default `allow` with denies for `.env`, force-push, hard reset; `doom_loop: ask`. |
| Orchestra agents | same file → `agent.*` + markdown frontmatter | Readonly phases: `edit: deny`, `bash: allow` (inspection without prompts). |
| Auto-approve session | `opencode --auto` or TUI “Enable auto-approve permissions” | Approves remaining `ask` rules for the session; **deny still enforced**. |
| Skills | `permission.skill` | Allow orchestra + UI skills; deny `internal-*`. |
| Optimal models | `bash scripts/setup-opencode-optimal.sh --balanced` | Cost/quality profiles (keeps `bash: allow` on readonly agents). |

Example committed config: `docs/opencode.json.example`.

### Secrets

Prefer `{env:VAR}` in MCP headers and a User environment variable (or `~/.config/opencode/.env` for local tooling). Rotate any token that was previously stored in plaintext in `opencode.json`.

## What we intentionally do **not** weaken

- Provider / team-admin safety policies
- `.env` read/write denies (OpenCode defaults + explicit rules)
- Force-push / hard-reset / mass-delete denies
- Classifier `block_instructions` for prod DB, SSH keys, remote kubectl

## Quick verify

```bash
# Cursor CLI
node -e "console.log(require(require('os').homedir()+'/.cursor/cli-config.json').approvalMode)"
Test-Path ~/.cursor/permissions.json; Test-Path ~/.cursor/sandbox.json

# OpenCode
node ~/.config/opencode/hooks/orchestra-health-opencode.js
# Start with: opencode --auto
```

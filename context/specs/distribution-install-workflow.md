# Spec: distribution-install-workflow

## Goal

Running `install.sh` (or `install.ps1`) installs the full orchestra bundle globally to `~/.cursor/` and `~/.config/opencode/` so any project on the machine gets ambient multi-agent orchestration without per-project setup.

## Context

- Related overview/architecture sections: `context/architecture.md` (Stack → Install row, System boundaries → install scripts, Storage model → Installed bundle), `context/project-overview.md` (Distribution section)
- Out of scope: Per-project bridge install (`--project` flag), user's custom `hooks.json` overwrite, IDE restart reminder

## Requirements

1. Copy hook scripts (`orchestra-*.js`) and `lib/` to `~/.cursor/hooks/` (Cursor)
2. Copy agents (`orchestra.md`, `orchestra-*.md`, category dirs `01-idea`..`10-review`) to `~/.cursor/agents/`
3. Copy skills (orchestra-loop, prompt-intake, verification-before-completion, UI skills, Cloudflare skills) to `~/.cursor/skills/`
4. Copy Cursor built-in skills to `~/.cursor/skills-cursor/`
5. Copy rule `orchestra-loop.mdc` to `~/.cursor/rules/`
6. Merge `hooks.json` by command name (dedup, preserve user's other hooks)
7. Link orchestra skills to `~/.agents/skills/` for external discovery
8. Run `merge-autonomy-config.js --cursor` to merge CLI config, `permissions.json`, `sandbox.json`
9. OpenCode: copy agents (conductor + core + enterprise mirrors) to `~/.config/opencode/agents/`
10. OpenCode: copy skills to `~/.config/opencode/skills/`
11. OpenCode: copy hooks + lib to `~/.config/opencode/hooks/`
12. OpenCode: copy default state to `~/.config/opencode/hooks/state/` (no overwrite)
13. OpenCode: copy global `AGENTS.md` to `~/.config/opencode/AGENTS.md` (no overwrite)
14. OpenCode: link skills to `~/.agents/skills/`
15. OpenCode: run `merge-autonomy-config.js --opencode` to merge `opencode.json` (preserve `mcp`)
16. Optional: install repo scoping scripts to `~/.local/bin/` and global gitignore to `~/.config/git/ignore`
17. Health checks for both platforms after install

## Acceptance criteria

- [ ] `bash install.sh --cursor` → health check `node ~/.cursor/hooks/orchestra-health.js` passes
- [ ] `bash install.sh --opencode` → health check `node ~/.config/opencode/hooks/orchestra-health-opencode.js` passes
- [ ] `bash install.sh --all` → both health checks pass
- [ ] User's existing `hooks.json` entries unrelated to orchestra are preserved
- [ ] User's existing `~/.config/opencode/opencode.json` `mcp` section is preserved
- [ ] `~/.local/bin/setup-repo-scoping.sh` executable after install
- [ ] `~/.config/git/ignore` exists with common ignore patterns
- [ ] `git config --global core.excludesfile` points to global gitignore

## Done when (verifiable)

- Command: `bash install.sh --all` → exits 0, both health checks print PASS
- Command: `ls ~/.cursor/agents/orchestra-planner.md ~/.cursor/hooks/orchestra-session.js ~/.cursor/skills/orchestra-loop/SKILL.md` → all exist
- Command: `ls ~/.config/opencode/agents/orchestra.md ~/.config/opencode/hooks/orchestra-health-opencode.js ~/.config/opencode/skills/orchestra-loop/SKILL.md` → all exist
- Command: `cat ~/.cursor/hooks.json | jq '.hooks.sessionStart[] | select(.command | contains("orchestra"))'` → exactly one entry

## Files (expected)

- `install.sh` — main installer (Bash)
- `install.ps1` — main installer (PowerShell)
- `scripts/merge-autonomy-config.js` — autonomy merge logic
- `bundle/hooks.json` — hook definitions to merge
- `bundle/config/cursor/` — CLI config, permissions.json, sandbox.json
- `bundle/config/opencode/autonomy.json` — OpenCode permission/agent profile
- `bundle/opencode/state/orchestra.json` — default OpenCode state

## Risks

- `cp -rf lib` into existing `hooks/lib` nests `lib/lib/` (fixed by `rm -rf` before copy)
- Windows: symlink creation for `~/.agents/skills/` may fail (fallback to copy)
- OpenCode desktop app requires restart after CLI upgrade (`ensure-opencode-latest.sh`)
- Concurrent installs could race on `hooks.json` merge
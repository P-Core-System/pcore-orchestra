# Changelog

All notable changes to **P-Core Orchestra** are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> Releases were not git-tagged before this file was adopted (2026-10-26). The 3.7.0
> entry below is a curated summary of the current state; earlier history is thematic
> and lives in full in `git log` and `docs/index.md` (historical plans and audits).

## [Unreleased]

### Fixed
- Bundled-skill broken reference links — tracked in issue #12
- Stale OpenCode V1 `task` tool / `task_id` guidance in the `orchestra-loop` skill (now `subagent` + `sessionID`)

### To be installed
- Installer support for Claude Code and Codex CLI (`--claude` / `--codex`) — tracked in issue #14; today both hosts have a native spawn bridge and docs only

## [3.7.0] - 2026-10-26

### Added
- **MCP knowledge server** — `search_docs` / `read_doc` / `read_context` / `search_memory` over a strict allowlist plus `share_knowledge` / `list_knowledge` into a pending-review inbox; Streamable HTTP transport (`startHttp()`, bearer-token policy for non-loopback binds) so ChatGPT and other remote MCP connectors can attach; guide in `docs/mcp-chatgpt.md`
- **Qoder CLI as the third installed host** — converted agent frontmatter (`scripts/sync-qoder-agents.js`, CI drift gate), PascalCase hooks merged into `~/.qoder/settings.json` (`scripts/merge-qoder-settings.js`), `agent_type` stdin shim, one-state-session-per-conversation fix
- **Claude Code + Codex native spawn bridge** (five-host matrix) — `Agent` + `subagent_type` (Claude Code, v2.1.63 `Task`→`Agent` rename) and `spawn_agent` + `agent_type` (Codex, `multi_agent` stable) replace the old MCP `tools/call` fallback; contracts verified against current vendor docs
- **OpenCode V1→V2 config migration** — `scripts/lib/opencode-v2.js` normalizes legacy `opencode.json` (behavior-preserving, oracle-tested), with a downgrade-guarded CLI updater (`scripts/ensure-opencode-latest.sh`) targeting `@opencode/cli`
- Free-model pool rotation for OpenCode — weekly refresh/apply with probe validation and systemd/cron schedule (`scripts/update-free-models.sh`)
- Studio dashboard (`studio/`), harness-observability log, heartbeat/stall handling, quality-gate evidence runner (`evidence-runner.js`)

### Changed
- OpenCode spawn contract: conductor and hooks emit **`subagent`** (V2 native) instead of the V1 `task` tool; all 160 agents keep V1 `permission:` frontmatter as the reliable form (RC1–RC5 permission rework, verified at v2.0.29 and re-checked on 2.1.4)
- Hooks config version corrected to Cursor-required `version: 1`; session continuity keys on `conversation_id`
- Security scanner and CI share one scope + one allowlist: `scan-secrets.js` and the in-loop `evidenceSecurity` gate can no longer disagree; allowlist entries require reasons and label constraints
- Docs re-based to measurement: 40 Node suites (38 in CI), flat `lib/` 44 modules, five-host cross-platform matrix, version stamps aligned to 3.7.0

### Fixed
- Open-source hygiene: personal identity, server hostnames/SSH aliases, and per-machine paths removed from the working tree; all links genericized to `$HOME`/`~/…` form
- OpenCode permission allowlist regenerated namespaced (bare-name globs matched 0/42 specialists; namespaced globs achieve full coverage)

## [0.x – 3.6.x] - 2026-07-10 → 2026-10 (pre-changelog)

- Initial release (`1b9597c`, 2026-07-10): Cursor orchestra with Six-File Context integration
- Enterprise agent registry growth to 160 agents across 10 SDLC categories with `bundle/agent-registry.json` (v2) as generated SSOT
- Ambient Cursor hooks chain (plan → implement → verify → review), OpenCode conductor + ambient plugin, memory (short/long-term, hybrid recall via `node:sqlite` FTS5), token budgets, greenfield scaffolding, project bridges, Windows installer (`install.ps1`)

[Unreleased]: https://github.com/P-Core-System/pcore-orchestra/commits/main
[3.7.0]: https://github.com/P-Core-System/pcore-orchestra/commits/main

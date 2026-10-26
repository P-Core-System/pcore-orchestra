# Contributing to P-Core Orchestra

Thank you for considering a contribution to P-Core Orchestra! Orchestra is a portable, ambient multi-agent orchestration harness for Cursor, OpenCode CLI, and Qoder CLI that runs plan → implement → verify → review automatically on build/fix/refactor prompts.

## How to Contribute

### 1. Fork and Clone

```bash
git clone https://github.com/P-Core-System/pcore-orchestra.git
cd pcore-orchestra
```

### 2. Install Dependencies

```bash
npm ci
```

### 3. Run the Self-Check Suite

Before submitting any change, run the same gates as CI. The canonical, maintained list
lives in [`context/code-standards.md`](context/code-standards.md); this loop covers every
suite under `scripts/` without needing the list to be updated when suites are added:

```bash
npm ci && npm ci --prefix server   # MCP SDK + Studio server deps
for f in scripts/test-*.js; do node "$f" || exit 1; done
bash scripts/test-studio-service.sh
node scripts/gen-agent-registry.js --check
node scripts/sync-qoder-agents.js --check
node scripts/scan-secrets.js --dir . --fail-on=high
```

Node 24 is required for the Studio UI suite (native `.ts` type stripping); the hook
runtime itself supports Node 18+ (22.5+ enables SQLite FTS recall). All gates must exit 0.

### 4. Mirror Rule

`bundle/hooks/` and `bundle/opencode/hooks/` must stay **byte-identical** for every shared file. After editing anything under `bundle/hooks/lib/`, copy it to `bundle/opencode/hooks/lib/` and re-run `node scripts/test-mirror-sync.js`. Allowed differences: `orchestra-health.js` vs `orchestra-health-opencode.js` only.

### 5. Generated Blocks

`permission.task` in the conductor agent files and `bundle/agent-registry.json` are **generated** by `scripts/gen-agent-registry.js`. Never hand-edit the generated blocks (they sit between `# BEGIN GENERATED:` / `# END GENERATED:` markers). Run:

```bash
node scripts/gen-agent-registry.js
```

to regenerate, then `node scripts/gen-agent-registry.js --check` to verify.

### 6. Commit Convention

Commits follow `<type>(<scope>): <description>`:

- `feat(orchestra): ...` — new conductor/loop feature
- `fix(agents): ...` — agent permission or prompt fix
- `fix(deps): ...` — dependency vulnerability fix
- `docs(...): ...` — documentation only
- `chore(...): ...` — maintenance

User-visible changes also get one line under **Unreleased** in [`CHANGELOG.md`](CHANGELOG.md).

### 7. Progress Tracker

Every meaningful change to this repo must add a dated entry to `context/progress-tracker.md`:

```markdown
- YYYY-MM-DD — Description. Files: `path/file1`, `path/file2`. Impact: what changed.
```

A commit without a progress-tracker entry is considered incomplete.

### 8. Context Sync

If your change touches:
- **Hook scripts or lib modules** → update `context/architecture.md` (system boundaries table)
- **Agent prompts** → update `context/architecture.md` (agents section)
- **Install scripts** → update `README.md` (commands) + `context/architecture.md`
- **Scope or features** → update `context/project-overview.md`

## Pull Request Process

1. Create a feature branch: `git checkout -b feature/your-description`
2. Make your changes (one concern per PR — hooks, agents, install, or docs, not all at once unless tightly coupled)
3. Run the self-check suite (all must pass)
4. Update `context/progress-tracker.md`
5. Commit with conventional message
6. Push and open a PR against `main`

## Code Review

All PRs are reviewed for:
- All self-check suites passing
- Mirror sync (Cursor ↔ OpenCode byte-identity)
- Registry coverage (160/160 agents spawnable)
- Secret scan (no high/critical findings)
- Doc sync (context files updated)
- Progress tracker entry

## Questions

Open an issue or discussion on GitHub. We welcome questions, bug reports, and feature ideas — not just code.

---

## Code of Conduct

This project is governed by the [Contributor Covenant 2.1](CODE_OF_CONDUCT.md).
Be respectful, inclusive, and constructive. Harassment, spam, or off-topic behavior will not be tolerated; report issues through the channels listed in `CODE_OF_CONDUCT.md`.

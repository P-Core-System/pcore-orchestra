# Code Standards

## Node hook scripts

- `"use strict"` at top; CommonJS (`require`), no ESM in hooks (Cursor spawns node directly).
- All hooks: read stdin JSON, write JSON to stdout via `emit()`, exit 0.
- Shared logic lives in `orchestra-lib.js`; individual hooks stay thin.
- Windows-safe paths: use `path.join`, support `USERPROFILE` and `HOME`.
- Fail silently for hooks: `.catch(() => emit({}))` — never break Cursor on hook errors.

### Run-state persistence (invariant)

- All conductor run state MUST go through `bundle/hooks/lib/conductor-state.js` (and its `bundle/opencode/hooks/lib/conductor-state.js` mirror): atomic tmp+rename writes, isolation-keyed by (workspace + session + task), shared registry at `conductor-runs/index.json`.
- NEVER write run state via raw heredoc to shared flat files (e.g. `~/.config/opencode/state/orchestra-state.json`) — concurrent loops/workspaces would clobber each other. Use the CLI: `scripts/conductor-state.sh begin/save/who/resume/complete/fail/gc`.

### State writes (invariant)

- Every other state write (orchestra, memory, tokens, projects, plans, cycle reports, version, daily, health counters) goes through `bundle/hooks/lib/safe-write.js`: `atomicWrite()` (tmp + fsync + rename with sync-sleep retry backoff) and `updateState(mutator, {rootDir, sessionId, waitMs})` (advisory `<path>.lock` file, mutate-in-place, no full-file rewrites). A corrupt/unparseable file is renamed to a `.corrupt-<ts>` sibling (bytes preserved for forensics) and the caller gets defaults — never a silent reset.
- `updateState` mutators must be pure sync reads of the current JSON and may return `null` to abort without saving. Long/critical work (evidence capture, gate bookkeeping) stays OUTSIDE the lock.
- `PCORE_STATE_DIR` (via `safe-write.resolveStatePath`) redirects all state paths — tests must set `PCORE_SESSION_ID` and run against a temp dir.
- All hooks still fail open: `main().catch(() => emit({}))` — a state error must never break the host.

### Hook mirrors (invariant)

- `bundle/hooks/` and `bundle/opencode/hooks/` must stay byte-identical for every shared file; after editing anything under `bundle/hooks/lib/`, copy it to `bundle/opencode/hooks/lib/` and re-run `node scripts/test-mirror-sync.js`.
- Allowed differences: `orchestra-health.js` vs `orchestra-health-opencode.js` (and the mirror-only health entry). Nothing else may diverge.

### Generated blocks (invariant)

- `permission.task` in `bundle/agents/orchestra.md` and `bundle/opencode/agents/orchestra.md` is generated — edit `scripts/gen-agent-registry.js`, never the block. It sits between `# BEGIN GENERATED: task allowlist (...)` / `# END GENERATED: task allowlist` markers, keeps `"*": deny` as the first rule, and is strictly additive (no pre-existing allow rule may be dropped).
- `bundle/agent-registry.json` + the `subagentStop` matcher in the three `hooks.json` copies are generated too. `node scripts/gen-agent-registry.js --check` must exit 0 (CI enforces it).

### Self-check suites (run before every commit)

```bash
node scripts/test-safe-write.js
node scripts/test-state-manager-compat.js
node scripts/test-conductor-state.js
node scripts/test-phase-outcome.js
node scripts/test-agent-registry.js
node scripts/test-handshake-contract.js
node scripts/test-mirror-sync.js
node scripts/test-permission-review.js
node scripts/test-adaptive-loop.js
node scripts/test-domain-model.js
node scripts/test-domain-completion.js
node scripts/test-domain-store.js
node scripts/test-domain-evidence.js
node scripts/test-domain-state-dir.js
node scripts/test-evidence-runner.js
node scripts/test-review-queue.js
bash scripts/test-studio-service.sh
node scripts/test-security-scanner.js
node scripts/gen-agent-registry.js --check
node scripts/scan-secrets.js --dir . --fail-on=high
```

All must exit 0. `.github/workflows/ci.yml` runs the same list on every PR (the
secret scan is a required CI step — see invariant 24).

## Agent markdown

- YAML frontmatter: `name`, `description`, optional `readonly: true` for planner.
- Imperative sections: "When invoked", numbered steps, structured output templates.
- End markers on their own line: `PLAN_READY`, `IMPLEMENT_DONE`, `VERIFY_PASS`, `VERIFY_FAIL`, `ORCHESTRA_COMPLETE`, `FIX_REQUIRED`.
- Each agent includes: self-review checklist, error-free rules, git workflow (where applicable).
- Output templates include git commit status for implementer, git status for verifier, git review for reviewer.

## Install scripts

- Bash: `set -euo pipefail` where supported; LF line endings (`.gitattributes`).
- PowerShell: `$ErrorActionPreference = "Stop"`; param blocks for flags.
- Merge `hooks.json` via embedded Node snippet — do not hand-edit user hooks.json on install.

## File organization

```
bundle/hooks/orchestra-<event>.js   # one hook per file
bundle/agents/orchestra-<role>.md   # one subagent per file
scripts/init-context.sh             # project scaffolding
```

## Documentation

- README: install paths, usage table, uninstall steps.
- `context/progress-tracker.md`: update after every meaningful change to this repo.
- Credit Six-File Context Methodology (JavaScript Mastery) in README; templates are derived from user-provided download.

## Doc update protocol (mandatory for every change)

Every implementation change MUST update the relevant context files before committing. No exceptions.

| Change type | Update these files |
|---|---|
| New hook script or lib module | `context/architecture.md` (system boundaries table) + `context/progress-tracker.md` |
| New agent markdown | `context/architecture.md` (agents section) + `context/progress-tracker.md` |
| New install script or install.sh change | `context/architecture.md` (install row) + `README.md` (commands) + `context/progress-tracker.md` |
| New context template | `templates/context/` + `context/progress-tracker.md` |
| New scoping/ignore feature | `context/architecture.md` + `context/ai-workflow-rules.md` (scoping rules) + `context/progress-tracker.md` |
| Bug fix | `context/progress-tracker.md` (add to Current Phase with date + description) |
| Architecture or invariant change | `context/architecture.md` first, then `context/progress-tracker.md` |
| Scope or feature change | `context/project-overview.md` first, then `context/progress-tracker.md` |

### Progress-tracker entry format

```markdown
- YYYY-MM-DD — Short description of change. Key files: `path/to/file1`, `path/to/file2`.
  Impact: what changed for users/agents.
```

### Pre-commit checklist

- [ ] `context/progress-tracker.md` has a new entry with today's date
- [ ] If architecture changed: `context/architecture.md` updated
- [ ] If scope changed: `context/project-overview.md` updated
- [ ] If workflow rules changed: `context/ai-workflow-rules.md` updated
- [ ] If code standards changed: `context/code-standards.md` updated
- [ ] README.md reflects new commands or paths

## Five Design Principles

### SOLID

| Principle | Meaning | Practice |
|-----------|---------|----------|
| **S**ingle Responsibility | One module = one domain | `lib/` splits state, lifecycle, heartbeat, memory, history, classification, context, checkpoint, phase engine, IO into separate files |
| **O**pen/Closed | Open for extension, closed for modification | Command map in `orchestra-enable.js`; add a command by adding an entry, not editing an if/else chain. Phase chain is config-driven |
| **L**iskov Substitution | Hook contracts are interchangeable | All hooks follow `readStdinJson → process → emit({})` contract; any hook can be replaced without breaking the chain |
| **I**nterface Segregation | Import only what you need | Each hook imports from specific `lib/*` modules, not a god module. No hook depends on functionality it doesn't use |
| **D**ependency Inversion | Depend on abstractions, not concretions | All lib modules export plain functions consumed by hooks; no hook depends on another hook's internals |

### Clean Code

- **Functions under 50 lines** — extract when longer (except main which is an orchestrator)
- **Max 3 levels of nesting** — extract guarded blocks into named functions
- **Early returns** — return early on error/empty, keep main path shallow
- **Descriptive names** — functions say what they do, variables say what they hold
- **No magic numbers** — all numeric constants in `lib/constants.js` with descriptive names
- **No commented-out code** — delete it; git has history
- **Error messages** — include context (what failed, why, what to do)
- **Minimal dependencies** — prefer built-in modules, justify every npm package
- **Consistent style** — match existing code in the repo

### Flexible

- **Config-driven phase chain** — `PHASE_CHAIN` is a plain object; adding a new phase requires zero logic changes
- **Plugin-like commands** — `COMMANDS` map in `orchestra-enable.js` accepts new entries without structural changes
- **Backward-compatible facade** — `orchestra-lib.js` re-exports all lib modules; existing external consumers work unchanged

### Easy to Change

- **Low coupling** — each lib module can be tested/edited independently
- **High cohesion** — all state logic in `state-manager.js`, all heartbeat logic in `heartbeat-monitor.js`, etc.
- **Single source of truth** — constants live in `constants.js`, not scattered across files
- **Path isolation** — each module resolves its own paths via `__dirname`; no cross-module path dependencies

## Code quality checklist (for implementer)

Before submitting code:
- [ ] No commented-out code (delete it, git has history)
- [ ] No console.log in production hooks (use emit() for output)
- [ ] No hardcoded values (extract to constants)
- [ ] Functions under 50 lines (break if longer)
- [ ] Max 3 levels of nesting (extract if deeper)
- [ ] Error handling for all async operations
- [ ] No unused imports or variables
- [ ] SRP: does this change touch only one domain's module?
- [ ] OCP: does this require editing an existing command/chain entry instead of adding one?
- [ ] ISP: are imports limited to exactly what's needed?

## Terminology: Harness > Scaffold > Loop

Use consistent terminology when discussing agent architecture:

- **Loop:** The execution cycle (ReAct pattern: think → act → observe → repeat)
- **Scaffold:** Behavior definition (prompts, tools, context, memory)
- **Harness:** Complete software layer (execution, state, error handling, orchestration)

When modifying hook scripts, you are working on the **harness** layer.
When modifying agent prompts, you are working on the **scaffold** layer.
When modifying phase transitions, you are working on the **loop** layer.

# Code Standards

## Node hook scripts

- `"use strict"` at top; CommonJS (`require`), no ESM in hooks (Cursor spawns node directly).
- All hooks: read stdin JSON, write JSON to stdout via `emit()`, exit 0.
- Shared logic lives in `orchestra-lib.js`; individual hooks stay thin.
- Windows-safe paths: use `path.join`, support `USERPROFILE` and `HOME`.
- Fail silently for hooks: `.catch(() => emit({}))` — never break Cursor on hook errors.

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

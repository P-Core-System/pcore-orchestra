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

## Code quality

- **Single responsibility**: each function does one thing
- **Early returns**: avoid deep nesting, return early on error
- **Descriptive names**: functions say what they do, variables say what they hold
- **No magic numbers**: extract constants with meaningful names
- **Error messages**: include context (what failed, why, what to do)
- **Minimal dependencies**: prefer built-in modules, justify every npm package
- **Consistent style**: match existing code in the repo

## Clean code checklist (for implementer)

Before submitting code:
- [ ] No commented-out code (delete it, git has history)
- [ ] No console.log in production hooks (use emit() for output)
- [ ] No hardcoded values (extract to constants)
- [ ] Functions under 50 lines (break if longer)
- [ ] Max 3 levels of nesting (extract if deeper)
- [ ] Error handling for all async operations
- [ ] No unused imports or variables

## Terminology: Harness > Scaffold > Loop

Use consistent terminology when discussing agent architecture:

- **Loop:** The execution cycle (ReAct pattern: think → act → observe → repeat)
- **Scaffold:** Behavior definition (prompts, tools, context, memory)
- **Harness:** Complete software layer (execution, state, error handling, orchestration)

When modifying hook scripts, you are working on the **harness** layer.
When modifying agent prompts, you are working on the **scaffold** layer.
When modifying phase transitions, you are working on the **loop** layer.

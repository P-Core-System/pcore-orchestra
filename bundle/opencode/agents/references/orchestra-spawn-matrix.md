# Orchestra spawn matrix (Cursor + OpenCode)

## Cursor IDE

- **Spawn:** `Task` tool, `subagent_type="orchestra-planner"` (etc.)
- **Chain:** Hooks `subagentStop` advance phases when markers appear
- **Entry:** Ambient parent agent OR `orchestra` conductor agent
- **Do not use:** `generalPurpose`, wrong subagent_type names

## OpenCode

- **Spawn:** `task` tool, agent=`orchestra-planner` (etc.)
- **Chain:** `orchestra` conductor calls task once per phase — no hooks
- **Entry:** `default_agent: orchestra` only
- **Phase agents:** `hidden: true` — not in @ menu

## Shared phase names (exact)

`orchestra-planner` → `orchestra-implementer` → `orchestra-verifier` → `orchestra-reviewer`

## Handoff (both)

Goal (1 line) + plan bullets + prior failures only. No full chat history.

## Full doc

`docs/orchestra-cross-platform.md`

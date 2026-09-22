---
name: orchestra-loop
description: >-
  Multi-agent orchestra — plan → implement → verify → review. Cursor: ambient
  hooks + Task subagent_type. OpenCode: orchestra conductor + task tool. Use for
  build/fix/refactor, agent loop, or cross-platform orchestra setup.
---

# Orchestra Loop (Cursor + OpenCode)

- **Cursor:** runs via `~/.cursor/` hooks — ambient auto-start; spawn with **Task** + `subagent_type`.
- **OpenCode:** runs via `~/.config/opencode/` — user talks to **orchestra** conductor; spawn with **task** + agent name.

You do not need `/orchestra` on Cursor when ambient mode is ON.

## Cross-platform (Cursor + OpenCode)

Same four phase agent names; **different spawn tool and chaining**.

| | **Cursor IDE** | **OpenCode CLI / desktop** |
|---|----------------|----------------------------|
| User entry | Main Agent (ambient hooks) or `orchestra` conductor | `orchestra` only (`default_agent`) |
| Spawn tool | **Task** (capital T) | **task** (lowercase) |
| Spawn param | `subagent_type="orchestra-planner"` | `agent="orchestra-planner"` |
| Phase chain | Hooks `subagentStop` auto-advance | Conductor calls **task** once per phase |
| Phase visibility | Task picker | `hidden: true` — not in @ menu |

Full matrix: `docs/orchestra-cross-platform.md` · agent ref: `references/orchestra-spawn-matrix.md`

## Cursor Task limitation (conductor fallback)

If Cursor `Task` rejects `subagent_type=orchestra-*` (enum / unknown agent), the parent **MUST** keep the loop alive: run phases itself **or** spawn `generalPurpose` loaded with instructions from `~/.cursor/agents/orchestra-*.md`. Do **not** stop the loop. Hooks still match those names when custom agents work.

### Anti-stop (CRITICAL — Cursor conductor)

When orchestra is **active**, or the user said **continue / until finish / do all / don't stop**:

1. **Do not** end turns with “Done / Next (1)(2)(3)” choice menus that wait for the user.
2. After `PLAN_READY` → immediately implement → commit → verify → review in the **same** run (conductor fallback).
3. After `ORCHESTRA_COMPLETE`, if the plan **Handoff** / user goal still has unfinished work → `orchestra-enable.js start "<next goal>"` and run the next loop **immediately**.
4. Only stop when: user goal is fully done, user says **stop**, or 5 resumes fail on one phase — then one short summary (no multi-option Next menu).
5. Small-tasks “Done + Next” does **not** apply while orchestra is active or “continue until finish” is in effect.

## Auto-continue on max steps (CRITICAL)

When a subagent returns WITHOUT its expected ending token, the conductor MUST auto-continue:

| Phase | Expected ending token | Resume action |
|-------|----------------------|---------------|
| planner | `PLAN_READY` | Resume planner with `task_id` — pass incomplete plan so far |
| implementer | `IMPLEMENT_DONE` | Resume implementer with `task_id` — pass what was implemented so far |
| verifier | `VERIFY_PASS` or `VERIFY_FAIL` | Resume verifier with `task_id` — pass what was checked so far |
| reviewer | `ORCHESTRA_COMPLETE` | Resume reviewer with `task_id` — pass what was reviewed so far |

**Rules:**
1. **Detect missing token** — if the subagent result does NOT contain the expected ending token, it hit max steps.
2. **Resume, don't restart** — pass the `task_id` from the previous call to resume the same session.
3. **Pass progress summary** — include what was completed so far in the resume prompt.
4. **Max 5 resume attempts per phase** — after 5 resumes without the ending token, escalate to user with a summary.
5. **NEVER stop the loop** — the conductor continues until: all 4 phases complete, OR 5 resumes fail, OR user explicitly says "stop".

**How to resume (OpenCode):**
```
task(description="resume planner", prompt="Continue from where you stopped. Plan so far: [summary]. Complete the plan ending with PLAN_READY.", subagent_type="orchestra-planner", task_id="<previous_task_id>")
```

**How to resume (Cursor):**
```
Task(description="resume planner", prompt="Continue from where you stopped.", subagent_type="orchestra-planner", task_id="<previous_task_id>")
```

## Conductor-first entry

> **Do NOT pick `orchestra-planner`, `orchestra-implementer`, `orchestra-verifier`, or `orchestra-reviewer` as the user entry on OpenCode.** On Cursor, ambient hooks may launch the first phase directly; optional `orchestra` conductor uses **Task** + `subagent_type`. Hook matchers require exact `orchestra-*` names — do not rename them.

## Models & preflight

### Cursor

Cursor subscriptions include a **Cursor Models** pool with generous usage: `composer-2.5`, `grok-4.6`, `grok-4.5`. Third-party models (Claude, GPT, Gemini) live in the smaller **Other Models** pool and should not be daily defaults.

| Task | Primary | Escalation |
|------|---------|------------|
| Daily agent / plan / implement / review / verify | `composer-2.5` (standard, not Fast) | `grok-4.6` standard, `effort: high` |
| Hard / long-horizon / architecture | `grok-4.6` standard, `effort: high` | — |
| Avoid as default | Fast variants, Claude/GPT/Gemini | They burn Other Models 3–6× faster |

**Set the default:** use the Cursor model picker, run `bash scripts/setup-cursor-model.sh`, or add `model: composer-2.5` to agent frontmatter.

Enterprise specialists in `bundle/agents/01-idea/` through `10-review/` also carry the platform split: `model:` for Cursor and `opencode_model:` for OpenCode. Hard roles (architecture, security, performance) default to `grok-4.6` on Cursor; all others default to `composer-2.5`.

### OpenCode

Run `bash scripts/update-free-models.sh --refresh` then `bash scripts/update-free-models.sh --probe` to validate configured models respond (not just listed).

| Role | Primary model | Fallback chain |
|------|--------------|----------------|
| planner / implementer / reviewer / backend | `mimo-v2.6-flash-free` (ox-alpha) | mimo-v2.6-flash-free → ling-3.0-flash-fin-free |
| verifier / small_model | `mimo-v2.6-flash-free` | mimo-v2.6-flash-free → big-pickle |
| frontend | `mimo-v2.6-flash-free` (ox-alpha) | mimo-v2.6-flash-free (muse-spark/nemotron region-blocked in some locales) |

**Auto pools:** `--refresh` regenerates `~/.config/opencode/state/model-pools.json` (frontend/heavy/light) from the live Zen catalog; use `--pools` to print them. Static chains below are the offline fallback only.

**On model error:** run `--refresh` to re-fetch the model list, then retry the next model in that role's fallback chain.

## Ambient mode (default ON)

When the user asks to **add, fix, build, refactor, deploy, install, configure, migrate, integrate, debug, continue, improve, or finish** something:

1. `beforeSubmitPrompt` classifies the prompt and selects a **route**:
   - **core** (default) — plan → implement → verify → review
   - **enterprise** — full SDLC when `/enterprise` or high complexity signals (architecture, migration, multi-service, security audit, etc.)
   - **informal** — short/casual goals still start **core** with `inferFromContext` (planner expands from progress-tracker/git)
2. Parent launches the first agent (**orchestra-planner** for core; discovery agent for enterprise idea).
3. Hooks chain subsequent phases via `subagentStop`.

**Skipped for:** explain-only questions, "what is/how does", "no orchestra", "just explain", trivial hi/thanks.

## Adaptive routing

| Route | Trigger | Start phase | Loop |
|-------|---------|-------------|------|
| core | Normal implement/fix/build | `plan` | 4 core agents |
| enterprise | `/enterprise` or complexity signals (beats informal shortness) | `idea` | 32-phase SDLC specialists |
| informal | Short/casual ("fix it", "pls", "next improve") | plan | Infer from progress-tracker/git; planner expands |

Planner (or discovery planning) always runs before implementation.

After updating hooks, always re-run `bash install.sh` (it replaces `hooks/lib`). Restart Cursor.

## Phases

| # | Subagent | Role | Git workflow |
|---|----------|------|-------------|
| 1 | `orchestra-planner` | Plan only (`readonly`) | No commit — plan → `.cursor/orchestra-plan.md` |
| 2 | `orchestra-implementer` | Minimal implementation | **Must commit before** `IMPLEMENT_DONE` / before verify |
| 3 | `orchestra-verifier` | Tests / lint / smoke | No commit — **VERIFY_FAIL if dirty tree** |
| 4 | `orchestra-reviewer` | Final gate (`readonly`) | Suggest docs commit; parent commits docs if dirty |

`FIX_REQUIRED` / `VERIFY_FAIL` → hooks loop back to **orchestra-implementer** (which **commits** fixes before re-verify).

## Phase commit gate (hard rule)

**Commit each part before the next part starts.**

1. Parent runs `git status --porcelain` before launching the next subagent
2. Dirty tree (except `.cursor/orchestra-plan.md`) → commit/discard first — do not advance
3. Implementer: empty porcelain required before `IMPLEMENT_DONE`
4. Verifier: dirty code → `VERIFY_FAIL`
5. After `ORCHESTRA_COMPLETE`: parent commits remaining docs (`progress-tracker`) if dirty

## Git commit convention

All commits follow: `<type>(<scope>): <description>`

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`

- **Planner** includes commit strategy in the plan (phase-gated commits)
- **Implementer** commits after ALL changes (not mid-implementation) — required before next phase
- **Verifier** checks `git status --porcelain` for clean tree
- **Reviewer** reviews commit messages; parent may make a docs commit after ORCHESTRA_COMPLETE

## Self-review & error-free rules

Each subagent has a self-review checklist and error-free rules:

| Subagent | Key self-review | Error-free rule |
|----------|----------------|-----------------|
| Planner | Goal clear, files exist, done-when testable | No assumptions about undocumented behavior |
| Implementer | All plan items done, no scope creep, committed | Zero tolerance: syntax, debug code, secrets |
| Verifier | All checks run, git clean, verdict clear | Never skip, never assume PASS, never fix code |
| Reviewer | Read actual diff, findings are file:line, verdict matches | Never approve if tests fail or secrets in code |

## User commands

| Command | Action |
|---------|--------|
| *(normal coding prompt)* | Auto-orchestrate if implement/fix/build |
| `/orchestra <goal>` | Force start (core route) |
| `/enterprise <goal>` | Force enterprise SDLC route |
| `/orchestra stop` | Stop active loop |
| `disable orchestra` | Turn ambient off |
| `enable orchestra` | Turn ambient on |
| `no orchestra` | Skip for this prompt |

## CLI

```powershell
node $env:USERPROFILE\.cursor\hooks\orchestra-enable.js status
node $env:USERPROFILE\.cursor\hooks\orchestra-enable.js tokens
node $env:USERPROFILE\.cursor\hooks\orchestra-enable.js ambient-off
node $env:USERPROFILE\.cursor\hooks\orchestra-enable.js ambient-on
node $env:USERPROFILE\.cursor\hooks\orchestra-enable.js stop
```

## Parent agent rules

- Use Task with **`orchestra-*` names** — hooks matchers require exact names.
- Do not nest orchestra inside orchestra.
- After `ORCHESTRA_COMPLETE`, summarize and run `orchestra-enable.js stop`.
- **Do not modify files between phases** — let subagents handle their own work.
- **Do not commit between phases** — implementer commits, others are read-only.
- Works in **Cursor IDE Agent** (user hooks). Not cloud agents unless project hooks copied.

## Hooks

| Event | Role |
|-------|------|
| `sessionStart` | Inject ambient policy every session |
| `beforeSubmitPrompt` | Auto-start on implement prompts |
| `subagentStop` | Chain next phase |
| `stop` | Nudge if parent stalled |

## Opt out

Say **"no orchestra"** or run `ambient-off`. Pure Q&A never triggers the chain.

## Heartbeat & stall detection

Heartbeat timestamps are written on every hook execution. If a phase runs >5min (configurable), stall detection emits recovery nudges. After 2 stalls, orchestration aborts.

## Memory

- **Short-term**: Tracked during each run (phases, files, errors, decisions). Available to subagents.
- **Long-term**: Persistent `~/.cursor/hooks/state/orchestra-memory.json`. Planner reads past goals/errors; reviewer writes lessons.

```bash
node ~/.cursor/hooks/orchestra-enable.js memory          # View
node ~/.cursor/hooks/orchestra-enable.js memory clear    # Clear
```

## Resumable tasks

- **Crash recovery**: `sessionStart` detects stale state, offers resume via "resume orchestra"
- **Manual pause/resume**: `pause [reason]` / `resume` commands or chat
- **Checkpoint**: `checkpoint` saves state without pausing

## Lifecycle events

Every phase transition recorded to state. Last 200 events retained. Phase durations tracked.

## Six-File Context

If the workspace has `context/project-overview.md` (Six-File Context Methodology), hooks inject read order at session start. Subagents read present `context/*.md` files before acting.

For product UI: use skills `ui-ux-pro-max`, `brand`, `design-system`, `ui-styling`; persist tokens into `context/ui-context.md` (see template Skills section).

Bootstrap in any project:

```bash
bash /path/to/pcore-orchestra/scripts/init-context.sh /path/to/your-app --bridge
```

## Token efficiency

Orchestra cycles cost **3–10×** a single chat turn. Default policy:

| Phase | Web | Tool focus | Budget |
|-------|-----|------------|--------|
| Planner | Avoid | grep/glob → targeted read | ~10k |
| Implementer | Plan only | scoped reads, parallel batch | ~30k |
| Verifier | Never | shell checks, one-line failures | ~15k |
| Reviewer | Never | diff only | ~8k |

**Parent rules:** pass concise goal + plan summary to subagents; no file reads between phases; no web search unless user goal requires external docs.

Full guide: `docs/token-optimization.md`. OpenCode: copy `docs/opencode.json.example` or run `bash scripts/setup-opencode-optimal.sh --balanced`.

Harness / agents / prompts: `docs/agent-harness-recommendations.md`.

## Concurrent Session Guard (session-claims)

Other AI sessions may be editing the same repo at the same time. Before
implementing, and again before committing:

```bash
bash <orchestra>/scripts/session-claims.sh check "$PWD" <paths-you-will-touch>
```

- Exit 1 = another LIVE session holds a claim on those paths → coordinate or wait.
- Claim your own work at phase start, renew on long operations, release when done:

```bash
bash scripts/session-claims.sh claim  "$PWD" --scope "app/,packages/" --task "goal text"
bash scripts/session-claims.sh renew  "$PWD"
bash scripts/session-claims.sh release "$PWD"
```

Claims auto-expire after 30 min without heartbeat (`gc` purges them). Set
`PCORE_SESSION_ID` in your session env for stable identity across shells.


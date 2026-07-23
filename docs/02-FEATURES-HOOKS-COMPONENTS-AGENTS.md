# P-Core Orchestra — Features, Hooks, Components & Agents

---

## Table of Contents

1. [Feature Documentation](#6-feature-documentation)
2. [Hooks API](#7-hooks-api)
3. [Component (Lib Module) Documentation](#8-component-lib-module-documentation)
4. [Agent Documentation](#9-agent-documentation)

---

# 6. Feature Documentation

## Feature Index

| # | Feature | Primary File | Category |
|---|---------|-------------|----------|
| 1 | Ambient Auto-Start | `orchestra-prompt.js` | Core |
| 2 | Phase Chaining | `orchestra-subagent-stop.js` | Core |
| 3 | Context Injection | `orchestra-session-start.js` | Integration |
| 4 | Stall Detection | `orchestra-heartbeat.js` | Reliability |
| 5 | Memory System | `orchestra-memory.js` | Persistence |
| 6 | Lifecycle Events | `orchestra-lifecycle.js` | Observability |
| 7 | Crash Recovery | `orchestra-prompt.js` + `checkpoint-manager.js` | Reliability |
| 8 | CLI Control | `orchestra-enable.js` | UX |
| 9 | Health Check | `orchestra-health.js` | Diagnostics |
| 10 | Stop Nudges | `orchestra-stop.js` | UX |
| 11 | Git Workflow | Agent definitions + `phase-engine.js` | DX |
| 12 | Six-File Context | `context-detector.js` | Integration |
| 13 | Project Bridge | `project-bridge/*` | Integration |
| 14 | Install System | `install.sh` / `install.ps1` | Distribution |
| 15 | OpenCode Integration | `bundle/opencode/*` | Multi-Platform |

---

## Feature 1: Ambient Auto-Start

On every `beforeSubmitPrompt` event, `orchestra-prompt.js` classifies the prompt using 6 regex patterns:

| Pattern | Regex | Matches |
|---------|-------|---------|
| **Question Only** | `/^(what is\|what are\|how does\|...)\b/i` | Explanatory questions |
| **Opt Out** | `/\b(no orchestra\|skip orchestra\|...)\b/i` | Explicit skip |
| **Opt In Explicit** | `/\b(\/orchestra\|orchestra loop\|...)\b/i` | Force start |
| **Implement** | `/\b(add\|implement\|build\|fix\|refactor\|...)\b/i` | Build/fix prompts (26 verbs) |
| **Trivial** | `/^(hi\|hello\|hey\|thanks\|...)\b/i` | Greetings |
| **Multistep** | 2+ "and"s, or contains "then/after that/also/next", or >120 chars | Complex tasks |

**Classification Flow:** `text → too_short? → trivial? → stop? → question? → opt_out? → ambient_disabled? → implement? → multistep? → activate`

```javascript
// Priority order (first match wins):
const result = classifyPrompt(text, state);
// → { activate: false/true, reason: string, goal?: string }
```

**Configuration:** `PROMPT_MIN_LENGTH=8`, `GOAL_MAX_LENGTH=2000`, `CLASSIFICATION_MULTISTEP_MIN_LENGTH=120`

---

## Feature 2: Phase Chaining

On `subagentStop`, the phase engine looks up the completed subagent in `PHASE_CHAIN`:

```javascript
const PHASE_CHAIN = {
  "orchestra-planner":     { nextPhase: "implement", followup: "..." },
  "orchestra-implementer": { nextPhase: "verify",    followup: "..." },
  "orchestra-verifier":    { nextPhase: "review",    followup: "..." },
  "orchestra-reviewer":    { nextPhase: "done",      followup: null }
};
```

**FIX_REQUIRED Detection** — searches subagent output for `FIX_REQUIRED` or `VERIFY_FAIL` patterns. If found, sets phase back to "implement" and increments iteration. If `iteration >= max_iterations` (default 8), aborts.

**Loop limit:** 12 (safety guard in hooks.json).

---

## Feature 3: Context Injection

On `sessionStart`, extracts workspace roots from input JSON, checks for `context/` directory, builds injection block:

```
Six-File Context detected in this workspace:
1. context/project-overview.md — product definition ✓
2. context/architecture.md     — system structure ✓
...
```

Long-term memory is also injected (recent goals, frequent files, error patterns).

---

## Feature 4: Stall Detection

On every `stop` event, `orchestra-heartbeat.js`:
1. Updates `heartbeat.last_beat` timestamp
2. Checks if `elapsed > stall_threshold_ms` (default 300,000ms = 5 min)
3. First stall → emit nudge to re-launch subagent
4. Second stall → abort orchestration

```javascript
DEFAULT_STALL_THRESHOLD_MS = 300000;    // 5 minutes
STALL_ATTEMPTS_ABORT_THRESHOLD = 2;     // abort after 2 consecutive
```

---

## Feature 5: Memory System

**Short-term memory** (in `orchestra.json`, per-run):
- `phases_completed[]`, `files_changed[]`, `errors[]`, `decisions[]`, `context_summary`

**Long-term memory** (in `orchestra-memory.json`, persistent):
- `completed_goals[]` — max 100
- `recent_files[]` — max 50, tracks modification count
- `error_patterns[]` — max 50, tracks recurrence

**Flush:** On completion/abort/max-iterations, short-term is flushed to long-term via `flushShortToLong()`. Memory is injected at session start, orchestration start, and first implementer invocation.

**CLI:** `node ~/.cursor/hooks/orchestra-enable.js memory [clear]`

---

## Feature 6: Lifecycle Events

10 event types recorded in a 200-entry ring buffer:

| Event Type | Trigger | When |
|-----------|---------|------|
| `orchestra_start` | startOrchestra() | Orchestration begins |
| `orchestra_complete` | Phase chain → done | Successful completion |
| `phase_advance` | subagentStop | Phase transition |
| `phase_complete` | subagentStop | Phase finished |
| `fix_required` | Reviewer FIX_REQUIRED | Fix loop initiated |
| `max_iterations` | Iteration >= max | Loop aborted |
| `stall_detected` | Heartbeat > threshold | Phase stall |
| `stall_aborted` | 2nd consecutive stall | Aborted |
| `subagent_complete` | Lifecycle hook | Subagent finished |
| `subagent_error` | Status != completed | Subagent error |

Phase timers track `started_at`, `ended_at`, `duration_ms` for each phase.

---

## Feature 7: Crash Recovery

**Detection:** `detectCrashRecovery(state)` checks if heartbeat is stale (>10 min) or state is stale (>10 min). If `state.active && stale`, marks as crash recovery.

**Recovery:** User says "resume orchestra" → `resumeOrchestra(state)` restores from checkpoint → appropriate subagent launched.

**Checkpoint schema:**
```json
{
  "phase": "implement", "goal": "fix login bug",
  "iteration": 2, "last_subagent": "orchestra-implementer",
  "started_at": "...", "lifecycle_snapshot": [...20 events],
  "memory_snapshot": {...}, "timestamp": "..."
}
```

**CLI:** `pause [reason]`, `resume`, `checkpoint`, `abort [reason]`

---

## Feature 8-15: Quick Reference

| Feature | Key Detail |
|---------|-----------|
| **CLI Control** | 10 commands via COMMANDS map (plugin-like, OCP). `COMMANDS["status"]()` etc. |
| **Health Check** | 6 categories: scripts, hooks.json, state, memory, classification (6 samples), agents |
| **Stop Nudges** | Phase-specific nudges, capped at 3 per phase (`STOP_NUDGE_LOOP_LIMIT`=3) |
| **Git Workflow** | Only implementer commits (`<type>(<scope>): <desc>`). Verifier checks `git status --porcelain` |
| **Six-File Context** | 6 files read in fixed order. Missing files noted (○) but still works. Bootstrap via `init-context.sh` |
| **Project Bridge** | 35-line `bridge.js` delegates from project hooks to global via `spawnSync`. Enables cloud agents |
| **Install System** | Bash + PowerShell. Copies bundle, merges hooks.json (dedup by command), creates symlinks |
| **OpenCode Integration** | `mode: subagent` instead of `readonly: true`. Explicit permissions. Extra `setup/` skill |

---

# 7. Hooks API

## Hook Contract

```
stdin:  JSON object (Cursor passes event payload)
stdout: JSON object (returns additional_context / followup_message)
exit:   0 (always)
pattern: async main() → process → emit → .catch(() => emit({}))
```

## Hook Table

| Event | File | When | Timeout | Output |
|-------|------|------|---------|--------|
| `sessionStart` | `orchestra-session-start.js` | Session/workspace open | None | `additional_context` (context + memory) |
| `beforeSubmitPrompt` | `orchestra-prompt.js` | User submits prompt | 5s | `additional_context` (classification result) |
| `subagentStop` | `orchestra-subagent-stop.js` | Subagent completes | None | `followup_message` (next phase) |
| `subagentStop` | `orchestra-lifecycle.js` | (concurrent) | None | `{}` (records events) |
| `subagentStop` | `orchestra-memory.js` | (concurrent) | None | `additional_context` (memory, first implement only) |
| `stop` | `orchestra-stop.js` | Every message | None | `followup_message` (phase nudge, cap 3) |
| `stop` | `orchestra-heartbeat.js` | (concurrent) | None | `followup_message` (stall nudge or abort) |

## Hook Input Fields (from Cursor)

| Field | Type | Events |
|-------|------|--------|
| `prompt` | string | `beforeSubmitPrompt` |
| `status` | string | `subagentStop`, `stop` |
| `subagent_type` / `subagentType` | string | `subagentStop` |
| `workspace_roots` / `workspaceRoots` | string[] | `sessionStart`, `beforeSubmitPrompt` |
| `loop_count` | number | `stop` |
| `summary` / `result` / `output` / `final_text` | string | `subagentStop` |
| `error` / `error_message` | string | `subagentStop` |

## Hook Output Fields

| Field | Description |
|-------|-------------|
| `additional_context` | Text injected into agent's context window |
| `followup_message` | Text sent as user follow-up message |
| `{}` | Empty object when hook has nothing to contribute |

## hooks.json Registration

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [
      { "command": "node ./hooks/orchestra-session-start.js" }
    ],
    "beforeSubmitPrompt": [
      { "command": "node ./hooks/orchestra-prompt.js", "matcher": "UserPromptSubmit", "timeout": 5 }
    ],
    "subagentStop": [
      { "command": "node ./hooks/orchestra-subagent-stop.js", "matcher": "orchestra-planner|orchestra-implementer|orchestra-verifier|orchestra-reviewer", "loop_limit": 12 },
      { "command": "node ./hooks/orchestra-lifecycle.js", "matcher": "orchestra-planner|orchestra-implementer|orchestra-verifier|orchestra-reviewer", "loop_limit": 12 },
      { "command": "node ./hooks/orchestra-memory.js", "matcher": "orchestra-planner|orchestra-implementer|orchestra-verifier|orchestra-reviewer", "loop_limit": 12 }
    ],
    "stop": [
      { "command": "node ./hooks/orchestra-stop.js", "loop_limit": 5 },
      { "command": "node ./hooks/orchestra-heartbeat.js", "loop_limit": 5 }
    ]
  }
}
```

## Hook Execution Order per Subagent Cycle

```
sessionStart → context + memory
beforeSubmitPrompt → classification + auto-start
  └→ subagentStop (planner) + lifecycle + memory (concurrent)
      └→ subagentStop (implementer) + lifecycle + memory
          └→ subagentStop (verifier) + lifecycle + memory
              └→ subagentStop (reviewer) + lifecycle + memory → complete | FIX_REQUIRED
```

---

# 8. Component (Lib Module) Documentation

## Module Map

`bundle/hooks/lib/` contains 11 single-responsibility modules:

| Module | Lines | Responsibility | Exports |
|--------|-------|----------------|---------|
| `io.js` | 24 | stdin/stdout JSON | `readStdinJson()`, `emit(obj)` |
| `constants.js` | 41 | All numeric constants | 20 named constants (see below) |
| `state-manager.js` | 109 | State CRUD, deep merge | `loadState()`, `saveState()`, `startOrchestra()` |
| `prompt-classifier.js` | 93 | Prompt extraction + classification | `extractPrompt()`, `classifyPrompt()`, 5 RegExps |
| `phase-engine.js` | 53 | Phase chain + transitions | `PHASE_CHAIN`, `PHASE_AGENT_MAP`, `getAgentForPhase()`, `reviewerNeedsFix()` |
| `lifecycle-recorder.js` | 51 | Events + timers | `emitLifecycleEvent()`, `startPhaseTimer()`, `endPhaseTimer()` |
| `heartbeat-monitor.js` | 26 | Stall detection | `writeHeartbeat()`, `isStalled()`, `getStallDurationMs()` |
| `memory-manager.js` | 137 | Long-term memory CRUD | `loadLongTermMemory()`, `flushShortToLong()`, `buildMemoryContext()` |
| `history-recorder.js` | 56 | Run history | `recordOrchestrationRun()`, `loadOrchestrationHistory()` |
| `checkpoint-manager.js` | 108 | Pause/resume/crash recovery | `pauseOrchestra()`, `resumeOrchestra()`, `detectCrashRecovery()`, `abortOrchestra()` |
| `context-detector.js` | 104 | Six-file context detection | `detectContextInWorkspaces()`, `buildContextInjection()`, `AMBIENT_CONTEXT` |

## Constants Table (all 20)

| Constant | Value | Used By |
|----------|-------|---------|
| `LIFECYCLE_MAX_EVENTS` | 200 | lifecycle-recorder |
| `MEMORY_MAX_COMPLETED` | 100 | memory-manager |
| `MEMORY_MAX_RECENT_FILES` | 50 | memory-manager |
| `MEMORY_MAX_ERROR_PATTERNS` | 50 | memory-manager |
| `HISTORY_MAX_RUNS` | 50 | history-recorder |
| `PROMPT_MIN_LENGTH` | 8 | prompt-classifier |
| `GOAL_MAX_LENGTH` | 2000 | prompt-classifier |
| `CLASSIFICATION_MULTISTEP_MIN_LENGTH` | 120 | prompt-classifier |
| `DEFAULT_MAX_ITERATIONS` | 8 | state-manager |
| `DEFAULT_STALL_THRESHOLD_MS` | 300000 (5 min) | heartbeat-monitor |
| `DEFAULT_HEARTBEAT_INTERVAL_MS` | 60000 (1 min) | state-manager |
| `DEFAULT_STALE_THRESHOLD_MS` | 600000 (10 min) | checkpoint-manager |
| `CRASH_RECOVERY_THRESHOLD_MS` | 600000 (10 min) | checkpoint-manager |
| `RECENT_GOALS_DISPLAY_COUNT` | 5 | memory-manager |
| `TOP_FILES_DISPLAY_COUNT` | 5 | memory-manager |
| `TOP_ERRORS_DISPLAY_COUNT` | 3 | memory-manager |
| `STALL_ATTEMPTS_ABORT_THRESHOLD` | 2 | heartbeat-monitor |
| `STOP_NUDGE_LOOP_LIMIT` | 3 | orchestra-stop.js |

## Key Module Details

### `state-manager.js` — Deep Merge Defaults

```javascript
function loadState() {
  const raw = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  const merged = { ...DEFAULT_STATE, ...raw };
  merged.lifecycle = { ...DEFAULT_STATE.lifecycle, ...merged.lifecycle };
  merged.heartbeat = { ...DEFAULT_STATE.heartbeat, ...merged.heartbeat };
  merged.memory = { ...DEFAULT_STATE.memory, ...merged.memory };
  merged.resumable = { ...DEFAULT_STATE.resumable, ...merged.resumable };
  merged.version = 2;
  return merged;
}
```

Ensures V1→V2 backward compatibility. Missing fields get defaults without migration scripts.

### `checkpoint-manager.js` — Crash Recovery

```javascript
function detectCrashRecovery(state) {
  if (!state.active) return null;
  const lastBeat = state.heartbeat?.last_beat;
  if (lastBeat && Date.now() - new Date(lastBeat).getTime() > CRASH_RECOVERY_THRESHOLD_MS)
    return { phase, goal, iteration, last_activity: lastBeat };
  if (isStaleState(state)) return crashInfo;
  return null;
}
```

### `context-detector.js` — Six-File Context

Detects `context/` directory in workspace roots. Injects file list and read order:

```
Six-File Context detected in this workspace:
Entry point: `AGENTS.md` at project root.
Read in order:
1. context/project-overview.md — product definition ✓
2. context/architecture.md — system structure ✓
...
```

### `prompt-classifier.js` — Classification Algorithm

```javascript
IMPLEMENT_RE = /\b(add|implement|build|create|fix|refactor|update|deploy|install|setup|configure|migrate|integrate|wire|hook up|write tests|add tests|ship|continue|finish|complete|resolve|debug|patch|scaffold|generate|make it work|get it working|push to|commit)\b/i;
```

---

# 9. Agent Documentation

## Agent Overview

4 specialized subagents execute in sequence:

| Agent | Phase | Readonly | End Marker | Token Budget |
|-------|-------|----------|------------|--------------|
| `orchestra-planner` | 1 — Plan | ✅ | `PLAN_READY` | 10,000 |
| `orchestra-implementer` | 2 — Implement | ❌ | `IMPLEMENT_DONE` | 30,000 |
| `orchestra-verifier` | 3 — Verify | ✅ | `VERIFY_PASS` / `VERIFY_FAIL` | 15,000 |
| `orchestra-reviewer` | 4 — Review | ✅ | `ORCHESTRA_COMPLETE` / `FIX_REQUIRED` | 8,000 |

**Cursor agents** use `readonly: true` frontmatter. **OpenCode agents** use `mode: subagent` + `permission: { edit: deny, bash: allow }` (readonly phases still deny edit; bash allow avoids inspection prompts).

## Agent: orchestra-planner

**Workflow:**
1. Read project context (6 files in order) + long-term memory
2. Read user goal from parent message
3. Search codebase only as needed — no implementation
4. Output structured plan (goal, context alignment, approach, files, git strategy, risks, done-when)
5. Limit: under 100 lines (Cursor) / 80 lines (OpenCode)
6. End with `PLAN_READY`

**Self-review checklist:** Goal clear? Files exist? Approach maps to files? Done-when testable? Invariants safe? Plan under limit?

**Error-free rules:** Don't list unverified files. Don't assume API/patterns without checking. Don't include "nice to have". Document unknowns in risks.

## Agent: orchestra-implementer

**Workflow:**
1. Re-read `code-standards.md` and `architecture.md`
2. Implement only what the plan specifies — no scope creep
3. Match existing project conventions (read surrounding files)
4. Run quick validation (syntax, targeted tests)
5. **Commit changes** after ALL implementation — only committer in the chain
6. Output: Implemented list, files changed, validation results, commit status/SHA, notes for verifier
7. End with `IMPLEMENT_DONE`

**Git workflow:**
```bash
git status                    # verify only intended files
git diff                      # review all changes
git add <files>               # stage only plan files
git commit -m "<type>(<scope>): <description>"
git log --oneline -1          # confirm
```

**Zero-tolerance rules:** Syntax errors, debug code, secrets, scope creep.

## Agent: orchestra-verifier

**Core principle:** "Tests must pass before VERIFY_PASS. No exceptions."

**Checklist (run in order):**
1. Lint — project linter
2. Typecheck — `tsc --noEmit`
3. Unit tests — project test runner
4. Build — `npm run build`
5. Git clean — `git status --porcelain`
6. Diff review — `git diff --stat`
7. Import check — unused imports or missing deps

**Convergence criteria:** Tests pass → lint clean → typecheck pass → git clean.

**Stall detection (in agent):** Identical failures 2x → suggest different strategy. 3rd → recommend abort.

## Agent: orchestra-reviewer

**Core principle:** "If in doubt, FIX_REQUIRED. Don't approve risky changes."

**Quality gates (must pass all):**
- [ ] Implementation matches plan (no scope creep)
- [ ] No architecture invariants violated
- [ ] Code follows project conventions
- [ ] Tests exist and pass (verifier confirmed)
- [ ] No security issues (secrets, injection, auth bypass)
- [ ] Documentation updated if public API changed
- [ ] progress-tracker.md reflects completed work

**Human checkpoint triggers:** Auth/payments/security/scope-creep/budget-exhaustion/3rd consecutive FIX_REQUIRED.

**Output includes:** Critical findings (file:line), suggestions, context drift, git review, lessons for long-term memory.

## Agent Orchestration Flow

```mermaid
sequenceDiagram
    participant User
    participant Parent as Parent Agent
    participant Planner as orchestra-planner
    participant Impl as orchestra-implementer
    participant Ver as orchestra-verifier
    participant Rev as orchestra-reviewer

    User->>Parent: fix login bug
    Parent->>Planner: Task(orchestra-planner, "fix login bug")
    Planner->>Planner: read context, research
    Planner-->>Parent: PLAN_READY
    Parent->>Impl: Task(orchestra-implementer, plan)
    Impl->>Impl: implement, validate, commit
    Impl-->>Parent: IMPLEMENT_DONE
    Parent->>Ver: Task(orchestra-verifier, changes)
    Ver->>Ver: lint, test, typecheck, diff
    alt VERIFY_PASS
        Ver-->>Parent: VERIFY_PASS
        Parent->>Rev: Task(orchestra-reviewer, diff)
        Rev->>Rev: security, scope, docs
        alt ORCHESTRA_COMPLETE
            Rev-->>Parent: ORCHESTRA_COMPLETE
        else FIX_REQUIRED
            Rev-->>Parent: FIX_REQUIRED + fixes
            Parent->>Impl: re-run implementer
        end
    else VERIFY_FAIL
        Ver-->>Parent: VERIFY_FAIL + blockers
        Parent->>Impl: re-run implementer
    end
```

---
name: orchestra-loop
description: >-
  Ambient multi-agent orchestra for OpenCode — auto plan → implement → verify →
  review on build/fix/refactor prompts. Use when coding, implementing features,
  fixing bugs, deploying, or when user mentions orchestra, agent loop, or
  multi-step implementation. Triggers on: add, fix, build, create, refactor,
  deploy, install, setup, configure, migrate, integrate, debug, continue, ship.
  Skip for: explain, what is, how does, hi/thanks.
---

# Orchestra Loop (ambient, OpenCode)

Runs on **this machine** via `~/.config/opencode/`. The orchestra loop automatically chains: **plan → implement → verify → review** using dedicated subagents.

## How it works

When the user asks to **add, fix, build, refactor, deploy, install, configure, migrate, integrate, debug, continue, or finish** something:

### Loop contract (define before starting)
Before launching agents, establish:
- **Goal**: what success looks like (testable)
- **Scope**: files/routes in scope, what must NOT change
- **Verifier**: which tests/checks prove completion
- **Budget**: max iterations (default: 8), max tokens (default: 50k), max time (default: 30min)
- **Escalation**: when to pause for human (high-risk changes, budget exhaustion)

### Execution loop
1. Read the goal and launch **orchestra-planner** (Task tool).
2. Planner returns a structured plan.
3. Launch **orchestra-implementer** with the plan.
4. Implementer returns changes + validation.
5. Launch **orchestra-verifier** to run checks.
6. Verifier returns VERIFY_PASS or VERIFY_FAIL.
7. Launch **orchestra-reviewer** for final gate.
8. Reviewer returns ORCHESTRA_COMPLETE or FIX_REQUIRED.

### Convergence criteria (exit conditions)
The loop converges when ANY of these are true:
- **Tests pass**: all relevant tests pass (strongest signal)
- **Diff is empty**: no changes in last iteration (fixed-point)
- **Lint clean**: zero lint errors (count-defined)
- **Judge passes**: reviewer approves (weakest, use last)

### Stall detection
If verifier fails with **identical feedback** 2 iterations in a row:
1. Log the stall
2. Try a different strategy (fresh context, alternative approach)
3. If stall persists, abort and escalate to human

### Human checkpoints (required for)
- High-risk changes (production config, auth, payments)
- Budget exhaustion (max iterations/tokens/time hit)
- Unresolvable failures (3 consecutive FAIL with same error)
- Scope creep detected (agent touching out-of-scope files)

**Skipped for:** explain-only questions, "what is/how does", "no orchestra", trivial hi/thanks.

## Phases

| # | Subagent | Role | Git workflow |
|---|----------|------|-------------|
| 1 | `orchestra-planner` | Plan only (`edit: deny`) | No commit — plan is output text |
| 2 | `orchestra-implementer` | Minimal implementation | **Commits all changes** with `<type>(<scope>): <desc>` |
| 3 | `orchestra-verifier` | Tests / lint / smoke | No commit — checks only, verifies clean tree |
| 4 | `orchestra-reviewer` | Final gate (`edit: deny`) | No commit — reviews diff, suggests final message |

`FIX_REQUIRED` or `VERIFY_FAIL` → re-run **orchestra-implementer** with the numbered fixes, then continue verify → review.

## Git commit convention

All commits follow: `<type>(<scope>): <description>`

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`

- **Planner** includes commit strategy in the plan
- **Implementer** commits after ALL changes (not mid-implementation)
- **Verifier** checks `git status --porcelain` for clean tree
- **Reviewer** reviews commit messages and suggests final commit if ORCHESTRA_COMPLETE

## Self-review & error-free rules

Each subagent has a self-review checklist and error-free rules:

| Subagent | Key self-review | Error-free rule |
|----------|----------------|-----------------|
| Planner | Goal clear, files exist, done-when testable | No assumptions about undocumented behavior |
| Implementer | All plan items done, no scope creep, committed | Zero tolerance: syntax, debug code, secrets |
| Verifier | All checks run, git clean, verdict clear | Never skip, never assume PASS, never fix code |
| Reviewer | Read actual diff, findings are file:line, verdict matches | Never approve if tests fail or secrets in code |

## State tracking

Read/write `~/.config/opencode/state/orchestra.json` to track the active orchestration (V2 schema):

```json
{
  "version": 2,
  "active": false,
  "goal": "",
  "phase": "idle",
  "iteration": 0,
  "max_iterations": 8,
  "lifecycle": { "events": [], "phase_history": [] },
  "heartbeat": { "last_beat": null, "phase_started_at": null, "stall_threshold_ms": 300000 },
  "memory": { "phases_completed": [], "files_changed": [], "errors": [], "decisions": [] },
  "resumable": { "paused": false, "checkpoint": null }
}
```

Update state at each phase transition:
- On start: `active=true`, `goal=<user goal>`, `phase="plan"`, `iteration=0`
- On each phase complete: update `phase` to next (plan → implement → verify → review)
- On FIX_REQUIRED: `phase="implement"`, increment `iteration`
- On ORCHESTRA_COMPLETE or max iterations: `active=false`, `phase="idle"`

## User commands

| Command | Action |
|---------|--------|
| *(normal coding prompt)* | Auto-orchestrate if implement/fix/build |
| `/orchestra <goal>` | Force start |
| `no orchestra` | Skip for this prompt |
| `disable orchestra` | Skip orchestra for this session |

## Parent agent rules

- Use Task with **`orchestra-*` names** — agent definitions require exact names.
- Do not nest orchestra inside orchestra.
- After `ORCHESTRA_COMPLETE`, summarize deliverables for the user.
- **Do not modify files between phases** — let subagents handle their own work.
- **Do not commit between phases** — implementer commits, others are read-only.
- Read AGENTS.md and context/ files for project knowledge before planning.
- After completion, reset state to idle.

## Model routing & token optimization

Orchestra runs 4 subagents per cycle. Each subagent re-sends system prompt + context, so a single cycle consumes 4-10x tokens of a direct prompt. Optimize with phase-specific models and token-efficient behavior.

### Token budgets per agent
| Agent | Max tokens | Max output | Context limit |
|-------|------------|------------|---------------|
| Planner | 10,000 | 50 lines | 3-5 files |
| Implementer | 30,000 | 100 lines | modified files only |
| Verifier | 15,000 | 30 lines | diff + test output |
| Reviewer | 8,000 | 30 lines | diff + verifier report |

**Total per cycle:** ~63k tokens max (vs unlimited before)

### Phase-specific model routing
- Planner + Verifier + Reviewer: use budget model (deepseek-v4-flash, $0.14/$0.28 per 1M)
- Implementer: use capable model (kimi-k2.5 $0.60/$3.00 or claude-sonnet-5 $2/$10 per 1M)
- This cuts cost per cycle from ~$0.15-0.40 to ~$0.03-0.11

### Agent step limits
Each agent has a max steps budget (planner: 8, implementer: 25, verifier: 10, reviewer: 5). Prevents runaway loops.

### Compaction
Enable `compaction.prune: true` in opencode.json to remove old tool outputs from context automatically. Saves 30-50% tokens in long sessions.

### Setup optimized config
```bash
bash scripts/setup-opencode-optimal.sh --balanced   # recommended
bash scripts/setup-opencode-optimal.sh --budget     # free models only
bash scripts/setup-opencode-optimal.sh --premium    # best quality
```

### Token-efficient behavior for each phase
- **Planner**: read only 3-5 relevant files, use grep over reading whole files, plan under 50 lines
- **Implementer**: read files you modify only, run syntax before full builds, one edit per thought
- **Verifier**: run cheapest checks first (syntax → type → targeted test → lint → full suite)
- **Reviewer**: read-only (git diff + verifier report), output under 30 lines, no bash execution

### Cost tracking (recommended)
After each cycle, log:
- Tokens consumed per phase
- Estimated cost based on model pricing
- Total cycle cost

### Free tier (Zen)
Use `north-mini-code-free` or `minimax-m2.5-free` for planner/verifier only. Set up with `bash scripts/setup-opencode-proxy.sh --free`.

### Multi-key rotation
Pool multiple API keys with automatic failover using `opencode-go-multi-auth`. Bypasses per-key rate limits. See `docs/bypass-strategies.md`.

## Opt out

Say **"no orchestra"** to skip. Pure Q&A never triggers the chain.

## Heartbeat & stall detection

Heartbeat timestamps written on every hook execution. Stall detection at 5min threshold, auto-abort after 2 stalls.

## Memory

- **Short-term**: During each run (phases, files, errors, decisions)
- **Long-term**: Persistent `~/.config/opencode/state/orchestra-memory.json`. Planner reads past goals; reviewer writes lessons.

## Resumable tasks

- **Crash recovery**: Session start detects stale state, offers resume
- **Manual pause/resume**: `pause [reason]` / `resume` commands
- **Checkpoint**: Save state without pausing

## Lifecycle events

Every phase transition recorded. Last 200 events retained. Phase durations tracked.

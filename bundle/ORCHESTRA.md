# Global Orchestra Loop (ambient)

Machine-wide agent orchestration — **runs automatically** in both **Cursor IDE** and **OpenCode CLI**. No `/orchestra` required.

## How it works

### Cursor IDE (hooks-driven)

```
You: "fix the signal bot import error"
        ↓
beforeSubmitPrompt hook → auto-starts orchestra
        ↓
Agent → orchestra-planner → implementer → verifier → reviewer
        ↓
hooks chain each phase (subagentStop)
```

### OpenCode CLI (skill-driven)

```
You: "fix the signal bot import error"
        ↓
orchestra-loop skill → classifies as implement prompt
        ↓
Main agent → orchestra-planner → implementer → verifier → reviewer
        ↓
Task tool chains each phase
```

## What triggers auto-orchestration

**Yes:** add, fix, build, create, refactor, deploy, install, setup, configure, migrate, integrate, debug, continue, write tests, ship…

**No:** explain, what is, how does, summarize, hi/thanks, "no orchestra", "just explain"

## Quick commands

| Say / run | Effect |
|-----------|--------|
| *(just code normally)* | Orchestra when appropriate |
| `no orchestra` | Skip for one prompt |
| `disable orchestra` | Turn ambient off |
| `enable orchestra` | Turn ambient on |
| `/orchestra stop` | Stop active loop (Cursor) |
| `/orchestra <goal>` | Force start |
| `pause orchestra` | Pause and save checkpoint |
| `resume orchestra` | Resume from checkpoint |
| `abort orchestra` | Abort and save checkpoint |

### Cursor CLI

```bash
node ~/.cursor/hooks/orchestra-enable.js status
node ~/.cursor/hooks/orchestra-enable.js ambient-off
node ~/.cursor/hooks/orchestra-enable.js ambient-on
node ~/.cursor/hooks/orchestra-enable.js stop
```

### Health check

```bash
# Cursor
node ~/.cursor/hooks/orchestra-health.js

# OpenCode
node ~/.config/opencode/hooks/orchestra-health-opencode.js
```

## Files

### Cursor

| Path | Role |
|------|------|
| `~/.cursor/hooks.json` | sessionStart + **beforeSubmitPrompt** + subagentStop + stop |
| `~/.cursor/hooks/orchestra-prompt.js` | Auto-detect implement prompts |
| `~/.cursor/hooks/state/orchestra.json` | `ambient: true` by default |
| `~/.cursor/agents/orchestra-*.md` | 4 subagents (proactive descriptions) |
| `~/.cursor/rules/orchestra-loop.mdc` | Always-on agent instructions |
| `~/.cursor/skills/orchestra-loop/` | Full skill reference |

### OpenCode

| Path | Role |
|------|------|
| `~/.config/opencode/agents/orchestra-*.md` | 4 subagents (`mode: subagent`) |
| `~/.config/opencode/skills/orchestra-loop/SKILL.md` | Orchestration skill |
| `~/.config/opencode/state/orchestra.json` | Shared state (same as Cursor) |
| `~/.config/opencode/hooks/orchestra-health-opencode.js` | Health check |
| `~/.agents/skills/orchestra-loop` | Symlink for external discovery |

## After update

**Restart Cursor** so hooks load (global + project).
**Restart OpenCode** so agents and skill reload.

```bash
# Cursor
node ~/.cursor/hooks/orchestra-health.js

# OpenCode
node ~/.config/opencode/hooks/orchestra-health-opencode.js
```

## Project bridge

The project bridge (`.cursor/hooks.json` → `bridge.js`) delegates to global `~/.cursor/hooks/`. Same ambient orchestra when the project is open (also helps cloud agents that load **project** hooks).

Install with: `bash install.sh --project`

## Heartbeat

Orchestra monitors orchestration health via heartbeat timestamps written to state on every hook execution. If a phase runs longer than 5 minutes (configurable via `heartbeat.stall_threshold_ms`), the heartbeat system detects the stall and emits recovery nudges. After 2 stall detections, orchestration aborts automatically.

External tools can check if orchestra is alive by reading `state.orchestra.json` and checking `heartbeat.last_beat`.

## Memory

### Short-term memory
During each orchestration run, Orchestra tracks:
- Phases completed and their outcomes
- Files changed by the implementer
- Errors encountered
- Decisions made

This context is available to subagents during the run and injected into follow-up messages.

### Long-term memory
On completion, short-term memory is flushed to `~/.cursor/hooks/state/orchestra-memory.json`. This persists across sessions:
- Completed goals with outcomes and duration (last 100)
- Frequently modified files (top 50)
- Recurring error patterns (last 50)

The planner reads long-term memory to avoid repeating past mistakes. The reviewer writes lessons learned.

```bash
# View long-term memory
node ~/.cursor/hooks/orchestra-enable.js memory

# Clear long-term memory
node ~/.cursor/hooks/orchestra-enable.js memory clear
```

## Resumable Tasks

### Crash recovery
If Cursor restarts mid-orchestration, `sessionStart` detects the stale active state and offers to resume from the last phase. Say **"resume orchestra"** or **"continue orchestra"** to pick up where you left off. Say **"stop orchestra"** to discard.

### Manual pause/resume
```bash
# Pause and save checkpoint
node ~/.cursor/hooks/orchestra-enable.js pause "reason"

# Resume from checkpoint
node ~/.cursor/hooks/orchestra-enable.js resume
```

Or say **"pause orchestra"** / **"resume orchestra"** in chat.

### Checkpoint
Save a checkpoint without pausing:
```bash
node ~/.cursor/hooks/orchestra-enable.js checkpoint
```

## Lifecycle Events

Every phase transition, subagent completion, error, and fix-required event is recorded to `state.orchestra.json` under `lifecycle.events`. The last 200 events are retained. Phase history with durations is tracked under `lifecycle.phase_history`.

## Full CLI Reference

```bash
node ~/.cursor/hooks/orchestra-enable.js status          # Show state + memory summary
node ~/.cursor/hooks/orchestra-enable.js start "goal"    # Manual start
node ~/.cursor/hooks/orchestra-enable.js stop            # Stop active loop
node ~/.cursor/hooks/orchestra-enable.js pause [reason]  # Pause with checkpoint
node ~/.cursor/hooks/orchestra-enable.js resume          # Resume from checkpoint
node ~/.cursor/hooks/orchestra-enable.js abort [reason]  # Abort with checkpoint
node ~/.cursor/hooks/orchestra-enable.js checkpoint      # Save checkpoint (no pause)
node ~/.cursor/hooks/orchestra-enable.js ambient-on      # Enable ambient mode
node ~/.cursor/hooks/orchestra-enable.js ambient-off     # Disable ambient mode
node ~/.cursor/hooks/orchestra-enable.js memory          # Show long-term memory
node ~/.cursor/hooks/orchestra-enable.js memory clear    # Clear long-term memory
node ~/.cursor/hooks/orchestra-enable.js history         # Show orchestration history
```

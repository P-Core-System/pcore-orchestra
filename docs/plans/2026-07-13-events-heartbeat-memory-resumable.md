# Events, Heartbeat, Memory & Resumable Tasks — Implementation Plan

> **For agentic workers:** Use subagent-driven-development or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Cursor Orchestra with lifecycle events, heartbeat monitoring, short/long-term memory, and resumable tasks — making the orchestration loop observable, resilient, and context-aware across sessions.

**Architecture:** The four systems share a common foundation: an extended state model (version 2) in `orchestra.json` and a new persistent memory file `orchestra-memory.json`. Lifecycle events are recorded to state by hook scripts on every phase transition. Heartbeat timestamps are written on every hook execution and checked for staleness on the `stop` event. Short-term memory accumulates during one orchestration run (phases, files, errors, decisions) and is flushed to long-term memory on completion. Resumable tasks serialize the full orchestration state so a new session can detect crash recovery or manual pause and continue from the last saved phase.

**Tech Stack:** Node.js 18+ (CommonJS), JSON state files, Cursor hooks API (sessionStart, beforeSubmitPrompt, subagentStop, stop).

---

## File Structure

### New files
| File | Responsibility |
|------|---------------|
| `bundle/hooks/orchestra-heartbeat.js` | Heartbeat monitor — runs on `stop` event, detects stalls, writes alive signal |
| `bundle/hooks/orchestra-memory.js` | Memory manager — read/write short-term and long-term memory, flush on completion |
| `bundle/hooks/orchestra-lifecycle.js` | Lifecycle logger — runs on `subagentStop`, records phase events to state |

### Modified files
| File | Changes |
|------|---------|
| `bundle/hooks/orchestra-lib.js` | V2 state model, memory helpers, lifecycle event helpers, heartbeat helpers, pause/resume |
| `bundle/hooks/orchestra-subagent-stop.js` | Integrate memory writes, lifecycle events, heartbeat on phase advance |
| `bundle/hooks/orchestra-prompt.js` | Fix ambient re-enable bug, read long-term memory for context injection |
| `bundle/hooks/orchestra-session-start.js` | Crash recovery detection, memory context injection |
| `bundle/hooks/orchestra-stop.js` | Heartbeat check, stall detection, nudge with memory context |
| `bundle/hooks/orchestra-enable.js` | Pause/resume commands, memory status, memory clear |
| `bundle/hooks/orchestra-health.js` | New checks for heartbeat, memory, lifecycle |
| `bundle/hooks.json` | New hook entries for heartbeat, memory, lifecycle scripts |
| `bundle/hooks/state/orchestra.json` | Updated default state (version 2) |
| `bundle/hooks/state/orchestra-memory.json` | **New** — default empty long-term memory |
| `bundle/agents/orchestra-planner.md` | Read long-term memory before planning |
| `bundle/agents/orchestra-implementer.md` | Write to short-term memory (files changed, decisions) |
| `bundle/agents/orchestra-verifier.md` | Write to short-term memory (check results) |
| `bundle/agents/orchestra-reviewer.md` | Write to long-term memory (lessons learned) on completion |
| `bundle/ORCHESTRA.md` | Document new features |
| `bundle/skills/orchestra-loop/SKILL.md` | Updated skill docs |
| `bundle/opencode/skills/orchestra-loop/SKILL.md` | Updated skill docs |
| `bundle/opencode/state/orchestra.json` | Updated default state |
| `context/architecture.md` | Updated architecture doc |
| `context/progress-tracker.md` | Updated progress |

---

## Task 1: Fix Existing Bugs

**Files:**
- Modify: `bundle/hooks/orchestra-prompt.js:35-37`
- Modify: `bundle/opencode/state/orchestra.json`

### Step 1: Fix ambient re-enable not persisting state

In `bundle/hooks/orchestra-prompt.js`, line 35-37, when the user says "enable orchestra" / "orchestra on", `saveState(state)` is missing:

```javascript
// CURRENT (buggy):
if (/\b(enable orchestra|orchestra on|ambient on)\b/i.test(prompt)) {
  state.ambient = true;
  saveState(state);
}
```

This is actually already correct in the current file. Let me re-read...

Actually, looking at the code again at lines 35-38:
```javascript
if (/\b(enable orchestra|orchestra on|ambient on)\b/i.test(prompt)) {
  state.ambient = true;
  saveState(state);
}
```

Wait, `saveState(state)` IS called on line 37. Let me re-check the exploration report... The report says line 35 "does NOT call `saveState(state)`" but looking at the actual code, line 37 is `saveState(state)`. So this bug was already fixed or the report was wrong.

Let me verify by reading the file again. Actually I already read it - line 37 is `saveState(state)`. The exploration report was incorrect about this bug. Skip this fix.

### Step 2: Add `ambient` field to OpenCode state

- [ ] Edit `bundle/opencode/state/orchestra.json` to add `ambient: true`:

```json
{
  "version": 1,
  "ambient": true,
  "active": false,
  "goal": "",
  "phase": "idle",
  "iteration": 0,
  "max_iterations": 8,
  "started_at": null,
  "last_subagent": null
}
```

### Step 3: Update progress-tracker path

- [ ] Edit `context/progress-tracker.md` — replace Windows path `D:\Learning Web Development\cursor-orchestra` with note about current environment.

---

## Task 2: Extended State Model (Version 2)

**Files:**
- Modify: `bundle/hooks/orchestra-lib.js` — DEFAULT_STATE, loadState migration
- Modify: `bundle/hooks/state/orchestra.json` — default state file
- Modify: `bundle/opencode/state/orchestra.json` — default state file

### Step 1: Define V2 state schema in orchestra-lib.js

- [ ] Replace the `DEFAULT_STATE` object in `bundle/hooks/orchestra-lib.js` with:

```javascript
const DEFAULT_STATE = {
  version: 2,
  ambient: true,
  active: false,
  goal: "",
  phase: "idle",
  started_at: null,
  last_subagent: null,
  iteration: 0,
  max_iterations: 8,
  last_prompt: null,
  auto_started: null,

  // Lifecycle events
  lifecycle: {
    events: [],          // [{type, phase, timestamp, data}]
    phase_history: [],   // [{phase, started_at, ended_at, subagent, status, duration_ms}]
  },

  // Heartbeat
  heartbeat: {
    last_beat: null,                // ISO timestamp of last hook execution
    phase_started_at: null,         // ISO timestamp when current phase started
    stall_threshold_ms: 300000,     // 5 minutes — considered stalled
    interval_ms: 60000,             // 1 minute — expected beat interval
  },

  // Short-term memory (cleared on orchestration complete/reset)
  memory: {
    phases_completed: [],  // [{phase, subagent, duration_ms, status, timestamp}]
    files_changed: [],     // ["path/to/file.js", ...]
    errors: [],            // [{phase, error, timestamp}]
    decisions: [],         // [{phase, decision, rationale, timestamp}]
    context_summary: "",   // key facts from six-file context at start
  },

  // Resumable state
  resumable: {
    paused: false,
    paused_at: null,
    pause_reason: null,
    checkpoint: null,      // serialized snapshot for crash recovery
    last_save: null,       // ISO timestamp of last checkpoint save
  },
};
```

### Step 2: Add V1 → V2 migration in loadState

- [ ] Update `loadState()` in `bundle/hooks/orchestra-lib.js` to migrate V1 states:

```javascript
function loadState() {
  try {
    if (!fs.existsSync(STATE_PATH)) return { ...DEFAULT_STATE };
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
    const merged = { ...DEFAULT_STATE, ...raw };
    // Migrate V1 → V2
    if (!merged.lifecycle) merged.lifecycle = { events: [], phase_history: [] };
    if (!merged.heartbeat) merged.heartbeat = { ...DEFAULT_STATE.heartbeat };
    if (!merged.memory) merged.memory = { ...DEFAULT_STATE.memory };
    if (!merged.resumable) merged.resumable = { ...DEFAULT_STATE.resumable };
    merged.version = 2;
    return merged;
  } catch {
    return { ...DEFAULT_STATE };
  }
}
```

### Step 3: Update default state files

- [ ] Write `bundle/hooks/state/orchestra.json` with version 2 schema:

```json
{
  "version": 2,
  "ambient": true,
  "active": false,
  "goal": "",
  "phase": "idle",
  "started_at": null,
  "last_subagent": null,
  "iteration": 0,
  "max_iterations": 8,
  "last_prompt": null,
  "auto_started": null,
  "lifecycle": { "events": [], "phase_history": [] },
  "heartbeat": {
    "last_beat": null,
    "phase_started_at": null,
    "stall_threshold_ms": 300000,
    "interval_ms": 60000
  },
  "memory": {
    "phases_completed": [],
    "files_changed": [],
    "errors": [],
    "decisions": [],
    "context_summary": ""
  },
  "resumable": {
    "paused": false,
    "paused_at": null,
    "pause_reason": null,
    "checkpoint": null,
    "last_save": null
  }
}
```

- [ ] Write same to `bundle/opencode/state/orchestra.json`.

---

## Task 3: Lifecycle Events System

**Files:**
- Modify: `bundle/hooks/orchestra-lib.js` — add lifecycle helpers
- Create: `bundle/hooks/orchestra-lifecycle.js` — lifecycle logger hook
- Modify: `bundle/hooks/orchestra-subagent-stop.js` — emit lifecycle events
- Modify: `bundle/hooks.json` — register new hook

### Step 1: Add lifecycle helpers to orchestra-lib.js

- [ ] Add these functions to `bundle/hooks/orchestra-lib.js` before the `module.exports`:

```javascript
// ── Lifecycle Events ────────────────────────────────────────────────
const LIFECYCLE_MAX_EVENTS = 200;

function emitLifecycleEvent(state, type, phase, data) {
  if (!state.lifecycle) state.lifecycle = { events: [], phase_history: [] };
  const event = { type, phase, timestamp: new Date().toISOString(), data: data || null };
  state.lifecycle.events.push(event);
  // Trim to keep bounded
  if (state.lifecycle.events.length > LIFECYCLE_MAX_EVENTS) {
    state.lifecycle.events = state.lifecycle.events.slice(-LIFECYCLE_MAX_EVENTS);
  }
}

function startPhaseTimer(state, phase, subagent) {
  state.heartbeat.phase_started_at = new Date().toISOString();
  if (!state.lifecycle) state.lifecycle = { events: [], phase_history: [] };
  state.lifecycle.phase_history.push({
    phase,
    started_at: state.heartbeat.phase_started_at,
    ended_at: null,
    subagent,
    status: "running",
    duration_ms: null,
  });
}

function endPhaseTimer(state, status) {
  const history = state.lifecycle?.phase_history;
  if (!history || history.length === 0) return;
  const current = history[history.length - 1];
  if (current.status !== "running") return;
  const ended = new Date().toISOString();
  current.ended_at = ended;
  current.status = status || "completed";
  current.duration_ms = new Date(ended) - new Date(current.started_at);
  state.heartbeat.phase_started_at = null;
}

function getPhaseElapsedMs(state) {
  if (!state.heartbeat?.phase_started_at) return 0;
  return Date.now() - new Date(state.heartbeat.phase_started_at).getTime();
}
```

- [ ] Export these new functions in `module.exports`:

```javascript
module.exports = {
  // ... existing exports ...
  emitLifecycleEvent,
  startPhaseTimer,
  endPhaseTimer,
  getPhaseElapsedMs,
};
```

### Step 2: Create orchestra-lifecycle.js

- [ ] Create `bundle/hooks/orchestra-lifecycle.js`:

```javascript
#!/usr/bin/env node
"use strict";

const {
  loadState,
  saveState,
  readStdinJson,
  emit,
  emitLifecycleEvent,
} = require("./orchestra-lib.js");

/**
 * Lifecycle logger — runs on subagentStop alongside the phase-chain hook.
 * Records phase completion events to state for observability.
 */
async function main() {
  const input = await readStdinJson();
  const status = input.status || "";
  const subagentType = input.subagent_type || input.subagentType || "";

  const state = loadState();
  if (!state.active) {
    emit({});
    return;
  }

  // Record the subagent completion event
  emitLifecycleEvent(state, "subagent_complete", state.phase, {
    subagent: subagentType,
    status,
    iteration: state.iteration,
  });

  // Record errors
  if (status !== "completed") {
    emitLifecycleEvent(state, "subagent_error", state.phase, {
      subagent: subagentType,
      status,
      error: input.error || input.error_message || null,
    });
    if (!state.memory) state.memory = { phases_completed: [], files_changed: [], errors: [], decisions: [], context_summary: "" };
    state.memory.errors.push({
      phase: state.phase,
      error: `Subagent ${subagentType} exited with status: ${status}`,
      timestamp: new Date().toISOString(),
    });
  }

  // Record phase completion in short-term memory
  if (status === "completed") {
    if (!state.memory) state.memory = { phases_completed: [], files_changed: [], errors: [], decisions: [], context_summary: "" };
    state.memory.phases_completed.push({
      phase: state.phase,
      subagent: subagentType,
      timestamp: new Date().toISOString(),
    });
  }

  // Write heartbeat beat
  state.heartbeat.last_beat = new Date().toISOString();

  saveState(state);
  emit({});
}

main().catch(() => {
  emit({});
});
```

### Step 3: Integrate lifecycle into orchestra-subagent-stop.js

- [ ] Update `bundle/hooks/orchestra-subagent-stop.js` to use lifecycle helpers:

```javascript
#!/usr/bin/env node
"use strict";

const {
  loadState,
  saveState,
  readStdinJson,
  emit,
  PHASE_CHAIN,
  reviewerNeedsFix,
  emitLifecycleEvent,
  endPhaseTimer,
  startPhaseTimer,
} = require("./orchestra-lib.js");

async function main() {
  const input = await readStdinJson();
  const status = input.status || "";
  const subagentType = input.subagent_type || input.subagentType || "";

  if (status !== "completed") {
    emit({});
    return;
  }

  const state = loadState();
  if (!state.active) {
    emit({});
    return;
  }

  const chain = PHASE_CHAIN[subagentType];
  if (!chain) {
    emit({});
    return;
  }

  state.last_subagent = subagentType;
  state.iteration = (state.iteration || 0) + 1;

  // End phase timer for completed subagent
  endPhaseTimer(state, "completed");
  emitLifecycleEvent(state, "phase_complete", state.phase, {
    subagent: subagentType,
    iteration: state.iteration,
  });

  // Reviewer asked for fixes — loop back to implementer
  if (subagentType === "orchestra-reviewer" && reviewerNeedsFix(input)) {
    state.phase = "implement";
    emitLifecycleEvent(state, "fix_required", state.phase, { iteration: state.iteration });
    if (!state.memory) state.memory = { phases_completed: [], files_changed: [], errors: [], decisions: [], context_summary: "" };
    state.memory.decisions.push({
      phase: "review",
      decision: "FIX_REQUIRED",
      rationale: "Reviewer requested fixes",
      timestamp: new Date().toISOString(),
    });
    saveState(state);
    if (state.iteration >= state.max_iterations) {
      emitLifecycleEvent(state, "max_iterations", state.phase, { iteration: state.iteration });
      state.active = false;
      state.phase = "idle";
      saveState(state);
      emit({
        followup_message:
          "Orchestra max iterations reached after FIX_REQUIRED. Report blockers to the user.",
      });
      return;
    }
    // Start timer for implement phase
    startPhaseTimer(state, "implement", "orchestra-implementer");
    emit({
      followup_message: `Orchestra — FIX_REQUIRED. Use **orchestra-implementer** subagent to address reviewer blockers, then continue verify → review.\n\nGoal: ${state.goal}`,
    });
    return;
  }

  state.phase = chain.nextPhase;
  emitLifecycleEvent(state, "phase_advance", state.phase, {
    from: subagentType,
    to: chain.nextPhase,
  });

  if (chain.nextPhase === "done") {
    emitLifecycleEvent(state, "orchestra_complete", "done", { goal: state.goal });
    state.active = false;
    state.phase = "idle";
    saveState(state);
    emit({
      followup_message: `Orchestra complete (ambient). Goal: ${state.goal || "(no goal)"}. Summarize deliverables for the user.`,
    });
    return;
  }

  if (state.iteration >= state.max_iterations) {
    emitLifecycleEvent(state, "max_iterations", state.phase, { iteration: state.iteration });
    state.active = false;
    state.phase = "idle";
    saveState(state);
    emit({
      followup_message:
        "Orchestra hit max iterations. Stop chaining and give the user a status report.",
    });
    return;
  }

  saveState(state);

  // Start timer for next phase
  startPhaseTimer(state, chain.nextPhase, chain.nextPhase === "implement"
    ? "orchestra-implementer"
    : chain.nextPhase === "verify"
    ? "orchestra-verifier"
    : chain.nextPhase === "review"
    ? "orchestra-reviewer"
    : "orchestra-planner");

  emit({
    followup_message: `${chain.followup}\n\nGoal: ${state.goal}`,
  });
}

main().catch(() => {
  emit({});
});
```

### Step 4: Update startOrchestra to initialize lifecycle and heartbeat

- [ ] Update `startOrchestra()` in `bundle/hooks/orchestra-lib.js`:

```javascript
function startOrchestra(goal, state, source) {
  state.active = true;
  state.goal = goal;
  state.phase = "plan";
  state.started_at = new Date().toISOString();
  state.last_subagent = null;
  state.iteration = 0;
  state.last_prompt = goal;
  state.auto_started = source || "ambient";

  // Initialize lifecycle
  state.lifecycle = { events: [], phase_history: [] };
  emitLifecycleEvent(state, "orchestra_start", "plan", { goal, source });

  // Initialize heartbeat
  state.heartbeat.last_beat = new Date().toISOString();
  state.heartbeat.phase_started_at = new Date().toISOString();

  // Initialize short-term memory
  state.memory = { phases_completed: [], files_changed: [], errors: [], decisions: [], context_summary: "" };

  // Clear resumable state for fresh start
  state.resumable = {
    paused: false,
    paused_at: null,
    pause_reason: null,
    checkpoint: null,
    last_save: null,
  };

  saveState(state);
}
```

### Step 5: Register lifecycle hook in hooks.json

- [ ] Add to `bundle/hooks.json` under `subagentStop`:

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
      { "command": "node ./hooks/orchestra-lifecycle.js", "matcher": "orchestra-planner|orchestra-implementer|orchestra-verifier|orchestra-reviewer", "loop_limit": 12 }
    ],
    "stop": [
      { "command": "node ./hooks/orchestra-stop.js", "loop_limit": 5 },
      { "command": "node ./hooks/orchestra-heartbeat.js", "loop_limit": 5 }
    ]
  }
}
```

---

## Task 4: Heartbeat System

**Files:**
- Create: `bundle/hooks/orchestra-heartbeat.js`
- Modify: `bundle/hooks/orchestra-lib.js` — add heartbeat helpers
- Modify: `bundle/hooks/orchestra-stop.js` — integrate stall detection

### Step 1: Add heartbeat helpers to orchestra-lib.js

- [ ] Add to `bundle/hooks/orchestra-lib.js`:

```javascript
// ── Heartbeat ───────────────────────────────────────────────────────

function writeHeartbeat(state) {
  if (!state.heartbeat) state.heartbeat = { ...DEFAULT_STATE.heartbeat };
  state.heartbeat.last_beat = new Date().toISOString();
}

function isStalled(state) {
  if (!state.active || !state.heartbeat?.phase_started_at) return false;
  const elapsed = Date.now() - new Date(state.heartbeat.phase_started_at).getTime();
  const threshold = state.heartbeat.stall_threshold_ms || 300000;
  return elapsed > threshold;
}

function getStallDurationMs(state) {
  if (!state.heartbeat?.phase_started_at) return 0;
  return Date.now() - new Date(state.heartbeat.phase_started_at).getTime();
}
```

- [ ] Export them in `module.exports`.

### Step 2: Create orchestra-heartbeat.js

- [ ] Create `bundle/hooks/orchestra-heartbeat.js`:

```javascript
#!/usr/bin/env node
"use strict";

const {
  loadState,
  saveState,
  readStdinJson,
  emit,
  isStalled,
  getStallDurationMs,
  emitLifecycleEvent,
  endPhaseTimer,
} = require("./orchestra-lib.js");

/**
 * Heartbeat monitor — runs on the `stop` event.
 * 1. Writes alive signal to state.
 * 2. Detects stalled orchestration (phase running too long).
 * 3. Emits stall recovery nudge if needed.
 */
async function main() {
  const input = await readStdinJson();
  const loopCount = Number(input.loop_count ?? 0);

  const state = loadState();
  if (!state.active) {
    emit({});
    return;
  }

  // Write alive signal
  state.heartbeat.last_beat = new Date().toISOString();

  // Check for stall
  if (isStalled(state)) {
    const elapsed = getStallDurationMs(state);
    const threshold = state.heartbeat.stall_threshold_ms || 300000;

    emitLifecycleEvent(state, "stall_detected", state.phase, {
      elapsed_ms: elapsed,
      threshold_ms: threshold,
    });

    // Mark current phase as stalled
    endPhaseTimer(state, "stalled");

    // Recovery: after 2 stall detections, force-advance or abort
    const recentStalls = state.lifecycle.events.filter(
      (e) => e.type === "stall_detected" && e.phase === state.phase
    ).length;

    if (recentStalls >= 2) {
      // Too many stalls — abort this phase and move on
      emitLifecycleEvent(state, "stall_aborted", state.phase, {
        attempts: recentStalls,
      });
      state.active = false;
      state.phase = "idle";
      saveState(state);
      emit({
        followup_message: `Orchestra: phase "${state.phase}" stalled ${recentStalls} times. Orchestration aborted. Report to user.`,
      });
      return;
    }

    // First stall — nudge the agent to retry
    saveState(state);
    const nudges = {
      plan: "Orchestra heartbeat: planner may be stalled. Re-launch **orchestra-planner** or skip to implementer if plan exists.",
      implement: "Orchestra heartbeat: implementer may be stalled. Re-launch **orchestra-implementer**.",
      verify: "Orchestra heartbeat: verifier may be stalled. Re-launch **orchestra-verifier**.",
      review: "Orchestra heartbeat: reviewer may be stalled. Re-launch **orchestra-reviewer**.",
    };
    emit({
      followup_message: `${nudges[state.phase] || "Orchestra heartbeat: unknown stall."}\n\nGoal: ${state.goal}`,
    });
    return;
  }

  saveState(state);
  emit({});
}

main().catch(() => {
  emit({});
});
```

### Step 3: Update orchestra-stop.js to integrate heartbeat

- [ ] Replace `bundle/hooks/orchestra-stop.js`:

```javascript
#!/usr/bin/env node
"use strict";

const {
  loadState,
  readStdinJson,
  emit,
  AMBIENT_CONTEXT,
  isStalled,
  writeHeartbeat,
  saveState,
} = require("./orchestra-lib.js");

async function main() {
  const input = await readStdinJson();
  const status = input.status || "";
  const loopCount = Number(input.loop_count ?? 0);

  if (status !== "completed") {
    emit({});
    return;
  }

  const state = loadState();
  if (!state.active) {
    emit({});
    return;
  }

  // Write heartbeat alive signal on every stop event
  writeHeartbeat(state);
  saveState(state);

  // Don't nudge if stalled (heartbeat.js handles that)
  if (isStalled(state)) {
    emit({});
    return;
  }

  const nudges = {
    plan: "Orchestra active — launch **orchestra-planner** subagent (Task) if planning is not done.",
    implement:
      "Orchestra active — continue with **orchestra-implementer** subagent.",
    verify: "Orchestra active — continue with **orchestra-verifier** subagent.",
    review: "Orchestra active — continue with **orchestra-reviewer** subagent.",
  };

  const nudge = nudges[state.phase];
  if (!nudge || loopCount >= 3) {
    emit({});
    return;
  }

  emit({
    followup_message: `${nudge}\n\nGoal: ${state.goal}\n\n(${AMBIENT_CONTEXT.split(".")[0]}.)`,
  });
}

main().catch(() => {
  emit({});
});
```

---

## Task 5: Memory System

**Files:**
- Create: `bundle/hooks/orchestra-memory.js`
- Create: `bundle/hooks/state/orchestra-memory.json`
- Modify: `bundle/hooks/orchestra-lib.js` — memory helpers
- Modify: `bundle/hooks/orchestra-prompt.js` — inject long-term memory
- Modify: `bundle/hooks/orchestra-session-start.js` — inject memory context

### Step 1: Create default long-term memory file

- [ ] Create `bundle/hooks/state/orchestra-memory.json`:

```json
{
  "version": 1,
  "completed_goals": [],
  "project_patterns": {},
  "recent_files": [],
  "error_patterns": [],
  "user_preferences": {}
}
```

### Step 2: Add memory helpers to orchestra-lib.js

- [ ] Add to `bundle/hooks/orchestra-lib.js`:

```javascript
// ── Memory ──────────────────────────────────────────────────────────

const MEMORY_PATH = path.join(__dirname, "state", "orchestra-memory.json");

const DEFAULT_LONG_TERM_MEMORY = {
  version: 1,
  completed_goals: [],     // [{goal, outcome, duration_ms, timestamp, lessons, phase_count}]
  project_patterns: {},    // {"project-name": ["pattern1", ...]}
  recent_files: [],        // [{path, count, last_seen}]
  error_patterns: [],      // [{error_type, solution, count, last_seen}]
  user_preferences: {},    // {test_framework: "jest", ...}
};

const MEMORY_MAX_COMPLETED = 100;
const MEMORY_MAX_RECENT_FILES = 50;
const MEMORY_MAX_ERROR_PATTERNS = 50;

function loadLongTermMemory() {
  try {
    if (!fs.existsSync(MEMORY_PATH)) return { ...DEFAULT_LONG_TERM_MEMORY };
    return { ...DEFAULT_LONG_TERM_MEMORY, ...JSON.parse(fs.readFileSync(MEMORY_PATH, "utf8")) };
  } catch {
    return { ...DEFAULT_LONG_TERM_MEMORY };
  }
}

function saveLongTermMemory(mem) {
  fs.mkdirSync(path.dirname(MEMORY_PATH), { recursive: true });
  // Enforce bounds
  if (mem.completed_goals.length > MEMORY_MAX_COMPLETED) {
    mem.completed_goals = mem.completed_goals.slice(-MEMORY_MAX_COMPLETED);
  }
  if (mem.recent_files.length > MEMORY_MAX_RECENT_FILES) {
    mem.recent_files = mem.recent_files.slice(-MEMORY_MAX_RECENT_FILES);
  }
  if (mem.error_patterns.length > MEMORY_MAX_ERROR_PATTERNS) {
    mem.error_patterns = mem.error_patterns.slice(-MEMORY_MAX_ERROR_PATTERNS);
  }
  fs.writeFileSync(MEMORY_PATH, JSON.stringify(mem, null, 2));
}

function flushShortToLong(state, outcome) {
  const ltm = loadLongTermMemory();
  const stm = state.memory || {};

  // Record completed goal
  const duration = state.started_at
    ? Date.now() - new Date(state.started_at).getTime()
    : 0;
  ltm.completed_goals.push({
    goal: state.goal || "",
    outcome: outcome || "completed",
    duration_ms: duration,
    timestamp: new Date().toISOString(),
    lessons: (stm.decisions || []).map((d) => d.decision).filter(Boolean),
    phase_count: (stm.phases_completed || []).length,
  });

  // Update recent files
  for (const f of (stm.files_changed || [])) {
    const existing = ltm.recent_files.find((r) => r.path === f);
    if (existing) {
      existing.count++;
      existing.last_seen = new Date().toISOString();
    } else {
      ltm.recent_files.push({ path: f, count: 1, last_seen: new Date().toISOString() });
    }
  }

  // Update error patterns
  for (const e of (stm.errors || [])) {
    const errorType = (e.error || "").slice(0, 100);
    const existing = ltm.error_patterns.find((p) => p.error_type === errorType);
    if (existing) {
      existing.count++;
      existing.last_seen = new Date().toISOString();
    } else {
      ltm.error_patterns.push({
        error_type: errorType,
        solution: "",
        count: 1,
        last_seen: new Date().toISOString(),
      });
    }
  }

  saveLongTermMemory(ltm);
}

function buildMemoryContext(ltm) {
  if (!ltm || !ltm.completed_goals || ltm.completed_goals.length === 0) return "";

  const lines = ["Long-term memory (past orchestration results):"];

  // Recent goals
  const recent = ltm.completed_goals.slice(-5);
  if (recent.length > 0) {
    lines.push("Recent completed goals:");
    for (const g of recent) {
      lines.push(`  - "${g.goal}" (${g.outcome}, ${Math.round(g.duration_ms / 1000)}s, ${g.phase_count} phases)`);
    }
  }

  // Frequent files
  const topFiles = ltm.recent_files.sort((a, b) => b.count - a.count).slice(0, 5);
  if (topFiles.length > 0) {
    lines.push("Frequently modified files:");
    for (const f of topFiles) {
      lines.push(`  - ${f.path} (modified ${f.count}x)`);
    }
  }

  // Recurring errors
  const topErrors = ltm.error_patterns.sort((a, b) => b.count - a.count).slice(0, 3);
  if (topErrors.length > 0) {
    lines.push("Recurring error patterns:");
    for (const e of topErrors) {
      lines.push(`  - ${e.error_type} (${e.count}x${e.solution ? ", solution: " + e.solution : ""})`);
    }
  }

  return lines.join("\n");
}
```

- [ ] Export `loadLongTermMemory`, `saveLongTermMemory`, `flushShortToLong`, `buildMemoryContext`, `MEMORY_PATH` in `module.exports`.

### Step 3: Create orchestra-memory.js

- [ ] Create `bundle/hooks/orchestra-memory.js`:

```javascript
#!/usr/bin/env node
"use strict";

const {
  loadState,
  saveState,
  readStdinJson,
  emit,
  loadLongTermMemory,
  buildMemoryContext,
} = require("./orchestra-lib.js");

/**
 * Memory hook — runs on subagentStop alongside lifecycle hook.
 * Injects long-term memory context into the follow-up message when
 * entering the plan phase (so the planner benefits from past knowledge).
 */
async function main() {
  const input = await readStdinJson();
  const subagentType = input.subagent_type || input.subagentType || "";

  const state = loadState();
  if (!state.active) {
    emit({});
    return;
  }

  // Only inject memory context when planner is about to be launched
  // (after implementer completes, verifier is next — no memory needed)
  // Memory is most useful at plan phase start
  if (state.phase === "plan" && state.iteration === 0) {
    const ltm = loadLongTermMemory();
    const memCtx = buildMemoryContext(ltm);
    if (memCtx) {
      emit({
        additional_context: memCtx,
      });
      return;
    }
  }

  emit({});
}

main().catch(() => {
  emit({});
});
```

### Step 4: Update startOrchestra to flush memory on completion

- [ ] Update the `orchestra_complete` handling in `bundle/hooks/orchestra-subagent-stop.js` to call `flushShortToLong`:

In the "done" branch (where `chain.nextPhase === "done"`), add before `saveState(state)`:

```javascript
const { flushShortToLong } = require("./orchestra-lib.js");
// ... after emitLifecycleEvent(state, "orchestra_complete", ...) ...
flushShortToLong(state, "completed");
```

Actually, this should be done cleanly. Let me specify the exact change:

- [ ] In `bundle/hooks/orchestra-subagent-stop.js`, in the `chain.nextPhase === "done"` block, add the import at the top and the call:

```javascript
const {
  loadState,
  saveState,
  readStdinJson,
  emit,
  PHASE_CHAIN,
  reviewerNeedsFix,
  emitLifecycleEvent,
  endPhaseTimer,
  startPhaseTimer,
  flushShortToLong,   // ADD THIS
} = require("./orchestra-lib.js");
```

And in the done block:
```javascript
if (chain.nextPhase === "done") {
    emitLifecycleEvent(state, "orchestra_complete", "done", { goal: state.goal });
    flushShortToLong(state, "completed");  // ADD THIS
    state.active = false;
    state.phase = "idle";
    saveState(state);
    emit({
      followup_message: `Orchestra complete (ambient). Goal: ${state.goal || "(no goal)"}. Summarize deliverables for the user.`,
    });
    return;
  }
```

### Step 5: Inject memory into session-start and prompt hooks

- [ ] In `bundle/hooks/orchestra-session-start.js`, add memory context when resuming:

```javascript
const {
  loadState,
  readStdinJson,
  emit,
  detectContextInWorkspaces,
  buildContextInjection,
  AMBIENT_CONTEXT,
  loadLongTermMemory,    // ADD
  buildMemoryContext,     // ADD
} = require("./orchestra-lib.js");

async function main() {
  const input = await readStdinJson();
  const state = loadState();
  const parts = [AMBIENT_CONTEXT];

  const ctx = detectContextInWorkspaces(input);
  const ctxBlock = buildContextInjection(ctx);
  if (ctxBlock) parts.push(ctxBlock);

  if (state.active) {
    parts.push(
      `Orchestra ACTIVE — goal: ${state.goal}`,
      `Phase: ${state.phase}. Continue chain with the matching orchestra-* subagent.`
    );
    // Add short-term memory summary if available
    if (state.memory?.phases_completed?.length > 0) {
      const completed = state.memory.phases_completed.map((p) => p.phase).join(" → ");
      parts.push(`Phases completed so far: ${completed}`);
    }
  }

  // Inject long-term memory on session start
  const ltm = loadLongTermMemory();
  const memCtx = buildMemoryContext(ltm);
  if (memCtx) parts.push(memCtx);

  emit({ additional_context: parts.join("\n\n") });
}
```

- [ ] In `bundle/hooks/orchestra-prompt.js`, inject long-term memory when starting a new orchestration:

After the `startOrchestra(goal || prompt, state, reason)` call and before building the `parts` array, add:

```javascript
const { loadLongTermMemory, buildMemoryContext } = require("./orchestra-lib.js");
// ...
startOrchestra(goal || prompt, state, reason);

const ltm = loadLongTermMemory();
const memCtx = buildMemoryContext(ltm);

const parts = [
  AMBIENT_CONTEXT,
  `Orchestra auto-started (${reason}) — no /orchestra needed.`,
  `Goal: ${goal || prompt}`,
  "Phase: plan — launch **orchestra-planner** subagent first (Task tool).",
];
if (memCtx) parts.push(memCtx);
if (ctxBlock) {
  parts.push(ctxBlock);
  parts.push("Planner: read all present context/*.md files before PLAN_READY.");
}
emit({ additional_context: parts.join("\n\n") });
```

---

## Task 6: Resumable Tasks

**Files:**
- Modify: `bundle/hooks/orchestra-lib.js` — pause/resume/checkpoint helpers
- Modify: `bundle/hooks/orchestra-session-start.js` — crash recovery detection
- Modify: `bundle/hooks/orchestra-enable.js` — pause/resume/status commands
- Modify: `bundle/hooks/orchestra-prompt.js` — resume from checkpoint

### Step 1: Add resumable helpers to orchestra-lib.js

- [ ] Add to `bundle/hooks/orchestra-lib.js`:

```javascript
// ── Resumable Tasks ─────────────────────────────────────────────────

function createCheckpoint(state) {
  return {
    phase: state.phase,
    goal: state.goal,
    iteration: state.iteration,
    last_subagent: state.last_subagent,
    started_at: state.started_at,
    lifecycle_snapshot: state.lifecycle?.events?.slice(-20) || [],
    memory_snapshot: state.memory || {},
    timestamp: new Date().toISOString(),
  };
}

function saveCheckpoint(state) {
  if (!state.resumable) state.resumable = { ...DEFAULT_STATE.resumable };
  state.resumable.checkpoint = createCheckpoint(state);
  state.resumable.last_save = new Date().toISOString();
  saveState(state);
}

function pauseOrchestra(state, reason) {
  if (!state.active) return false;
  state.resumable.paused = true;
  state.resumable.paused_at = new Date().toISOString();
  state.resumable.pause_reason = reason || "manual";
  saveCheckpoint(state);
  return true;
}

function resumeOrchestra(state) {
  if (!state.resumable?.paused || !state.resumable?.checkpoint) return null;
  const cp = state.resumable.checkpoint;
  state.active = true;
  state.phase = cp.phase;
  state.goal = cp.goal;
  state.iteration = cp.iteration;
  state.last_subagent = cp.last_subagent;
  state.started_at = cp.started_at;
  state.resumable.paused = false;
  state.resumable.paused_at = null;
  state.resumable.pause_reason = null;
  // Keep checkpoint for safety but mark as resumed
  state.heartbeat.last_beat = new Date().toISOString();
  state.heartbeat.phase_started_at = new Date().toISOString();
  saveState(state);
  return cp;
}

function isStaleState(state, staleThresholdMs) {
  if (!state.active || !state.started_at) return false;
  const elapsed = Date.now() - new Date(state.started_at).getTime();
  return elapsed > (staleThresholdMs || 600000); // 10 minutes default
}

function detectCrashRecovery(state) {
  if (!state.active) return null;
  // Check if state is stale (no heartbeat for a while)
  const lastBeat = state.heartbeat?.last_beat;
  if (lastBeat) {
    const sinceBeat = Date.now() - new Date(lastBeat).getTime();
    if (sinceBeat > 600000) { // 10 minutes since last beat = likely crash
      return {
        phase: state.phase,
        goal: state.goal,
        iteration: state.iteration,
        last_activity: lastBeat,
      };
    }
  }
  // Check if state is just old
  if (isStaleState(state)) {
    return {
      phase: state.phase,
      goal: state.goal,
      iteration: state.iteration,
      last_activity: state.started_at,
    };
  }
  return null;
}
```

- [ ] Export all new functions.

### Step 2: Update session-start for crash recovery

- [ ] Replace `bundle/hooks/orchestra-session-start.js`:

```javascript
#!/usr/bin/env node
"use strict";

const {
  loadState,
  readStdinJson,
  emit,
  detectContextInWorkspaces,
  buildContextInjection,
  AMBIENT_CONTEXT,
  loadLongTermMemory,
  buildMemoryContext,
  detectCrashRecovery,
} = require("./orchestra-lib.js");

async function main() {
  const input = await readStdinJson();
  const state = loadState();
  const parts = [AMBIENT_CONTEXT];

  const ctx = detectContextInWorkspaces(input);
  const ctxBlock = buildContextInjection(ctx);
  if (ctxBlock) parts.push(ctxBlock);

  if (state.active) {
    // Check for crash recovery
    const crash = detectCrashRecovery(state);
    if (crash) {
      parts.push(
        `⚠️ Orchestra was ACTIVE when session ended (possible crash or restart).`,
        `Goal: ${crash.goal}`,
        `Last phase: ${crash.phase} (iteration ${crash.iteration}).`,
        `Last activity: ${crash.last_activity}.`,
        `To resume: say "resume orchestra" or "continue orchestra".`,
        `To discard: say "stop orchestra" or "new goal".`
      );
    } else {
      parts.push(
        `Orchestra ACTIVE — goal: ${state.goal}`,
        `Phase: ${state.phase}. Continue chain with the matching orchestra-* subagent.`
      );
    }

    // Add short-term memory summary
    if (state.memory?.phases_completed?.length > 0) {
      const completed = state.memory.phases_completed.map((p) => p.phase).join(" → ");
      parts.push(`Phases completed so far: ${completed}`);
    }
  }

  // Inject long-term memory on session start
  const ltm = loadLongTermMemory();
  const memCtx = buildMemoryContext(ltm);
  if (memCtx) parts.push(memCtx);

  emit({ additional_context: parts.join("\n\n") });
}

main().catch(() => {
  emit({});
});
```

### Step 3: Update orchestra-enable.js with pause/resume commands

- [ ] Replace `bundle/hooks/orchestra-enable.js`:

```javascript
#!/usr/bin/env node
"use strict";

const {
  loadState,
  saveState,
  startOrchestra,
  pauseOrchestra,
  resumeOrchestra,
  loadLongTermMemory,
  saveLongTermMemory,
  MEMORY_PATH,
} = require("./orchestra-lib.js");

const [, , cmd, ...rest] = process.argv;
const arg = rest.join(" ").trim();

function printStatus(state) {
  console.log(JSON.stringify(state, null, 2));
}

function printMemory() {
  const mem = loadLongTermMemory();
  console.log("=== Long-term Memory ===");
  console.log(`Completed goals: ${mem.completed_goals.length}`);
  console.log(`Recent files: ${mem.recent_files.length}`);
  console.log(`Error patterns: ${mem.error_patterns.length}`);
  if (mem.completed_goals.length > 0) {
    console.log("\nLast 5 goals:");
    for (const g of mem.completed_goals.slice(-5)) {
      console.log(`  - "${g.goal}" (${g.outcome}, ${Math.round(g.duration_ms / 1000)}s)`);
    }
  }
}

if (!cmd || cmd === "status") {
  const state = loadState();
  printStatus(state);
  // Also show memory summary
  const ltm = loadLongTermMemory();
  console.log(`\nMemory: ${ltm.completed_goals.length} past goals, ${ltm.recent_files.length} tracked files`);
  process.exit(0);
}

if (cmd === "stop") {
  const state = loadState();
  state.active = false;
  state.phase = "idle";
  state.goal = "";
  state.last_subagent = null;
  state.resumable = { paused: false, paused_at: null, pause_reason: null, checkpoint: null, last_save: null };
  saveState(state);
  console.log("Orchestra loop stopped (ambient mode unchanged).");
  printStatus(state);
  process.exit(0);
}

if (cmd === "pause") {
  const state = loadState();
  if (!state.active) {
    console.log("No active orchestration to pause.");
    process.exit(0);
  }
  const reason = arg || "manual";
  pauseOrchestra(state, reason);
  state.active = false;
  state.phase = "paused";
  saveState(state);
  console.log(`Orchestra paused (${reason}). Goal: ${state.goal}`);
  console.log('Resume with: orchestra-enable.js resume');
  printStatus(state);
  process.exit(0);
}

if (cmd === "resume") {
  const state = loadState();
  if (state.resumable?.paused && state.resumable?.checkpoint) {
    const cp = resumeOrchestra(state);
    console.log(`Orchestra resumed from phase "${cp.phase}". Goal: ${cp.goal}`);
    console.log(`Continue with the matching orchestra-* subagent.`);
    printStatus(state);
  } else if (state.active) {
    console.log("Orchestra is already active.");
    printStatus(state);
  } else {
    console.log("No paused orchestration to resume.");
    // Show checkpoint if available
    if (state.resumable?.checkpoint) {
      console.log("Last checkpoint:", JSON.stringify(state.resumable.checkpoint, null, 2));
    }
  }
  process.exit(0);
}

if (cmd === "ambient-off") {
  const state = loadState();
  state.ambient = false;
  state.active = false;
  state.phase = "idle";
  saveState(state);
  console.log("Orchestra ambient mode OFF.");
  printStatus(state);
  process.exit(0);
}

if (cmd === "ambient-on") {
  const state = loadState();
  state.ambient = true;
  saveState(state);
  console.log("Orchestra ambient mode ON — auto-runs on implement/fix/build prompts.");
  printStatus(state);
  process.exit(0);
}

if (cmd === "start") {
  if (!arg) {
    console.error("Usage: orchestra-enable.js start \"<goal>\"");
    process.exit(1);
  }
  const state = loadState();
  startOrchestra(arg, state, "manual");
  console.log("Orchestra loop started (manual).");
  console.log(`Goal: ${arg}`);
  console.log("Next: launch orchestra-planner subagent (Task tool).");
  printStatus(state);
  process.exit(0);
}

if (cmd === "memory") {
  if (arg === "clear") {
    const empty = {
      version: 1,
      completed_goals: [],
      project_patterns: {},
      recent_files: [],
      error_patterns: [],
      user_preferences: {},
    };
    saveLongTermMemory(empty);
    console.log("Long-term memory cleared.");
  } else {
    printMemory();
  }
  process.exit(0);
}

if (cmd === "checkpoint") {
  const state = loadState();
  if (!state.active) {
    console.log("No active orchestration to checkpoint.");
    process.exit(0);
  }
  const { saveCheckpoint } = require("./orchestra-lib.js");
  saveCheckpoint(state);
  console.log("Checkpoint saved.");
  printStatus(state);
  process.exit(0);
}

console.error(
  "Usage: orchestra-enable.js <command>\n\n" +
  "Commands:\n" +
  "  status         Show current state\n" +
  "  start \"goal\"   Start orchestra manually\n" +
  "  stop           Stop active loop\n" +
  "  pause [reason] Pause and save checkpoint\n" +
  "  resume         Resume from checkpoint\n" +
  "  ambient-on     Enable ambient mode\n" +
  "  ambient-off    Disable ambient mode\n" +
  "  memory         Show long-term memory\n" +
  "  memory clear   Clear long-term memory\n" +
  "  checkpoint     Save current state checkpoint"
);
process.exit(1);
```

### Step 4: Handle resume in orchestra-prompt.js

- [ ] In `bundle/hooks/orchestra-prompt.js`, add resume detection after the disable/enable checks:

After the `enable orchestra` block (line 35-38), add:

```javascript
// Resume from checkpoint
if (/\b(resume orchestra|continue orchestra|resume|continue)\b/i.test(prompt) && !state.active) {
  if (state.resumable?.paused && state.resumable?.checkpoint) {
    const cp = require("./orchestra-lib.js").resumeOrchestra(state);
    if (cp) {
      const phaseAgent = {
        plan: "orchestra-planner",
        implement: "orchestra-implementer",
        verify: "orchestra-verifier",
        review: "orchestra-reviewer",
      };
      const agent = phaseAgent[cp.phase] || "orchestra-planner";
      emit({
        additional_context: [
          AMBIENT_CONTEXT,
          `Orchestra RESUMED from checkpoint (paused at ${cp.timestamp}).`,
          `Goal: ${cp.goal}`,
          `Phase: ${cp.phase} (iteration ${cp.iteration}).`,
          `Launch **${agent}** subagent to continue.`,
        ].join("\n\n"),
      });
      return;
    }
  }
  // No checkpoint to resume — just note it
  emit({
    additional_context: "No paused orchestration found to resume. Starting fresh if needed.",
  });
  return;
}
```

---

## Task 7: Update Agent Definitions

**Files:**
- Modify: `bundle/agents/orchestra-planner.md`
- Modify: `bundle/agents/orchestra-implementer.md`
- Modify: `bundle/agents/orchestra-verifier.md`
- Modify: `bundle/agents/orchestra-reviewer.md`
- Modify: `bundle/opencode/agents/orchestra-planner.md`
- Modify: `bundle/opencode/agents/orchestra-implementer.md`
- Modify: `bundle/opencode/agents/orchestra-verifier.md`
- Modify: `bundle/opencode/agents/orchestra-reviewer.md`

### Step 1: Update planner to reference long-term memory

- [ ] In `bundle/agents/orchestra-planner.md`, add to step 1 (after reading context):

```markdown
1. **Read project context first** (if present):
   - `AGENTS.md` or `CLAUDE.md` at repo root
   - `context/project-overview.md` → `architecture.md` → `code-standards.md` → `ui-context.md` → `ai-workflow-rules.md` → `progress-tracker.md`
   - Note missing files; do not invent product scope not in these files.
   - **Long-term memory**: If the parent message includes memory context (past goals, frequent files, error patterns), use it to inform your plan — avoid repeating past mistakes, prefer files that have been frequently modified.
```

### Step 2: Update implementer to record files changed

- [ ] In `bundle/agents/orchestra-implementer.md`, update step 6 output to include memory directives:

Replace the "Context sync" section with:

```markdown
## Memory update
- [ ] Files changed: list all file paths modified (for short-term memory)
- [ ] Decisions made: any significant architectural or approach decisions
- [ ] progress-tracker.md updated (or N/A)
```

### Step 3: Update reviewer to write long-term memory

- [ ] In `bundle/agents/orchestra-reviewer.md`, add to the verdict section:

```markdown
## Lessons for long-term memory
- [any patterns, anti-patterns, or decisions worth remembering for future orchestrations]
```

### Step 4: Mirror changes in OpenCode agents

- [ ] Apply the same changes to the corresponding `bundle/opencode/agents/orchestra-*.md` files.

---

## Task 8: Update Health Check

**Files:**
- Modify: `bundle/hooks/orchestra-health.js`
- Modify: `bundle/opencode/hooks/orchestra-health-opencode.js`

### Step 1: Add new checks to Cursor health check

- [ ] In `bundle/hooks/orchestra-health.js`, add after the classification samples section:

```javascript
// Check new scripts
console.log("\n=== New hook scripts ===");
for (const s of ["orchestra-heartbeat.js", "orchestra-memory.js", "orchestra-lifecycle.js"]) {
  const p = path.join(HOOKS_DIR, s);
  const exists = fs.existsSync(p);
  console.log(exists ? "OK " : "MISSING ", s);
  if (!exists) ok = false;
}

// Check long-term memory file
const memoryPath = path.join(HOOKS_DIR, "state", "orchestra-memory.json");
const memExists = fs.existsSync(memoryPath);
console.log(memExists ? "OK " : "MISSING ", "state/orchestra-memory.json");
if (memExists) {
  try {
    const mem = JSON.parse(fs.readFileSync(memoryPath, "utf8"));
    console.log(`    completed_goals: ${mem.completed_goals?.length || 0}`);
    console.log(`    recent_files: ${mem.recent_files?.length || 0}`);
  } catch (e) {
    console.log("    WARN: memory file is invalid JSON:", e.message);
  }
}

// Check state version
console.log("\n=== State version ===");
console.log(`    version: ${state.version || "1 (legacy)"}`);
console.log(`    heartbeat: ${state.heartbeat ? "present" : "MISSING"}`);
console.log(`    lifecycle: ${state.lifecycle ? "present" : "MISSING"}`);
console.log(`    memory: ${state.memory ? "present" : "MISSING"}`);
console.log(`    resumable: ${state.resumable ? "present" : "MISSING"}`);
```

### Step 2: Update OpenCode health check

- [ ] In `bundle/opencode/hooks/orchestra-health-opencode.js`, add similar state version and memory checks.

### Step 3: Fix external symlink check in OpenCode health

- [ ] In `bundle/opencode/hooks/orchestra-health-opencode.js`, change line 61 from:
```javascript
if (!externalExists) ok = false;
```
to:
```javascript
if (!externalExists) {
  console.log("      INFO: external symlink optional — not required for OpenCode");
}
```

---

## Task 9: Update Documentation

**Files:**
- Modify: `bundle/ORCHESTRA.md`
- Modify: `bundle/skills/orchestra-loop/SKILL.md`
- Modify: `bundle/opencode/skills/orchestra-loop/SKILL.md`
- Modify: `context/architecture.md`
- Modify: `context/progress-tracker.md`

### Step 1: Update ORCHESTRA.md with new features

- [ ] Add new sections to `bundle/ORCHESTRA.md`:

```markdown
## Heartbeat

Orchestra monitors orchestration health via heartbeat timestamps written to state on every hook execution. If a phase runs longer than 5 minutes (configurable), the heartbeat system detects the stall and emits recovery nudges. After 2 stall detections, orchestration aborts.

## Memory

### Short-term memory
During each orchestration run, Orchestra tracks:
- Phases completed and their outcomes
- Files changed by the implementer
- Errors encountered
- Decisions made

This context is available to subagents during the run.

### Long-term memory
On completion, short-term memory is flushed to `~/.cursor/hooks/state/orchestra-memory.json`. This persists across sessions:
- Completed goals with outcomes and duration
- Frequently modified files
- Recurring error patterns
- Lessons learned

The planner reads long-term memory to avoid repeating past mistakes.

## Resumable Tasks

### Crash recovery
If Cursor restarts mid-orchestration, `sessionStart` detects the stale active state and offers to resume from the last phase. Say "resume orchestra" to continue.

### Manual pause/resume
```bash
node ~/.cursor/hooks/orchestra-enable.js pause "reason"
node ~/.cursor/hooks/orchestra-enable.js resume
```
Or say "pause orchestra" / "resume orchestra" in chat.
```

### Step 2: Update skills with new capabilities

- [ ] Add corresponding sections to both `bundle/skills/orchestra-loop/SKILL.md` and `bundle/opencode/skills/orchestra-loop/SKILL.md`.

### Step 3: Update architecture.md

- [ ] In `context/architecture.md`, update the phase model and storage model:

```markdown
## Phase model

```
idle → plan (planner) → implement → verify → review → done
  ↑        ↑                                      |
  |        └──────── FIX_REQUIRED ─────────────────┘
  │
  └── resume (from checkpoint)
```

## Storage model

| Data | Location | Notes |
|------|----------|-------|
| Orchestra state | `~/.cursor/hooks/state/orchestra.json` | V2: lifecycle, heartbeat, memory, resumable |
| Long-term memory | `~/.cursor/hooks/state/orchestra-memory.json` | Persistent across sessions, capped at 100 goals |
| Installed bundle | `~/.cursor/hooks`, `agents`, `skills`, `rules` | Copied from `bundle/` on install |
| Target project context | `<project>/context/*.md` | Created by `init-context` or manually |
| Target entry point | `<project>/AGENTS.md` | Points agents to six files |
```

### Step 4: Update progress-tracker

- [ ] Update `context/progress-tracker.md` with current status and this work.

---

## Task 10: Verify and Test

**Files:**
- Run: `node bundle/hooks/orchestra-health.js`

### Step 1: Run health check

- [ ] Execute health check from the repo root:
```bash
node bundle/hooks/orchestra-health.js
```
Expected: All checks pass, including new script checks and state version checks.

### Step 2: Smoke test state migration

- [ ] Manually test: write a V1 state file, run health check, verify V2 migration works.

### Step 3: Smoke test lifecycle events

- [ ] Manually verify: `loadState()` returns V2 schema with all new fields.

---

## Commit Strategy

After each task, commit with descriptive message:

1. `fix: add ambient field to OpenCode default state`
2. `feat: extend state model to V2 with lifecycle, heartbeat, memory, resumable`
3. `feat: add lifecycle event system and hook script`
4. `feat: add heartbeat monitoring with stall detection`
5. `feat: add short/long-term memory system`
6. `feat: add resumable tasks with crash recovery and pause/resume`
7. `feat: update agent definitions with memory awareness`
8. `feat: update health checks for new systems`
9. `docs: update ORCHESTRA.md, skills, architecture, progress-tracker`

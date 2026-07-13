"use strict";

const fs = require("node:fs");
const path = require("node:path");

const STATE_PATH = path.join(__dirname, "state", "orchestra.json");
const MEMORY_PATH = path.join(__dirname, "state", "orchestra-memory.json");

// ── Default State (V2) ──────────────────────────────────────────────

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
    events: [],
    phase_history: [],
  },

  // Heartbeat
  heartbeat: {
    last_beat: null,
    phase_started_at: null,
    stall_threshold_ms: 300000, // 5 minutes
    interval_ms: 60000,         // 1 minute
  },

  // Short-term memory (cleared on orchestration complete/reset)
  memory: {
    phases_completed: [],
    files_changed: [],
    errors: [],
    decisions: [],
    context_summary: "",
  },

  // Resumable state
  resumable: {
    paused: false,
    paused_at: null,
    pause_reason: null,
    checkpoint: null,
    last_save: null,
  },
};

// ── State Management ────────────────────────────────────────────────

function loadState() {
  try {
    if (!fs.existsSync(STATE_PATH)) return { ...DEFAULT_STATE, ...cloneDefaults() };
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
    const merged = { ...DEFAULT_STATE, ...raw };
    // Migrate V1 → V2 with deep merge for nested sections
    merged.lifecycle = { ...DEFAULT_STATE.lifecycle, ...merged.lifecycle };
    merged.lifecycle.events = merged.lifecycle.events || [];
    merged.lifecycle.phase_history = merged.lifecycle.phase_history || [];
    merged.heartbeat = { ...DEFAULT_STATE.heartbeat, ...merged.heartbeat };
    merged.memory = { ...DEFAULT_STATE.memory, ...merged.memory };
    merged.resumable = { ...DEFAULT_STATE.resumable, ...merged.resumable };
    merged.version = 2;
    return merged;
  } catch {
    return { ...DEFAULT_STATE, ...cloneDefaults() };
  }
}

function cloneDefaults() {
  return {
    lifecycle: { events: [], phase_history: [] },
    heartbeat: { ...DEFAULT_STATE.heartbeat },
    memory: { ...DEFAULT_STATE.memory },
    resumable: { ...DEFAULT_STATE.resumable },
  };
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

// ── Stdin / Stdout ──────────────────────────────────────────────────

function readStdinJson() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
}

// ── Prompt Extraction ───────────────────────────────────────────────

function extractPrompt(input) {
  const candidates = [
    input.prompt,
    input.user_message,
    input.message,
    input.text,
    input.content,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return "";
}

// ── Prompt Classification ───────────────────────────────────────────

const QUESTION_ONLY_RE =
  /^(what is|what are|how does|why does|explain|describe|tell me about)\b/i;

const OPT_OUT_RE =
  /\b(no orchestra|skip orchestra|disable orchestra|orchestra off|don't orchestrate|do not orchestrate|just explain|only explain|quick answer|no code|question only|brainstorm only|summarize this|tl;dr)\b/i;

const OPT_IN_EXPLICIT_RE =
  /\b(\/orchestra|orchestra loop|run orchestra|agent orchestra)\b/i;

const IMPLEMENT_RE =
  /\b(add|implement|build|create|fix|refactor|update|deploy|install|setup|configure|migrate|integrate|wire|hook up|write tests|add tests|ship|continue|finish|complete|resolve|debug|patch|scaffold|generate|make it work|get it working|push to|commit)\b/i;

const TRIVIAL_RE = /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|stop|status)\.?$/i;

function classifyPrompt(prompt, state) {
  const text = (prompt || "").trim();
  if (!text || text.length < 8) {
    return { activate: false, reason: "too_short" };
  }
  if (TRIVIAL_RE.test(text)) {
    return { activate: false, reason: "trivial" };
  }
  if (/\b\/orchestra\s+stop\b/i.test(text)) {
    return { activate: false, reason: "explicit_stop" };
  }

  const ambient = state.ambient !== false;
  const explicit = OPT_IN_EXPLICIT_RE.test(text);
  const implement = IMPLEMENT_RE.test(text);

  if (QUESTION_ONLY_RE.test(text) && !implement && !explicit) {
    return { activate: false, reason: "question_only" };
  }

  if (OPT_OUT_RE.test(text) && !implement && !explicit) {
    return { activate: false, reason: "opt_out" };
  }

  const multiStep =
    (text.match(/\band\b/gi) || []).length >= 2 ||
    /\b(then|after that|also|next)\b/i.test(text) ||
    text.length > 120;

  if (!ambient && !explicit) {
    return { activate: false, reason: "ambient_disabled" };
  }

  if (explicit || implement || multiStep) {
    const goal = text
      .replace(/^\/orchestra\s*/i, "")
      .replace(/\borchestra loop\b/gi, "")
      .trim();
    return {
      activate: true,
      reason: explicit ? "explicit" : implement ? "implement" : "multistep",
      goal: goal.slice(0, 2000),
    };
  }

  return { activate: false, reason: "no_match" };
}

// ── Orchestra Start ─────────────────────────────────────────────────

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

// ── Phase Chain ─────────────────────────────────────────────────────

const PHASE_CHAIN = {
  "orchestra-planner": {
    nextPhase: "implement",
    followup:
      "Orchestra (ambient) — implement phase. Use **orchestra-implementer** subagent (Task) to implement the approved plan only. Run relevant checks. Summarize files changed.",
  },
  "orchestra-implementer": {
    nextPhase: "verify",
    followup:
      "Orchestra (ambient) — verify phase. Use **orchestra-verifier** subagent to run tests, linters, and smoke checks. End with VERIFY_PASS or VERIFY_FAIL.",
  },
  "orchestra-verifier": {
    nextPhase: "review",
    followup:
      "Orchestra (ambient) — review phase. Use **orchestra-reviewer** subagent. End with ORCHESTRA_COMPLETE or FIX_REQUIRED.",
  },
  "orchestra-reviewer": {
    nextPhase: "done",
    followup: null,
  },
};

function reviewerNeedsFix(input) {
  const blob = [
    input.summary,
    input.result,
    input.output,
    input.final_text,
  ]
    .filter(Boolean)
    .join("\n");
  return /\bFIX_REQUIRED\b/i.test(blob) || /\bVERIFY_FAIL\b/i.test(blob);
}

// ── Lifecycle Events ────────────────────────────────────────────────

const LIFECYCLE_MAX_EVENTS = 200;

function emitLifecycleEvent(state, type, phase, data) {
  if (!state.lifecycle) state.lifecycle = { events: [], phase_history: [] };
  const event = { type, phase, timestamp: new Date().toISOString(), data: data || null };
  state.lifecycle.events.push(event);
  if (state.lifecycle.events.length > LIFECYCLE_MAX_EVENTS) {
    state.lifecycle.events = state.lifecycle.events.slice(-LIFECYCLE_MAX_EVENTS);
  }
}

function startPhaseTimer(state, phase, subagent) {
  if (!state.heartbeat) state.heartbeat = { ...DEFAULT_STATE.heartbeat };
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
  if (state.heartbeat) state.heartbeat.phase_started_at = null;
}

function getPhaseElapsedMs(state) {
  if (!state.heartbeat?.phase_started_at) return 0;
  return Date.now() - new Date(state.heartbeat.phase_started_at).getTime();
}

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

// ── Memory ──────────────────────────────────────────────────────────

const DEFAULT_LONG_TERM_MEMORY = {
  version: 1,
  completed_goals: [],
  project_patterns: {},
  recent_files: [],
  error_patterns: [],
  user_preferences: {},
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

  for (const f of (stm.files_changed || [])) {
    const existing = ltm.recent_files.find((r) => r.path === f);
    if (existing) {
      existing.count++;
      existing.last_seen = new Date().toISOString();
    } else {
      ltm.recent_files.push({ path: f, count: 1, last_seen: new Date().toISOString() });
    }
  }

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

  const recent = ltm.completed_goals.slice(-5);
  if (recent.length > 0) {
    lines.push("Recent completed goals:");
    for (const g of recent) {
      lines.push(`  - "${g.goal}" (${g.outcome}, ${Math.round(g.duration_ms / 1000)}s, ${g.phase_count} phases)`);
    }
  }

  const topFiles = ltm.recent_files.sort((a, b) => b.count - a.count).slice(0, 5);
  if (topFiles.length > 0) {
    lines.push("Frequently modified files:");
    for (const f of topFiles) {
      lines.push(`  - ${f.path} (modified ${f.count}x)`);
    }
  }

  const topErrors = ltm.error_patterns.sort((a, b) => b.count - a.count).slice(0, 3);
  if (topErrors.length > 0) {
    lines.push("Recurring error patterns:");
    for (const e of topErrors) {
      lines.push(`  - ${e.error_type} (${e.count}x${e.solution ? ", solution: " + e.solution : ""})`);
    }
  }

  return lines.join("\n");
}

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
  state.heartbeat.last_beat = new Date().toISOString();
  state.heartbeat.phase_started_at = new Date().toISOString();
  saveState(state);
  return cp;
}

function isStaleState(state, staleThresholdMs) {
  if (!state.active || !state.started_at) return false;
  const elapsed = Date.now() - new Date(state.started_at).getTime();
  return elapsed > (staleThresholdMs || 600000);
}

function detectCrashRecovery(state) {
  if (!state.active) return null;
  const lastBeat = state.heartbeat?.last_beat;
  if (lastBeat) {
    const sinceBeat = Date.now() - new Date(lastBeat).getTime();
    if (sinceBeat > 600000) {
      return {
        phase: state.phase,
        goal: state.goal,
        iteration: state.iteration,
        last_activity: lastBeat,
      };
    }
  }
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

function abortOrchestra(state, reason) {
  if (!state.active) return false;
  recordOrchestrationRun(state, "aborted");
  state.active = false;
  state.phase = "idle";
  state.resumable.paused = true;
  state.resumable.paused_at = new Date().toISOString();
  state.resumable.pause_reason = reason || "aborted";
  saveCheckpoint(state);
  return true;
}

// ── Orchestration History ───────────────────────────────────────────

const HISTORY_MAX_RUNS = 50;

function recordOrchestrationRun(state, outcome) {
  const historyPath = path.join(__dirname, "state", "orchestra-history.json");
  let history = [];
  try {
    if (fs.existsSync(historyPath)) {
      history = JSON.parse(fs.readFileSync(historyPath, "utf8"));
    }
  } catch {
    history = [];
  }

  const duration = state.started_at
    ? Date.now() - new Date(state.started_at).getTime()
    : 0;

  history.push({
    goal: state.goal || "",
    outcome,
    started_at: state.started_at,
    completed_at: new Date().toISOString(),
    duration_ms: duration,
    iterations: state.iteration || 0,
    phases_completed: state.memory?.phases_completed?.map((p) => p.phase) || [],
    files_changed: state.memory?.files_changed || [],
    errors: state.memory?.errors?.length || 0,
  });

  if (history.length > HISTORY_MAX_RUNS) {
    history = history.slice(-HISTORY_MAX_RUNS);
  }

  fs.mkdirSync(path.dirname(historyPath), { recursive: true });
  fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
}

function loadOrchestrationHistory() {
  const historyPath = path.join(__dirname, "state", "orchestra-history.json");
  try {
    if (!fs.existsSync(historyPath)) return [];
    return JSON.parse(fs.readFileSync(historyPath, "utf8"));
  } catch {
    return [];
  }
}

// ── Context Detection ───────────────────────────────────────────────

const AMBIENT_CONTEXT = [
  "Global orchestra (ambient mode ON): for implementation/fix/build/refactor tasks,",
  "run plan → implement → verify → review using Task subagents:",
  "orchestra-planner, orchestra-implementer, orchestra-verifier, orchestra-reviewer.",
  "User does NOT need to say /orchestra. Hooks auto-chain phases.",
  "Skip orchestra for pure questions/explanations. Opt out: say 'no orchestra'.",
  "Stop: /orchestra stop or node ~/.cursor/hooks/orchestra-enable.js stop",
].join(" ");

const SIX_FILE_CONTEXT = [
  { file: "project-overview.md", label: "product definition, goals, features, scope" },
  { file: "architecture.md", label: "system structure, boundaries, invariants" },
  { file: "code-standards.md", label: "implementation rules and conventions" },
  { file: "ui-context.md", label: "theme, colors, typography, components" },
  { file: "ai-workflow-rules.md", label: "workflow, scoping, verification" },
  { file: "progress-tracker.md", label: "current phase, completed work, next steps" },
];

function extractWorkspaceRoots(input) {
  const roots = [];
  const push = (v) => {
    if (typeof v === "string" && v.trim()) roots.push(path.resolve(v.trim()));
  };
  if (Array.isArray(input.workspace_roots)) input.workspace_roots.forEach(push);
  if (Array.isArray(input.workspaceRoots)) input.workspaceRoots.forEach(push);
  push(input.workspace_root);
  push(input.workspaceRoot);
  push(input.cwd);
  push(input.project_path);
  push(input.projectPath);
  return [...new Set(roots)];
}

function detectSixFileContext(workspaceRoot) {
  if (!workspaceRoot) return null;
  const ctxDir = path.join(workspaceRoot, "context");
  if (!fs.existsSync(ctxDir)) return null;

  const files = SIX_FILE_CONTEXT.map(({ file }) => {
    const full = path.join(ctxDir, file);
    return { file, exists: fs.existsSync(full) };
  });
  const found = files.filter((f) => f.exists);
  if (found.length === 0) return null;

  const agentsMd = fs.existsSync(path.join(workspaceRoot, "AGENTS.md"));
  const claudeMd = fs.existsSync(path.join(workspaceRoot, "CLAUDE.md"));

  return {
    root: workspaceRoot,
    contextDir: "context",
    files,
    foundCount: found.length,
    totalCount: SIX_FILE_CONTEXT.length,
    entryPoint: agentsMd ? "AGENTS.md" : claudeMd ? "CLAUDE.md" : null,
  };
}

function detectContextInWorkspaces(input) {
  for (const root of extractWorkspaceRoots(input)) {
    const ctx = detectSixFileContext(root);
    if (ctx) return ctx;
  }
  return null;
}

function buildContextInjection(ctx) {
  if (!ctx) return "";

  const lines = [
    "Six-File Context detected in this workspace (read before planning/implementing):",
  ];
  if (ctx.entryPoint) {
    lines.push(`Entry point: \`${ctx.entryPoint}\` at project root.`);
  }
  lines.push(`Context folder: \`${ctx.contextDir}/\` (${ctx.foundCount}/${ctx.totalCount} files present).`);
  lines.push("Read in order:");
  SIX_FILE_CONTEXT.forEach(({ file, label }, i) => {
    const exists = ctx.files.find((f) => f.file === file)?.exists;
    const mark = exists ? "✓" : "○";
    lines.push(`${i + 1}. \`${ctx.contextDir}/${file}\` — ${label} ${mark}`);
  });
  lines.push(
    "Update `context/progress-tracker.md` after meaningful changes.",
    "Bootstrap missing context: `bash scripts/init-context.sh` from cursor-orchestra repo."
  );
  return lines.join("\n");
}

// ── Exports ─────────────────────────────────────────────────────────

module.exports = {
  STATE_PATH,
  MEMORY_PATH,
  DEFAULT_STATE,
  DEFAULT_LONG_TERM_MEMORY,
  loadState,
  saveState,
  readStdinJson,
  emit,
  extractPrompt,
  classifyPrompt,
  startOrchestra,
  PHASE_CHAIN,
  reviewerNeedsFix,
  AMBIENT_CONTEXT,
  SIX_FILE_CONTEXT,
  extractWorkspaceRoots,
  detectSixFileContext,
  detectContextInWorkspaces,
  buildContextInjection,
  // Lifecycle
  emitLifecycleEvent,
  startPhaseTimer,
  endPhaseTimer,
  getPhaseElapsedMs,
  LIFECYCLE_MAX_EVENTS,
  // Heartbeat
  writeHeartbeat,
  isStalled,
  getStallDurationMs,
  // Memory
  loadLongTermMemory,
  saveLongTermMemory,
  flushShortToLong,
  buildMemoryContext,
  // Resumable
  createCheckpoint,
  saveCheckpoint,
  pauseOrchestra,
  resumeOrchestra,
  isStaleState,
  detectCrashRecovery,
  abortOrchestra,
  // History
  recordOrchestrationRun,
  loadOrchestrationHistory,
};

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const STATE_PATH = path.join(__dirname, "state", "orchestra.json");

const DEFAULT_STATE = {
  version: 1,
  ambient: true,
  active: false,
  goal: "",
  phase: "idle",
  started_at: null,
  last_subagent: null,
  iteration: 0,
  max_iterations: 8,
  last_prompt: null,
};

function loadState() {
  try {
    if (!fs.existsSync(STATE_PATH)) return { ...DEFAULT_STATE };
    return { ...DEFAULT_STATE, ...JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

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

/** Normalize user prompt from hook payload */
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

const QUESTION_ONLY_RE =
  /^(what is|what are|how does|why does|explain|describe|tell me about)\b/i;

const OPT_OUT_RE =
  /\b(no orchestra|skip orchestra|disable orchestra|orchestra off|don't orchestrate|do not orchestrate|just explain|only explain|quick answer|no code|question only|brainstorm only|summarize this|tl;dr)\b/i;

const OPT_IN_EXPLICIT_RE =
  /\b(\/orchestra|orchestra loop|run orchestra|agent orchestra)\b/i;

const IMPLEMENT_RE =
  /\b(add|implement|build|create|fix|refactor|update|deploy|install|setup|configure|migrate|integrate|wire|hook up|write tests|add tests|ship|continue|finish|complete|resolve|debug|patch|scaffold|generate|make it work|get it working|push to|commit)\b/i;

const TRIVIAL_RE = /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|stop|status)\.?$/i;

/**
 * Decide if ambient orchestration should activate for this prompt.
 * Returns { activate, reason, goal }
 */
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

  // Pure questions without action verbs — skip even if long
  if (QUESTION_ONLY_RE.test(text) && !implement && !explicit) {
    return { activate: false, reason: "question_only" };
  }

  if (OPT_OUT_RE.test(text) && !implement && !explicit) {
    return { activate: false, reason: "opt_out" };
  }

  // Multi-step signals: file paths, "and then", multiple sentences with action verbs
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

function startOrchestra(goal, state, source) {
  state.active = true;
  state.goal = goal;
  state.phase = "plan";
  state.started_at = new Date().toISOString();
  state.last_subagent = null;
  state.iteration = 0;
  state.last_prompt = goal;
  state.auto_started = source || "ambient";
  saveState(state);
}

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

const AMBIENT_CONTEXT = [
  "Global orchestra (ambient mode ON): for implementation/fix/build/refactor tasks,",
  "run plan → implement → verify → review using Task subagents:",
  "orchestra-planner, orchestra-implementer, orchestra-verifier, orchestra-reviewer.",
  "User does NOT need to say /orchestra. Hooks auto-chain phases.",
  "Skip orchestra for pure questions/explanations. Opt out: say 'no orchestra'.",
  "Stop: /orchestra stop or node ~/.cursor/hooks/orchestra-enable.js stop",
].join(" ");

/** Six-File Context Methodology — fixed read order (matches AGENTS.md / CLAUDE.md). */
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

module.exports = {
  STATE_PATH,
  DEFAULT_STATE,
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
};

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { findProjectIdentity, buildIdentitySummary } = require("./project-identity.js");
const { PROJECT_YAML_NAME } = require("./constants.js");

const {
  ambientContextBlock,
  handoffBlock,
} = require("./orchestra-spawn-matrix.js");

const AMBIENT_CONTEXT = [
  ambientContextBlock(),
  "Stop: /orchestra stop or node ~/.cursor/hooks/orchestra-enable.js stop",
].join(" ");

/** Stable prefix for prompt-cache — same every session when orchestra is installed. */
const PARENT_HANDOFF_CONTEXT = [
  handoffBlock("cursor"),
  "OpenCode (not Cursor): task tool + agent name — docs/orchestra-cross-platform.md",
  "Harness: docs/agent-harness-recommendations.md | tokens: orchestra-enable.js tokens",
].join("\n");

const CONTEXT_INDEX_FILE = "context-index.json";

const VALID_PHASES = ["plan", "implement", "verify", "review"];

/** Module-level cache for the context index (keyed by resolved index path). */
let contextIndexCache = null;
let contextIndexCachePath = null;

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

function detectProjectYaml(root) {
  if (!root) return null;
  const found = findProjectIdentity(root);
  if (!found) return null;
  return { root, path: found.path, format: found.format };
}

function detectProjectYamlInWorkspaces(input) {
  for (const root of extractWorkspaceRoots(input)) {
    const py = detectProjectYaml(root);
    if (py) return py;
  }
  return null;
}

function buildProjectYamlInjection(projectIdentity) {
  if (!projectIdentity) return "";
  const { buildOrchestraConfigSummary, extractOrchestraFromIdentity } = require("./orchestra-config.js");
  const lines = [
    "Project Identity detected:",
    buildIdentitySummary(projectIdentity),
  ];
  const oc = extractOrchestraFromIdentity(projectIdentity);
  const cfgSummary = buildOrchestraConfigSummary(oc);
  if (cfgSummary) lines.push("", cfgSummary);
  return lines.join("\n");
}

function detectContextInWorkspaces(input) {
  for (const root of extractWorkspaceRoots(input)) {
    const ctx = detectSixFileContext(root);
    if (ctx) return ctx;
  }
  return null;
}

function detectFullWorkspaceContext(input) {
  const workspaces = extractWorkspaceRoots(input);
  const result = {};

  for (const root of workspaces) {
    const sixFile = detectSixFileContext(root);
    const projectId = detectProjectYaml(root);
    if (sixFile || projectId) {
      result[root] = { sixFile, projectId };
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

/** Legacy lightweight listing (no phase) — backward compatible single-arg behavior. */
function buildLegacyContextInjection(ctx) {
  if (!ctx) return "";

  const lines = [
    "Six-File Context detected in this workspace (read before planning/implementing):",
  ];
  if (ctx.entryPoint) {
    lines.push(`Entry point: \`${ctx.entryPoint}\` at project root.`);
  }
  lines.push(
    `Context folder: \`${ctx.contextDir}/\` (${ctx.foundCount}/${ctx.totalCount} files present).`
  );
  lines.push("Read in order:");
  SIX_FILE_CONTEXT.forEach(({ file, label }, i) => {
    const exists = ctx.files.find((f) => f.file === file)?.exists;
    const mark = exists ? "✓" : "○";
    lines.push(`${i + 1}. \`${ctx.contextDir}/${file}\` — ${label} ${mark}`);
  });
  lines.push(
    "Update `context/progress-tracker.md` after meaningful changes.",
    "Bootstrap missing context: `bash scripts/init-context.sh` from pcore-orchestra repo."
  );
  return lines.join("\n");
}

/**
 * Resolve and cache the context index JSON for a workspace.
 * Returns null when missing/malformed (caller falls back to phase-blind listing).
 */
function loadContextIndex(ctx) {
  if (!ctx || !ctx.root || !ctx.contextDir) return null;
  const indexPath = path.join(ctx.root, ctx.contextDir, CONTEXT_INDEX_FILE);
  if (contextIndexCache && contextIndexCachePath === indexPath) {
    return contextIndexCache;
  }
  try {
    if (fs.existsSync(indexPath)) {
      const raw = fs.readFileSync(indexPath, "utf8");
      contextIndexCache = JSON.parse(raw);
      contextIndexCachePath = indexPath;
      return contextIndexCache;
    }
  } catch {
    /* index missing or malformed -> fall back to phase-blind listing */
  }
  contextIndexCache = null;
  contextIndexCachePath = null;
  return null;
}

/**
 * Phase-selective context injection.
 *
 * When `phase` is set (one of plan/implement/verify/review), emits only
 * phase-relevant section summaries + file pointers — never full file contents —
 * with a header stating the phase + budget. When `phase` is null/omitted, falls
 * back to the legacy lightweight listing (backward compatible).
 *
 * Signature stays one-arg compatible: buildContextInjection(ctx).
 */
function buildContextInjection(ctx, phase = null, opts = {}) {
  if (!ctx) return "";

  const phaseIsSet = phase != null && VALID_PHASES.includes(phase);
  if (!phaseIsSet) {
    return buildLegacyContextInjection(ctx);
  }

  const index = loadContextIndex(ctx);
  const budget = index?.phaseBudgetTokens?.[phase] ?? 0;

  const lines = [
    `Phase-Selective Context Injection (phase=${phase}, budget=${budget.toLocaleString()} tokens)`,
    "Read only the sections below; full file contents are NOT injected.",
  ];
  if (ctx.entryPoint) {
    lines.push(`Entry point: \`${ctx.entryPoint}\` at project root.`);
  }
  lines.push(
    `Context folder: \`${ctx.contextDir}/\` (${ctx.foundCount}/${ctx.totalCount} files present).`
  );
  lines.push("");

  let emittedTokens = 0;

  for (const { file, label } of SIX_FILE_CONTEXT) {
    const exists = ctx.files.find((f) => f.file === file)?.exists;
    if (!exists) continue;

    const idx = index?.files.find((fi) => fi.file === file);
    const estTokens = idx?.estTokens ?? 0;
    const fullReadOnly = idx?.fullReadOnlyWhenExplicitlyNeeded ?? false;
    const phaseSections = idx?.sections?.[phase] ?? [];

    lines.push(`${file} — ${label}`);
    lines.push(
      `  present: yes · estTokens: ${estTokens.toLocaleString()} · fullReadOnlyWhenExplicitlyNeeded: ${fullReadOnly}`
    );
    if (fullReadOnly) {
      lines.push(
        `  phase sections (${phase}): pointer only — read \`${file}\` directly when explicitly needed.`
      );
    } else if (phaseSections.length > 0) {
      lines.push(`  phase sections (${phase}): ${phaseSections.join(", ")}`);
    } else {
      lines.push(`  phase sections (${phase}): none — file not needed this phase.`);
    }
    lines.push("");

    if (!fullReadOnly) {
      emittedTokens += estTokens;
    }
  }

  lines.push(
    `Phase budget used (pointers only, estTokens): ${emittedTokens.toLocaleString()} / ${budget.toLocaleString()}`
  );
  lines.push(
    "Update `context/progress-tracker.md` after meaningful changes.",
    "Bootstrap missing context: `bash scripts/init-context.sh` from pcore-orchestra repo."
  );
  return lines.join("\n");
}

/**
 * Validate six-file context at verify phase.
 * Returns { files, missing, progressTrackerTouched, foundCount, totalCount, root, contextDir }
 * progressTrackerTouched = true if progress-tracker.md mtime > claimedAt (from state.memory.progressTrackerClaimedAt)
 */
function validateSixFileContext(workspaceRoot, claimedAt) {
  if (!workspaceRoot) return null;
  const ctxDir = path.join(workspaceRoot, "context");
  if (!fs.existsSync(ctxDir)) return null;

  const files = SIX_FILE_CONTEXT.map(({ file }) => {
    const full = path.join(ctxDir, file);
    return { file, exists: fs.existsSync(full) };
  });
  const found = files.filter((f) => f.exists);
  const missing = files.filter((f) => !f.exists).map((f) => f.file);

  // Check if progress-tracker.md was touched since claimedAt
  const trackerPath = path.join(ctxDir, "progress-tracker.md");
  let progressTrackerTouched = false;
  if (fs.existsSync(trackerPath) && typeof claimedAt === "number") {
    const trackerMtime = fs.statSync(trackerPath).mtimeMs;
    progressTrackerTouched = trackerMtime > claimedAt;
  }

  return {
    root: workspaceRoot,
    contextDir: "context",
    files,
    missing,
    foundCount: found.length,
    totalCount: SIX_FILE_CONTEXT.length,
    progressTrackerTouched,
  };
}

module.exports = {
  AMBIENT_CONTEXT,
  PARENT_HANDOFF_CONTEXT,
  SIX_FILE_CONTEXT,
  extractWorkspaceRoots,
  detectSixFileContext,
  detectContextInWorkspaces,
  buildContextInjection,
  detectProjectYaml,
  detectProjectYamlInWorkspaces,
  buildProjectYamlInjection,
  detectFullWorkspaceContext,
  validateSixFileContext,
};

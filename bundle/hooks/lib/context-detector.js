"use strict";

const fs = require("node:fs");
const path = require("node:path");

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
    "Bootstrap missing context: `bash scripts/init-context.sh` from pcore-agents repo."
  );
  return lines.join("\n");
}

module.exports = {
  AMBIENT_CONTEXT,
  SIX_FILE_CONTEXT,
  extractWorkspaceRoots,
  detectSixFileContext,
  detectContextInWorkspaces,
  buildContextInjection,
};

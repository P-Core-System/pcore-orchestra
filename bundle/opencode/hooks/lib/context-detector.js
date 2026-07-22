"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { findProjectIdentity, buildIdentitySummary } = require("./project-identity.js");
const { PROJECT_YAML_NAME } = require("./constants.js");

const AMBIENT_CONTEXT = [
  "Global orchestra (ambient mode ON): for implementation/fix/build/refactor tasks,",
  "run plan → implement → verify → review using Task subagents:",
  "orchestra-planner, orchestra-implementer, orchestra-verifier, orchestra-reviewer.",
  "User does NOT need to say /orchestra. Hooks auto-chain phases.",
  "Skip orchestra for pure questions/explanations. Opt out: say 'no orchestra'.",
  "Stop: /orchestra stop or node ~/.cursor/hooks/orchestra-enable.js stop",
].join(" ");

/** Stable prefix for prompt-cache — same every session when orchestra is installed. */
const PARENT_HANDOFF_CONTEXT = [
  "Orchestra parent handoff:",
  "Pass to subagents: goal (1 line) + plan summary (3–5 bullets) + prior failures only.",
  "Do NOT pass full chat history. Do NOT edit files or commit between phases.",
  "Task names: orchestra-planner | orchestra-implementer | orchestra-verifier | orchestra-reviewer.",
  "Docs: docs/agent-harness-recommendations.md | tokens: orchestra-enable.js tokens",
].join("\n");

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
    "Bootstrap missing context: `bash scripts/init-context.sh` from pcore-orchestra repo."
  );
  return lines.join("\n");
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
};

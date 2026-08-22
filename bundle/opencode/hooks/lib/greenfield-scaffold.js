"use strict";

/**
 * Greenfield auto-scaffold — detect empty repo and emit init-project instruction.
 * Does NOT execute the script from a hook (hook-quick-exit invariant).
 * Emits instruction into planner/prompt injection path for the agent to run.
 */

const fs = require("node:fs");
const path = require("node:path");
const { detectAppType, getStackRecommendation } = require("./greenfield-intake.js");

/** Source dirs / files that indicate an existing project (non-empty). */
const SOURCE_INDICATORS = [
  "src",
  "app",
  "lib",
  "pages",
  "components",
  "server",
  "api",
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "composer.json",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "makefile",
  "Makefile",
  "tsconfig.json",
  "next.config.js",
  "vite.config.ts",
  "webpack.config.js",
  "tailwind.config.ts",
  "prisma",
  "drizzle.config.ts",
];

/**
 * Check if cwd qualifies for auto-scaffold:
 * - No project.yaml / project.json
 * - No context/ directory
 * - No source indicators (src/, app/, package.json, etc.)
 * @param {string} cwd - Current working directory
 * @returns {boolean}
 */
function shouldAutoScaffold(cwd) {
  if (!cwd || !fs.existsSync(cwd)) return false;

  // Check for project identity files
  const projectYaml = path.join(cwd, "project.yaml");
  const projectJson = path.join(cwd, "project.json");
  if (fs.existsSync(projectYaml) || fs.existsSync(projectJson)) return false;

  // Check for context directory (six-file context)
  const contextDir = path.join(cwd, "context");
  if (fs.existsSync(contextDir)) return false;

  // Check for any source indicators
  for (const indicator of SOURCE_INDICATORS) {
    const full = path.join(cwd, indicator);
    if (fs.existsSync(full)) return false;
  }

  return true;
}

/**
 * Build the scaffold instruction text for agents to run init-project.
 * @param {string} appType - Detected app type from greenfield-intake (e.g., "notes", "todo", "api")
 * @param {string} goal - Original user goal text (for name inference)
 * @returns {string} Instruction text
 */
function buildScaffoldInstruction(appType, goal) {
  const stack = getStackRecommendation(appType);
  const projectType = stack.projectType;

  // Infer a project name from the goal if possible
  let inferredName = "New Project";
  const nameMatch = goal?.match(/\b(build|create|make|start|scaffold)\s+(?:a|an)?\s*([a-zA-Z][\w\s-]{1,30}?)\s*(app|application|saas|product|mvp|website|platform|tool|service|api|cli)?\b/i);
  if (nameMatch && nameMatch[2]) {
    inferredName = nameMatch[2].trim().replace(/\s+/g, " ");
    // Capitalize first letter of each word
    inferredName = inferredName
      .split(" ")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }

  const isWindows = process.platform === "win32";
  const scriptName = isWindows ? "init-project.ps1" : "init-project.sh";
  const scriptPath = `scripts/${scriptName}`;

  const lines = [
    "## Greenfield auto-scaffold",
    "",
    `This workspace has no project.yaml, no context/, and no source files — it's a fresh repo.`,
    `Detected product type: **${stack.recommended.name.split(" + ")[0]}** (${appType}) → project type: \`${projectType}\``,
    `Inferred project name: **${inferredName}**`,
    "",
    "### Run this to bootstrap the project:",
    `bash <pcore-orchestra-repo>/${scriptPath} . --type ${projectType} --name "${inferredName}"`,
    "",
    "Or interactively (guided setup):",
    `bash <pcore-orchestra-repo>/${scriptPath} .`,
    "",
    "After scaffolding, the six-file context + project.yaml will exist. Then continue with intake/planning.",
    "",
    "Note: Replace `<pcore-orchestra-repo>` with the actual path to this pcore-orchestra repository.",
    "      Usually: `~/Documents/Project/pcore/pcore-orchestra` or wherever you cloned it.",
  ];

  return lines.join("\n");
}

/**
 * Build scaffold instruction from goal text directly (convenience).
 * @param {string} goal
 * @returns {string|null} Instruction text or null if not greenfield
 */
function buildScaffoldInstructionFromGoal(goal) {
  if (!goal) return null;
  const app = detectAppType(goal);
  return buildScaffoldInstruction(app.type, goal);
}

module.exports = {
  SOURCE_INDICATORS,
  shouldAutoScaffold,
  buildScaffoldInstruction,
  buildScaffoldInstructionFromGoal,
};
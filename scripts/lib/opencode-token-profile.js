/**
 * OpenCode token + quality profile for orchestra.
 * Reduces input tokens (skills, instructions) while tuning reasoning per phase.
 *
 * Shapes are native OpenCode V2: compaction{buffer}, permissions[] entries,
 * agents[].request.body, providers[].models[].variants[]. The V1 → V2 file
 * mapping lives in lib/opencode-v2.js (opencode debug config oracle).
 */
"use strict";

const { flattenPermissions, permissionReplaceActions } = require("./opencode-v2.js");

/** Globs that inflate every request — replaced by NARROW_INSTRUCTIONS. */
const BROAD_INSTRUCTION_GLOBS = new Set([
  "**/templates/**",
  "**/context/**",
  "**/**",
  "**/AGENTS.md",
  "**/CLAUDE.md",
  "**/context/project-overview.md",
  "**/context/architecture.md",
  "**/context/code-standards.md",
  "**/context/progress-tracker.md",
]);

/** Six-file + entry only — subagents read the rest on demand. Root-relative (no leading ** prefix) to avoid monorepo scans. */
const NARROW_INSTRUCTIONS = [
  "AGENTS.md",
  "CLAUDE.md",
  "context/project-overview.md",
  "context/architecture.md",
  "context/code-standards.md",
  "context/progress-tracker.md",
];

const ORCHESTRA_SKILLS = {
  "*": "deny",
  "orchestra-loop": "allow",
  "prompt-intake": "allow",
  "verification-before-completion": "allow",
  "greenfield-product": "allow",
};

const CONDUCTOR_SKILLS = {
  "*": "deny",
  "orchestra-loop": "allow",
  "prompt-intake": "allow",
};

const PLANNER_SKILLS = {
  "*": "deny",
  "orchestra-loop": "allow",
  "prompt-intake": "allow",
};

const IMPLEMENTER_SKILLS = {
  "*": "deny",
  "orchestra-loop": "allow",
  "verification-before-completion": "allow",
};

const VERIFIER_SKILLS = {
  "*": "deny",
  "orchestra-loop": "allow",
  "verification-before-completion": "allow",
};

const REVIEWER_SKILLS = {
  "*": "deny",
  "orchestra-loop": "allow",
  "verification-before-completion": "allow",
};

/** V2 compaction: reserve for compaction output as `buffer` (V1: reserved). */
const COMPACTION = {
  auto: true,
  buffer: 6000,
};

const TOOL_OUTPUT = {
  max_lines: 300,
  max_bytes: 12288,
};

const REASONING = {
  conductor: { reasoningEffort: "low", textVerbosity: "low" },
  planner: { reasoningEffort: "medium", textVerbosity: "medium" },
  implementer: { reasoningEffort: "medium", textVerbosity: "medium" },
  verifier: { reasoningEffort: "low", textVerbosity: "low" },
  reviewer: { reasoningEffort: "medium", textVerbosity: "low" },
};

/** Replace the agent/config-level `skill` permission group with scoped rules. */
function applySkillPermissions(cfg, skills) {
  cfg.permissions = permissionReplaceActions(
    cfg.permissions,
    flattenPermissions({ skill: skills })
  );
}

/** Move reasoning knobs into request.body (V2 agent shape). */
function applyRequestBody(cfg, knobs) {
  const request = cfg.request && typeof cfg.request === "object" ? { ...cfg.request } : {};
  request.body = { ...(request.body || {}), ...knobs };
  cfg.request = request;
}

function applyAgentTokenProfile(name, cfg) {
  if (!cfg || typeof cfg !== "object") return cfg;
  const out = { ...cfg };

  if (name === "orchestra") {
    applyRequestBody(out, REASONING.conductor);
    applySkillPermissions(out, CONDUCTOR_SKILLS);
  } else if (name === "orchestra-planner") {
    applyRequestBody(out, REASONING.planner);
    applySkillPermissions(out, PLANNER_SKILLS);
  } else if (name === "orchestra-implementer") {
    applyRequestBody(out, REASONING.implementer);
    applySkillPermissions(out, IMPLEMENTER_SKILLS);
  } else if (name === "orchestra-verifier") {
    applyRequestBody(out, REASONING.verifier);
    applySkillPermissions(out, VERIFIER_SKILLS);
  } else if (name === "orchestra-reviewer") {
    applyRequestBody(out, REASONING.reviewer);
    applySkillPermissions(out, REVIEWER_SKILLS);
  }

  return out;
}

/**
 * @param {Record<string, unknown>} dest V2 opencode.json object (mutated)
 * @param {{ supportsToolOutput?: boolean }} [opts]
 * @returns {{ changed: string[] }}
 */
function applyTokenProfile(dest, opts = {}) {
  const changed = [];

  dest.compaction = { ...(dest.compaction || {}), ...COMPACTION };
  changed.push("compaction");

  if (opts.supportsToolOutput !== false) {
    dest.tool_output = { ...(dest.tool_output || {}), ...TOOL_OUTPUT };
    changed.push("tool_output");
  }

  dest.instructions = [...NARROW_INSTRUCTIONS];
  changed.push("instructions(narrow)");

  dest.permissions = permissionReplaceActions(
    dest.permissions,
    flattenPermissions({ skill: ORCHESTRA_SKILLS })
  );
  changed.push("permissions(skill deny-by-default)");

  dest.agents = dest.agents || {};
  for (const [name, cfg] of Object.entries(dest.agents)) {
    if (name === "orchestra" || name.startsWith("orchestra-")) {
      dest.agents[name] = applyAgentTokenProfile(name, cfg);
    }
  }
  changed.push("agents.reasoning+skill-scope");

  dest.providers = dest.providers || {};
  dest.providers.opencode = dest.providers.opencode || {};
  dest.providers.opencode.models = dest.providers.opencode.models || {};
  const mimo = dest.providers.opencode.models["mimo-v2.6-flash-free"] || {};
  const existingVariants = Array.isArray(mimo.variants)
    ? mimo.variants
    : Object.entries(
        mimo.variants && typeof mimo.variants === "object" ? mimo.variants : {}
      ).map(([id, settings]) => ({ id, settings }));
  const defaults = [
    { id: "fast", settings: { reasoningEffort: "low", textVerbosity: "low" } },
    { id: "quality", settings: { reasoningEffort: "medium", textVerbosity: "medium" } },
  ];
  for (const def of defaults) {
    // Existing entries win (V1 semantics: existing spread over defaults).
    if (!existingVariants.some((v) => v && v.id === def.id)) {
      existingVariants.push(def);
    }
  }
  dest.providers.opencode.models["mimo-v2.6-flash-free"] = {
    ...mimo,
    variants: existingVariants,
  };
  changed.push("providers.variants");

  return { changed };
}

function filterBroadInstructions(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((g) => typeof g === "string" && !BROAD_INSTRUCTION_GLOBS.has(g));
}

module.exports = {
  BROAD_INSTRUCTION_GLOBS,
  NARROW_INSTRUCTIONS,
  ORCHESTRA_SKILLS,
  COMPACTION,
  TOOL_OUTPUT,
  REASONING,
  applyTokenProfile,
  applyAgentTokenProfile,
  filterBroadInstructions,
};

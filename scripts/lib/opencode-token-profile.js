/**
 * OpenCode token + quality profile for orchestra.
 * Reduces input tokens (skills, instructions) while tuning reasoning per phase.
 */
"use strict";

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

const COMPACTION = {
  auto: true,
  prune: true,
  reserved: 6000,
  tail_turns: 12,
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

function mergeSkillPermission(base, scoped) {
  return { ...(base || {}), ...scoped };
}

function applyAgentTokenProfile(name, cfg) {
  if (!cfg || typeof cfg !== "object") return cfg;
  const out = { ...cfg };

  if (name === "orchestra") {
    Object.assign(out, REASONING.conductor);
    out.permission = {
      ...(out.permission || {}),
      skill: mergeSkillPermission(out.permission?.skill, CONDUCTOR_SKILLS),
    };
  } else if (name === "orchestra-planner") {
    Object.assign(out, REASONING.planner);
    out.permission = {
      ...(out.permission || {}),
      skill: mergeSkillPermission(out.permission?.skill, PLANNER_SKILLS),
    };
  } else if (name === "orchestra-implementer") {
    Object.assign(out, REASONING.implementer);
    out.permission = {
      ...(out.permission || {}),
      skill: mergeSkillPermission(out.permission?.skill, IMPLEMENTER_SKILLS),
    };
  } else if (name === "orchestra-verifier") {
    Object.assign(out, REASONING.verifier);
    out.permission = {
      ...(out.permission || {}),
      skill: mergeSkillPermission(out.permission?.skill, VERIFIER_SKILLS),
    };
  } else if (name === "orchestra-reviewer") {
    Object.assign(out, REASONING.reviewer);
    out.permission = {
      ...(out.permission || {}),
      skill: mergeSkillPermission(out.permission?.skill, REVIEWER_SKILLS),
    };
  }

  return out;
}

/**
 * @param {Record<string, unknown>} dest opencode.json object (mutated)
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

  dest.permission = dest.permission || {};
  dest.permission.skill = { ...ORCHESTRA_SKILLS };
  changed.push("permission.skill(deny-by-default)");

  dest.agent = dest.agent || {};
  for (const [name, cfg] of Object.entries(dest.agent)) {
    if (name === "orchestra" || name.startsWith("orchestra-")) {
      dest.agent[name] = applyAgentTokenProfile(name, cfg);
    }
  }
  changed.push("agent.reasoning+skill-scope");

  dest.provider = dest.provider || {};
  dest.provider.opencode = dest.provider.opencode || {};
  dest.provider.opencode.models = {
    ...(dest.provider.opencode.models || {}),
    "muse-spark-1.2-contributor-free (ox-alpha)": {
      variants: {
        fast: { reasoningEffort: "low", textVerbosity: "low" },
        quality: { reasoningEffort: "medium", textVerbosity: "medium" },
      },
      ...(dest.provider.opencode.models?.["muse-spark-1.2-contributor-free (ox-alpha)"] || {}),
    },
    "mimo-v2.5-free": {
      variants: {
        fast: { reasoningEffort: "low", textVerbosity: "low" },
      },
      ...(dest.provider.opencode.models?.["mimo-v2.5-free"] || {}),
    },
  };
  changed.push("provider.variants");

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

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
const {
  INDEXED_SKILLS,
  VISIBLE_SUBAGENTS,
  COMPACTION_KEEP_TOKENS,
  STEP_BUDGET,
  clampSteps,
} = require("./context-budget.js");

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
];

/**
 * Agents OpenCode treats as built-in system/primary roles. They carry no
 * `mode` in config but resolve to `primary`; hiding them breaks title
 * generation, compaction summaries, and the built-in plan/explore modes.
 * Never touched by the index diet.
 * @type {ReadonlySet<string>}
 */
const RESERVED_AGENTS = new Set([
  "title",
  "compaction",
  "summary",
  "general",
  "explore",
  "build",
  "plan",
]);

/**
 * Skill allowlist SSOT lives in lib/context-budget.js so the agent index diet
 * and the permission rules can never disagree about what is available.
 */
const ORCHESTRA_SKILLS = (() => {
  const base = { "*": "deny" };
  for (const name of INDEXED_SKILLS) base[name] = "allow";
  return base;
})();

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

/** V2 compaction: reserve for compaction output as `buffer` (V1: reserved).
 *  `keep.tokens` bounds the verbatim history carried into every call — the
 *  single biggest per-request cost on long-running team sessions. */
const COMPACTION = {
  auto: true,
  buffer: 16000,
  background: false,
  keep: { tokens: COMPACTION_KEEP_TOKENS },
};

/**
 * `warming` sends transient model requests to keep sessions warm — pure quota
 * burn on a per-day request-limited free pool. Pinned off, alongside the
 * startup network check.
 */
const STARTUP = {
  warming: false,
  update: "disable",
};

const TOOL_OUTPUT = {
  max_lines: 300,
  max_bytes: 65536,
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

  for (const [k, v] of Object.entries(STARTUP)) dest[k] = v;
  changed.push("startup(warming:false,update:disable)");

  dest.compaction = { ...(dest.compaction || {}), ...COMPACTION };
  changed.push("compaction");
  // keep.tokens is nested: shallow-spread of COMPACTION alone would drop it if
  // a legacy config carried compaction.keep with other fields.
  dest.compaction.keep = { ...(dest.compaction.keep || {}), tokens: COMPACTION_KEEP_TOKENS };

  if (opts.supportsToolOutput !== false) {
    dest.tool_output = { ...(dest.tool_output || {}), ...TOOL_OUTPUT };
    changed.push("tool_output");
  }

  dest.instructions = [...NARROW_INSTRUCTIONS];
  // Mirror the title model onto the compaction agent so summaries do not fall
  // back to the (heavier) primary model. Defensive: an config without a `title`
  // entry must not throw during install/merge.
  dest.agents = dest.agents || {};
  const titleModel = dest.agents.title && dest.agents.title.model;
  if (titleModel) dest.agents.compaction = { ...(dest.agents.compaction || {}), model: titleModel };
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

  // Agent index diet: OpenCode inlines name+description of every non-hidden
  // agent into every request. Config-defined subagents were the leftovers that
  // kept ~20 specialists visible even after the file mirrors were hidden.
  // Hidden stays spawnable by name (how the 4 phase agents have always worked).
  let diet = 0;
  for (const [name, cfg] of Object.entries(dest.agents)) {
    if (!cfg || typeof cfg !== "object") continue;
    // Built-in system agents (title/compaction/general/...) are never touched:
    // hiding them breaks title generation and compaction summaries.
    if (RESERVED_AGENTS.has(name)) continue;
    // Step ceilings apply to every orchestra agent, primary included — the
    // conductor is the largest single consumer of the per-day request quota.
    const capped = clampSteps(name, cfg.steps);
    if (capped !== cfg.steps) cfg.steps = capped;
    if (cfg.mode === "primary") continue;
    if (VISIBLE_SUBAGENTS.has(name)) continue;
    if (cfg.hidden !== true) {
      cfg.hidden = true;
      diet++;
    }
  }
  changed.push(`agents.index-diet(hidden:${diet})`);

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
  COMPACTION_KEEP_TOKENS,
  STARTUP,
  RESERVED_AGENTS,
  STEP_BUDGET,
  TOOL_OUTPUT,
  REASONING,
  applyTokenProfile,
  applyAgentTokenProfile,
  filterBroadInstructions,
};

/**
 * Sanitize opencode.json for the installed OpenCode runtime.
 *
 * Keys in the online schema may arrive before the desktop sidecar / CLI build
 * accepts them. Unknown top-level keys cause ConfigInvalidError.
 */
"use strict";

const { getOpenCodeVersion, supportsToolOutput, MIN_TOOL_OUTPUT_VERSION } =
  require("./opencode-version.js");

/** Keys gated by OpenCode version (not unconditionally unsupported). */
const VERSION_GATED_KEYS = ["tool_output"];

/**
 * OpenCode expects instructions as string[] (glob patterns), not a keyed object.
 * @param {unknown} value
 * @returns {string[] | undefined}
 */
function normalizeInstructions(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.filter((x) => typeof x === "string" && x.length > 0))];
  }
  if (value && typeof value === "object") {
    const patterns = Object.values(value).filter(
      (x) => typeof x === "string" && x.length > 0
    );
    const unique = [...new Set(patterns)];
    return unique.length > 0 ? unique : undefined;
  }
  return undefined;
}

/**
 * @param {Record<string, unknown>} cfg
 * @param {{ version?: string | null }} [opts]
 * @returns {{ config: Record<string, unknown>, removed: string[], fixed: string[], version: string | null, supportsToolOutput: boolean }}
 */
function sanitizeOpenCodeConfig(cfg, opts = {}) {
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) {
    return {
      config: cfg,
      removed: [],
      fixed: [],
      version: opts.version ?? getOpenCodeVersion(),
      supportsToolOutput: supportsToolOutput(opts.version),
    };
  }

  const version = opts.version ?? getOpenCodeVersion();
  const toolOutputOk = supportsToolOutput(version);
  const removed = [];
  const fixed = [];
  const config = { ...cfg };

  for (const key of VERSION_GATED_KEYS) {
    if (key === "tool_output" && toolOutputOk) continue;
    if (Object.prototype.hasOwnProperty.call(config, key)) {
      delete config[key];
      removed.push(key);
    }
  }

  if (config.instructions !== undefined) {
    const normalized = normalizeInstructions(config.instructions);
    if (!Array.isArray(config.instructions) || normalized?.join() !== config.instructions.join()) {
      fixed.push("instructions");
    }
    if (normalized) config.instructions = normalized;
    else delete config.instructions;
  }

  return { config, removed, fixed, version, supportsToolOutput: toolOutputOk };
}

module.exports = {
  VERSION_GATED_KEYS,
  MIN_TOOL_OUTPUT_VERSION,
  normalizeInstructions,
  sanitizeOpenCodeConfig,
  getOpenCodeVersion,
  supportsToolOutput,
};

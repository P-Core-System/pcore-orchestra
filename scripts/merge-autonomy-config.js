#!/usr/bin/env node
/**
 * merge-autonomy-config.js — apply orchestra autonomy defaults during install.
 *
 * Usage:
 *   node scripts/merge-autonomy-config.js --cursor [--cursor-home PATH]
 *   node scripts/merge-autonomy-config.js --opencode [--opencode-home PATH]
 *   node scripts/merge-autonomy-config.js --all
 *
 * Preserves: Cursor auth/model caches; OpenCode mcp.* secrets.
 * Writes: permissions.json, sandbox.json; merges cli-config + opencode.json.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const {
  sanitizeOpenCodeConfig,
  supportsToolOutput,
  normalizeInstructions,
  MIN_TOOL_OUTPUT_VERSION,
} = require("./lib/opencode-config-sanitize.js");
const {
  applyTokenProfile,
  filterBroadInstructions,
  NARROW_INSTRUCTIONS,
} = require("./lib/opencode-token-profile.js");

const ROOT = path.resolve(__dirname, "..");
const CONFIG = path.join(ROOT, "bundle", "config");
const HOME = process.env.HOME || process.env.USERPROFILE || os.homedir();

function expandHome(value) {
  if (typeof value !== "string") return value;
  return value
    .replace(/\$HOME/g, HOME)
    .replace(/^~\//, HOME + path.sep)
    .replace(/^~(?=[\\/]|$)/, HOME);
}

function expandDeep(value) {
  if (Array.isArray(value)) return value.map(expandDeep);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = expandDeep(v);
    return out;
  }
  return expandHome(value);
}

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function uniq(arr) {
  return [...new Set((arr || []).filter((x) => typeof x === "string"))];
}

function backup(file) {
  if (!fs.existsSync(file)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = `${file}.bak.${stamp}`;
  fs.copyFileSync(file, dest);
  return dest;
}

function mergeCliAutonomy(cursorHome) {
  const patch = readJson(path.join(CONFIG, "cursor", "cli-autonomy.json"));
  if (!patch) throw new Error("missing bundle/config/cursor/cli-autonomy.json");
  const destPath = path.join(cursorHome, "cli-config.json");
  const dest = readJson(destPath, { version: 1, permissions: { allow: [], deny: [] } });
  backup(destPath);

  dest.permissions = dest.permissions || { allow: [], deny: [] };
  dest.permissions.allow = uniq([
    ...(dest.permissions.allow || []),
    ...(patch.permissions?.allow || []),
  ]);
  if (Array.isArray(patch.permissions?.deny)) {
    dest.permissions.deny = uniq([
      ...(dest.permissions.deny || []),
      ...patch.permissions.deny,
    ]);
  }

  dest.approvalMode = patch.approvalMode || dest.approvalMode || "unrestricted";
  dest.autoAcceptWebSearch =
    patch.autoAcceptWebSearch !== undefined
      ? patch.autoAcceptWebSearch
      : dest.autoAcceptWebSearch;
  dest.webFetchDomainAllowlist = uniq([
    ...(dest.webFetchDomainAllowlist || []),
    ...(patch.webFetchDomainAllowlist || []),
  ]);
  if (patch.sandbox) {
    dest.sandbox = { ...(dest.sandbox || {}), ...patch.sandbox };
  }

  writeJson(destPath, dest);
  console.log("  Merged Cursor CLI autonomy ->", destPath);
}

function writeCursorPermissions(cursorHome) {
  const src = readJson(path.join(CONFIG, "cursor", "permissions.json"));
  if (!src) throw new Error("missing bundle/config/cursor/permissions.json");
  const destPath = path.join(cursorHome, "permissions.json");
  backup(destPath);
  const existing = readJson(destPath, {});
  const merged = {
    terminalAllowlist: uniq([
      ...(existing.terminalAllowlist || []),
      ...(src.terminalAllowlist || []),
    ]),
    mcpAllowlist: uniq([...(existing.mcpAllowlist || []), ...(src.mcpAllowlist || [])]),
    autoRun: {
      allow_instructions: uniq([
        ...(existing.autoRun?.allow_instructions || []),
        ...(src.autoRun?.allow_instructions || []),
      ]),
      block_instructions: uniq([
        ...(existing.autoRun?.block_instructions || []),
        ...(src.autoRun?.block_instructions || []),
      ]),
    },
  };
  writeJson(destPath, merged);
  console.log("  Updated Cursor permissions.json ->", destPath);
}

function writeCursorSandbox(cursorHome) {
  const src = expandDeep(readJson(path.join(CONFIG, "cursor", "sandbox.json")));
  if (!src) throw new Error("missing bundle/config/cursor/sandbox.json");
  const destPath = path.join(cursorHome, "sandbox.json");
  backup(destPath);
  const existing = expandDeep(readJson(destPath, {})) || {};
  const merged = {
    type: src.type || existing.type || "workspace_readwrite",
    enableSharedBuildCache:
      src.enableSharedBuildCache ?? existing.enableSharedBuildCache ?? true,
    additionalReadwritePaths: uniq([
      ...(existing.additionalReadwritePaths || []),
      ...(src.additionalReadwritePaths || []),
    ]),
    additionalReadonlyPaths: uniq([
      ...(existing.additionalReadonlyPaths || []),
      ...(src.additionalReadonlyPaths || []),
    ]),
    networkPolicy: {
      ...(existing.networkPolicy || {}),
      ...(src.networkPolicy || {}),
      allow: uniq([
        ...(existing.networkPolicy?.allow || []),
        ...(src.networkPolicy?.allow || []),
      ]),
      deny: uniq([
        ...(existing.networkPolicy?.deny || []),
        ...(src.networkPolicy?.deny || []),
      ]),
    },
  };
  writeJson(destPath, merged);
  console.log("  Updated Cursor sandbox.json ->", destPath);
}

const DEAD_OR_UNRELIABLE_MODELS = new Set([
  // Dead / removed from catalog
  "opencode/hy3-free",
  "opencode/x-preview-f-free",
  // Region-blocked (Myanmar and other locales)
  "opencode/muse-spark-1.2-contributor-free",
  "opencode/muse-spark-1.3-contributor-free",
  "opencode/muse-spark-1.2",
  // Timeout / server errors / not supported
  "opencode/deepseek-v4-flash-free",
  "opencode/nemotron-3-ultra-free",
  "opencode/nemotron-3.5-lightning-free",
  "opencode/north-mini-code-free",
  "opencode/ling-3.0-flash-free",
]);

/**
 * Load the live free-model cache + pools for an OpenCode home.
 * Returns null when absent/empty (offline first-run) so callers can fall
 * back to the static deny-list above.
 */
function loadFreeModelCache(opencodeHome) {
  const cacheFile = path.join(opencodeHome, "state", "free-models.json");
  const poolsFile = path.join(opencodeHome, "state", "model-pools.json");
  const probesFile = path.join(opencodeHome, "state", "probes.json");
  const cache = readJson(cacheFile);
  if (!cache || !Array.isArray(cache.models) || cache.models.length === 0) {
    return null;
  }
  const poolsData = readJson(poolsFile, {});
  const pools = (poolsData && poolsData.pools) || {};
  const probes = readJson(probesFile) || {};
  return { models: cache.models, modelSet: new Set(cache.models), pools, probes };
}

/** Pick primary (light free) + heavy fallback from cache pools — no hardcoded IDs.
 * Verified-reachable models (per probes.json) are preferred over unverified ones.
 */
function pickCacheModels(cache) {
  const inModels = (id) => cache.modelSet.has(id);
  const light = ((cache.pools.light || []).map((e) => e.id) || []).filter(inModels);
  const heavy = ((cache.pools.heavy || []).map((e) => e.id) || []).filter(inModels);
  const frontend = ((cache.pools.frontend || []).map((e) => e.id) || []).filter(inModels);

  const probes = cache.probes || {};
  function isReachable(id) {
    return probes[id] && probes[id].reachable === true;
  }

  const reachableLight = light.filter(isReachable);
  const primary = reachableLight[0] || light[0] || cache.models[0];

  const reachableHeavy = heavy.filter((id) => isReachable(id) && id !== primary);
  const heavyId =
    reachableHeavy[0] ||
    heavy.find((id) => id !== primary) ||
    frontend.find((id) => id !== primary) ||
    cache.models.find((id) => id !== primary) ||
    primary;
  return { primary: `opencode/${primary}`, heavy: `opencode/${heavyId}` };
}

function bareModel(model) {
  return typeof model === "string" && model.includes("/")
    ? model.slice(model.lastIndexOf("/") + 1)
    : model;
}

/**
 * Replace dead/unreliable agent models.
 * Cache-backed when state/free-models.json exists (membership = source of
 * truth; free-tier ids missing from the live catalog get replaced). Static
 * deny-list is consulted only when the cache is absent (offline first-run).
 */
function patchUnreliableAgentModels(dest, opencodeHome) {
  const agents = dest.agent || {};
  const cache = loadFreeModelCache(opencodeHome);
  const { primary, heavy } = cache ? pickCacheModels(cache) : {};

  for (const [name, cfg] of Object.entries(agents)) {
    if (!cfg || typeof cfg !== "object" || !cfg.model) continue;
    let shouldReplace = false;

    if (cache) {
      const bare = bareModel(cfg.model);
      // Only manage free-tier refs; leave custom/paid provider models alone.
      shouldReplace = String(bare).endsWith("-free") && !cache.modelSet.has(bare);
    } else {
      shouldReplace = DEAD_OR_UNRELIABLE_MODELS.has(cfg.model);
    }

    if (!shouldReplace) continue;
    if (cache) {
      cfg.model = name.includes("verifier") || name === "explore" ? primary : heavy;
    } else {
      // Offline fallback: pick from installed free-tier model refs
      const offlinePick = pickOfflineModels(dest);
      cfg.model = name.includes("verifier") || name === "explore"
        ? offlinePick.primary
        : offlinePick.heavy;
    }
  }
}

/** Offline fallback: pick primary/heavy from installed config model refs. */
function pickOfflineModels(dest) {
  const models = new Set();
  const agent = dest.agent || {};
  for (const cfg of Object.values(agent)) {
    if (cfg && cfg.model && String(cfg.model).startsWith("opencode/")) {
      models.add(cfg.model.split("/").pop());
    }
  }
  const primary = models.has("mimo-v2.6-flash-free")
    ? "opencode/mimo-v2.6-flash-free"
    : models.size > 0 ? `opencode/${[...models][0]}` : "opencode/mimo-v2.6-flash-free";
  const heavy = primary;
  return { primary, heavy };
}

function mergeOrchestraAgents(dest, patchAgents) {
  dest.agent = dest.agent || {};
  for (const [name, cfg] of Object.entries(patchAgents || {})) {
    if (name === "orchestra" || name.startsWith("orchestra-")) {
      const existing = dest.agent[name] || {};
      const bundleSteps = cfg.steps || 200;
      const userSteps = existing.steps || 0;
      dest.agent[name] = { ...cfg, steps: Math.max(bundleSteps, userSteps) };
    }
  }
}

function mergeOpenCodeAutonomy(opencodeHome) {
  const patch = readJson(path.join(CONFIG, "opencode", "autonomy.json"));
  if (!patch) throw new Error("missing bundle/config/opencode/autonomy.json");
  const destPath = path.join(opencodeHome, "opencode.json");
  const dest = readJson(destPath, { $schema: "https://opencode.ai/config.json" });
  backup(destPath);

  // Preserve MCP / secrets entirely
  const mcp = dest.mcp;

  if (patch.model) dest.model = patch.model;
  if (patch.small_model) dest.small_model = patch.small_model;
  if (patch.default_agent) dest.default_agent = patch.default_agent;
  dest.compaction = { ...(dest.compaction || {}), ...(patch.compaction || {}) };
  if (patch.tool_output && supportsToolOutput()) {
    dest.tool_output = { ...(dest.tool_output || {}), ...patch.tool_output };
  }
  if (patch.watcher) dest.watcher = { ...(dest.watcher || {}), ...patch.watcher };
  if (patch.snapshot !== undefined) dest.snapshot = patch.snapshot;
  dest.permission = { ...(dest.permission || {}), ...(patch.permission || {}) };
  mergeOrchestraAgents(dest, patch.agent);
  patchUnreliableAgentModels(dest, opencodeHome);

  // Replace broad instruction globs (do not union — union kept **/templates/** forever)
  if (patch.instructions) {
    const incoming = normalizeInstructions(patch.instructions) || NARROW_INSTRUCTIONS;
    dest.instructions = incoming;
  } else {
    const existing = filterBroadInstructions(normalizeInstructions(dest.instructions) || []);
    dest.instructions =
      existing.length > 0 ? existing : [...NARROW_INSTRUCTIONS];
  }

  const toolOk = supportsToolOutput();
  applyTokenProfile(dest, { supportsToolOutput: toolOk });
  if (patch.provider) {
    dest.provider = dest.provider || {};
    for (const [k, v] of Object.entries(patch.provider)) {
      dest.provider[k] = { ...(dest.provider[k] || {}), ...v };
      if (v.models && dest.provider[k].models) {
        dest.provider[k].models = { ...(dest.provider[k].models || {}), ...v.models };
      }
    }
  }
  if (mcp) dest.mcp = mcp;

  const { config: sanitized, removed, fixed, version, supportsToolOutput: toolOkSanitize } =
    sanitizeOpenCodeConfig(dest);
  if (removed.length > 0) {
    console.log(
      "  Stripped unsupported opencode.json keys:",
      removed.join(", "),
      `(OpenCode ${version || "unknown"}; need >= ${MIN_TOOL_OUTPUT_VERSION} for tool_output)`
    );
  }
  if (fixed.length > 0) {
    console.log("  Normalized opencode.json fields:", fixed.join(", "));
  } else if (sanitized.tool_output) {
    console.log("  tool_output limits applied (OpenCode", version + ")");
  }

  writeJson(destPath, sanitized);
  console.log("  Merged OpenCode autonomy ->", destPath);
  console.log("  Token profile: narrow instructions, skill deny-by-default, phase reasoning tuned");
  console.log("  Tip: start OpenCode with --auto for session auto-approve");
}

function parseArgs(argv) {
  const out = {
    cursor: false,
    opencode: false,
    cursorHome: process.env.CURSOR_HOME || path.join(HOME, ".cursor"),
    opencodeHome:
      process.env.OPENCODE_CONFIG_DIR || path.join(HOME, ".config", "opencode"),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") {
      out.cursor = true;
      out.opencode = true;
    } else if (a === "--cursor") out.cursor = true;
    else if (a === "--opencode") out.opencode = true;
    else if (a === "--cursor-home") out.cursorHome = argv[++i];
    else if (a === "--opencode-home") out.opencodeHome = argv[++i];
  }
  if (!out.cursor && !out.opencode) {
    out.cursor = true;
    out.opencode = true;
  }
  return out;
}

function validateCursorAgentModels(repoRoot) {
  const agentsDir = path.join(repoRoot, "bundle", "agents");
  if (!fs.existsSync(agentsDir)) return;
  const required = [
    "orchestra.md",
    "orchestra-planner.md",
    "orchestra-implementer.md",
    "orchestra-verifier.md",
    "orchestra-reviewer.md",
  ];
  let ok = 0;
  for (const f of required) {
    const fp = path.join(agentsDir, f);
    if (!fs.existsSync(fp)) {
      console.warn(`  Missing agent: ${fp}`);
      continue;
    }
    const text = fs.readFileSync(fp, "utf8");
    if (/^model:\s*composer-2\.5/m.test(text)) {
      ok += 1;
    } else {
      console.warn(
        `  ${f}: missing or wrong model frontmatter (expected model: composer-2.5)`
      );
    }
  }
  console.log(`  Validated ${ok}/${required.length} Cursor agents pinned to composer-2.5`);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  console.log("==> Applying orchestra autonomy config");
  if (opts.cursor) {
    mergeCliAutonomy(opts.cursorHome);
    writeCursorPermissions(opts.cursorHome);
    writeCursorSandbox(opts.cursorHome);
    console.log(
      "  Manual: Cursor Settings → Agents → Approvals & Execution → Auto-review"
    );
    console.log(
      "  Manual: Cursor model picker → Composer 2.5 (standard) or run scripts/setup-cursor-model.sh"
    );
    validateCursorAgentModels(ROOT);
  }
  if (opts.opencode) {
    fs.mkdirSync(opts.opencodeHome, { recursive: true });
    mergeOpenCodeAutonomy(opts.opencodeHome);
  }
  console.log("==> Autonomy config done");
}

main();

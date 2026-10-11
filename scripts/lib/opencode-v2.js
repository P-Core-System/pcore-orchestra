/**
 * opencode-v2.js — pure V1 → V2 opencode.json migration.
 *
 * The mapping is derived from `opencode debug config` (OpenCode 2.0.26),
 * which normalizes a V1 config into its V2 effective shape. migrateConfig()
 * reproduces that normalization as a file transformation so that
 * normalize(migrate(cfg)) === normalize(cfg) — i.e. behavior-preserving.
 * The equivalence is enforced by scripts/test-opencode-v2.js (oracle part).
 *
 * Rules (root):
 *   permission{}      → permissions[]  [{action,resource,effect}], bash→shell,
 *                      task→subagent; nested group {res:eff} expands per entry;
 *                      order preserved (V2 evaluation is last-match-wins)
 *   autoupdate        → update
 *   snapshot          → snapshots
 *   compaction        reserved→buffer, preserve_recent_tokens→keep.tokens,
 *                      prune/tail_turns dropped (unsupported)
 *   enabled_providers → experimental.policies (deny provider.use * first)
 *   provider{}        → providers{}; npm→package ("aisdk:" prefix for
 *                      @ai-sdk/*), options→settings; model.id→modelID;
 *                      variants{} → variants[{id,settings}]
 *   mcp{}             → mcp.servers{}; enabled→disabled (inverted, always
 *                      explicit); timeout number → {catalog,execution}
 *   agent{} + small_model → agents{}; small_model → agents.title.model
 *   skills{}          → skills[] (invalid object shape normalizes to [])
 *   command{}         → commands{}
 *   hooks             → dropped (not a config key; V2 hooks live in plugins)
 *   instructions      array passthrough; non-array dropped (runtime rejects)
 *   tool_output       passthrough (valid V2)
 *
 * Rules (agent entry):
 *   prompt→system, maxSteps→steps, disable→disabled, permission→permissions[]
 *   reasoningEffort/textVerbosity/temperature/reference/attachment and any
 *   other unrecognized key → request.body.<key>
 *   model + variant → "provider/model#variant"
 *   description/mode/steps/disabled/hidden/permissions/system/model/request
 *   stay top-level (so re-migration is a no-op)
 */
"use strict";

const PERMISSION_ACTION_RENAMES = { bash: "shell", task: "subagent" };

/** V2 agent top-level keys — everything else lands in request.body. */
const AGENT_KEEP_KEYS = new Set([
  "description",
  "mode",
  "model",
  "system",
  "steps",
  "disabled",
  "permissions",
  "hidden",
  "request",
  // V1 keys mapped below (they are consumed before the sweep):
  "prompt",
  "maxSteps",
  "disable",
  "permission",
  "variant",
  "reasoningEffort",
  "textVerbosity",
]);

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function deepCopy(v) {
  if (Array.isArray(v)) return v.map(deepCopy);
  if (isPlainObject(v)) {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = deepCopy(val);
    return out;
  }
  return v;
}

function renameAction(action) {
  return PERMISSION_ACTION_RENAMES[action] || action;
}

/**
 * V1 permission object → ordered V2 permissions[].
 * Already-V2 arrays pass through (copied).
 * @returns {Array<{action: string, resource: string, effect: unknown}>}
 */
function flattenPermissions(permission) {
  if (Array.isArray(permission)) return permission.map(deepCopy);
  if (!isPlainObject(permission)) return [];
  const out = [];
  for (const [key, value] of Object.entries(permission)) {
    const action = renameAction(key);
    if (isPlainObject(value)) {
      for (const [resource, effect] of Object.entries(value)) {
        out.push({ action, resource, effect });
      }
    } else if (value !== undefined && value !== null) {
      out.push({ action, resource: "*", effect: value });
    }
  }
  return out;
}

/**
 * V1 object-spread semantics applied to V2 permissions arrays:
 * patch actions replace base entries in place (first-occurrence slot),
 * new patch actions append at the end. Last-match-wins evaluation means
 * only same-action ordering is observable — this mirrors
 * {...base.permission, ...patch.permission} exactly.
 */
function permissionReplaceActions(base, patch) {
  const b = Array.isArray(base) ? base : [];
  const p = Array.isArray(patch) ? patch : [];
  if (p.length === 0) return b.map(deepCopy);
  const baseActions = new Set(b.filter(Boolean).map((e) => e.action));
  const replacing = p.filter((e) => e && baseActions.has(e.action));
  const appending = p.filter((e) => !e || !baseActions.has(e.action));
  const replaceActions = new Set(replacing.map((e) => e.action));
  const out = [];
  let inserted = false;
  for (const entry of b) {
    if (entry && replaceActions.has(entry.action)) {
      if (!inserted) {
        out.push(...replacing.map(deepCopy));
        inserted = true;
      }
    } else {
      out.push(deepCopy(entry));
    }
  }
  if (!inserted) out.push(...replacing.map(deepCopy));
  out.push(...appending.map(deepCopy));
  return out;
}

function migratePermissionGroup(value) {
  return flattenPermissions(value);
}

function migrateMcp(mcp) {
  if (!isPlainObject(mcp)) return deepCopy(mcp);
  // Both shapes end up under mcp.servers (V2); a V1 mcp map of servers is
  // re-homed, an already-V2 servers map is transformed in place.
  const isV2 = isPlainObject(mcp.servers);
  const source = isV2 ? mcp.servers : mcp;
  const out = {};
  for (const [name, srv] of Object.entries(source)) {
    if (!isPlainObject(srv)) {
      out[name] = deepCopy(srv);
      continue;
    }
    const entry = {};
    for (const [k, v] of Object.entries(srv)) {
      if (k === "enabled") continue; // inverted below
      if (k === "timeout" && typeof v === "number") {
        entry.timeout = { catalog: v, execution: v };
        continue;
      }
      entry[k] = deepCopy(v);
    }
    if (typeof srv.enabled === "boolean") entry.disabled = !srv.enabled;
    out[name] = entry;
  }
  return { servers: out };
}

function migrateVariants(variants) {
  if (Array.isArray(variants)) return variants.map(deepCopy);
  if (!isPlainObject(variants)) return deepCopy(variants);
  const out = [];
  for (const [id, settings] of Object.entries(variants)) {
    out.push({ id, settings: deepCopy(settings) });
  }
  return out;
}

function migrateProviderModels(models) {
  if (!isPlainObject(models)) return deepCopy(models);
  const out = {};
  for (const [name, model] of Object.entries(models)) {
    if (!isPlainObject(model)) {
      out[name] = deepCopy(model);
      continue;
    }
    const entry = {};
    for (const [k, v] of Object.entries(model)) {
      if (k === "variants") entry.variants = migrateVariants(v);
      else if (k === "id") entry.modelID = v;
      else entry[k] = deepCopy(v); // runtime drops invalid keys on read
    }
    out[name] = entry;
  }
  return out;
}

function migrateProvider(provider) {
  if (!isPlainObject(provider)) return deepCopy(provider);
  const out = {};
  for (const [field, value] of Object.entries(provider)) {
    if (field === "npm") {
      const pkg = String(value);
      out.package = pkg.startsWith("@ai-sdk/") ? `aisdk:${pkg}` : pkg;
    } else if (field === "options") {
      out.settings = deepCopy(value);
    } else if (field === "models") {
      out.models = migrateProviderModels(value);
    } else {
      out[field] = deepCopy(value);
    }
  }
  return out;
}

function migrateProviders(providers) {
  if (!isPlainObject(providers)) return deepCopy(providers);
  const out = {};
  for (const [name, provider] of Object.entries(providers)) {
    out[name] = migrateProvider(provider);
  }
  return out;
}

function migrateCompaction(compaction) {
  if (!isPlainObject(compaction)) return deepCopy(compaction);
  const out = {};
  for (const [k, v] of Object.entries(compaction)) {
    if (k === "reserved") out.buffer = v;
    else if (k === "preserve_recent_tokens") out.keep = { tokens: v };
    else if (k === "prune" || k === "tail_turns") continue; // unsupported in V2
    else out[k] = deepCopy(v);
  }
  return out;
}

function migrateAgentEntry(entry) {
  if (!isPlainObject(entry)) return deepCopy(entry);
  const out = {};
  const body = {};

  // Existing V2 request.body — merge into it
  if (isPlainObject(entry.request)) {
    out.request = deepCopy(entry.request);
    if (isPlainObject(entry.request.body)) {
      Object.assign(body, entry.request.body);
      delete out.request.body;
      if (Object.keys(out.request).length === 0) delete out.request;
      else out.request.body = body;
    }
  }

  let pendingVariant;
  for (const [key, value] of Object.entries(entry)) {
    if (key === "request") continue;
    switch (key) {
      case "prompt":
        out.system = value;
        break;
      case "maxSteps":
        out.steps = value;
        break;
      case "disable":
        out.disabled = value;
        break;
      case "permission":
        out.permissions = migratePermissionGroup(value);
        break;
      case "reasoningEffort":
      case "textVerbosity":
      case "temperature":
      case "reference":
      case "attachment":
        body[key] = deepCopy(value);
        break;
      case "variant":
        pendingVariant = value; // combined with model after the loop
        break;
      default:
        if (AGENT_KEEP_KEYS.has(key)) out[key] = deepCopy(value);
        else body[key] = deepCopy(value); // unrecognized → request.body (runtime sweep)
    }
  }

  if (pendingVariant !== undefined && out.model !== undefined) {
    if (typeof out.model === "string" && !out.model.includes("#")) {
      out.model = `${out.model}#${pendingVariant}`;
    } else if (isPlainObject(out.model) && !out.model.variant) {
      out.model = { ...out.model, variant: pendingVariant };
    }
  }

  if (Object.keys(body).length > 0) {
    out.request = { ...(out.request || {}), body };
  }
  return out;
}

function migrateAgents(agent) {
  if (!isPlainObject(agent)) return deepCopy(agent);
  const out = {};
  for (const [name, entry] of Object.entries(agent)) {
    out[name] = migrateAgentEntry(entry);
  }
  return out;
}

function enabledProvidersToPolicies(list) {
  const policies = [{ action: "provider.use", resource: "*", effect: "deny" }];
  if (Array.isArray(list)) {
    for (const p of list) {
      policies.push({ action: "provider.use", resource: p, effect: "allow" });
    }
  }
  return policies;
}

/**
 * Migrate a config object to native V2. Pure + idempotent.
 * @param {Record<string, unknown>} cfg
 * @returns {Record<string, unknown>} new V2 object
 */
function migrateConfig(cfg) {
  if (!isPlainObject(cfg)) return deepCopy(cfg);

  const agentFromV1 = isPlainObject(cfg.agent) ? migrateAgents(cfg.agent) : null;
  const agentsExisting = isPlainObject(cfg.agents) ? deepCopy(cfg.agents) : {};
  let agents = null; // lazily emitted at first of (agent | agents | small_model)
  const titleModel =
    cfg.small_model !== undefined && !isPlainObject(agentsExisting.title)
      ? cfg.small_model
      : undefined;

  function combinedAgents() {
    if (agents) return agents;
    agents = { ...(agentFromV1 || {}), ...agentsExisting };
    if (titleModel !== undefined) {
      agents.title = isPlainObject(agents.title)
        ? agents.title
        : { model: deepCopy(titleModel) };
      if (isPlainObject(agents.title) && agents.title.model === undefined) {
        agents.title.model = deepCopy(titleModel);
      }
    }
    return agents;
  }

  const out = {};
  let agentsEmitted = false;
  const emitAgents = () => {
    if (!agentsEmitted) {
      out.agents = combinedAgents();
      agentsEmitted = true;
    }
  };

  for (const [key, value] of Object.entries(cfg)) {
    switch (key) {
      case "agent":
      case "agents":
      case "small_model":
        emitAgents();
        break;
      case "permission":
        out.permissions = permissionReplaceActions(out.permissions, flattenPermissions(value));
        break;
      case "permissions":
        out.permissions = permissionReplaceActions(out.permissions, value);
        break;
      case "autoupdate":
        out.update = value;
        break;
      case "snapshot":
        out.snapshots = value;
        break;
      case "compaction":
        out.compaction = migrateCompaction(value);
        break;
      case "enabled_providers": {
        const existing = isPlainObject(cfg.experimental) ? deepCopy(cfg.experimental) : {};
        const merged = [...(Array.isArray(existing.policies) ? existing.policies : [])];
        for (const rule of enabledProvidersToPolicies(value)) {
          if (!merged.some((r) => JSON.stringify(r) === JSON.stringify(rule))) {
            merged.push(rule);
          }
        }
        delete existing.policies;
        out.experimental = { ...existing, policies: merged };
        break;
      }
      case "provider":
        out.providers = migrateProviders(value);
        break;
      case "mcp":
        out.mcp = migrateMcp(value);
        break;
      case "skills":
        if (Array.isArray(value)) out.skills = value.map(deepCopy);
        else out.skills = []; // invalid object shape normalizes to []
        break;
      case "command":
        out.commands = deepCopy(value);
        break;
      case "hooks":
        break; // not a config key in V2 (plugin lifecycle instead)
      case "instructions":
        if (Array.isArray(value)) out.instructions = value.map(deepCopy);
        break; // non-array forms are rejected by the runtime
      case "experimental":
        if (cfg.enabled_providers === undefined && out.experimental === undefined) {
          out.experimental = deepCopy(value);
        }
        break;
      default:
        out[key] = deepCopy(value);
    }
  }

  if (!agentsEmitted && (agentFromV1 || Object.keys(agentsExisting).length > 0 || titleModel !== undefined)) {
    emitAgents();
  }

  return out;
}

module.exports = {
  migrateConfig,
  flattenPermissions,
  permissionReplaceActions,
  PERMISSION_ACTION_RENAMES,
  AGENT_KEEP_KEYS,
};

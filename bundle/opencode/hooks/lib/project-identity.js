"use strict";

const fs = require("node:fs");
const path = require("node:path");

const PROJECT_YAML_NAME = "project.yaml";
const PROJECT_JSON_NAME = "project.json";

const PCORE_MANAGED_VERSION = 2;

const DEFAULT_PROJECT_IDENTITY = {
  project: {
    name: "",
    slug: "",
    display_name: "",
    type: "software",
    category: "",
    owner: "",
    description: "",
  },
  version: {
    current: "0.1.0",
    channel: "dev",
    release_name: "",
    build_number: 1,
  },
  lifecycle: {
    stage: "idea",
    status: "active",
    started: null,
    updated: null,
  },
  team: {
    lead: "",
    members: [],
  },
  repository: {
    url: "",
    branch: "main",
    provider: "github",
    visibility: "private",
  },
  stack: {
    languages: [],
    frameworks: [],
    databases: [],
    infrastructure: [],
    package_manager: "",
    runtime: "",
  },
  environments: {
    development: { url: "", branch: "", auto_deploy: true },
    staging: { url: "", branch: "", auto_deploy: false },
    production: { url: "", branch: "", auto_deploy: false },
  },
  integrations: {
    ci_cd: "",
    monitoring: "",
    analytics: "",
    error_tracking: "",
    logs: "",
  },
  ai: {
    assistant: "",
    context_dir: "context/",
    entry_point: "AGENTS.md",
    rules: [],
  },
  infrastructure: {
    cloud: "",
    regions: [],
    dns: "",
    cdn: "",
  },
  security: {
    authentication: "",
    authorization: "rbac",
    audit_log: false,
    secrets_manager: "",
  },
  compliance: {
    standards: [],
    data_region: "",
  },
  observability: {
    health_endpoint: "/health",
    metrics: false,
    tracing: false,
    alerting: { pagerduty: false, slack: false, email: false },
  },
  backup: {
    strategy: "automated",
    retention_days: 30,
    schedule: "daily",
  },
  disaster_recovery: {
    rpo_minutes: 60,
    rto_minutes: 120,
    plan: "",
  },
  _pcore: {
    version: PCORE_MANAGED_VERSION,
    initialized: null,
    last_orchestration: null,
    orchestration_count: 0,
    quality_gate_passes: 0,
    quality_gate_failures: 0,
    agent_invocations: {},
    version_history: [],
    lifecycle_transitions: [],
  },
};

const PROJECT_TYPES = [
  "web", "mobile", "api", "ai", "devops", "library",
  "saas", "internal-tool", "oss", "cli", "game", "data",
];

const LIFECYCLE_STAGES = [
  "idea", "analysis", "requirements", "design", "planning",
  "development", "testing", "staging", "production", "maintenance", "sunset",
];

const VERSION_CHANNELS = [
  "dev", "alpha", "beta", "rc", "stable",
];

const REPO_PROVIDERS = [
  "github", "gitlab", "bitbucket", "self-hosted",
];

const ARCHITECTURE_TEMPLATES = {
    "web":            "21-next-hono-prisma-query.md",
  "mobile":         "01-monorepo.md",
  "api":            "11-microservices.md",
  "ai":             "17-serverless.md",
  "devops":         "17-serverless.md",
  "library":        "01-monorepo.md",
  "saas":           "12-event-driven.md",
  "internal-tool":  "19-n-tier.md",
  "oss":            "01-monorepo.md",
  "cli":            "07-rest-api.md",
  "game":           "01-monorepo.md",
  "data":           "20-event-sourcing.md",
};

const ARCHITECTURE_CATALOG = [
  { file: "01-monorepo.md",            title: "Monorepo Architecture",                        types: ["web", "mobile", "library", "oss", "game"] },
  { file: "02-api-security.md",        title: "API Security Architecture",                    types: ["api", "web", "saas"] },
  { file: "03-api-gateway.md",         title: "API Gateway Pattern",                         types: ["api", "web", "saas"] },
  { file: "04-frontend-react.md",      title: "Frontend Folder Structure (React)",           types: ["web"] },
  { file: "05-fullstack.md",           title: "Full Stack System Structure",                  types: ["web", "saas", "internal-tool"] },
  { file: "06-service-oriented.md",    title: "Service-Oriented Architecture",                types: ["api", "saas", "internal-tool"] },
  { file: "07-rest-api.md",            title: "REST API Architecture",                       types: ["api", "web"] },
  { file: "08-database-conceptual.md", title: "Relational Database Architecture (Conceptual)", types: [] },
  { file: "09-database-project.md",    title: "Relational Database Architecture (Project)",    types: [] },
  { file: "10-zero-trust.md",          title: "Zero Trust Architecture",                     types: [] },
  { file: "11-microservices.md",       title: "Microservices Architecture",                   types: ["api", "saas", "internal-tool"] },
  { file: "12-event-driven.md",        title: "Event-Driven Architecture (EDA)",              types: ["api", "saas", "data"] },
  { file: "13-clean-architecture.md",  title: "Clean Architecture",                          types: ["web", "api", "saas"] },
  { file: "14-hexagonal.md",           title: "Hexagonal Architecture (Ports & Adapters)",     types: ["api", "web", "internal-tool"] },
  { file: "15-cqrs.md",                title: "CQRS — Command Query Responsibility Segregation", types: ["api", "saas", "data"] },
  { file: "16-micro-frontends.md",     title: "Micro Frontends Architecture",                 types: ["web", "saas"] },
  { file: "17-serverless.md",          title: "Serverless Architecture",                     types: ["api", "ai", "devops", "data"] },
  { file: "18-graphql.md",             title: "GraphQL Architecture",                        types: ["api", "web", "mobile"] },
  { file: "19-n-tier.md",              title: "Layered (N-Tier) Architecture",                types: ["web", "api", "saas", "internal-tool"] },
  { file: "20-event-sourcing.md",      title: "Event Sourcing Architecture",                  types: ["api", "saas", "data"] },
  { file: "21-next-hono-prisma-query.md", title: "Next.js + Hono + Prisma + React Query + shadcn/ui", types: ["web", "saas"] },
  { file: "22-ui-ux.md",                 title: "UI/UX Design System Architecture",                  types: ["web", "mobile", "saas"] },
  { file: "23-standard-code.md",         title: "Standard Code Architecture",                       types: ["web", "mobile", "api", "ai", "devops", "library", "saas", "internal-tool", "oss", "cli", "game", "data"] },
  { file: "24-ui-component.md",          title: "UI Component Architecture",                        types: ["web", "mobile", "saas"] },
  { file: "25-design-tokens.md",         title: "Design Token Architecture (DTCG 3-tier)",         types: ["web", "mobile", "saas"] },
  { file: "26-folder-structure.md",       title: "Folder Structure (Feature / Monorepo)",           types: ["web", "mobile", "api", "ai", "devops", "library", "saas", "internal-tool", "oss", "cli", "game", "data"] },
  { file: "27-system-design.md",          title: "System Design Document (C4-lite)",                 types: ["web", "api", "saas", "data", "internal-tool"] },
];

function suggestArchitectureTemplate(projectType) {
  const found = ARCHITECTURE_TEMPLATES[projectType];
  if (found) return found;
  return "01-monorepo.md";
}

function suggestArchitectureTemplates(projectType) {
  const matched = [];
  const primary = ARCHITECTURE_CATALOG.find(a => a.file === suggestArchitectureTemplate(projectType));
  if (primary) matched.push(primary);
  for (const a of ARCHITECTURE_CATALOG) {
    if (a.file === primary?.file) continue;
    if (a.types.includes(projectType)) matched.push(a);
  }
  return matched;
}

// ── Minimal YAML parser for project.yaml ──
function parseSimpleYaml(text) {
  const result = {};
  const lines = text.split("\n");
  const stack = [{ obj: result, indent: -1 }];
  let listIndent = -1;

  for (let raw of lines) {
    const stripped = raw.replace(/#.*$/, "").trimEnd();
    if (stripped.trim() === "" || stripped.trim().startsWith("#")) continue;

    const indent = raw.length - raw.trimStart().length;
    const rawTrimmed = raw.trimStart();

    const isListItem = rawTrimmed.startsWith("- ");
    if (isListItem) {
      listIndent = indent;

      while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
        stack.pop();
      }

      const rest = rawTrimmed.slice(2).trim();
      const valColonIdx = rest.indexOf(":");
      const parent = stack[stack.length - 1].obj;
      if (!Array.isArray(parent._list)) parent._list = [];

      if (valColonIdx > 0 && valColonIdx < rest.length - 1) {
        const subKey = rest.slice(0, valColonIdx).trim();
        const subVal = parseYamlValue(rest.slice(valColonIdx + 1).trim());
        const item = {};
        item[subKey] = subVal;
        parent._list.push(item);
      } else {
        const val = parseYamlValue(rest);
        parent._list.push(val);
      }
      continue;
    }

    if (listIndent >= 0 && indent > listIndent) {
      const parent = stack[stack.length - 1].obj;
      if (Array.isArray(parent._list) && parent._list.length > 0) {
        const lastItem = parent._list[parent._list.length - 1];
        const trimmedLine = stripped.trim();
        const colonIdx = trimmedLine.indexOf(":");
        if (colonIdx > 0) {
          const subKey = trimmedLine.slice(0, colonIdx).trim();
          const subVal = parseYamlValue(trimmedLine.slice(colonIdx + 1).trim());
          if (typeof lastItem === "object" && !Array.isArray(lastItem)) {
            lastItem[subKey] = subVal;
          }
        }
        continue;
      }
    }

    listIndent = -1;
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const trimmedLine = stripped.trim();
    const colonIdx = trimmedLine.indexOf(":");
    if (colonIdx === -1) continue;

    const key = trimmedLine.slice(0, colonIdx).trim();
    let val = trimmedLine.slice(colonIdx + 1).trim();

    if (val === "") {
      const newObj = {};
      const parent = stack[stack.length - 1].obj;
      if (parent._list) {
        parent._list.push(newObj);
        stack.push({ obj: newObj, indent });
      } else {
        parent[key] = newObj;
        stack.push({ obj: newObj, indent });
      }
      continue;
    }

    if (val.startsWith("|")) {
      val = "";
      continue;
    }

    const parsed = parseYamlValue(val);

    const parent = stack[stack.length - 1].obj;
    if (parent._list) {
      const last = parent._list[parent._list.length - 1];
      if (typeof last === "object" && last !== null && !Array.isArray(last)) {
        last[key] = parsed;
      } else {
        const item = {};
        item[key] = parsed;
        parent._list.push(item);
      }
    } else {
      parent[key] = parsed;
    }
  }

  resolveListPlaceholders(result);
  return result;
}

function parseYamlValue(val) {
  if (val === "true") return true;
  if (val === "false") return false;
  if (val === "null") return null;
  if (val === "~") return null;
  if (val === "[]") return [];
  if (val === "{}") return {};

  const num = Number(val);
  if (!isNaN(num) && val.trim() !== "" && val.indexOf("://") === -1 && val.indexOf(":") === -1) {
    return num;
  }

  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    return val.slice(1, -1);
  }

  if (val === "<project-slug>" || (val.startsWith("<") && val.endsWith(">"))) {
    return "";
  }

  return val;
}

function resolveListPlaceholders(obj) {
  for (const key of Object.keys(obj)) {
    if (key === "_list") {
      delete obj[key];
      continue;
    }
    if (typeof obj[key] === "object" && obj[key] !== null && !Array.isArray(obj[key])) {
      const nested = obj[key];
      if (nested._list) {
        obj[key] = nested._list;
        delete nested._list;
        resolveListPlaceholders(obj[key]);
      } else {
        resolveListPlaceholders(nested);
      }
    }
  }
}

// ── Public API ──

function findProjectIdentity(rootDir) {
  if (!rootDir) return null;

  const yamlPath = path.join(rootDir, PROJECT_YAML_NAME);
  const jsonPath = path.join(rootDir, PROJECT_JSON_NAME);

  if (fs.existsSync(yamlPath)) {
    return { path: yamlPath, format: "yaml" };
  }
  if (fs.existsSync(jsonPath)) {
    return { path: jsonPath, format: "json" };
  }
  return null;
}

function loadProjectIdentity(rootDir) {
  const found = findProjectIdentity(rootDir);
  if (!found) return null;

  try {
    const raw = fs.readFileSync(found.path, "utf8");
    let parsed;

    if (found.format === "yaml") {
      parsed = parseSimpleYaml(raw);
    } else {
      parsed = JSON.parse(raw);
    }

    return deepMerge({ ...DEFAULT_PROJECT_IDENTITY }, parsed);
  } catch (e) {
    return null;
  }
}

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
      if (result[key] && typeof result[key] === "object" && !Array.isArray(result[key])) {
        result[key] = deepMerge(result[key], source[key]);
      } else {
        result[key] = source[key];
      }
    } else if (Array.isArray(source[key])) {
      if (Array.isArray(result[key])) {
        result[key] = source[key];
      } else {
        result[key] = source[key];
      }
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

function validateProjectIdentity(identity) {
  const errors = [];
  const warnings = [];

  if (!identity.project.name) errors.push("project.name is required");
  if (!identity.project.slug) errors.push("project.slug is required");
  if (!identity.project.type) errors.push("project.type is required");
  if (!PROJECT_TYPES.includes(identity.project.type)) {
    warnings.push(`project.type "${identity.project.type}" not in standard types: ${PROJECT_TYPES.join(", ")}`);
  }
  if (!LIFECYCLE_STAGES.includes(identity.lifecycle.stage)) {
    warnings.push(`lifecycle.stage "${identity.lifecycle.stage}" not in standard stages`);
  }
  if (!VERSION_CHANNELS.includes(identity.version.channel)) {
    warnings.push(`version.channel "${identity.version.channel}" not in standard channels`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

function identityToState(identity) {
  if (!identity) return {};

  return {
    name: identity.project.name,
    slug: identity.project.slug,
    displayName: identity.project.display_name,
    type: identity.project.type,
    category: identity.project.category,
    owner: identity.project.owner,
    version: identity.version.current,
    buildNumber: identity.version.build_number,
    releaseChannel: identity.version.channel,
    releaseName: identity.version.release_name,
    lifecycleStage: identity.lifecycle.stage,
    lifecycleStatus: identity.lifecycle.status,
    stack: identity.stack,
    environments: identity.environments,
    integrations: identity.integrations,
    ai: identity.ai,
    infrastructure: identity.infrastructure,
    security: identity.security,
    observability: identity.observability,
    _pcore: identity._pcore,
  };
}

function buildIdentitySummary(identity) {
  if (!identity) return "No project identity file found.";

  const lines = [
    `Project: ${identity.project.display_name || identity.project.name}`,
    `  Type: ${identity.project.type}${identity.project.category ? ` — ${identity.project.category}` : ""}`,
    `  Version: ${identity.version.current} (${identity.version.channel})`,
    `  Lifecycle: ${identity.lifecycle.stage} — ${identity.lifecycle.status}`,
    `  Stack: ${identity.stack.languages.join(", ")} / ${identity.stack.frameworks.join(", ")}`,
  ];

  if (identity.team.lead) {
    lines.push(`  Lead: ${identity.team.lead}`);
  }

  for (const key of Object.keys(identity.environments)) {
    const env = identity.environments[key];
    if (env.url) {
      lines.push(`  ${key.charAt(0).toUpperCase() + key.slice(1)}: ${env.url}`);
    }
  }

  return lines.join("\n");
}

// ── YAML generation ──

function safeYamlValue(val) {
  if (val === null || val === undefined) return "null";
  if (typeof val === "boolean") return val ? "true" : "false";
  if (typeof val === "number") return String(val);
  if (typeof val === "string") {
    if (val === "" || val.includes(" ") || val.includes(":") || val.includes("#")) {
      return `"${val}"`;
    }
    return val;
  }
  if (Array.isArray(val)) return JSON.stringify(val);
  return String(val);
}

function objToYaml(obj, indent) {
  indent = indent || 0;
  const pad = "  ".repeat(indent);
  const lines = [];

  for (const key of Object.keys(obj)) {
    const val = obj[key];

    if (key === "_pcore" && indent === 0) {
      lines.push("");
      lines.push("# ──────────────────────────────────────────────");
      lines.push("# P-Core managed fields (updated by orchestra)");
      lines.push("# ──────────────────────────────────────────────");
    }

    if (val === null || val === undefined) {
      lines.push(`${pad}${key}: null`);
    } else if (typeof val === "boolean") {
      lines.push(`${pad}${key}: ${val}`);
    } else if (typeof val === "number") {
      lines.push(`${pad}${key}: ${val}`);
    } else if (typeof val === "string") {
      if (val.includes("\n")) {
        lines.push(`${pad}${key}: |`);
        for (const line of val.split("\n")) {
          lines.push(`${pad}  ${line}`);
        }
      } else {
        lines.push(`${pad}${key}: ${val}`);
      }
    } else if (Array.isArray(val)) {
      if (val.length === 0) {
        lines.push(`${pad}${key}: []`);
      } else {
        lines.push(`${pad}${key}:`);
        for (const item of val) {
          if (typeof item === "object" && item !== null) {
            const keys = Object.keys(item);
            if (keys.length > 0) {
              lines.push(`${pad}  - ${keys[0]}: ${safeYamlValue(item[keys[0]])}`);
              for (let i = 1; i < keys.length; i++) {
                lines.push(`${pad}    ${keys[i]}: ${safeYamlValue(item[keys[i]])}`);
              }
            } else {
              lines.push(`${pad}  - {}`);
            }
          } else {
            lines.push(`${pad}  - ${safeYamlValue(item)}`);
          }
        }
      }
    } else if (typeof val === "object") {
      const keys = Object.keys(val);
      if (keys.length === 0) {
        lines.push(`${pad}${key}: {}`);
      } else {
        lines.push(`${pad}${key}:`);
        objToYamlInto(val, lines, indent + 1);
      }
    }
  }

  return lines.join("\n");
}

function objToYamlInto(obj, lines, indent) {
  const pad = "  ".repeat(indent);
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (val === null || val === undefined) {
      lines.push(`${pad}${key}: null`);
    } else if (typeof val === "boolean") {
      lines.push(`${pad}${key}: ${val}`);
    } else if (typeof val === "number") {
      lines.push(`${pad}${key}: ${val}`);
    } else if (typeof val === "string") {
      lines.push(`${pad}${key}: ${val}`);
    } else if (Array.isArray(val)) {
      if (val.length === 0) {
        lines.push(`${pad}${key}: []`);
      } else {
        lines.push(`${pad}${key}:`);
        for (const item of val) {
          if (typeof item === "object" && item !== null) {
            const keys = Object.keys(item);
            if (keys.length > 0) {
              lines.push(`${pad}  - ${keys[0]}: ${safeYamlValue(item[keys[0]])}`);
              for (let i = 1; i < keys.length; i++) {
                lines.push(`${pad}    ${keys[i]}: ${safeYamlValue(item[keys[i]])}`);
              }
            } else {
              lines.push(`${pad}  - {}`);
            }
          } else {
            lines.push(`${pad}  - ${safeYamlValue(item)}`);
          }
        }
      }
    } else if (typeof val === "object") {
      const keys = Object.keys(val);
      if (keys.length === 0) {
        lines.push(`${pad}${key}: {}`);
      } else {
        lines.push(`${pad}${key}:`);
        objToYamlInto(val, lines, indent + 1);
      }
    }
  }
}

function identityToYaml(identity) {
  const header = [
    "# ──────────────────────────────────────────────",
    "# P-Core Universal Project Identity",
    "# ──────────────────────────────────────────────",
    "# Every managed project declares its identity here.",
    "# Used by P-Core Orchestra for lifecycle management,",
    "# version tracking, team coordination, and automation.",
    "",
  ].join("\n");

  const body = objToYaml(identity, 0);
  return header + body + "\n";
}

function saveProjectIdentity(rootDir, identity) {
  if (!rootDir || !identity) return false;
  const found = findProjectIdentity(rootDir);
  const destPath = found ? found.path : path.join(rootDir, PROJECT_YAML_NAME);

  try {
    const yaml = identityToYaml(identity);
    fs.writeFileSync(destPath, yaml, "utf8");
    return true;
  } catch (e) {
    return false;
  }
}

function recordVersionBump(identity, { previous, current, bumpType, buildNumber, changeTypes, description }) {
  if (!identity) return identity;
  identity.version.current = current;
  identity.version.build_number = buildNumber;
  identity.lifecycle.updated = new Date().toISOString().split("T")[0];
  if (!identity._pcore.version_history) identity._pcore.version_history = [];
  identity._pcore.version_history.push({
    version: current,
    previous: previous,
    bump_type: bumpType,
    build: buildNumber,
    change_types: changeTypes || [],
    description: description || "",
    date: new Date().toISOString(),
  });
  return identity;
}

function recordLifecycleTransition(identity, { from, to, reason }) {
  if (!identity) return identity;
  identity.lifecycle.stage = to;
  identity.lifecycle.updated = new Date().toISOString().split("T")[0];
  if (!identity._pcore.lifecycle_transitions) identity._pcore.lifecycle_transitions = [];
  identity._pcore.lifecycle_transitions.push({
    from: from || identity.lifecycle.stage,
    to: to,
    reason: reason || "",
    date: new Date().toISOString(),
  });
  return identity;
}

function recordOrchestration(identity, { phase, outcome, durationMs }) {
  if (!identity) return identity;
  identity._pcore.last_orchestration = new Date().toISOString();
  identity._pcore.orchestration_count = (identity._pcore.orchestration_count || 0) + 1;
  if (outcome === "pass") {
    identity._pcore.quality_gate_passes = (identity._pcore.quality_gate_passes || 0) + 1;
  } else if (outcome === "fail") {
    identity._pcore.quality_gate_failures = (identity._pcore.quality_gate_failures || 0) + 1;
  }
  const invocations = identity._pcore.agent_invocations || {};
  invocations[phase] = (invocations[phase] || 0) + 1;
  identity._pcore.agent_invocations = invocations;
  return identity;
}

const VALID_PROJECT_TYPES = PROJECT_TYPES;
const VALID_LIFECYCLE_STAGES = LIFECYCLE_STAGES;
const VALID_VERSION_CHANNELS = VERSION_CHANNELS;

module.exports = {
  PROJECT_YAML_NAME,
  PROJECT_JSON_NAME,
  DEFAULT_PROJECT_IDENTITY,
  PROJECT_TYPES,
  LIFECYCLE_STAGES,
  VERSION_CHANNELS,
  REPO_PROVIDERS,
  PCORE_MANAGED_VERSION,
  ARCHITECTURE_TEMPLATES,
  ARCHITECTURE_CATALOG,
  parseSimpleYaml,
  findProjectIdentity,
  loadProjectIdentity,
  saveProjectIdentity,
  validateProjectIdentity,
  identityToState,
  buildIdentitySummary,
  identityToYaml,
  recordVersionBump,
  recordLifecycleTransition,
  recordOrchestration,
  suggestArchitectureTemplate,
  suggestArchitectureTemplates,
  VALID_PROJECT_TYPES,
  VALID_LIFECYCLE_STAGES,
  VALID_VERSION_CHANNELS,
};

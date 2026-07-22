"use strict";

const { loadProjectIdentity } = require("./project-identity.js");
const { LOOP_MODE_CORE, LOOP_MODE_ENTERPRISE } = require("./constants.js");

const DEFAULT_TOKEN_BUDGETS = {
  planner: 10000,
  implementer: 30000,
  verifier: 15000,
  reviewer: 8000,
  cycle: 63000,
};

const DEFAULT_ORCHESTRA_CONFIG = {
  route: LOOP_MODE_CORE,
  max_iterations: 8,
  plan_only: false,
  token_budgets: { ...DEFAULT_TOKEN_BUDGETS },
  phases: null,
};

const AGENT_BUDGET_KEYS = {
  "orchestra-planner": "planner",
  "orchestra-implementer": "implementer",
  "orchestra-verifier": "verifier",
  "orchestra-reviewer": "reviewer",
};

function normalizeOrchestraConfig(raw) {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_ORCHESTRA_CONFIG, token_budgets: { ...DEFAULT_TOKEN_BUDGETS } };

  const route = raw.route === LOOP_MODE_ENTERPRISE ? LOOP_MODE_ENTERPRISE : LOOP_MODE_CORE;
  const max_iterations = Number(raw.max_iterations) || DEFAULT_ORCHESTRA_CONFIG.max_iterations;
  const plan_only = raw.plan_only === true;

  const token_budgets = { ...DEFAULT_TOKEN_BUDGETS };
  if (raw.token_budgets && typeof raw.token_budgets === "object") {
    for (const k of Object.keys(DEFAULT_TOKEN_BUDGETS)) {
      if (raw.token_budgets[k] != null) {
        const n = Number(raw.token_budgets[k]);
        if (!Number.isNaN(n) && n > 0) token_budgets[k] = n;
      }
    }
  }

  let phases = null;
  if (Array.isArray(raw.phases) && raw.phases.length > 0) {
    phases = raw.phases.map(String);
  }

  return { route, max_iterations, plan_only, token_budgets, phases };
}

function extractOrchestraFromIdentity(identity) {
  if (!identity) return null;
  const raw = identity.orchestra || identity.ai?.orchestra;
  if (!raw) return null;
  return normalizeOrchestraConfig(raw);
}

function loadOrchestraConfigFromRoot(rootDir) {
  const identity = loadProjectIdentity(rootDir);
  return extractOrchestraFromIdentity(identity);
}

function mergeRoute(classifierRoute, orchestraConfig) {
  if (classifierRoute === LOOP_MODE_ENTERPRISE) return LOOP_MODE_ENTERPRISE;
  if (orchestraConfig?.route === LOOP_MODE_ENTERPRISE) return LOOP_MODE_ENTERPRISE;
  return LOOP_MODE_CORE;
}

function buildOrchestraConfigSummary(config) {
  if (!config) return "";
  const tb = config.token_budgets;
  const lines = [
    "Orchestra profile (project.yaml):",
    `  Route: ${config.route} | Max iterations: ${config.max_iterations}`,
    config.plan_only ? "  Plan-only: ON — pauses after planner for user approval" : null,
    `  Token budgets: planner ${tb.planner}, implementer ${tb.implementer}, verifier ${tb.verifier}, reviewer ${tb.reviewer}, cycle ${tb.cycle}`,
  ].filter(Boolean);
  if (config.phases?.length) {
    const { validatePhaseFilter } = require("./phase-engine.js");
    const { SDLC_PHASES } = require("./constants.js");
    const v = validatePhaseFilter(config.phases, SDLC_PHASES);
    lines.push(`  Enterprise phases (${config.phases.length} requested): ${config.phases.join(", ")}`);
    if (v.unknown.length > 0) {
      lines.push(`  Warning: unknown phase ids ignored: ${v.unknown.join(", ")}`);
    }
    lines.push(`  Effective chain: ${v.effective.join(" → ")}`);
  }
  return lines.join("\n");
}

module.exports = {
  DEFAULT_ORCHESTRA_CONFIG,
  DEFAULT_TOKEN_BUDGETS,
  AGENT_BUDGET_KEYS,
  normalizeOrchestraConfig,
  extractOrchestraFromIdentity,
  loadOrchestraConfigFromRoot,
  mergeRoute,
  buildOrchestraConfigSummary,
};

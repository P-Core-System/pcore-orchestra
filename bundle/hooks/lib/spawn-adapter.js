"use strict";

/**
 * Host-agnostic spawn adapter for Cursor, OpenCode, Claude Code, and Codex.
 * Normalizes subagent spawning across platforms.
 */

const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");

// Harness observability — lazy + guarded for fail-open: an observability
// load or emission failure must never break the spawn path.
let harnessObs = null;
try {
  harnessObs = require("./harness-observability.js");
} catch {}

const SUPPORTED_HOSTS = ["cursor", "opencode", "claude-code", "codex"];
const PHASE_AGENTS = [
  "orchestra-planner",
  "orchestra-implementer",
  "orchestra-verifier",
  "orchestra-reviewer",
  // Enterprise agents
  "business-analyst",
  "product-manager",
  "architect",
  "tech-lead",
  "project-manager",
  "backend-engineer",
  "frontend-engineer",
  "full-stack-engineer",
  "database-engineer",
  "qa-engineer",
  "automation-engineer",
  "security-engineer",
  "accessibility-reviewer",
  "documentation-writer",
  "release-manager",
  "devops-engineer",
  "sre",
  "observer",
  "code-reviewer",
  "performance-engineer",
  "platform-engineer",
  "cloud-engineer",
  "infrastructure-engineer",
  // Corporate agents
  "agent-selector",
  "workflow-orchestrator",
  "project-type-classifier",
  "business-strategist",
  "stakeholder-advocate",
  "compliance-officer",
  "legal-advisor",
  "security-executive-advisor",
  "ops-manager",
  "incident-responder",
  "data-engineer",
  "ui-ux-designer",
  "scrum-master",
  "ai-ethics-reviewer",
  "ai-safety-engineer",
  "annotation-specialist",
  "api-collector",
  "api-contract-validator",
  "api-pentester",
  "appsec-engineer",
  "attack-simulator",
  "bias-auditor",
  "blue-team-defender",
  "bug-bounty-coordinator",
  "chaos-engineer",
  "cloud-pentester",
  "adr-archivist",
  "adversary-emulator",
];

function validateHost(host) {
  if (!SUPPORTED_HOSTS.includes(host)) {
    throw new Error(`Unknown host: ${host}. Supported: ${SUPPORTED_HOSTS.join(", ")}`);
  }
}

function validateAgent(agentId) {
  if (!PHASE_AGENTS.includes(agentId)) {
    throw new Error(`Unknown agent: ${agentId}`);
  }
}

/**
 * Normalize response across all hosts.
 * @returns {{success: boolean, result: any, error: string|null, artifacts: string[]}}
 */
function normalizeResponse(success, result, error, artifacts) {
  return {
    success: Boolean(success),
    result: result ?? null,
    error: error ?? null,
    artifacts: Array.isArray(artifacts) ? artifacts : [],
  };
}

/**
 * Derive spawn provenance for observability without touching payload
 * semantics. runId falls back to the worktree basename
 * (`.pcore/worktrees/<runId>/`); fromAgent/phase come from optional payload
 * conventions set by callers that know them.
 */
function buildSpawnProvenance(agentId, payload, worktreePath, host) {
  const data = payload && typeof payload === "object" ? payload : {};
  return {
    host: typeof host === "string" ? host : null,
    toAgent: typeof agentId === "string" ? agentId : null,
    fromAgent: typeof data.fromAgent === "string" && data.fromAgent ? data.fromAgent : null,
    phase: typeof data.phase === "string" && data.phase ? data.phase : null,
    runId:
      typeof data.runId === "string" && data.runId ? data.runId : deriveRunIdFromWorktree(worktreePath),
    payloadKeys: Object.keys(data).sort(),
  };
}

/** `.pcore/worktrees/<runId>/` -> `<runId>`; anything else -> its basename. */
function deriveRunIdFromWorktree(worktreePath) {
  if (typeof worktreePath !== "string" || worktreePath.length === 0) return null;
  const base = path.basename(worktreePath);
  return base.length > 0 ? base : null;
}

/** Emit an observability event — fail-open by contract, never throws. */
function observeEmission(emitFn, payload) {
  if (typeof emitFn !== "function") return;
  try {
    emitFn(payload);
  } catch {
    /* observability is additive-only: never break the spawn path */
  }
}

/** Record a spawn-path denial (unknown host/agent = deny-first allowlist hit). */
function observeDenial(provenance, host, agentId, err) {
  const message = err && err.message ? String(err.message) : "";
  const isHost = message.includes("Unknown host");
  observeEmission(harnessObs && harnessObs.recordPermissionDenied, {
    ...provenance,
    scope: "spawn",
    rule: isHost ? "spawn.host-allowlist" : "spawn.agent-allowlist",
    subject: isHost ? host : agentId,
    reason: message,
  });
}

/** Record the spawn outcome (ok|error) with the attempt's provenance. */
function observeResult(provenance, ok, error, artifacts) {
  observeEmission(harnessObs && harnessObs.recordSpawnResult, {
    ...provenance,
    ok,
    error,
    artifacts: Array.isArray(artifacts) ? artifacts.length : 0,
  });
}

/**
 * Spawn a subagent on the specified host.
 * @param {string} agentId - Agent identifier (e.g., "orchestra-planner")
 * @param {object} payload - Payload to pass to the agent
 * @param {string|null} worktreePath - Optional worktree path for isolation
 * @param {string} host - Target host: "cursor", "opencode", "claude-code", "codex"
 * @returns {Promise<{success: boolean, result: any, error: string|null, artifacts: string[]}>}
 */
async function spawn(agentId, payload, worktreePath, host) {
  const provenance = buildSpawnProvenance(agentId, payload, worktreePath, host);
  observeEmission(harnessObs && harnessObs.recordSpawnAttempted, provenance);
  try {
    validateHost(host);
    validateAgent(agentId);
  } catch (err) {
    // Deny-first allowlist hit — record it, but rethrow unchanged: this is
    // additive logging only, permission semantics stay exactly as before.
    observeDenial(provenance, host, agentId, err);
    observeResult(provenance, false, err && err.message, []);
    throw err;
  }

  const fullPayload = {
    ...payload,
    worktreePath: worktreePath || null,
  };

  try {
    const response = await dispatchSpawn(agentId, fullPayload, host);
    observeResult(provenance, response.success, response.error, response.artifacts);
    return response;
  } catch (err) {
    observeResult(provenance, false, err && err.message, []);
    throw err;
  }
}

/** Host dispatch — pure routing, no observability. */
function dispatchSpawn(agentId, fullPayload, host) {
  switch (host) {
    case "cursor":
      return spawnCursor(agentId, fullPayload);
    case "opencode":
      return spawnOpenCode(agentId, fullPayload);
    case "claude-code":
      return spawnClaudeCode(agentId, fullPayload);
    case "codex":
      return spawnCodex(agentId, fullPayload);
    default:
      throw new Error(`Unsupported host: ${host}`);
  }
}

/**
 * Spawn via Cursor Task tool (emits JSON to stdout for the hook to process).
 */
function spawnCursor(agentId, payload) {
  return new Promise((resolve) => {
    // In Cursor, the hook emits a Task tool call via stdout
    // This is a simulation - the actual spawning is done by the Cursor host
    const taskCall = {
      tool: "Task",
      subagent_type: agentId,
      prompt: JSON.stringify(payload),
    };
    
    // Emit to stdout for the Cursor hook to capture
    process.stdout.write(JSON.stringify(taskCall) + "\n");
    
    // For testing, return a normalized response
    resolve(normalizeResponse(true, { taskCall }, null, []));
  });
}

/**
 * Spawn via OpenCode task tool.
 */
function spawnOpenCode(agentId, payload) {
  return new Promise((resolve) => {
    // In OpenCode, the conductor uses the task tool
    const taskCall = {
      tool: "task",
      agent: agentId,
      prompt: JSON.stringify(payload),
    };
    
    process.stdout.write(JSON.stringify(taskCall) + "\n");
    
    resolve(normalizeResponse(true, { taskCall }, null, []));
  });
}

/**
 * Spawn via Claude Code MCP tools/call.
 */
function spawnClaudeCode(agentId, payload) {
  return new Promise((resolve) => {
    // In Claude Code, we call the MCP server's tools/call
    const mcpCall = {
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "spawn_subagent",
        arguments: {
          agent: agentId,
          payload: JSON.stringify(payload),
        },
      },
      id: `spawn-${Date.now()}`,
    };
    
    process.stdout.write(JSON.stringify(mcpCall) + "\n");
    
    resolve(normalizeResponse(true, { mcpCall }, null, []));
  });
}

/**
 * Spawn via Codex MCP tools/call.
 */
function spawnCodex(agentId, payload) {
  return new Promise((resolve) => {
    // In Codex, similar to Claude Code - MCP tools/call
    const mcpCall = {
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "spawn_subagent",
        arguments: {
          agent: agentId,
          payload: JSON.stringify(payload),
        },
      },
      id: `spawn-${Date.now()}`,
    };
    
    process.stdout.write(JSON.stringify(mcpCall) + "\n");
    
    resolve(normalizeResponse(true, { mcpCall }, null, []));
  });
}

module.exports = {
  spawn,
  SUPPORTED_HOSTS,
  PHASE_AGENTS,
  normalizeResponse,
};
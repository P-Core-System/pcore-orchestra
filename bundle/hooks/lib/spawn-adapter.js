"use strict";

/**
 * Host-agnostic spawn adapter for Cursor, OpenCode, Claude Code, Codex, and Qoder CLI.
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

const SUPPORTED_HOSTS = ["cursor", "opencode", "claude-code", "codex", "qoder"];
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
 * @param {string} host - Target host: "cursor", "opencode", "claude-code", "codex", "qoder"
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
    case "qoder":
      return spawnQoder(agentId, fullPayload);
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
 * Spawn via OpenCode subagent tool (V1 name: task).
 */
function spawnOpenCode(agentId, payload) {
  return new Promise((resolve) => {
    // OpenCode V2 exposes the native spawn tool as `subagent` with an `agent`
    // argument; `task` is only the deprecated V1 alias. V2 also requires a
    // short `description` label alongside `agent` and `prompt`.
    const goal = typeof payload?.goal === "string" ? payload.goal : "";
    const taskCall = {
      tool: "subagent",
      agent: agentId,
      description: goal ? goal.slice(0, 60) : `${agentId} phase`,
      prompt: JSON.stringify(payload),
    };
    
    process.stdout.write(JSON.stringify(taskCall) + "\n");
    
    resolve(normalizeResponse(true, { taskCall }, null, []));
  });
}

/**
 * Spawn via Claude Code Agent tool (V2.1.63+; `Task` remains an accepted alias).
 */
function spawnClaudeCode(agentId, payload) {
  return new Promise((resolve) => {
    // Claude Code dispatches subagents through the native Agent tool selected by
    // `subagent_type`; agent definitions live in `.claude/agents/*.md` (project)
    // or `~/.claude/agents/` with `name` + `description` frontmatter. The old
    // MCP tools/call fallback is obsolete now that the tool is native.
    const goal = typeof payload?.goal === "string" ? payload.goal : "";
    const taskCall = {
      tool: "Agent",
      subagent_type: agentId,
      description: goal ? goal.slice(0, 60) : `${agentId} phase`,
      prompt: JSON.stringify(payload),
    };

    process.stdout.write(JSON.stringify(taskCall) + "\n");

    resolve(normalizeResponse(true, { taskCall }, null, []));
  });
}

/**
 * Spawn via Codex CLI native multi-agent tool (`spawn_agent`).
 */
function spawnCodex(agentId, payload) {
  return new Promise((resolve) => {
    // Codex `[features] multi_agent` is stable and default-on, exposing
    // spawn_agent/send_input/resume_agent/wait_agent/close_agent. Custom agents
    // are `.codex/agents/<name>.toml` (keys: name, description,
    // developer_instructions) selected via `agent_type`; `message` carries the
    // task. Subagents inherit the parent sandbox/approval policy.
    const taskCall = {
      tool: "spawn_agent",
      agent_type: agentId,
      message: JSON.stringify(payload),
    };

    process.stdout.write(JSON.stringify(taskCall) + "\n");

    resolve(normalizeResponse(true, { taskCall }, null, []));
  });
}

/**
 * Spawn via Qoder CLI Agent tool (subagent_type selection).
 */
function spawnQoder(agentId, payload) {
  return new Promise((resolve) => {
    // In Qoder CLI, the conductor spawns via the Agent tool with subagent_type
    const taskCall = {
      tool: "Agent",
      subagent_type: agentId,
      prompt: JSON.stringify(payload),
    };

    process.stdout.write(JSON.stringify(taskCall) + "\n");

    resolve(normalizeResponse(true, { taskCall }, null, []));
  });
}

module.exports = {
  spawn,
  SUPPORTED_HOSTS,
  PHASE_AGENTS,
  normalizeResponse,
};
/**
 * Cross-platform orchestra spawn syntax — Cursor IDE vs OpenCode CLI.
 * Installed to ~/.cursor/hooks/lib/ and used by orchestra hooks.
 */
"use strict";

const PHASE_AGENTS = [
  "orchestra-planner",
  "orchestra-implementer",
  "orchestra-verifier",
  "orchestra-reviewer",
];

const PLATFORMS = {
  cursor: {
    id: "cursor",
    label: "Cursor IDE",
    orchestrator: "Parent Cursor Agent (hooks ambient) or `orchestra` conductor agent",
    spawnTool: "Task",
    spawnSyntax:
      'Task(subagent_type="orchestra-planner", prompt="goal + handoff…")',
    spawnExample:
      "Launch Task with subagent_type set to orchestra-planner | orchestra-implementer | orchestra-verifier | orchestra-reviewer",
    phaseChain:
      "Hooks auto-chain phases on subagentStop after each marker (PLAN_READY, IMPLEMENT_DONE, VERIFY_PASS, ORCHESTRA_COMPLETE). Parent may also spawn manually.",
    entryPoint: "Ambient hooks → first phase agent, OR Task → orchestra conductor → phases",
    statePath: "~/.cursor/hooks/state/orchestra.json",
    health: "node ~/.cursor/hooks/orchestra-health.js",
    fixScript: "bash install.sh --cursor && restart Cursor",
  },
  opencode: {
    id: "opencode",
    label: "OpenCode CLI / desktop",
    orchestrator: "`orchestra` primary agent (default_agent in opencode.json)",
    spawnTool: "task",
    spawnSyntax: 'task(agent="orchestra-planner", prompt="goal + handoff…")',
    spawnExample:
      "Call the task tool with agent name orchestra-planner (then implementer, verifier, reviewer)",
    phaseChain:
      "No Cursor hooks — the orchestra conductor MUST task-spawn each phase sequentially and wait for completion markers.",
    entryPoint: "default_agent: orchestra — user talks to conductor only",
    statePath: "~/.config/opencode/hooks/state/orchestra.json",
    health: "node ~/.config/opencode/hooks/orchestra-health-opencode.js",
    fixScript: "bash scripts/fix-opencode-response.sh --disable-remote-mcp",
  },
};

function spawnLine(platform, agentId) {
  if (platform === "opencode") {
    return `call **task** tool → agent \`${agentId}\``;
  }
  return `launch **${agentId}** via Cursor **Task** tool (subagent_type)`;
}

function handoffBlock(platform = "cursor") {
  const p = PLATFORMS[platform] || PLATFORMS.cursor;
  return [
    "Orchestra handoff (all platforms):",
    "Pass ONLY: goal (1 line) + plan summary (3–5 bullets) + prior failures.",
    "Do NOT pass full chat history, tool logs, or file contents.",
    "Phase commit gate: git clean before next phase (except .cursor/orchestra-plan.md).",
    "",
    `${p.label} spawn: ${p.spawnExample}`,
    `Phase chain: ${p.phaseChain}`,
    "Cross-platform: docs/orchestra-cross-platform.md",
  ].join("\n");
}

function ambientContextBlock() {
  return [
    "Global orchestra (ambient ON): for implement/fix/build/refactor tasks,",
    "run plan → implement → verify → review.",
    "",
    "Cursor: hooks chain phases on subagentStop — Task subagent_type orchestra-*.",
    "OpenCode: default_agent orchestra — task tool spawns hidden orchestra-* phases.",
    "",
    "Phase agents (never user entry on OpenCode): orchestra-planner, orchestra-implementer, orchestra-verifier, orchestra-reviewer.",
    "Skip: pure questions, 'no orchestra', trivial hi/thanks.",
    "Docs: docs/orchestra-cross-platform.md",
  ].join(" ");
}

function toolsMatrixMarkdown() {
  return `| Capability | Cursor | OpenCode |
|------------|--------|----------|
| Spawn subagent | \`Task\` + \`subagent_type\` | \`task\` tool + agent name |
| Conductor agent | Optional (\`orchestra.md\`) | Required (\`default_agent: orchestra\`) |
| Phase auto-chain | Hooks (\`subagentStop\`) | Conductor loops task calls |
| Web docs | Auto-review + permissions | \`websearch\` / \`webfetch\` permission |
| Skills | \`~/.cursor/skills/\` | \`~/.config/opencode/skills/\` + \`skill\` permission |
| MCP | Cursor MCP config | \`opencode.json\` → \`mcp\` (remote can block startup) |
| Plan file | \`.cursor/orchestra-plan.md\` | Same path (shared) |
| State | \`~/.cursor/hooks/state/orchestra.json\` | \`~/.config/opencode/hooks/state/orchestra.json\` |`;
}

module.exports = {
  PHASE_AGENTS,
  PLATFORMS,
  spawnLine,
  handoffBlock,
  ambientContextBlock,
  toolsMatrixMarkdown,
  canRunInParallel,
};

/**
 * Check if two phases can run in parallel based on registry independence metadata.
 * Two phases are independent if they don't share any files, gates, or state keys.
 * @param {object} phaseA - First phase definition
 * @param {object} phaseB - Second phase definition
 * @param {object} registry - Agent registry from bundle/agent-registry.json
 * @returns {boolean} true if phases can run in parallel
 */
function canRunInParallel(phaseA, phaseB, registry) {
  if (!phaseA || !phaseB || !registry) return false;
  
  const agentA = registry.agentDetails?.find(a => a.id === phaseA.agent);
  const agentB = registry.agentDetails?.find(a => a.id === phaseB.agent);
  
  if (!agentA?.independence || !agentB?.independence) return false;
  
  const indA = agentA.independence;
  const indB = agentB.independence;
  
  // Use phase-specific files/gates/stateKeys if provided, else fall back to agent metadata
  const filesA = new Set(phaseA.files || indA.files || []);
  const filesB = new Set(phaseB.files || indB.files || []);
  for (const f of filesA) {
    if (filesB.has(f)) return false;
  }
  
  // Check gate overlap
  const gatesA = new Set(phaseA.gates || indA.gates || []);
  const gatesB = new Set(phaseB.gates || indB.gates || []);
  for (const g of gatesA) {
    if (gatesB.has(g)) return false;
  }
  
  // Check state key overlap
  const stateA = new Set(phaseA.stateKeys || indA.stateKeys || []);
  const stateB = new Set(phaseB.stateKeys || indB.stateKeys || []);
  for (const k of stateA) {
    if (stateB.has(k)) return false;
  }
  
  return true;
}

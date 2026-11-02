"use strict";

/**
 * Master prompts exposed through the MCP `prompts` capability.
 *
 * A remote connector (ChatGPT/Gemini) or a local CLI asks for a named prompt
 * and gets a curated, project-aware instruction to work from — the orchestra's
 * plan/implement/verify/review framing plus any `approved` knowledge the
 * project has accumulated in the store. The server composes text only; it never
 * writes to docs/context. Prompt bodies are capped so recall can't balloon a
 * single message.
 */

const { loadProjectIdentity } = require("./project-identity.js");
const store = require("./knowledge-store.js");

const MAX_KNOWLEDGE_ITEMS = 8;
const MAX_KNOWLEDGE_CHARS = 600;
const MAX_GOAL_CHARS = 4000;

const PROMPTS = [
  {
    name: "orchestra_plan",
    description: "Master prompt for planning an implementation: scope, files, risks, and success criteria.",
    arguments: [{ name: "goal", description: "What to build or fix", required: true }],
  },
  {
    name: "orchestra_implement",
    description: "Master prompt for implementing an approved plan with minimal scope.",
    arguments: [
      { name: "goal", description: "What to build or fix", required: true },
      { name: "plan", description: "The approved plan (optional)", required: false },
    ],
  },
  {
    name: "orchestra_verify",
    description: "Master prompt for verification: tests, lint, smoke, and evidence before claiming done.",
    arguments: [{ name: "goal", description: "What was changed", required: true }],
  },
  {
    name: "orchestra_review",
    description: "Master prompt for final review: scope discipline, quality gates, and doc sync.",
    arguments: [{ name: "goal", description: "What to review", required: true }],
  },
  {
    name: "project_knowledge",
    description: "Master prompt to continue work using this project's approved knowledge and identity.",
    arguments: [{ name: "goal", description: "The task to continue", required: false }],
  },
];

function rootDir() {
  return process.env.PCORE_MCP_ROOT || process.cwd();
}

function projectBlock() {
  let identity = null;
  try {
    identity = loadProjectIdentity(rootDir());
  } catch {
    identity = null;
  }
  if (!identity || !identity.project || !identity.project.name) {
    return "Project: (unidentified — no project.yaml at the served root)";
  }
  const p = identity.project;
  const bits = [`Project: ${p.name} (slug: ${p.slug || "?"})`];
  if (p.type) bits.push(`Type: ${p.type}`);
  const s = identity.stack || {};
  const langs = [...(s.languages || []), ...(s.frameworks || [])].filter(Boolean);
  if (langs.length) bits.push(`Stack: ${langs.join(", ")}`);
  return bits.join("\n");
}

function knowledgeBlock(status = "approved") {
  let rows = [];
  try {
    rows = store.queryKnowledge({ status, limit: MAX_KNOWLEDGE_ITEMS });
  } catch {
    rows = [];
  }
  if (!rows.length) return "";
  const lines = rows.map((r) => {
    const body = String(r.body || "").slice(0, MAX_KNOWLEDGE_CHARS);
    return `- ${r.title}: ${body}`;
  });
  return `\n\nApproved project knowledge to apply:\n${lines.join("\n")}`;
}

function commonRules() {
  return [
    "Ground rules:",
    "- Read only the project's context/*.md and AGENTS.md for conventions; do not scan unrelated trees.",
    "- Scope changes to what the goal requires; no speculative refactors.",
    "- Never claim done without running the relevant checks (tests, lint, health).",
    "- Any new durable knowledge goes back via share_knowledge as pending; a human or phase approves it.",
  ].join("\n");
}

function clip(text) {
  return String(text || "").slice(0, MAX_GOAL_CHARS);
}

/** @returns {string|null} rendered prompt text, or null for an unknown name. */
function renderPrompt(name, args = {}) {
  const a = args || {};
  const goal = clip(a.goal);
  const knowledge = knowledgeBlock();
  const header = `${projectBlock()}\n\n${commonRules()}`;

  switch (name) {
    case "orchestra_plan":
      return `${header}\n\nYou are the planning phase. Goal:\n"""\n${goal}\n"""\n\nProduce a concise implementation plan: files to touch, approach, risks, and how success is verified. Do not write code yet.`;
    case "orchestra_implement": {
      const plan = a.plan ? `\n\nApproved plan:\n"""\n${clip(a.plan)}\n"""` : "";
      return `${header}\n\nYou are the implementation phase. Goal:\n"""\n${goal}\n"""${plan}\n\nMake the minimal, correct change. Follow project conventions and note anything that should become approved knowledge.${knowledge}`;
    }
    case "orchestra_verify":
      return `${header}\n\nYou are the verification phase. Change under test:\n"""\n${goal}\n"""\n\nRun the checks and report actual command output as evidence before claiming success.${knowledge}`;
    case "orchestra_review":
      return `${header}\n\nYou are the review phase. Work to review:\n"""\n${goal}\n"""\n\nCheck scope discipline, quality, security, and whether docs/progress trackers stayed in sync.${knowledge}`;
    case "project_knowledge":
      return `${header}\n\nContinue this project's work${goal ? `:\n"""\n${goal}\n"""` : "."}\n\nUse the approved knowledge below as authoritative context.${knowledge || "\n\n(No approved knowledge yet.)"}`;
    default:
      return null;
  }
}

function listPrompts() {
  return PROMPTS.map((p) => ({ ...p }));
}

module.exports = {
  PROMPTS,
  listPrompts,
  renderPrompt,
  projectBlock,
  knowledgeBlock,
};

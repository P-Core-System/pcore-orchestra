/**
 * Context budget SSOT — what is allowed to enter the model's per-request index.
 *
 * Every entry that is prompt-visible costs tokens on EVERY request of EVERY
 * session, for every model (free pools included). Two index surfaces exist:
 *
 *   1. agent index   — name + description of every non-hidden agent
 *   2. skill index   — name + description of every skill in the skills dir
 *
 * OpenCode resolves agents from BOTH `opencode.json` (`agents{}`) and
 * `~/.config/opencode/agents/**.md`. A file mirror that omits `hidden:` is
 * prompt-visible, which is how 163 SDLC specialists (~10.7K tokens/request)
 * ended up inlined into every call. This module is the single rule that keeps
 * the index small and makes specialists discoverable on demand instead.
 *
 * Discovery is NOT lost: hidden agents remain spawnable by name (the four
 * orchestra phase agents have always been hidden + spawned that way), and the
 * generated `references/specialist-index.md` names-only rollup is read only
 * when the conductor actually needs a specialist outside the core loop.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

/** Chars per token heuristic used across this repo for prompt accounting. */
const CHARS_PER_TOKEN = 4;

/**
 * Agents allowed to stay prompt-visible (mode: subagent) on OpenCode.
 * Empty by design: the conductor is `default_agent` (primary mode) and phase
 * agents are hidden but spawnable. Add a name here only with a measured reason.
 * @type {ReadonlySet<string>}
 */
const VISIBLE_SUBAGENTS = new Set([]);

/**
 * Skills physically installed into the indexed skills dir. Everything else is
 * cataloged (lazy) so it cannot be inlined into the system prompt.
 * Must stay in sync with token-profile ORCHESTRA_SKILLS.
 * @type {ReadonlySet<string>}
 */
const INDEXED_SKILLS = new Set([
  "orchestra-loop",
  "prompt-intake",
  "verification-before-completion",
  "greenfield-product",
]);

/** Generated agent files that are probes/fixtures and must not be installed. */
const JUNK_AGENT_BASENAMES = new Set([
  "zz-probe-v1.md",
  "zz-probe-v2.md",
  "zz-probe-v2b.md",
  "zz-probe-v2c.md",
]);

/**
 * Should this agent be hidden from the per-request index?
 * @param {string} name agent name (frontmatter `name:`)
 * @param {string} [mode] frontmatter mode
 * @returns {boolean}
 */
function isIndexHidden(name, mode) {
  if (mode && mode !== "subagent") return false; // primary/hidden system agents untouched
  return !VISIBLE_SUBAGENTS.has(name);
}

/**
 * @param {string|number} text
 * @returns {number} approximate token count
 */
function estimateTokens(text) {
  if (typeof text === "number") return tokensFromChars(text);
  const s = typeof text === "string" ? text : String(text ?? "");
  return tokensFromChars(s.length);
}

/**
 * Tokens from a character count (kept separate so row cost helpers can pass
 * arithmetic without re-deriving a string length).
 * @param {number} chars
 * @returns {number}
 */
function tokensFromChars(chars) {
  return Math.ceil((Number.isFinite(chars) ? chars : 0) / CHARS_PER_TOKEN);
}

/**
 * Cost of one agent row as OpenCode renders it (`<agent name="…">desc</agent>`).
 * @param {{name:string, description?:string}} agent
 * @returns {number} tokens
 */
function agentIndexRowTokens(agent) {
  const name = agent.name || "";
  const desc = agent.description || "";
  return estimateTokens(name.length + desc.length + 14);
}

/**
 * Cost of one skill row as OpenCode renders it.
 * @param {{name:string, description?:string}} skill
 * @returns {number} tokens
 */
function skillIndexRowTokens(skill) {
  const name = skill.name || "";
  const desc = skill.description || "";
  return estimateTokens(name.length + desc.length + 12);
}

/**
 * Summarize an index surface.
 * @param {Array<{name:string,description?:string}>} rows
 * @param {(row:any)=>number} costOf
 * @returns {{entries:number, tokens:number, bytes:number}}
 */
function summarizeIndex(rows, costOf) {
  let tokens = 0;
  let bytes = 0;
  for (const r of rows || []) {
    tokens += costOf(r);
    bytes += (r.name || "").length + (r.description || "").length;
  }
  return { entries: (rows || []).length, tokens, bytes };
}

/**
 * Compact rollup of hidden specialists, addressed by the id OpenCode actually
 * resolves. Nested agent files are keyed by their PATH-QUALIFIED name
 * (`07-red-team/red-team-operator`), so a bare-name index would be unspawnable
 * and the conductor would fail on the first specialist it tried.
 *
 * @param {Array<{id:string}>} agents ids as OpenCode reports them
 * @returns {string} markdown
 */
function buildSpecialistIndex(agents) {
  const groups = new Map();
  for (const a of agents || []) {
    const id = String((a && a.id) || "").replace(/\.md$/, "");
    if (!id || id.startsWith("references/")) continue;
    if (JUNK_AGENT_BASENAMES.has(id.split("/").pop())) continue;
    const slash = id.lastIndexOf("/");
    const seg = slash > 0 ? id.slice(0, slash) : "stage";
    if (!groups.has(seg)) groups.set(seg, []);
    groups.get(seg).push(id);
  }
  const lines = [
    "<!-- GENERATED: hidden specialist routing table. Names are spawn ids.",
    "     Not in the per-request prompt index; read only when a specialist", "     outside the core loop is needed. -->",
    "# Specialist index — hidden, spawn by `id` via the subagent tool",
    "",
  ];
  for (const seg of [...groups.keys()].sort()) {
    const ids = groups.get(seg).sort();
    lines.push(`## ${seg}`, "", ...ids.map((i) => `- ${i}`), "");
  }
  return lines.join("\n");
}

/**
 * Resolve the OpenCode config dir the same way the rest of the tooling does.
 * @returns {string}
 */
function opencodeConfigDir() {
  const xdg = process.env.XDG_CONFIG_HOME || path.join(process.env.HOME || "", ".config");
  return path.join(xdg, "opencode");
}

/**
 * Parse `name:` / `description:` / `hidden:` / `mode:` from agent markdown.
 * @param {string} raw
 * @returns {{name:string,description:string,hidden:boolean,mode:string}|null}
 */
function parseAgentFrontmatter(raw) {
  const m = String(raw).match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const fm = m[1];
  const grab = (key) => {
    const one = fm.match(new RegExp("^" + key + ":[ \\t]*(.*)$", "m"));
    if (!one) return "";
    const inline = one[1].trim();
    if (/^[>|]-?$/.test(inline)) {
      // folded block scalar: collect indented continuation lines
      const start = fm.indexOf(one[0]) + one[0].length;
      const rest = fm.slice(start).split("\n");
      const chunk = [];
      for (const l of rest) {
        if (/^\s+\S/.test(l)) chunk.push(l.trim());
        else if (l.trim() === "") continue;
        else break;
      }
      return chunk.join(" ").replace(/\s+/g, " ").trim();
    }
    return inline.replace(/^["']|["']$/g, "");
  };
  return {
    name: grab("name"),
    description: grab("description"),
    hidden: /^hidden:[ \t]*true/m.test(fm),
    mode: grab("mode"),
  };
}

/**
 * Audit an installed agent tree: what actually lands in the prompt index.
 * @param {string} dir agents dir
 * @returns {{rows:Array<{name:string,description:string,hidden:boolean,file:string}>, visible:any, hidden:any}}
 */
function auditAgentDir(dir) {
  const rows = [];
  const walk = (d) => {
    let ents;
    try {
      ents = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(".md")) {
        const parsed = parseAgentFrontmatter(fs.readFileSync(full, "utf8"));
        if (parsed && parsed.name) rows.push({ ...parsed, file: full });
      }
    }
  };
  walk(dir);
  const visible = rows.filter((r) => !r.hidden);
  const hidden = rows.filter((r) => r.hidden);
  return {
    rows,
    visible: summarizeIndex(visible, agentIndexRowTokens),
    hidden: summarizeIndex(hidden, agentIndexRowTokens),
  };
}

/**
 * Audit an installed skill tree.
 * @param {string} dir skills dir
 * @returns {{rows:any[], indexed:any, lazyDirs:string[]}}
 */
function auditSkillDir(dir) {
  const rows = [];
  const lazyDirs = [];
  let ents = [];
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return { rows, indexed: summarizeIndex([], skillIndexRowTokens), lazyDirs };
  }
  for (const e of ents) {
    if (!e.isDirectory() && !e.isSymbolicLink()) continue;
    const p = path.join(dir, e.name, "SKILL.md");
    if (!fs.existsSync(p)) {
      lazyDirs.push(e.name);
      continue;
    }
    const parsed = parseAgentFrontmatter(fs.readFileSync(p, "utf8"));
    rows.push({ name: e.name, description: parsed ? parsed.description : "", file: p });
  }
  const indexed = rows.filter((r) => INDEXED_SKILLS.has(r.name));
  return {
    rows,
    indexed: summarizeIndex(indexed, skillIndexRowTokens),
    lazyDirs,
  };
}

/**
 * Default skill roots OpenCode indexes (config dir + external discovery).
 * @param {string} configDir
 * @returns {string[]}
 */
function defaultSkillRoots(configDir) {
  const home = process.env.HOME || "";
  const roots = [path.join(configDir, "skills")];
  if (home) {
    roots.push(path.join(home, ".agents", "skills"));
    roots.push(path.join(home, ".claude", "skills"));
  }
  return roots;
}

/**
 * Whole per-request index surface: installed agent tree + config `agents{}`
 * (minus hidden/primary) + every indexed skill root.
 *
 * @param {{configDir?:string, config?:object}} [opts]
 * @returns {{agents:object, skills:object, totalTokens:number}}
 */
function fullIndexReport(opts = {}) {
  const configDir = opts.configDir || opencodeConfigDir();
  const agentAudit = auditAgentDir(path.join(configDir, "agents"));

  let cfgRows = [];
  const cfg =
    opts.config ||
    (() => {
      try {
        return JSON.parse(fs.readFileSync(path.join(configDir, "opencode.json"), "utf8"));
      } catch {
        return null;
      }
    })();
  if (cfg && cfg.agents && typeof cfg.agents === "object") {
    cfgRows = Object.entries(cfg.agents)
      .filter(([, v]) => v && v.hidden !== true && v.mode !== "primary")
      .map(([name, v]) => ({ name, description: (v && v.description) || "" }));
  }

  const dirVisible = agentAudit.rows.filter((r) => !r.hidden);
  const agents = summarizeIndex([...dirVisible, ...cfgRows], agentIndexRowTokens);

  const skills = { entries: 0, tokens: 0, bytes: 0, allowed: 0, denied: 0, roots: [] };
  const seen = new Set();
  for (const root of defaultSkillRoots(configDir)) {
    const a = auditSkillDir(root);
    skills.roots.push({
      root,
      entries: a.rows.length,
      tokens: a.rows.reduce((s, r) => s + skillIndexRowTokens(r), 0),
    });
    for (const r of a.rows) {
      if (seen.has(r.name)) continue;
      seen.add(r.name);
      skills.entries += 1;
      skills.tokens += skillIndexRowTokens(r);
      skills.bytes += r.name.length + (r.description || "").length;
      if (INDEXED_SKILLS.has(r.name)) skills.allowed += 1;
      else skills.denied += 1;
    }
  }

  return { agents, skills, totalTokens: agents.tokens + skills.tokens };
}

/**
 * Model-request step ceilings by role. The free OpenCode pools are limited by
 * a per-DAY REQUEST counter (`Rate limit exceeded:
 * free-models-per-day-high-balance`), not by tokens, so the worst-case steps
 * of every agent is the direct dial on quota. Shipping 200–500 steps per
 * specialist means one runaway subagent can consume a whole day's allowance.
 *
 * Sized so a normal run never hits the ceiling (a phase typically takes
 * 5–15 calls); hitting it triggers the conductor's resume path, which costs
 * extra requests, so the cap must clear real work, not just look lean.
 */
const STEP_BUDGET = {
  conductor: 80,
  phase: 40,
  specialist: 20,
};

/**
 * SDLC 7-stage pipeline roles. They share the phase budget because each one
 * owns a gated stage (and may need several fix loops inside it), unlike a
 * one-shot specialist.
 * @type {ReadonlySet<string>}
 */
const STAGE_AGENTS = new Set([
  "ai-trigger",
  "architect",
  "coding-agent",
  "product-owner",
  "qa-agent",
  "release-agent",
  "release-manager",
  "review-agent",
  "sre-agent",
  "sre-agent-2",
  "tech-lead",
]);

/**
 * @param {string} name agent name
 * @returns {number} step ceiling for this role
 */
function maxStepsFor(name) {
  if (name === "orchestra") return STEP_BUDGET.conductor;
  if (String(name).startsWith("orchestra-") || STAGE_AGENTS.has(name)) return STEP_BUDGET.phase;
  return STEP_BUDGET.specialist;
}

/**
 * Clamp a requested step budget to the role ceiling (never raises it).
 * @param {string} name
 * @param {number|string|null} [steps]
 * @returns {number}
 */
function clampSteps(name, steps) {
  const cap = maxStepsFor(name);
  const n = parseInt(steps, 10);
  if (!Number.isFinite(n) || n <= 0) return cap;
  return Math.min(n, cap);
}

/**
 * Verbatim history retained after auto-compaction. Bounds the per-call prompt
 * on long-running sessions (measured live: 127K–327K tokens/call, dominated by
 * re-sent history in cache reads). Orchestra keeps its durable state in plan
 * artifacts + context files, which agents re-read on demand, so a bounded
 * verbatim tail costs accuracy far less than it costs quota and latency.
 */
const COMPACTION_KEEP_TOKENS = 20000;

/**
 * Resolve flat-directory basename conflicts deterministically instead of
 * throwing. Claude Code and Codex agent trees are flat, so a root stage agent
 * and a phase-foldered specialist that share a name cannot both exist.
 *
 * Rule: the shallower source wins (root `tech-lead.md` beats
 * `03-architecture/tech-lead.md`), because the 7-stage chain spawns by plain
 * name and the root files are those stage roles. Conflicts are returned so the
 * surface can be reported rather than silently merged.
 *
 * @param {Array<{fileName:string, rel:string, value:string}>} entries in walk order
 * @returns {{map:Map<string,string>, conflicts:Array<{fileName:string,winner:string,loser:string}>}}
 */
function dedupeFlat(entries) {
  const depth = (rel) => rel.split(/[\\/]/).length;
  const best = new Map();
  const conflicts = [];
  for (const e of entries || []) {
    const cur = best.get(e.fileName);
    if (!cur) {
      best.set(e.fileName, e);
      continue;
    }
    if (depth(e.rel) < depth(cur.rel)) {
      conflicts.push({ fileName: e.fileName, winner: e.rel, loser: cur.rel });
      best.set(e.fileName, e);
    } else {
      conflicts.push({ fileName: e.fileName, winner: cur.rel, loser: e.rel });
    }
  }
  const map = new Map();
  for (const [k, v] of best) map.set(k, v.value);
  return { map, conflicts };
}

module.exports = {
  CHARS_PER_TOKEN,
  VISIBLE_SUBAGENTS,
  INDEXED_SKILLS,
  JUNK_AGENT_BASENAMES,
  isIndexHidden,
  dedupeFlat,
  STAGE_AGENTS,
  STEP_BUDGET,
  COMPACTION_KEEP_TOKENS,
  maxStepsFor,
  clampSteps,
  estimateTokens,
  tokensFromChars,
  agentIndexRowTokens,
  skillIndexRowTokens,
  summarizeIndex,
  buildSpecialistIndex,
  opencodeConfigDir,
  parseAgentFrontmatter,
  auditAgentDir,
  auditSkillDir,
  defaultSkillRoots,
  fullIndexReport,
};

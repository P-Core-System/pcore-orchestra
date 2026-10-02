#!/usr/bin/env node
"use strict";

/**
 * Agent registry SSOT generator.
 *
 * Derives the canonical agent roster from bundle/hooks/lib/constants.js
 * (CORE_PHASES + SDLC_PHASES + DELIVERY_EXTRA_AGENTS) and keeps every
 * generated artifact in sync:
 *
 *   bundle/agent-registry.json        published registry (counts + roster)
 *   bundle/hooks.json                 chained subagentStop matchers
 *   project-bridge/hooks.json         per-repo bridge variant
 *   .cursor/hooks.json                this repo's own bridge copy
 *
 * Narrow matchers (orchestra-memory, orchestra-quality-gate) are intentional
 * and are never touched.
 *
 * Usage:
 *   node scripts/gen-agent-registry.js          # regenerate in place
 *   node scripts/gen-agent-registry.js --check  # exit 1 if anything is stale
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const REGISTRY_PATH = path.join(ROOT, "bundle", "agent-registry.json");
const HOOKS_COPIES = [
  path.join(ROOT, "bundle", "hooks.json"),
  path.join(ROOT, "project-bridge", "hooks.json"),
  path.join(ROOT, ".cursor", "hooks.json"),
];
const AGENT_DIRS = [
  path.join(ROOT, "bundle", "agents"),
  path.join(ROOT, "bundle", "opencode", "agents"),
];
const CONDUCTORS = [
  path.join(ROOT, "bundle", "agents", "orchestra.md"),
  path.join(ROOT, "bundle", "opencode", "agents", "orchestra.md"),
];
const TASK_BEGIN = "# BEGIN GENERATED: task allowlist (scripts/gen-agent-registry.js)";
const TASK_END = "# END GENERATED: task allowlist";
const CHAINED_RE = /orchestra-subagent-stop\.js|orchestra-lifecycle\.js/;

function uniqSorted(list) {
  return Array.from(new Set(list)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** core ∪ sdlc ∪ delivery extras, sorted, plus the joined matcher string. */
function derive() {
  const { CORE_PHASES, SDLC_PHASES, DELIVERY_EXTRA_AGENTS } = require("../bundle/hooks/lib/constants.js");
  const core = uniqSorted(CORE_PHASES.map((p) => p.agent));
  const sdlc = uniqSorted(SDLC_PHASES.map((p) => p.agent));
  const deliveryExtra = uniqSorted(DELIVERY_EXTRA_AGENTS);
  const hookAgents = uniqSorted(core.concat(sdlc, deliveryExtra));
  return { core, sdlc, deliveryExtra, hookAgents, matcher: hookAgents.join("|") };
}

/** `name:` from a YAML frontmatter block; null when there is none. */
function frontmatterName(text) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!fm) return null;
  const m = /^name:\s*["']?([A-Za-z0-9._-]+)/m.exec(fm[1]);
  return m ? m[1] : null;
}

function scanAgentDir(dir) {
  const names = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".md")) {
        const name = frontmatterName(fs.readFileSync(p, "utf8"));
        if (name) names.push(name);
      }
    }
  };
  walk(dir);
  return uniqSorted(names);
}

function buildRegistry(roster) {
  const cursor = scanAgentDir(AGENT_DIRS[0]);
  const opencode = scanAgentDir(AGENT_DIRS[1]);
  return {
    version: 1,
    generator: "scripts/gen-agent-registry.js",
    hookMatcher: roster.matcher,
    hookAgents: roster.hookAgents,
    sources: {
      core: roster.core,
      sdlc: roster.sdlc,
      deliveryExtra: roster.deliveryExtra,
    },
    counts: {
      hookAgents: roster.hookAgents.length,
      agentFiles: cursor.length,
      cursorAgents: cursor.length,
      opencodeAgents: opencode.length,
    },
    agents: cursor,
  };
}

/** Point the chained subagentStop entries at the derived matcher. */
function applyHooks(obj, matcher) {
  const list = (obj.hooks && obj.hooks.subagentStop) || [];
  let touched = 0;
  for (const entry of list) {
    if (typeof entry.command === "string" && CHAINED_RE.test(entry.command)) {
      if (entry.matcher !== matcher) {
        entry.matcher = matcher;
        touched += 1;
      }
    }
  }
  return { obj, touched };
}

const RULE_RE = /^"[^"]+":\s*(allow|deny)$/;
const ALLOW_PAT_RE = /^"([^"]+)":\s*allow$/;

function ruleCovers(ruleLine, agent) {
  const m = ALLOW_PAT_RE.exec(ruleLine);
  if (!m) return false;
  const pat = m[1];
  return pat.endsWith("*") ? agent.startsWith(pat.slice(0, -1)) : pat === agent;
}

/**
 * Regenerate the conductor's permission.task block:
 * `"*": deny` first, every existing allow rule preserved (additive only), and
 * one `<agent>*: allow` per registered agent so nothing in the registry is
 * unspawnable. The block is wrapped in BEGIN/END markers.
 *
 * Returns the rewritten file text, or null when there is no task block.
 */
function rewriteTaskBlock(text, agents) {
  const eol = /\r\n/.test(text) ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^  task:\s*$/.test(l));
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && !/^  \w/.test(lines[end])) end += 1;

  const section = lines.slice(start + 1, end);
  const rules = [];
  const passthrough = [];
  for (const raw of section) {
    const t = raw.trim();
    if (!t) continue;
    if (RULE_RE.test(t)) rules.push(t);
    else if (t === TASK_BEGIN || t === TASK_END) continue;
    else passthrough.push(raw);
  }

  const deny = rules.filter((r) => /^"\*":\s*deny$/.test(r));
  const allow = rules.filter((r) => !/^"\*":\s*deny$/.test(r));
  const ordered = deny.length > 0 ? deny : ['"*": deny'];
  ordered.push(...allow);

  for (const agent of agents) {
    if (!ordered.some((r) => ruleCovers(r, agent))) {
      ordered.push(`"${agent}*": allow`);
    }
  }

  const rebuilt = [
    "    " + TASK_BEGIN,
    ...ordered.map((r) => "    " + r),
    "    " + TASK_END,
    ...passthrough,
  ];

  return [...lines.slice(0, start + 1), ...rebuilt, ...lines.slice(end)].join(eol);
}

function serializeHooks(obj) {
  return JSON.stringify(obj, null, 2) + "\n";
}

function serializeRegistry(reg) {
  return JSON.stringify(reg, null, 2) + "\n";
}

/** @returns {{path:string, expected:string, current:string|null, stale:boolean}[]} */
function plan(roster, registry) {
  const jobs = [];

  for (const file of HOOKS_COPIES) {
    const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    let expected;
    if (current === null) {
      expected = null;
    } else {
      const obj = JSON.parse(current);
      applyHooks(obj, roster.matcher);
      expected = serializeHooks(obj);
    }
    jobs.push({
      path: file,
      rel: path.relative(ROOT, file),
      expected,
      current,
      stale: current === null || expected !== current,
    });
  }

  const regCurrent = fs.existsSync(REGISTRY_PATH) ? fs.readFileSync(REGISTRY_PATH, "utf8") : null;
  const regExpected = serializeRegistry(registry);
  jobs.push({
    path: REGISTRY_PATH,
    rel: path.relative(ROOT, REGISTRY_PATH),
    expected: regExpected,
    current: regCurrent,
    stale: regCurrent !== regExpected,
  });

  for (const file of CONDUCTORS) {
    const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    const expected = current === null ? null : rewriteTaskBlock(current, registry.agents);
    jobs.push({
      path: file,
      rel: path.relative(ROOT, file),
      expected,
      current,
      stale: current === null || expected === null || expected !== current,
    });
  }

  return jobs;
}

function main(argv) {
  const checkOnly = argv.includes("--check");
  const roster = derive();
  const registry = buildRegistry(roster);
  const jobs = plan(roster, registry);
  const stale = jobs.filter((j) => j.stale);

  if (checkOnly) {
    if (stale.length === 0) {
      console.log(`agent registry: OK (${roster.hookAgents.length} hook agents, ${registry.counts.agentFiles} agent files)`);
      return 0;
    }
    console.error("agent registry: STALE — regenerate with `node scripts/gen-agent-registry.js`");
    for (const j of stale) console.error(`  - ${j.rel}`);
    return 1;
  }

  for (const j of jobs) {
    if (j.stale) {
      fs.mkdirSync(path.dirname(j.path), { recursive: true });
      fs.writeFileSync(j.path, j.expected, "utf8");
      console.log(`wrote ${j.rel}`);
    } else {
      console.log(`unchanged ${j.rel}`);
    }
  }
  return 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = {
  derive,
  buildRegistry,
  applyHooks,
  rewriteTaskBlock,
  frontmatterName,
  scanAgentDir,
  plan,
  main,
  HOOKS_COPIES,
  REGISTRY_PATH,
  TASK_BEGIN,
  TASK_END,
};

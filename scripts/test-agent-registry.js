#!/usr/bin/env node
"use strict";

/**
 * Step 4 self-check: agent registry SSOT generator.
 *
 * The registry is derived from bundle/hooks/lib/constants.js
 * (CORE_PHASES + SDLC_PHASES + DELIVERY_EXTRA_AGENTS) and must stay in sync
 * with every hooks.json copy plus the agent files on disk.
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const REGISTRY = path.join(ROOT, "bundle", "agent-registry.json");
const HOOKS_COPIES = [
  "bundle/hooks.json",
  "project-bridge/hooks.json",
  ".cursor/hooks.json",
];

let failed = 0;

function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** The 27-name matcher that shipped before the generator existed. */
const BASELINE = [
  "business-analyst", "product-manager", "architect", "tech-lead", "project-manager",
  "backend-engineer", "frontend-engineer", "full-stack-engineer", "database-engineer",
  "qa-engineer", "automation-engineer", "security-engineer", "accessibility-reviewer",
  "documentation-writer", "release-manager", "devops-engineer", "sre", "observer",
  "code-reviewer", "performance-engineer", "platform-engineer", "cloud-engineer",
  "infrastructure-engineer", "orchestra-planner", "orchestra-implementer",
  "orchestra-verifier", "orchestra-reviewer",
];

const CORE4 = "orchestra-planner|orchestra-implementer|orchestra-verifier|orchestra-reviewer";
const QUALITY3 = "orchestra-reviewer|code-reviewer|release-manager";

function setEq(a, b) {
  const sa = Array.from(new Set(a)).sort();
  const sb = Array.from(new Set(b)).sort();
  return sa.length === sb.length && sa.every((x, i) => x === sb[i]);
}

function agentNamesFrom(dir) {
  const names = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".md")) {
        const head = fs.readFileSync(p, "utf8").split("\n").slice(0, 30).join("\n");
        const m = /^name:\s*["']?([A-Za-z0-9._-]+)/m.exec(head.replace(/^---\r?\n/, ""));
        if (m) names.push(m[1]);
      }
    }
  };
  walk(dir);
  return names;
}

// --------------------------------------------------------------- derive
const gen = require("./gen-agent-registry.js");

check("generator exports derive()", typeof gen.derive === "function", typeof gen.derive);
const roster = gen.derive();
check("derive().hookAgents is the baseline 27 (set equality)", setEq(roster.hookAgents, BASELINE), JSON.stringify(roster.hookAgents));
check(
  "hookAgents sorted + unique",
  eqSortedUnique(roster.hookAgents),
  JSON.stringify(roster.hookAgents)
);
check("matcher is the sorted names joined by |", roster.matcher === roster.hookAgents.join("|"), roster.matcher);
check(
  "delivery extras are non-phase agents",
  roster.deliveryExtra.length === 8 && roster.deliveryExtra.every((a) => !roster.core.includes(a) && !roster.sdlc.includes(a)),
  JSON.stringify(roster.deliveryExtra)
);
check(
  "core ∪ sdlc ∪ delivery == hookAgents",
  setEq(roster.hookAgents, roster.core.concat(roster.sdlc, roster.deliveryExtra)),
  JSON.stringify(roster.hookAgents)
);

function eqSortedUnique(list) {
  const sorted = Array.from(new Set(list)).sort();
  return list.length === sorted.length && list.every((x, i) => x === sorted[i]);
}

// ------------------------------------------------------------ hooks.json
for (const rel of HOOKS_COPIES) {
  const raw = fs.readFileSync(path.join(ROOT, rel), "utf8");
  const obj = JSON.parse(raw);
  const chain = (obj.hooks.subagentStop || []).filter((e) =>
    /orchestra-subagent-stop\.js|orchestra-lifecycle\.js/.test(e.command)
  );
  check(`${rel}: two chained entries`, chain.length === 2, String(chain.length));
  check(
    `${rel}: chained matchers == derived`,
    chain.every((e) => e.matcher === roster.matcher),
    chain.map((e) => e.matcher).join(" // ")
  );

  const mem = (obj.hooks.subagentStop || []).find((e) => /orchestra-memory\.js/.test(e.command));
  check(`${rel}: memory matcher stays the core 4`, mem && mem.matcher === CORE4, mem && mem.matcher);
  const qg = (obj.hooks.subagentStop || []).find((e) => /orchestra-quality-gate\.js/.test(e.command));
  check(`${rel}: quality-gate matcher stays the 3`, qg && qg.matcher === QUALITY3, qg && qg.matcher);
}

// ------------------------------------------------------------- registry
check("bundle/agent-registry.json exists", fs.existsSync(REGISTRY));
const reg = JSON.parse(fs.readFileSync(REGISTRY, "utf8"));
check("registry hookMatcher == derived matcher", reg.hookMatcher === roster.matcher, String(reg.hookMatcher));
check("registry hookAgents == baseline 27", setEq(reg.hookAgents, BASELINE), JSON.stringify(reg.hookAgents));
check("registry counts.hookAgents == 27", reg.counts && reg.counts.hookAgents === 27, JSON.stringify(reg.counts));
check(
  "every hook agent appears in registry.agents",
  roster.hookAgents.every((a) => reg.agents.includes(a)),
  JSON.stringify(roster.hookAgents.filter((a) => !reg.agents.includes(a)))
);
check("registry.agents sorted + unique", eqSortedUnique(reg.agents), `${(reg.agents || []).length}`);

const cursorAgents = agentNamesFrom(path.join(ROOT, "bundle", "agents"));
const opencodeAgents = agentNamesFrom(path.join(ROOT, "bundle", "opencode", "agents"));
check(
  "registry counts agentFiles == agent files with a name: (cursor)",
  reg.counts.agentFiles === cursorAgents.length,
  `${reg.counts && reg.counts.agentFiles} vs ${cursorAgents.length}`
);
check(
  "cursor and opencode agent sets match",
  setEq(cursorAgents, opencodeAgents),
  `${cursorAgents.length} vs ${opencodeAgents.length}`
);
check(
  "every registry agent resolves to a cursor file",
  reg.agents.every((a) => cursorAgents.includes(a)),
  JSON.stringify(reg.agents.filter((a) => !cursorAgents.includes(a)).slice(0, 10))
);

// --------------------------------------------------------------- --check
function runCheck() {
  return spawnSync(process.execPath, [path.join(ROOT, "scripts", "gen-agent-registry.js"), "--check"], {
    encoding: "utf8",
    timeout: 30000,
  });
}

const clean = runCheck();
check("--check exits 0 on a clean tree", clean.status === 0, `status=${clean.status} ${clean.stdout}${clean.stderr}`);

// staleness must be detected (tamper, check, restore)
const hooksPath = path.join(ROOT, "bundle", "hooks.json");
const original = fs.readFileSync(hooksPath, "utf8");
try {
  const tampered = JSON.parse(original);
  tampered.hooks.subagentStop[0].matcher = "orchestra-planner";
  fs.writeFileSync(hooksPath, JSON.stringify(tampered, null, 2) + "\n", "utf8");
  const dirty = runCheck();
  check("--check exits non-zero when hooks.json drifts", dirty.status !== 0, `status=${dirty.status}`);
} finally {
  fs.writeFileSync(hooksPath, original, "utf8");
}
check("hooks.json restored byte-identical", fs.readFileSync(hooksPath, "utf8") === original);

console.log(failed === 0 ? "\nAll agent registry tests passed." : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

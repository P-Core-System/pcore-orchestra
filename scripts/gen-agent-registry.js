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

/**
 * Path-derived namespaced agent IDs for the OpenCode tree.
 *
 * Real OpenCode agent IDs are directory-namespaced (`dir/name`, one level
 * deep — e.g. `03-architecture/tech-lead`), while the conductor allowlist
 * historically carried only bare globs (`tech-lead*`) that never match them.
 * Derived from the FILE PATH (relative, `.md` stripped) — never from
 * frontmatter `name:` — so counts stay pinned at 160/160 (invariant 17).
 * Root-level agents (no directory) are omitted: their bare globs already
 * cover them. Reference docs without a frontmatter `name:` are skipped.
 *
 * @returns {string[]} sorted `dir/name` ids.
 */
function scanNamespacedIds(dir) {
  const ids = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".md")) {
        const rel = path.relative(dir, p).split(path.sep).join("/");
        if (!rel.includes("/")) continue; // root-level: bare globs cover it
        if (!frontmatterName(fs.readFileSync(p, "utf8"))) continue; // docs, not agents
        ids.push(rel.replace(/\.md$/, ""));
      }
    }
  };
  walk(dir);
  return uniqSorted(ids);
}

function buildRegistry(roster) {
  const cursor = scanAgentDir(AGENT_DIRS[0]);
  const opencode = scanAgentDir(AGENT_DIRS[1]);
  const namespacedIds = scanNamespacedIds(AGENT_DIRS[1]);
  
  // Independence metadata: files, gates, stateKeys each agent touches
  const INDEPENDENCE_MAP = {
    "orchestra-planner": {
      files: ["context/architecture.md", "context/project-overview.md", "context/progress-tracker.md", ".cursor/orchestra-plan.md"],
      gates: [],
      stateKeys: ["goal", "memory", "orchestraConfig"],
    },
    "orchestra-implementer": {
      files: ["**/*.js", "**/*.ts", "**/*.py", "**/*.md"],
      gates: [],
      stateKeys: ["files_changed", "memory"],
    },
    "orchestra-verifier": {
      files: [],
      gates: ["build", "tests", "lint", "security", "docs-updated"],
      stateKeys: ["qualityGates", "evidence_records"],
    },
    "orchestra-reviewer": {
      files: [],
      gates: ["reviewer-approval", "docs-updated", "memory-updated"],
      stateKeys: ["qualityGates", "review_decision"],
    },
    "business-analyst": {
      files: ["context/project-overview.md", "context/requirements.md"],
      gates: [],
      stateKeys: ["requirements", "memory"],
    },
    "product-manager": {
      files: ["context/requirements.md", "context/user-stories.md"],
      gates: [],
      stateKeys: ["stories", "memory"],
    },
    "architect": {
      files: ["context/architecture.md", "context/tech-selection.md"],
      gates: [],
      stateKeys: ["architecture", "memory"],
    },
    "tech-lead": {
      files: ["context/folder-structure.md", "context/coding-standards.md"],
      gates: [],
      stateKeys: ["tech_decisions", "memory"],
    },
    "project-manager": {
      files: ["context/sprint-plan.md", "context/task-breakdown.md"],
      gates: [],
      stateKeys: ["tasks", "memory"],
    },
    "backend-engineer": {
      files: ["src/**/*.js", "src/**/*.ts", "src/**/*.py"],
      gates: ["build", "tests"],
      stateKeys: ["files_changed", "memory"],
    },
    "frontend-engineer": {
      files: ["src/**/*.tsx", "src/**/*.jsx", "src/**/*.css", "src/**/*.html"],
      gates: ["build", "tests", "lint"],
      stateKeys: ["files_changed", "memory"],
    },
    "full-stack-engineer": {
      files: ["src/**/*"],
      gates: ["build", "tests", "lint"],
      stateKeys: ["files_changed", "memory"],
    },
    "database-engineer": {
      files: ["migrations/**", "src/**/*.sql", "prisma/**"],
      gates: ["build", "tests"],
      stateKeys: ["files_changed", "memory"],
    },
    "qa-engineer": {
      files: ["tests/**", "e2e/**"],
      gates: ["tests", "lint"],
      stateKeys: ["test_results", "memory"],
    },
    "automation-engineer": {
      files: ["e2e/**", "scripts/**", ".github/**"],
      gates: ["tests", "lint"],
      stateKeys: ["test_results", "memory"],
    },
    "security-engineer": {
      files: ["**/*.js", "**/*.ts", "**/*.py", "**/*.sh"],
      gates: ["security"],
      stateKeys: ["security_findings", "memory"],
    },
    "accessibility-reviewer": {
      files: ["src/**/*.tsx", "src/**/*.jsx", "src/**/*.html", "src/**/*.css"],
      gates: [],
      stateKeys: ["a11y_findings", "memory"],
    },
    "documentation-writer": {
      files: ["docs/**", "context/**", "README.md", "CHANGELOG.md"],
      gates: ["docs-updated"],
      stateKeys: ["docs_updated", "memory"],
    },
    "release-manager": {
      files: ["CHANGELOG.md", "package.json", ".github/**"],
      gates: ["version-updated", "changelog-updated", "release-notes-updated"],
      stateKeys: ["release_info", "memory"],
    },
    "devops-engineer": {
      files: ["docker/**", "k8s/**", "terraform/**", ".github/**", "scripts/**"],
      gates: ["build", "lint"],
      stateKeys: ["infra_changes", "memory"],
    },
    "sre": {
      files: ["monitoring/**", "alerting/**", "scripts/**"],
      gates: [],
      stateKeys: ["slo_data", "memory"],
    },
    "observer": {
      files: ["monitoring/**", "dashboards/**"],
      gates: [],
      stateKeys: ["metrics", "memory"],
    },
    "code-reviewer": {
      files: ["**/*.js", "**/*.ts", "**/*.py", "**/*.md"],
      gates: ["reviewer-approval"],
      stateKeys: ["review_comments", "memory"],
    },
    "performance-engineer": {
      files: ["src/**/*", "benchmarks/**"],
      gates: [],
      stateKeys: ["perf_data", "memory"],
    },
    "platform-engineer": {
      files: ["k8s/**", "terraform/**", "docker/**"],
      gates: [],
      stateKeys: ["platform_changes", "memory"],
    },
    "cloud-engineer": {
      files: ["cloud/**", "terraform/**", "scripts/**"],
      gates: [],
      stateKeys: ["cloud_resources", "memory"],
    },
    "infrastructure-engineer": {
      files: ["terraform/**", "ansible/**", "scripts/**"],
      gates: [],
      stateKeys: ["infra_changes", "memory"],
    },
    "agent-selector": {
      files: [],
      gates: [],
      stateKeys: ["team_roster", "memory"],
    },
    "workflow-orchestrator": {
      files: ["context/workflow-plan.md"],
      gates: [],
      stateKeys: ["workflow_plan", "memory"],
    },
    "project-type-classifier": {
      files: ["project.yaml"],
      gates: [],
      stateKeys: ["project_type", "memory"],
    },
    "business-strategist": {
      files: ["context/business-strategy.md"],
      gates: [],
      stateKeys: ["strategy", "memory"],
    },
    "stakeholder-advocate": {
      files: ["context/stakeholder-input.md"],
      gates: [],
      stateKeys: ["stakeholder_feedback", "memory"],
    },
    "compliance-officer": {
      files: ["context/compliance.md"],
      gates: [],
      stateKeys: ["compliance_checks", "memory"],
    },
    "legal-advisor": {
      files: ["context/legal-review.md"],
      gates: [],
      stateKeys: ["legal_opinion", "memory"],
    },
    "security-executive-advisor": {
      files: ["context/security-policy.md"],
      gates: [],
      stateKeys: ["security_policy", "memory"],
    },
    "ops-manager": {
      files: ["context/ops-runbook.md"],
      gates: [],
      stateKeys: ["ops_plan", "memory"],
    },
    "incident-responder": {
      files: ["context/incident-response.md"],
      gates: [],
      stateKeys: ["incident_log", "memory"],
    },
    "data-engineer": {
      files: ["data/**", "sql/**", "pipelines/**"],
      gates: ["build", "tests"],
      stateKeys: ["data_models", "memory"],
    },
    "ui-ux-designer": {
      files: ["design/**", "src/**/*.css", "src/**/*.scss", "context/ui-context.md"],
      gates: [],
      stateKeys: ["design_specs", "memory"],
    },
    "scrum-master": {
      files: ["context/sprint-plan.md", "context/retrospective.md"],
      gates: [],
      stateKeys: ["sprint_data", "memory"],
    },
    "ai-ethics-reviewer": {
      files: ["context/ai-ethics.md"],
      gates: [],
      stateKeys: ["ethics_review", "memory"],
    },
    "ai-safety-engineer": {
      files: ["context/ai-safety.md"],
      gates: [],
      stateKeys: ["safety_checks", "memory"],
    },
    "annotation-specialist": {
      files: ["data/**/annotations/**"],
      gates: [],
      stateKeys: ["annotations", "memory"],
    },
    "api-collector": {
      files: ["api/**", "openapi/**"],
      gates: [],
      stateKeys: ["api_specs", "memory"],
    },
    "api-contract-validator": {
      files: ["api/**", "contracts/**"],
      gates: ["tests"],
      stateKeys: ["validation_results", "memory"],
    },
    "api-pentester": {
      files: ["api/**"],
      gates: ["security"],
      stateKeys: ["pentest_findings", "memory"],
    },
    "appsec-engineer": {
      files: ["src/**/*"],
      gates: ["security"],
      stateKeys: ["security_findings", "memory"],
    },
    "attack-simulator": {
      files: ["src/**/*"],
      gates: ["security"],
      stateKeys: ["attack_results", "memory"],
    },
    "bias-auditor": {
      files: ["models/**", "data/**"],
      gates: [],
      stateKeys: ["bias_report", "memory"],
    },
    "blue-team-defender": {
      files: ["security/**", "monitoring/**"],
      gates: ["security"],
      stateKeys: ["defense_results", "memory"],
    },
    "bug-bounty-coordinator": {
      files: ["security/**", "bug-bounty/**"],
      gates: [],
      stateKeys: ["bounty_reports", "memory"],
    },
    "chaos-engineer": {
      files: ["chaos/**", "scripts/**"],
      gates: [],
      stateKeys: ["chaos_results", "memory"],
    },
    "cloud-pentester": {
      files: ["cloud/**", "terraform/**"],
      gates: ["security"],
      stateKeys: ["pentest_findings", "memory"],
    },
    "adr-archivist": {
      files: ["docs/adr/**"],
      gates: ["docs-updated"],
      stateKeys: ["adrs", "memory"],
    },
    "adversary-emulator": {
      files: ["security/**"],
      gates: ["security"],
      stateKeys: ["emulation_results", "memory"],
    },
  };
  
  // Build detailed agent entries with independence metadata
  const agentDetails = cursor.map((name) => {
    return {
      id: name,
      independence: INDEPENDENCE_MAP[name] || { files: [], gates: [], stateKeys: [] },
    };
  });
  
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
    // ADDITIONAL output (invariant 17, additive-only): OpenCode's real agent
    // IDs are path-namespaced (`dir/name`) and never match the bare globs in
    // the conductor allowlist — these are their glob forms, derived from the
    // file path so `counts.opencodeAgents` stays pinned at 160/160.
    opencodeNamespaced: {
      count: namespacedIds.length,
      globs: namespacedIds.map((id) => id + "*"),
    },
    agents: cursor,
    agentDetails,
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
 * When `namespacedGlobs` is provided (OpenCode conductor only), each
 * `dir/name*` glob is appended after the bare globs — strictly additive,
 * never replacing a bare glob: OpenCode's real agent IDs are path-namespaced
 * (`03-architecture/tech-lead`) and a bare `tech-lead*` never matches them.
 * The Cursor conductor passes nothing and regenerates byte-identical.
 *
 * Returns the rewritten file text, or null when there is no task block.
 */
function rewriteTaskBlock(text, agents, namespacedGlobs) {
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

  // ADDITIVE ONLY: path-namespaced globs alongside the bare globs. Bare
  // prefixes (`tech-lead*`) never match namespaced IDs
  // (`03-architecture/tech-lead`), which left every specialist unspawnable.
  // Skip any glob an existing rule already covers (idempotent regeneration).
  for (const glob of namespacedGlobs || []) {
    const id = glob.endsWith("*") ? glob.slice(0, -1) : glob;
    if (!ordered.some((r) => ruleCovers(r, id))) {
      ordered.push(`"${glob}": allow`);
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

  const namespacedGlobs =
    (registry.opencodeNamespaced && registry.opencodeNamespaced.globs) || [];

  for (const file of CONDUCTORS) {
    const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    // OpenCode conductor gets the path-namespaced globs in addition to the
    // bare ones; the Cursor conductor must regenerate byte-identical.
    const isOpencode = path.relative(ROOT, file).split(path.sep).join("/").startsWith("bundle/opencode/");
    const expected =
      current === null ? null : rewriteTaskBlock(current, registry.agents, isOpencode ? namespacedGlobs : null);
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
  scanNamespacedIds,
  plan,
  main,
  HOOKS_COPIES,
  REGISTRY_PATH,
  TASK_BEGIN,
  TASK_END,
};

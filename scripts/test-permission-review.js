#!/usr/bin/env node
"use strict";

/**
 * Step 7 self-check: conductor permission review.
 *
 * The conductor is deliberately read-only (readonly: true / edit: deny) and
 * its task allowlist is deny-by-default: `"*": deny` must stay the first rule,
 * nothing may widen it to `"*": allow`, and the block is generated from the
 * agent registry SSOT between BEGIN/END markers.
 *
 * Coverage is the property under review: every registered agent must be
 * spawnable, and no pre-existing allow pattern may ever be dropped.
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const CURSOR = path.join(ROOT, "bundle", "agents", "orchestra.md");
const OPENCODE = path.join(ROOT, "bundle", "opencode", "agents", "orchestra.md");

/** The43 allow patterns that shipped before generation. Additive-only. */
const BASELINE_ALLOW = [
  '"orchestra-*": allow',
  '"agent-selector*": allow',
  '"project-type-classifier*": allow',
  '"workflow-orchestrator*": allow',
  '"product-owner*": allow',
  '"product-manager*": allow',
  '"project-manager*": allow',
  '"scrum-master*": allow',
  '"stakeholder-advocate*": allow',
  '"business-strategist*": allow',
  '"business-analyst*": allow',
  '"architect*": allow',
  '"tech-lead*": allow',
  '"adr-archivist*": allow',
  '"ui-ux-designer*": allow',
  '"backend-engineer*": allow',
  '"frontend-engineer*": allow',
  '"mobile-engineer*": allow',
  '"full-stack-engineer*": allow',
  '"database-engineer*": allow',
  '"ml-engineer*": allow',
  '"data-engineer*": allow',
  '"devops-engineer*": allow',
  '"platform-engineer*": allow',
  '"qa-engineer*": allow',
  '"automation-engineer*": allow',
  '"regression-tester*": allow',
  '"api-contract-validator*": allow',
  '"accessibility-reviewer*": allow',
  '"performance-engineer*": allow',
  '"model-evaluator*": allow',
  '"code-reviewer*": allow',
  '"technical-debt-tracker*": allow',
  '"compliance-officer*": allow',
  '"legal-advisor*": allow',
  '"security-executive-advisor*": allow',
  '"release-manager*": allow',
  '"ops-manager*": allow',
  '"documentation-writer*": allow',
  '"sre*": allow',
  '"observer*": allow',
  '"incident-responder*": allow',
  '"security-performance-reviewer*": allow',
];

const BEGIN = "# BEGIN GENERATED: task allowlist (scripts/gen-agent-registry.js)";
const END = "# END GENERATED: task allowlist";

let failed = 0;

function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function read(p) {
  return fs.readFileSync(p, "utf8");
}

/** Parse the `permission.task` rule lines out of an agent frontmatter. */
function taskRules(text) {
  const m = /^  task:\r?\n([\s\S]*?)(?=^  \w)/m.exec(text);
  if (!m) return null;
  return m[1]
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^"[^"]+":\s*(allow|deny)$/.test(l));
}

function coveredBy(rules, agent) {
  return rules.some((rule) => {
    const m = /^"([^"]+)":\s*allow$/.exec(rule);
    if (!m) return false;
    const pat = m[1];
    return pat.endsWith("*") ? agent.startsWith(pat.slice(0, -1)) : pat === agent;
  });
}

const cursor = read(CURSOR);
const opencode = read(OPENCODE);
const cursorRules = taskRules(cursor);
const opencodeRules = taskRules(opencode);

check("cursor conductor has a task block", Array.isArray(cursorRules) && cursorRules.length > 0, String(cursorRules && cursorRules.length));
check("opencode conductor has a task block", Array.isArray(opencodeRules) && opencodeRules.length > 0, String(opencodeRules && opencodeRules.length));

// --- deny-by-default invariants ------------------------------------------
for (const [label, text, rules] of [
  ["cursor", cursor, cursorRules],
  ["opencode", opencode, opencodeRules],
]) {
  check(`${label}: "*": deny is the first task rule`, rules && rules[0] === '"*": deny', rules && rules[0]);
  check(`${label}: no bare "*": allow`, !rules || !rules.includes('"*": allow'));
  check(`${label}: conductor edit stays denied`, /^ {2}edit: deny$/m.test(text));
  check(
    `${label}: task rules other than the first are all allow`,
    !rules || rules.slice(1).every((r) => /:\s*allow$/.test(r)),
    rules && rules.filter((r) => /:\s*deny$/.test(r)).join(",")
  );
}
check("cursor conductor stays readonly", /^readonly: true$/m.test(cursor));
check("cursor conductor keeps bash/webfetch policy", /^ {2}bash: allow$/m.test(cursor) && /^ {2}webfetch: allow$/m.test(cursor));

// --- generated block markers ---------------------------------------------
check("cursor block carries BEGIN marker", cursor.includes(BEGIN));
check("cursor block carries END marker", cursor.includes(END));
check("opencode block carries BEGIN marker", opencode.includes(BEGIN));
check("opencode block carries END marker", opencode.includes(END));

// --- platform parity ------------------------------------------------------
check(
  "opencode task rules are a superset of cursor's",
  opencodeRules.length >= cursorRules.length,
  `opencode ${opencodeRules.length} >= cursor ${cursorRules.length} (opencode additionally carries namespaced globs per invariant 17, additive-only)`
);

// --- additive-only: nothing pre-existing may be dropped --------------------
const missingCursor = BASELINE_ALLOW.filter((p) => !cursorRules.includes(p));
const missingOpen = BASELINE_ALLOW.filter((p) => !opencodeRules.includes(p));
check("cursor keeps all 43 baseline allow patterns", missingCursor.length === 0, missingCursor.join(", "));
check("opencode keeps all 43 baseline allow patterns", missingOpen.length === 0, missingOpen.join(", "));

// --- coverage: every registered agent must be spawnable ---------------------
const reg = JSON.parse(read(path.join(ROOT, "bundle", "agent-registry.json")));
const uncovered = reg.agents.filter((a) => !coveredBy(cursorRules, a));
console.log(
  `INFO  coverage: ${reg.agents.length - uncovered.length}/${reg.agents.length} registry agents spawnable (${uncovered.length} uncovered)`
);
check("every registry agent is spawnable by the conductor", uncovered.length === 0, uncovered.slice(0, 12).join(", "));
check(
  "opencode coverage matches cursor",
  reg.agents.filter((a) => !coveredBy(opencodeRules, a)).length === uncovered.length,
  String(uncovered.length)
);

// --- the generator owns the block -----------------------------------------
const chk = spawnSync(process.execPath, [path.join(ROOT, "scripts", "gen-agent-registry.js"), "--check"], {
  encoding: "utf8",
  timeout: 30000,
});
check("--check exits 0 with the generated block in place", chk.status === 0, `${chk.status} ${chk.stdout}${chk.stderr}`);

console.log(failed === 0 ? "\nAll permission review tests passed." : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

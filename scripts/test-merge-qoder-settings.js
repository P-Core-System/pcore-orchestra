#!/usr/bin/env node
"use strict";

/**
 * Test for scripts/merge-qoder-settings.js + Qoder hook-input normalization.
 */

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const MERGE = path.join(ROOT, "scripts", "merge-qoder-settings.js");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) { console.log(`  ✓ ${message}`); passed++; }
  else { console.log(`  ✗ ${message}`); failed++; }
}

function run(args) {
  return execFileSync(process.execPath, [MERGE, ...args], { encoding: "utf8" });
}

// Test 1: merge into fresh home creates all four Qoder events
console.log("\nTest 1: fresh merge");
const home1 = fs.mkdtempSync(path.join(os.tmpdir(), "qoder-merge-"));
run(["--qoder-home", home1]);
const s1 = JSON.parse(fs.readFileSync(path.join(home1, "settings.json"), "utf8"));
for (const event of ["SessionStart", "UserPromptSubmit", "SubagentStop", "Stop"]) {
  assert(Array.isArray(s1.hooks[event]) && s1.hooks[event].length > 0, `hooks.${event} present`);
}

// Test 2: commands are absolute into the qoder home; matchers carried over
console.log("\nTest 2: command absolutization + matchers");
const sub = s1.hooks.SubagentStop;
assert(sub.length === 4, `SubagentStop has 4 entries (got ${sub.length})`);
const allCmds = Object.values(s1.hooks).flat().flatMap((g) => g.hooks.map((h) => h.command));
assert(allCmds.every((c) => c.includes(`${home1}/hooks/`) && !c.includes("./hooks/")), "all commands absolute, no relative ./hooks/");
assert(allCmds.every((c) => c.startsWith("node ")), "all commands are node invocations");
assert(sub.some((g) => typeof g.matcher === "string" && g.matcher.includes("orchestra-planner")), "matcher preserved on SubagentStop");
const promptEntry = s1.hooks.UserPromptSubmit[0].hooks[0];
assert(promptEntry.timeout === 5, "UserPromptSubmit timeout 5 carried over");

// Test 3: existing settings keys preserved
console.log("\nTest 3: preserves existing settings");
const home2 = fs.mkdtempSync(path.join(os.tmpdir(), "qoder-merge-"));
fs.writeFileSync(path.join(home2, "settings.json"), JSON.stringify({
  model: { name: "test-model" },
  security: { auth: { selectedType: "pat" } },
  mcpServers: { brain: { type: "stdio", command: "x" } },
  permissions: { allow: ["Bash(git status)"] },
}, null, 2));
run(["--qoder-home", home2]);
const s2 = JSON.parse(fs.readFileSync(path.join(home2, "settings.json"), "utf8"));
assert(s2.model.name === "test-model", "model preserved");
assert(s2.security.auth.selectedType === "pat", "security preserved");
assert(s2.mcpServers.brain.command === "x", "mcpServers preserved");
assert(s2.permissions.allow[0] === "Bash(git status)", "permissions preserved");
assert(fs.readdirSync(home2).some((f) => f.startsWith("settings.json.bak-")), "backup written for pre-existing settings");

// Test 4: idempotency — second run produces identical file
console.log("\nTest 4: idempotency");
const before = fs.readFileSync(path.join(home2, "settings.json"), "utf8");
const out = run(["--qoder-home", home2]);
const after = fs.readFileSync(path.join(home2, "settings.json"), "utf8");
assert(before === after, "settings unchanged on re-run");
assert(out.includes("unchanged"), "reports unchanged");

// Test 5: dry-run writes nothing
console.log("\nTest 5: dry run");
const home3 = fs.mkdtempSync(path.join(os.tmpdir(), "qoder-merge-"));
run(["--qoder-home", home3, "--dry-run"]);
assert(!fs.existsSync(path.join(home3, "settings.json")), "dry-run creates no settings.json");

// Test 6: corrupt existing settings does not crash merge
console.log("\nTest 6: corrupt settings recovery");
const home4 = fs.mkdtempSync(path.join(os.tmpdir(), "qoder-merge-"));
fs.writeFileSync(path.join(home4, "settings.json"), "{not json");
run(["--qoder-home", home4]);
const s4 = JSON.parse(fs.readFileSync(path.join(home4, "settings.json"), "utf8"));
assert(Array.isArray(s4.hooks.Stop), "merge recovers from corrupt settings");

// Test 7: Qoder hook-input normalization (agent_type -> subagent_type)
console.log("\nTest 7: io.js normalizeHookInput");
const { normalizeHookInput } = require(path.join(ROOT, "bundle", "hooks", "lib", "io.js"));
const qoderIn = normalizeHookInput({ agent_type: "orchestra-planner", agent_id: "a1" });
assert(qoderIn.subagent_type === "orchestra-planner", "agent_type normalized to subagent_type");
const cursorIn = normalizeHookInput({ subagent_type: "orchestra-verifier" });
assert(cursorIn.subagent_type === "orchestra-verifier", "cursor subagent_type untouched");
const bothIn = normalizeHookInput({ subagent_type: "keep", agent_type: "ignore" });
assert(bothIn.subagent_type === "keep", "existing subagent_type wins over agent_type");

// Test 8: mirrors byte-identical for touched lib file
console.log("\nTest 8: mirror sync");
const a = fs.readFileSync(path.join(ROOT, "bundle", "hooks", "lib", "io.js"));
const b = fs.readFileSync(path.join(ROOT, "bundle", "opencode", "hooks", "lib", "io.js"));
assert(a.equals(b), "io.js mirrors byte-identical");

for (const h of [home1, home2, home3, home4]) fs.rmSync(h, { recursive: true, force: true });

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);

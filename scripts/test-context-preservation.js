#!/usr/bin/env node
"use strict";

/**
 * Context-preservation gate (workstream E — token/context, 2026-10-29).
 *
 * Long sessions hit truncation/compaction pressure (docs/token-optimization.md
 * §11.3). The loop keeps working only if load-bearing context is:
 *   (a) placed AHEAD of the truncation cut in the 2500-char phase handoff —
 *       goal/work item first, escalation next, verbose outcome detail last;
 *   (b) externalized to files the next phase re-reads even after the prompt
 *       that mentioned them is gone: plan artifact (.cursor/orchestra-plan.md)
 *       + global state/plans backup, and long-term memory (state/orchestra-memory.json).
 *
 * handoff-enforcer.js is READ ONLY here — this test pins its contract without
 * modifying it. Deliberately asserts nothing about forbidden_actions/human_gate
 * (another track owns those fields).
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

function test(name, fn) {
  try {
    fn();
    console.log(`  ok - ${name}`);
  } catch (err) {
    console.error(`  NOT OK - ${name}`);
    console.error(err && err.message ? err.message : err);
    process.exitCode = 1;
  }
}

console.log("=== test-context-preservation.js ===");

const handoff = require(path.join(ROOT, "bundle", "hooks", "lib", "handoff-enforcer.js"));
const planArtifact = require(path.join(ROOT, "bundle", "hooks", "lib", "plan-artifact.js"));
const memoryManager = require(path.join(ROOT, "bundle", "hooks", "lib", "memory-manager.js"));

test("handoff cap and escalation constants are exported", () => {
  assert.equal(handoff.MAX_HANDOFF_CHARS, 2500);
  assert.equal(typeof handoff.ESCALATION_AFTER_FIX_CYCLES, "number");
  assert.ok(handoff.ESCALATION_AFTER_FIX_CYCLES >= 1);
});

test("goal + escalation survive truncation (cut lands on the tail)", () => {
  const state = {
    goal: "Preserve the goal across compaction",
    memory: { fix_cycles: handoff.ESCALATION_AFTER_FIX_CYCLES },
    last_outcome: {
      phase: "verify",
      decision: "block",
      reason: "verbose failure detail ".repeat(400),
      token: "VERIFY_FAIL",
    },
  };
  const out = handoff.buildHandoffEnforcement(
    state,
    [{ gate: "tests", ok: false, details: "1 failing" }],
    { acCount: 2 }
  );

  assert.ok(out.length <= handoff.MAX_HANDOFF_CHARS, `length ${out.length} <= cap`);
  // Head-critical lines (pushed before the truncation-prone tail)...
  assert.ok(out.includes("[+"), "truncation marker present");
  assert.ok(out.includes("Work item: Preserve the goal across compaction"), "goal survives as work item");
  assert.ok(out.includes(`Escalation (fix cycle ${handoff.ESCALATION_AFTER_FIX_CYCLES})`), "escalation survives");
  assert.ok(out.includes("tests:FAIL"), "evidence digest survives");
  // ...and the cut lands after them, not before.
  const cut = out.lastIndexOf("[+");
  assert.ok(out.indexOf("Work item:") < cut, "work item precedes the cut");
  assert.ok(out.indexOf("Escalation") < cut, "escalation precedes the cut");
});

test("ticket id wins the work-item line and still survives truncation", () => {
  const state = {
    goal: "Goal that must not dominate the work-item line",
    memory: { ticketId: "CTX-77", fix_cycles: handoff.ESCALATION_AFTER_FIX_CYCLES },
    last_outcome: { phase: "review", decision: "block", reason: "x".repeat(5000) },
  };
  const out = handoff.buildHandoffEnforcement(state, [], { ticketId: "CTX-77" });
  assert.ok(out.length <= handoff.MAX_HANDOFF_CHARS);
  assert.ok(out.includes("Work item: CTX-77"), "ticket survives truncation");
  assert.ok(out.includes("Escalation"), "escalation survives with a ticket work item");
  assert.ok(out.includes("[+"), "marker present");
});

test("validateHandoffCompact flags over-limit handoffs before they ship", () => {
  const under = handoff.validateHandoffCompact(handoff.buildPhaseHandoff(
    { goal: "small", memory: { fix_cycles: 0, phases_completed: [], errors: [] } },
    "orchestra-implementer"
  ));
  assert.equal(under.ok, true);

  const over = handoff.validateHandoffCompact("x".repeat(handoff.MAX_HANDOFF_CHARS + 1));
  assert.equal(over.ok, false);
  assert.match(over.warning, /chars \(max 2500\)/);
});

test("phase handoff carries goal + plan path pointer together", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pcore-ctx-plan-"));
  try {
    const planPath = path.join(tmp, ".cursor", "orchestra-plan.md");
    fs.mkdirSync(path.dirname(planPath), { recursive: true });
    fs.writeFileSync(planPath, "# Orchestra Plan\n\nGoal: keep context\n\nPLAN_READY\n");

    const state = {
      goal: "Preserve the plan pointer across phases",
      project: { identityFile: path.join(tmp, "project.yaml") },
      planArtifact: { path: planPath, run_id: "run-ctx", plan_ready: true },
      memory: { fix_cycles: handoff.ESCALATION_AFTER_FIX_CYCLES, phases_completed: [], errors: [] },
    };

    const out = handoff.buildPhaseHandoff(state, "orchestra-implementer");
    assert.ok(out.startsWith("Parent handoff (compact):"), "handoff rules lead");
    assert.ok(out.includes("Goal: Preserve the plan pointer across phases"), "goal present");
    assert.ok(out.includes("Escalation"), "escalation present");
    assert.ok(out.includes(".cursor/orchestra-plan.md"), "plan path pointer present");
    assert.equal(handoff.validateHandoffCompact(out).ok, true, "normal handoff stays under the cap");

    const verifyLine = planArtifact.buildPlanHandoffLine(state, "orchestra-verifier");
    assert.ok(verifyLine.includes(".cursor/orchestra-plan.md"), "verifier gets the plan path too");

    // The plan itself survives as a FILE — re-readable after prompt context is gone.
    assert.equal(planArtifact.loadPlanArtifact(state).includes("PLAN_READY"), true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("plan artifact constants pin the externalization path", () => {
  assert.equal(planArtifact.PLAN_DIR, ".cursor");
  assert.equal(planArtifact.PLAN_FILENAME, "orchestra-plan.md");
  const p = planArtifact.workspacePlanPath(path.join("some", "root"));
  assert.equal(p, path.join("some", "root", ".cursor", "orchestra-plan.md"));
});

test("memory externalization constants and loaders hold", () => {
  assert.equal(path.basename(memoryManager.MEMORY_PATH), "orchestra-memory.json");
  assert.ok(memoryManager.MEMORY_PATH.includes(`state${path.sep}`), "memory lives under state/");
  const ltm = memoryManager.loadLongTermMemory();
  assert.ok(ltm && typeof ltm === "object", "long-term memory loads without throwing");
  const memCtx = memoryManager.buildMemoryContext(ltm, { query: "context preservation" });
  assert.equal(typeof memCtx, "string", "memory context is a string (injectable or empty)");
});

if (!process.exitCode) {
  console.log("\nAll context-preservation tests passed.");
}

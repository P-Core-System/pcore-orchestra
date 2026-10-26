"use strict";

/**
 * Test for handoff-enforcer.js buildHandoffEnforcement function.
 * RED first: tests fail because module doesn't export the builder or returns empty.
 */

const path = require("node:path");

function loadModule() {
  // Force fresh module load to pick up new exports
  const modPath = path.join(__dirname, "..", "bundle", "hooks", "lib", "handoff-enforcer.js");
  delete require.cache[require.resolve(modPath)];
  return require(modPath);
}

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ✓ ${message}`);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`ASSERTION FAILED: ${message}\n  Expected: ${JSON.stringify(expected)}\n  Actual:   ${JSON.stringify(actual)}`);
  console.log(`  ✓ ${message}`);
}

function assertContains(haystack, needle, message) {
  if (!haystack.includes(needle)) throw new Error(`ASSERTION FAILED: ${message}\n  Expected to contain: ${JSON.stringify(needle)}\n  In: ${JSON.stringify(haystack)}`);
  console.log(`  ✓ ${message}`);
}

function assertLengthLessOrEqual(text, max, message) {
  if (text.length > max) throw new Error(`ASSERTION FAILED: ${message}\n  Length ${text.length} exceeds max ${max}`);
  console.log(`  ✓ ${message} (${text.length} chars)`);
}

async function runTests() {
  console.log("=== test-handoff-enforcer.js ===");
  let passed = 0;
  let failed = 0;

  const mod = loadModule();

  // Test 1: buildHandoffEnforcement function exists
  try {
    assert(typeof mod.buildHandoffEnforcement === "function", "buildHandoffEnforcement is exported as a function");
    passed++;
  } catch (e) {
    console.log(`  ✗ buildHandoffEnforcement is exported as a function: ${e.message}`);
    failed++;
  }

  // Test 2: Returns string ≤ 2500 chars
  try {
    const state = {
      goal: "Test goal",
      memory: {
        ticketId: "TEST-123",
        phases_completed: [
          { phase: "plan", summary: "Planned the work" },
          { phase: "implement", summary: "Implemented the feature" },
        ],
        errors: [],
        decisions: [],
      },
      last_outcome: {
        phase: "implement",
        decision: "advance",
        reason: "token-matched",
        token: "IMPLEMENT_DONE",
        at: new Date().toISOString(),
      },
    };
    const evidenceRecords = [
      { gate: "tests", ok: true, details: "tests PASS" },
      { gate: "lint", ok: false, details: "lint FAIL" },
      { gate: "security", ok: true, details: "security PASS" },
    ];
    const workItemContext = { ticketId: "TEST-123", acCount: 3 };

    const result = mod.buildHandoffEnforcement(state, evidenceRecords, workItemContext);
    assert(typeof result === "string", "Returns a string");
    assertLengthLessOrEqual(result, 2500, "Result is ≤ 2500 chars");
    passed++;
  } catch (e) {
    console.log(`  ✗ Returns string ≤ 2500 chars: ${e.message}`);
    failed++;
  }

  // Test 3: Includes evidence digest (gate names + pass/fail summary)
  try {
    const state = {
      goal: "Test goal",
      memory: { ticketId: "TEST-123" },
      last_outcome: { phase: "implement", decision: "advance", token: "IMPLEMENT_DONE" },
    };
    const evidenceRecords = [
      { gate: "tests", ok: true, details: "tests PASS" },
      { gate: "docs-updated", ok: false, details: "docs-updated FAIL" },
      { gate: "security", ok: true, details: "security PASS" },
    ];
    const workItemContext = { ticketId: "TEST-123", acCount: 3 };

    const result = mod.buildHandoffEnforcement(state, evidenceRecords, workItemContext);
    assertContains(result, "tests:PASS", "Includes evidence digest with tests:PASS");
    assertContains(result, "docs-updated:FAIL", "Includes evidence digest with docs-updated:FAIL");
    assertContains(result, "security:PASS", "Includes evidence digest with security:PASS");
    passed += 3;
  } catch (e) {
    console.log(`  ✗ Evidence digest: ${e.message}`);
    failed += 3;
  }

  // Test 4: Includes work-item context (ticket ID from state.memory.ticketId)
  try {
    const state = {
      goal: "Test goal",
      memory: { ticketId: "TICKET-456" },
      last_outcome: { phase: "implement", decision: "advance", token: "IMPLEMENT_DONE" },
    };
    const evidenceRecords = [];
    const workItemContext = { ticketId: "TICKET-456", acCount: 5 };

    const result = mod.buildHandoffEnforcement(state, evidenceRecords, workItemContext);
    assertContains(result, "TICKET-456", "Includes ticket ID from state.memory.ticketId");
    passed++;
  } catch (e) {
    console.log(`  ✗ Work-item context ticket ID: ${e.message}`);
    failed++;
  }

  // Test 5: Includes work-item context (fallback to state.goal when no ticketId)
  try {
    const state = {
      goal: "Build a new feature for user authentication",
      memory: {}, // no ticketId
      last_outcome: { phase: "implement", decision: "advance", token: "IMPLEMENT_DONE" },
    };
    const evidenceRecords = [];
    const workItemContext = { acCount: 2 };

    const result = mod.buildHandoffEnforcement(state, evidenceRecords, workItemContext);
    assertContains(result, "authentication", "Includes goal text as fallback when no ticketId");
    passed++;
  } catch (e) {
    console.log(`  ✗ Work-item context fallback to goal: ${e.message}`);
    failed++;
  }

  // Test 6: Includes AC count if available
  try {
    const state = {
      goal: "Test goal",
      memory: { ticketId: "TICKET-789" },
      last_outcome: { phase: "implement", decision: "advance", token: "IMPLEMENT_DONE" },
    };
    const evidenceRecords = [];
    const workItemContext = { ticketId: "TICKET-789", acCount: 4 };

    const result = mod.buildHandoffEnforcement(state, evidenceRecords, workItemContext);
    assertContains(result, "AC: 4", "Includes AC count from workItemContext");
    passed++;
  } catch (e) {
    console.log(`  ✗ AC count: ${e.message}`);
    failed++;
  }

  // Test 7: Includes phase outcome summary from state.last_outcome
  try {
    const state = {
      goal: "Test goal",
      memory: { ticketId: "TICKET-999" },
      last_outcome: {
        phase: "verify",
        decision: "block",
        reason: "failed-gates",
        token: null,
        at: new Date().toISOString(),
      },
    };
    const evidenceRecords = [];
    const workItemContext = { ticketId: "TICKET-999", acCount: 1 };

    const result = mod.buildHandoffEnforcement(state, evidenceRecords, workItemContext);
    assertContains(result, "verify", "Includes phase from last_outcome");
    assertContains(result, "block", "Includes decision from last_outcome");
    assertContains(result, "failed-gates", "Includes reason from last_outcome");
    passed += 3;
  } catch (e) {
    console.log(`  ✗ Phase outcome summary: ${e.message}`);
    failed += 3;
  }

  // Test 8: Truncates with marker when exceeding 2500 chars
  try {
    const state = {
      goal: "Test goal",
      memory: { ticketId: "LONG-TEST" },
      last_outcome: { phase: "implement", decision: "advance", token: "IMPLEMENT_DONE" },
    };
    // Create very long evidence records to force truncation
    const evidenceRecords = Array.from({ length: 300 }, (_, i) => ({
      gate: `very-long-gate-name-${i}`,
      ok: true,
      details: "x".repeat(200),
    }));
    const workItemContext = { ticketId: "LONG-TEST", acCount: 10 };

    const result = mod.buildHandoffEnforcement(state, evidenceRecords, workItemContext);
    assertLengthLessOrEqual(result, 2500, "Truncated to ≤ 2500 chars");
    assertContains(result, "[+", "Includes truncation marker [+N chars]");
    passed += 2;
  } catch (e) {
    console.log(`  ✗ Truncation with marker: ${e.message}`);
    failed += 2;
  }

  // Test 9: Handles empty evidenceRecords gracefully
  try {
    const state = {
      goal: "Test goal",
      memory: { ticketId: "EMPTY-TEST" },
      last_outcome: { phase: "implement", decision: "advance", token: "IMPLEMENT_DONE" },
    };
    const evidenceRecords = [];
    const workItemContext = { ticketId: "EMPTY-TEST", acCount: 0 };

    const result = mod.buildHandoffEnforcement(state, evidenceRecords, workItemContext);
    assert(typeof result === "string", "Handles empty evidenceRecords");
    assert(result.length > 0, "Returns non-empty string even with no evidence");
    passed += 2;
  } catch (e) {
    console.log(`  ✗ Empty evidenceRecords: ${e.message}`);
    failed += 2;
  }

  // Test 10: Handles missing state.memory gracefully
  try {
    const state = {
      goal: "Test goal",
      last_outcome: { phase: "implement", decision: "advance", token: "IMPLEMENT_DONE" },
    };
    const evidenceRecords = [{ gate: "tests", ok: true, details: "PASS" }];
    const workItemContext = { acCount: 1 };

    const result = mod.buildHandoffEnforcement(state, evidenceRecords, workItemContext);
    assert(typeof result === "string", "Handles missing state.memory");
    passed++;
  } catch (e) {
    console.log(`  ✗ Missing state.memory: ${e.message}`);
    failed++;
  }

  // Test 11: escalation directive appears only after the fix-cycle threshold
  try {
    const base = {
      goal: "Test goal",
      memory: { ticketId: "TEST-123", fix_cycles: 1 },
      last_outcome: { phase: "implement", decision: "advance" },
    };
    const below = mod.buildHandoffEnforcement(base, [], {});
    assert(!/Escalation/.test(below), "no escalation below the fix-cycle threshold");

    const escalated = mod.buildHandoffEnforcement(
      Object.assign({}, base, { memory: { ticketId: "TEST-123", fix_cycles: mod.ESCALATION_AFTER_FIX_CYCLES } }),
      [],
      {}
    );
    assertContains(escalated, `Escalation (fix cycle ${mod.ESCALATION_AFTER_FIX_CYCLES})`, "escalation names the fix cycle");
    assertContains(escalated, "grok-4.6", "escalation names the stronger model");
    passed += 3;
  } catch (e) {
    console.log(`  ✗ Escalation directive: ${e.message}`);
    failed += 3;
  }

  // Test 12: buildPhaseHandoff carries the same escalation directive
  try {
    const state = {
      goal: "Test goal",
      memory: { fix_cycles: 2, phases_completed: [], errors: [] },
    };
    const result = mod.buildPhaseHandoff(state, "orchestra-implementer");
    assertContains(result, "Escalation (fix cycle 2)", "buildPhaseHandoff includes escalation");
    assertContains(result, "orchestra-implementer", "buildPhaseHandoff keeps the spawn directive");
    passed += 2;
  } catch (e) {
    console.log(`  ✗ buildPhaseHandoff escalation: ${e.message}`);
    failed += 2;
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
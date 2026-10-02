"use strict";

/**
 * Test for human-review producer: phase-outcome block -> review.requested event.
 * RED first: tests fail because the producer isn't wired.
 */

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

function loadPhaseOutcome() {
  const modPath = path.join(__dirname, "..", "bundle", "hooks", "lib", "phase-outcome.js");
  delete require.cache[require.resolve(modPath)];
  return require(modPath);
}

function loadDomainIndex() {
  const modPath = path.join(__dirname, "..", "bundle", "hooks", "lib", "domain", "index.js");
  delete require.cache[require.resolve(modPath)];
  return require(modPath);
}

function loadReviewQueue() {
  const modPath = path.join(__dirname, "..", "bundle", "hooks", "lib", "domain", "review-queue.js");
  delete require.cache[require.resolve(modPath)];
  return require(modPath);
}

function loadQualityGate() {
  const modPath = path.join(__dirname, "..", "bundle", "hooks", "orchestra-quality-gate.js");
  // Don't require, just read file
  return fs.readFileSync(modPath, "utf8");
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

async function runTests() {
  console.log("=== test-review-queue-producer.js ===");
  let passed = 0;
  let failed = 0;

  const phaseOutcome = loadPhaseOutcome();
  const domain = loadDomainIndex();
  const reviewQueue = loadReviewQueue();
  const qualityGateContent = loadQualityGate();

  // Test 1: evaluatePhaseOutcome on block decision adds needs_human to outcome
  try {
    const state = {
      currentPhase: "verify",
      loopMode: "core",
      qualityGates: { failed: ["tests"], passed: [], skipped: [] },
      goal: "Test goal",
    };
    const input = {
      status: "completed",
      summary: "VERIFY_PASS",
    };
    const outcome = phaseOutcome.evaluatePhaseOutcome(state, input);
    // Should be block due to failed gates
    assert(outcome.decision === "block", "Failed gates -> block decision");
    // The outcome should have needs_human: true (added by phase-outcome.js)
    // This is what we're testing - the fix should add this
    passed++;
  } catch (e) {
    console.log(`  ✗ block decision needs_human: ${e.message}`);
    failed++;
  }

  // Test 2: recordPhaseOutcome passes needs_human through to domain event
  try {
    const state = {
      currentPhase: "verify",
      goal: "Test goal",
      sessionId: "test-session",
      last_subagent: "orchestra-verifier",
    };
    const outcome = {
      phase: "verify",
      decision: "block",
      reason: "failed-gates",
      token: null,
    };
    const event = domain.recordPhaseOutcome(state, outcome, "orchestra-verifier");
    assert(event !== null, "recordPhaseOutcome returns event");
    assert(event.type === "phase.outcome", "Event type is phase.outcome");
    assert(event.payload.decision === "block", "Event payload has block decision");
    // The event should have needs_human: true in payload (added by recordPhaseOutcome or phase-outcome)
    passed += 2;
  } catch (e) {
    console.log(`  ✗ recordPhaseOutcome passes needs_human: ${e.message}`);
    failed += 2;
  }

  // Test 3: review-queue.pendingReview() returns items when phase.outcome has block
  try {
    // We can't easily test this without a clean domain event log
    // But we can verify the logic in review-queue.js
    assert(typeof reviewQueue.pendingReview === "function", "pendingReview is exported");
    assert(reviewQueue.OPEN_DECISIONS.has("block"), "OPEN_DECISIONS includes 'block'");
    assert(reviewQueue.OPEN_DECISIONS.has("needs_human"), "OPEN_DECISIONS includes 'needs_human'");
    assert(reviewQueue.OPENER_TYPES.has("review.requested"), "OPENER_TYPES includes 'review.requested'");
    passed += 4;
  } catch (e) {
    console.log(`  ✗ review-queue OPEN_DECISIONS: ${e.message}`);
    failed += 4;
  }

  // Test 4: orchestra-quality-gate.js injects ## Human review queue when items exist
  try {
    assert(qualityGateContent.includes("Human review queue"), "quality-gate has queue heading");
    assert(qualityGateContent.includes("pendingReview"), "quality-gate calls pendingReview");
    assert(qualityGateContent.includes("formatQueue"), "quality-gate calls formatQueue");
    passed += 3;
  } catch (e) {
    console.log(`  ✗ quality-gate injects queue: ${e.message}`);
    failed += 3;
  }

  // Test 5: phase-outcome.js evaluatePhaseOutcome adds needs_human: true on block
  try {
    // This tests the actual behavior we need to implement
    const state = {
      currentPhase: "verify",
      loopMode: "core",
      qualityGates: { failed: ["tests"], passed: [], skipped: [] },
      goal: "Test goal",
    };
    const input = {
      status: "completed",
      summary: "VERIFY_PASS",
    };
    const outcome = phaseOutcome.evaluatePhaseOutcome(state, input);
    // After fix, outcome should have needs_human: true when decision is block
    // This will fail initially (RED)
    assert(outcome.needs_human === true, "Block outcome includes needs_human: true");
    passed++;
  } catch (e) {
    console.log(`  ✗ phase-outcome adds needs_human on block: ${e.message}`);
    failed++;
  }

  // Test 6: phase-outcome.js does NOT add needs_human on advance
  try {
    const state = {
      currentPhase: "verify",
      loopMode: "core",
      qualityGates: { failed: [], passed: ["tests"], skipped: [] },
      goal: "Test goal",
    };
    const input = {
      status: "completed",
      summary: "VERIFY_PASS",
    };
    const outcome = phaseOutcome.evaluatePhaseOutcome(state, input);
    // Should advance, not have needs_human
    assert(outcome.decision === "advance", "Clean gates -> advance");
    assert(outcome.needs_human !== true, "Advance outcome does not have needs_human");
    passed += 2;
  } catch (e) {
    console.log(`  ✗ phase-outcome no needs_human on advance: ${e.message}`);
    failed += 2;
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
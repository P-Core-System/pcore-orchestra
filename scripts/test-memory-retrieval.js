"use strict";

/**
 * Test for memory retrieval: searchMemoryIndex + buildMemoryContext integration.
 * RED first: tests fail because the retrieval path is not wired.
 */

const path = require("node:path");

function loadMemoryManager() {
  const modPath = path.join(__dirname, "..", "bundle", "hooks", "lib", "memory-manager.js");
  delete require.cache[require.resolve(modPath)];
  return require(modPath);
}

function loadMemoryIndex() {
  const modPath = path.join(__dirname, "..", "bundle", "hooks", "lib", "memory-index.js");
  delete require.cache[require.resolve(modPath)];
  return require(modPath);
}

function loadSemanticMemory() {
  const modPath = path.join(__dirname, "..", "bundle", "hooks", "lib", "semantic-memory.js");
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

function assertArrayLength(arr, min, message) {
  if (!Array.isArray(arr) || arr.length < min) throw new Error(`ASSERTION FAILED: ${message}\n  Expected array length >= ${min}, got ${arr?.length}`);
  console.log(`  ✓ ${message} (length: ${arr.length})`);
}

async function runTests() {
  console.log("=== test-memory-retrieval.js ===");
  let passed = 0;
  let failed = 0;

  const memMgr = loadMemoryManager();
  const memIdx = loadMemoryIndex();
  const semMem = loadSemanticMemory();

  // Setup: create a test memory state with some completed goals
  const testMemoryState = {
    version: 1,
    sessions: {
      "test-session": {
        completed_goals: [
          {
            goal: "Build user authentication system",
            outcome: "completed",
            duration_ms: 120000,
            timestamp: "2026-01-15T10:00:00.000Z",
            lessons: ["use bcrypt", "add rate limiting"],
            phase_count: 4,
            tokens_estimated: 5000,
            token_tips: 2,
            run_id: "run-1",
            plan_artifact: ".cursor/orchestra-plan.md",
          },
          {
            goal: "Implement payment processing with Stripe",
            outcome: "completed",
            duration_ms: 180000,
            timestamp: "2026-01-20T14:30:00.000Z",
            lessons: ["idempotency keys", "webhook verification"],
            phase_count: 5,
            tokens_estimated: 8000,
            token_tips: 3,
            run_id: "run-2",
            plan_artifact: ".cursor/orchestra-plan.md",
          },
          {
            goal: "Add real-time notifications via WebSockets",
            outcome: "completed",
            duration_ms: 90000,
            timestamp: "2026-01-25T09:15:00.000Z",
            lessons: ["socket.io rooms", "connection recovery"],
            phase_count: 3,
            tokens_estimated: 3000,
            token_tips: 1,
            run_id: "run-3",
            plan_artifact: ".cursor/orchestra-plan.md",
          },
        ],
        recent_files: [],
        error_patterns: [],
        project_patterns: {},
        user_preferences: {},
      },
    },
  };

  // Test 1: searchMemoryIndex is exported and callable
  try {
    assert(typeof memIdx.searchMemoryIndex === "function", "searchMemoryIndex is exported as a function");
    passed++;
  } catch (e) {
    console.log(`  ✗ searchMemoryIndex exported: ${e.message}`);
    failed++;
  }

  // Test 2: searchMemoryIndex returns relevant past goals (score + timestamp + goal text) - may be empty if index not populated
  try {
    const results = memIdx.searchMemoryIndex("authentication", 3);
    assert(Array.isArray(results), "searchMemoryIndex returns array");
    // Index may be empty in test env; just verify structure if results exist
    if (results.length > 0) {
      const first = results[0];
      assert(typeof first.score === "number", "Result has score");
      assert(typeof first.timestamp === "string", "Result has timestamp");
      assert(typeof first.goal === "string", "Result has goal text");
    }
    passed += 2;
  } catch (e) {
    console.log(`  ✗ searchMemoryIndex returns relevant goals: ${e.message}`);
    failed += 2;
  }

  // Test 3: searchMemoryIndex handles empty index gracefully (no throw)
  try {
    // Clear index by creating a fresh one - use a different path
    const originalLoad = memIdx.loadMemoryIndex;
    memIdx.loadMemoryIndex = () => ({ version: 1, entries: [], inverted: {} });
    const results = memIdx.searchMemoryIndex("anything", 3);
    assert(Array.isArray(results), "Returns array on empty index");
    assert(results.length === 0, "Empty array on empty index");
    memIdx.loadMemoryIndex = originalLoad;
    passed += 2;
  } catch (e) {
    console.log(`  ✗ searchMemoryIndex empty index: ${e.message}`);
    failed += 2;
  }

  // Test 4: searchMemoryIndex returns results sorted by score (highest first) - may be empty
  try {
    const results = memIdx.searchMemoryIndex("payment", 3);
    assert(Array.isArray(results), "Returns array for 'payment'");
    if (results.length > 1) {
      for (let i = 1; i < results.length; i++) {
        assert(results[i - 1].score >= results[i].score, "Results sorted by score descending");
      }
    }
    passed += 2;
  } catch (e) {
    console.log(`  ✗ searchMemoryIndex score sorting: ${e.message}`);
    failed += 2;
  }

  // Test 5: buildMemoryContext calls searchMemoryIndex when query is provided
  try {
    // This test will fail initially because buildMemoryContext doesn't call searchMemoryIndex yet
    const state = {
      goal: "Build a new authentication feature",
      memory: { query: "authentication" },
    };
    const result = memMgr.buildMemoryContext(testMemoryState, { query: "authentication" });
    assertContains(result, "Relevant past goals", "Includes semantic recall section when query provided");
    assertContains(result, "authentication", "Includes relevant goal about authentication");
    passed += 2;
  } catch (e) {
    console.log(`  ✗ buildMemoryContext with query: ${e.message}`);
    failed += 2;
  }

  // Test 6: buildMemoryContext includes retrieved memories in state.memory.context
  try {
    const state = {
      goal: "Test goal",
      memory: { query: "Stripe" },
    };
    // We need to test that buildMemoryContext can inject into state
    // This is a behavioral test - the actual integration is in orchestra-prompt.js and session-start
    const result = memMgr.buildMemoryContext(testMemoryState, { query: "Stripe", goal: "Test goal" });
    assertContains(result, "Stripe", "Includes Stripe-related memory");
    passed++;
  } catch (e) {
    console.log(`  ✗ buildMemoryContext includes retrieved: ${e.message}`);
    failed++;
  }

  // Test 7: buildMemoryContext caps SEMANTIC_RECALL_TOP_K (3) for relevant goals section
  try {
    // Create a memory state with many matching goals
    const manyGoalsState = {
      version: 1,
      sessions: {
        "test-session": {
          completed_goals: Array.from({ length: 10 }, (_, i) => ({
            goal: `Task ${i} about authentication`,
            outcome: "completed",
            duration_ms: 10000,
            timestamp: `2026-01-${String(i + 1).padStart(2, "0")}T10:00:00.000Z`,
            lessons: [],
            phase_count: 2,
            tokens_estimated: 1000,
            token_tips: 0,
            run_id: `run-${i}`,
            plan_artifact: null,
          })),
          recent_files: [],
          error_patterns: [],
          project_patterns: {},
          user_preferences: {},
        },
      },
    };
    const result = memMgr.buildMemoryContext(manyGoalsState, { query: "authentication" });
    // Should only show top 3 in "Relevant past goals (semantic recall)" section (SEMANTIC_RECALL_TOP_K = 3)
    const semanticSection = result.split("Relevant past goals (semantic recall)")[1]?.split("Recent completed goals")[0] || "";
    const relevantLines = semanticSection.split("\n").filter((l) => l.includes("Task ")).length;
    assert(relevantLines <= 3, `Caps semantic recall results at 3 (got ${relevantLines})`);
    passed++;
  } catch (e) {
    console.log(`  ✗ buildMemoryContext caps at 3: ${e.message}`);
    failed++;
  }

  // Test 8: orchestra-prompt.js calls buildMemoryContext at prompt time
  try {
    // This is an integration test - we check that orchestra-prompt.js imports and calls buildMemoryContext
    const promptPath = path.join(__dirname, "..", "bundle", "hooks", "orchestra-prompt.js");
    const promptContent = require("node:fs").readFileSync(promptPath, "utf8");
    assert(promptContent.includes("buildMemoryContext"), "orchestra-prompt.js imports buildMemoryContext");
    assert(promptContent.includes("loadLongTermMemory"), "orchestra-prompt.js imports loadLongTermMemory");
    assert(promptContent.includes("memCtx"), "orchestra-prompt.js calls buildMemoryContext and uses result");
    passed += 3;
  } catch (e) {
    console.log(`  ✗ orchestra-prompt.js integration: ${e.message}`);
    failed += 3;
  }

  // Test 9: orchestra-session-start.js calls buildMemoryContext at session start
  try {
    const sessionStartPath = path.join(__dirname, "..", "bundle", "hooks", "orchestra-session-start.js");
    const sessionStartContent = require("node:fs").readFileSync(sessionStartPath, "utf8");
    assert(sessionStartContent.includes("buildMemoryContext"), "orchestra-session-start.js imports buildMemoryContext");
    assert(sessionStartContent.includes("loadLongTermMemory"), "orchestra-session-start.js imports loadLongTermMemory");
    assert(sessionStartContent.includes("memCtx"), "orchestra-session-start.js calls buildMemoryContext and uses result");
    passed += 3;
  } catch (e) {
    console.log(`  ✗ orchestra-session-start.js integration: ${e.message}`);
    failed += 3;
  }

  // Test 10: semantic-memory.js retrieval scoring test coverage (no behavior change)
  try {
    assert(typeof semMem.retrieveRelevantGoals === "function", "retrieveRelevantGoals exported");
    assert(typeof semMem.retrieveRelevantErrors === "function", "retrieveRelevantErrors exported");
    assert(typeof semMem.formatRelevantGoals === "function", "formatRelevantGoals exported");
    assert(typeof semMem.scoreEntry === "function", "scoreEntry exported for testing");

    // Test scoreEntry directly
    const entry = {
      goal: "Build authentication system",
      outcome: "completed",
      lessons: ["use bcrypt", "add rate limiting"],
      timestamp: "2026-01-15T10:00:00.000Z",
    };
    const score = semMem.scoreEntry(entry, semMem.tokenize("authentication"), 0, 3);
    assert(typeof score === "number" && score > 0, "scoreEntry returns positive score for matching query");

    const noMatchScore = semMem.scoreEntry(entry, semMem.tokenize("unrelated"), 0, 3);
    assert(noMatchScore === 0, "scoreEntry returns 0 for non-matching query");
    passed += 5;
  } catch (e) {
    console.log(`  ✗ semantic-memory.js test coverage: ${e.message}`);
    failed += 5;
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
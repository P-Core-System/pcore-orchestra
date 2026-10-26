"use strict";

/**
 * Test for user coding pattern learning + pattern-aware planning.
 * Tests: inferTaskType, recordProjectPatterns, recordUserPreferences,
 * buildPatternContext, recordPhasePlanOutcome.
 */

const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

function loadMemoryManager() {
  const modPath = path.join(__dirname, "..", "bundle", "hooks", "lib", "memory-manager.js");
  delete require.cache[require.resolve(modPath)];
  return require(modPath);
}

function assert(condition, message) {
  if (!condition) throw new Error("ASSERTION FAILED: " + message);
  console.log("  ✓ " + message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error("ASSERTION FAILED: " + message + "\n  Expected: " + JSON.stringify(expected) + "\n  Actual:   " + JSON.stringify(actual));
  console.log("  ✓ " + message);
}

function assertContains(haystack, needle, message) {
  if (!haystack.includes(needle)) throw new Error("ASSERTION FAILED: " + message + "\n  Expected to contain: " + JSON.stringify(needle) + "\n  In: " + JSON.stringify(haystack));
  console.log("  ✓ " + message);
}

async function runTests() {
  console.log("=== test-memory-patterns.js ===");
  let passed = 0;
  let failed = 0;

  const memMgr = loadMemoryManager();

  // --- Test 1: inferTaskType ---
  console.log("\n-- inferTaskType --");
  assertEqual(memMgr.inferTaskType("add api endpoint for users"), "api", "api goal → api");
  assertEqual(memMgr.inferTaskType("create react frontend component"), "frontend", "frontend goal → frontend");
  assertEqual(memMgr.inferTaskType("add database migration for users table"), "database", "database goal → database");
  assertEqual(memMgr.inferTaskType("write vitest unit tests"), "testing", "testing goal → testing");
  assertEqual(memMgr.inferTaskType("setup docker ci pipeline"), "devops", "devops goal → devops");
  assertEqual(memMgr.inferTaskType("fix login bug"), "bugfix", "bugfix goal → bugfix");
  assertEqual(memMgr.inferTaskType("refactor utils"), "bugfix", "refactor goal → bugfix");
  assertEqual(memMgr.inferTaskType("do something unclear"), "general", "unclear goal → general");

  // --- Test 2: recordProjectPatterns + buildPatternContext ---
  console.log("\n-- recordProjectPatterns + buildPatternContext --");
  const testStateDir = fs.mkdtempSync(path.join(os.tmpdir(), "orchestra-pattern-test-"));
  const originalEnv = process.env.PCORE_STATE_DIR;
  process.env.PCORE_STATE_DIR = testStateDir;

  const mem1 = loadMemoryManager();
  memMgr.recordProjectPatterns(null, {
    "my-project": {
      task_type: "api",
      files: ["src/routes.ts", "src/controllers.ts"],
      conventions: { error_handling: "try-catch", naming: "camelCase" },
      test_framework: "vitest",
      package_manager: "npm",
      style: "prettier",
    },
  });

  const mem2 = loadMemoryManager();
  const ctx1 = mem2.buildPatternContext(
    { version: 1, sessions: { "pid-test": memMgr.getSessionMemory(memMgr.loadLongTermMemory(null)) } },
    "add api endpoint for orders"
  );
  assertContains(ctx1, "Learned patterns for similar tasks", "pattern context has header");
  assertContains(ctx1, "api", "pattern context mentions api task type");
  assertContains(ctx1, "vitest", "pattern context mentions test framework");
  assertContains(ctx1, "npm", "pattern context mentions package manager");

  // --- Test 3: recordUserPreferences ---
  console.log("\n-- recordUserPreferences --");
  memMgr.recordUserPreferences(null, { verbosity: "concise", detail_level: "high", prefer_typescript: true });
  const mem3 = loadMemoryManager();
  const ctx2 = mem3.buildPatternContext(
    { version: 1, sessions: { "pid-test": memMgr.getSessionMemory(memMgr.loadLongTermMemory(null)) } },
    "fix bug in parser"
  );
  assertContains(ctx2, "User coding preferences", "preferences context has header");
  assertContains(ctx2, "verbosity", "preferences context mentions verbosity");
  assertContains(ctx2, "typescript", "preferences context mentions typescript");

  // --- Test 4: recordPhasePlanOutcome ---
  console.log("\n-- recordPhasePlanOutcome --");
  const fakeState = {
    goal: "add database migration for orders",
    currentPhase: "verify",
    last_outcome: "passed",
    memory: { files_changed: ["src/migrations/001.ts"], errors: [] },
    started_at: Date.now() - 5000,
  };
  memMgr.recordPhasePlanOutcome(fakeState, null);
  const mem4 = loadMemoryManager();
  const aggregated = mem4.getAggregatedMemory(mem4.loadLongTermMemory(null));
  assertEqual(aggregated.plan_outcomes.length, 1, "one plan outcome recorded");
  assertEqual(aggregated.plan_outcomes[0].task_type, "database", "outcome task_type is database");
  assertEqual(aggregated.plan_outcomes[0].outcome, "passed", "outcome is passed");
  assertContains(JSON.stringify(aggregated.plan_outcomes[0]), "src/migrations/001.ts", "outcome includes changed file");

  // --- Test 5: buildPatternContext includes project patterns ---
  console.log("\n-- buildPatternContext includes project patterns --");
  const ctx3 = mem4.buildPatternContext(
    { version: 1, sessions: { "pid-test": mem4.getSessionMemory(mem4.loadLongTermMemory(null)) } },
    "add api endpoint for orders"
  );
  assertContains(ctx3, "my-project", "pattern context shows recorded project");
  assertContains(ctx3, "vitest", "pattern context shows recorded test framework");

  // --- Test 6: Task type influences pattern matching ---
  console.log("\n-- Task-type filtering --");
  // Record a frontend pattern first
  memMgr.recordProjectPatterns(null, {
    "frontend-app": {
      task_type: "frontend",
      files: ["src/App.tsx", "src/components/Button.tsx"],
      conventions: { naming: "PascalCase", styling: "tailwind" },
      test_framework: "vitest",
      package_manager: "npm",
      style: "prettier",
    },
  });
  const mem5 = loadMemoryManager();
  const ctx4 = mem5.buildPatternContext(
    { version: 1, sessions: { "pid-test": mem5.getSessionMemory(mem5.loadLongTermMemory(null)) } },
    "create react frontend page"
  );
  assertContains(ctx4, "frontend-app", "pattern context shows frontend project");
  assertContains(ctx4, "prettier", "pattern context shows frontend style");

  // Cleanup
  process.env.PCORE_STATE_DIR = originalEnv;
  try { fs.rmSync(testStateDir, { recursive: true, force: true }); } catch {}

  console.log("\n=== All pattern tests passed ===");
}

runTests().catch((err) => {
  console.error("  ✗ " + err.message);
  process.exit(1);
});

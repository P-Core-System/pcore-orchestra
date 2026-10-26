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

  // --- Test 7: recordPhasePlanOutcome tolerates missing last_outcome ---
  console.log("\n-- recordPhasePlanOutcome defaults --");
  memMgr.recordPhasePlanOutcome({ goal: "fix parser bug", currentPhase: "verify", memory: {} }, null);
  const mem6 = loadMemoryManager();
  const agg6 = mem6.getAggregatedMemory(mem6.loadLongTermMemory(null));
  const bare = agg6.plan_outcomes.find((o) => o.goal === "fix parser bug");
  assert(!!bare, "outcome recorded without last_outcome");
  assertEqual(bare.outcome, "unknown", "missing last_outcome stored as unknown");
  assertEqual(bare.phase, "verify", "phase preserved");

  // --- Test 8: repeated failures produce a planning warning ---
  console.log("\n-- outcome history warning --");
  const failingState = {
    version: 1,
    sessions: {
      "s-warn": {
        completed_goals: [],
        recent_files: [],
        error_patterns: [],
        project_patterns: {},
        user_preferences: {},
        plan_outcomes: [
          { task_type: "bugfix", phase: "verify", outcome: { decision: "block" }, errors: [{ error: "vitest: session claims spec failed" }], timestamp: "2026-10-20T10:00:00.000Z" },
          { task_type: "bugfix", phase: "verify", outcome: { decision: "fix" }, errors: [{ error: "vitest: session claims spec failed" }], timestamp: "2026-10-21T10:00:00.000Z" },
          { task_type: "bugfix", phase: "review", outcome: { decision: "advance" }, errors: [], timestamp: "2026-10-22T10:00:00.000Z" },
        ],
      },
    },
  };
  const mem7 = loadMemoryManager();
  const ctx5 = mem7.buildPatternContext(failingState, "fix login bug");
  assertContains(ctx5, "Task history (bugfix)", "warning names the task type");
  assertContains(ctx5, "needed fixes", "warning states failure count");
  assertContains(ctx5, "Recurring errors", "warning lists recurring errors");
  assertContains(ctx5, "vitest: session claims spec failed", "warning includes error label");
  const cleanCtx = mem7.buildPatternContext(failingState, "create react frontend page");
  assert(!cleanCtx.includes("Task history"), "no warning for an unrelated task type");

  // --- Test 9: learnProjectPattern detects stack + dedupes repeats ---
  console.log("\n-- learnProjectPattern --");
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "orchestra-stack-test-"));
  fs.writeFileSync(
    path.join(projectDir, "package.json"),
    JSON.stringify({ name: "stack-probe", devDependencies: { vitest: "^5.0.0" }, scripts: { test: "vitest run" } })
  );
  fs.writeFileSync(path.join(projectDir, "package-lock.json"), "{}");
  const stack = memMgr.detectProjectStack(projectDir);
  assertEqual(stack.package_manager, "npm", "detected npm from package-lock.json");
  assertEqual(stack.test_framework, "vitest", "detected vitest from devDependencies");

  const probeState = { goal: "add api endpoint for orders", memory: { files_changed: ["src/a.ts", "src/b.ts"] } };
  assert(memMgr.learnProjectPattern(probeState, projectDir) === true, "learnProjectPattern returns true for a real dir");
  memMgr.learnProjectPattern(probeState, projectDir);
  const mem8 = loadMemoryManager();
  const probeMem = mem8.getSessionMemory(mem8.loadLongTermMemory(null));
  const probeKeys = Object.keys(probeMem.project_patterns).filter((k) => k === path.basename(projectDir));
  assertEqual(probeKeys.length, 1, "project pattern recorded under dir basename");
  assertEqual(probeMem.project_patterns[probeKeys[0]].length, 1, "identical repeat is deduped");
  const ctx6 = mem8.buildPatternContext(
    { version: 1, sessions: { "pid-test": probeMem } },
    "add api endpoint for orders"
  );
  assertContains(ctx6, path.basename(projectDir), "pattern context shows learned project");
  assertContains(ctx6, "vitest", "pattern context shows learned test framework");
  fs.rmSync(projectDir, { recursive: true, force: true });

  // --- Test 10: completion path wires learning ---
  console.log("\n-- completion wiring --");
  const stopSrc = fs.readFileSync(
    path.join(__dirname, "..", "bundle", "hooks", "orchestra-subagent-stop.js"),
    "utf8"
  );
  assert(stopSrc.includes("learnProjectPattern(state"), "subagent-stop calls learnProjectPattern on completion");

  // Cleanup
  process.env.PCORE_STATE_DIR = originalEnv;
  try { fs.rmSync(testStateDir, { recursive: true, force: true }); } catch {}

  console.log("\n=== All pattern tests passed ===");
}

runTests().catch((err) => {
  console.error("  ✗ " + err.message);
  process.exit(1);
});

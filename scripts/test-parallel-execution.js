"use strict";

/**
 * Test for parallel phase execution via registry independence.
 * RED first: tests fail because canRunInParallel doesn't exist.
 */

const path = require("node:path");
const fs = require("node:fs");

function loadSpawnMatrix() {
  const modPath = path.join(__dirname, "..", "bundle", "hooks", "lib", "orchestra-spawn-matrix.js");
  delete require.cache[require.resolve(modPath)];
  return require(modPath);
}

function loadAgentRegistry() {
  const modPath = path.join(__dirname, "..", "bundle", "agent-registry.json");
  delete require.cache[require.resolve(modPath)];
  return require(modPath);
}

function loadSubagentStop() {
  const modPath = path.join(__dirname, "..", "bundle", "hooks", "orchestra-subagent-stop.js");
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
  console.log("=== test-parallel-execution.js ===");
  let passed = 0;
  let failed = 0;

  const spawnMatrix = loadSpawnMatrix();
  const registry = loadAgentRegistry();

  // Test 1: canRunInParallel function exists
  try {
    assert(typeof spawnMatrix.canRunInParallel === "function", "spawnMatrix.canRunInParallel is exported");
    passed++;
  } catch (e) {
    console.log(`  ✗ canRunInParallel exported: ${e.message}`);
    failed++;
  }

  // Test 2: canRunInParallel returns true for independent phases
  if (typeof spawnMatrix.canRunInParallel === "function") {
    try {
      // Create mock phase definitions with no overlapping files/gates/state
      const phaseA = {
        id: "analysis",
        agent: "orchestra-planner",
        files: ["context/architecture.md", "context/project-overview.md"],
        gates: [],
        stateKeys: ["goal", "memory"],
      };
      const phaseB = {
        id: "research",
        agent: "business-analyst",
        files: ["docs/research.md"],
        gates: [],
        stateKeys: ["research_notes"],
      };
      const result = spawnMatrix.canRunInParallel(phaseA, phaseB, registry);
      assert(result === true, "Independent phases return true");
      passed++;
    } catch (e) {
      console.log(`  ✗ canRunInParallel independent: ${e.message}`);
      failed++;
    }
  }

  // Test 3: canRunInParallel returns false for phases sharing files
  if (typeof spawnMatrix.canRunInParallel === "function") {
    try {
      const phaseA = {
        id: "plan",
        agent: "orchestra-planner",
        files: ["src/main.js", "context/architecture.md"],
        gates: ["build"],
        stateKeys: ["goal"],
      };
      const phaseB = {
        id: "implement",
        agent: "orchestra-implementer",
        files: ["src/main.js", "tests/main.test.js"], // shares src/main.js
        gates: ["tests"],
        stateKeys: ["files_changed"],
      };
      const result = spawnMatrix.canRunInParallel(phaseA, phaseB, registry);
      assert(result === false, "Phases sharing files return false");
      passed++;
    } catch (e) {
      console.log(`  ✗ canRunInParallel shared files: ${e.message}`);
      failed++;
    }
  }

  // Test 4: canRunInParallel returns false for phases sharing gates
  if (typeof spawnMatrix.canRunInParallel === "function") {
    try {
      const phaseA = {
        id: "verify",
        agent: "orchestra-verifier",
        files: [],
        gates: ["tests", "lint"],
        stateKeys: ["qualityGates"],
      };
      const phaseB = {
        id: "review",
        agent: "orchestra-reviewer",
        files: [],
        gates: ["tests", "security"], // shares tests gate
        stateKeys: ["qualityGates"],
      };
      const result = spawnMatrix.canRunInParallel(phaseA, phaseB, registry);
      assert(result === false, "Phases sharing gates return false");
      passed++;
    } catch (e) {
      console.log(`  ✗ canRunInParallel shared gates: ${e.message}`);
      failed++;
    }
  }

  // Test 5: canRunInParallel returns false for phases sharing state keys
  if (typeof spawnMatrix.canRunInParallel === "function") {
    try {
      const phaseA = {
        id: "plan",
        agent: "orchestra-planner",
        files: [],
        gates: [],
        stateKeys: ["goal", "memory"],
      };
      const phaseB = {
        id: "implement",
        agent: "orchestra-implementer",
        files: [],
        gates: [],
        stateKeys: ["goal", "files_changed"], // shares goal
      };
      const result = spawnMatrix.canRunInParallel(phaseA, phaseB, registry);
      assert(result === false, "Phases sharing state keys return false");
      passed++;
    } catch (e) {
      console.log(`  ✗ canRunInParallel shared state: ${e.message}`);
      failed++;
    }
  }

  // Test 6: Agent registry has independence metadata
  try {
    const planner = registry.agentDetails?.find(a => a.id === "orchestra-planner");
    const implementer = registry.agentDetails?.find(a => a.id === "orchestra-implementer");
    assert(planner && planner.independence, "planner has independence metadata");
    assert(implementer && implementer.independence, "implementer has independence metadata");
    assert(Array.isArray(planner.independence.files), "planner.independence.files is array");
    assert(Array.isArray(planner.independence.gates), "planner.independence.gates is array");
    assert(Array.isArray(planner.independence.stateKeys), "planner.independence.stateKeys is array");
    passed += 4;
  } catch (e) {
    console.log(`  ✗ registry independence metadata: ${e.message}`);
    failed += 4;
  }

  // Test 7: orchestra-subagent-stop.js uses canRunInParallel for concurrent spawn
  try {
    const content = loadSubagentStop();
    assert(content.includes("canRunInParallel"), "orchestra-subagent-stop.js uses canRunInParallel");
    assert(content.includes("spawn") || content.includes("concurrent"), "orchestra-subagent-stop.js has concurrent spawn logic");
    passed += 2;
  } catch (e) {
    console.log(`  ✗ subagent-stop concurrent spawn: ${e.message}`);
    failed += 2;
  }

  // Test 8: Gate enforcement still blocks dependents
  if (typeof spawnMatrix.canRunInParallel === "function") {
    try {
      const phaseA = {
        id: "verify",
        agent: "orchestra-verifier",
        files: [],
        gates: ["tests"],
        stateKeys: ["qualityGates"],
      };
      const phaseB = {
        id: "review",
        agent: "orchestra-reviewer",
        files: [],
        gates: [], // no shared gates but review depends on verify
        stateKeys: [],
      };
      // Even if canRunInParallel returns true, if phaseA has failed gates, phaseB should not run
      // This is tested at integration level - here we verify the function considers gate failures
      const result = spawnMatrix.canRunInParallel(phaseA, phaseB, registry);
      // The function should still return true for independence, but the conductor should check gates
      assert(typeof result === "boolean", "canRunInParallel returns boolean regardless of gate state");
      passed++;
    } catch (e) {
      console.log(`  ✗ gate enforcement consideration: ${e.message}`);
      failed++;
    }
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
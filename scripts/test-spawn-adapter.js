"use strict";

/**
 * Test for host-agnostic spawn adapter.
 * RED first: tests fail because spawnAdapter module doesn't exist.
 */

const path = require("node:path");
const fs = require("node:fs");

function loadSpawnAdapter() {
  const modPath = path.join(__dirname, "..", "bundle", "hooks", "lib", "spawn-adapter.js");
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

async function runTests() {
  console.log("=== test-spawn-adapter.js ===");
  let passed = 0;
  let failed = 0;

  // Test 1: spawnAdapter module exists
  let spawnAdapter;
  try {
    spawnAdapter = loadSpawnAdapter();
    assert(typeof spawnAdapter.spawn === "function", "spawnAdapter.spawn is exported");
    passed++;
  } catch (e) {
    console.log(`  ✗ spawnAdapter exports: ${e.message}`);
    failed++;
  }

  // Test 2: spawn works for Cursor (emits Task tool call format)
  if (spawnAdapter) {
    try {
      const result = await spawnAdapter.spawn("orchestra-planner", { goal: "test" }, null, "cursor");
      assert(result !== undefined, "spawn returns result");
      assert(result.success !== undefined, "result has success field");
      assert(result.result !== undefined || result.error !== undefined, "result has result or error");
      passed += 2;
    } catch (e) {
      console.log(`  ✗ spawn cursor: ${e.message}`);
      failed += 2;
    }
  }

  // Test 3: spawn works for OpenCode (emits task tool call format)
  if (spawnAdapter) {
    try {
      const result = await spawnAdapter.spawn("orchestra-implementer", { goal: "test" }, null, "opencode");
      assert(result !== undefined, "spawn returns result for opencode");
      assert(result.success !== undefined, "result has success field");
      passed++;
    } catch (e) {
      console.log(`  ✗ spawn opencode: ${e.message}`);
      failed++;
    }
  }

  // Test 4: spawn works for Claude Code (MCP tools/call)
  if (spawnAdapter) {
    try {
      const result = await spawnAdapter.spawn("orchestra-verifier", { goal: "test" }, null, "claude-code");
      assert(result !== undefined, "spawn returns result for claude-code");
      assert(result.success !== undefined, "result has success field");
      passed++;
    } catch (e) {
      console.log(`  ✗ spawn claude-code: ${e.message}`);
      failed++;
    }
  }

  // Test 5: spawn works for Codex (MCP tools/call)
  if (spawnAdapter) {
    try {
      const result = await spawnAdapter.spawn("orchestra-reviewer", { goal: "test" }, null, "codex");
      assert(result !== undefined, "spawn returns result for codex");
      assert(result.success !== undefined, "result has success field");
      passed++;
    } catch (e) {
      console.log(`  ✗ spawn codex: ${e.message}`);
      failed++;
    }
  }

  // Test 5b: spawn works for Qoder CLI (Agent tool + subagent_type)
  if (spawnAdapter) {
    try {
      const result = await spawnAdapter.spawn("orchestra-reviewer", { goal: "test" }, null, "qoder");
      assert(result !== undefined, "spawn returns result for qoder");
      assert(result.success === true, "qoder spawn succeeds");
      assertEqual(result.result.taskCall.tool, "Agent", "qoder taskCall uses Agent tool");
      assertEqual(result.result.taskCall.subagent_type, "orchestra-reviewer", "qoder taskCall has subagent_type");
      passed += 2;
    } catch (e) {
      console.log(`  ✗ spawn qoder: ${e.message}`);
      failed += 2;
    }
  }

  // Test 6: Response normalization - all hosts return {success, result, error, artifacts}
  if (spawnAdapter) {
    try {
      const hosts = ["cursor", "opencode", "claude-code", "codex", "qoder"];
      for (const host of hosts) {
        const result = await spawnAdapter.spawn("orchestra-planner", { goal: "test" }, null, host);
        assert(typeof result.success === "boolean", `${host}: result.success is boolean`);
        assert(result.hasOwnProperty("result"), `${host}: result has result property`);
        assert(result.hasOwnProperty("error"), `${host}: result has error property`);
        assert(Array.isArray(result.artifacts), `${host}: result.artifacts is array`);
      }
      passed += 4;
    } catch (e) {
      console.log(`  ✗ response normalization: ${e.message}`);
      failed += 4;
    }
  }

  // Test 7: spawn accepts worktreePath parameter
  if (spawnAdapter) {
    try {
      const result = await spawnAdapter.spawn("orchestra-planner", { goal: "test" }, "/tmp/worktree", "cursor");
      assert(result !== undefined, "spawn accepts worktreePath");
      passed++;
    } catch (e) {
      console.log(`  ✗ spawn worktreePath: ${e.message}`);
      failed++;
    }
  }

  // Test 8: Invalid host throws error
  if (spawnAdapter) {
    try {
      await spawnAdapter.spawn("orchestra-planner", { goal: "test" }, null, "invalid-host");
      // Should not reach here
      console.log(`  ✗ invalid host should throw`);
      failed++;
    } catch (e) {
      assert(e.message.includes("invalid-host") || e.message.includes("Unknown host"), "Invalid host throws error");
      passed++;
    }
  }

  // Test 9: Missing agent type throws error
  if (spawnAdapter) {
    try {
      await spawnAdapter.spawn("unknown-agent", { goal: "test" }, null, "cursor");
      // Should not reach here
      console.log(`  ✗ unknown agent should throw`);
      failed++;
    } catch (e) {
      assert(e.message.includes("unknown-agent") || e.message.includes("Unknown agent"), "Unknown agent throws error");
      passed++;
    }
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
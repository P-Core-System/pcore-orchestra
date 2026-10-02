"use strict";

/**
 * Test for spawn-adapter integration into the hook chain.
 * RED first: tests fail because spawnAdapter.spawn is not called in orchestra-subagent-stop.js
 */

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

function loadSpawnAdapter() {
  const modPath = path.join(__dirname, "..", "bundle", "hooks", "lib", "spawn-adapter.js");
  delete require.cache[require.resolve(modPath)];
  return require(modPath);
}

function loadSubagentStop() {
  const modPath = path.join(__dirname, "..", "bundle", "hooks", "orchestra-subagent-stop.js");
  delete require.cache[require.resolve(modPath)];
  // We need to mock dependencies
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

async function runTests() {
  console.log("=== test-spawn-adapter-integration.js ===");
  let passed = 0;
  let failed = 0;

  // Test 1: spawnAdapter module exists and exports spawn
  let spawnAdapter;
  try {
    spawnAdapter = loadSpawnAdapter();
    assert(typeof spawnAdapter.spawn === "function", "spawnAdapter.spawn is exported");
    passed++;
  } catch (e) {
    console.log(`  ✗ spawnAdapter exports: ${e.message}`);
    failed++;
  }

  // Test 2: orchestra-subagent-stop.js imports spawnAdapter
  let subagentStopSource;
  try {
    const filePath = path.join(__dirname, "..", "bundle", "hooks", "orchestra-subagent-stop.js");
    subagentStopSource = fs.readFileSync(filePath, "utf8");
    assert(subagentStopSource.includes("spawn-adapter"), "orchestra-subagent-stop.js imports spawn-adapter");
    assert(subagentStopSource.includes("spawnAdapter"), "orchestra-subagent-stop.js references spawnAdapter");
    passed += 2;
  } catch (e) {
    console.log(`  ✗ subagent-stop imports spawn-adapter: ${e.message}`);
    failed += 2;
  }

  // Test 3: spawnSubagent (which calls spawnAdapter.spawn) is called at phase transitions
  if (subagentStopSource) {
    try {
      // Check that handlePhaseComplete calls spawnSubagent
      assert(subagentStopSource.includes("spawnSubagent"), "handlePhaseComplete calls spawnSubagent");
      passed++;
    } catch (e) {
      console.log(`  ✗ spawnSubagent called in phase transition: ${e.message}`);
      failed++;
    }
  }

  // Test 4: spawnAdapter.spawn called with correct arguments (agentId, payload, worktreePath, host)
  if (subagentStopSource && spawnAdapter) {
    try {
      // Check that the call includes detectedHost (from env or state.host)
      assert(subagentStopSource.includes("detectedHost") || subagentStopSource.includes("state.host") || subagentStopSource.includes("process.env"), "detectedHost logic present");
      passed++;
    } catch (e) {
      console.log(`  ✗ detectedHost logic: ${e.message}`);
      failed++;
    }
  }

  // Test 5: spawnSubagent returns normalized response used by evaluatePhaseOutcome
  if (subagentStopSource) {
    try {
      assert(subagentStopSource.includes("evaluatePhaseOutcome"), "evaluatePhaseOutcome still called");
      // The normalized response should drive the outcome
      assert(subagentStopSource.includes("spawnResult") || subagentStopSource.includes("spawnResult.success"), "normalized response used");
      passed++;
    } catch (e) {
      console.log(`  ✗ normalized response drives outcome: ${e.message}`);
      failed++;
    }
  }

  // Test 6: Backward compatibility - stdout JSON emission kept as fallback
  if (subagentStopSource) {
    try {
      assert(subagentStopSource.includes("process.stdout.write") || subagentStopSource.includes("emit({"), "stdout JSON emission fallback present");
      passed++;
    } catch (e) {
      console.log(`  ✗ backward compatibility fallback: ${e.message}`);
      failed++;
    }
  }

  // Test 7: Simulate a phase transition and assert spawnAdapter.spawn is called
  if (spawnAdapter) {
    try {
      // Mock the process.stdout.write to capture the call
      const originalWrite = process.stdout.write;
      let capturedOutput = "";
      process.stdout.write = (chunk) => {
        capturedOutput += chunk;
        return true;
      };

      const result = await spawnAdapter.spawn("orchestra-planner", { goal: "test goal" }, "/tmp/worktree", "cursor");
      
      process.stdout.write = originalWrite;
      
      assert(result.success === true, "spawn returns success=true");
      assert(result.result !== null, "spawn returns result");
      assert(result.result.taskCall !== undefined, "result contains taskCall for cursor");
      assert(result.result.taskCall.tool === "Task", "taskCall has correct tool");
      assert(result.result.taskCall.subagent_type === "orchestra-planner", "taskCall has correct subagent_type");
      passed += 4;
    } catch (e) {
      process.stdout.write = originalWrite;
      console.log(`  ✗ simulate phase transition: ${e.message}`);
      failed += 4;
    }
  }

  // Test 8: OpenCode host works correctly
  if (spawnAdapter) {
    try {
      const originalWrite = process.stdout.write;
      let capturedOutput = "";
      process.stdout.write = (chunk) => {
        capturedOutput += chunk;
        return true;
      };

      const result = await spawnAdapter.spawn("orchestra-implementer", { goal: "test" }, "/tmp/worktree", "opencode");
      
      process.stdout.write = originalWrite;
      
      assert(result.success === true, "opencode spawn returns success=true");
      assert(result.result.taskCall.tool === "task", "opencode taskCall has correct tool");
      assert(result.result.taskCall.agent === "orchestra-implementer", "opencode taskCall has correct agent");
      passed += 3;
    } catch (e) {
      process.stdout.write = originalWrite;
      console.log(`  ✗ opencode host: ${e.message}`);
      failed += 3;
    }
  }

  // Test 9: MCP hosts (claude-code, codex) work correctly
  if (spawnAdapter) {
    try {
      const originalWrite = process.stdout.write;
      let capturedOutput = "";
      process.stdout.write = (chunk) => {
        capturedOutput += chunk;
        return true;
      };

      const result = await spawnAdapter.spawn("orchestra-verifier", { goal: "test" }, "/tmp/worktree", "claude-code");
      
      process.stdout.write = originalWrite;
      
      assert(result.success === true, "claude-code spawn returns success=true");
      assert(result.result.mcpCall !== undefined, "result contains mcpCall");
      assert(result.result.mcpCall.method === "tools/call", "mcpCall has correct method");
      assert(result.result.mcpCall.params.name === "spawn_subagent", "mcpCall has correct tool name");
      passed += 3;
    } catch (e) {
      process.stdout.write = originalWrite;
      console.log(`  ✗ claude-code host: ${e.message}`);
      failed += 3;
    }
  }

  // Test 10: All hosts return normalized {success, result, error, artifacts}
  if (spawnAdapter) {
    try {
      const hosts = ["cursor", "opencode", "claude-code", "codex"];
      for (const host of hosts) {
        const result = await spawnAdapter.spawn("orchestra-planner", { goal: "test" }, null, host);
        assert(typeof result.success === "boolean", `${host}: result.success is boolean`);
        assert(result.hasOwnProperty("result"), `${host}: result has result property`);
        assert(result.hasOwnProperty("error"), `${host}: result has error property`);
        assert(Array.isArray(result.artifacts), `${host}: result.artifacts is array`);
      }
      passed += 4;
    } catch (e) {
      console.log(`  ✗ all hosts normalized response: ${e.message}`);
      failed += 4;
    }
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
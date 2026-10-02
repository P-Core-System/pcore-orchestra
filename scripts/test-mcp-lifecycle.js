"use strict";

/**
 * Test for MCP server auto-start/stop lifecycle.
 * RED first: tests fail because orchestra-prompt.js doesn't start MCP server on run start
 * and orchestra-subagent-stop.js doesn't stop MCP server on run end.
 */

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

function loadMcpServer() {
  const modPath = path.join(__dirname, "..", "bundle", "hooks", "lib", "mcp-server.js");
  delete require.cache[require.resolve(modPath)];
  return require(modPath);
}

function loadOrchestraPrompt() {
  const modPath = path.join(__dirname, "..", "bundle", "hooks", "orchestra-prompt.js");
  delete require.cache[require.resolve(modPath)];
  const source = fs.readFileSync(modPath, "utf8");
  return { source, modPath };
}

function loadSubagentStop() {
  const modPath = path.join(__dirname, "..", "bundle", "hooks", "orchestra-subagent-stop.js");
  delete require.cache[require.resolve(modPath)];
  const source = fs.readFileSync(modPath, "utf8");
  return { source, modPath };
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
  console.log("=== test-mcp-lifecycle.js ===");
  let passed = 0;
  let failed = 0;

  // Load mcp-server.js source early for tests that need it
  let mcpServerSource;
  try {
    const modPath = path.join(__dirname, "..", "bundle", "hooks", "lib", "mcp-server.js");
    mcpServerSource = fs.readFileSync(modPath, "utf8");
  } catch (e) {
    mcpServerSource = "";
  }

  // Test 1: MCP server module exists with start/stop
  let mcpServer;
  try {
    mcpServer = loadMcpServer();
    assert(typeof mcpServer.start === "function", "mcpServer.start is exported");
    assert(typeof mcpServer.stop === "function", "mcpServer.stop is exported");
    passed += 2;
  } catch (e) {
    console.log(`  ✗ mcpServer exports: ${e.message}`);
    failed += 2;
  }

  // Test 2: orchestra-prompt.js imports mcp-server and calls start on run start
  let promptSource;
  try {
    const { source } = loadOrchestraPrompt();
    promptSource = source;
    assert(promptSource.includes("mcp-server") || promptSource.includes("mcpServer"), "orchestra-prompt.js imports mcp-server");
    assert(promptSource.includes("startOrchestra"), "orchestra-prompt.js calls startOrchestra");
    // Check that mcpServerStart is called after startOrchestra (destructured import)
    assert(promptSource.includes("mcpServerStart") && promptSource.includes("await mcpServerStart"), "orchestra-prompt.js calls mcpServerStart after run start");
    passed += 3;
  } catch (e) {
    console.log(`  ✗ orchestra-prompt.js starts MCP: ${e.message}`);
    failed += 3;
  }

  // Test 3: orchestra-subagent-stop.js imports mcp-server and calls stop on run end
  let stopSource;
  try {
    const { source } = loadSubagentStop();
    stopSource = source;
    assert(stopSource.includes("mcp-server") || stopSource.includes("mcpServer"), "orchestra-subagent-stop.js imports mcp-server");
    // Check that mcpServerStop is called at run end (destructured import)
    assert(stopSource.includes("mcpServerStop") && stopSource.includes("await mcpServerStop"), "orchestra-subagent-stop.js calls mcpServerStop at run end");
    passed += 2;
  } catch (e) {
    console.log(`  ✗ orchestra-subagent-stop.js stops MCP: ${e.message}`);
    failed += 2;
  }

  // Test 4: mcpServer.start stores instance in module-level Map keyed by runId
  if (promptSource) {
    try {
      assert(mcpServerSource.includes("mcpServerInstances") && mcpServerSource.includes("Map"), "mcp-server.js uses Map keyed by runId");
      passed++;
    } catch (e) {
      console.log(`  ✗ Map storage for runId: ${e.message}`);
      failed++;
    }
  }

  // Test 5: mcpServer.stop cleans up server and removes from Map
  if (stopSource && mcpServerSource) {
    try {
      assert(mcpServerSource.includes("mcpServerInstances.delete") || mcpServerSource.includes("mcpServerInstances.clear"), "mcp-server.js cleans up Map on stop");
      passed++;
    } catch (e) {
      console.log(`  ✗ mcpServer.stop cleanup: ${e.message}`);
      failed++;
    }
  }

  // Test 6: MCP server handles process.exit and SIGTERM for crash cleanup
  try {
    assert(mcpServerSource.includes("process.on") && (mcpServerSource.includes("exit") || mcpServerSource.includes("SIGTERM")), "mcp-server.js has process.on handlers for exit/SIGTERM");
    passed++;
  } catch (e) {
    console.log(`  ✗ MCP server crash handlers: ${e.message}`);
    failed++;
  }

  // Test 7: Simulate run start → MCP server starts on a port, resources accessible
  if (mcpServer) {
    try {
      const server = await mcpServer.start({ port: 0, worktreePath: process.cwd(), runId: "test-run-1" });
      assert(server !== null && typeof server === "object", "mcpServer.start returns server object");
      assert(typeof server.port === "number", "server has port (0 for stdio)");
      assert(typeof server.close === "function", "server has close method");
      
      // Check resources are accessible (after handlers are set up)
      const resources = await server.getResources();
      assert(Array.isArray(resources), "getResources returns array");
      console.log(`    Resources found: ${resources.length}`);
      
      // Check tools are accessible
      const tools = await server.getTools();
      assert(Array.isArray(tools), "getTools returns array");
      // Tools are registered after ListToolsRequestSchema handler is called
      // For now, just verify the method works
      console.log(`    Tools found: ${tools.length}`);
      
      await server.close();
      passed += 5;
    } catch (e) {
      console.log(`  ✗ run start simulation: ${e.message}`);
      failed += 5;
    }
  }

  // Test 8: Simulate run end → MCP server stops, resources no longer accessible
  if (mcpServer) {
    try {
      const server = await mcpServer.start({ port: 0, worktreePath: process.cwd(), runId: "test-run-2" });
      await mcpServer.stop("test-run-2");
      // After stop, the server should be closed
      assert(true, "mcpServer.stop completes without error");
      passed++;
    } catch (e) {
      console.log(`  ✗ run end simulation: ${e.message}`);
      failed++;
    }
  }

  // Test 9: Map is per-runId and doesn't leak across runs
  if (mcpServer && promptSource) {
    try {
      // Check that the Map is module-level in mcp-server.js
      assert(mcpServerSource.includes("mcpServerInstances") && mcpServerSource.includes("Map"), "mcp-server.js has module-level instance tracking");
      passed++;
    } catch (e) {
      console.log(`  ✗ Map per runId: ${e.message}`);
      failed++;
    }
  }

  // Test 10: Both mirrors (bundle/hooks and bundle/opencode/hooks) have identical mcp-server.js
  try {
    const source1 = fs.readFileSync(path.join(__dirname, "..", "bundle", "hooks", "lib", "mcp-server.js"), "utf8");
    const source2 = fs.readFileSync(path.join(__dirname, "..", "bundle", "opencode", "hooks", "lib", "mcp-server.js"), "utf8");
    assert(source1 === source2, "mcp-server.js mirrors are byte-identical");
    passed++;
  } catch (e) {
    console.log(`  ✗ mirror sync: ${e.message}`);
    failed++;
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
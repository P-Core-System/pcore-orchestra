"use strict";

/**
 * Test for MCP read-only server.
 * RED first: tests fail because mcpServer module doesn't exist, @modelcontextprotocol/sdk not installed.
 */

const path = require("node:path");
const fs = require("node:fs");

function loadMcpServer() {
  const modPath = path.join(__dirname, "..", "bundle", "hooks", "lib", "mcp-server.js");
  delete require.cache[require.resolve(modPath)];
  return require(modPath);
}

function loadPackageJson() {
  const pkgPath = path.join(__dirname, "..", "package.json");
  if (!fs.existsSync(pkgPath)) return null;
  return JSON.parse(fs.readFileSync(pkgPath, "utf8"));
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
  console.log("=== test-mcp-server.js ===");
  let passed = 0;
  let failed = 0;

  // Test 1: @modelcontextprotocol/sdk is in package.json
  try {
    const pkg = loadPackageJson();
    if (!pkg) throw new Error("package.json not found");
    assert(pkg.dependencies && pkg.dependencies["@modelcontextprotocol/sdk"], "@modelcontextprotocol/sdk in dependencies");
    passed++;
  } catch (e) {
    console.log(`  ✗ package.json dependency: ${e.message}`);
    failed++;
  }

  // Test 2: mcpServer module exists
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

  // Test 3: start() starts MCP server on stdio transport
  if (mcpServer) {
    try {
      const server = await mcpServer.start({ port: 0 }); // 0 = stdio transport
      assert(server !== null && typeof server === "object", "start returns server object");
      assert(typeof server.port === "number", "server has port (0 for stdio)");
      assert(typeof server.close === "function", "server has close method");
      await server.close();
      passed += 3;
    } catch (e) {
      console.log(`  ✗ start() returns server: ${e.message}`);
      failed += 3;
    }
  }

  // Test 4: Resources are registered
  if (mcpServer) {
    try {
      const server = await mcpServer.start({ port: 0 });
      // Check that resources are registered by inspecting the server
      // The server should have resources for run://<runId>, run://<runId>/gates, etc.
      assert(server.resources !== undefined || server.getResources !== undefined, "server has resources or getResources");
      await server.close();
      passed++;
    } catch (e) {
      console.log(`  ✗ resources registered: ${e.message}`);
      failed++;
    }
  }

  // Test 5: Tools are registered
  if (mcpServer) {
    try {
      const server = await mcpServer.start({ port: 0 });
      assert(server.tools !== undefined || server.getTools !== undefined, "server has tools or getTools");
      // Check for specific tools via list_runs capability
      await server.close();
      passed++;
    } catch (e) {
      console.log(`  ✗ tools registered: ${e.message}`);
      failed++;
    }
  }

  // Test 6: Server reads from worktree-partitioned state
  if (mcpServer) {
    try {
      // The McpServer class has these methods
      assert(typeof mcpServer.McpServer.prototype.getConductorRuns === "function", "McpServer can read conductor runs");
      assert(typeof mcpServer.McpServer.prototype.getDomainEvents === "function", "McpServer can read domain events");
      // Also test via the returned server object
      const server = await mcpServer.start({ port: 0 });
      await server.close();
      passed += 2;
    } catch (e) {
      console.log(`  ✗ worktree state reading: ${e.message}`);
      failed += 2;
    }
  }

  // Test 6b: a cached runId returns the server handle, not the internal record
  if (mcpServer) {
    try {
      const first = await mcpServer.start({ port: 0, runId: "cached-handle-check" });
      const second = await mcpServer.start({ port: 0, runId: "cached-handle-check" });
      assert(second === first, "same runId returns the cached server handle");
      assert(typeof second.close === "function", "cached server handle has close");
      await mcpServer.stop("cached-handle-check");
      passed += 2;
    } catch (e) {
      console.log(`  ✗ cached runId handle: ${e.message}`);
      failed += 2;
    }
  }

  // Test 7: stop() stops the server
  if (mcpServer) {
    try {
      const server = await mcpServer.start({ port: 0 });
      await mcpServer.stop();
      assert(true, "stop() completes without error");
      passed++;
    } catch (e) {
      console.log(`  ✗ stop(): ${e.message}`);
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
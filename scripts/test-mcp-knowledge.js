"use strict";

/**
 * Test for the MCP knowledge server (ChatGPT-facing):
 *  - read allowlist (docs/, context/*.md, top-level md; secrets/escapes denied)
 *  - search_docs / read_doc / read_context / search_memory behavior
 *  - share_knowledge → pending inbox round trip (PCORE_STATE_DIR redirected)
 *  - TOOL_DEFINITIONS appended to the MCP tool surface
 *  - Streamable HTTP front: /health, bearer auth, MCP initialize + tools/list
 *  - non-loopback bind refuses without a token
 */

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const http = require("node:http");

const ROOT = path.join(__dirname, "..");

// Redirect all state (inbox) into a temp dir BEFORE loading modules.
const TMP_STATE = fs.mkdtempSync(path.join(os.tmpdir(), "pcore-mcp-test-"));
process.env.PCORE_STATE_DIR = TMP_STATE;
process.env.PCORE_MCP_ROOT = ROOT;

const kt = require(path.join(ROOT, "bundle", "hooks", "lib", "knowledge-tools.js"));
const mcp = require(path.join(ROOT, "bundle", "hooks", "lib", "mcp-server.js"));

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ✓ ${message}`);
}

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}: ${e.message}`);
    failed++;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}: ${e.message}`);
    failed++;
  }
}

function httpJson(port, method, urlPath, headers, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, method, path: urlPath, headers: headers || {} },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  console.log("=== test-mcp-knowledge.js ===");

  // 1. Allowlist
  test("allowlist", () => {
    assert(kt.isAllowedRel(path.join("docs", "01-OVERVIEW-AND-ARCHITECTURE.md")) === true, "docs/*.md allowed");
    assert(kt.isAllowedRel(path.join("context", "architecture.md")) === true, "context/*.md allowed");
    assert(kt.isAllowedRel("AGENTS.md") === true, "top-level AGENTS.md allowed");
    assert(kt.isAllowedRel("README.md") === true, "top-level README.md allowed");
    assert(kt.isAllowedRel(".env") === false, ".env denied");
    assert(kt.isAllowedRel(path.join("..", "etc", "passwd")) === false, "parent escape denied");
    assert(kt.isAllowedRel(path.join("docs", "secrets.md")) === false, "secret-named doc denied");
    assert(kt.isAllowedRel(path.join("src", "app.js")) === false, "source files denied");
    assert(kt.resolveAllowed("../AGENTS.md") === null, "resolveAllowed rejects escape");
    assert(kt.resolveAllowed("docs") === null, "resolveAllowed rejects non-md");
  });

  // 2. search_docs
  test("search_docs", () => {
    const res = kt.searchDocs({ query: "orchestra" });
    assert(res.filesScanned > 0, "search_docs scans allowlisted files");
    assert(res.matches.length > 0, "search_docs finds 'orchestra'");
    assert(res.matches[0].file && res.matches[0].line, "match carries file + line");
    let threw = false;
    try { kt.searchDocs({}); } catch { threw = true; }
    assert(threw, "search_docs requires query");
  });

  // 3. read_doc
  test("read_doc", () => {
    const res = kt.readDoc({ file: "README.md" });
    assert(res.content.length > 0, "read_doc returns README content");
    let threw = false;
    try { kt.readDoc({ file: ".env" }); } catch { threw = true; }
    assert(threw, "read_doc denies .env");
  });

  // 4. read_context
  test("read_context", () => {
    const ctxDir = path.join(ROOT, "context");
    const first = fs.readdirSync(ctxDir).find((f) => f.endsWith(".md"));
    const res = kt.readContext({ file: first });
    assert(res.content.length > 0, `read_context reads context/${first}`);
    let threw = false;
    let msg = "";
    try { kt.readContext({ file: "no-such-file.md" }); } catch (e) { threw = true; msg = e.message; }
    assert(threw && msg.includes("available:"), "missing context file lists available");
  });

  // 5. search_memory
  test("search_memory", () => {
    const res = kt.searchMemory({ query: "orchestra" });
    assert(res.query === "orchestra" && Array.isArray(res.hits), "search_memory returns hits array");
  });

  // 6. share_knowledge → list_knowledge round trip
  test("share/list inbox", () => {
    const shared = kt.shareKnowledge({
      title: "Test entry",
      body: "Body from test suite.".repeat(4000), // exceeds 8000 cap
      tags: ["test", "roundtrip"],
      source: "chatgpt-test",
    });
    assert(shared.id.startsWith("kb-") && shared.status === "pending", "share_knowledge queues pending entry");
    assert(shared.inbox.startsWith(TMP_STATE), "inbox honors PCORE_STATE_DIR");
    const listed = kt.listKnowledge({ status: "pending" });
    const entry = listed.entries.find((e) => e.id === shared.id);
    assert(!!entry, "list_knowledge returns the shared entry");
    assert(entry.body.length <= 8000, "body capped at 8000 chars");
    assert(entry.title === "Test entry" && entry.source === "chatgpt-test", "title/source preserved");
    let threw = false;
    try { kt.shareKnowledge({ title: "x" }); } catch { threw = true; }
    assert(threw, "share_knowledge requires title and body");
  });

  // 7. TOOL_DEFINITIONS surface
  test("tool definitions", () => {
    const names = kt.TOOL_DEFINITIONS.map((t) => t.name);
    for (const want of ["search_docs", "read_doc", "read_context", "search_memory", "share_knowledge", "list_knowledge"]) {
      assert(names.includes(want), `tool ${want} defined`);
    }
    for (const t of kt.TOOL_DEFINITIONS) {
      assert(typeof t.handler === "function" && t.inputSchema && t.description, `tool ${t.name} is complete`);
    }
  });

  // 8. startHttp refuses non-loopback without token
  await testAsync("bind policy", async () => {
    let threw = false;
    try { await mcp.startHttp({ host: "0.0.0.0", port: 0 }); } catch { threw = true; }
    assert(threw, "non-loopback bind without token is refused");
    const prev = process.env.PCORE_MCP_TOKEN;
    process.env.PCORE_MCP_TOKEN = "env-token";
    try {
      const s = await mcp.startHttp({ host: "0.0.0.0", port: 0 });
      assert(s.port > 0, "non-loopback bind with token succeeds");
      await s.close();
    } finally {
      if (prev === undefined) delete process.env.PCORE_MCP_TOKEN;
      else process.env.PCORE_MCP_TOKEN = prev;
    }
  });

  // 9. HTTP transport: health, auth, MCP handshake + tools/list
  await testAsync("http transport", async () => {
    const TOKEN = "test-token-123";
    const server = await mcp.startHttp({ host: "127.0.0.1", port: 0, token: TOKEN });
    const port = server.port;
    try {
      const health = await httpJson(port, "GET", "/health");
      assert(health.status === 200 && JSON.parse(health.body).ok === true, "GET /health returns ok");

      const noAuth = await httpJson(port, "POST", "/mcp", { "content-type": "application/json" }, "{}");
      assert(noAuth.status === 401, "POST /mcp without bearer → 401");

      const wrongPath = await httpJson(port, "GET", "/other", { authorization: "Bearer " + TOKEN });
      assert(wrongPath.status === 404, "unknown path → 404");

      const hdr = { "content-type": "application/json", authorization: "Bearer " + TOKEN, accept: "application/json, text/event-stream" };
      const initBody = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" },
        },
      });
      const init = await httpJson(port, "POST", "/mcp", hdr, initBody);
      assert(init.status === 200, "MCP initialize → 200");
      const initPayload = extractJsonRpc(init.body);
      assert(initPayload && initPayload.result && initPayload.result.serverInfo, "initialize returns serverInfo");

      const toolsList = await httpJson(port, "POST", "/mcp", hdr, JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }));
      const toolsPayload = extractJsonRpc(toolsList.body);
      const toolNames = toolsPayload && toolsPayload.result ? toolsPayload.result.tools.map((t) => t.name) : [];
      assert(toolNames.includes("search_docs") && toolNames.includes("share_knowledge"), "tools/list includes knowledge tools");
      assert(toolNames.includes("list_runs"), "tools/list keeps run tools");

      const call = await httpJson(port, "POST", "/mcp", hdr, JSON.stringify({
        jsonrpc: "2.0", id: 3, method: "tools/call",
        params: { name: "read_doc", arguments: { file: ".env" } },
      }));
      const callPayload = extractJsonRpc(call.body);
      assert(callPayload && callPayload.result && callPayload.result.isError === true, "tools/call read_doc(.env) → isError");
    } finally {
      await server.close();
    }
  });

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  fs.rmSync(TMP_STATE, { recursive: true, force: true });
  process.exit(failed > 0 ? 1 : 0);
}

// The stateless transport may answer with plain JSON or an SSE stream; pull the
// first JSON-RPC object out of either shape.
function extractJsonRpc(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed[0] : parsed;
  }
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("data: ")) {
      try {
        const parsed = JSON.parse(line.slice(6));
        if (parsed && (parsed.result !== undefined || parsed.method)) return parsed;
      } catch {}
    }
  }
  return null;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

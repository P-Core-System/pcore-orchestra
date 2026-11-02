"use strict";

/**
 * Test for the MCP `prompts` capability + master-prompts lib:
 *  - listPrompts / renderPrompt content (project-aware, goal embedded, caps)
 *  - unknown prompt returns null
 *  - get_master_prompt / list_master_prompts tools
 *  - over the HTTP transport: initialize advertises `prompts`, and
 *    prompts/list + prompts/get complete a round trip
 *  - byte-identity of the mirrored master-prompts lib
 */

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const http = require("node:http");

const ROOT = path.join(__dirname, "..");
const LIB = path.join(ROOT, "bundle", "hooks", "lib");

const TMP_STATE = fs.mkdtempSync(path.join(os.tmpdir(), "pcore-prompts-"));
process.env.PCORE_STATE_DIR = TMP_STATE;
process.env.PCORE_MCP_ROOT = ROOT; // repo project.yaml → slug pcore-orchestra

const mp = require(path.join(LIB, "master-prompts.js"));
const mcp = require(path.join(LIB, "mcp-server.js"));

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
}
function test(name, fn) {
  try { fn(); passed++; } catch (e) { console.log(`  ✗ ${name}: ${e.message}`); failed++; }
}
async function testAsync(name, fn) {
  try { await fn(); passed++; } catch (e) { console.log(`  ✗ ${name}: ${e.message}`); failed++; }
}

function httpJson(port, method, urlPath, headers, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: urlPath, headers: headers || {} }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => resolve({ status: res.statusCode, body: d }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}
function extractJsonRpc(text) {
  const t = text.trim();
  if (t.startsWith("{") || t.startsWith("[")) { const p = JSON.parse(t); return Array.isArray(p) ? p[0] : p; }
  for (const line of text.split(/\r?\n/)) if (line.startsWith("data: ")) { try { const p = JSON.parse(line.slice(6)); if (p && (p.result !== undefined || p.method)) return p; } catch {} }
  return null;
}

async function main() {
  console.log("=== test-mcp-prompts.js ===");

  test("listPrompts catalog", () => {
    const names = mp.listPrompts().map((p) => p.name);
    for (const want of ["orchestra_plan", "orchestra_implement", "orchestra_verify", "orchestra_review", "project_knowledge"]) {
      assert(names.includes(want), `prompt ${want} listed`);
    }
    for (const p of mp.listPrompts()) assert(p.description && Array.isArray(p.arguments), `prompt ${p.name} has description + arguments`);
  });

  test("renderPrompt is project-aware", () => {
    const text = mp.renderPrompt("orchestra_plan", { goal: "add a widget" });
    assert(typeof text === "string" && text.length > 0, "render returns text");
    assert(text.includes("pcore-orchestra"), "render embeds project slug");
    assert(text.includes("add a widget"), "render embeds the goal");
    assert(mp.renderPrompt("does_not_exist", {}) === null, "unknown prompt returns null");
    const long = mp.renderPrompt("orchestra_review", { goal: "x".repeat(9000) });
    assert(long.length < 9000, "goal clipped to a cap");
  });

  test("renderPrompt pulls approved knowledge", () => {
    const store = require(path.join(LIB, "knowledge-store.js"));
    store.insertKnowledge({ title: "Deploy gate", body: "Run scripts/health before ship", status: "pending" });
    // pending is NOT surfaced
    assert(!mp.renderPrompt("project_knowledge", { goal: "ship" }).includes("Run scripts/health"), "pending knowledge not in prompt");
    const all = store.queryKnowledge({ limit: 10 });
    store.setKnowledgeStatus(all[0].id, "approved");
    assert(mp.renderPrompt("project_knowledge", { goal: "ship" }).includes("Run scripts/health"), "approved knowledge embedded in prompt");
  });

  test("mirror byte-identity", () => {
    const a = fs.readFileSync(path.join(LIB, "master-prompts.js"));
    const b = fs.readFileSync(path.join(ROOT, "bundle", "opencode", "hooks", "lib", "master-prompts.js"));
    assert(a.equals(b), "master-prompts.js mirrored byte-identical");
  });

  await testAsync("http prompts round trip", async () => {
    const TOKEN = "pt-123";
    const server = await mcp.startHttp({ host: "127.0.0.1", port: 0, token: TOKEN });
    const hdr = { "content-type": "application/json", authorization: "Bearer " + TOKEN, accept: "application/json, text/event-stream" };
    try {
      const init = await httpJson(server.port, "POST", "/mcp", hdr, JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } },
      }));
      const ip = extractJsonRpc(init.body);
      assert(ip && ip.result && ip.result.capabilities && ip.result.capabilities.prompts, "initialize advertises prompts capability");

      const listed = extractJsonRpc(await httpJson(server.port, "POST", "/mcp", hdr, JSON.stringify({ jsonrpc: "2.0", id: 2, method: "prompts/list" })).then((r) => r.body));
      assert(listed && listed.result.prompts.some((p) => p.name === "orchestra_plan"), "prompts/list returns catalog");

      const got = extractJsonRpc(await httpJson(server.port, "POST", "/mcp", hdr, JSON.stringify({ jsonrpc: "2.0", id: 3, method: "prompts/get", params: { name: "orchestra_plan", arguments: { goal: "demo" } } })).then((r) => r.body));
      assert(got && got.result && got.result.messages && got.result.messages[0].content.text.includes("demo"), "prompts/get returns rendered message");

      const tool = extractJsonRpc(await httpJson(server.port, "POST", "/mcp", hdr, JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_master_prompt", arguments: { name: "project_knowledge", arguments: {} } } })).then((r) => r.body));
      assert(tool && tool.result && tool.result.isError !== true, "get_master_prompt tool succeeds");
    } finally {
      await server.close();
    }
  });

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  fs.rmSync(TMP_STATE, { recursive: true, force: true });
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

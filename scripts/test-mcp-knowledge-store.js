"use strict";

/**
 * Test for the SQLite knowledge store + the chat/pairing tools it backs:
 *  - schema/round trip for knowledge (project-partitioned by project.slug)
 *  - review_knowledge promotion (pending → approved) + missing-entry handling
 *  - chat threads/messages with sequence ordering, resume by external binding
 *  - pairing upsert (ON CONFLICT update) and per-project listing
 *  - JSON-inbox fallback + chat-unavailable when node:sqlite is disabled
 *  - legacy knowledge-inbox.json is imported once into the table
 *  - byte-identity of the Cursor <-> OpenCode mirrored lib file
 */

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const ROOT = path.join(__dirname, "..");
const LIB = path.join(ROOT, "bundle", "hooks", "lib");

const TMP_STATE = fs.mkdtempSync(path.join(os.tmpdir(), "pcore-kstore-"));
const PROJECT_A = makeProject("alpha");
const PROJECT_B = makeProject("beta");

process.env.PCORE_STATE_DIR = TMP_STATE;
process.env.PCORE_MCP_ROOT = PROJECT_A;

const store = require(path.join(LIB, "knowledge-store.js"));
const kt = require(path.join(LIB, "knowledge-tools.js"));

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
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

function makeProject(slug) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `pcore-proj-${slug}-`));
  fs.writeFileSync(path.join(dir, "project.yaml"), `project:\n  name: ${slug}\n  slug: ${slug}\n  type: devops\n`);
  return dir;
}

main();

function main() {
  console.log("=== test-mcp-knowledge-store.js ===");

  if (!store.dbAvailable()) {
    console.log("  SKIP — node:sqlite unavailable on this Node; only the fallback path can run");
    runFallbackTests();
    finish();
    return;
  }

  test("legacy inbox imports once (fresh db)", () => {
    // The legacy inbox predates the database — import fires only while the
    // table is empty, which a fresh PCORE_STATE_DIR guarantees here.
    const jsonInbox = path.join(TMP_STATE, "knowledge-inbox.json");
    fs.writeFileSync(
      jsonInbox,
      JSON.stringify({ entries: [{ id: "kb-legacy1", ts: "2020-01-01T00:00:00.000Z", title: "L", body: "legacy", tags: [], source: "old", status: "pending" }] })
    );
    const fresh = store.insertKnowledge({ title: "trigger", body: "import" });
    assert(fresh.id, "insert succeeded");
    assert(store.queryKnowledge({ status: "pending" }).some((r) => r.id === "kb-legacy1"), "legacy entry imported into table");
    fs.rmSync(jsonInbox, { force: true });
  });

  test("project key from project.yaml slug", () => {
    assert(store.projectKey() === "alpha", "projectKey reads PCORE_MCP_ROOT slug");
  });

  test("knowledge round trip + caps", () => {
    const e = store.insertKnowledge({ title: "T".repeat(300), body: "B".repeat(9000), tags: ["x", "y"], source: "chatgpt" });
    assert(e.store === "sqlite", "insert uses sqlite");
    assert(e.id.startsWith("kb-") && e.status === "pending", "pending entry queued");
    assert(e.title.length === 200 && e.body.length === 8000, "title/body capped");
    assert(e.project === "alpha", "row partitioned to project slug");
    const list = store.queryKnowledge({ status: "pending" });
    assert(list.some((r) => r.id === e.id), "query returns the entry");
    assert(Array.isArray(list.find((r) => r.id === e.id).tags), "tags round-trip as array");
  });

  test("review_knowledge promotion", () => {
    const e = store.insertKnowledge({ title: "rev", body: "body" });
    const approved = kt.reviewKnowledge({ id: e.id, status: "approved" });
    assert(approved.status === "approved", "pending → approved");
    assert(store.queryKnowledge({ status: "approved" }).some((r) => r.id === e.id), "approved rows listable");
    let threwBad = false;
    try { kt.reviewKnowledge({ id: e.id, status: "bogus" }); } catch { threwBad = true; }
    assert(threwBad, "invalid status rejected");
    let threwMissing = false;
    try { kt.reviewKnowledge({ id: "kb-nope", status: "approved" }); } catch { threwMissing = true; }
    assert(threwMissing, "missing id rejected");
  });

  test("chat threads + messages", () => {
    const th = kt.startThread({ title: "Design sync" });
    assert(th.id.startsWith("th-") && th.project === "alpha", "thread created under project");
    const m1 = kt.postMessage({ threadId: th.id, role: "user", content: "hello", author: "chatgpt" });
    const m2 = kt.postMessage({ threadId: th.id, role: "assistant", content: "hi there" });
    assert(m1.seq === 1 && m2.seq === 2, "messages sequenced");
    const got = kt.getThread({ threadId: th.id });
    assert(got.messages.length === 2 && got.messages[0].content === "hello", "resume returns ordered messages");
    assert(got.updated_ts >= got.created_ts, "thread updated_ts advanced");
    let threw = false;
    try { kt.postMessage({ threadId: "th-missing", content: "x" }); } catch { threw = true; }
    assert(threw, "posting to unknown thread throws");
  });

  test("pairing + resume by external id", () => {
    const th = kt.startThread({ title: "paired", externalKind: "chatgpt", externalId: "conv-1" });
    kt.postMessage({ threadId: th.id, role: "user", content: "bound" });
    const byExternal = kt.getThread({ externalKind: "chatgpt", externalId: "conv-1" });
    assert(byExternal.id === th.id && byExternal.messages.length === 1, "resume by external binding");
    const pairs = kt.listPairs().pairs;
    assert(pairs.some((p) => p.external_id === "conv-1" && p.thread_id === th.id), "pair recorded");
    // re-pair the same external id to a new thread → update, not duplicate
    const th2 = store.createThread({ title: "rebound" });
    const rebound = kt.pairThread({ externalKind: "chatgpt", externalId: "conv-1", threadId: th2.id });
    assert(rebound.thread_id === th2.id, "upsert rebinds existing pair");
    assert(kt.listPairs().pairs.filter((p) => p.external_id === "conv-1").length === 1, "no duplicate pair row");
  });

  test("project partitioning isolates rows", () => {
    process.env.PCORE_MCP_ROOT = PROJECT_B;
    assert(store.projectKey() === "beta", "projectKey follows PCORE_MCP_ROOT");
    const threadsB = store.listThreads();
    assert(threadsB.every((t) => t.project === "beta"), "listThreads scoped to current project");
    assert(store.queryKnowledge().every((r) => r.project === "beta"), "knowledge scoped to current project");
    process.env.PCORE_MCP_ROOT = PROJECT_A;
  });

  runFallbackTests();

  test("mirror byte-identity", () => {
    const a = fs.readFileSync(path.join(LIB, "knowledge-store.js"));
    const b = fs.readFileSync(path.join(ROOT, "bundle", "opencode", "hooks", "lib", "knowledge-store.js"));
    assert(a.equals(b), "knowledge-store.js mirrored byte-identical");
  });

  finish();
}

function runFallbackTests() {
  test("JSON-inbox fallback when sqlite disabled", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "pcore-kstore-off-"));
    const before = process.env.PCORE_STATE_DIR;
    const beforeRoot = process.env.PCORE_MCP_ROOT;
    process.env.PCORE_STATE_DIR = stateDir;
    process.env.PCORE_MCP_ROOT = PROJECT_A;
    process.env.PCORE_KNOWLEDGE_DISABLE = "1";
    delete require.cache[require.resolve(path.join(LIB, "knowledge-store.js"))];
    delete require.cache[require.resolve(path.join(LIB, "knowledge-tools.js"))];
    const off = require(path.join(LIB, "knowledge-store.js"));
    const offTools = require(path.join(LIB, "knowledge-tools.js"));
    try {
      assert(off.dbAvailable() === false, "store reports unavailable when disabled");
      const e = offTools.shareKnowledge({ title: "fb", body: "json body" });
      assert(e.store === "json", "share falls back to json store");
      const listed = offTools.listKnowledge({ status: "pending" });
      assert(listed.entries.some((r) => r.id === e.id), "json list round trip");
      assert(fs.existsSync(path.join(stateDir, "knowledge-inbox.json")), "json inbox written");
      let threw = false;
      try { offTools.startThread({ title: "no db" }); } catch { threw = true; }
      assert(threw, "chat unavailable without sqlite");
    } finally {
      delete process.env.PCORE_KNOWLEDGE_DISABLE;
      process.env.PCORE_STATE_DIR = before;
      process.env.PCORE_MCP_ROOT = beforeRoot;
      delete require.cache[require.resolve(path.join(LIB, "knowledge-store.js"))];
      delete require.cache[require.resolve(path.join(LIB, "knowledge-tools.js"))];
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });
}

function finish() {
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  fs.rmSync(TMP_STATE, { recursive: true, force: true });
  fs.rmSync(PROJECT_A, { recursive: true, force: true });
  fs.rmSync(PROJECT_B, { recursive: true, force: true });
  process.exit(failed > 0 ? 1 : 0);
}

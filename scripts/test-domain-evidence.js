#!/usr/bin/env node
"use strict";

const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const ROOT = path.resolve(__dirname, "..");
const domainPath = path.join(ROOT, "bundle/hooks/lib/domain");
const completion = require(path.join(domainPath, "completion.js"));
const evidence = require(path.join(domainPath, "evidence.js"));
const store = require(path.join(domainPath, "store.js"));

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log("PASS", name);
  } catch (e) {
    failures++;
    console.error("FAIL", name, e);
  }
}

test("evidence module exists and exports", () => {
  assert.strictEqual(typeof evidence.appendEvidenceRun, "function");
  assert.strictEqual(typeof evidence.loadEvidenceRun, "function");
});

test("evidence roundtrip via events", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pcore-evid-"));
  const evPath = path.join(tmp, "domain-events.json");
  const old = store.domainEventsPath();
  // monkey patch
  const store2 = require(path.join(domainPath, "store.js"));
  Object.defineProperty(store2, "domainEventsPath", { configurable: true, value: () => evPath });
  // also patch original
  Object.defineProperty(store, "domainEventsPath", { configurable: true, value: () => evPath });
  const evMod = require(path.join(domainPath, "evidence.js"));
  evMod.appendEvidenceRun({ runId: "r1", records: [{ gate: "tests", exitCode: 0, ok: true }] });
  const loaded = evMod.loadEvidenceRun("r1");
  assert.ok(Array.isArray(loaded));
  assert.strictEqual(loaded[0].gate, "tests");
  // restore
  Object.defineProperty(store, "domainEventsPath", { configurable: true, value: old });
});

test("completion accepts evidence_passed and evidence_stale/evidence_failed reasons exist", () => {
  const res = completion.evaluateCompletion({
    ticket: { agent_status: "claimed_done", humanReview: { required: false } },
    verification: { result: "passed", commit: "abc123" },
    gates: [],
    acResults: [],
    review: null,
    currentCommit: "abc123",
    evidence: { ok: false, commit: "abc123" },
  });
  assert.ok(res.reasons.includes("evidence_failed"));
});

if (failures > 0) {
  process.exit(1);
} else {
  console.log("domain evidence tests OK");
  process.exit(0);
}
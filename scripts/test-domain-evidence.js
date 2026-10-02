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

/** Base input whose ONLY blocker is the evidence verdict under test. */
function completionInput(evidence) {
  return {
    ticket: { agent_status: "claimed_done", humanReview: { required: false } },
    verification: { result: "passed", commit: "abc123" },
    gates: [],
    acResults: [],
    review: null,
    currentCommit: "abc123",
    evidence,
  };
}

test("completion blocks when the evidence record did not pass (evidence_passed false)", () => {
  const res = completion.evaluateCompletion(
    completionInput({ ok: false, commit: "abc123" })
  );
  assert.strictEqual(res.checks.evidence_passed, false, "a failed evidence record must not pass");
  assert.strictEqual(res.checks.evidenceStale, false, "a fresh failed record is not stale");
  assert.ok(res.reasons.includes("evidence_failed"), `expected evidence_failed, got ${res.reasons}`);
  assert.ok(!res.reasons.includes("evidence_stale"), "a fresh failure must not be reported as stale");
  assert.strictEqual(res.complete, false);
});

test("completion blocks a STALE evidence record (evidence commit != current commit)", () => {
  const res = completion.evaluateCompletion(
    completionInput({ ok: true, commit: "old000" })
  );
  assert.strictEqual(res.checks.evidenceStale, true, "a differing commit is stale");
  assert.strictEqual(res.checks.evidence_passed, false, "stale evidence must not count as passed");
  assert.ok(res.reasons.includes("evidence_stale"), `expected evidence_stale, got ${res.reasons}`);
  assert.ok(!res.reasons.includes("evidence_failed"), "a stale-but-green record is stale, not failed");
  assert.strictEqual(res.complete, false);
});

test("a null evidence commit is unknown, NOT stale", () => {
  const res = completion.evaluateCompletion(completionInput({ ok: true, commit: null }));
  assert.strictEqual(res.checks.evidenceStale, false, "null = unknown, never stale");
  assert.strictEqual(res.checks.evidence_passed, true, "a green record at an unknown commit still passes");
  assert.ok(!res.reasons.includes("evidence_stale"), `null commit must not be stale: ${res.reasons}`);
  assert.ok(!res.reasons.includes("evidence_failed"), `null commit must not be a failure: ${res.reasons}`);
});

test("fresh passing evidence at the current commit completes the ticket", () => {
  const res = completion.evaluateCompletion(completionInput({ ok: true, commit: "abc123" }));
  assert.strictEqual(res.checks.evidence_passed, true, "evidence_passed must hold for a fresh green record");
  assert.strictEqual(res.checks.evidenceStale, false, "the record is at the current commit");
  assert.deepStrictEqual(res.reasons, [], `no blocker expected, got ${res.reasons}`);
  assert.strictEqual(res.complete, true);
});

test("corrupting either evidence check must change the verdict", () => {
  // Guards the two fields above against becoming dead code again: the previous
  // suite named evidence_passed/evidence_stale but only asserted
  // evidence_failed, so both could be broken with the suite still green.
  const failed = completion.evaluateCompletion(completionInput({ ok: false, commit: "abc123" }));
  const stale = completion.evaluateCompletion(completionInput({ ok: true, commit: "old000" }));
  assert.notStrictEqual(
    failed.reasons.join(","),
    stale.reasons.join(","),
    "evidence_failed and evidence_stale must be distinguishable verdicts"
  );
  assert.strictEqual(failed.checks.evidence_passed, false);
  assert.strictEqual(stale.checks.evidence_passed, false);
});

if (failures > 0) {
  process.exit(1);
} else {
  console.log("domain evidence tests OK");
  process.exit(0);
}
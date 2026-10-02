#!/usr/bin/env node
"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const cp = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const EVIDENCE_RECORD = path.join(ROOT, "bundle/hooks/lib/evidence-record.js");
const EVIDENCE_RUNNER = path.join(ROOT, "bundle/hooks/lib/evidence-runner.js");

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

test("evidence-record module exists (RED first)", () => {
  assert.ok(fs.existsSync(EVIDENCE_RECORD), "evidence-record.js must exist");
});

const record = require(EVIDENCE_RECORD);
test("exports constants and functions", () => {
  assert.strictEqual(typeof record.EXCERPT_MAX, "number");
  assert.strictEqual(typeof record.buildEvidenceRecord, "function");
  assert.strictEqual(typeof record.evidenceDigest, "function");
});

test("buildEvidenceRecord returns expected shape", () => {
  const rec = record.buildEvidenceRecord({
    gate: "tests",
    command: "node",
    args: ["-e", "console.log('hi')"],
    cwd: "/tmp",
    exitCode: 0,
    ok: true,
    stdout: "hello world",
    stderr: "",
    startedAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
    endedAt: new Date("2026-01-01T00:00:05.250Z").toISOString(),
  });
  assert.strictEqual(rec.gate, "tests");
  assert.strictEqual(rec.command, "node");
  assert.deepStrictEqual(rec.args, ["-e", "console.log('hi')"]);
  assert.strictEqual(rec.exitCode, 0);
  assert.strictEqual(typeof rec.durationMs, "number");
  assert.strictEqual(rec.ok, true);
  assert.strictEqual(rec.stdoutExcerpt, "hello world");
  assert.strictEqual(rec.stderrExcerpt, "");
  assert.ok(typeof rec.startedAt === "string");
});

test("excerpts truncated to EXCERPT_MAX", () => {
  const long = "x".repeat(record.EXCERPT_MAX + 100);
  const rec = record.buildEvidenceRecord({
    gate: "build",
    command: "echo",
    args: [],
    exitCode: 1,
    ok: false,
    stdout: long,
    stderr: long,
    startedAt: new Date().toISOString(),
    endedAt: new Date(Date.now() + 10).toISOString(),
  });
  assert.strictEqual(rec.stdoutExcerpt.length, record.EXCERPT_MAX);
  assert.strictEqual(rec.stderrExcerpt.length, record.EXCERPT_MAX);
});

test("exitCode numeric or null on spawn error", () => {
  const rec = record.buildEvidenceRecord({
    gate: "lint",
    command: "badcmd_xyz",
    args: [],
    exitCode: null,
    ok: false,
    stdout: "",
    stderr: "",
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
  });
  assert.strictEqual(rec.exitCode, null);
});

test("evidenceDigest is stable over sorted gates", () => {
  const d1 = record.evidenceDigest([
    { gate: "tests", exitCode: 0 },
    { gate: "build", exitCode: 0 },
  ]);
  const d2 = record.evidenceDigest([
    { gate: "build", exitCode: 0 },
    { gate: "tests", exitCode: 0 },
  ]);
  assert.strictEqual(d1, d2);
  assert.ok(typeof d1 === "string" && d1.length > 0);
});

if (failures > 0) {
  process.exit(1);
} else {
  console.log("All evidence-runner structure tests passed");
  process.exit(0);
}
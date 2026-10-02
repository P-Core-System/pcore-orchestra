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

// ---------------------------------------------------------------------------
// T4: docs-updated must be derived from the real git diff (audit S-19).
// `evidenceGitClean` used to return ok:true unconditionally, so the
// docs-updated gate never had real evidence behind it.
// ---------------------------------------------------------------------------

const runner = require(EVIDENCE_RUNNER);
let asserts4 = 0;

function ok(cond, msg) {
  asserts4++;
  assert.ok(cond, msg);
}

/** Create a throwaway git repo with one commit containing `files`. */
function gitFixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orchestra-docs-"));
  const git = (args) =>
    cp.spawnSync("git", args, { cwd: dir, encoding: "utf8", stdio: "pipe" });
  assert.strictEqual(git(["init", "-q"]).status, 0, "git init");
  git(["config", "user.email", "test@orchestra.invalid"]);
  git(["config", "user.name", "orchestra test"]);
  git(["config", "commit.gpgsign", "false"]);
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  git(["add", "-A"]);
  assert.strictEqual(git(["commit", "-qm", "base"]).status, 0, "git commit");
  return dir;
}

/**
 * Force `git` to be unspawnable: PATH points at a dir holding a NON-executable
 * file named `git` (execvp yields EACCES → spawnSync sets `error`). Emptying
 * PATH is not enough — execvp falls back to a default path and still finds
 * /usr/bin/git.
 */
function withBrokenGit(fn) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "orchestra-nogitbin-"));
  const fake = path.join(bin, "git");
  fs.writeFileSync(fake, "#!/bin/sh\nexit 0\n", { mode: 0o644 });
  fs.chmodSync(fake, 0o644);
  const savedPath = process.env.PATH;
  process.env.PATH = bin;
  try {
    return fn();
  } finally {
    if (savedPath === undefined) delete process.env.PATH;
    else process.env.PATH = savedPath;
    fs.rmSync(bin, { recursive: true, force: true });
  }
}

test("evidenceDocsUpdated is exported and takes no summary text", () => {
  ok(typeof runner.evidenceDocsUpdated === "function", "evidenceDocsUpdated must be exported");
  ok(
    runner.evidenceDocsUpdated.length === 2,
    "evidenceDocsUpdated(root, state) — no summary argument, so the git diff is the only verdict source"
  );
});

test("DOC_EVIDENCE_PATTERNS covers progress-tracker/context/docs/README", () => {
  ok(Array.isArray(runner.DOC_EVIDENCE_PATTERNS), "DOC_EVIDENCE_PATTERNS must be exported");
  const matches = ["context/progress-tracker.md", "context/architecture.md", "docs/x.md", "README.md"];
  for (const m of matches) {
    ok(
      runner.DOC_EVIDENCE_PATTERNS.some((re) => re.test(m)),
      `pattern set must match ${m}`
    );
  }
  ok(
    !runner.DOC_EVIDENCE_PATTERNS.some((re) => re.test("src/index.js")),
    "src/index.js is not doc evidence"
  );
});

test("worktree progress-tracker.md touch PASSES docs-updated (no summary text)", () => {
  const dir = gitFixture({ "src/app.js": "module.exports = 1;\n" });
  try {
    const tracker = path.join(dir, "context", "progress-tracker.md");
    fs.mkdirSync(path.dirname(tracker), { recursive: true });
    fs.writeFileSync(tracker, "- 2026-10-02 - shipped\n");
    const res = runner.evidenceDocsUpdated(dir, { loopMode: "core" });
    ok(res.gate === "docs-updated", `gate must be docs-updated, got ${res.gate}`);
    ok(res.ok === true, `expected PASS, got FAIL: ${res.details}`);
    ok(res.reason === "docs-touched", `expected reason docs-touched, got ${res.reason}`);
    ok(/progress-tracker\.md/.test(res.details), `details must cite the file: ${res.details}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("committed docs change vs baseCommit PASSES docs-updated", () => {
  const dir = gitFixture({ "src/app.js": "module.exports = 1;\n" });
  try {
    const base = cp
      .spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" })
      .stdout.trim();
    fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
    fs.writeFileSync(path.join(dir, "docs", "notes.md"), "# notes\n");
    cp.spawnSync("git", ["add", "-A"], { cwd: dir, encoding: "utf8" });
    cp.spawnSync("git", ["commit", "-qm", "docs"], { cwd: dir, encoding: "utf8" });
    const res = runner.evidenceDocsUpdated(dir, { baseCommit: base });
    ok(res.ok === true, `expected PASS against baseCommit, got: ${res.details}`);
    ok(/docs\/notes\.md/.test(res.details), `details must cite docs/notes.md: ${res.details}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("no doc-ish file touched FAILS docs-updated", () => {
  const dir = gitFixture({ "src/app.js": "module.exports = 1;\n", "README.md": "# base\n" });
  try {
    fs.writeFileSync(path.join(dir, "src", "app.js"), "module.exports = 2;\n");
    const res = runner.evidenceDocsUpdated(dir, { loopMode: "core" });
    ok(res.gate === "docs-updated", `gate must be docs-updated, got ${res.gate}`);
    ok(res.ok === false, `expected FAIL, got PASS: ${res.details}`);
    ok(res.reason === "no-doc-changes", `expected reason no-doc-changes, got ${res.reason}`);
    ok(!/^SKIPPED:/.test(res.details), "a real repo must never be skipped");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("git failure inside a .git workspace FAILS closed with git-error", () => {
  const dir = gitFixture({ "src/app.js": "module.exports = 1;\n" });
  try {
    const res = withBrokenGit(() => runner.evidenceDocsUpdated(dir, { loopMode: "core" }));
    ok(res.ok === false, `expected FAIL, got: ${res.details}`);
    ok(res.reason === "git-error", `expected reason git-error, got ${res.reason}`);
    ok(/git-error/.test(res.details), `details must name git-error: ${res.details}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("git absent outside a repo SKIPS with an explicit reason", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orchestra-nogit-"));
  try {
    const res = withBrokenGit(() => runner.evidenceDocsUpdated(dir, { loopMode: "core" }));
    ok(res.ok === true, `expected non-blocking skip, got: ${res.details}`);
    ok(res.reason === "skip-no-git", `expected reason skip-no-git, got ${res.reason}`);
    ok(/^SKIPPED:/.test(res.details), `skip must be explicit: ${res.details}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("runEvidenceChecks reports a docs-updated gate in core mode", () => {
  const dir = gitFixture({ "src/app.js": "module.exports = 1;\n" });
  try {
    const { results } = runner.runEvidenceChecks({ loopMode: "core" }, { cwd: dir });
    const docs = results.filter((r) => r.gate === "docs-updated");
    ok(docs.length === 1, `expected exactly one docs-updated result, got ${docs.length}`);
    ok(docs[0].ok === false, "clean non-doc repo must fail docs-updated");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`evidence-runner docs-gate assertions: ${asserts4}`);

// ---------------------------------------------------------------------------
// T10: the docs-updated verdict is decided at the HOOK level (audit B2).
//
// `evidenceDocsUpdated` was unit-tested only. At the hook level a self-reported
// "progress-tracker.md" mention in the run summary (or in
// `memory.files_changed`) called `passGate`, which deletes the gate id from
// `failed` — so a diff-derived FAIL was cleared and the hook reported
// ALL GATES PASSED on a tree where no doc file changed.
// ---------------------------------------------------------------------------

const QUALITY_GATE_HOOK = path.join(ROOT, "bundle/hooks/orchestra-quality-gate.js");

/** Write an active core-loop session state the hook will load. */
function writeHookState(dir, session) {
  const stateDir = path.join(dir, "state");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    path.join(stateDir, "orchestra.json"),
    JSON.stringify({
      version: 3,
      sessions: {
        s1: Object.assign(
          { version: 3, active: true, goal: "hook-level docs gate", loopMode: "core" },
          session
        ),
      },
    })
  );
}

/** Run the quality-gate hook inside `dir` with `payload` on stdin. */
function runQualityGateHook(dir, payload) {
  return cp.spawnSync(process.execPath, [QUALITY_GATE_HOOK], {
    cwd: dir,
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: Object.assign({}, process.env, {
      PCORE_STATE_DIR: path.join(dir, "state"),
      PCORE_SESSION_ID: "s1",
    }),
    timeout: 180000,
  });
}

/** Additional-context block of a hook run, or "" on a broken envelope. */
function hookContext(dir, payload) {
  const r = runQualityGateHook(dir, payload);
  try {
    const parsed = JSON.parse(r.stdout);
    return (parsed && parsed.additional_context) || "";
  } catch {
    return `UNPARSEABLE STDOUT: ${r.stdout}${r.stderr}`;
  }
}

/** `✓/✗/–/○ **<label>**: <STATUS>` line for a gate, plus its reason/details. */
function gateBlock(context, label) {
  const lines = context.split("\n");
  const i = lines.findIndex((l) => l.includes(`**${label}**`));
  if (i === -1) return "";
  return lines.slice(i, i + 3).join("\n");
}

const REVIEWER_PAYLOAD = {
  status: "completed",
  subagent_type: "orchestra-reviewer",
  summary: "Reviewed the change. ORCHESTRA_COMPLETE",
};

test("hook: a summary mentioning progress-tracker.md CANNOT clear a diff-derived FAIL", () => {
  const dir = gitFixture({ "src/app.js": "module.exports = 1;\n" });
  try {
    fs.writeFileSync(path.join(dir, "src", "app.js"), "module.exports = 2;\n");
    writeHookState(dir, { qualityGates: { passed: [], failed: [], skipped: [], allRequiredPassed: false } });
    const ctx = hookContext(dir, Object.assign({}, REVIEWER_PAYLOAD, {
      summary: "Updated context/progress-tracker.md, verified the suite. ORCHESTRA_COMPLETE",
    }));
    ok(ctx !== "", "the hook must emit additional_context for a final review");
    const block = gateBlock(ctx, "Documentation updated");
    ok(/✗/.test(block), `docs-updated must stay FAIL when no doc file changed:\n${block}`);
    ok(/no documentation changed/.test(block), `the diff-derived reason must survive:\n${block}`);
    ok(/GATES NOT CLEARED/.test(ctx), "the hook must not report ALL GATES PASSED on a non-doc diff");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("hook: memory.files_changed mentioning progress-tracker.md CANNOT clear the FAIL either", () => {
  const dir = gitFixture({ "src/app.js": "module.exports = 1;\n" });
  try {
    fs.writeFileSync(path.join(dir, "src", "app.js"), "module.exports = 3;\n");
    writeHookState(dir, {
      memory: { files_changed: ["src/app.js", "context/progress-tracker.md"] },
      qualityGates: { passed: [], failed: [], skipped: [], allRequiredPassed: false },
    });
    const ctx = hookContext(dir, REVIEWER_PAYLOAD);
    const block = gateBlock(ctx, "Documentation updated");
    ok(/✗/.test(block), `memory.files_changed must not clear the FAIL either:\n${block}`);
    ok(/GATES NOT CLEARED/.test(ctx), "the hook must not report ALL GATES PASSED");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("hook: a real doc change in the worktree PASSES docs-updated", () => {
  const dir = gitFixture({ "src/app.js": "module.exports = 1;\n" });
  try {
    const tracker = path.join(dir, "context", "progress-tracker.md");
    fs.mkdirSync(path.dirname(tracker), { recursive: true });
    fs.writeFileSync(tracker, "- shipped\n");
    writeHookState(dir, { qualityGates: { passed: [], failed: [], skipped: [], allRequiredPassed: false } });
    const ctx = hookContext(dir, REVIEWER_PAYLOAD);
    const block = gateBlock(ctx, "Documentation updated");
    ok(/✓/.test(block), `a touched progress-tracker.md must PASS:\n${block}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("hook: a mention may still ADD a pass where evidence produced no verdict (non-git dir)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orchestra-hook-nogit-"));
  try {
    fs.writeFileSync(path.join(dir, "readme.txt"), "hello\n");
    writeHookState(dir, { qualityGates: { passed: [], failed: [], skipped: [], allRequiredPassed: false } });
    const ctx = hookContext(dir, Object.assign({}, REVIEWER_PAYLOAD, {
      summary: "Wrote context/progress-tracker.md by hand. ORCHESTRA_COMPLETE",
    }));
    const block = gateBlock(ctx, "Documentation updated");
    ok(/✓/.test(block), `the additional accept signal must still be able to add a pass:\n${block}`);
    ok(/context\/progress-tracker\.md/.test(block), `the gate detail must name the full path:\n${block}`);
    ok(
      !/(^|[^c])ontext\/progress-tracker\.md/.test(block),
      `the gate detail must not chop the leading character of the path:\n${block}`
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

if (failures > 0) {
  process.exit(1);
} else {
  console.log("All evidence-runner structure tests passed");
  process.exit(0);
}
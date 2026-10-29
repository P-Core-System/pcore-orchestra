#!/usr/bin/env node
"use strict";

/**
 * Cache-safe injection-order gate (workstream E — token/context, 2026-10-29).
 *
 * `sessionStart` injects a two-part block: static context first, volatile state
 * last (`orchestra-session-start.js` → `[...staticParts, ...dynamicParts]`).
 * Prompt-cache providers discount a stable prefix (OpenAI cached-input pricing;
 * Anthropic `cache_control` ~90% off — docs/token-optimization.md §2.5), while
 * compaction only ever helps the churning tail (Zylos "cache vs compaction"
 * framing: cache the stable prefix, compact the dynamic one). A timestamp or
 * run id inside the static prefix changes every session, forfeits the cache on
 * every subsequent call, and defeats §11.2 of docs/token-optimization.md.
 *
 * This test pins three things:
 *   1. the static blocks (AMBIENT_CONTEXT / PARENT_HANDOFF_CONTEXT) AND the
 *      two static text builders that feed staticParts (ctxBlock from
 *      buildContextInjection, pyBlock from buildProjectYamlInjection) are
 *      textually stable — no timestamps, run/session/pid ids, or UUIDs;
 *   2. session-start declares staticParts before dynamicParts and emits them in
 *      that order, with the volatile builders (state/crash, memory, tokens)
 *      feeding only the dynamic tail;
 *   3. orchestra-prompt opens every injected parts array with AMBIENT_CONTEXT.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SESSION_START = path.join(ROOT, "bundle", "hooks", "orchestra-session-start.js");
const PROMPT_HOOK = path.join(ROOT, "bundle", "hooks", "orchestra-prompt.js");

function test(name, fn) {
  try {
    fn();
    console.log(`  ok - ${name}`);
  } catch (err) {
    console.error(`  NOT OK - ${name}`);
    console.error(err && err.message ? err.message : err);
    process.exitCode = 1;
  }
}

console.log("=== test-injection-order.js ===");

const { AMBIENT_CONTEXT, PARENT_HANDOFF_CONTEXT, SIX_FILE_CONTEXT, buildContextInjection, buildProjectYamlInjection } = require(
  path.join(ROOT, "bundle", "hooks", "lib", "context-detector.js")
);

test("static blocks export as non-empty strings", () => {
  assert.equal(typeof AMBIENT_CONTEXT, "string");
  assert.equal(typeof PARENT_HANDOFF_CONTEXT, "string");
  assert.ok(AMBIENT_CONTEXT.trim().length > 0, "AMBIENT_CONTEXT non-empty");
  assert.ok(PARENT_HANDOFF_CONTEXT.trim().length > 0, "PARENT_HANDOFF_CONTEXT non-empty");
});

// Every one of these in the static prefix re-keys the cache each session.
const VOLATILE_PATTERNS = [
  [/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, "ISO timestamp"],
  [/\b\d{4}-\d{2}-\d{2}\b/, "date stamp"],
  [/\brun-[a-z0-9]+\b/, "run id"],
  [/\bpid-\d+\b/, "pid"],
  [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, "UUID"],
  [/\bsession[_-]?id\b/i, "session id"],
];

for (const [re, label] of VOLATILE_PATTERNS) {
  test(`static blocks contain no ${label}`, () => {
    assert.ok(!re.test(AMBIENT_CONTEXT), `AMBIENT_CONTEXT must not contain a ${label}`);
    assert.ok(!re.test(PARENT_HANDOFF_CONTEXT), `PARENT_HANDOFF_CONTEXT must not contain a ${label}`);
  });
}

// §11.2 also lists ctxBlock and pyBlock as static — the two pure builders that
// feed staticParts in session-start. They are deterministic text builders (no
// Date.now(), run/session/pid ids, or UUIDs — verified against their sources),
// so the same volatile-pattern scan applies to representative outputs.
const ctxFixture = {
  root: path.join("some", "root"),
  contextDir: "context",
  entryPoint: "AGENTS.md",
  foundCount: SIX_FILE_CONTEXT.length,
  totalCount: SIX_FILE_CONTEXT.length,
  files: SIX_FILE_CONTEXT.map(({ file }) => ({ file, exists: true })),
};
const identityFixture = {
  project: { name: "demo", display_name: "Demo", type: "app" },
  version: { current: "1.0.0", channel: "stable" },
  lifecycle: { stage: "development", status: "active" },
  stack: { languages: ["javascript"], frameworks: [] },
  team: {},
  environments: {},
};
const ctxBlockFixture = buildContextInjection(ctxFixture);
const pyBlockFixture = buildProjectYamlInjection(identityFixture);

test("ctxBlock and pyBlock builders emit non-empty static text", () => {
  assert.equal(typeof ctxBlockFixture, "string");
  assert.equal(typeof pyBlockFixture, "string");
  assert.ok(ctxBlockFixture.trim().length > 0, "ctxBlock non-empty");
  assert.ok(pyBlockFixture.trim().length > 0, "pyBlock non-empty");
});

for (const [re, label] of VOLATILE_PATTERNS) {
  test(`ctxBlock and pyBlock contain no ${label}`, () => {
    assert.ok(!re.test(ctxBlockFixture), `ctxBlock must not contain a ${label}`);
    assert.ok(!re.test(pyBlockFixture), `pyBlock must not contain a ${label}`);
  });
}

const sessionSrc = fs.readFileSync(SESSION_START, "utf8");
const promptSrc = fs.readFileSync(PROMPT_HOOK, "utf8");

test("session-start declares staticParts before dynamicParts", () => {
  const staticIdx = sessionSrc.indexOf("const staticParts = [AMBIENT_CONTEXT, PARENT_HANDOFF_CONTEXT]");
  const dynamicIdx = sessionSrc.indexOf("const dynamicParts = []");
  assert.ok(staticIdx > -1, "staticParts declared with the stable blocks");
  assert.ok(dynamicIdx > -1, "dynamicParts declared");
  assert.ok(staticIdx < dynamicIdx, "static prefix is assembled before the dynamic tail");
});

test("session-start emits [...staticParts, ...dynamicParts] (static first)", () => {
  const spreadIdx = sessionSrc.indexOf("[...staticParts, ...dynamicParts]");
  assert.ok(spreadIdx > -1, "emit spreads static before dynamic");
  assert.ok(
    sessionSrc.indexOf("const staticParts") < spreadIdx &&
      sessionSrc.indexOf("const dynamicParts") < spreadIdx,
    "both arrays exist before the emit"
  );
  // Static pushes must all land before the dynamic tail is declared.
  const lastStaticPush = sessionSrc.lastIndexOf("staticParts.push");
  assert.ok(lastStaticPush > -1, "static parts are pushed conditionally");
  assert.ok(
    lastStaticPush < sessionSrc.indexOf("const dynamicParts = []"),
    "no static push happens after the dynamic tail starts"
  );
});

test("session-start: memory and token context feed only the dynamic tail", () => {
  const dynamicIdx = sessionSrc.indexOf("const dynamicParts = []");
  const memIdx = sessionSrc.indexOf("const memCtx = buildMemoryContext");
  const tokenIdx = sessionSrc.indexOf("const tokenCtx = buildTokenContextForSession");
  const crashIdx = sessionSrc.indexOf("const crash = detectCrashRecovery");
  assert.ok(memIdx > dynamicIdx, "memory context appended to dynamicParts");
  assert.ok(tokenIdx > dynamicIdx, "token context appended to dynamicParts");
  assert.ok(crashIdx > dynamicIdx, "crash/state lines appended to dynamicParts");
  assert.ok(
    sessionSrc.indexOf("if (memCtx) dynamicParts.push") > -1,
    "memory ctx pushes into dynamicParts"
  );
  assert.ok(
    sessionSrc.indexOf("if (tokenCtx) dynamicParts.push") > -1,
    "token ctx pushes into dynamicParts"
  );
});

test("orchestra-prompt: every parts array opens with AMBIENT_CONTEXT", () => {
  const opens = (promptSrc.match(/parts = \[\s*AMBIENT_CONTEXT/g) || []).length;
  const total = (promptSrc.match(/parts = \[/g) || []).length;
  assert.ok(total >= 4, `expected the known parts arrays, found ${total}`);
  assert.equal(opens, total, "every parts array starts with the stable ambient block");
});

test("orchestra-prompt: resume/status emits keep AMBIENT_CONTEXT first", () => {
  const arrayEmits = (promptSrc.match(/additional_context: \[\s*AMBIENT_CONTEXT/g) || []).length;
  assert.ok(arrayEmits >= 2, `resume paths emit the stable block first (found ${arrayEmits})`);
});

if (!process.exitCode) {
  console.log("\nAll injection-order tests passed.");
}

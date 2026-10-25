#!/usr/bin/env node
/**
 * test-opencode-v2.js — V1 → V2 opencode.json migration suite.
 *
 * Part 1 (always runs): unit assertions per migration rule + idempotency +
 * CLI smoke (dry-run / --apply / backup).
 *
 * Part 2 (oracle, auto-skipped without the `opencode` binary): round-trips a
 * fixture through migrateConfig(), writes it to an isolated fake HOME, and
 * asserts `opencode debug config` normalizes the migrated V2 file IDENTICALLY
 * to the original V1 file. That is the behavior-preserving proof.
 *
 * Run: node scripts/test-opencode-v2.js
 *      ORACLE=0 node scripts/test-opencode-v2.js   # unit tests only
 */
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const {
  migrateConfig,
  flattenPermissions,
  permissionReplaceActions,
} = require("./lib/opencode-v2.js");

const ROOT = path.resolve(__dirname, "..");
let passed = 0;
let failed = 0;

function t(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL - ${name}`);
    console.error(`  ${err && err.message ? err.message.split("\n").join("\n  ") : err}`);
  }
}

function j(v) {
  return JSON.parse(JSON.stringify(v));
}

/* ─────────────────────────── Part 1: unit rules ─────────────────────────── */

t("permission flatten: scalar + nested groups, key order preserved", () => {
  const out = flattenPermissions({
    "*": "allow",
    doom_loop: "deny",
    read: { "*": "allow", "*.env": "deny" },
    bash: { "*": "allow", "git push --force *": "deny" },
    task: "deny",
  });
  assert.deepStrictEqual(out, [
    { action: "*", resource: "*", effect: "allow" },
    { action: "doom_loop", resource: "*", effect: "deny" },
    { action: "read", resource: "*", effect: "allow" },
    { action: "read", resource: "*.env", effect: "deny" },
    { action: "shell", resource: "*", effect: "allow" },
    { action: "shell", resource: "git push --force *", effect: "deny" },
    { action: "subagent", resource: "*", effect: "deny" },
  ]);
});

t("permission flatten: already-V2 array passes through", () => {
  const arr = [{ action: "shell", resource: "*", effect: "deny" }];
  assert.deepStrictEqual(flattenPermissions(arr), arr);
});

t("permissionReplaceActions: spread semantics (in-place group replace)", () => {
  const base = [
    { action: "*", resource: "*", effect: "allow" },
    { action: "shell", resource: "ls", effect: "allow" },
    { action: "read", resource: "*", effect: "deny" },
  ];
  const patch = [
    { action: "shell", resource: "rm *", effect: "deny" },
    { action: "doom_loop", resource: "*", effect: "deny" },
  ];
  const out = permissionReplaceActions(base, patch);
  assert.deepStrictEqual(out, [
    { action: "*", resource: "*", effect: "allow" },
    { action: "shell", resource: "rm *", effect: "deny" }, // in-place
    { action: "read", resource: "*", effect: "deny" },
    { action: "doom_loop", resource: "*", effect: "deny" }, // new → appended
  ]);
});

t("root renames: autoupdate→update, snapshot→snapshots", () => {
  const out = migrateConfig({ autoupdate: "notify", snapshot: false });
  assert.strictEqual(out.update, "notify");
  assert.strictEqual(out.snapshots, false);
  assert.ok(!("autoupdate" in out) && !("snapshot" in out));
});

t("compaction: reserved→buffer, preserve_recent_tokens→keep.tokens, prune/tail dropped", () => {
  const out = migrateConfig({
    compaction: { auto: true, prune: true, reserved: 6000, tail_turns: 12, preserve_recent_tokens: 4000 },
  });
  assert.deepStrictEqual(out.compaction, { auto: true, keep: { tokens: 4000 }, buffer: 6000 });
});

t("enabled_providers → experimental.policies (deny-all first, then allow)", () => {
  const out = migrateConfig({ enabled_providers: ["opencode"] });
  assert.deepStrictEqual(out.experimental.policies, [
    { action: "provider.use", resource: "*", effect: "deny" },
    { action: "provider.use", resource: "opencode", effect: "allow" },
  ]);
  assert.ok(!("enabled_providers" in out));
});

t("mcp → mcp.servers with enabled→disabled inversion + timeout split", () => {
  const out = migrateConfig({
    mcp: {
      neon: { type: "remote", url: "https://x", enabled: false },
      cf: { type: "remote", url: "https://y", enabled: true, timeout: 5000 },
      plain: { type: "local", command: "npx" },
    },
  });
  assert.deepStrictEqual(out.mcp.servers.neon, { type: "remote", url: "https://x", disabled: true });
  assert.deepStrictEqual(out.mcp.servers.cf, {
    type: "remote",
    url: "https://y",
    timeout: { startup: 5000, catalog: 5000, execution: 5000 },
    disabled: false,
  });
  assert.deepStrictEqual(out.mcp.servers.plain, { type: "local", command: "npx" });
  assert.ok(!("enabled" in out.mcp.servers.neon));
});

t("mcp legacy partial timeout (pre-startup migrator shape) backfills startup", () => {
  const legacy = migrateConfig({
    mcp: { servers: { cf: { type: "remote", url: "https://y", timeout: { catalog: 5000, execution: 5000 } } } },
  });
  assert.deepStrictEqual(legacy.mcp.servers.cf.timeout, { catalog: 5000, execution: 5000, startup: 5000 });
  // Idempotent: re-migrating the healed config does not change it
  assert.deepStrictEqual(migrateConfig(legacy).mcp.servers.cf.timeout, { catalog: 5000, execution: 5000, startup: 5000 });
  // execution-only partial heals too; explicit startup is never touched
  const execOnly = migrateConfig({ mcp: { servers: { s: { timeout: { execution: 9000 } } } } });
  assert.deepStrictEqual(execOnly.mcp.servers.s.timeout, { execution: 9000, startup: 9000 });
  const kept = migrateConfig({ mcp: { servers: { s: { timeout: { startup: 7000 } } } } });
  assert.deepStrictEqual(kept.mcp.servers.s.timeout, { startup: 7000 });
});

t("provider → providers: npm→package (aisdk:), options→settings, variants→array, id→modelID", () => {
  const out = migrateConfig({
    provider: {
      "opencode-free-zen": {
        npm: "@ai-sdk/openai-compatible",
        name: "ZenFree",
        options: { baseURL: "https://opencode.ai/zen/v1" },
        models: { m1: { id: "inner", variants: { fast: { reasoningEffort: "low" } } } },
      },
    },
  });
  const p = out.providers["opencode-free-zen"];
  assert.strictEqual(p.package, "aisdk:@ai-sdk/openai-compatible");
  assert.deepStrictEqual(p.settings, { baseURL: "https://opencode.ai/zen/v1" });
  assert.strictEqual(p.name, "ZenFree");
  assert.deepStrictEqual(p.models.m1, {
    modelID: "inner",
    variants: [{ id: "fast", settings: { reasoningEffort: "low" } }],
  });
  assert.ok(!("npm" in p) && !("options" in p));
});

t("small_model → agents.title.model", () => {
  const out = migrateConfig({ small_model: "opencode/big-pickle" });
  assert.strictEqual(out.agents.title.model, "opencode/big-pickle");
  assert.ok(!("small_model" in out));
});

t("agent + small_model merge into a single `agents` object", () => {
  const out = migrateConfig({
    small_model: "opencode/big-pickle",
    agent: { orchestra: { description: "d", mode: "primary" } },
  });
  assert.deepStrictEqual(Object.keys(out.agents).sort(), ["orchestra", "title"]);
});

t("agent field mapping: body moves, prompt→system, maxSteps→steps, disable→disabled", () => {
  const out = migrateConfig({
    agent: {
      test: {
        description: "d",
        mode: "subagent",
        model: "opencode/big-pickle",
        variant: "fast",
        prompt: "You are x",
        maxSteps: 42,
        disable: true,
        hidden: true,
        temperature: 0.3,
        reasoningEffort: "high",
        textVerbosity: "high",
        reference: { docs: "./README.md" },
        some_unknown_key: 123,
        permission: { bash: { "git push *": "deny" }, task: { "*": "allow" }, read: "deny" },
      },
    },
  });
  const a = out.agents.test;
  assert.strictEqual(a.model, "opencode/big-pickle#fast");
  assert.strictEqual(a.system, "You are x");
  assert.strictEqual(a.steps, 42);
  assert.strictEqual(a.disabled, true);
  assert.strictEqual(a.hidden, true);
  assert.strictEqual(a.description, "d");
  assert.strictEqual(a.mode, "subagent");
  assert.deepStrictEqual(a.request.body, {
    temperature: 0.3,
    reasoningEffort: "high",
    textVerbosity: "high",
    reference: { docs: "./README.md" },
    some_unknown_key: 123,
  });
  assert.deepStrictEqual(a.permissions, [
    { action: "shell", resource: "git push *", effect: "deny" },
    { action: "subagent", resource: "*", effect: "allow" },
    { action: "read", resource: "*", effect: "deny" },
  ]);
  assert.ok(!("prompt" in a) && !("maxSteps" in a) && !("disable" in a) && !("permission" in a));
});

t("agent already-V2 entry passes through unchanged (idempotent shape)", () => {
  const v2 = {
    request: { body: { reasoningEffort: "low", temperature: 0.1 } },
    description: "d",
    mode: "subagent",
    steps: 9,
    disabled: false,
    hidden: true,
    permissions: [{ action: "shell", resource: "*", effect: "allow" }],
    system: "hi",
    model: "opencode/x",
  };
  const out = migrateConfig({ agents: { t: j(v2) } });
  assert.deepStrictEqual(out.agents.t, v2);
});

t("hooks dropped, skills object→array, command→commands, tool_output passthrough", () => {
  const out = migrateConfig({
    hooks: { sessionStart: ["./x.js"] },
    skills: { allow: ["foo"] },
    command: { hello: { template: "say hi" } },
    tool_output: { max_lines: 300, max_bytes: 12288 },
  });
  assert.ok(!("hooks" in out));
  assert.deepStrictEqual(out.skills, []);
  assert.deepStrictEqual(out.commands, { hello: { template: "say hi" } });
  assert.deepStrictEqual(out.tool_output, { max_lines: 300, max_bytes: 12288 });
});

t("instructions: array passthrough, object form dropped (runtime rejects it)", () => {
  const arr = ["AGENTS.md", "context/architecture.md"];
  const outArr = migrateConfig({ instructions: arr });
  assert.deepStrictEqual(outArr.instructions, arr);
  const outObj = migrateConfig({ instructions: { context: ["a"], monorepo: { exclude: ["b"] } } });
  assert.ok(!("instructions" in outObj));
});

t("passthrough keys: $schema, model, default_agent, watcher", () => {
  const out = migrateConfig({
    $schema: "https://opencode.ai/config.json",
    model: "opencode/big-pickle",
    default_agent: "orchestra",
    watcher: { ignore: ["node_modules/**"] },
  });
  assert.strictEqual(out.$schema, "https://opencode.ai/config.json");
  assert.strictEqual(out.model, "opencode/big-pickle");
  assert.strictEqual(out.default_agent, "orchestra");
  assert.deepStrictEqual(out.watcher, { ignore: ["node_modules/**"] });
});

t("idempotency: migrate(migrate(x)) === migrate(x) on kitchen-sink V1", () => {
  const sink = {
    $schema: "https://opencode.ai/config.json",
    model: "opencode/big-pickle",
    small_model: "opencode/big-pickle",
    autoupdate: "notify",
    snapshot: false,
    instructions: ["AGENTS.md"],
    compaction: { auto: true, prune: true, reserved: 6000, tail_turns: 12, preserve_recent_tokens: 4000 },
    enabled_providers: ["opencode"],
    hooks: { stop: ["./s.js"] },
    skills: { dir: ["./skills"] },
    command: { hi: { template: "hi" } },
    tool_output: { max_lines: 1 },
    permission: { "*": "allow", bash: { "*": "deny" }, task: "deny" },
    mcp: { a: { type: "remote", url: "https://z", enabled: false, timeout: 1000 } },
    provider: { px: { npm: "@ai-sdk/openai-compatible", options: { baseURL: "u" }, models: { m: { id: "i", variants: { fast: { x: 1 } } } } } },
    agent: {
      orchestra: {
        description: "d",
        mode: "primary",
        reasoningEffort: "low",
        textVerbosity: "low",
        steps: 500,
        permission: { task: { "*": "deny" }, bash: "allow", skill: { "*": "deny", x: "allow" } },
      },
      title: { model: "opencode/big-pickle" },
    },
    default_agent: "orchestra",
    watcher: { ignore: ["n/**"] },
    unknown_root: { keep: true },
  };
  const once = migrateConfig(sink);
  const twice = migrateConfig(j(once));
  assert.deepStrictEqual(twice, j(once));
});

t("V1 + V2 keys coexisting resolve without duplication", () => {
  const out = migrateConfig({
    snapshot: false,
    snapshots: false,
    agent: { a: { description: "d" } },
    agents: { b: { description: "e" } },
    permission: { "*": "allow" },
    permissions: [{ action: "*", resource: "*", effect: "allow" }],
  });
  assert.deepStrictEqual(Object.keys(out.agents).sort(), ["a", "b"]);
  assert.strictEqual(out.snapshots, false);
  assert.ok(!("snapshot" in out) && !("agent" in out) && !("permission" in out));
  assert.strictEqual(out.permissions.length, 1);
});

/* ───────────────── Part 1b: real repo fixtures ───────────────── */

t("autonomy.json migrates to V2 (no V1 keys remain)", () => {
  const autonomy = JSON.parse(
    fs.readFileSync(path.join(ROOT, "bundle", "config", "opencode", "autonomy.json"), "utf8")
  );
  const out = migrateConfig(autonomy);
  for (const bad of ["snapshot", "agent", "permission", "provider", "small_model", "hooks", "compaction"]) {
    if (bad === "compaction") continue;
    assert.ok(!(bad in out), `autonomy V2 still has ${bad}`);
  }
  assert.ok(out.agents && out.agents.orchestra, "agents.orchestra missing");
  assert.ok(out.providers, "providers missing");
  assert.ok(Array.isArray(out.permissions) && out.permissions.length > 0);
  assert.strictEqual(out.compaction.buffer, 6000);
  assert.ok(!("prune" in out.compaction));
  const twice = migrateConfig(j(out));
  assert.deepStrictEqual(twice, j(out));
});

/* ─────────────── Part 1c: CLI (migrate-opencode-v2.js) ─────────────── */

t("CLI: dry-run leaves file untouched; --apply migrates + backs up", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oc-mig-"));
  const file = path.join(dir, "opencode.json");
  fs.writeFileSync(
    file,
    JSON.stringify({ $schema: "https://opencode.ai/config.json", snapshot: false, autoupdate: "notify" }, null, 2)
  );
  const before = fs.readFileSync(file, "utf8");
  const cli = path.join(__dirname, "migrate-opencode-v2.js");
  const dry = spawnSync(process.execPath, [cli, "--file", file], { encoding: "utf8" });
  assert.strictEqual(dry.status, 0, `dry-run failed: ${dry.stderr}`);
  assert.strictEqual(fs.readFileSync(file, "utf8"), before, "dry-run mutated the file");
  const apply = spawnSync(process.execPath, [cli, "--file", file, "--apply"], { encoding: "utf8" });
  assert.strictEqual(apply.status, 0, `--apply failed: ${apply.stderr}`);
  const after = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.strictEqual(after.snapshots, false);
  assert.strictEqual(after.update, "notify");
  assert.ok(!("snapshot" in after) && !("autoupdate" in after));
  const backups = fs.readdirSync(dir).filter((f) => f.startsWith("opencode.json.bak"));
  assert.ok(backups.length >= 1, "no backup created");
  fs.rmSync(dir, { recursive: true, force: true });
});

t("CLI: already-V2 file is a no-op (idempotent, exit 0)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oc-mig2-"));
  const file = path.join(dir, "opencode.json");
  fs.writeFileSync(file, JSON.stringify({ snapshots: false, update: "notify" }, null, 2) + "\n");
  const cli = path.join(__dirname, "migrate-opencode-v2.js");
  const r = spawnSync(process.execPath, [cli, "--file", file, "--apply"], { encoding: "utf8" });
  assert.strictEqual(r.status, 0, `apply failed: ${r.stderr}`);
  const after = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepStrictEqual(after, { snapshots: false, update: "notify" });
  fs.rmSync(dir, { recursive: true, force: true });
});

/* ───────── Part 2: oracle equivalence (needs `opencode` binary) ───────── */

function hasOpenCode() {
  const r = spawnSync("opencode", ["--version"], { encoding: "utf8" });
  return r.status === 0;
}

function debugConfig(home) {
  const out = execFileSync("opencode", ["debug", "config"], {
    env: { ...process.env, HOME: home },
    encoding: "utf8",
    timeout: 90000,
    maxBuffer: 32 * 1024 * 1024,
  });
  const layers = JSON.parse(out);
  const doc = layers.find((l) => l.type === "document" && l.info);
  if (!doc) throw new Error("no document layer in opencode debug config");
  return doc.info;
}

let oraclePortCursor = 0;

function normalizeWithOpenCode(cfg, label) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "oc-oracle-"));
  const cfgDir = path.join(home, ".config", "opencode");
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(path.join(cfgDir, "opencode.json"), JSON.stringify(cfg, null, 2));
  oraclePortCursor += 1;
  const port = 44000 + ((process.pid + oraclePortCursor) % 1000) * 2;
  fs.writeFileSync(path.join(cfgDir, "service.json"), JSON.stringify({ port }));
  try {
    return debugConfig(home);
  } finally {
    try {
      execFileSync("opencode", ["service", "stop"], {
        env: { ...process.env, HOME: home },
        encoding: "utf8",
        timeout: 30000,
        stdio: "ignore",
      });
    } catch {
      /* best-effort */
    }
    try {
      fs.rmSync(home, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}

function oracleRoundTrip(cfg, label) {
  let normV1;
  try {
    normV1 = normalizeWithOpenCode(cfg, label);
  } catch (err) {
    // Baseline itself cannot be normalized (tooling/environment issue) — skip,
    // do not fail the suite.
    console.warn(`  (skip oracle ${label}: cannot normalize V1 baseline: ${err.message.split("\n")[0]})`);
    return;
  }
  const migrated = migrateConfig(j(cfg));
  let normV2;
  try {
    normV2 = normalizeWithOpenCode(migrated, label);
  } catch (err) {
    // V1 normalized but the migrated V2 file does not — that is a real defect.
    throw new Error(`${label}: migrated V2 config failed to normalize: ${err.message}`);
  }
  assert.deepStrictEqual(
    normV2,
    normV1,
    `${label}: normalize(migrated V2) !== normalize(original V1)`
  );
}

const ORACLE_ENABLED = process.env.ORACLE !== "0" && hasOpenCode();

t("oracle: live ~/.config/opencode/opencode.json round-trips behavior-identically", () => {
  if (!ORACLE_ENABLED) {
    console.log("  (skip: opencode binary unavailable or ORACLE=0)");
    return;
  }
  const live = JSON.parse(
    fs.readFileSync(path.join(os.homedir(), ".config", "opencode", "opencode.json"), "utf8")
  );
  oracleRoundTrip(live, "live-config");
});

t("oracle: autonomy.json round-trips behavior-identically", () => {
  if (!ORACLE_ENABLED) {
    console.log("  (skip: opencode binary unavailable or ORACLE=0)");
    return;
  }
  const autonomy = JSON.parse(
    fs.readFileSync(path.join(ROOT, "bundle", "config", "opencode", "autonomy.json"), "utf8")
  );
  oracleRoundTrip(autonomy, "autonomy");
});

t("oracle: kitchen-sink V1 fixture round-trips behavior-identically", () => {
  if (!ORACLE_ENABLED) {
    console.log("  (skip: opencode binary unavailable or ORACLE=0)");
    return;
  }
  const sink = {
    $schema: "https://opencode.ai/config.json",
    model: "opencode/big-pickle",
    small_model: "opencode/big-pickle",
    autoupdate: "notify",
    snapshot: false,
    instructions: ["AGENTS.md", "CLAUDE.md", "context/architecture.md"],
    compaction: { auto: true, prune: true, reserved: 6000, tail_turns: 12, preserve_recent_tokens: 4000 },
    enabled_providers: ["opencode"],
    hooks: { stop: ["./s.js"] },
    skills: { dir: ["./skills"] },
    command: { hi: { template: "hi" } },
    tool_output: { max_lines: 300, max_bytes: 12288 },
    permission: {
      "*": "allow",
      doom_loop: "deny",
      read: { "*": "allow", "*.env": "deny" },
      bash: { "*": "allow", "rm -rf *": "deny" },
      task: { "*": "deny", "orchestra-*": "allow" },
      skill: { "*": "deny", "orchestra-loop": "allow" },
    },
    mcp: {
      neon: { type: "remote", url: "https://mcp.neon.tech/mcp", enabled: false },
      cf: { type: "remote", url: "https://x", enabled: true, timeout: 5000 },
    },
    provider: {
      "opencode-free-zen": {
        npm: "@ai-sdk/openai-compatible",
        name: "ZenFree",
        options: { baseURL: "https://opencode.ai/zen/v1" },
        models: { m1: { id: "inner", variants: { fast: { reasoningEffort: "low" } } } },
      },
      opencode: { models: { "big-pickle": { variants: { fast: { reasoningEffort: "low", textVerbosity: "low" } } } } },
    },
    agent: {
      orchestra: {
        description: "d",
        mode: "primary",
        reasoningEffort: "low",
        textVerbosity: "low",
        temperature: 0.2,
        steps: 500,
        prompt: "Conduct.",
        permission: { task: { "*": "deny", "orchestra-*": "allow" }, bash: "allow", edit: "deny", skill: { "*": "deny", x: "allow" } },
      },
      phase: { mode: "subagent", hidden: true, maxSteps: 12, disable: true, variant: "fast", model: "opencode/big-pickle", unknown_body_key: { a: 1 } },
      // note: no `title` agent here — small_model alone owns title; the V1
      // runtime tie-break between agent.title and small_model is unspecified.
    },
    default_agent: "orchestra",
    watcher: { ignore: ["node_modules/**"] },
    unknown_root: { keep: true },
  };
  oracleRoundTrip(sink, "kitchen-sink");
});

/* ───────────────────────────── summary ───────────────────────────── */

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

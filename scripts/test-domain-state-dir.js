#!/usr/bin/env node
"use strict";

/**
 * Suite for the domain store's DEFAULT state dir (defect: `store.js` resolved
 * `../state/domain-*.json` from `lib/domain/`, i.e. `bundle/hooks/lib/state/`
 * — inside the shipped bundle. A run without `PCORE_STATE_DIR` therefore wrote
 * a real runtime artifact into the repo, and `.gitignore` (which only covered
 * `bundle/hooks/state/domain-*.json`) was one level too shallow to hide it.
 *
 * Focus:
 *   - the default dir is OUTSIDE the bundle tree (`~/.config/opencode/hooks/state`)
 *   - `PCORE_STATE_DIR` still overrides it (the existing suites rely on it)
 *   - a real store write leaves `git status --porcelain` empty
 *
 * Fixtures live in os.tmpdir() and are removed afterwards.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const DOMAIN = path.join(ROOT, "bundle", "hooks", "lib", "domain");
const STORE = path.join(DOMAIN, "store.js");

let failures = 0;
let asserts = 0;
const tmpDirs = [];

function test(name, fn) {
  try {
    fn();
    console.log("PASS", name);
  } catch (e) {
    failures++;
    console.error("FAIL", name, e && e.message);
  }
}

function ok(cond, msg) {
  asserts++;
  assert.ok(cond, msg);
}

function eq(a, b, msg) {
  asserts++;
  assert.strictEqual(a, b, msg);
}

function tmpdir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

process.on("exit", () => {
  for (const d of tmpDirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

const store = require(STORE);
const entities = require(path.join(DOMAIN, "entities.js"));

/** True when `child` lives inside `parent`. */
function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

const home = tmpdir("orchestra-state-home-");
const previousHome = process.env.HOME;
const previousStateDir = process.env.PCORE_STATE_DIR;

test("the default state dir is outside the bundle tree", () => {
  delete process.env.PCORE_STATE_DIR;
  process.env.HOME = home;
  const eventsPath = store.domainEventsPath();
  const checkpoint = store.checkpointPath();
  ok(
    !isInside(path.join(ROOT, "bundle"), eventsPath),
    `the default events path must not live inside bundle/, got ${eventsPath}`
  );
  ok(
    !isInside(path.join(ROOT, "bundle"), checkpoint),
    `the default checkpoint path must not live inside bundle/, got ${checkpoint}`
  );
  ok(
    !isInside(path.join(ROOT, "bundle", "hooks", "lib"), eventsPath),
    `the default events path must not live inside lib/, got ${eventsPath}`
  );
});

test("the default state dir sits under ~/.config/opencode/hooks/state", () => {
  delete process.env.PCORE_STATE_DIR;
  process.env.HOME = home;
  const expected = path.join(home, ".config", "opencode", "hooks", "state");
  eq(store.domainEventsPath(), path.join(expected, "domain-events.json"), "events file must sit in the shared state dir");
  eq(store.checkpointPath(), path.join(expected, "domain-checkpoint.json"), "checkpoint file must sit in the shared state dir");
});

test("PCORE_STATE_DIR still overrides the default", () => {
  const override = tmpdir("orchestra-state-override-");
  process.env.PCORE_STATE_DIR = override;
  eq(store.domainEventsPath(), path.join(override, "domain-events.json"), "PCORE_STATE_DIR must win over the default dir");
  eq(store.checkpointPath(), path.join(override, "domain-checkpoint.json"), "PCORE_STATE_DIR must win over the default dir");
  delete process.env.PCORE_STATE_DIR;
});

test("a store write with no PCORE_STATE_DIR leaves the repo git-clean", () => {
  process.env.HOME = home;
  delete process.env.PCORE_STATE_DIR;
  const gitStatus = () =>
    cp
      .spawnSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" })
      .stdout.split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .sort();
  const before = gitStatus();
  const probe = cp.spawnSync("git", ["rev-parse", "--git-dir"], { cwd: ROOT, encoding: "utf8" });
  eq(probe.error, undefined, `git must be runnable for this assertion: ${probe.error && probe.error.message}`);

  store.appendEvent(entities.createEvent({ type: "phase.outcome", payload: { decision: "advance" } }));
  store.saveCheckpoint({ sessionId: "state-dir-suite", ticketId: "tkt-state-dir" });

  const expected = path.join(home, ".config", "opencode", "hooks", "state");
  ok(
    fs.existsSync(path.join(expected, "domain-events.json")),
    `the events file must land in the shared state dir, got ${store.domainEventsPath()}`
  );
  ok(
    !fs.existsSync(path.join(ROOT, "bundle", "hooks", "lib", "state")),
    "no runtime artifact may be created inside bundle/hooks/lib/state"
  );

  const after = gitStatus();
  eq(
    JSON.stringify(after),
    JSON.stringify(before),
    `a store write must add nothing to git status, added:\n${JSON.stringify(after.filter((l) => !before.includes(l)), null, 2)}`
  );
});

test("store.js no longer resolves a state path relative to __dirname", () => {
  const src = fs.readFileSync(STORE, "utf8");
  ok(!/__dirname\s*,\s*["']\.\.["']\s*,\s*["']state["']/.test(src), "store.js must not build a state path from __dirname/../state");
  ok(/resolveStateDir\s*\(/.test(src), "store.js must resolve the default dir through safe-write resolveStateDir");
});

test(".gitignore covers the domain artifacts at BOTH depths", () => {
  const ignored = cp.spawnSync("git", ["check-ignore", "-q", "bundle/hooks/lib/state/domain-events.json"], { cwd: ROOT });
  eq(ignored.status, 0, "bundle/hooks/lib/state/ must be ignored (defence in depth)");
  const ignoredMirror = cp.spawnSync(
    "git",
    ["check-ignore", "-q", "bundle/opencode/hooks/lib/state/domain-checkpoint.json"],
    { cwd: ROOT }
  );
  eq(ignoredMirror.status, 0, "bundle/opencode/hooks/lib/state/ must be ignored (defence in depth)");
});

if (previousHome === undefined) delete process.env.HOME;
else process.env.HOME = previousHome;
if (previousStateDir !== undefined) process.env.PCORE_STATE_DIR = previousStateDir;

console.log(`domain-state-dir assertions: ${asserts}`);

if (failures > 0) {
  console.error(`${failures} FAILED`);
  process.exit(1);
}
console.log("All domain state dir tests passed");
process.exit(0);
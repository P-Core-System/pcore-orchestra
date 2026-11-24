#!/usr/bin/env node
"use strict";

/**
 * test-studio-scope.js — repo-scope isolation for the global studio.
 *
 * Covers the single PCORE_ORCHESTRA_REPO model:
 *   studio-scope.js   sanitize/default/env/global/scoped/port/registry
 *   safe-write.js     resolveStateDir partitions repos/<scope> when scoped
 *   readers.js        scope-aware stateDir, unscoped behaviour unchanged
 *   state-dirs.js     unscoped discovers repos entries + global; scoped pins one
 *   studio-api.js     --scope serves isolated state; unscoped unchanged
 *   team-listen.js    --scope resolves the registry port; URL/filter intact
 *
 * Hermetic: temp HOME + temp PCORE_STATE_DIR; the studio-api is spawned so
 * bindings and write paths are real.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, execSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const SCOPE_LIB = path.join(ROOT, "bundle", "hooks", "lib", "studio-scope.js");
const scopeLib = require(SCOPE_LIB);

let passed = 0;
let failed = 0;
function ok(cond, msg, detail) {
  if (cond) { passed += 1; console.log(`  ✓ ${msg}`); }
  else { failed += 1; console.log(`  ✗ ${msg}${detail !== undefined ? ` — ${detail}` : ""}`); }
}

// ---------------------------------------------------------------- fixtures
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "studio-scope-home-"));
const GLOBAL_DIR = path.join(TMP_HOME, "state");
process.env.HOME = TMP_HOME;
delete process.env.PCORE_REPO_SCOPE;
process.env.PCORE_STATE_DIR = GLOBAL_DIR;

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

function seedState(stateDir, marker) {
  writeJson(path.join(stateDir, "conductor-runs", "index.json"), {
    version: 1, updated_at: "2026-11-13T00:00:00.000Z",
    runs: { [`${marker}/sess-1/task-1`]: { workspaceSlug: marker, sessionId: "sess-1", taskId: "task-1", goal: `goal-${marker}`, phase: "plan", status: "active", agent: "orchestra-implementer", startedAt: "2026-11-13T00:00:00.000Z" } },
  });
  writeJson(path.join(stateDir, "domain-events.json"), [
    { id: `ev-${marker}`, kind: "event", type: "ticket.created", entityId: `wi-${marker}`, at: "2026-11-13T00:00:00.000Z", payload: { ticketId: `wi-${marker}`, title: `T ${marker}`, state: "TRIAGE", agent: "a", runId: `${marker}:sess-1:task-1` } },
  ]);
  writeJson(path.join(stateDir, "orchestra-tokens.json"), { runs: [], aggregated: {} });
}

// ------------------------------------------------- 1: scope lib pure fns
console.log("Test 1: sanitizeScope");
ok(scopeLib.sanitizeScope("Pcore-Orchestra") === "pcore-orchestra", "lowercases");
ok(scopeLib.sanitizeScope("a/b c__D") === "a-b-c-d", "runs collapse to one dash");
ok(scopeLib.sanitizeScope("") === "default", "empty -> default");
ok(scopeLib.sanitizeScope("---") === "default", "dashes only -> default");
ok(scopeLib.sanitizeScope("x".repeat(64)).length <= 32, "capped at 32 chars");

console.log("Test 2: defaultScope");
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scope-repo-"));
  execSync("git init -q", { cwd: dir });
  fs.writeFileSync(path.join(dir, "f.txt"), "x");
  execSync("git add .", { cwd: dir });
  ok(scopeLib.defaultScope(dir) === scopeLib.sanitizeScope(path.basename(dir)), "git top-level basename", scopeLib.defaultScope(dir));
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), "My Plain Repo_9"));
  ok(scopeLib.defaultScope(plain) === scopeLib.sanitizeScope(path.basename(plain)), "non-git basename fallback");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(plain, { recursive: true, force: true });
}

console.log("Test 3: env + dirs");
ok(scopeLib.envScope({ PCORE_REPO_SCOPE: "  Foo_Bar " }) === "foo-bar", "envScope sanitizes");
ok(scopeLib.envScope({}) === "", "envScope empty when unset");
ok(scopeLib.globalStateDir({ PCORE_STATE_DIR: "/tmp/x" }) === "/tmp/x", "PCORE_STATE_DIR wins");
ok(scopeLib.scopedStateDir("/g", "") === "/g", "unscoped returns global itself");
ok(scopeLib.scopedStateDir("/g", "Acme") === path.join("/g", "repos", "acme"), "scoped nests repos/<scope>");

console.log("Test 4: ports + registry");
{
  const p1 = scopeLib.scopePortCandidate("acme");
  const p2 = scopeLib.scopePortCandidate("acme");
  ok(p1 === p2 && p1 >= 3110 && p1 < 4110, "candidate deterministic in range", p1);
  ok(scopeLib.scopePortCandidate("other") !== undefined, "candidate defined for any scope");
  const reg = path.join(TMP_HOME, "regtest");
  const a = scopeLib.allocatePort("acme", reg);
  const b = scopeLib.allocatePort("acme", reg);
  ok(a === b, "allocate stable across calls", `${a} vs ${b}`);
  ok(scopeLib.resolvePort("acme", reg) === a, "resolvePort hits registry");
  ok(scopeLib.resolvePort("fresh-scope-zzz", reg) === scopeLib.scopePortCandidate("fresh-scope-zzz"), "resolvePort falls back to candidate");
  const onDisk = JSON.parse(fs.readFileSync(path.join(reg, "studio-ports.json"), "utf8"));
  ok(onDisk.scopes && onDisk.scopes.acme === a, "registry persisted");
}

// ------------------------------------------- 5: safe-write partitions
console.log("Test 5: safe-write.resolveStateDir scope partition");
{
  const safe = require(path.join(ROOT, "bundle", "hooks", "lib", "safe-write.js"));
  delete process.env.PCORE_REPO_SCOPE;
  ok(safe.resolveStateDir(GLOBAL_DIR) === GLOBAL_DIR, "unscoped unchanged");
  process.env.PCORE_REPO_SCOPE = "Acme";
  const scoped = safe.resolveStateDir(GLOBAL_DIR);
  ok(scoped === path.join(GLOBAL_DIR, "repos", "acme"), "scoped partitions repos/<scope>", scoped);
  ok(safe.resolveStatePath(path.join(GLOBAL_DIR, "team-sessions.json")) === path.join(scoped, "team-sessions.json"), "resolveStatePath follows partition");
  delete process.env.PCORE_REPO_SCOPE;
}

// ------------------------------------------------- 6: readers scope-aware
console.log("Test 6: readers.js scope-aware, unscoped unchanged");
{
  seedState(GLOBAL_DIR, "globalmarker");
  const readers = require(path.join(ROOT, "server", "readers.js"));
  delete process.env.PCORE_REPO_SCOPE;
  ok(readers.stateDir() === GLOBAL_DIR, "stateDir() honors PCORE_STATE_DIR unscoped");
  const runs = readers.listRuns();
  ok(runs.length === 1 && runs[0].goal === "goal-globalmarker", "unscoped listRuns reads global");
  process.env.PCORE_REPO_SCOPE = "acme";
  ok(readers.stateDir() === path.join(GLOBAL_DIR, "repos", "acme"), "stateDir() partitions when scoped");
  ok(readers.listRuns().length === 0, "scoped listRuns empty before seed");
  seedState(path.join(GLOBAL_DIR, "repos", "acme"), "acmemarker");
  readers.invalidate(readers.domainEventsPath());
  const scopedRuns = readers.listRuns();
  ok(scopedRuns.length === 1 && scopedRuns[0].goal === "goal-acmemarker", "scoped listRuns isolated");
  ok(readers.getWorkItems({}).some((i) => i.id === "wi-acmemarker"), "scoped work items isolated");
  delete process.env.PCORE_REPO_SCOPE;
  readers.invalidate(readers.domainEventsPath());
  ok(readers.listRuns().length === 1, "unscoped still reads global after scope cleared");
}

// ------------------------------------------------- 7: state-dirs scope-aware
console.log("Test 7: state-dirs.js scope-aware");
{
  seedState(path.join(GLOBAL_DIR, "repos", "beta"), "betamarker");
  const sd = require(path.join(ROOT, "server", "state-dirs.js"));
  delete process.env.PCORE_REPO_SCOPE;
  const all = sd.discoverStateDirs();
  const paths = all.map((d) => d.path);
  ok(paths.includes(GLOBAL_DIR), "unscoped includes global");
  ok(paths.includes(path.join(GLOBAL_DIR, "repos", "acme")), "unscoped discovers repos/acme");
  ok(paths.includes(path.join(GLOBAL_DIR, "repos", "beta")), "unscoped discovers repos/beta");
  const scoped = sd.discoverStateDirs("acme");
  ok(scoped.length === 1 && scoped[0].path === path.join(GLOBAL_DIR, "repos", "acme"), "scoped pins one dir", JSON.stringify(scoped));
  process.env.PCORE_REPO_SCOPE = "beta";
  const viaEnv = sd.discoverStateDirs();
  ok(viaEnv.length === 1 && viaEnv[0].path === path.join(GLOBAL_DIR, "repos", "beta"), "env scope pins one dir");
  delete process.env.PCORE_REPO_SCOPE;
}

// --------------------------------------------- 8: studio-api --scope + 9: unscoped
console.log("Test 8/9: studio-api scoped + unscoped serve isolation");
async function apiSuite() {
  const ENTRY = path.join(ROOT, "server", "studio-api.js");
  function start(extraArgs) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [ENTRY, "--port", "0"].concat(extraArgs || []), {
        env: Object.assign({}, process.env),
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`no listen: ${out}`)); }, 8000);
      const onData = (c) => {
        out += String(c);
        const m = out.match(/STUDIO_API_LISTENING host=(\S+) port=(\d+)/);
        if (m) { clearTimeout(timer); resolve({ child, port: Number(m[2]) }); }
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`exited ${code}: ${out}`)); });
    });
  }
  async function get(port, p) {
    const res = await fetch(`http://127.0.0.1:${port}${p}`);
    return res.json();
  }
  // scoped server
  const scoped = await start(["--scope", "acme"]);
  try {
    const runs = await get(scoped.port, "/api/runs");
    ok(Array.isArray(runs) && runs.length === 1 && runs[0].goal === "goal-acmemarker", "scoped /api/runs isolated");
    const items = await get(scoped.port, "/api/workitems");
    ok(items.length === 1 && items[0].id === "wi-acmemarker", "scoped /api/workitems isolated");
    const dirs = await get(scoped.port, "/api/state-dirs");
    ok(Array.isArray(dirs) && dirs.length === 1 && dirs[0].path === path.join(GLOBAL_DIR, "repos", "acme"), "scoped /api/state-dirs pinned");
  } finally {
    scoped.child.kill("SIGTERM");
  }
  // unscoped server (legacy)
  const plain = await start([]);
  try {
    const runs = await get(plain.port, "/api/runs");
    ok(Array.isArray(runs) && runs.length === 1 && runs[0].goal === "goal-globalmarker", "unscoped /api/runs unchanged");
    const dirs = await get(plain.port, "/api/state-dirs");
    ok(dirs.some((d) => d.path === GLOBAL_DIR), "unscoped /api/state-dirs keeps global");
  } finally {
    plain.child.kill("SIGTERM");
  }
  // invalid scope rejected
  const bad = spawn(process.execPath, [ENTRY, "--port", "0", "--scope", "!!!"], { stdio: ["ignore", "pipe", "pipe"] });
  const badOut = await new Promise((res) => { let s = ""; bad.stderr.on("data", (c) => { s += c; }); bad.on("exit", (code) => res({ code, s })); setTimeout(() => { bad.kill("SIGKILL"); res({ code: -1, s }); }, 5000); });
  ok(badOut.code !== 0, "invalid --scope refuses to start");
}

// ------------------------------------------------- 10: team-listen --scope
console.log("Test 10: team-listen scope + URL intact");
{
  const tl = require(path.join(ROOT, "scripts", "team-listen.js"));
  ok(typeof tl.resolveScopePort === "function", "resolveScopePort exported");
  process.env.PCORE_STATE_DIR = GLOBAL_DIR;
  const expected = scopeLib.allocatePort("acme", GLOBAL_DIR);
  ok(tl.resolveScopePort("acme") === expected, "resolveScopePort hits the registry", `${tl.resolveScopePort("acme")} vs ${expected}`);
  ok(tl.resolveScopePort("never-seen-scope-zzz") === scopeLib.scopePortCandidate("never-seen-scope-zzz"), "resolveScopePort falls back to candidate");
  ok(tl.buildUrl({ host: "127.0.0.1", port: 3110, path: "/api/ws", types: [], teams: [] }) === "ws://127.0.0.1:3110/api/ws", "buildUrl bare unchanged");
}

apiSuite().then(() => {
  try { fs.rmSync(TMP_HOME, { recursive: true, force: true }); } catch { /* best effort */ }
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}).catch((err) => {
  console.error("FATAL", err);
  try { fs.rmSync(TMP_HOME, { recursive: true, force: true }); } catch { /* best effort */ }
  process.exit(1);
});

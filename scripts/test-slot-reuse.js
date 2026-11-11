#!/usr/bin/env node
"use strict";

/**
 * Self-check for slot reuse on re-claim (session-claims.js):
 *  1. Re-claim renews the live slot in place: same claimKey, count 1,
 *     `renewed: true`, heartbeat/scope/session refreshed.
 *  2. `{ newSlot: true }` (CLI `--new-slot`) hatches a parallel slot:
 *     fresh key, count 2.
 *  3. A stale slot never renews: re-claim mints fresh.
 *  4. Scope guard intact: foreign overlap still SCOPE_CONFLICTs, renewing
 *     a slot never conflicts with itself (self-exclusion on the renewed key).
 *  5. CLI: claim twice reuses, --new-slot hatches, discuss post reuses the
 *     author slot (same `from`, one live claim).
 *
 * All state is redirected to temp dirs (PCORE_STATE_DIR); the real home
 * config is never touched.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "slot-reuse-state-"));
const cliDir = fs.mkdtempSync(path.join(os.tmpdir(), "slot-reuse-cli-"));

process.env.PCORE_STATE_DIR = stateDir;
delete process.env.PCORE_MEMBER_NAME;
delete process.env.PCORE_TEAM_NAME;
delete process.env.PCORE_MEMBER_ROLE;

const claims = require("../bundle/hooks/lib/session-claims.js");

let failed = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function claimCount() {
  return claims.listClaims({ includeStale: true }).length;
}

function backdateHeartbeat(key, msAgo) {
  const file = path.join(stateDir, "team-sessions.json");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const old = new Date(Date.now() - msAgo).toISOString();
  data[key].heartbeatAt = old;
  data[key].updatedAt = old;
  fs.writeFileSync(file, JSON.stringify(data));
}

// --- 1. renew in place -------------------------------------------------------
const first = claims.claimSession({
  member: "john",
  team: "alpha",
  sessionId: "ses-a",
  workspace: "/tmp/slot-proj",
  scope: "app-a/",
});
check("fresh claim not renewed", first.renewed === false, JSON.stringify(first.renewed));
check("fresh key session-scoped", first.claimKey === "alpha/john/slot-proj/ses-a", first.claimKey);

const second = claims.claimSession({
  member: "john",
  team: "alpha",
  sessionId: "ses-b",
  workspace: "/tmp/slot-proj",
  scope: "app-a/",
});
check("re-claim reuses same key", second.claimKey === first.claimKey, `${second.claimKey} vs ${first.claimKey}`);
check("re-claim marked renewed", second.renewed === true, JSON.stringify(second.renewed));
check("re-claim keeps one slot", claimCount() === 1, `count=${claimCount()}`);
check("re-claim refreshes session", second.sessionId === "ses-b", second.sessionId);

// Scope refresh: new scope wins, same key.
const third = claims.claimSession({
  member: "john",
  team: "alpha",
  sessionId: "ses-c",
  workspace: "/tmp/slot-proj",
  scope: "app-a/,lib-b/",
});
check("scope refresh keeps key", third.claimKey === first.claimKey, third.claimKey);
check("scope refresh updates scope", JSON.stringify(third.scope) === JSON.stringify(["app-a", "lib-b"]), JSON.stringify(third.scope));

// No scope on re-claim keeps the previous scope (never wipes to []).
const fourth = claims.claimSession({
  member: "john",
  team: "alpha",
  sessionId: "ses-d",
  workspace: "/tmp/slot-proj",
});
check("scope-less renew keeps scope", JSON.stringify(fourth.scope) === JSON.stringify(["app-a", "lib-b"]), JSON.stringify(fourth.scope));
check("scope-less renew same key", fourth.claimKey === first.claimKey, fourth.claimKey);

// --- 2. newSlot hatch ---------------------------------------------------------
const hatched = claims.claimSession({
  member: "john",
  team: "alpha",
  sessionId: "ses-e",
  workspace: "/tmp/slot-proj",
  scope: "other/",
  newSlot: true,
});
check("newSlot mints fresh key", hatched.claimKey !== first.claimKey, hatched.claimKey);
check("newSlot not renewed", hatched.renewed === false, JSON.stringify(hatched.renewed));
check("newSlot count grows", claimCount() === 2, `count=${claimCount()}`);

// --- 3. stale slot mints fresh -------------------------------------------------
const staleFirst = claims.claimSession({
  member: "mark",
  team: "alpha",
  sessionId: "ses-1",
  workspace: "/tmp/slot-proj",
  scope: "app-m/",
});
backdateHeartbeat(staleFirst.claimKey, 2 * 60 * 60 * 1000);
const staleRenew = claims.claimSession({
  member: "mark",
  team: "alpha",
  sessionId: "ses-2",
  workspace: "/tmp/slot-proj",
  scope: "app-m/",
});
check("stale slot mints fresh key", staleRenew.claimKey !== staleFirst.claimKey, staleRenew.claimKey);
check("stale mint not renewed", staleRenew.renewed === false, JSON.stringify(staleRenew.renewed));
check(
  "findLiveSlot ignores session",
  claims.findLiveSlot({ member: "mark", team: "alpha", workspaceSlug: "slot-proj", sessionId: "ses-x" }).claimKey === staleRenew.claimKey,
  "wrong slot"
);
check(
  "findLiveSlot null for unknown",
  claims.findLiveSlot({ member: "nobody", team: "alpha", workspaceSlug: "slot-proj" }) === null,
  "expected null"
);

// --- 4. scope guard intact ------------------------------------------------------
let conflicted = null;
try {
  claims.claimSession({
    member: "james",
    team: "alpha",
    sessionId: "ses-j",
    workspace: "/tmp/slot-proj",
    scope: "app-a/sub/",
  });
} catch (err) {
  conflicted = err;
}
check("foreign overlap still SCOPE_CONFLICT", conflicted && conflicted.code === "SCOPE_CONFLICT", String((conflicted && conflicted.code) || conflicted));

// Self-overlap on renew never conflicts (self-exclusion on the renewed key).
let selfOk = null;
try {
  selfOk = claims.claimSession({
    member: "john",
    team: "alpha",
    sessionId: "ses-f",
    workspace: "/tmp/slot-proj",
    scope: "app-a/",
  });
} catch (err) {
  selfOk = null;
}
check("renew self-overlap passes", selfOk && selfOk.claimKey === first.claimKey, selfOk ? selfOk.claimKey : "threw");

// --- 5. CLI: claim / --new-slot / discuss post -----------------------------------
function cli(args) {
  const env = Object.assign({}, process.env, { PCORE_STATE_DIR: cliDir });
  const r = cp.spawnSync("bash", [path.join(ROOT, "scripts", "team-sessions.sh")].concat(args), {
    env,
    encoding: "utf8",
  });
  if (r.status !== 0) {
    return { status: r.status, stderr: r.stderr, json: null };
  }
  try {
    return { status: 0, json: JSON.parse(r.stdout) };
  } catch {
    return { status: 0, stderr: r.stdout, json: null };
  }
}

const WS = "/tmp/slot-cli-proj";
const c1 = cli(["claim", "--member", "john", "--team", "alpha", "--scope", "app-a/", "--workspace", WS, "--session", "cli-a", "--json"]);
check("CLI claim ok", c1.status === 0 && c1.json && c1.json.claimKey === "alpha/john/slot-cli-proj/cli-a", JSON.stringify(c1.json && c1.json.claimKey));
const c2 = cli(["claim", "--member", "john", "--team", "alpha", "--scope", "app-a/", "--workspace", WS, "--session", "cli-b", "--json"]);
check("CLI re-claim reuses key", c2.status === 0 && c2.json && c2.json.claimKey === (c1.json && c1.json.claimKey), JSON.stringify(c2.json && c2.json.claimKey));
check("CLI re-claim renewed", c2.json && c2.json.renewed === true, JSON.stringify(c2.json && c2.json.renewed));
const c3 = cli(["claim", "--member", "john", "--team", "alpha", "--scope", "other/", "--workspace", WS, "--session", "cli-c", "--new-slot", "--json"]);
check("CLI --new-slot hatches", c3.status === 0 && c3.json && c3.json.claimKey !== (c1.json && c1.json.claimKey), JSON.stringify(c3.json && c3.json.claimKey));

const p1 = cli(["discuss", "post", "--member", "amy", "--team", "alpha", "--kind", "m2m", "--body", "hello", "--workspace", WS, "--session", "cli-p1", "--json"]);
check("CLI post ok", p1.status === 0 && p1.json && typeof p1.json.from === "string", JSON.stringify(p1.json && p1.json.id));
const p2 = cli(["discuss", "post", "--member", "amy", "--team", "alpha", "--kind", "m2m", "--body", "again", "--workspace", WS, "--session", "cli-p2", "--json"]);
check("CLI post reuses author slot", p2.status === 0 && p2.json && p2.json.from === (p1.json && p1.json.from), `${p2.json && p2.json.from} vs ${p1.json && p1.json.from}`);

console.log(`\nSlot reuse tests: ${failed === 0 ? "all passed" : failed + " FAILED"}`);
process.exit(failed === 0 ? 0 : 1);

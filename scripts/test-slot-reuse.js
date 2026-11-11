#!/usr/bin/env node
"use strict";

/**
 * Self-check for slot reuse on re-claim (session-claims.js):
 *  1. Renew preserves holder identity: an implicit (resolved) re-claim
 *     reuses the live slot in place — same claimKey, count 1,
 *     `renewed: true`, holder sessionId/workspace kept (never rewritten),
 *     heartbeat refreshed. A second renew is idempotent.
 *  2. An EXPLICIT o.sessionId differing from the live slot's holder session
 *     mints a fresh slot under the new session-scoped key (`renewed: false`,
 *     count grows) — a renew never rewrites another session's identity.
 *     An explicit session EQUAL to the holder's renews in place.
 *  3. `{ newSlot: true }` (CLI `--new-slot`) hatches a parallel slot:
 *     fresh key, count grows.
 *  4. A stale slot never renews: re-claim mints fresh.
 *  5. Scope guard intact: foreign overlap still SCOPE_CONFLICTs, renewing
 *     a slot never conflicts with itself (self-exclusion on the renewed key).
 *  6. CLI: same --session re-claim reuses, different explicit --session
 *     mints fresh, no --session renews the holder slot, --new-slot hatches,
 *     discuss post reuses the author slot on the same session and hatches
 *     on a different explicit one.
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

// --- 1. renew in place, holder identity preserved -----------------------------
const first = claims.claimSession({
  member: "john",
  team: "alpha",
  sessionId: "ses-a",
  workspace: "/tmp/slot-proj",
  scope: "app-a/",
});
check("fresh claim not renewed", first.renewed === false, JSON.stringify(first.renewed));
check("fresh key session-scoped", first.claimKey === "alpha/john/slot-proj/ses-a", first.claimKey);

// Cross-session renew: NO explicit session (implicit resolve) reuses the live
// slot and keeps the holder's identity (sessionId stays ses-a, never rewritten).
const second = claims.claimSession({
  member: "john",
  team: "alpha",
  workspace: "/tmp/slot-proj",
  scope: "app-a/",
});
check("re-claim reuses same key", second.claimKey === first.claimKey, `${second.claimKey} vs ${first.claimKey}`);
check("re-claim marked renewed", second.renewed === true, JSON.stringify(second.renewed));
check("re-claim keeps one slot", claimCount() === 1, `count=${claimCount()}`);
check("re-claim keeps holder session", second.sessionId === "ses-a", second.sessionId);
check("re-claim keeps holder slug", second.workspaceSlug === "slot-proj", second.workspaceSlug);

// Second renew is idempotent: same key, same holder identity, still one slot.
const secondAgain = claims.claimSession({
  member: "john",
  team: "alpha",
  workspace: "/tmp/slot-proj",
  scope: "app-a/",
});
check("second renew idempotent key", secondAgain.claimKey === first.claimKey, secondAgain.claimKey);
check("second renew still renewed", secondAgain.renewed === true, JSON.stringify(secondAgain.renewed));
check("second renew keeps holder session", secondAgain.sessionId === "ses-a", secondAgain.sessionId);
check("second renew keeps one slot", claimCount() === 1, `count=${claimCount()}`);

// Explicit session EQUAL to the holder's renews in place.
const sameExplicit = claims.claimSession({
  member: "john",
  team: "alpha",
  sessionId: "ses-a",
  workspace: "/tmp/slot-proj",
  scope: "app-a/",
});
check("same explicit session renews", sameExplicit.claimKey === first.claimKey && sameExplicit.renewed === true, sameExplicit.claimKey);

// --- 2. explicit different session mints fresh (never rewrites) ----------------
const explicit = claims.claimSession({
  member: "john",
  team: "alpha",
  sessionId: "ses-b",
  workspace: "/tmp/slot-proj",
  scope: "other2/",
});
check("explicit different session mints fresh key", explicit.claimKey === "alpha/john/slot-proj/ses-b", explicit.claimKey);
check("explicit mint not renewed", explicit.renewed === false, JSON.stringify(explicit.renewed));
check("explicit mint grows count", claimCount() === 2, `count=${claimCount()}`);
check("explicit mint keeps holder slot", claims.getClaim(first.claimKey).sessionId === "ses-a");

// Scope refresh: new scope wins, same holder key (implicit renew).
const third = claims.claimSession({
  member: "john",
  team: "alpha",
  workspace: "/tmp/slot-proj",
  scope: "app-a/,lib-b/",
});
check("scope refresh keeps key", third.claimKey === first.claimKey, third.claimKey);
check("scope refresh updates scope", JSON.stringify(third.scope) === JSON.stringify(["app-a", "lib-b"]), JSON.stringify(third.scope));

// No scope on re-claim keeps the previous scope (never wipes to []).
const fourth = claims.claimSession({
  member: "john",
  team: "alpha",
  workspace: "/tmp/slot-proj",
});
check("scope-less renew keeps scope", JSON.stringify(fourth.scope) === JSON.stringify(["app-a", "lib-b"]), JSON.stringify(fourth.scope));
check("scope-less renew same key", fourth.claimKey === first.claimKey, fourth.claimKey);

// --- 3. newSlot hatch ---------------------------------------------------------
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
check("newSlot count grows", claimCount() === 3, `count=${claimCount()}`);

// --- 4. stale slot mints fresh -------------------------------------------------
const staleFirst = claims.claimSession({
  member: "mark",
  team: "alpha",
  sessionId: "ses-1",
  workspace: "/tmp/slot-proj",
  scope: "app-m/",
});
backdateHeartbeat(staleFirst.claimKey, 2 * 60 * 60 * 1000);
// Implicit re-claim (no explicit session): the stale slot reads as absent,
// so the claim mints fresh instead of renewing.
const staleRenew = claims.claimSession({
  member: "mark",
  team: "alpha",
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
    workspace: "/tmp/slot-proj",
    scope: "app-a/",
  });
} catch (err) {
  selfOk = null;
}
check("renew self-overlap passes", selfOk && selfOk.claimKey === first.claimKey, selfOk ? selfOk.claimKey : "threw");

// --- 6. CLI: same --session reuses, different explicit mints fresh -------------
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
const c2 = cli(["claim", "--member", "john", "--team", "alpha", "--scope", "app-a/", "--workspace", WS, "--session", "cli-a", "--json"]);
check("CLI same-session re-claim reuses key", c2.status === 0 && c2.json && c2.json.claimKey === (c1.json && c1.json.claimKey), JSON.stringify(c2.json && c2.json.claimKey));
check("CLI same-session re-claim renewed", c2.json && c2.json.renewed === true, JSON.stringify(c2.json && c2.json.renewed));
const c3 = cli(["claim", "--member", "john", "--team", "alpha", "--scope", "other/", "--workspace", WS, "--session", "cli-b", "--json"]);
check("CLI different explicit --session mints fresh", c3.status === 0 && c3.json && c3.json.claimKey === "alpha/john/slot-cli-proj/cli-b", JSON.stringify(c3.json && c3.json.claimKey));
check("CLI explicit mint not renewed", c3.json && c3.json.renewed === false, JSON.stringify(c3.json && c3.json.renewed));
// No --session (implicit resolve): renews the holder slot, identity kept.
const c4 = cli(["claim", "--member", "john", "--team", "alpha", "--scope", "app-a/", "--workspace", WS, "--json"]);
check("CLI implicit re-claim keeps holder key", c4.status === 0 && c4.json && c4.json.claimKey === (c1.json && c1.json.claimKey), JSON.stringify(c4.json && c4.json.claimKey));
check("CLI implicit re-claim keeps holder session", c4.json && c4.json.sessionId === "cli-a", JSON.stringify(c4.json && c4.json.sessionId));
const c5 = cli(["claim", "--member", "john", "--team", "alpha", "--scope", "fresh/", "--workspace", WS, "--session", "cli-c", "--new-slot", "--json"]);
check("CLI --new-slot hatches", c5.status === 0 && c5.json && c5.json.claimKey !== (c1.json && c1.json.claimKey), JSON.stringify(c5.json && c5.json.claimKey));

const p1 = cli(["discuss", "post", "--member", "amy", "--team", "alpha", "--kind", "m2m", "--body", "hello", "--workspace", WS, "--session", "cli-p1", "--json"]);
check("CLI post ok", p1.status === 0 && p1.json && typeof p1.json.from === "string", JSON.stringify(p1.json && p1.json.id));
const p2 = cli(["discuss", "post", "--member", "amy", "--team", "alpha", "--kind", "m2m", "--body", "again", "--workspace", WS, "--session", "cli-p1", "--json"]);
check("CLI post reuses author slot", p2.status === 0 && p2.json && p2.json.from === (p1.json && p1.json.from), `${p2.json && p2.json.from} vs ${p1.json && p1.json.from}`);
const p3 = cli(["discuss", "post", "--member", "amy", "--team", "alpha", "--kind", "m2m", "--body", "third", "--workspace", WS, "--session", "cli-p2", "--json"]);
check("CLI post with different explicit --session hatches", p3.status === 0 && p3.json && p3.json.from !== (p1.json && p1.json.from), `${p3.json && p3.json.from} vs ${p1.json && p1.json.from}`);

console.log(`\nSlot reuse tests: ${failed === 0 ? "all passed" : failed + " FAILED"}`);
process.exit(failed === 0 ? 0 : 1);

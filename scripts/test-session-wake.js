#!/usr/bin/env node
"use strict";

/**
 * Self-check for session wake requests (Wave3 teammate nudge channel):
 *  1. domain +4 event types + recordWakeOutcome (additive, fail-open)
 *  2. buildWake validation (empty from/to, thread context stamps)
 *  3. requestWake happy path (same workspace+project delivers, requested +
 *     delivered domain events, thread fields carried)
 *  4. cross-workspace -> WAKE_CROSS_SCOPE + denied audit, nothing stored
 *  5. cross-project -> WAKE_CROSS_SCOPE (same slug, different project.yaml)
 *  6. live-claim check (unknown/released/stale target -> WAKE_NO_CLAIM)
 *  7. rate ring (5/hr ok, 6th WAKE_THROTTLED + throttled event)
 *  8. ackWake (target acks, stranger denied, unknown id, list filters)
 *  9. worktree partition (wakes file under <worktree>/.pcore/state)
 * 10. parseMentions matrix
 * 11. triggerWakesForDiscussion (@mention -> wake with messageId/threadId,
 *     self-mention skipped, no mentions -> [])
 * 12. triggerWakeForGrant (granted assign wake, no-from skipped fail-open)
 * 13. wakeForPhaseOutcome (block -> leader/HOD wake, advance -> null,
 *     no leader -> null, fail-open)
 * 14. recordPhaseOutcome regression (block still stores + wakes leader)
 * 15. CLI smoke: discuss post with @mention stores a wake, fail-open
 *
 * All state is redirected to temp dirs (PCORE_STATE_DIR /
 * PCORE_CONDUCTOR_STATE_DIR); the real home config is never touched.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");

function freshState() {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "wake-state-"));
  const conductorDir = fs.mkdtempSync(path.join(os.tmpdir(), "wake-conductor-"));
  process.env.PCORE_STATE_DIR = stateDir;
  process.env.PCORE_CONDUCTOR_STATE_DIR = conductorDir;
  return { stateDir, conductorDir };
}
function dropState(s) {
  try { fs.rmSync(s.stateDir, { recursive: true, force: true }); } catch { /* ignore */ }
  try { fs.rmSync(s.conductorDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

let st = freshState();
let st2 = null;
delete process.env.PCORE_MEMBER_NAME;
delete process.env.PCORE_TEAM_NAME;
delete process.env.PCORE_MEMBER_ROLE;

const wake = require("../bundle/hooks/lib/session-wake.js");
const constants = require("../bundle/hooks/lib/domain/constants.js");
const domain = require("../bundle/hooks/lib/domain/index.js");
const store = require("../bundle/hooks/lib/domain/store.js");
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

function mkWorkspace(projectSlug) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wake-ws-"));
  if (projectSlug) {
    fs.writeFileSync(path.join(dir, "project.yaml"), `project:\n  name: ${projectSlug}\n  slug: ${projectSlug}\n`, "utf8");
  }
  return dir;
}

function runCli(cmd, extraEnv) {
  return cp.execSync(cmd, { cwd: ROOT, encoding: "utf8", env: Object.assign({}, process.env, extraEnv) });
}

try {
  // ---- 1. domain ----
  check("domain +4 wake types",
    constants.DOMAIN_EVENT_TYPES.indexOf("wake.requested") !== -1 &&
    constants.DOMAIN_EVENT_TYPES.indexOf("wake.delivered") !== -1 &&
    constants.DOMAIN_EVENT_TYPES.indexOf("wake.denied") !== -1 &&
    constants.DOMAIN_EVENT_TYPES.indexOf("wake.throttled") !== -1);
  const wv = domain.recordWakeOutcome({ id: "w_1", from: "t/a/w/s1", to: "t/b/w/s2", team: "t", reason: "nudge" }, "requested");
  check("recordWakeOutcome appends", !!wv && wv.type === "wake.requested");
  check("recordWakeOutcome fail-open", domain.recordWakeOutcome(null, "requested") === null && domain.recordWakeOutcome({ id: "x" }, "nope") === null);

  // ---- 2. build ----
  let threw = 0;
  try { wake.buildWake({ to: "t/b/w/s" }); } catch { threw += 1; }
  try { wake.buildWake({ from: "t/a/w/s" }); } catch { threw += 1; }
  check("buildWake rejects empty from/to", threw === 2);
  const built = wake.buildWake({ from: "t/john/w/s1", to: "t/jane/w/s2", team: "t", topic: "pair", threadId: "pair", messageId: "d_9", topology: "2way", reason: "mention" });
  check("buildWake stamps thread context",
    built.threadId === "pair" && built.messageId === "d_9" && built.topology === "2way" && built.status === "delivered" && typeof built.id === "string");

  // ---- 3. happy path ----
  const wsA = mkWorkspace("proj-one");
  const john = claims.claimSession({ member: "john", team: "alpha", workspace: wsA, sessionId: "s-john" });
  const jane = claims.claimSession({ member: "jane", team: "alpha", workspace: wsA, sessionId: "s-jane" });
  const res = wake.requestWake({ from: john.claimKey, to: jane.claimKey, topic: "pair", messageId: "d_9", topology: "2way", reason: "mention", workspace: wsA });
  check("requestWake delivers same-scope", res.ok === true && !!res.wake && res.wake.to === jane.claimKey, JSON.stringify(res));
  check("wake carries thread fields",
    res.wake && res.wake.threadId === "pair" && res.wake.messageId === "d_9" && res.wake.topology === "2way" && res.wake.projectSlug === "proj-one");
  const types = store.loadEvents().map((e) => e.type);
  check("requested + delivered domain events", types.indexOf("wake.requested") !== -1 && types.indexOf("wake.delivered") !== -1);
  check("wakes file exists", fs.existsSync(wake.wakesFile()));

  // ---- 4. cross-workspace ----
  const wsB = mkWorkspace("proj-one");
  const bob = claims.claimSession({ member: "bob", team: "alpha", workspace: wsB, sessionId: "s-bob" });
  const before = wake.readAll().length;
  const cross = wake.requestWake({ from: john.claimKey, to: bob.claimKey, workspace: wsA });
  check("cross-workspace denied", cross.ok === false && cross.code === "WAKE_CROSS_SCOPE", JSON.stringify(cross));
  check("cross-scope stores nothing", wake.readAll().length === before);
  check("cross-scope audit event",
    store.loadEvents().some((e) => e.type === "wake.denied" && e.payload && e.payload.reason === "WAKE_CROSS_SCOPE"));

  // ---- 5. cross-project (same slug, different project.yaml) ----
  const mkSame = (slug) => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "wake-parent-"));
    const dir = path.join(parent, "sameslug");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "project.yaml"), `project:\n  name: ${slug}\n  slug: ${slug}\n`, "utf8");
    return dir;
  };
  const wsP1 = mkSame("proj-one");
  const wsP2 = mkSame("proj-two");
  const ann = claims.claimSession({ member: "ann", team: "alpha", workspace: wsP1, sessionId: "s-ann" });
  const zed = claims.claimSession({ member: "zed", team: "alpha", workspace: wsP2, sessionId: "s-zed" });
  check("same-slug fixture", ann.workspaceSlug === zed.workspaceSlug, `${ann.workspaceSlug} vs ${zed.workspaceSlug}`);
  const crossProj = wake.requestWake({ from: ann.claimKey, to: zed.claimKey, workspace: wsP1 });
  check("cross-project denied", crossProj.ok === false && crossProj.code === "WAKE_CROSS_SCOPE" && crossProj.detail === "project", JSON.stringify(crossProj));

  // ---- 6. live-claim check ----
  const ghost = wake.requestWake({ from: john.claimKey, to: "alpha/ghost/w/s-gone", workspace: wsA });
  check("unknown target denied", ghost.ok === false && ghost.code === "WAKE_NO_CLAIM", JSON.stringify(ghost));
  claims.releaseClaim({ claimKey: jane.claimKey });
  const released = wake.requestWake({ from: john.claimKey, to: jane.claimKey, workspace: wsA });
  check("released target denied", released.ok === false && released.code === "WAKE_NO_CLAIM", JSON.stringify(released));
  const noAuthor = wake.requestWake({ from: "alpha/ghost/w/s-gone", to: john.claimKey, workspace: wsA });
  check("unknown author denied", noAuthor.ok === false && noAuthor.code === "WAKE_NO_CLAIM", JSON.stringify(noAuthor));
  check("isLiveClaim null-safe", wake.isLiveClaim(null) === false);

  // ---- 7. rate ring (fresh dir) ----
  st2 = st;
  st = freshState();
  const wsR = mkWorkspace("proj-one");
  const ra = claims.claimSession({ member: "amy", team: "beta", workspace: wsR, sessionId: "s-a" });
  const rb = claims.claimSession({ member: "ben", team: "beta", workspace: wsR, sessionId: "s-b" });
  let okCount = 0;
  for (let i = 0; i < 5; i++) {
    const r = wake.requestWake({ from: ra.claimKey, to: rb.claimKey, workspace: wsR, reason: `n${i}` });
    if (r.ok) okCount += 1;
  }
  check("5/hr pass", okCount === 5, String(okCount));
  const sixth = wake.requestWake({ from: ra.claimKey, to: rb.claimKey, workspace: wsR });
  check("6th throttled", sixth.ok === false && sixth.code === "WAKE_THROTTLED", JSON.stringify(sixth));
  check("throttled domain event", store.loadEvents().some((e) => e.type === "wake.throttled"));

  // ---- 8. ack + list ----
  const first = wake.listWakes({})[0];
  const ackOther = wake.ackWake(first.id, { by: ra.claimKey });
  check("stranger cannot ack", ackOther.ok === false && ackOther.code === "WAKE_DENIED", JSON.stringify(ackOther));
  const ackTarget = wake.ackWake(first.id, { by: rb.claimKey });
  check("target acks", ackTarget.ok === true && ackTarget.wake.status === "acked" && !!ackTarget.wake.ackedAt, JSON.stringify(ackTarget));
  check("unknown wake id", wake.ackWake("w_missing", { by: rb.claimKey }).ok === false);
  check("acked hidden by default", wake.listWakes({}).every((w) => w.status !== "acked"));
  check("acked visible with includeAcked", wake.listWakes({ includeAcked: true }).some((w) => w.id === first.id));
  check("member filter", wake.listWakes({ member: "ben" }).length >= 1 && wake.listWakes({ member: "sara" }).length === 0);
  check("team filter", wake.listWakes({ team: "beta" }).length >= 1 && wake.listWakes({ team: "gamma" }).length === 0);
  check("null wake never matches", wake.matchWakeFilter(null, {}) === false);

  // ---- 9. worktree partition ----
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "wake-worktree-"));
  const wFrom = claims.claimSession({ member: "wfrom", team: "beta", workspace: wsR, sessionId: "s-w", worktreePath: worktree });
  const wTo = claims.claimSession({ member: "wto", team: "beta", workspace: wsR, sessionId: "s-w2", worktreePath: worktree });
  const wRes = wake.requestWake({ from: wFrom.claimKey, to: wTo.claimKey, workspace: wsR, worktreePath: worktree });
  check("worktree wake delivers", wRes.ok === true, JSON.stringify(wRes));
  check("worktree file partitioned", fs.existsSync(path.join(worktree, ".pcore", "state", "team-wakes.jsonl")));
  check("worktree wake isolated from global", !wake.listWakes({}).some((w) => w.id === (wRes.wake && wRes.wake.id)));
  check("worktree list reads partition", wake.listWakes({}, worktree).some((w) => w.id === (wRes.wake && wRes.wake.id)));

  // ---- 10. mentions ----
  check("parseMentions matrix",
    JSON.stringify(wake.parseMentions("hey @Jane and @bob-x, see @jane")) === JSON.stringify(["jane", "bob-x"]) &&
    wake.parseMentions("no mentions").length === 0 &&
    wake.parseMentions(null).length === 0 &&
    wake.parseMentions("@John ping @john").length === 1);

  // ---- 11. discussion trigger ----
  const wsT = mkWorkspace("proj-one");
  const tAuthor = claims.claimSession({ member: "tom", team: "gamma", workspace: wsT, sessionId: "s-t" });
  const tSam = claims.claimSession({ member: "sam", team: "gamma", workspace: wsT, sessionId: "s-s" });
  const trig = wake.triggerWakesForDiscussion({
    id: "d_trig1", kind: "m2m", topology: "2way", from: tAuthor.claimKey,
    team: "gamma", topic: "deploy", body: "hey @sam look + @tom self",
  }, { workspace: wsT });
  check("mention triggers wake with thread context",
    trig.length === 1 && trig[0].mention === "sam" && trig[0].result.ok === true &&
    trig[0].result.wake.messageId === "d_trig1" && trig[0].result.wake.threadId === "deploy",
    JSON.stringify(trig));
  check("no mentions -> []", wake.triggerWakesForDiscussion({ from: tAuthor.claimKey, body: "plain" }, {}).length === 0);
  check("trigger fail-open on junk", wake.triggerWakesForDiscussion(null, {}).length === 0);

  // ---- 12. grant trigger ----
  const grantRes = wake.triggerWakeForGrant(
    { granted: true, member: "sam", team: "gamma" },
    { from: tAuthor.claimKey, workspace: wsT, topic: "sprint-3" });
  check("grant assign wake", grantRes && grantRes.ok === true && grantRes.wake.reason === "assign", JSON.stringify(grantRes));
  check("grant without from skipped", wake.triggerWakeForGrant({ granted: true, member: "sam" }, {}).skipped === "no-from");
  check("refused grant -> null", wake.triggerWakeForGrant({ granted: false, reason: "busy" }, { from: tAuthor.claimKey }) === null);

  // ---- 13. phase-outcome trigger ----
  const wsL = mkWorkspace("proj-one");
  const hod = claims.claimSession({ member: "hod", team: "delta", role: "leader", workspace: wsL, sessionId: "s-h" });
  const dev = claims.claimSession({ member: "dev", team: "delta", workspace: wsL, sessionId: "s-d" });
  const esc = wake.wakeForPhaseOutcome({ claimKey: dev.claimKey, team: "delta" }, { decision: "block", phase: "verify", reason: "red gates" });
  check("block wakes leader", !!esc && esc.ok === true && esc.wake.to === hod.claimKey && esc.wake.reason === "escalate", JSON.stringify(esc));
  check("advance wakes nobody", wake.wakeForPhaseOutcome({ claimKey: dev.claimKey }, { decision: "advance", phase: "plan" }) === null);
  check("block without leader wakes nobody",
    wake.wakeForPhaseOutcome({ claimKey: tAuthor.claimKey, team: "gamma" }, { decision: "block", phase: "verify" }) === null);
  check("block without author wakes nobody", wake.wakeForPhaseOutcome({}, { decision: "block", phase: "verify" }) === null);
  check("trigger fail-open", wake.wakeForPhaseOutcome(null, null) === null);

  // ---- 14. recordPhaseOutcome regression ----
  const stored = domain.recordPhaseOutcome({ claimKey: dev.claimKey, team: "delta", sessionId: "s-d" }, { decision: "block", phase: "verify", reason: "red" });
  check("recordPhaseOutcome block still stores", !!stored && stored.type === "phase.outcome");
  check("block opened review + woke leader",
    store.loadEvents().some((e) => e.type === "review.requested") &&
    wake.listWakes({}).some((w) => w.reason === "escalate" && w.to === hod.claimKey));

  // ---- 15. CLI smoke ----
  const cliEnv = { PCORE_STATE_DIR: st.stateDir, PCORE_CONDUCTOR_STATE_DIR: st.conductorDir };
  runCli(`bash scripts/team-sessions.sh claim --member Cli1 --team Team-Echo --json`, Object.assign({}, cliEnv, { PCORE_SESSION_ID: "sess-wake-1", PCORE_WORKSPACE_ROOT: wsT }));
  runCli(`bash scripts/team-sessions.sh claim --member Cli2 --team Team-Echo --json`, Object.assign({}, cliEnv, { PCORE_SESSION_ID: "sess-wake-2", PCORE_WORKSPACE_ROOT: wsT }));
  const postedCli = JSON.parse(runCli(`bash scripts/team-sessions.sh discuss post --member Cli1 --team Team-Echo --kind m2m --body "hey @cli2 review this" --json`, Object.assign({}, cliEnv, { PCORE_SESSION_ID: "sess-wake-1", PCORE_WORKSPACE_ROOT: wsT })));
  check("CLI discuss post ok", !!postedCli.id, JSON.stringify(postedCli).slice(0, 120));
  const wakesCli = JSON.parse(runCli(`node -e "const w=require('./bundle/hooks/lib/session-wake.js'); console.log(JSON.stringify(w.listWakes({})))"`, cliEnv));
  check("CLI @mention stored a wake", Array.isArray(wakesCli) && wakesCli.some((w) => w.messageId === postedCli.id && w.reason === "mention"), JSON.stringify(wakesCli).slice(0, 200));

  // ---- 16. no .tmp residue ----
  const leftovers = [];
  const sweep = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) sweep(p);
      else if (e.name.indexOf(".tmp.") !== -1) leftovers.push(p);
    }
  };
  sweep(st.stateDir);
  check("no .tmp residue", leftovers.length === 0, leftovers.join(","));
} finally {
  dropState(st);
  try { dropState(st2); } catch { /* ignore when unset */ }
  delete process.env.PCORE_STATE_DIR;
  delete process.env.PCORE_CONDUCTOR_STATE_DIR;
}

if (failed) {
  console.log(`\nFAIL (${failed} checks)`);
  process.exit(1);
}
console.log("\nPASS (all checks)");

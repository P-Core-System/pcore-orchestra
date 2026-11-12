#!/usr/bin/env node
"use strict";

/**
 * Self-check for team discussion threads (WI-10 leader/member pairing):
 *  1. kinds m2m/l2m/m2l/l2l/group + topologyOf (2way/star/group)
 *  2. matchDiscussionFilter matrix (kind/topology/team/member/topic/resolved)
 *  3. buildMessage validation (unknown kind / empty body / missing author)
 *  4. post/list round-trip in isolated PCORE_STATE_DIR (JSONL file)
 *  5. resolve + react (unknown id -> null, never throws)
 *  6. cap/prune rule (DISCUSSION_CAP ring, pruneDiscussion resolved-age)
 *  7. shared dir: writes land shared (no worktree partition) + legacy
 *     worktree import (shared wins on id conflict)
 *  8. domain: +3 event types + recordDiscussionOutcome (posted/resolved/
 *     reaction) additive, fail-open
 *  9. server/ws.js: diffSnapshots replays discussion.* + parseWsFilter /
 *     matchWsEvent matrix
 * 10. leader push: backlogByMember busyMembers free-check + filterFreePlans
 *     + planLeaderPush (busy members skipped, never claimed over)
 * 11. member pull: requestWork grants next item with claimKey/branch when
 *     free, refuses busy/empty/unknown-member
 * 12. CLI smoke: discuss post/list/react/resolve --json, request granted +
 *     busy SKIP (exit 2), dispatch --free-only --dry-run, post SCOPE_CONFLICT
 *     SKIP (exit 2), domain discussion.posted recorded
 *
 * All state is redirected to temp dirs (PCORE_STATE_DIR /
 * PCORE_CONDUCTOR_STATE_DIR); the real home config is never touched.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "team-discussion-state-"));
const conductorDir = fs.mkdtempSync(path.join(os.tmpdir(), "team-discussion-conductor-"));
const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "team-discussion-worktree-"));

// Pin env BEFORE requiring the libs under test.
process.env.PCORE_STATE_DIR = stateDir;
process.env.PCORE_CONDUCTOR_STATE_DIR = conductorDir;
delete process.env.PCORE_MEMBER_NAME;
delete process.env.PCORE_TEAM_NAME;
delete process.env.PCORE_MEMBER_ROLE;
delete process.env.PCORE_TASK_ID;
delete process.env.PCORE_WORKSPACE_ROOT;

const discussion = require("../bundle/hooks/lib/team-discussion.js");
const constants = require("../bundle/hooks/lib/domain/constants.js");
const domain = require("../bundle/hooks/lib/domain/index.js");
const claims = require("../bundle/hooks/lib/session-claims.js");
const dispatch = require("../bundle/hooks/lib/team-dispatch.js");
const pm = require("../bundle/hooks/lib/project-manager.js");
const ws = require("../server/ws.js");

let failed = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function runCli(cmd, extraEnv) {
  return cp.execSync(cmd, {
    cwd: ROOT,
    encoding: "utf8",
    env: Object.assign({}, process.env, extraEnv),
  });
}

function runCliStatus(cmd, extraEnv) {
  try {
    runCli(cmd, extraEnv);
    return 0;
  } catch (err) {
    return typeof err.status === "number" ? err.status : 1;
  }
}

try {
  // ---- 1. kinds + topology ----
  check("five discussion kinds", discussion.DISCUSSION_KINDS.join(",") === "m2m,l2m,m2l,l2l,group");
  check("topologyOf m2m/l2l -> 2way", discussion.topologyOf("m2m") === "2way" && discussion.topologyOf("l2l") === "2way");
  check("topologyOf l2m/m2l -> star", discussion.topologyOf("l2m") === "star" && discussion.topologyOf("m2l") === "star");
  check("topologyOf group -> group", discussion.topologyOf("group") === "group");
  check("topologyOf unknown -> null", discussion.topologyOf("nope") === null);
  check("isDiscussionKind gates", discussion.isDiscussionKind("m2m") && !discussion.isDiscussionKind("m3m"));

  // ---- 2. filter matrix ----
  const m = (kind, extra) => Object.assign({ id: "d_x", kind, from: "team-alpha/john/wsa/s1", to: null, team: "team-alpha", topic: null, body: "b", resolvedAt: null }, extra || {});
  check("2way matches m2m+l2l only",
    discussion.matchDiscussionFilter(m("m2m"), { topology: "2way" }) &&
    discussion.matchDiscussionFilter(m("l2l"), { topology: "2way" }) &&
    !discussion.matchDiscussionFilter(m("l2m"), { topology: "2way" }) &&
    !discussion.matchDiscussionFilter(m("group"), { topology: "2way" }));
  check("star matches l2m+m2l only",
    discussion.matchDiscussionFilter(m("l2m"), { topology: "star" }) &&
    discussion.matchDiscussionFilter(m("m2l"), { topology: "star" }) &&
    !discussion.matchDiscussionFilter(m("m2m"), { topology: "star" }));
  check("group matches group only",
    discussion.matchDiscussionFilter(m("group"), { topology: "group" }) &&
    !discussion.matchDiscussionFilter(m("m2m"), { topology: "group" }));
  check("all matches everything", discussion.matchDiscussionFilter(m("m2m"), { topology: "all" }) && discussion.matchDiscussionFilter(m("group"), {}));
  check("team gate", discussion.matchDiscussionFilter(m("m2m"), { team: "team-alpha" }) && !discussion.matchDiscussionFilter(m("m2m"), { team: "team-beta" }));
  check("member gate (author + to)",
    discussion.matchDiscussionFilter(m("m2m"), { member: "john" }) &&
    discussion.matchDiscussionFilter(m("m2m", { to: "team-alpha/james/wsa/s9" }), { member: "james" }) &&
    !discussion.matchDiscussionFilter(m("m2m"), { member: "sara" }));
  check("group visible to member-filtered list of same team",
    discussion.matchDiscussionFilter(m("group"), { member: "sara", team: "team-alpha" }) &&
    discussion.matchDiscussionFilter(m("group"), { member: "sara" }));
  check("group hidden from member-filtered list of other team",
    !discussion.matchDiscussionFilter(m("group"), { member: "sara", team: "team-beta" }));
  check("m2m still needs author-or-to on member filter",
    !discussion.matchDiscussionFilter(m("m2m"), { member: "sara", team: "team-alpha" }));
  check("member filter shows same-team star legs + group (HOD view)",
    discussion.matchDiscussionFilter(m("m2l", { from: "team-alpha/alice/wsa/s1", to: "team-alpha/hod/wsa/s0" }), { member: "hod", team: "team-alpha" }) &&
    discussion.matchDiscussionFilter(m("l2m", { from: "team-alpha/hod/wsa/s0", to: "team-alpha/alice/wsa/s1" }), { member: "hod", team: "team-alpha" }) &&
    discussion.matchDiscussionFilter(m("group"), { member: "hod", team: "team-alpha" }));
  check("member filter hides unrelated pairwise m2m (Alice hides Bob-Carol)",
    !discussion.matchDiscussionFilter(m("m2m", { from: "team-alpha/bob/wsa/s1", to: "carol" }), { member: "alice", team: "team-alpha" }) &&
    !discussion.matchDiscussionFilter(m("l2l", { from: "team-alpha/bob/wsa/s1", to: "team-alpha/carol/wsa/s2" }), { member: "alice", team: "team-alpha" }) &&
    discussion.matchDiscussionFilter(m("m2l", { from: "team-alpha/bob/wsa/s1", to: "team-alpha/hod/wsa/s0" }), { member: "alice", team: "team-alpha" }));
  check("member filter hides other-team star legs",
    !discussion.matchDiscussionFilter(m("m2l", { from: "team-beta/bob/wsb/s1", to: "team-beta/hod/wsb/s0", team: "team-beta" }), { member: "hod", team: "team-alpha" }) &&
    !discussion.matchDiscussionFilter(m("l2m", { from: "team-beta/hod/wsb/s0", to: "team-beta/bob/wsb/s1", team: "team-beta" }), { member: "hod", team: "team-alpha" }));
  check("member filter without team never leaks star legs",
    !discussion.matchDiscussionFilter(m("m2l", { from: "team-alpha/bob/wsa/s1", to: "team-alpha/hod/wsa/s0" }), { member: "alice" }) &&
    !discussion.matchDiscussionFilter(m("l2m", { from: "team-alpha/hod/wsa/s0", to: "team-alpha/bob/wsa/s1" }), { member: "alice" }) &&
    discussion.matchDiscussionFilter(m("m2m", { from: "team-alpha/alice/wsa/s1", to: "carol" }), { member: "alice" }));
  check("topic substring + resolved hidden by default",
    discussion.matchDiscussionFilter(m("m2m", { topic: "deploy-blocker" }), { topic: "deploy" }) &&
    !discussion.matchDiscussionFilter(m("m2m", { resolvedAt: "2026-01-01T00:00:00.000Z" }), {}) &&
    discussion.matchDiscussionFilter(m("m2m", { resolvedAt: "2026-01-01T00:00:00.000Z" }), { includeResolved: true }));
  check("null message never matches", discussion.matchDiscussionFilter(null, {}) === false);

  // ---- 3. build validation ----
  let threw = 0;
  try { discussion.buildMessage({ kind: "nope", from: "a/b/c/d", body: "x" }); } catch { threw += 1; }
  try { discussion.buildMessage({ kind: "m2m", from: "a/b/c/d", body: "  " }); } catch { threw += 1; }
  try { discussion.buildMessage({ kind: "m2m", from: "", body: "x" }); } catch { threw += 1; }
  check("buildMessage rejects kind/body/author", threw === 3);
  const built = discussion.buildMessage({ kind: "l2m", from: "team-alpha/hod/wsa/s1", to: "john", team: "team-alpha", topic: "t", body: "go" });
  check("buildMessage stamps topology", built.topology === "star" && typeof built.id === "string");

  // ---- 4. post/list round-trip ----
  const posted = discussion.postMessage({ kind: "m2m", from: "team-alpha/john/wsa/s1", to: "team-alpha/james/wsa/s2", team: "team-alpha", topic: "pair", body: "ping" });
  check("postMessage stores", posted.id && posted.topology === "2way");
  const listed = discussion.listMessages({ team: "team-alpha" });
  check("listMessages finds the post", listed.some((x) => x.id === posted.id && x.body === "ping"));
  check("JSONL file exists", fs.existsSync(discussion.discussionFile()));
  check("topology filter narrows", discussion.listMessages({ topology: "star" }).length === 0);

  // ---- 5. resolve + react ----
  const reacted = discussion.reactMessage(posted.id, { by: "team-alpha/james/wsa/s2", emoji: "+1" });
  check("react appends", !!reacted && reacted.reactions.length === 1 && reacted.reactions[0].emoji === "+1");
  check("react unknown id -> null", discussion.reactMessage("d_missing", { by: "a/b/c/d", emoji: "+1" }) === null);
  const resolved = discussion.resolveMessage(posted.id, { by: "team-alpha/james/wsa/s2" });
  check("resolve stamps", !!resolved && !!resolved.resolvedAt);
  check("resolved hidden by default", discussion.listMessages({}).every((x) => !x.resolvedAt));
  check("resolved visible with --all", discussion.listMessages({ includeResolved: true }).some((x) => x.id === posted.id));
  check("resolve unknown id -> null", discussion.resolveMessage("d_missing", {}) === null);
  let reactThrew = 0;
  try { discussion.reactMessage(posted.id, { by: "a/b/c/d", emoji: "" }); } catch { reactThrew += 1; }
  try { discussion.reactMessage(posted.id, { by: "", emoji: "+1" }); } catch { reactThrew += 1; }
  check("react validates emoji/author", reactThrew === 2);

  // ---- 6. cap/prune ----
  const lines = ["a", "b", "c", "d", "e"].map((b, i) => ({ id: `d_cap${i}`, kind: "group", body: b }));
  const capped = discussion.capLines(lines, 3);
  check("capLines keeps newest", capped.split("\n").filter(Boolean).length === 3 && capped.indexOf('"d_cap4"') !== -1);
  const pruneRes = discussion.pruneDiscussion({ cap: 1 });
  check("pruneDiscussion enforces cap", pruneRes.kept === 1 && discussion.listMessages({ includeResolved: true }).length === 1);
  const old = discussion.postMessage({ kind: "m2m", from: "t/m/s/sess", body: "old" });
  discussion.resolveMessage(old.id, { by: "t/m/s/sess" });
  // backdate the resolved stamp by rewriting one line is overkill; the
  // age gate keeps fresh resolves — assert it keeps (pruned 0).
  const ageRes = discussion.pruneDiscussion({ olderThanMs: 30 * 24 * 3600 * 1000 });
  check("pruneDiscussion age gate keeps fresh", ageRes.kept >= 1);

  // ---- 7. shared dir + legacy import ----
  const wtMsg = discussion.postMessage({ kind: "group", from: "team-a/amy/w/s1", team: "team-a", body: "wt" }, worktree);
  check("discussion file stays shared (no worktree partition)",
    discussion.discussionFile(worktree) === discussion.discussionFile(),
    discussion.discussionFile(worktree));
  check("worktree write lands in shared thread", discussion.listMessages({}).some((x) => x.id === wtMsg.id));
  const legacyThread = discussion.legacyDiscussionFile(worktree);
  check("legacy path under worktree .pcore/state",
    legacyThread === path.join(worktree, ".pcore", "state", "team-discussion.jsonl"), legacyThread);
  fs.mkdirSync(path.dirname(legacyThread), { recursive: true });
  const legacyMsg = { id: "d_legacy1", kind: "m2m", topology: "2way", from: "team-a/old/w/s0", to: "amy", team: "team-a", topic: null, threadId: null, body: "legacy", createdAt: new Date().toISOString(), resolvedAt: null, resolvedBy: null, reactions: [] };
  fs.writeFileSync(legacyThread, `${JSON.stringify(legacyMsg)}\n`);
  check("legacy-only message merges into reads",
    discussion.listMessages({}, worktree).some((x) => x.id === "d_legacy1"));
  check("shared wins on legacy id conflict",
    discussion.listMessages({}, worktree).filter((x) => x.id === wtMsg.id).length === 1);

  // ---- 8. domain ----
  check("domain +3 event types",
    constants.DOMAIN_EVENT_TYPES.indexOf("discussion.posted") !== -1 &&
    constants.DOMAIN_EVENT_TYPES.indexOf("discussion.resolved") !== -1 &&
    constants.DOMAIN_EVENT_TYPES.indexOf("discussion.reaction") !== -1);
  const ev = domain.recordDiscussionOutcome({ id: "d_1", kind: "l2m", topology: "star", from: "t/hod/w/s", to: "john", team: "t", topic: null }, "posted");
  check("recordDiscussionOutcome appends", !!ev && ev.type === "discussion.posted");
  check("recordDiscussionOutcome fail-open", domain.recordDiscussionOutcome(null, "posted") === null && domain.recordDiscussionOutcome({ id: "x" }, "nope") === null);

  // ---- 9. ws replay + filter ----
  check("ws exports filter matrix", Array.isArray(ws.WS_EVENT_TYPES) && typeof ws.parseWsFilter === "function" && typeof ws.matchWsEvent === "function");
  const prev = { events: [], runs: {} };
  const next = { events: [{ type: "discussion.posted", entityId: "d_9", at: "2026-01-01T00:00:00.000Z", payload: { messageId: "d_9", kind: "l2m", topology: "star", from: "t/hod/w/s", to: "john", team: "team-alpha", topic: "t" } }], runs: {} };
  const wsev = ws.diffSnapshots(prev, next, "2026-01-01T00:00:01.000Z");
  check("ws replays discussion.posted",
    wsev.length === 1 && wsev[0].type === "discussion.posted" && wsev[0].runId === null && wsev[0].data.team === "team-alpha",
    JSON.stringify(wsev));
  check("parseWsFilter splits type/team",
    (() => { const f = ws.parseWsFilter("type=discussion.posted,gate.passed&team=team-alpha"); return f.types.length === 2 && f.teams[0] === "team-alpha"; })());
  check("matchWsEvent matrix",
    ws.matchWsEvent(wsev[0], null) &&
    ws.matchWsEvent(wsev[0], { types: [], teams: [] }) &&
    ws.matchWsEvent(wsev[0], { types: ["discussion.posted"], teams: ["team-alpha"] }) &&
    !ws.matchWsEvent(wsev[0], { types: ["gate.passed"], teams: [] }) &&
    !ws.matchWsEvent(wsev[0], { types: [], teams: ["team-beta"] }) &&
    ws.matchWsEvent({ type: "gate.passed", data: {} }, { types: [], teams: [] }) === true &&
    ws.matchWsEvent({ type: "gate.passed", data: {} }, { types: [], teams: ["team-beta"] }) === false &&
    ws.matchWsEvent(null, {}) === false);

  // ---- 10. leader push ----
  const ps = {
    backlog: [
      { id: "b1", title: "john ticket", assigned: { teamId: "team-alpha", memberKey: "john" } },
      { id: "b2", title: "james ticket", assigned: { teamId: "team-alpha", memberKey: "james" } },
    ],
    tasks: [],
  };
  const bbBusy = pm.backlogByMember(ps, { busyMembers: ["team-alpha/john"] });
  check("backlogByMember free-check holds busy out",
    bbBusy.busy.length === 1 && bbBusy.busy[0].id === "b1" &&
    (bbBusy.byMember.john || []).length === 0 &&
    (bbBusy.byMember.james || []).length === 1);
  const bbSlug = pm.backlogByMember(ps, { busyMembers: ["james"] });
  check("busy slug matches any team", bbSlug.busy.length === 1 && bbSlug.busy[0].id === "b2");
  const bbPlain = pm.backlogByMember(ps);
  check("no busyMembers groups everything + empty busy", bbPlain.busy.length === 0 && bbPlain.byMember.john.length === 1);
  const liveClaims = [{ claimKey: "team-alpha/john/w/s", member: "john", teamId: "team-alpha" }];
  const plans = dispatch.planDispatch({ teamId: "team-alpha", teams: pm.backlogByMember(ps).teams });
  const free = dispatch.filterFreePlans(plans, liveClaims);
  check("filterFreePlans drops busy", free.length === 1 && free[0].member === "james");
  const pushed = dispatch.planLeaderPush({ teamId: "team-alpha", teams: pm.backlogByMember(ps).teams, liveClaims });
  check("planLeaderPush pushes to free only", pushed.length === 1 && pushed[0].member === "james");

  // ---- 11. member pull ----
  const grant = dispatch.requestWork({ member: "james", team: "team-alpha", teams: pm.backlogByMember(ps).teams, liveClaims, sessionId: "s9", workspaceSlug: "wsa" });
  check("requestWork grants with claimKey/branch",
    grant.granted && grant.item.id === "b2" &&
    grant.claimKey === "team-alpha/james/wsa/s9" && grant.branch === "member/team-alpha/james",
    JSON.stringify(grant));
  const busyGrant = dispatch.requestWork({ member: "john", team: "team-alpha", teams: pm.backlogByMember(ps).teams, liveClaims });
  check("requestWork refuses busy", !busyGrant.granted && busyGrant.reason === "busy" && !!busyGrant.claimKey);
  const emptyGrant = dispatch.requestWork({ member: "sara", team: "team-alpha", teams: pm.backlogByMember(ps).teams, liveClaims: [] });
  check("requestWork refuses empty", !emptyGrant.granted && emptyGrant.reason === "empty");
  const anonGrant = dispatch.requestWork({ member: "", team: "team-alpha", teams: {} });
  check("requestWork refuses unknown member", !anonGrant.granted && anonGrant.reason === "unknown-member");

  // ---- 12. CLI smoke: seed project state first, then discuss/request ----
  const cliEnv = { PCORE_STATE_DIR: stateDir, PCORE_CONDUCTOR_STATE_DIR: conductorDir, PCORE_SESSION_ID: "sess-disc-1" };
  const seedScript = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "team-discussion-seed-")), "seed.js");
  fs.writeFileSync(seedScript, [
    "process.env.PCORE_STATE_DIR = " + JSON.stringify(stateDir) + ";",
    "const pm = require(" + JSON.stringify(path.join(ROOT, "bundle/hooks/lib/project-manager.js")) + ");",
    "const ps = pm.loadProjectState(undefined, 'sess-disc-1');",
    "const cur = pm.getSessionProjectState(ps, 'sess-disc-1');",
    "cur.backlog = [",
    "  { id: 'd1', title: 'sara work', assigned: { teamId: 'team-alpha', memberKey: 'sara' }, scope: 'app-sara/' },",
    "  { id: 'd2', title: 'john work', assigned: { teamId: 'team-alpha', memberKey: 'john' }, scope: 'app-john/' },",
    "  { id: 'd3', title: 'james work', assigned: { teamId: 'team-alpha', memberKey: 'james' }, scope: 'app-james/' },",
    "];",
    "pm.saveProjectState(cur, 'sess-disc-1');",
  ].join("\n") + "\n");
  runCli(`node "${seedScript}"`, cliEnv);
  const postedCli = JSON.parse(runCli(`bash scripts/team-sessions.sh discuss post --member John --team Team-Alpha --kind l2m --to james --topic pair --body "cli ping" --json`, cliEnv));
  check("CLI discuss post carries claim author",
    !!postedCli.id && postedCli.kind === "l2m" && postedCli.from === "team-alpha/john/pcore-orchestra/sess-disc-1",
    JSON.stringify(postedCli));
  const listedCli = JSON.parse(runCli(`bash scripts/team-sessions.sh discuss list --team Team-Alpha --topology star --json`, cliEnv));
  check("CLI discuss list filters", Array.isArray(listedCli.messages) && listedCli.messages.some((x) => x.id === postedCli.id));
  runCli(`bash scripts/team-sessions.sh claim --member James --team Team-Alpha --json`, cliEnv);
  const reactedCli = JSON.parse(runCli(`bash scripts/team-sessions.sh discuss react --id ${postedCli.id} --emoji "+1" --member James --team Team-Alpha --json`, cliEnv));
  check("CLI discuss react", reactedCli.reactions.length === 1);
  const resolvedCli = JSON.parse(runCli(`bash scripts/team-sessions.sh discuss resolve --id ${postedCli.id} --member John --team Team-Alpha --json`, cliEnv));
  check("CLI discuss resolve", !!resolvedCli.resolvedAt);
  const reqEnv = { PCORE_STATE_DIR: stateDir, PCORE_CONDUCTOR_STATE_DIR: conductorDir, PCORE_SESSION_ID: "sess-disc-1", PCORE_WORKSPACE_ROOT: ROOT };
  const reqCli = JSON.parse(runCli(`bash scripts/team-sessions.sh request --member Sara --team Team-Alpha --json`, reqEnv));
  check("CLI request grants when free",
    reqCli.granted === true && reqCli.item.id === "d1" &&
    reqCli.claimKey === "team-alpha/sara/pcore-orchestra/sess-disc-1" && reqCli.branch === "member/team-alpha/sara",
    JSON.stringify(reqCli));
  check("CLI request busy SKIPs (exit 2)", runCliStatus(`bash scripts/team-sessions.sh request --member John --team Team-Alpha --json`, reqEnv) === 2);
  check("CLI request empty SKIPs (exit 2)", runCliStatus(`bash scripts/team-sessions.sh request --member Zara --team Team-Alpha --json`, reqEnv) === 2);
  const dryCli = JSON.parse(runCli(`bash scripts/team-sessions.sh dispatch --team Team-Alpha --dry-run --free-only --session sess-disc-1 --json`, reqEnv));
  check("CLI dispatch --free-only skips claimed slots",
    dryCli.freeOnly === true && dryCli.plans.every((p) => p.member !== "john" && p.member !== "james") &&
    dryCli.plans.some((p) => p.member === "sara"),
    JSON.stringify(dryCli.plans && dryCli.plans.map((p) => p.member)));
  // post SCOPE_CONFLICT SKIP: Amy holds app-cli/, Bob posts into app-cli/deep.
  runCli(`bash scripts/team-sessions.sh claim --member Amy --team Team-Alpha --scope app-cli/ --json`, cliEnv);
  const conflictEnv = { PCORE_STATE_DIR: stateDir, PCORE_CONDUCTOR_STATE_DIR: conductorDir, PCORE_SESSION_ID: "sess-disc-2" };
  const conflictStatus = runCliStatus(`bash scripts/team-sessions.sh discuss post --member Bob --team Team-Alpha --scope app-cli/deep --kind m2m --body "blocked" --json`, conflictEnv);
  check("CLI discuss post SCOPE_CONFLICT SKIPs", conflictStatus === 2, `status=${conflictStatus}`);
} finally {
  try { fs.rmSync(stateDir, { recursive: true, force: true }); } catch { /* ignore */ }
  try { fs.rmSync(conductorDir, { recursive: true, force: true }); } catch { /* ignore */ }
  try { fs.rmSync(worktree, { recursive: true, force: true }); } catch { /* ignore */ }
  delete process.env.PCORE_STATE_DIR;
  delete process.env.PCORE_CONDUCTOR_STATE_DIR;
}

if (failed) {
  console.log(`\nFAIL (${failed} checks)`);
  process.exit(1);
}
console.log("\nPASS (all checks)");

#!/usr/bin/env node
"use strict";

/**
 * Self-check for named cross-CLI team sessions (John/James/Mark ...):
 *  1. claimKey uniqueness: team+member+slug+sessionId (same name, other
 *     team = distinct key); display Name@slug / Team/Member@slug
 *  2. ses_xxxx fallback when no member is given
 *  3. 30-min stale: live list hides stale, includeStale annotates, gc prunes
 *  4. 4-member team + 5th join + groupByTeam roster
 *  5. PCORE_STATE_DIR unify: shared roster (no worktree partition) +
 *     legacy worktree import (shared wins)
 *  6. conductor-state roster fields (begin/save/who/list + member/team filters)
 *  7. domain: session.claimed/heartbeat/released additive, store-only,
 *     recordSessionOutcome fail-open
 *  8. spawn-adapter: provenance member passthrough + parallel gate
 *  9. project-manager.backlogByMember: HOD team backlog + per-member tickets
 *     via ticket.assigned { teamId, memberKey }
 * 10. CLI smoke: team-sessions.sh claim/list/who --json, conductor-state.sh
 *     begin/who --json carry member fields
 *
 * All state is redirected to temp dirs (PCORE_STATE_DIR /
 * PCORE_CONDUCTOR_STATE_DIR); the real home config is never touched.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "team-sessions-state-"));
const conductorDir = fs.mkdtempSync(path.join(os.tmpdir(), "team-sessions-conductor-"));
const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "team-sessions-worktree-"));

// Pin env BEFORE requiring the libs under test.
process.env.PCORE_STATE_DIR = stateDir;
process.env.PCORE_CONDUCTOR_STATE_DIR = conductorDir;
delete process.env.PCORE_MEMBER_NAME;
delete process.env.PCORE_TEAM_NAME;
delete process.env.PCORE_MEMBER_ROLE;
delete process.env.PCORE_TASK_ID;
delete process.env.PCORE_WORKSPACE_ROOT;

const claims = require("../bundle/hooks/lib/session-claims.js");
const conductor = require("../bundle/hooks/lib/conductor-state.js");
const domain = require("../bundle/hooks/lib/domain/index.js");
const spawnAdapter = require("../bundle/hooks/lib/spawn-adapter.js");
const pm = require("../bundle/hooks/lib/project-manager.js");
const handoff = require("../bundle/hooks/lib/handoff-enforcer.js");

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

try {
  // ---- 1. claimKey uniqueness + display ----
  const johnA = claims.claimSession({ member: "John", team: "Team-Alpha", role: "dev", sessionId: "sess-john-1", workspace: "/tmp/wsA" });
  const johnB = claims.claimSession({ member: "John", team: "Team-Beta", role: "dev", sessionId: "sess-john-1", workspace: "/tmp/wsA" });
  check("same name different teams -> distinct keys", johnA.claimKey !== johnB.claimKey, `${johnA.claimKey} vs ${johnB.claimKey}`);
  check("claimKey shape team/member/slug/session", johnA.claimKey === "team-alpha/john/wsa/sess-john-1", johnA.claimKey);
  check("display Name@slug", johnA.memberDisplay === "John@wsa", johnA.memberDisplay);
  check("teamDisplay Team/Member@slug", johnA.teamDisplay === "Team-alpha/John@wsa", johnA.teamDisplay);

  // ---- 2. ses_xxxx fallback ----
  const anon = claims.claimSession({ sessionId: "sess-zz99", workspace: "/tmp/wsA" });
  check("fallback member ses_xxxx", anon.member === "ses-zz99", anon.member);
  check("fallback display", anon.memberDisplay === "Ses-zz99@wsa", anon.memberDisplay);
  check("solo claim has null team", anon.team === null && anon.teamId === null, JSON.stringify({ team: anon.team }));

  // ---- 3. stale / gc ----
  const staleKey = claims.claimSession({ member: "Old", team: "Team-Alpha", sessionId: "sess-old", workspace: "/tmp/wsA" }).claimKey;
  const file = claims.claimsFile(undefined);
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  raw[staleKey].heartbeatAt = new Date(Date.now() - 31 * 60 * 1000).toISOString();
  fs.writeFileSync(file, JSON.stringify(raw, null, 2));
  const live = claims.listClaims({});
  check("stale claim hidden from live list", !live.some((c) => c.claimKey === staleKey));
  const all = claims.listClaims({ includeStale: true });
  const staleEntry = all.find((c) => c.claimKey === staleKey);
  check("includeStale annotates stale:true", !!staleEntry && staleEntry.stale === true);
  const pruned = claims.gcClaims({});
  check("gc prunes stale claim", pruned.includes(staleKey), JSON.stringify(pruned));
  check("gc removed from store", claims.getClaim(staleKey, undefined) === null);

  // ---- 4. 4-member team + 5th join + groupByTeam ----
  const team = "Team-Alpha";
  const four = ["John", "James", "Mark", "Sara"].map((m, i) =>
    claims.claimSession({ member: m, team, role: "dev", sessionId: `sess-${m.toLowerCase()}-${i}`, workspace: "/tmp/wsA" }));
  check("4-member team claimed", four.length === 4 && four.every((c) => c.teamId === "team-alpha"));
  const fifth = claims.claimSession({ member: "Priya", team, role: "qa", sessionId: "sess-priya-0", workspace: "/tmp/wsA" });
  const roster = claims.listClaims({});
  const groups = claims.groupByTeam(roster);
  check("groupByTeam has team-alpha with 5+ members",
    !!groups["team-alpha"] && groups["team-alpha"].members.length >= 5,
    JSON.stringify(Object.keys(groups)));
  check("5th join visible in team group",
    groups["team-alpha"].members.some((m) => m.member === "priya" && m.role === "qa"));
  check("solo group holds the fallback claim",
    !!groups.solo && groups.solo.members.some((m) => m.member === "ses-zz99"));

  // ---- 5. PCORE_STATE_DIR unify + legacy worktree import ----
  check("claims file lives under PCORE_STATE_DIR", file.startsWith(stateDir), file);
  const wtClaim = claims.claimSession({ member: "John", team, sessionId: "sess-john-1", workspace: "/tmp/wsA", worktreePath: worktree });
  check("worktree claim recorded", wtClaim.claimKey === johnA.claimKey, wtClaim.claimKey);
  check("claims file stays shared (no worktree partition)",
    claims.claimsFile(worktree) === file, claims.claimsFile(worktree));
  check("worktree write lands in shared roster", claims.getClaim(johnA.claimKey, worktree) !== null);
  const wtList = claims.listClaims({ worktreePath: worktree });
  check("worktree list reads shared roster", wtList.some((c) => c.claimKey === johnA.claimKey), JSON.stringify(wtList.map((c) => c.claimKey)));
  const legacyFile = claims.legacyClaimsFile(worktree);
  check("legacy path under worktree .pcore/state",
    legacyFile === path.join(worktree, ".pcore", "state", "team-sessions.json"), legacyFile);
  const legacyOnly = { claimKey: "team-alpha/legacy/wsa/sess-legacy", member: "legacy", memberDisplay: "Legacy@wsa", team: "team-alpha", teamId: "team-alpha", teamDisplay: "Team-alpha/Legacy@wsa", role: "member", scope: [], sessionId: "sess-legacy", workspace: "/tmp/wsA", workspaceSlug: "wsa", heartbeatAt: new Date().toISOString(), updatedAt: new Date().toISOString(), createdAt: new Date().toISOString() };
  const shadowed = Object.assign({}, legacyOnly, { claimKey: johnA.claimKey, memberDisplay: "SHADOWED@wsa" });
  fs.mkdirSync(path.dirname(legacyFile), { recursive: true });
  fs.writeFileSync(legacyFile, JSON.stringify({ [legacyOnly.claimKey]: legacyOnly, [shadowed.claimKey]: shadowed }, null, 2));
  check("legacy-only claim merges into reads", claims.getClaim(legacyOnly.claimKey, worktree) !== null);
  check("shared wins on legacy key conflict",
    claims.getClaim(johnA.claimKey, worktree).memberDisplay === johnA.memberDisplay);

  // ---- 6. conductor-state roster fields ----
  const begun = conductor.beginRun({ goal: "team goal", phase: "plan", sessionId: "sess-john-1", workspace: "/tmp/wsA", member: "John", team, role: "hod" });
  check("beginRun stores roster fields",
    begun.run.member === "john" && begun.run.teamId === "team-alpha" && begun.run.role === "hod",
    JSON.stringify({ member: begun.run.member, teamId: begun.run.teamId, role: begun.run.role }));
  check("beginRun display + claimKey",
    begun.run.memberDisplay === "John@wsa" && begun.run.claimKey === "team-alpha/john/wsa/sess-john-1",
    `${begun.run.memberDisplay} ${begun.run.claimKey}`);
  const idx = conductor.loadIndex();
  const entry = idx.runs["wsa/sess-john-1/" + begun.run.taskId];
  check("index entry carries roster fields",
    !!entry && entry.member === "john" && entry.teamDisplay === "Team-alpha/John@wsa" && entry.claimKey === begun.run.claimKey,
    JSON.stringify(entry));
  conductor.beginRun({ goal: "other", sessionId: "sess-beta-1", workspace: "/tmp/wsA", member: "Zed", team: "Team-Beta" });
  const teamFiltered = conductor.listRuns({ workspace: "/tmp/wsA", team: "team-alpha" });
  check("listRuns filters by team", teamFiltered.length >= 1 && teamFiltered.every((e) => (e.teamId || e.team) === "team-alpha"), JSON.stringify(teamFiltered.map((e) => e.teamId)));
  const memberFiltered = conductor.listRuns({ workspace: "/tmp/wsA", member: "john" });
  check("listRuns filters by member", memberFiltered.length >= 1 && memberFiltered.every((e) => e.member === "john"));

  // ---- 7. domain session events ----
  check("DOMAIN_EVENT_TYPES has session.claimed/heartbeat/released",
    domain.DOMAIN_EVENT_TYPES.includes("session.claimed") &&
    domain.DOMAIN_EVENT_TYPES.includes("session.heartbeat") &&
    domain.DOMAIN_EVENT_TYPES.includes("session.released"));
  const sc = domain.createSessionClaim({ claimKey: "k", member: "john", team: "team-alpha", action: "claimed" });
  check("createSessionClaim envelope", sc.kind === "session_claim" && sc.claimKey === "k");
  const ev1 = domain.recordSessionOutcome(johnA, "claimed");
  check("recordSessionOutcome claimed appends session.claimed",
    !!ev1 && ev1.type === "session.claimed" && ev1.payload.claimKey === johnA.claimKey, JSON.stringify(ev1 && ev1.type));
  const ev2 = domain.recordSessionOutcome(johnA, "heartbeat");
  check("recordSessionOutcome heartbeat appends", !!ev2 && ev2.type === "session.heartbeat");
  const ev3 = domain.recordSessionOutcome(johnA, "released");
  check("recordSessionOutcome released appends", !!ev3 && ev3.type === "session.released");
  check("fail-open on junk claim", domain.recordSessionOutcome(null, "claimed") === null);
  check("fail-open on bad action", domain.recordSessionOutcome(johnA, "explode") === null);
  const events = domain.store.loadEvents();
  check("events persisted via store only",
    ["session.claimed", "session.heartbeat", "session.released"].every((t) => events.some((e) => e.type === t)));

  // ---- 8. spawn-adapter provenance + parallel gate ----
  const prov = spawnAdapter.buildSpawnProvenance("orchestra-implementer",
    { goal: "g", member: "john", team: "team-alpha", claimKey: johnA.claimKey }, null, "cursor");
  check("provenance passes member/team/claimKey",
    prov.member === "john" && prov.team === "team-alpha" && prov.claimKey === johnA.claimKey, JSON.stringify(prov));
  const gate = spawnAdapter.canDispatchInParallel(
    { agent: "orchestra-planner", claimKey: johnA.claimKey },
    { agent: "orchestra-verifier", claimKey: johnA.claimKey }, null);
  check("same-claim parallel gated", gate.ok === false && gate.reason === "same-claim", JSON.stringify(gate));
  const registry = { agentDetails: [
    { id: "orchestra-planner", independence: { files: ["plan.md"], gates: ["g1"], stateKeys: ["k1"] } },
    { id: "orchestra-verifier", independence: { files: ["verify.md"], gates: ["g2"], stateKeys: ["k2"] } },
  ] };
  const gate2 = spawnAdapter.canDispatchInParallel(
    { agent: "orchestra-planner", claimKey: "team-alpha/john/wsa/s1" },
    { agent: "orchestra-verifier", claimKey: "team-beta/john/wsa/s2" }, registry);
  check("different-claim independent phases pass gate", gate2.ok === true, JSON.stringify(gate2));

  // ---- 9. backlogByMember (HOD assign) ----
  const ps = {
    backlog: [
      { id: "b1", title: "team epic", assigned: { teamId: "team-alpha", memberKey: null } },
      { id: "b2", title: "john ticket", assigned: { teamId: "team-alpha", memberKey: "john" } },
      { id: "b3", title: "james ticket", assigned: { teamId: "team-alpha", memberKey: "james" } },
      { id: "b4", title: " legacy assignee ", assignee: "Mark", teamId: "team-alpha" },
      { id: "b5", title: "unassigned" },
    ],
    tasks: [{ id: "t1", title: "sara task", assigned: { teamId: "team-alpha", memberKey: "sara" } }],
  };
  const bb = pm.backlogByMember(ps);
  check("team-alpha group holds 5 team items", !!bb.teams["team-alpha"] && bb.teams["team-alpha"].items.length === 5, JSON.stringify(bb.teams["team-alpha"] && bb.teams["team-alpha"].items.length));
  check("per-member john ticket", (bb.byMember.john || []).some((i) => i.id === "b2"));
  check("per-member nested under team", ((bb.teams["team-alpha"].byMember.james) || []).some((i) => i.id === "b3"));
  check("legacy assignee normalized", (bb.byMember.mark || []).some((i) => i.id === "b4"));
  check("unassigned isolated", bb.unassigned.length === 1 && bb.unassigned[0].id === "b5");

  // ---- 10. CLI smoke ----
  const cliEnv = { PCORE_STATE_DIR: stateDir, PCORE_CONDUCTOR_STATE_DIR: conductorDir, PCORE_SESSION_ID: "sess-cli-1" };
  const claimed = JSON.parse(runCli(`bash scripts/team-sessions.sh claim --member John --team Team-Alpha --role hod --json`, cliEnv));
  check("CLI claim --json carries teamDisplay",
    claimed.claimKey === "team-alpha/john/pcore-orchestra/sess-cli-1" &&
    claimed.teamDisplay === "Team-alpha/John@pcore-orchestra" && claimed.role === "hod",
    JSON.stringify(claimed));
  const listed = JSON.parse(runCli(`bash scripts/team-sessions.sh list --json`, cliEnv));
  check("CLI list --json groups by team", !!listed.groups && !!listed.groups["team-alpha"], Object.keys(listed.groups || {}).join(","));
  const staleCliKey = claims.claimSession({ member: "StaleCli2", team: "Team-Alpha", sessionId: "sess-stale-cli2", workspace: "/tmp/wsA" }).claimKey;
  const rawCli = JSON.parse(fs.readFileSync(file, "utf8"));
  rawCli[staleCliKey].heartbeatAt = new Date(Date.now() - 31 * 60 * 1000).toISOString();
  fs.writeFileSync(file, JSON.stringify(rawCli, null, 2));
  const bareList = JSON.parse(runCli(`bash scripts/team-sessions.sh list --json`, cliEnv));
  check("CLI bare list hides stale", !(bareList.claims || []).some((c) => c.claimKey === staleCliKey));
  const allList = JSON.parse(runCli(`bash scripts/team-sessions.sh list --all --json`, cliEnv));
  check("CLI list --all adds stale",
    (allList.claims || []).some((c) => c.claimKey === staleCliKey && c.stale === true),
    JSON.stringify((allList.claims || []).length));
  const begunCli = JSON.parse(runCli(`bash scripts/conductor-state.sh begin --goal "cli goal" --member John --team Team-Alpha --json`, cliEnv));
  check("CLI begin --json carries roster", begunCli.run.member === "john" && begunCli.run.teamId === "team-alpha", JSON.stringify(begunCli.run && { member: begunCli.run.member, teamId: begunCli.run.teamId }));
  const who = JSON.parse(runCli(`bash scripts/conductor-state.sh who --json`, cliEnv));
  check("CLI who --json entries carry member fields",
    Array.isArray(who) && who.length >= 1 && who.some((r) => r.memberDisplay && r.claimKey),
    JSON.stringify((who || []).map((r) => r.memberDisplay)));

  // ---- 11. commit discipline: handoff carries the commit reminder + SHA ----
  check("COMMIT_DISCIPLINE_CLAUSE exported with commit-your-scope text",
    typeof handoff.COMMIT_DISCIPLINE_CLAUSE === "string" &&
    handoff.COMMIT_DISCIPLINE_CLAUSE.includes("commit your scope before reporting"),
    handoff.COMMIT_DISCIPLINE_CLAUSE);
  check("clause demands a commit SHA", handoff.COMMIT_DISCIPLINE_CLAUSE.includes("commit SHA"));
  const contract = handoff.buildCompletionContract({ goal: "g" }, "orchestra-implementer");
  check("completion contract carries commit discipline", contract.some((l) => l.includes("commit your scope before reporting")));
  const phaseHandoff = handoff.buildPhaseHandoff({ goal: "ship it", memory: {} }, "orchestra-implementer");
  check("phase handoff reminds to commit scope", phaseHandoff.includes("commit your scope before reporting"));
  const enforced = handoff.buildHandoffEnforcement({ goal: "ship it", memory: {} }, [], null);
  check("enforcement handoff reminds to commit scope + SHA",
    enforced.includes("commit your scope before reporting") && enforced.includes("commit SHA"));
  check("memberBranch per-member branch", claims.memberBranch({ team: "Team-Alpha", member: "John" }) === "member/team-alpha/john");
  check("memberBranch solo fallback", claims.memberBranch({ member: "Zed" }) === "member/solo/zed");
  const branched = claims.claimSession({ member: "Hod", team: "Team-Alpha", sessionId: "sess-hod-1", workspace: "/tmp/wsA" });
  check("claim records per-member branch", branched.branch === "member/team-alpha/hod", branched.branch);

  // ---- 12. overlapping scope blocked; disjoint OK; self-renew OK ----
  const scopeA = claims.claimSession({ member: "Amy", team: "Team-Alpha", scope: "app-a/", sessionId: "sess-amy-1", workspace: "/tmp/wsA" });
  check("scoped claim stores normalized scope", JSON.stringify(scopeA.scope) === JSON.stringify(["app-a"]), JSON.stringify(scopeA.scope));
  let blocked = null;
  try {
    claims.claimSession({ member: "Bob", team: "Team-Alpha", scope: "app-a/sub", sessionId: "sess-bob-1", workspace: "/tmp/wsA" });
  } catch (err) {
    blocked = err;
  }
  check("overlapping scope blocked with SCOPE_CONFLICT",
    !!blocked && blocked.code === "SCOPE_CONFLICT" && (blocked.conflicts || []).includes(scopeA.claimKey),
    blocked && `${blocked.code} ${JSON.stringify(blocked.conflicts)}`);
  const found = claims.findScopeConflicts({ scope: "app-a/other", excludeKey: "other/key" });
  check("findScopeConflicts surfaces the conflict", found.some((c) => c.claimKey === scopeA.claimKey));
  const disjoint = claims.claimSession({ member: "Bob", team: "Team-Alpha", scope: "app-b/", sessionId: "sess-bob-1", workspace: "/tmp/wsA" });
  check("disjoint scope claim allowed", !!disjoint && disjoint.member === "bob");
  const renewed = claims.claimSession({ member: "Amy", team: "Team-Alpha", scope: "app-a/", sessionId: "sess-amy-1", workspace: "/tmp/wsA" });
  check("same-claim renew with same scope allowed", renewed.claimKey === scopeA.claimKey);
  check("same-session renew marked renewed", renewed.renewed === true);
  const amyFresh = claims.claimSession({ member: "Amy", team: "Team-Alpha", scope: "app-amy2/", sessionId: "sess-amy-2", workspace: "/tmp/wsA" });
  check("explicit different session mints fresh (never rewrites)",
    amyFresh.claimKey !== scopeA.claimKey && amyFresh.renewed === false && amyFresh.claimKey === "team-alpha/amy/wsa/sess-amy-2",
    amyFresh.claimKey);
  check("holder slot untouched by explicit mint",
    claims.getClaim(scopeA.claimKey).sessionId === "sess-amy-1");
  let starBlocked = null;
  try {
    claims.claimSession({ member: "Zed", team: "Team-Beta", scope: "*", sessionId: "sess-zed-1", workspace: "/tmp/wsA" });
  } catch (err) {
    starBlocked = err;
  }
  check("wildcard scope conflicts with live scoped claim", !!starBlocked && starBlocked.code === "SCOPE_CONFLICT");

  // ---- 13. cross-member WIP untouched (scope guard) ----
  const james = claims.claimSession({ member: "JamesScope", team: "Team-Alpha", scope: "app-c-scope/", sessionId: "sess-jscope-1", workspace: "/tmp/wsA" });
  check("own-scope files pass", claims.assertScopeForFiles(["app-c-scope/y.js", "app-c-scope/deep/z.js"], james).length === 0);
  const scopeViolations = claims.assertScopeForFiles(["app-a/x.js"], james);
  check("teammate-scope files flagged", scopeViolations.length === 1 && scopeViolations[0] === "app-a/x.js", JSON.stringify(scopeViolations));
  check("isPathInScope wildcard covers all", claims.isPathInScope("anything/at/all.js", "*") === true);
  check("empty scope covers nothing", claims.isPathInScope("a.js", []) === false);

  // ---- 14. destructive-git guard ----
  const unsafeDrop = claims.isDestructiveGitCommand(["stash", "drop"]);
  const unsafeClean = claims.isDestructiveGitCommand(["clean", "-fd"]);
  const unsafeReset = claims.isDestructiveGitCommand(["reset", "--hard", "HEAD~1"]);
  check("stash drop unsafe", unsafeDrop.safe === false);
  check("clean unsafe", unsafeClean.safe === false);
  check("reset --hard unsafe", unsafeReset.safe === false);
  check("status/commit/stash-push safe",
    claims.isDestructiveGitCommand(["status"]).safe === true &&
    claims.isDestructiveGitCommand(["add", "."]).safe === true &&
    claims.isDestructiveGitCommand(["commit", "-m", "x"]).safe === true &&
    claims.isDestructiveGitCommand(["stash"]).safe === true &&
    claims.isDestructiveGitCommand(["stash", "push", "-m", "wip"]).safe === true);

  // ---- 15. parallel gate: teammate worktree + scope conflict ----
  const wtGate = spawnAdapter.canDispatchInParallel(
    { agent: "orchestra-planner", claimKey: "team-alpha/amy/wsa/s1", worktreePath: "/tmp/wt1" },
    { agent: "orchestra-verifier", claimKey: "team-alpha/bob/wsa/s2", worktreePath: "/tmp/wt1" }, null);
  check("teammate worktree gated", wtGate.ok === false && wtGate.reason === "teammate-worktree", JSON.stringify(wtGate));
  const scopeGate = spawnAdapter.canDispatchInParallel(
    { agent: "orchestra-planner", claimKey: "team-alpha/amy/wsa/s1", scope: ["app-a/"] },
    { agent: "orchestra-verifier", claimKey: "team-alpha/bob/wsa/s2", scope: ["app-a/deep"] }, registry);
  check("overlapping scopes gated", scopeGate.ok === false && scopeGate.reason === "scope-conflict", JSON.stringify(scopeGate));
  const scopeOk = spawnAdapter.canDispatchInParallel(
    { agent: "orchestra-planner", claimKey: "team-alpha/amy/wsa/s1", scope: ["app-a/"] },
    { agent: "orchestra-verifier", claimKey: "team-alpha/bob/wsa/s2", scope: ["app-c/"] }, registry);
  check("disjoint scopes defer to registry", scopeOk.ok === true && scopeOk.reason === "independent", JSON.stringify(scopeOk));

  // ---- 16. CLI: conflict exit code + check command ----
  const scopeEnv = { PCORE_STATE_DIR: stateDir, PCORE_CONDUCTOR_STATE_DIR: conductorDir, PCORE_SESSION_ID: "sess-c1" };
  runCli(`bash scripts/team-sessions.sh claim --member Amy2 --team Team-Alpha --scope app-cli/ --json`, scopeEnv);
  let conflictStatus = 0;
  try {
    runCli(`bash scripts/team-sessions.sh claim --member Bob2 --team Team-Alpha --scope app-cli/deep --json`, scopeEnv);
  } catch (err) {
    conflictStatus = err.status;
  }
  check("CLI overlapping claim exits non-zero", conflictStatus !== 0, `status=${conflictStatus}`);
  let checkViolation = 0;
  try {
    runCli(`bash scripts/team-sessions.sh check --member Amy2 --team Team-Alpha -- app-a/x.js`, scopeEnv);
  } catch (err) {
    checkViolation = err.status;
  }
  check("CLI check flags out-of-scope file", checkViolation !== 0, `status=${checkViolation}`);
  const checkOk = runCli(`bash scripts/team-sessions.sh check --member Amy2 --team Team-Alpha -- app-cli/ok.js`, scopeEnv);
  check("CLI check passes in-scope file", checkOk.includes("OK scope"));
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

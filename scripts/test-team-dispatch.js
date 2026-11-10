#!/usr/bin/env node
"use strict";

/**
 * Self-check for team dispatch fan-out (`dispatch --team Alpha`):
 *  1. planDispatch: one session per member, sorted deterministic, any N
 *  2. unknown team -> [] (never throws, never claims)
 *  3. --member filter allowlist (sanitized, sorted)
 *  4. scope normalize (string/array, "*", dedupe, "./" + trailing slash)
 *  5. branch member/<team>/<member> + worktreePath optional (null without base)
 *  6. guard contract: SCOPE_CONFLICT -> skip-continue, other errors propagate
 *  7. payload additive: member/team/claimKey present, caller keys preserved
 *  8. serializeDispatch round-trips sorted plans
 *  9. zero-fs purity: module loads without fs/cp side effects (no state files)
 * 10. CLI smoke: dispatch --team --dry-run --json (zero side effects),
 *     live dispatch claims N members, SCOPE_CONFLICT member skipped (exit 2),
 *     missing --team exits non-zero
 *
 * All state is redirected to temp dirs (PCORE_STATE_DIR /
 * PCORE_CONDUCTOR_STATE_DIR); the real home config is never touched.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "team-dispatch-state-"));
const conductorDir = fs.mkdtempSync(path.join(os.tmpdir(), "team-dispatch-conductor-"));

// Pin env BEFORE requiring the libs under test.
process.env.PCORE_STATE_DIR = stateDir;
process.env.PCORE_CONDUCTOR_STATE_DIR = conductorDir;
delete process.env.PCORE_MEMBER_NAME;
delete process.env.PCORE_TEAM_NAME;
delete process.env.PCORE_MEMBER_ROLE;
delete process.env.PCORE_TASK_ID;
delete process.env.PCORE_WORKSPACE_ROOT;

const td = require("../bundle/hooks/lib/team-dispatch.js");
const pm = require("../bundle/hooks/lib/project-manager.js");

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

function stateBefore() {
  const entries = [];
  for (const d of [stateDir, conductorDir]) {
    try {
      for (const f of fs.readdirSync(d)) entries.push(path.join(d, f));
    } catch { /* missing dir = no state */ }
  }
  return entries.sort().join("\n");
}

let seedDir = null;
try {
  const teamsOf = (byMember) => ({
    "team-alpha": { teamId: "team-alpha", teamDisplay: "Team-alpha", items: [], byMember },
  });

  // ---- 1. one session per member, sorted deterministic, N-scalable ----
  const five = {};
  ["Priya", "mark", "JOHN", "sara", "james"].forEach((m, i) =>
    (five[m.toLowerCase()] = [{ id: `t${i}` }]));
  const plans = td.planDispatch({
    teamId: "Team-Alpha",
    teams: teamsOf(five),
    sessionId: "sess-1",
    workspaceSlug: "wsa",
    worktreeBase: "/tmp/wt-base",
  });
  check("N members -> N plans (5, no hardcode)",
    plans.length === 5, JSON.stringify(plans.length));
  const order = plans.map((p) => p.member).join(",");
  check("plans sorted deterministic",
    order === "james,john,mark,priya,sara", order);
  check("claimKey team/member/slug/session",
    plans[0].claimKey === "team-alpha/james/wsa/sess-1", plans[0].claimKey);
  const again = td.planDispatch({
    teamId: "team-alpha",
    teams: teamsOf(five),
    sessionId: "sess-1",
    workspaceSlug: "wsa",
    worktreeBase: "/tmp/wt-base",
  });
  check("case-insensitive team, repeatable output",
    JSON.stringify(again) === JSON.stringify(plans));

  // ---- 2. unknown team -> [] ----
  check("unknown team empty", Array.isArray(td.planDispatch({ teamId: "nope", teams: teamsOf(five) })) &&
    td.planDispatch({ teamId: "nope", teams: teamsOf(five) }).length === 0);
  check("missing team empty", td.planDispatch({ teams: teamsOf(five) }).length === 0);
  check("missing group empty", td.planDispatch({ teamId: "team-alpha", teams: {} }).length === 0);

  // ---- 3. --member filter ----
  const filtered = td.planDispatch({
    teamId: "team-alpha",
    teams: teamsOf(five),
    members: ["Sara", "john"],
    sessionId: "s",
    workspaceSlug: "w",
  });
  check("member filter allowlists + sorts",
    filtered.map((p) => p.member).join(",") === "john,sara",
    JSON.stringify(filtered.map((p) => p.member)));
  check("member filter unknown -> empty",
    td.planDispatch({ teamId: "team-alpha", teams: teamsOf(five), members: ["ghost"] }).length === 0);

  // ---- 4. scope normalize ----
  check("scope string+array normalize",
    JSON.stringify(td.normalizeDispatchScope(" app-a/,./app-b//,app-a ")) === JSON.stringify(["app-a", "app-b"]),
    JSON.stringify(td.normalizeDispatchScope(" app-a/,./app-b//,app-a ")));
  check("scope star short-circuits",
    JSON.stringify(td.normalizeDispatchScope(["x", "*"])) === JSON.stringify(["*"]));
  check("scope empty claims nothing",
    JSON.stringify(td.normalizeDispatchScope("")) === JSON.stringify([]));
  const scopedPlans = td.planDispatch({
    teamId: "team-alpha",
    teams: teamsOf({ amy: [{ id: "a", scope: "app-a/" }], bob: [{ id: "b", files: ["app-b/x.js"] }] }),
  });
  check("plan scope derived from item scope/files",
    JSON.stringify(scopedPlans[0].scope) === JSON.stringify(["app-a"]) &&
    JSON.stringify(scopedPlans[1].scope) === JSON.stringify(["app-b/x.js"]),
    JSON.stringify(scopedPlans.map((p) => p.scope)));

  // ---- 5. branch + worktreePath ----
  check("branch member/team/member",
    td.dispatchBranch({ team: "Team-Alpha", member: "John" }) === "member/team-alpha/john");
  check("plan branch per member",
    plans.every((p) => p.branch === `member/team-alpha/${p.member}`));
  check("worktreePath optional (null without base)",
    td.planDispatch({ teamId: "team-alpha", teams: teamsOf({ z: [{ id: "1" }] }) })[0].worktreePath === null);
  check("worktreePath joined under base",
    plans[0].worktreePath === path.join("/tmp/wt-base", "team-alpha-james"), plans[0].worktreePath);

  // ---- 6. guard contract ----
  const conflict = new Error("overlap");
  conflict.code = "SCOPE_CONFLICT";
  check("SCOPE_CONFLICT -> skip", td.shouldSkipOnConflict(conflict) === true);
  check("other error -> propagate (no skip)",
    td.shouldSkipOnConflict(new Error("boom")) === false &&
    td.shouldSkipOnConflict(null) === false);

  // ---- 7. payload additive ----
  const payload = td.buildDispatchPayload(plans[1], { goal: "g", phase: "implement" });
  check("payload carries member/team/claimKey",
    payload.member === "john" && payload.team === "team-alpha" &&
    payload.claimKey === "team-alpha/john/wsa/sess-1",
    JSON.stringify({ member: payload.member, team: payload.team, claimKey: payload.claimKey }));
  check("payload preserves caller keys",
    payload.goal === "g" && payload.phase === "implement" && payload.branch === "member/team-alpha/john");
  const explicit = td.buildDispatchPayload(plans[1], { member: "override" });
  check("explicit payload fields win", explicit.member === "override");

  // ---- 8. serialize round-trip ----
  const ser = td.serializeDispatch(plans);
  check("serializeDispatch round-trips sorted",
    JSON.stringify(JSON.parse(ser)) === JSON.stringify(plans));

  // ---- 9. purity: requiring + planning wrote no state ----
  check("no fs side effects from plan path",
    !fs.existsSync(path.join(stateDir, "team-sessions.json")),
    fs.readdirSync(stateDir).join(",") || "(empty)");

  // ---- backlogByMember wiring: HOD projection feeds planDispatch ----
  const ps = {
    backlog: [
      { id: "b1", title: "john ticket", assigned: { teamId: "team-alpha", memberKey: "john" } },
      { id: "b2", title: "james ticket", assigned: { teamId: "team-alpha", memberKey: "james" } },
    ],
    tasks: [],
  };
  const bb = pm.backlogByMember(ps);
  const wired = td.planDispatch({ teamId: "team-alpha", teams: bb.teams, sessionId: "s", workspaceSlug: "w" });
  check("backlogByMember -> planDispatch fans out",
    wired.length === 2 && wired.map((p) => p.member).join(",") === "james,john",
    JSON.stringify(wired.map((p) => p.member)));

  // ---- 10. CLI smoke: seed project state first (john/james disjoint,
  // amy/bob overlapping scopes) ----
  const cliEnv = { PCORE_STATE_DIR: stateDir, PCORE_CONDUCTOR_STATE_DIR: conductorDir };
  seedDir = fs.mkdtempSync(path.join(os.tmpdir(), "team-dispatch-seed-"));
  const seedFile = path.join(seedDir, "seed.js");
  fs.writeFileSync(seedFile, [
    "process.env.PCORE_STATE_DIR = " + JSON.stringify(stateDir) + ";",
    "const pm = require(" + JSON.stringify(path.join(ROOT, "bundle/hooks/lib/project-manager.js")) + ");",
    "const ps = pm.loadProjectState(undefined, 'sess-live-1');",
    "const cur = pm.getSessionProjectState(ps, 'sess-live-1');",
    "cur.backlog = [",
    "  { id: 'd1', title: 'amy work', assigned: { teamId: 'team-alpha', memberKey: 'amy' }, scope: 'app-live/' },",
    "  { id: 'd2', title: 'bob work', assigned: { teamId: 'team-alpha', memberKey: 'bob' }, scope: 'app-live/deep' },",
    "  { id: 'd3', title: 'john work', assigned: { teamId: 'team-alpha', memberKey: 'john' }, scope: 'app-john/' },",
    "  { id: 'd4', title: 'james work', assigned: { teamId: 'team-alpha', memberKey: 'james' }, scope: 'app-james/' },",
    "];",
    "pm.saveProjectState(cur, 'sess-live-1');",
  ].join("\n") + "\n");
  runCli(`node "${seedFile}"`, cliEnv);
  const snapBefore = stateBefore();
  const dry = JSON.parse(runCli(
    `bash scripts/team-sessions.sh dispatch --team Team-Alpha --member john,james --dry-run --json --session sess-live-1 --worktree-base "${stateDir}/wt"`,
    cliEnv));
  check("CLI dry-run plans N members",
    dry.dryRun === true && dry.plans.length === 2 &&
    dry.plans.map((p) => p.member).join(",") === "james,john",
    JSON.stringify(dry.plans && dry.plans.map((p) => p.member)));
  check("CLI dry-run zero side effects", stateBefore() === snapBefore,
    `${snapBefore} -> ${stateBefore()}`);
  let missingTeam = 0;
  try {
    runCli(`bash scripts/team-sessions.sh dispatch --json`, cliEnv);
  } catch (err) {
    missingTeam = err.status;
  }
  check("CLI dispatch without --team exits non-zero", missingTeam !== 0, `status=${missingTeam}`);

  // Live: amy claims app-live/, bob overlaps -> skipped, james/john disjoint.
  // Partial dispatch exits 2 by contract, so capture stdout from the error.
  let liveOut = "";
  try {
    liveOut = runCli(
      `bash scripts/team-sessions.sh dispatch --team Team-Alpha --session sess-live-1 --json --worktree-base "${stateDir}/wt-live"`,
      Object.assign({}, cliEnv, { PCORE_WORKSPACE_ROOT: stateDir }));
  } catch (err) {
    liveOut = err.stdout || "";
    check("CLI live partial signals exit 2", err.status === 2, `status=${err.status}`);
  }
  const live = JSON.parse(liveOut);
  check("CLI live dispatches 3, skips conflicted sibling",
    live.dispatched.length === 3 && live.skipped.length === 1 &&
    live.skipped[0].member === "bob" && live.skipped[0].reason === "SCOPE_CONFLICT",
    JSON.stringify({ d: live.dispatched.map((x) => x.member), s: live.skipped }));
  let liveStatus = 0;
  try {
    runCli(
      `bash scripts/team-sessions.sh dispatch --team Team-Alpha --session sess-live-1 --worktree-base "${stateDir}/wt-live"`,
      Object.assign({}, cliEnv, { PCORE_WORKSPACE_ROOT: stateDir }));
  } catch (err) {
    liveStatus = err.status;
  }
  check("CLI live partial exits 2", liveStatus === 2, `status=${liveStatus}`);
  check("CLI payload carries member/team/claimKey",
    live.dispatched[0].payload.member && live.dispatched[0].payload.team === "team-alpha" &&
    live.dispatched[0].payload.claimKey === live.dispatched[0].claimKey,
    JSON.stringify(live.dispatched[0].payload));
} finally {
  if (seedDir) { try { fs.rmSync(seedDir, { recursive: true, force: true }); } catch { /* ignore */ } }
  try { fs.rmSync(stateDir, { recursive: true, force: true }); } catch { /* ignore */ }
  try { fs.rmSync(conductorDir, { recursive: true, force: true }); } catch { /* ignore */ }
  delete process.env.PCORE_STATE_DIR;
  delete process.env.PCORE_CONDUCTOR_STATE_DIR;
}

if (failed) {
  console.log(`\nFAIL (${failed} checks)`);
  process.exit(1);
}
console.log("\nPASS (all checks)");

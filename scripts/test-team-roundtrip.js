#!/usr/bin/env node
"use strict";

/**
 * Self-check for the A<->B session reply round-trip (WI-1..WI-5 fix):
 * two SESSION_IDs share one PCORE_STATE_DIR with NO --worktree, and every
 * step must stay visible to both sides:
 *  1. claim alice (SES_A) + bob (SES_B) on team alpha (shared slug)
 *  2. A posts m2m --to bob (from = returned claimKey); B's member-filtered
 *     list sees it
 *  3. B replies m2m --to alice; A sees both (both directions, topology all)
 *  4. A posts a group broadcast; BOTH member-filtered lists see it
 *     (group addresses the team, not a member slot)
 *  5. resolve hides from bare list, --all shows it, getThread keeps it
 *  6. same-team wake A->B delivers; cross-team wake denied WAKE_CROSS_SCOPE
 *
 * Drives the real scripts/team-sessions.sh CLI (no lib shortcuts for the
 * pairing path); getThread is the only lib-level read. Temp dirs only.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "team-roundtrip-state-"));
const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), "team-roundtrip-ws-"));
const wsDir2 = fs.mkdtempSync(path.join(os.tmpdir(), "team-roundtrip-ws2-"));
const slug = path.basename(wsDir).toLowerCase().replace(/[^a-z0-9-]/g, "-");

process.env.PCORE_STATE_DIR = stateDir;
delete process.env.PCORE_CONDUCTOR_STATE_DIR;
delete process.env.PCORE_MEMBER_NAME;
delete process.env.PCORE_TEAM_NAME;
delete process.env.PCORE_MEMBER_ROLE;

let failed = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function cli(args, extraEnv) {
  return cp.execSync(`bash scripts/team-sessions.sh ${args}`, {
    cwd: ROOT,
    encoding: "utf8",
    env: Object.assign({}, process.env, extraEnv),
  });
}

function cliJson(args, extraEnv) {
  return JSON.parse(cli(`${args} --json`, extraEnv));
}

function cliStatus(args, extraEnv) {
  try {
    cli(args, extraEnv);
    return 0;
  } catch (err) {
    return typeof err.status === "number" ? err.status : 1;
  }
}

try {
  const A = `--member alice --team alpha --session SES_A --workspace ${wsDir}`;
  const B = `--member bob --team alpha --session SES_B --workspace ${wsDir}`;

  // ---- 1. claims share slug, differ by session ----
  const alice = cliJson(`claim ${A}`);
  const bob = cliJson(`claim ${B}`);
  check("claims share workspace slug",
    alice.workspaceSlug === slug && bob.workspaceSlug === slug,
    `${alice.claimKey} vs ${bob.claimKey}`);
  check("claims differ by session",
    alice.claimKey !== bob.claimKey &&
    alice.claimKey === `alpha/alice/${slug}/SES_A` &&
    bob.claimKey === `alpha/bob/${slug}/SES_B`,
    `${alice.claimKey} vs ${bob.claimKey}`);
  check("claims record per-member branch",
    alice.branch === "member/alpha/alice" && bob.branch === "member/alpha/bob");

  // ---- 2. A m2m -> B; B lists and sees it ----
  const postedA = cliJson(`discuss post ${A} --kind m2m --to bob --body "hello bob"`);
  check("A post from = returned claimKey", postedA.from === alice.claimKey, postedA.from);
  const bSees = cliJson(`discuss list ${B}`);
  check("B lists sees A's m2m",
    bSees.messages.length === 1 && bSees.messages[0].id === postedA.id &&
    bSees.messages[0].body === "hello bob",
    JSON.stringify(bSees.messages.map((m) => m.body)));

  // ---- 3. B replies; A sees both ----
  const postedB = cliJson(`discuss post ${B} --kind m2m --to alice --body "hi alice"`);
  check("B reply from = returned claimKey", postedB.from === bob.claimKey, postedB.from);
  const aSees = cliJson(`discuss list ${A}`);
  const bodies = aSees.messages.map((m) => m.body);
  check("A sees both directions",
    aSees.messages.length === 2 &&
    bodies.includes("hello bob") && bodies.includes("hi alice"),
    JSON.stringify(bodies));
  const twoWay = cliJson(`discuss list ${A} --topology 2way`);
  check("topology 2way keeps the pair", twoWay.messages.length === 2);

  // ---- 4. same group: broadcast visible to both member-filtered lists ----
  const bc = cliJson(`discuss post ${A} --kind group --body "team broadcast"`);
  check("group post stored", !!bc.id && bc.kind === "group");
  const bGroup = cliJson(`discuss list ${B}`);
  check("B member-filtered list sees group",
    bGroup.messages.some((m) => m.id === bc.id), JSON.stringify(bGroup.messages.map((m) => m.body)));
  const aGroup = cliJson(`discuss list ${A}`);
  check("A member-filtered list sees group + pair",
    aGroup.messages.length === 3 && aGroup.messages.some((m) => m.id === bc.id),
    JSON.stringify(aGroup.messages.map((m) => m.body)));
  const bare = cliJson(`discuss list --team alpha --workspace ${wsDir} --session SES_A`);
  check("bare team list (default topology=all) sees all three", bare.messages.length === 3);

  // ---- 5. resolve: bare hides, --all shows, getThread keeps ----
  cli(`discuss resolve --id ${postedA.id} ${A}`);
  const afterResolve = cliJson(`discuss list ${B}`);
  check("bare list hides resolved",
    afterResolve.messages.every((m) => !m.resolvedAt) &&
    !afterResolve.messages.some((m) => m.id === postedA.id));
  const withAll = cliJson(`discuss list ${B} --all`);
  check("list --all adds resolved",
    withAll.messages.some((m) => m.id === postedA.id && !!m.resolvedAt));
  const discussion = require("../bundle/hooks/lib/team-discussion.js");
  const thread = discussion.getThread(postedA.id);
  check("getThread includes resolved", thread.length === 1 && thread[0].id === postedA.id);

  // ---- 6. same-team wake delivers; cross-team denied ----
  const wOk = cliJson(`wake request ${A} --to bob --reason "review" --topic pair`);
  check("same-team wake A->B delivers",
    !!wOk.id && wOk.from === alice.claimKey && wOk.to === bob.claimKey,
    JSON.stringify(wOk).slice(0, 160));
  cli(`claim --member zed --team beta --session SES_Z --workspace ${wsDir2} --json`);
  const denyStatus = cliStatus(`wake request ${A} --to zed --json`, undefined);
  check("cross-team cross-workspace wake denied (exit 2)", denyStatus === 2, `status=${denyStatus}`);
  const wList = cliJson(`wake list --member bob --team alpha --workspace ${wsDir} --session SES_B`);
  check("B wake list sees the nudge", (wList.wakes || []).some((w) => w.id === wOk.id));
} finally {
  try { fs.rmSync(stateDir, { recursive: true, force: true }); } catch { /* ignore */ }
  try { fs.rmSync(wsDir, { recursive: true, force: true }); } catch { /* ignore */ }
  try { fs.rmSync(wsDir2, { recursive: true, force: true }); } catch { /* ignore */ }
  delete process.env.PCORE_STATE_DIR;
}

if (failed) {
  console.log(`\nFAIL (${failed} checks)`);
  process.exit(1);
}
console.log("\nPASS (all checks)");

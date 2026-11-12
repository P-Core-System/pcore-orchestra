"use strict";

/**
 * HOD loop + R&D scoring tests (temp-dir only, no network).
 * Covers team-supervisor (sweep/nextAction/branch/worktree),
 * team-requests (FIFO durable), team-done (SHA gate) and
 * team-research (scoreOption/pickBest).
 */

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const LIB = path.join(__dirname, "..", "bundle", "hooks", "lib");
const supervisor = require(path.join(LIB, "team-supervisor.js"));
const queueLib = require(path.join(LIB, "team-requests.js"));
const doneLib = require(path.join(LIB, "team-done.js"));
const research = require(path.join(LIB, "team-research.js"));

let n = 0;
function ok(cond, msg) {
  n += 1;
  assert.ok(cond, msg);
  console.log(`ok ${n} - ${msg}`);
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "hod-"));

// --- supervisor: sweep grants requests first, skips busy ---
{
  const r = supervisor.sweep({
    backlog: { alice: { team: "alpha", items: [{ id: "a1" }] }, bob: { team: "alpha", items: [{ id: "b1" }] } },
    claims: [{ memberKey: "bob", team: "alpha", scope: ["x/"] }],
    requests: [{ id: "req_1", member: "alice", team: "alpha", topic: "t", status: "pending" }],
    opts: { team: "alpha", sessionId: "s1", workspaceSlug: "ws" },
  });
  ok(r.assignments.length === 1 && r.assignments[0].member === "alice", "sweep grants request, skips busy bob");
  ok(r.assignments[0].via === "request" && r.assignments[0].branch === "member/alpha/alice", "request via + member branch");
  ok(r.grantedRequestIds.join() === "req_1", "granted id returned");
}

// --- supervisor: push remainder FIFO-by-member, unknown skipped ---
{
  const r = supervisor.sweep({
    backlog: { zed: { team: "alpha", items: [{ id: "z" }] }, amy: { team: "alpha", items: [{ id: "a" }] } },
    claims: [], requests: [],
    opts: { team: "alpha" },
  });
  ok(r.assignments.map((a) => a.member).join() === "amy,zed", "push sorted deterministic");
  ok(r.assignments[0].via === "push", "push via");
}

// --- supervisor: busy members never assigned even with requests ---
{
  const r = supervisor.sweep({
    backlog: { al: { team: "a", items: [{ id: 1 }] } },
    claims: [{ member: "al" }],
    requests: [{ id: "r1", member: "al", status: "pending" }],
    opts: {},
  });
  ok(r.assignments.length === 0, "busy member with request stays unassigned");
}

// --- nextAction: work / idle / release ---
{
  ok(supervisor.nextAction("al", { backlog: { al: { team: "a", items: [{ id: 1 }] } }, claims: [] }).action === "work", "nextAction work when free with items");
  ok(supervisor.nextAction("al", { backlog: {}, claims: [] }).action === "idle", "nextAction idle when nothing");
  ok(supervisor.nextAction("al", { backlog: {}, claims: [{ memberKey: "al" }] }).action === "release", "nextAction release when busy and empty");
}

// --- memberWorktree: deterministic, never /tmp ---
{
  const w = supervisor.memberWorktree("/repo/.pcore/worktrees", "Alpha", "Al");
  ok(w === path.join("/repo/.pcore/worktrees", "member-alpha-al"), "member worktree path deterministic");
  const t = supervisor.memberWorktree("/tmp/x", "a", "b");
  ok(!t.startsWith("/tmp/"), "tmp base rejected");
}

// --- requests: FIFO durable, grant oldest ---
{
  const d = tmp();
  const r1 = queueLib.enqueue(d, { member: "al", team: "a", topic: "one" });
  const r2 = queueLib.enqueue(d, { member: "al", team: "a", topic: "two" });
  ok(r1.status === "pending" && typeof r1.id === "string", "enqueue pending with id");
  ok(queueLib.list(d, {}).length === 2, "list pending two");
  const g = queueLib.grant(d, "al");
  ok(g && g.id === r1.id, "grant oldest FIFO");
  ok(queueLib.list(d, {}).length === 1 && queueLib.list(d, {})[0].id === r2.id, "one pending left");
  ok(queueLib.list(d, { all: true }).length === 2, "--all keeps granted");
  ok(queueLib.grant(d, "nobody") === null, "grant unknown member null");
  ok(!String(fs.readdirSync(d).join()).includes(".tmp"), "no .tmp residue");
}

// --- done: SHA gate + latest ---
{
  const d = tmp();
  const bad = doneLib.report(d, { member: "al", sha: "zzz" });
  ok(bad.ok === false && bad.code === "DONE_BAD_SHA", "malformed SHA refused");
  const noM = doneLib.report(d, { member: "", sha: "abc1234" });
  ok(noM.ok === false && noM.code === "DONE_NO_MEMBER", "missing member refused");
  const good = doneLib.report(d, { member: "al", team: "a", sha: "abc1234", branch: "member/a/al", summary: "s" });
  ok(good.ok === true && good.report.sha === "abc1234", "valid SHA recorded");
  doneLib.report(d, { member: "al", sha: "deadbeef" });
  ok(doneLib.latestByMember(d).al.sha === "deadbeef", "latest wins per member");
  ok(doneLib.isHexSha("ABC1234") && !doneLib.isHexSha("xyz") && !doneLib.isHexSha(""), "isHexSha shape");
}

// --- research: weights + determinism ---
{
  ok(research.scoreOption({ maturity: 1, maintenance: 1, licenseOk: true, docs: 1, perf: 1, cost: 1 }) === 100, "perfect scores 100");
  ok(research.scoreOption({}) === 0, "missing inputs score 0, never help");
  ok(research.scoreOption({ licenseOk: true }) === 20, "license gate binary 20");
  const p = research.pickBest([
    { name: "b", maturity: 0.5, licenseOk: true },
    { name: "a", maturity: 0.5, licenseOk: true },
  ]);
  ok(p.best.name === "a", "ties break by name");
  ok(p.ranked[0].margin === 0 && p.ranked.length === 2, "margins from top");
  const empty = research.pickBest([]);
  ok(empty.best === null && empty.ranked.length === 0, "empty never throws");
}

// --- spawn adapter: background + waves (additive, fail-open) ---
{
  const adapter = require(path.join(LIB, "spawn-adapter.js"));
  ok(typeof adapter.spawnBackground === "function", "spawnBackground exported");
  ok(typeof adapter.teamParallelWaves === "function", "teamParallelWaves exported");
  const h = adapter.spawnBackground("nope-agent", {}, null, "no-such-host");
  ok(h && h.detached === true && typeof h.startedAt === "string", "background returns detached handle, never throws");
  const waves = adapter.teamParallelWaves(
    [{ claimKey: "a/1", scope: "x/" }, { claimKey: "a/1", scope: "x/" }],
    {}
  );
  ok(waves.length === 2, "same-claim assignments serialize into separate waves");
}

console.log(`\nHOD tests: ${n} checks passed`);

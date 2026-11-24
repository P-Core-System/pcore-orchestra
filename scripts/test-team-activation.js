#!/usr/bin/env node
"use strict";

/**
 * Self-check for team auto-activation (post/wake -> OpenCode synthetic input):
 *  1. pure planner: N group recipients -> N activation plans
 *  2. sender excluded by claim key AND by session id (parallel slot)
 *  3. targeted post/wake: explicit claim key or member token only
 *  4. stale / sessionless / no-URL / missing-target recipients skipped,
 *     never thrown
 *  5. SQLite: one send per recipient, audit trail, duplicate event is a no-op
 *  6. JSON fallback (PCORE_USE_SQLITE=0): same dedupe + audit behavior
 *  7. CLI captures --server-url / PCORE_OPENCODE_SERVER_URL on claim
 *  8. trigger wiring: a durable post / wake audits activation without a send
 *  9. kill switch PCORE_TEAM_ACTIVATE=0 disables everything
 * 10. synthetic sender uses an injected runner (never a live server)
 *
 * All state is redirected to temp dirs; no live OpenCode server is contacted.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");

function freshState(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `team-activation-${label}-`));
  process.env.PCORE_STATE_DIR = dir;
  return dir;
}

function dropState(dirs) {
  for (const dir of dirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

const dirs = [freshState("main")];
delete process.env.PCORE_TEAM_ACTIVATE;
delete process.env.PCORE_OPENCODE_SERVER_URL;
delete process.env.PCORE_USE_SQLITE;

const activation = require("../bundle/hooks/lib/team-activation.js");
const store = require("../bundle/hooks/lib/session-store.js");
const synthetic = require("../bundle/hooks/lib/opencode-synthetic.js");
const claimsLib = require("../bundle/hooks/lib/team-claims.js");

let failed = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function claim(overrides) {
  return Object.assign({
    claimKey: "team-alpha/amy/ws/s-amy",
    member: "amy",
    team: "team-alpha",
    teamId: "team-alpha",
    sessionId: "s-amy",
    serverUrl: "http://127.0.0.1:4096",
    stale: false,
  }, overrides || {});
}

function event(kind, id, overrides) {
  return Object.assign({
    id,
    from: "team-alpha/hod/ws/s-hod",
    fromMember: "hod",
    team: "team-alpha",
    topic: "kickoff",
    body: "please review the PR",
    reason: "nudge",
    projectSlug: "activation-test",
  }, overrides || {});
}

function recorder(sent) {
  return (sessionId, text, opts) => {
    sent.push({ sessionId, text, serverUrl: opts && opts.serverUrl });
    return { ok: true };
  };
}

/* --- 1. pure planner: group fan-out -------------------------------------- */
const roster = [
  claim(),
  claim({ claimKey: "team-alpha/ben/ws/s-ben", member: "ben", sessionId: "s-ben" }),
  claim({ claimKey: "team-alpha/cyd/ws/s-cyd", member: "cyd", sessionId: "s-cyd" }),
  claim({ claimKey: "team-beta/dee/ws/s-dee", member: "dee", sessionId: "s-dee", team: "team-beta", teamId: "team-beta" }),
];
const groupPlans = activation.planActivations("post", event("post", "d_group"), roster, "team-alpha", "team-alpha/hod/ws/s-hod", "s-hod");
check("group plans one send per same-team recipient", groupPlans.length === 3, JSON.stringify(groupPlans.map((p) => p.claimKey)));
check("group plans carry session + normalized URL", groupPlans.every((p) => p.sessionId && p.serverUrl === "http://127.0.0.1:4096"));
check("group dedupe keys are unique per recipient", new Set(groupPlans.map((p) => p.dedupeKey)).size === 3);
check("invalid event kind plans nothing", activation.planActivations("unknown", event("post", "d_x"), roster, "team-alpha", "", "").length === 0);

/* --- 2. sender excluded by claim key AND session id ---------------------- */
const selfPlans = activation.planActivations("post", event("post", "d_self"), [
  claim({ claimKey: "team-alpha/amy/ws/s-amy", member: "amy", sessionId: "s-amy" }),
  claim({ claimKey: "team-alpha/amy/ws/s-parallel", member: "amy", sessionId: "s-amy" }),
  claim({ claimKey: "team-alpha/ben/ws/s-ben", member: "ben", sessionId: "s-ben" }),
], "team-alpha", "team-alpha/amy/ws/s-amy", "s-amy");
check("sender excluded by claim key and session id", selfPlans.length === 1 && selfPlans[0].claimKey.indexOf("/ben/") !== -1, JSON.stringify(selfPlans.map((p) => p.claimKey)));

/* --- 3. targeted post/wake ----------------------------------------------- */
const targetedByKey = activation.planActivations("post", event("post", "d_to_key", { to: "team-alpha/ben/ws/s-ben" }), roster, "team-alpha", "", "");
check("targeted post by claim key selects one recipient", targetedByKey.length === 1 && targetedByKey[0].member === "ben", JSON.stringify(targetedByKey.map((p) => p.claimKey)));
const targetedByMember = activation.planActivations("wake", event("wake", "w_to_member", { to: "Cyd" }), roster, "team-alpha", "", "");
check("targeted wake by member token selects one recipient", targetedByMember.length === 1 && targetedByMember[0].member === "cyd", JSON.stringify(targetedByMember.map((p) => p.claimKey)));
const targetedOtherTeam = activation.planActivations("post", event("post", "d_cross", { to: "dee" }), roster, "team-alpha", "", "");
check("targeted recipient must be in the same team", targetedOtherTeam.length === 0);

/* --- 4. stale / no-URL / sessionless / missing --------------------------- */
const skipPlans = activation.planActivations("post", event("post", "d_skips"), [
  claim({ claimKey: "team-alpha/stale/ws/s1", member: "stale", stale: true }),
  claim({ claimKey: "team-alpha/nourl/ws/s2", member: "nourl", serverUrl: null }),
  claim({ claimKey: "team-alpha/badurl/ws/s3", member: "badurl", serverUrl: "ftp://bad" }),
  claim({ claimKey: "team-alpha/nosess/ws", member: "nosess", sessionId: "" }),
  claim(),
], "team-alpha", "", "");
check("stale recipient skipped", skipPlans.filter((p) => p.skipReason === "stale").length === 1);
check("no-URL and invalid-URL recipients skipped", skipPlans.filter((p) => p.skipReason === "no-url").length === 2);
check("sessionless recipient skipped", skipPlans.filter((p) => p.skipReason === "no-session").length === 1);
check("eligible recipient survives skip filtering", skipPlans.filter((p) => !p.skipReason).length === 1);
const skipResult = activation.activateEvent("post", event("post", "d_missing", { to: "ghost" }), { claims: [], send: recorder([]) });
check("missing target is audited as skipped without throwing", skipResult.ok && skipResult.skipped.length === 1 && skipResult.skipped[0].reason === "missing", JSON.stringify(skipResult));

/* --- 5. SQLite: one send per recipient, audit + dedupe ------------------- */
const sentSqlite = [];
const evSqlite = event("post", "d_sqlite");
const activeRoster = [claim(), claim({ claimKey: "team-alpha/ben/ws/s-ben", member: "ben", sessionId: "s-ben" })];
const first = activation.activateEvent("post", evSqlite, { claims: activeRoster, send: recorder(sentSqlite) });
check("SQLite: one send per recipient", first.sent.length === 2 && sentSqlite.length === 2, JSON.stringify(first));
check("SQLite: synthetic text includes event kind, id and body", sentSqlite.every((s) => s.text.includes("post") && s.text.includes("d_sqlite") && s.text.includes("review")));
check("SQLite: recipient URL is passed to the sender", sentSqlite.every((s) => s.serverUrl === "http://127.0.0.1:4096"));
const second = activation.activateEvent("post", evSqlite, { claims: activeRoster, send: recorder(sentSqlite) });
check("SQLite: duplicate event sends nothing (at-most-once)", second.sent.length === 0 && sentSqlite.length === 2, JSON.stringify(second));
const auditRows = activation.listActivations({ eventKind: "post" }).filter((row) => row.event_id === "d_sqlite");
check("SQLite: audit has one sent row per recipient", auditRows.filter((row) => row.status === "sent").length === 2, JSON.stringify(auditRows.map((r) => r.status)));
const wakeSent = [];
const wRes = activation.activateEvent("wake", event("wake", "w_sqlite", { to: "ben" }), { claims: activeRoster, send: recorder(wakeSent) });
check("SQLite: targeted wake sends once", wRes.sent.length === 1 && wakeSent.length === 1, JSON.stringify(wRes));
const wDup = activation.activateEvent("wake", event("wake", "w_sqlite", { to: "ben" }), { claims: activeRoster, send: recorder(wakeSent) });
check("SQLite: duplicate wake sends nothing", wDup.sent.length === 0 && wakeSent.length === 1);

/* --- 6. JSON fallback (PCORE_USE_SQLITE=0) ------------------------------- */
store.closeDb();
const jsonDir = freshState("json");
dirs.push(jsonDir);
process.env.PCORE_USE_SQLITE = "0";
const sentJson = [];
const evJson = event("post", "d_json");
const jsonFirst = activation.activateEvent("post", evJson, { claims: activeRoster, send: recorder(sentJson) });
check("JSON fallback: one send per recipient", jsonFirst.sent.length === 2 && sentJson.length === 2, JSON.stringify(jsonFirst));
const jsonSecond = activation.activateEvent("post", evJson, { claims: activeRoster, send: recorder(sentJson) });
check("JSON fallback: duplicate event sends nothing", jsonSecond.sent.length === 0 && sentJson.length === 2, JSON.stringify(jsonSecond));
const auditFile = path.join(jsonDir, activation.AUDIT_FILE);
let auditText = "";
try { auditText = fs.readFileSync(auditFile, "utf8"); } catch { /* checked below */ }
check("JSON fallback: audit file persists sent rows", auditText.includes('"status": "sent"') || auditText.includes('"status":"sent"'), auditText.slice(0, 120));
check("JSON fallback: no SQLite DB created", !fs.existsSync(path.join(jsonDir, "team-sessions.db")));

/* --- 7. CLI URL capture (SQLite + JSON fallback) ------------------------- */
function runCli(args, env) {
  return cp.execFileSync("bash", [path.join("scripts", "team-sessions.sh")].concat(args), {
    cwd: ROOT,
    encoding: "utf8",
    env: Object.assign({}, process.env, env),
  });
}

const ws = fs.mkdtempSync(path.join(os.tmpdir(), "team-activation-ws-"));
dirs.push(ws);
const cliBase = {
  PCORE_STATE_DIR: jsonDir,
  PCORE_USE_SQLITE: "0",
  PCORE_WORKSPACE_ROOT: ws,
  PCORE_SESSION_ID: "s-cli",
};
const claimedJson = JSON.parse(runCli([
  "claim", "--member", "CliAmy", "--team", "Team-Alpha", "--workspace", ws,
  "--session", "s-cli", "--server-url", "http://127.0.0.1:4096/", "--json",
], cliBase));
check("CLI --server-url stored on claim (JSON fallback)", claimedJson.serverUrl === "http://127.0.0.1:4096", JSON.stringify(claimedJson).slice(0, 200));
const foundJson = JSON.parse(runCli(["who", "--team", "Team-Alpha", "--json"], cliBase));
check("CLI claim URL survives JSON reload", JSON.stringify(foundJson).includes("http://127.0.0.1:4096"));

store.closeDb();
const sqliteCliDir = freshState("cli-sqlite");
dirs.push(sqliteCliDir);
const claimedSqlite = JSON.parse(runCli([
  "claim", "--member", "CliBen", "--team", "Team-Alpha", "--workspace", ws,
  "--session", "s-cli2", "--json",
], {
  PCORE_STATE_DIR: sqliteCliDir,
  PCORE_USE_SQLITE: "1",
  PCORE_WORKSPACE_ROOT: ws,
  PCORE_SESSION_ID: "s-cli2",
  PCORE_OPENCODE_SERVER_URL: "http://127.0.0.1:4097",
}));
check("CLI PCORE_OPENCODE_SERVER_URL captured on claim (SQLite)", claimedSqlite.serverUrl === "http://127.0.0.1:4097", JSON.stringify(claimedSqlite).slice(0, 200));
delete process.env.PCORE_USE_SQLITE;
process.env.PCORE_STATE_DIR = sqliteCliDir;
store.closeDb();
const foundSqlite = claimsLib.getClaim(claimedSqlite.claimKey);
check("SQLite claim URL survives reload", !!foundSqlite && foundSqlite.serverUrl === "http://127.0.0.1:4097");

/* --- 8. trigger wiring after durable store ------------------------------- */
delete process.env.PCORE_USE_SQLITE;
store.closeDb();
const triggerDir = freshState("triggers");
dirs.push(triggerDir);
const triggerEnv = {
  PCORE_STATE_DIR: triggerDir,
  PCORE_USE_SQLITE: "1",
  PCORE_WORKSPACE_ROOT: ws,
  PCORE_SESSION_ID: "s-trigger",
};
runCli([
  "claim", "--member", "TrigMia", "--team", "Team-Alpha", "--workspace", ws,
  "--session", "s-trigger", "--json",
], triggerEnv);
runCli([
  "claim", "--member", "TrigBob", "--team", "Team-Alpha", "--workspace", ws,
  "--session", "s-trigger-bob", "--json",
], Object.assign({}, triggerEnv, { PCORE_SESSION_ID: "s-trigger-bob" }));
const posted = JSON.parse(runCli([
  "discuss", "post", "--member", "TrigMia", "--team", "Team-Alpha",
  "--kind", "group", "--body", "team broadcast", "--json",
], triggerEnv));
const postAudit = activation.listActivations({ eventKind: "post" }).filter((row) => row.event_id === posted.id);
check("durable post triggers an activation audit (no live send)", postAudit.length === 1 && postAudit[0].status === "skipped" && postAudit[0].reason === "no-url", JSON.stringify(postAudit));
const woke = JSON.parse(runCli([
  "wake", "request", "--member", "TrigMia", "--team", "Team-Alpha",
  "--to", "TrigBob", "--reason", "review", "--json",
], triggerEnv));
const wakeAudit = activation.listActivations({ eventKind: "wake" }).filter((row) => row.event_id === woke.id);
check("durable wake triggers an activation audit (no live send)", wakeAudit.length === 1 && wakeAudit[0].status === "skipped" && wakeAudit[0].reason === "no-url", JSON.stringify(wakeAudit));

/* --- 9. kill switch ------------------------------------------------------ */
const killSent = [];
const killResult = activation.activateEvent("post", event("post", "d_kill"), {
  claims: activeRoster,
  send: recorder(killSent),
  env: { PCORE_TEAM_ACTIVATE: "0" },
});
check("kill switch disables activation with no sends", killResult.disabled === true && killResult.sent.length === 0 && killSent.length === 0, JSON.stringify(killResult));
check("kill switch writes no audit rows", activation.listActivations({ eventKind: "post" }).every((row) => row.event_id !== "d_kill"));

/* --- 10. synthetic sender uses injected runner --------------------------- */
const runnerCalls = [];
const sendResult = synthetic.sendSynthetic("s-ben", "wake nudge", {
  serverUrl: "http://127.0.0.1:4096/",
  runner: (args, opts) => { runnerCalls.push({ args, opts }); return "{}"; },
});
check("synthetic sender posts to the session endpoint", sendResult.ok && runnerCalls.length === 1 &&
  runnerCalls[0].args[0] === "api" && runnerCalls[0].args[1] === "post" &&
  runnerCalls[0].args[2] === "/api/session/s-ben/synthetic" &&
  runnerCalls[0].args[3] === "--data" && runnerCalls[0].args[5] === "--server" &&
  runnerCalls[0].args[6] === "http://127.0.0.1:4096", JSON.stringify(runnerCalls));
check("synthetic sender sends the text payload", runnerCalls.length === 1 && JSON.parse(runnerCalls[0].args[4]).text === "wake nudge");
check("synthetic sender fails open without a URL", synthetic.sendSynthetic("s-ben", "text", { serverUrl: "", runner: () => "{}" }).reason === "no-url");

dropState(dirs);
console.log(failed === 0 ? "\nAll team activation tests passed." : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

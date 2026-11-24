"use strict";

/** test-team-listen.js — team-listen.js client: filter/URL/formatter + live WS reconnect. */

const path = require("node:path");
const { WebSocketServer } = require(path.join(__dirname, "..", "server", "node_modules", "ws"));
const http = require("node:http");

const mod = require("./team-listen.js");
const { listen, buildUrl, parseList, passesFilter, fmtEvent, DEFAULT_PORT, DEFAULT_HOST, DEFAULT_PATH } = mod;

let passes = 0;
let fails = 0;
function ok(cond, msg) {
  if (cond) { passes += 1; console.log(`PASS ${msg}`); }
  else { fails += 1; console.log(`FAIL ${msg}`); }
}
function eq(actual, expected, msg) {
  ok(String(actual) === String(expected), `${msg} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
}

// ---------- unit: parseList ----------
eq(parseList("a,b,c").join(","), "a,b,c", "parseList comma split");
eq(parseList("").length, 0, "parseList empty");
eq(parseList("  x , y ").join(","), "x,y", "parseList trims");

// ---------- unit: buildUrl ----------
eq(buildUrl({ host: DEFAULT_HOST, port: DEFAULT_PORT, path: DEFAULT_PATH, types: [], teams: [] }), `ws://${DEFAULT_HOST}:${DEFAULT_PORT}${DEFAULT_PATH}`, "buildUrl bare");
eq(buildUrl({ host: DEFAULT_HOST, port: 9999, path: DEFAULT_PATH, types: ["discussion.posted"], teams: ["Alpha"] }), `ws://${DEFAULT_HOST}:9999${DEFAULT_PATH}?type=discussion.posted&team=Alpha`, "buildUrl with filters");

// ---------- unit: passesFilter ----------
ok(passesFilter({ type: "discussion.posted" }, [], []), "passesFilter no filter passes all");
ok(!passesFilter({ type: "wake.delivered" }, ["discussion.posted"], []), "passesFilter type excludes");
ok(passesFilter({ type: "wake.delivered", data: { team: "Alpha" } }, [], ["Alpha"]), "passesFilter team match");
ok(!passesFilter({ type: "wake.delivered", data: { team: "Beta" } }, [], ["Alpha"]), "passesFilter team mismatch");
ok(passesFilter({ type: "discussion.posted", data: { from: "alice" } }, ["discussion.posted"], []), "passesFilter type-only ignores team");

// ---------- P0 (rebased): URL encoding + case-insensitive parity with server matchWsEvent ----------
eq(buildUrl({ host: DEFAULT_HOST, port: DEFAULT_PORT, path: DEFAULT_PATH, types: [], teams: ["team a/b"] }), `ws://${DEFAULT_HOST}:${DEFAULT_PORT}${DEFAULT_PATH}?team=team%20a%2Fb`, "buildUrl encodes values");
ok(passesFilter({ type: "Gate.Passed" }, ["gate.passed"], []), "passesFilter type case-insensitive");
ok(passesFilter({ type: "wake.delivered", data: { team: "ALPHA" } }, [], ["alpha"]), "passesFilter team case-insensitive");
{
  // Filter values here are lowercase, exactly as server parseWsFilter stores
  // them (it lowercases on parse), so client and server must agree exactly.
  const serverWs = require("../server/ws.js");
  const matrix = [
    [{ type: "wake.delivered", data: { team: "team-alpha" } }, { types: ["wake.delivered"], teams: ["team-alpha"] }],
    [{ type: "wake.delivered", data: { team: "team-alpha" } }, { types: ["gate.passed"], teams: [] }],
    [{ type: "wake.delivered", data: { team: "team-alpha" } }, { types: [], teams: ["team-beta"] }],
    [{ type: "gate.passed", data: {} }, { types: [], teams: [] }],
    [{ type: "Gate.Passed", data: { team: "Team-Alpha" } }, { types: ["gate.passed"], teams: ["team-alpha"] }],
    [{ type: "phase.started" }, { types: ["phase.started"], teams: ["ghost"] }],
  ];
  let parityOk = true;
  for (const [event, filter] of matrix) {
    const a = passesFilter(event, filter.types, filter.teams);
    const b = serverWs.matchWsEvent(event, filter);
    if (a !== b) {
      parityOk = false;
      console.log(`FAIL parity event=${JSON.stringify(event)} filter=${JSON.stringify(filter)} client=${a} server=${b}`);
    }
  }
  ok(parityOk, "passesFilter agrees with server matchWsEvent");
}

// ---------- unit: fmtEvent ----------
const f1 = fmtEvent({ type: "discussion.posted", at: "2026-01-01", data: { messageId: "m1", kind: "m2m", team: "Alpha", from: "alice", to: "bob", topic: "kick" } });
ok(f1.includes("type=discussion.posted") && f1.includes("msg=m1") && f1.includes("team=Alpha") && f1.includes("from=alice"), "fmtEvent discussion");
const f2 = fmtEvent({ type: "done.reported", at: "t", data: { doneId: "d1", member: "john", sha: "abc1234", summary: "fix" } });
ok(f2.includes("done=d1") && f2.includes("from=john") && f2.includes("sha=abc1234"), "fmtEvent done");

// ---------- defaults ----------
eq(DEFAULT_PORT, 3110, "DEFAULT_PORT 3110");
eq(DEFAULT_HOST, "127.0.0.1", "DEFAULT_HOST loopback");
eq(DEFAULT_PATH, "/api/ws", "DEFAULT_PATH");

// ---------- integration: real WS connect + message + type filter ----------
async function integration() {
  const srv = http.createServer((req, res) => { res.writeHead(404); res.end(); });
  await new Promise((res) => srv.listen(0, "127.0.0.1", res));
  const port = srv.address().port;
  const wss = new WebSocketServer({ server: srv, path: "/api/ws" });
  wss.on("connection", (ws) => {
    ws.send(JSON.stringify({ type: "discussion.posted", at: "T1", data: { messageId: "m1", kind: "m2m", team: "Alpha", from: "alice", to: "bob", topic: "kick" } }));
  });

  const events = [];
  const client = listen(
    { host: DEFAULT_HOST, port, path: DEFAULT_PATH, types: [], teams: [] },
    (ev) => { if (ev.type && !ev.type.startsWith("_")) events.push(ev); }
  );
  await new Promise((res) => {
    const t = setInterval(() => { if (events.length >= 1) { clearInterval(t); res(); } }, 50);
    setTimeout(() => { clearInterval(t); res(); }, 5000);
  });
  eq(events.length, 1, "integration: first live message received");
  eq(events[0].type, "discussion.posted", "integration: first message type");
  eq(events[0].data.messageId, "m1", "integration: first message id");

  // type filter: only discussion.posted passes
  const filtered = [];
  const client2 = listen(
    { host: DEFAULT_HOST, port, path: DEFAULT_PATH, types: ["discussion.posted"], teams: [] },
    (ev) => { if (ev.type && !ev.type.startsWith("_")) filtered.push(ev); }
  );
  await new Promise((res) => {
    const t = setInterval(() => { if (filtered.length >= 1) { clearInterval(t); res(); } }, 50);
    setTimeout(() => { clearInterval(t); res(); }, 5000);
  });
  eq(filtered.length, 1, "integration: type filter passes only discussion.posted");
  eq(filtered[0].type, "discussion.posted", "integration: filtered message type");

  client.close();
  client2.close();
  wss.close();
  srv.close(() => process.exit(0));
}

async function main() {
  await integration();
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails > 0 ? 1 : 0);
}
main().catch((e) => { console.error("fatal", e); process.exit(2); });

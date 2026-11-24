#!/usr/bin/env node
"use strict";

/**
 * ws-batch P0: inbound injection wrap + outbound/filter hardening.
 *
 * Pure-function suite (no sockets, no `ws` dependency): drives
 * `server/ws.js` `handleInboundFrame` / `clampOutboundEvent` /
 * `parseWsFilter` directly so it stays green without `npm install`.
 */

const ws = require("../server/ws.js");

let passed = 0;
let failed = 0;

function check(name, cond, detail) {
  if (cond) {
    console.log(`  ✓ ${name}`);
    passed += 1;
  } else {
    console.log(`  ✗ ${name}${detail !== undefined ? ` — ${detail}` : ""}`);
    failed += 1;
  }
}

console.log("\n=== ws inbound P0 ===\n");

// ---- 1. valid frames ack, never close without a tracker flood ----
{
  const ping = ws.handleInboundFrame(JSON.stringify({ type: "ping" }));
  check("ping acks with a pong reply", ping.action === "ack" && ping.reply && ping.reply.type === "pong", JSON.stringify(ping));
  const sub = ws.handleInboundFrame(JSON.stringify({ type: "subscribe", team: "team-alpha" }));
  check("subscribe acks", sub.action === "ack", JSON.stringify(sub));
  const bare = ws.handleInboundFrame(JSON.stringify({}));
  check("typeless object acks (ignored)", bare.action === "ack" && bare.reason === "ignored", JSON.stringify(bare));
  const buf = ws.handleInboundFrame(Buffer.from(JSON.stringify({ type: "ping" })));
  check("Buffer frames parse", buf.action === "ack", JSON.stringify(buf));
}

// ---- 2. violations drop, never route anywhere ----
{
  check("non-JSON drops", ws.handleInboundFrame("not json{{").action === "drop");
  check("array drops", ws.handleInboundFrame("[1,2]").action === "drop");
  check("null drops", ws.handleInboundFrame("null").action === "drop");
  check("unknown type drops", ws.handleInboundFrame(JSON.stringify({ type: "rm -rf /" })).action === "drop");
  check("injection-ish type drops", ws.handleInboundFrame(JSON.stringify({ type: "__proto__" })).action === "drop");
  check("bad team token drops", ws.handleInboundFrame(JSON.stringify({ team: "../../etc/passwd" })).action === "drop");
  check("non-string team drops", ws.handleInboundFrame(JSON.stringify({ team: 42 })).action === "drop");
  check("oversize frame drops", ws.handleInboundFrame(`{"type":"ping","pad":"${"x".repeat(70 * 1024)}"}`).action === "drop");
  const atLimit = ws.handleInboundFrame(JSON.stringify({ type: "ping" }));
  check("small frame is not oversize", atLimit.action === "ack", JSON.stringify(atLimit));
}

// ---- 3. drop+warn default, close only on flood ----
{
  const tracker = { violations: [], now: 1_000_000 };
  let last = null;
  for (let i = 0; i < 9; i += 1) {
    tracker.now += 100;
    last = ws.handleInboundFrame("garbage{{", tracker);
  }
  check("9 violations still drop (no close)", last.action === "drop" && tracker.violations.length === 9, JSON.stringify(last));
  tracker.now += 100;
  last = ws.handleInboundFrame("garbage{{", tracker);
  check("10th violation in-window closes", last.action === "close" && last.reason.indexOf("flood:") === 0, JSON.stringify(last));
  const decayed = { violations: tracker.violations.slice(), now: tracker.now + 60_000 };
  const after = ws.handleInboundFrame("garbage{{", decayed);
  check("window decay: old violations age out back to drop", after.action === "drop", JSON.stringify(after));
}

// ---- 4. never routes to the store ----
{
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "server", "ws.js"), "utf8");
  check("ws.js never requires the domain store", !/require\(.*store.*\)/.test(src));
  check("ws.js never calls appendEvent", src.indexOf("appendEvent") === -1);
}

console.log("\n=== ws outbound + filter P0 ===\n");

// ---- 5. outbound clamp + control-strip ----
{
  const big = "y".repeat(9000);
  const dirty = "ok\x00\x07\x1bnope\x7F";
  const event = { type: "wake.delivered", runId: null, at: "2026-01-01T00:00:00.000Z", data: { body: big, topic: dirty, reason: big, summary: big, team: "team-alpha" } };
  const clamped = ws.clampOutboundEvent(event);
  check("returns a new object", clamped !== event && clamped.data !== event.data);
  check("body clamped to 4096", clamped.data.body.length === ws.OUTBOUND_LIMITS.body);
  check("summary clamped to 2048", clamped.data.summary.length === ws.OUTBOUND_LIMITS.summary);
  check("reason clamped to 512", clamped.data.reason.length === ws.OUTBOUND_LIMITS.reason);
  check("topic clamped to 256 and control-stripped", clamped.data.topic === "oknope" && clamped.data.topic.length <= ws.OUTBOUND_LIMITS.topic, JSON.stringify(clamped.data.topic));
  check("input not mutated", event.data.body.length === 9000 && event.data.topic === dirty);
  check("team untouched", clamped.data.team === "team-alpha");
  const clean = { type: "gate.passed", data: { gate: "lint" } };
  check("clean events pass through identical", ws.clampOutboundEvent(clean) === clean);
  check("non-objects pass through", ws.clampOutboundEvent(null) === null);
}

// ---- 6. parseWsFilter caps + token shape + malformed default ----
{
  const many = Array.from({ length: 20 }, (_, i) => `gate${i}`).join(",");
  const capped = ws.parseWsFilter(`?type=${many}`);
  check("types capped at 10", capped.types.length === ws.WS_FILTER_MAX_VALUES, String(capped.types.length));
  const manyTeams = Array.from({ length: 15 }, (_, i) => `team-${i}`).join(",");
  const cappedTeams = ws.parseWsFilter(`?team=${manyTeams}`);
  check("teams capped at 10", cappedTeams.teams.length === ws.WS_FILTER_MAX_VALUES, String(cappedTeams.length));
  const evil = ws.parseWsFilter("?team=..%2F..%2Fetc%2Fpasswd&team=team-alpha");
  check("path-traversal team dropped, valid kept", evil.teams.indexOf("team-alpha") !== -1 && evil.teams.length === 1, JSON.stringify(evil.teams));
  const long = ws.parseWsFilter(`?team=${"a".repeat(200)}`);
  check("overlong token dropped", long.teams.length === 0, String(long.teams.length));
  const upper = ws.parseWsFilter("?type=GATE.PASSED&team=Team-Alpha");
  check("tokens normalized lowercase", upper.types[0] === "gate.passed" && upper.teams[0] === "team-alpha", JSON.stringify(upper));
  const empty = ws.parseWsFilter("");
  check("empty query defaults to unfiltered", empty.types.length === 0 && empty.teams.length === 0);
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);

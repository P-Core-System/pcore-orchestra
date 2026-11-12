"use strict";

/**
 * HOD work-request queue (member pull intake).
 *
 * FIFO durable store: `team-requests.json` in the shared team state dir
 * (same carve-out as team-sessions.json/discussion/wakes — one shared
 * roster/inbox across worktrees so pairing survives isolation, inv 30/31).
 * Every write goes through safe-write.js locks (invariant 15); corrupt
 * files quarantine instead of resetting. Domain writes stay in
 * domain/store.js only (invariant 19 — this module never touches them).
 *
 * Rows: { id, member, team, topic, status, createdAt, grantedAt }.
 * `enqueue` appends pending; `grant` flips pending -> granted (FIFO per
 * member); `list` reads (pending-first, FIFO). Callers pass an absolute
 * state dir — this module never reads process.env and never defaults to
 * /tmp (invariant 38: callers resolve via plan-artifact or state dir).
 */

const path = require("node:path");
const { withLock, readJsonSafe, writeJson } = require("./safe-write.js");

const REQUESTS_FILE = "team-requests.json";
const REQUESTS_CAP = 500;

let seq = 0;

function requestsFile(dir) {
  return path.join(String(dir || "."), REQUESTS_FILE);
}

function newRequestId() {
  seq += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `req_${Date.now().toString(36)}${seq.toString(36)}${rand}`;
}

function defaults() {
  return { version: 1, updated_at: null, requests: [] };
}

function loadRequests(dir) {
  const parsed = readJsonSafe(requestsFile(dir), defaults());
  if (!parsed || typeof parsed !== "object") return defaults();
  if (!Array.isArray(parsed.requests)) parsed.requests = [];
  return parsed;
}

/** Append a pending request. Returns the stored row. */
function enqueue(dir, fields) {
  const f = fields || {};
  const row = {
    id: newRequestId(),
    member: String(f.member || ""),
    team: String(f.team || "solo"),
    topic: String(f.topic || f.task || "work"),
    status: "pending",
    createdAt: new Date().toISOString(),
    grantedAt: null,
  };
  let stored = null;
  withLock(requestsFile(dir), () => {
    const cur = loadRequests(dir);
    cur.requests.push(row);
    while (cur.requests.length > REQUESTS_CAP) cur.requests.shift();
    cur.updated_at = new Date().toISOString();
    writeJson(requestsFile(dir), cur);
    stored = row;
    return cur;
  });
  return stored || row;
}

/** Flip the oldest pending request for a member to granted. */
function grant(dir, member) {
  const m = String(member || "");
  let granted = null;
  withLock(requestsFile(dir), () => {
    const cur = loadRequests(dir);
    const row = cur.requests
      .filter((r) => r && r.status === "pending" && String(r.member || "") === m)
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))[0];
    if (row) {
      row.status = "granted";
      row.grantedAt = new Date().toISOString();
      cur.updated_at = new Date().toISOString();
      writeJson(requestsFile(dir), cur);
      granted = row;
    }
    return cur;
  });
  return granted;
}

/** Read rows: pending-first FIFO unless { all: true }. */
function list(dir, opts) {
  const cur = loadRequests(dir);
  const rows = cur.requests.slice();
  if (opts && opts.all) return rows;
  return rows.filter((r) => r && r.status === "pending");
}

module.exports = {
  REQUESTS_FILE,
  REQUESTS_CAP,
  requestsFile,
  enqueue,
  grant,
  list,
  loadRequests,
};

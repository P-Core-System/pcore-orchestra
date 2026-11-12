"use strict";

/**
 * HOD completion reports (commit-discipline evidence, invariant 26).
 *
 * `team-done.json` in the shared team state dir (same 30/31 carve-out as
 * claims/requests: one shared inbox across worktrees). A member reports
 * done by naming the commit SHA on its per-member branch
 * (`member/<team>/<member>`); the HOD sweep treats a reported member as
 * releasable. Rows are append-only ({ id, member, team, sha, branch,
 * summary, reportedAt }) — never rewritten in place (invariant 21
 * spirit). Safe-write only (invariant 15); corrupt quarantines.
 * `isHexSha` guards the SHA shape (7..40 hex chars).
 */

const path = require("node:path");
const { withLock, readJsonSafe, writeJson } = require("./safe-write.js");

const DONE_FILE = "team-done.json";
const DONE_CAP = 500;

let seq = 0;

function doneFile(dir) {
  return path.join(String(dir || "."), DONE_FILE);
}

function isHexSha(sha) {
  return typeof sha === "string" && /^[0-9a-f]{7,40}$/i.test(sha.trim());
}

function defaults() {
  return { version: 1, updated_at: null, reports: [] };
}

function loadDone(dir) {
  const parsed = readJsonSafe(doneFile(dir), defaults());
  if (!parsed || typeof parsed !== "object") return defaults();
  if (!Array.isArray(parsed.reports)) parsed.reports = [];
  return parsed;
}

/**
 * Record a completion report. Returns { ok:true, report } or
 * { ok:false, code } for a missing member / malformed SHA.
 */
function report(dir, fields) {
  const f = fields || {};
  const member = String(f.member || "").trim();
  if (!member) return { ok: false, code: "DONE_NO_MEMBER" };
  if (!isHexSha(f.sha || "")) return { ok: false, code: "DONE_BAD_SHA" };
  seq += 1;
  const row = {
    id: `done_${Date.now().toString(36)}${seq.toString(36)}`,
    member,
    team: String(f.team || "solo"),
    sha: String(f.sha).trim(),
    branch: String(f.branch || ""),
    summary: String(f.summary || ""),
    reportedAt: new Date().toISOString(),
  };
  withLock(doneFile(dir), () => {
    const cur = loadDone(dir);
    cur.reports.push(row);
    while (cur.reports.length > DONE_CAP) cur.reports.shift();
    cur.updated_at = new Date().toISOString();
    writeJson(doneFile(dir), cur);
    return cur;
  });
  return { ok: true, report: row };
}

/** Latest report per member (for the HOD sweep / release decision). */
function latestByMember(dir) {
  const cur = loadDone(dir);
  const out = {};
  for (const r of cur.reports) {
    if (r && r.member) out[r.member] = r;
  }
  return out;
}

module.exports = {
  DONE_FILE,
  DONE_CAP,
  doneFile,
  isHexSha,
  report,
  latestByMember,
  loadDone,
};

"use strict";

const crypto = require("node:crypto");

const EXCERPT_MAX = 500;

/**
 * Upper bound for a gate's human-readable `details` string.
 *
 * `details` is the one record field with no natural size limit: the security
 * FAIL path embeds a whole `generateSecurityReport`, so an unbounded `details`
 * was written into `state.qualityGates`, the evidence report and the domain
 * event log alike. 2000 chars keeps any verdict's headline plus its evidence.
 */
const DETAILS_MAX = 2000;

function truncate(s) {
  if (s === null || s === undefined) return "";
  const str = String(s);
  if (str.length <= EXCERPT_MAX) return str;
  return str.slice(0, EXCERPT_MAX);
}

/**
 * Clamp `details` to `DETAILS_MAX`, saying how much was dropped — a silently
 * shortened verdict reads like a complete one. The marker is counted INSIDE the
 * budget, so the result never exceeds `DETAILS_MAX`.
 * @returns {string}
 */
function clampDetails(s) {
  if (s === null || s === undefined) return "";
  const str = String(s);
  if (str.length <= DETAILS_MAX) return str;
  const suffix = `… [+${str.length - DETAILS_MAX} chars]`;
  const keep = Math.max(0, DETAILS_MAX - suffix.length);
  return str.slice(0, keep) + suffix;
}

function toNumberExitCode(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) && Number.isInteger(n) ? n : null;
}

function buildEvidenceRecord(opts) {
  const o = opts || {};
  const started = o.startedAt;
  const ended = o.endedAt;
  let durationMs = null;
  if (started && ended) {
    const s = Date.parse(started);
    const e = Date.parse(ended);
    if (Number.isFinite(s) && Number.isFinite(e)) {
      durationMs = Math.max(0, e - s);
    }
  }
  if (durationMs === null && o.durationMs !== undefined && o.durationMs !== null) {
    const d = Number(o.durationMs);
    durationMs = Number.isFinite(d) && d >= 0 ? Math.floor(d) : null;
  }

  return {
    gate: o.gate || null,
    command: o.command || null,
    args: Array.isArray(o.args) ? o.args.slice() : [],
    exitCode: toNumberExitCode(o.exitCode),
    durationMs: durationMs === null ? 0 : durationMs,
    ok: !!o.ok,
    stdoutExcerpt: truncate(o.stdout),
    stderrExcerpt: truncate(o.stderr),
    startedAt: started || null,
  };
}

function evidenceDigest(records) {
  const list = Array.isArray(records) ? records.slice() : [];
  list.sort((a, b) => {
    const ga = String(a && a.gate || "");
    const gb = String(b && b.gate || "");
    if (ga < gb) return -1;
    if (ga > gb) return 1;
    const ea = (a && a.exitCode) === null ? -9999 : Number(a.exitCode) || 0;
    const eb = (b && b.exitCode) === null ? -9999 : Number(b.exitCode) || 0;
    if (ea < eb) return -1;
    if (ea > eb) return 1;
    return 0;
  });
  const h = crypto.createHash("sha256");
  for (const r of list) {
    const gate = String(r && r.gate || "");
    const ec = (r && r.exitCode) === null ? "null" : String(Number(r.exitCode) || 0);
    h.update(`${gate}:${ec};`);
  }
  return h.digest("hex");
}

module.exports = {
  EXCERPT_MAX,
  DETAILS_MAX,
  buildEvidenceRecord,
  clampDetails,
  evidenceDigest,
};
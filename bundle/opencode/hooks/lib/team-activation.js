"use strict";

/**
 * Team auto-activation — turn a durable discussion post or wake into
 * at-most-once synthetic OpenCode session inputs for recipient teammates.
 *
 * Design contract:
 *  - Recipients: group posts/wakes activate every live same-team slot;
 *    targeted events (`to` claim key or member token) activate only that
 *    teammate. The sender is excluded by BOTH claim key and session id.
 *  - Skip stale claims, claims without a session, and claims without a
 *    usable server URL. Missing target claims are audited as skipped.
 *  - Dedupe: `(eventKind, eventId, recipientClaimKey, projectSlug)` is
 *    reserved with INSERT OR IGNORE BEFORE the synthetic send, so a replay
 *    of the same durable event can never activate a session twice.
 *  - Audit: every sent / skipped / failed decision is appended to the
 *    `activations` table (or `team-activations.jsonl` in JSON fallback),
 *    trimmed to TEAM_ACTIVATION_CAP rows.
 *  - Fail-open: nothing here throws or blocks the team channel; a missing
 *    server, bad URL, DB error or API error only produces an outcome.
 *  - Kill switch: PCORE_TEAM_ACTIVATE=0 disables activation entirely.
 */

const fs = require("node:fs");
const path = require("node:path");
const {
  TEAM_ACTIVATE_ENV,
  TEAM_ACTIVATION_CAP,
  TEAM_ACTIVATION_EVENTS,
} = require("./constants.js");
const { getDb, resolveStateDir } = require("./session-store.js");
const { normalizeServerUrl, sendSynthetic } = require("./opencode-synthetic.js");
const { withLock, atomicWrite } = require("./safe-write.js");

const AUDIT_FILE = "team-activations.jsonl";

/** Lowercase slug token used for team/member comparisons. */
function token(value) {
  return String(value === undefined || value === null ? "" : value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function claimParts(claimKey) {
  return String(claimKey || "").split("/");
}

function memberTokens(claim) {
  const parts = claimParts(claim.claimKey);
  return [claim.member, claim.memberDisplay, parts[1]].map(token).filter(Boolean);
}

function teamTokens(claim) {
  return [claim.team, claim.teamId, claim.teamDisplay, claimParts(claim.claimKey)[0]]
    .map(token)
    .filter(Boolean);
}

function sessionOf(claim) {
  if (claim.sessionId) return String(claim.sessionId);
  return claimParts(claim.claimKey)[3] || "";
}

function matchesTeam(claim, team) {
  const wanted = token(team);
  return !!wanted && teamTokens(claim).indexOf(wanted) !== -1;
}

function matchesTarget(claim, target) {
  const raw = String(target || "").trim();
  if (!raw) return false;
  if (claim.claimKey === raw) return true;
  const parts = raw.split("/");
  const wanted = [token(raw), token(parts[1])].filter(Boolean);
  return memberTokens(claim).some((member) => wanted.indexOf(member) !== -1);
}

/** Stable at-most-once key for one event/recipient pair. */
function dedupeKey(eventKind, eventId, recipientClaimKey, projectSlug) {
  return `${eventKind}:${eventId}:${recipientClaimKey}:${projectSlug}`;
}

/**
 * Pure recipient planner. Returns one plan per matched claim, with
 * `skipReason` set for stale / sessionless / URL-less recipients.
 */
function planActivations(eventKind, event, claimRows, team, senderClaimKey, senderSessionId) {
  if (TEAM_ACTIVATION_EVENTS.indexOf(eventKind) === -1) return [];
  const ev = event && typeof event === "object" ? event : {};
  const eventId = String(ev.id || "");
  if (!eventId) return [];
  const senderKey = String(senderClaimKey || ev.from || "");
  const senderSession = String(senderSessionId || "");
  const target = typeof ev.to === "string" && ev.to.trim() ? ev.to.trim() : null;
  const plans = [];

  for (const claim of Array.isArray(claimRows) ? claimRows : []) {
    if (!claim || typeof claim !== "object" || !claim.claimKey) continue;
    const claimKey = String(claim.claimKey);
    if (senderKey && claimKey === senderKey) continue;
    const sessionId = sessionOf(claim);
    if (senderSession && sessionId === senderSession) continue;
    if (!matchesTeam(claim, team || ev.team)) continue;
    if (target && !matchesTarget(claim, target)) continue;

    const plan = {
      eventKind,
      eventId,
      claimKey,
      member: String(claim.member || memberTokens(claim)[0] || ""),
      sessionId,
      serverUrl: normalizeServerUrl(claim.serverUrl),
      projectSlug: String(ev.projectSlug || ""),
      dedupeKey: dedupeKey(eventKind, eventId, claimKey, String(ev.projectSlug || "")),
      skipReason: null,
    };
    if (claim.stale === true) plan.skipReason = "stale";
    else if (!sessionId) plan.skipReason = "no-session";
    else if (!plan.serverUrl) plan.skipReason = "no-url";
    plans.push(plan);
  }
  return plans;
}

/** Human-readable synthetic prompt; kept short and free of secrets. */
function defaultActivationText(eventKind, event, plan) {
  const ev = event && typeof event === "object" ? event : {};
  const from = String(ev.fromMember || memberTokens({ claimKey: ev.from })[0] || "teammate");
  const topic = ev.topic ? ` #${String(ev.topic).slice(0, 80)}` : "";
  if (eventKind === "wake") {
    return `[team-activation] wake ${ev.id} from ${from}${topic}: ${String(ev.reason || "nudge").slice(0, 500)}`;
  }
  return `[team-activation] post ${ev.id} from ${from}${topic}: ${String(ev.body || "").slice(0, 500)}`;
}

function auditFile() {
  return path.join(resolveStateDir(), AUDIT_FILE);
}

function readAuditRows() {
  let raw = "";
  try { raw = fs.readFileSync(auditFile(), "utf8"); } catch { return []; }
  return String(raw).split(/\r?\n/).map((line) => {
    try {
      const row = JSON.parse(line.trim());
      return row && typeof row === "object" && row.dedupe_key ? row : null;
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function auditLine(plan, status, reason) {
  return {
    dedupe_key: plan.dedupeKey,
    event_kind: plan.eventKind,
    event_id: plan.eventId,
    recipient_claim: plan.claimKey,
    recipient_member: plan.member,
    session_id: plan.sessionId,
    server_url: plan.serverUrl,
    project_slug: plan.projectSlug,
    status,
    reason: reason || null,
    created_at: new Date().toISOString(),
  };
}

function capRows(rows) {
  return rows.length > TEAM_ACTIVATION_CAP ? rows.slice(rows.length - TEAM_ACTIVATION_CAP) : rows;
}

/** Reserve the dedupe key BEFORE sending. Returns false when already used. */
function reserve(plan) {
  const db = getDb();
  if (db) {
    try {
      const row = auditLine(plan, "pending", null);
      const result = db.prepare(`
        INSERT OR IGNORE INTO activations (
          dedupe_key, event_kind, event_id, recipient_claim, recipient_member,
          session_id, server_url, project_slug, status, reason, created_at
        ) VALUES (
          @dedupe_key, @event_kind, @event_id, @recipient_claim, @recipient_member,
          @session_id, @server_url, @project_slug, @status, @reason, @created_at
        )
      `).run(row);
      if ((result.changes || 0) === 0) return false;
      trimSqlite(db);
      return true;
    } catch {
      return true; // fail-open: audit must never block activation
    }
  }
  let admitted = true;
  try {
    withLock(auditFile(), () => {
      const rows = readAuditRows();
      if (rows.some((row) => row.dedupe_key === plan.dedupeKey)) {
        admitted = false;
        return;
      }
      rows.push(auditLine(plan, "pending", null));
      atomicWrite(auditFile(), capRows(rows).map((row) => JSON.stringify(row)).join("\n") + "\n");
    }, {});
  } catch {
    admitted = true; // fail-open
  }
  return admitted;
}

function trimSqlite(db) {
  try {
    const rows = db.prepare(`SELECT dedupe_key FROM activations ORDER BY created_at ASC`).all();
    for (const row of rows.slice(0, Math.max(0, rows.length - TEAM_ACTIVATION_CAP))) {
      db.prepare(`DELETE FROM activations WHERE dedupe_key = @key`).run({ key: row.dedupe_key });
    }
  } catch { /* fail-open */ }
}

/** Persist a terminal decision. Sent rows keep the base key (dedupe);
 *  skipped/failed rows get a unique key so a later event can still retry. */
function audit(plan, status, reason) {
  const db = getDb();
  if (db) {
    try {
      if (status === "sent") {
        db.prepare(`UPDATE activations SET status = @status, reason = @reason WHERE dedupe_key = @key`)
          .run({ status, reason: reason || null, key: plan.dedupeKey });
      } else {
        if (status === "failed") {
          db.prepare(`DELETE FROM activations WHERE dedupe_key = @key`).run({ key: plan.dedupeKey });
        }
        const row = auditLine(plan, status, reason);
        row.dedupe_key = `${plan.dedupeKey}|${status}|${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        db.prepare(`
          INSERT INTO activations (
            dedupe_key, event_kind, event_id, recipient_claim, recipient_member,
            session_id, server_url, project_slug, status, reason, created_at
          ) VALUES (
            @dedupe_key, @event_kind, @event_id, @recipient_claim, @recipient_member,
            @session_id, @server_url, @project_slug, @status, @reason, @created_at
          )
        `).run(row);
        trimSqlite(db);
      }
    } catch { /* fail-open */ }
    return;
  }
  try {
    withLock(auditFile(), () => {
      const rows = readAuditRows();
      if (status === "sent") {
        const pending = rows.find((row) => row.dedupe_key === plan.dedupeKey);
        if (pending) {
          pending.status = status;
          pending.reason = reason || null;
        }
      } else {
        if (status === "failed") {
          for (let i = rows.length - 1; i >= 0; i -= 1) {
            if (rows[i].dedupe_key === plan.dedupeKey) rows.splice(i, 1);
          }
        }
        const row = auditLine(plan, status, reason);
        row.dedupe_key = `${plan.dedupeKey}|${status}|${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        rows.push(row);
      }
      atomicWrite(auditFile(), capRows(rows).map((row) => JSON.stringify(row)).join("\n") + "\n");
    }, {});
  } catch { /* fail-open */ }
}

function resolveClaims(o, ev) {
  if (Array.isArray(o.claims)) return o.claims;
  if (typeof o.claims === "function") return o.claims(ev) || [];
  if (typeof o.listClaims === "function") return o.listClaims(ev) || [];
  try {
    return require("./team-claims.js").listClaims({
      workspace: ev.workspace || o.workspace,
      worktreePath: o.worktreePath,
    }) || [];
  } catch {
    return [];
  }
}

/**
 * Fail-open orchestrator. `opts` may inject `claims` / `listClaims`,
 * `send` (synthetic sender), `buildText`, and `env` for tests.
 * Never throws; returns `{ok, sent, skipped, failed, disabled}`.
 */
function activateEvent(eventKind, event, opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const env = o.env || process.env;
  const result = { ok: true, eventKind, sent: [], skipped: [], failed: [], disabled: false };
  if (env[TEAM_ACTIVATE_ENV] === "0") {
    result.disabled = true;
    return result;
  }
  try {
    const ev = event && typeof event === "object" ? event : {};
    const plans = planActivations(
      eventKind, ev, resolveClaims(o, ev), o.team || ev.team,
      o.senderClaimKey || ev.from, o.senderSessionId
    );
    if (plans.length === 0 && typeof ev.to === "string" && ev.to.trim()) {
      const missing = {
        eventKind, eventId: String(ev.id || ""), claimKey: ev.to.trim(),
        member: ev.to.trim(), sessionId: "", serverUrl: null, projectSlug: String(ev.projectSlug || ""),
        dedupeKey: dedupeKey(eventKind, String(ev.id || ""), ev.to.trim(), String(ev.projectSlug || "")),
      };
      audit(missing, "skipped", "missing");
      result.skipped.push({ claimKey: ev.to.trim(), reason: "missing" });
    }
    const send = typeof o.send === "function" ? o.send : sendSynthetic;
    const buildText = typeof o.buildText === "function" ? o.buildText : defaultActivationText;
    for (const plan of plans) {
      if (plan.skipReason) {
        audit(plan, "skipped", plan.skipReason);
        result.skipped.push({ claimKey: plan.claimKey, reason: plan.skipReason });
        continue;
      }
      if (!reserve(plan)) {
        result.skipped.push({ claimKey: plan.claimKey, reason: "duplicate" });
        continue;
      }
      const text = buildText(eventKind, ev, plan);
      const outcome = send(plan.sessionId, text, {
        serverUrl: plan.serverUrl,
        timeoutMs: o.timeoutMs,
        maxLength: o.maxLength,
      }) || {};
      if (outcome.ok) {
        audit(plan, "sent", null);
        result.sent.push({ claimKey: plan.claimKey, sessionId: plan.sessionId, serverUrl: plan.serverUrl });
      } else {
        const reason = String(outcome.reason || "send-failed");
        audit(plan, "failed", reason);
        result.failed.push({ claimKey: plan.claimKey, reason });
      }
    }
  } catch {
    // Fail-open: a plumbing error must never break post or wake delivery.
  }
  return result;
}

/** Read the durable audit trail (primarily for diagnostics/tests). */
function listActivations(opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const filter = typeof o.eventKind === "string" ? o.eventKind : null;
  const db = getDb();
  if (db) {
    try {
      return db.prepare(`SELECT * FROM activations WHERE event_kind = @kind ORDER BY created_at ASC`)
        .all({ kind: filter || "" })
        .concat(filter ? [] : db.prepare(`SELECT * FROM activations ORDER BY created_at ASC`).all());
    } catch {
      return [];
    }
  }
  return readAuditRows().filter((row) => !filter || row.event_kind === filter);
}

module.exports = {
  AUDIT_FILE,
  token,
  dedupeKey,
  planActivations,
  defaultActivationText,
  activateEvent,
  listActivations,
};

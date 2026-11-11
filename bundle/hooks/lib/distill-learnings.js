"use strict";

/**
 * Session learning loop (Wave3 distill step).
 *
 * Learning records ride the existing team-session channel: `recordLearning`
 * appends a `session.learned` domain event (via `recordSessionOutcome`
 * with the additive `learned` action) carrying `{outcome, lessons,
 * threadRef}` — the same fail-open, safe-write-only path as every other
 * domain write (invariant 19). Nothing here edits code, docs, or prompts.
 *
 * `distillLearnings(events)` is a pure, deterministic projection from
 * domain events to learning *candidates* — small, evidence-linked rows
 * (`{id, kind, topic, lesson, evidence}`) a human triages later. Rules are
 * deliberately syntactic (no LLM in the loop):
 *   wake-throttle   repeated WAKE_THROTTLED for one author -> rate pressure
 *   wake-denied     WAKE_CROSS_SCOPE / no-live-target denials -> scope hygiene
 *   thread-resolved a discussion thread resolved with a topic -> what closed it
 *   escalation      an escalate wake (block -> leader) -> stall pattern
 *   session-lesson  a session.learned record's own lessons, quoted verbatim
 *
 * Candidates persist in the durable conductor artifact dir as
 * `learn-candidates.json` (`<workspace>/data/conductor` via
 * `plan-artifact.resolveArtifactDir`, never /tmp), ring-capped at
 * LEARN_CAP rows, every write through safe-write.js (invariant 15).
 *
 * `approveCandidate` is the human gate: it flips a candidate
 * pending -> approved|rejected and stamps who decided and when. It never
 * applies anything — there is no code path from a candidate to a file
 * edit, so approval cannot auto-apply. Approving without an explicit
 * `{decision, by}` human identity is refused (`LEARNING_NEEDS_HUMAN`).
 */

const fs = require("node:fs");
const { withLock, atomicWrite, readJsonSafe, writeJson } = require("./safe-write.js");

/** Ring cap for the candidates file: oldest rows trimmed first. */
const LEARN_CAP = 100;

const CANDIDATES_FILE = "learn-candidates.json";

/** Refusal code when approve lacks an explicit human decision. */
const LEARNING_NEEDS_HUMAN = "LEARNING_NEEDS_HUMAN";

let seq = 0;

/** Sortable candidate id: `lc_<time36><seq><rand>`. */
function newCandidateId() {
  seq += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `lc_${Date.now().toString(36)}${seq.toString(36)}${rand}`;
}

/** Candidates file inside a resolved artifact/state dir. */
function candidatesFile(dir) {
  const path = require("node:path");
  return path.join(dir, CANDIDATES_FILE);
}

function ensureCandidatesDir(file) {
  try {
    fs.mkdirSync(require("node:path").dirname(file), { recursive: true });
  } catch {
    /* best effort — safe-write surfaces a real error */
  }
}

/**
 * Record a session learning (`session.learned`) for a member claim.
 * Fail-open: any shape or I/O problem yields null and never throws.
 * @param {object|null} claim claim record (claimKey, member, team, ...)
 * @param {object} [learning] {outcome, lessons, threadRef}
 * @param {string|null} [worktreePath] optional worktree path for isolation
 * @returns {object|null} the stored event, or null when skipped/failed
 */
function recordLearning(claim, learning, worktreePath) {
  try {
    const domain = require("./domain/index.js");
    if (!domain || typeof domain.recordSessionOutcome !== "function") return null;
    const extra = learning && typeof learning === "object" ? learning : {};
    const action = "learned";
    if (typeof worktreePath === "object" && worktreePath !== null && !Array.isArray(worktreePath)) {
      worktreePath = worktreePath.worktreePath;
    }
    return domain.recordSessionOutcome(claim, action, worktreePath, {
      outcome: typeof extra.outcome === "string" ? extra.outcome : null,
      lessons: typeof extra.lessons === "string" ? extra.lessons : (Array.isArray(extra.lessons) ? extra.lessons.join("\n") : null),
      threadRef: typeof extra.threadRef === "string" ? extra.threadRef : null,
    });
  } catch {
    return null;
  }
}

/** Payload of a domain event (tolerant of envelope shapes). */
function payloadOf(event) {
  if (!event || typeof event !== "object") return {};
  if (event.payload && typeof event.payload === "object") return event.payload;
  return {};
}

/** Event id string (tolerant). */
function idOf(event) {
  if (!event || typeof event !== "object") return null;
  return typeof event.id === "string" ? event.id : null;
}

/**
 * Distill learning candidates from domain events. Pure: no fs, no clock
 * beyond the timestamps it stamps. Never throws on junk input.
 * @param {Array} events domain events (any envelope)
 * @param {object} [opts] {nowMs}
 * @returns {Array} candidate rows (status "pending")
 */
function distillLearnings(events, opts) {
  try {
    const list = Array.isArray(events) ? events : [];
    const now = new Date().toISOString();
    const out = [];
    const throttledBy = new Map();
    const deniedBy = new Map();
    for (const event of list) {
      if (!event || typeof event !== "object") continue;
      const type = event.type;
      const payload = payloadOf(event);
      const at = typeof event.at === "string" ? event.at : null;
      if (type === "wake.throttled" && payload.from) {
        const key = String(payload.from);
        if (!throttledBy.has(key)) throttledBy.set(key, []);
        throttledBy.get(key).push({ id: idOf(event), at });
      } else if (type === "wake.denied" && payload.from) {
        const key = `${String(payload.from)}|${String(payload.reason || "denied")}`;
        if (!deniedBy.has(key)) deniedBy.set(key, []);
        deniedBy.get(key).push({ id: idOf(event), at, reason: payload.reason || null, to: payload.to || null });
      } else if (type === "discussion.resolved" && (payload.topic || payload.messageId)) {
        out.push({
          id: newCandidateId(),
          kind: "thread-resolved",
          topic: payload.topic || payload.messageId,
          lesson: `thread ${payload.topic || payload.messageId} resolved${payload.from ? ` by ${payload.from}` : ""}`,
          evidence: { types: ["discussion.resolved"], count: 1, eventIds: idOf(event) ? [idOf(event)] : [] },
          status: "pending",
          createdAt: now,
          decidedAt: null,
          decidedBy: null,
          decision: null,
        });
      } else if (type === "wake.delivered" && payload.reason === "escalate" && payload.topic) {
        out.push({
          id: newCandidateId(),
          kind: "escalation",
          topic: payload.topic,
          lesson: `phase ${payload.topic} escalated to ${payload.to}`,
          evidence: { types: ["wake.delivered"], count: 1, eventIds: idOf(event) ? [idOf(event)] : [] },
          status: "pending",
          createdAt: now,
          decidedAt: null,
          decidedBy: null,
          decision: null,
        });
      } else if (type === "session.learned" && (payload.lessons || payload.outcome)) {
        out.push({
          id: newCandidateId(),
          kind: "session-lesson",
          topic: payload.threadRef || payload.outcome || "session",
          lesson: [payload.outcome, payload.lessons].filter(Boolean).join(" — "),
          evidence: { types: ["session.learned"], count: 1, eventIds: idOf(event) ? [idOf(event)] : [] },
          status: "pending",
          createdAt: now,
          decidedAt: null,
          decidedBy: null,
          decision: null,
        });
      }
    }
    for (const [from, hits] of throttledBy) {
      if (hits.length === 0) continue;
      out.push({
        id: newCandidateId(),
        kind: "wake-throttle",
        topic: from,
        lesson: `${from} hit the wake rate ring ${hits.length}x — batch nudges instead of one per event`,
        evidence: { types: ["wake.throttled"], count: hits.length, eventIds: hits.map((h) => h.id).filter(Boolean) },
        status: "pending",
        createdAt: now,
        decidedAt: null,
        decidedBy: null,
        decision: null,
      });
    }
    for (const [key, hits] of deniedBy) {
      if (hits.length === 0) continue;
      const bar = key.indexOf("|");
      const from = bar === -1 ? key : key.slice(0, bar);
      const reason = bar === -1 ? "denied" : key.slice(bar + 1);
      out.push({
        id: newCandidateId(),
        kind: "wake-denied",
        topic: from,
        lesson: `${from} denied ${hits.length}x (${reason}) — check workspace/project scope before nudging`,
        evidence: { types: ["wake.denied"], count: hits.length, eventIds: hits.map((h) => h.id).filter(Boolean) },
        status: "pending",
        createdAt: now,
        decidedAt: null,
        decidedBy: null,
        decision: null,
      });
    }
    void opts;
    return out;
  } catch {
    return [];
  }
}

/** Load candidates (tolerant: corrupt/missing -> []). */
function loadCandidates(dir) {
  if (!dir) return [];
  return readJsonSafe(candidatesFile(dir), []);
}

/**
 * Distill events and merge the new candidates into the stored file
 * (append + ring-cap at LEARN_CAP, oldest first). Returns the full
 * stored list.
 */
function distillAndSave(events, dir) {
  const fresh = distillLearnings(events);
  const file = candidatesFile(dir);
  ensureCandidatesDir(file);
  let stored = [];
  withLock(file, () => {
    const current = Array.isArray(readJsonSafe(file, [])) ? readJsonSafe(file, []) : [];
    const merged = current.concat(fresh);
    stored = merged.length > LEARN_CAP ? merged.slice(merged.length - LEARN_CAP) : merged;
    const payload = stored;
    atomicWrite(file, JSON.stringify(payload, null, 2) + "\n");
  }, {});
  return stored;
}

/**
 * Human gate: approve or reject one candidate. Requires an explicit
 * `{decision: "approved"|"rejected", by: "<human>"}` — anything else
 * returns `{ok:false, code:LEARNING_NEEDS_HUMAN}` and writes nothing.
 * Approval only flips status; it never applies anything (no code path
 * from a candidate to a file edit exists by design).
 * @returns {{ok:boolean, code?:string, candidate?:object}}
 */
function approveCandidate(dir, id, opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const decision = o.decision;
  const by = typeof o.by === "string" ? o.by.trim() : "";
  if ((decision !== "approved" && decision !== "rejected") || !by) {
    return { ok: false, code: LEARNING_NEEDS_HUMAN };
  }
  if (!dir || !id) return { ok: false, code: LEARNING_NEEDS_HUMAN };
  const file = candidatesFile(dir);
  ensureCandidatesDir(file);
  let updated = null;
  withLock(file, () => {
    const raw = readJsonSafe(file, []);
    const current = Array.isArray(raw) ? raw : [];
    const idx = current.findIndex((c) => c && c.id === id);
    if (idx === -1) return;
    if (current[idx].status !== "pending") return;
    const now = new Date().toISOString();
    current[idx] = Object.assign({}, current[idx], { status: decision, decision, decidedBy: by, decidedAt: now });
    updated = current[idx];
    writeJson(file, current);
  }, {});
  if (!updated) return { ok: false, code: "LEARNING_UNKNOWN" };
  return { ok: true, candidate: updated };
}

module.exports = {
  LEARN_CAP,
  CANDIDATES_FILE,
  LEARNING_NEEDS_HUMAN,
  newCandidateId,
  candidatesFile,
  recordLearning,
  distillLearnings,
  loadCandidates,
  distillAndSave,
  approveCandidate,
};

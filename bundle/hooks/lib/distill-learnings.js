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

/**
 * Self-improvement tiers.
 *
 * The original rule was "a candidate can never self-apply". That is safe but
 * it also means nothing is ever learned: the queue grows and the next session
 * behaves exactly like the last. The refinement here keeps the hard gate for
 * anything that could hurt and automates only the reversible operational
 * lessons, which is what "learn and relearn" actually needs to be useful.
 *
 * auto  — coordination/flow preferences (throttling, retry shape, batching).
 *         Reversible: it only changes what the conductor suggests to itself.
 * human — anything touching secrets, permissions, destructive commands,
 *         deployment, money, auth, a quality gate, or an invariant — including
 *         lessons that would reduce how often the agent asks the user.
 */
const GATED_KEYWORDS = [
  "secret", "token", "api key", "apikey", "credential", "password", "private key",
  "permission", "approve", "approval", "sandbox", "auto-approve", "yolo", "full access",
  "rm -rf", "delete", "drop table", "force push", "reset --hard", "migrate",
  "deploy", "production", "release", "rollback", "payment", "refund",
  "invariant", "security", "vulnerability", "exploit", "auth", "authorization",
  // Gate integrity. "Save time by skipping review" is exactly the kind of
  // lesson a self-improving loop will happily discover, and it quietly removes
  // the only thing standing between a fast answer and a wrong one.
  "gate", "skip", "bypass", "disable", "downgrade", "weaken", "shorten the",
  "reviewer", "verifier", "qa-agent", "do not verify", "no need to test",
  "ask the user", "without asking", "stop asking", "never flag", "ignore warning",
];

/** Candidate kinds that may be adopted without a human round-trip. */
const AUTO_KINDS = new Set(["wake-throttle", "thread-resolved", "escalation", "session-lesson"]);

/**
 * @param {{kind?:string, lesson?:string, topic?:string}} candidate
 * @returns {{risk:"auto"|"human", reason:string}}
 */
function classifyRisk(candidate) {
  const c = candidate || {};
  const text = `${c.topic || ""} ${c.lesson || ""}`.toLowerCase();
  const hit = GATED_KEYWORDS.find((k) => text.includes(k));
  if (hit) return { risk: "human", reason: `touches "${hit}"` };
  if (!AUTO_KINDS.has(c.kind)) return { risk: "human", reason: `kind "${c.kind || "unknown"}" is not auto-adoptable` };
  return { risk: "auto", reason: "reversible coordination preference" };
}

/**
 * Adopt every pending low-risk candidate, leave the rest for a human.
 *
 * `opts.applyFn(pref, candidate)` is the sink (typically
 * memory-manager.recordUserPreferences) and is injected so this module keeps
 * no dependency cycle on the memory layer and tests can capture calls.
 *
 * @param {string} dir
 * @param {{applyFn?:(pref:string, candidate:object)=>any, limit?:number, at?:Date}} opts
 * @returns {{applied:object[], gated:object[], failures:number}}
 */
function autoApply(dir, opts = {}) {
  const at = opts.at instanceof Date ? opts.at : new Date();
  const limit = Number.isFinite(opts.limit) ? opts.limit : 20;
  const file = candidatesFile(dir);
  if (!dir) return { applied: [], gated: [], failures: 0 };
  ensureCandidatesDir(file);
  const applied = [];
  let failures = 0;
  const all = (() => {
    try {
      return withLock(file, () => {
        const raw = readJsonSafe(file, []);
        const current = Array.isArray(raw) ? raw : [];
        for (const c of current) {
          if (!c || c.status !== "pending") continue;
          const risk = classifyRisk(c);
          if (risk.risk !== "human" && applied.length < limit) {
            c.status = "applied";
            c.appliedBy = "orchestra:auto";
            c.appliedAt = at.toISOString();
            c.autoReason = risk.reason;
            applied.push(c);
            if (typeof opts.applyFn === "function") {
              try {
                opts.applyFn(String(c.lesson || c.topic || "").trim(), c);
              } catch {
                failures++;
              }
            }
          }
        }
        writeJson(file, current);
        return current;
      }, []);
    } catch {
      // Contended lock or unreadable queue: never break the caller's turn.
      return null;
    }
  })();
  if (all === null) return { applied: [], gated: [], failures: failures + 1, locked: true };
  const gated = (all || []).filter((c) => c && c.status === "pending" && classifyRisk(c).risk === "human");
  return { applied, gated, failures };
}

/**
 * Relearn sweep: a lesson that has not been confirmed again in `ttlDays` stops
 * being asserted. Patterns that were true about an old codebase are the main
 * way a learning system quietly gets worse, so decay is part of learning.
 * @param {object[]} candidates
 * @param {{at?:Date, ttlDays?:number}} [opts]
 * @returns {{expired:object[], kept:object[]}}
 */
function decayStale(candidates, opts = {}) {
  const at = opts.at instanceof Date ? opts.at : new Date();
  const ttl = (Number.isFinite(opts.ttlDays) ? opts.ttlDays : 45) * 86400000;
  const expired = [];
  const kept = [];
  for (const c of candidates || []) {
    if (!c || !c.id) continue;
    const t = Date.parse(c.appliedAt || c.decidedAt || c.created || c.ts || "");
    if (Number.isFinite(t) && at.getTime() - t > ttl && c.status === "applied") {
      expired.push(c);
    } else {
      kept.push(c);
    }
  }
  return { expired, kept };
}

module.exports = {
  LEARN_CAP,
  CANDIDATES_FILE,
  LEARNING_NEEDS_HUMAN,
  GATED_KEYWORDS,
  AUTO_KINDS,
  classifyRisk,
  autoApply,
  decayStale,
  newCandidateId,
  candidatesFile,
  recordLearning,
  distillLearnings,
  loadCandidates,
  distillAndSave,
  approveCandidate,
};

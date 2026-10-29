"use strict";

/**
 * Automation trigger scheduler — pure, dependency-free decision functions.
 *
 * Hybrid model (workstream D, adopted from eloylp/agents issue #66):
 *   EXTERNAL EVENTS are the primary trigger; the schedule is a fallback
 *   sweep that catches missed work. A schedule alone cannot see "issue #12
 *   was reopened", and an event stream alone cannot notice quiet rot, so
 *   both feed the same guarded start path.
 *
 * Guards (every run passes all of them; see docs/automation-triggers.md):
 *   debounce   shouldRun()          — one run per N minutes (thundering herd)
 *   dedupe     dedupeKey()          — one run per issue/PR/commit identity
 *   budget     withinDailyBudget()  — hard cap of runs per local day
 *   fail loud  parseSchedule() etc. — malformed config throws, never guesses
 *   manual     `orchestra-enable start` — escape hatch, always available
 *
 * Contract: this module never reads the clock or the filesystem on its own.
 * Callers pass `now` / `lastRun` / `runs` explicitly, so every decision is
 * deterministic and unit-testable (scripts/test-trigger-scheduler.js).
 */

const MS_PER_MINUTE = 60000;

/** How far cron-lite scans for an occurrence (8 days > any weekly pattern). */
const CRON_SCAN_STEPS = 8 * 24 * 60;

/**
 * Goal string cap. Stricter than constants.GOAL_MAX_LENGTH (2000) because
 * trigger goals embed UNTRUSTED external payload text.
 */
const MAX_GOAL_LENGTH = 500;
const PAYLOAD_SUMMARY_MAX = 200;

const DEFAULT_SCHEDULE = "interval:60";
const DEFAULT_DEBOUNCE_MINUTES = 15;
const DEFAULT_DAILY_BUDGET = 6;
const DEFAULT_EVENTS = ["git", "github"];

/** Event sources a trigger config may enable (fail loud on anything else). */
const ALLOWED_EVENT_SOURCES = ["git", "github"];

/** cron-lite field ranges: minute, hour, day-of-month, month, day-of-week. */
const CRON_FIELD_RANGES = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
];

const DEFAULT_TRIGGER_CONFIG = Object.freeze({
  schedule: DEFAULT_SCHEDULE,
  debounce_minutes: DEFAULT_DEBOUNCE_MINUTES,
  daily_budget: DEFAULT_DAILY_BUDGET,
  events: Object.freeze([...DEFAULT_EVENTS]),
});

// ── internals ────────────────────────────────────────────────────────────

/** Normalize Date | ISO string | epoch-ms into a finite epoch-ms number. */
function toTime(value, label) {
  const what = label || "timestamp";
  if (value instanceof Date) {
    const ms = value.getTime();
    if (Number.isNaN(ms)) throw new Error(`trigger-scheduler: invalid ${what} (Invalid Date)`);
    return ms;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`trigger-scheduler: invalid ${what} (${value})`);
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const ms = Date.parse(value);
    if (Number.isNaN(ms)) throw new Error(`trigger-scheduler: invalid ${what} ("${value}")`);
    return ms;
  }
  if (value == null) throw new Error(`trigger-scheduler: missing ${what}`);
  throw new Error(`trigger-scheduler: invalid ${what} (${typeof value})`);
}

/** Local calendar-day key (budget + tally roll over on local midnight). */
function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * Parse one cron-lite field into the sorted list of allowed values.
 * Supported tokens: `*`, `n`, `a-b`, wildcard-step (`*` then `/n`),
 * `n/step` (n..max/step), `a-b/n`, and comma lists of those. Names
 * (MON/JAN), `@`-macros, `L`, `W`, `#` and seconds are NOT supported
 * (documented subset).
 */
function parseCronField(text, range, fullSpec) {
  const [min, max] = range;
  const values = new Set();
  for (const part of text.split(",")) {
    const m = /^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/.exec(part);
    if (!m) {
      throw new Error(
        `trigger-scheduler: invalid cron field "${part}" in "${fullSpec}" ` +
          '(supported: "*", "n", "a-b", "*/n", "a-b/n", comma lists)'
      );
    }
    const step = m[3] != null ? Number(m[3]) : 1;
    if (!Number.isInteger(step) || step < 1) {
      throw new Error(`trigger-scheduler: cron step must be an integer >= 1 in "${part}" of "${fullSpec}"`);
    }
    let lo;
    let hi;
    if (m[1] === "*") {
      if (m[2] != null) {
        throw new Error(`trigger-scheduler: cron field "${part}" in "${fullSpec}" cannot mix "*" with a range`);
      }
      lo = min;
      hi = max;
    } else {
      lo = Number(m[1]);
      if (m[2] != null) hi = Number(m[2]);
      else if (m[3] != null) hi = max; // POSIX "n/step" runs n..max/step
      else hi = lo;
      if (lo > hi) {
        throw new Error(`trigger-scheduler: inverted cron range "${part}" in "${fullSpec}"`);
      }
      if (lo < min || hi > max) {
        throw new Error(
          `trigger-scheduler: cron value out of range in "${part}" of "${fullSpec}" (allowed ${min}-${max})`
        );
      }
    }
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  if (values.size === 0) {
    throw new Error(`trigger-scheduler: cron field "${text}" in "${fullSpec}" matches nothing`);
  }
  return { values: Array.from(values).sort((a, b) => a - b) };
}

/** cron-lite match against a local-time Date. Vixie day rule: when BOTH
 *  day-of-month and day-of-week are restricted, either may match. */
function cronMatches(parsed, date) {
  if (!parsed.fields[0].values.includes(date.getMinutes())) return false;
  if (!parsed.fields[1].values.includes(date.getHours())) return false;
  if (!parsed.fields[3].values.includes(date.getMonth() + 1)) return false;
  const domOk = !parsed.restricted[2] || parsed.fields[2].values.includes(date.getDate());
  const dowOk = !parsed.restricted[4] || parsed.fields[4].values.includes(date.getDay());
  if (parsed.restricted[2] && parsed.restricted[4]) return domOk || dowOk;
  return domOk && dowOk;
}

/** Latest scheduled occurrence at or before `nowMs`, or null (cron only). */
function latestOccurrenceMs(nowMs, parsed) {
  if (parsed.type === "daily") {
    const now = new Date(nowMs);
    const todayAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), parsed.hour, parsed.minute, 0, 0);
    if (nowMs >= todayAt.getTime()) return todayAt.getTime();
    const yesterdayAt = new Date(
      now.getFullYear(), now.getMonth(), now.getDate() - 1, parsed.hour, parsed.minute, 0, 0
    );
    return yesterdayAt.getTime();
  }
  // cron-lite: bounded backwards minute scan (CRON_SCAN_STEPS)
  const start = Math.floor(nowMs / MS_PER_MINUTE) * MS_PER_MINUTE;
  for (let i = 0; i <= CRON_SCAN_STEPS; i++) {
    const cand = start - i * MS_PER_MINUTE;
    if (cronMatches(parsed, new Date(cand))) return cand;
  }
  return null;
}

/** First scheduled occurrence strictly after `fromMs`, or null. */
function nextOccurrenceMs(fromMs, parsed) {
  if (parsed.type === "daily") {
    const from = new Date(fromMs);
    for (let d = 0; d <= 2; d++) {
      const cand = new Date(from.getFullYear(), from.getMonth(), from.getDate() + d, parsed.hour, parsed.minute, 0, 0);
      if (cand.getTime() > fromMs) return cand.getTime();
    }
    return null;
  }
  const start = Math.floor(fromMs / MS_PER_MINUTE) * MS_PER_MINUTE + MS_PER_MINUTE;
  for (let i = 0; i <= CRON_SCAN_STEPS; i++) {
    const cand = start + i * MS_PER_MINUTE;
    if (cronMatches(parsed, new Date(cand))) return cand;
  }
  return null;
}

/** Lowercased, shell/JSON-safe token: [a-z0-9._:-], dashes elsewhere. */
function sanitizeToken(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Strip control chars, collapse whitespace, trim, truncate with a marker. */
function sanitizeText(text, max) {
  const cleaned = String(text)
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 3)}...`;
}

/** First usable identity field of an event (or null). */
function eventIdentity(event) {
  const candidates = [
    event.id,
    event.number,
    event.issue_number,
    event.sha,
    event.commit,
    event.ref,
    event.issue && event.issue.number,
    event.pull_request && event.pull_request.number,
  ];
  for (const c of candidates) {
    if (c != null && String(c).trim() !== "") return c;
  }
  return null;
}

// ── public API ───────────────────────────────────────────────────────────

/**
 * Parse a schedule spec. Supported forms:
 *   interval:<minutes>     every N minutes (positive integer)
 *   daily:<HH:MM>          once a day, local time
 *   <5-field cron>         cron-lite subset (see parseCronField)
 * Throws on anything malformed — a bad schedule must never silently become
 * "never runs" or "runs constantly".
 *
 * @returns {{type:"interval",minutes:number,spec:string}
 *          |{type:"daily",hour:number,minute:number,spec:string}
 *          |{type:"cron",fields:Array,restricted:boolean[],spec:string}}
 */
function parseSchedule(spec) {
  if (typeof spec !== "string" || spec.trim() === "") {
    throw new Error(
      'trigger-scheduler: schedule spec must be a non-empty string (e.g. "interval:30", "daily:09:00", "0 9 * * 1-5")'
    );
  }
  const s = spec.trim();

  if (s.startsWith("interval:")) {
    const minutes = Number(s.slice("interval:".length).trim());
    if (!Number.isInteger(minutes) || minutes <= 0) {
      throw new Error(`trigger-scheduler: invalid interval schedule "${spec}" (expected interval:<positive integer minutes>)`);
    }
    return { type: "interval", minutes, spec: s };
  }

  if (s.startsWith("daily:")) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(s.slice("daily:".length).trim());
    if (!m) {
      throw new Error(`trigger-scheduler: invalid daily schedule "${spec}" (expected daily:<HH:MM>)`);
    }
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    if (hour > 23 || minute > 59) {
      throw new Error(`trigger-scheduler: invalid daily schedule "${spec}" (hour 0-23, minute 0-59)`);
    }
    return { type: "daily", hour, minute, spec: s };
  }

  const parts = s.split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(
      `trigger-scheduler: invalid cron schedule "${spec}" (expected 5 fields: minute hour day-of-month month day-of-week)`
    );
  }
  const fields = parts.map((p, i) => parseCronField(p, CRON_FIELD_RANGES[i], s));
  const restricted = parts.map((p) => p !== "*");
  // day-of-week 7 is an alias for Sunday (0)
  if (fields[4].values.includes(7) && !fields[4].values.includes(0)) fields[4].values.push(0);
  return { type: "cron", fields, restricted, spec: s };
}

/**
 * Is the schedule due at `now`?
 *
 *   interval — never run, or last run >= interval ago (boundary inclusive).
 *   daily    — the latest daily occurrence is AFTER lastRun. Occurrences are
 *              never back-filled more than once: at most the newest missed
 *              window counts, so a long outage does not queue a backlog.
 *   cron     — some occurrence falls in (lastRun, now] within the 8-day scan.
 *   lastRun  — null means "never run": the first sweep fires (bootstrap), so
 *              a fresh install catches up the missed window instead of
 *              waiting a full period.
 *
 * @param {Date|string|number} now
 * @param {Date|string|number|null} lastRun
 * @param {string} spec schedule spec (re-parsed; throws when malformed)
 */
function isDue(now, lastRun, spec) {
  const parsed = parseSchedule(spec);
  const nowMs = toTime(now, "now");
  const lastMs = lastRun == null ? null : toTime(lastRun, "lastRun");

  if (parsed.type === "interval") {
    if (lastMs == null) return true;
    return nowMs - lastMs >= parsed.minutes * MS_PER_MINUTE;
  }

  const occ = latestOccurrenceMs(nowMs, parsed);
  if (occ == null) return false;
  return lastMs == null || occ > lastMs;
}

/**
 * Next time `isDue` becomes true (already due → `now`). Null when the
 * schedule has no occurrence in the forward scan window (cron-lite only).
 *
 * @returns {Date|null}
 */
function nextDue(now, lastRun, spec) {
  const parsed = parseSchedule(spec);
  const nowMs = toTime(now, "now");
  if (isDue(nowMs, lastRun, spec)) return new Date(nowMs);
  if (parsed.type === "interval") {
    const lastMs = toTime(lastRun, "lastRun");
    return new Date(lastMs + parsed.minutes * MS_PER_MINUTE);
  }
  const lastMs = lastRun == null ? nowMs : toTime(lastRun, "lastRun");
  const occ = nextOccurrenceMs(Math.max(nowMs, lastMs), parsed);
  return occ == null ? null : new Date(occ);
}

/**
 * Debounce guard: allow a run only when the last run is at least
 * `debounceMinutes` old (boundary inclusive). `0`/null disables it.
 * This is the anti-thundering-herd guard for event bursts.
 *
 * @param {{now?: Date|string|number, lastRun?: Date|string|number|null,
 *          debounceMinutes?: number|null}} input
 */
function shouldRun({ now, lastRun, debounceMinutes } = {}) {
  if (lastRun == null) return true;
  const mins = debounceMinutes == null ? 0 : Number(debounceMinutes);
  if (!Number.isFinite(mins) || mins < 0) {
    throw new Error(`trigger-scheduler: debounceMinutes must be a non-negative number (got ${debounceMinutes})`);
  }
  if (mins === 0) return true;
  const nowMs = now == null ? Date.now() : toTime(now, "now");
  const lastMs = toTime(lastRun, "lastRun");
  return nowMs - lastMs >= mins * MS_PER_MINUTE;
}

/**
 * Stable dedupe key for an event: `<type>:<identity>`.
 * Identity comes from key | id | number | issue_number | sha | commit | ref |
 * issue.number | pull_request.number. Events with no identity THROW — an
 * unidentifiable event cannot be deduped and must not slip through silently.
 *
 * @param {{type?:string,kind?:string,source?:string,key?:string,id?:*}} event
 * @returns {string}
 */
function dedupeKey(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new Error("trigger-scheduler: dedupeKey requires an event object");
  }
  if (event.key != null && String(event.key).trim() !== "") {
    const k = sanitizeToken(event.key);
    if (k) return k;
  }
  const rawType = event.type != null ? event.type : event.kind != null ? event.kind : event.source;
  const type = sanitizeToken(rawType == null || rawType === "" ? "event" : rawType);
  const identity = eventIdentity(event);
  if (identity == null) {
    throw new Error(
      `trigger-scheduler: event of type "${type}" has no identity field (key/id/number/sha/ref) — cannot dedupe`
    );
  }
  const id = sanitizeToken(identity);
  if (!id) {
    throw new Error(`trigger-scheduler: event identity "${String(identity)}" has no usable characters — cannot dedupe`);
  }
  return `${type || "event"}:${id}`;
}

/**
 * Daily budget guard: `runsToday < cap`. `cap` null/undefined = uncapped.
 * `cap < 1` is a config error (use "remove orchestra.triggers" to disable).
 */
function withinDailyBudget(runsToday, cap) {
  if (!Number.isInteger(runsToday) || runsToday < 0) {
    throw new Error(`trigger-scheduler: runsToday must be a non-negative integer (got ${runsToday})`);
  }
  if (cap == null) return true;
  const n = Number(cap);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`trigger-scheduler: daily budget cap must be an integer >= 1 (got ${cap})`);
  }
  return runsToday < n;
}

/**
 * Count runs whose LOCAL calendar day equals `now`'s (budget rollover).
 * Unparseable entries are skipped — state-file noise must not brick `due`.
 *
 * @param {Array<string|Date|number>} runs
 * @param {Date|string|number} [now]
 */
function tallyRunsToday(runs, now) {
  if (!Array.isArray(runs)) return 0;
  const nowMs = now == null ? Date.now() : toTime(now, "now");
  const today = dayKey(nowMs);
  let n = 0;
  for (const r of runs) {
    try {
      if (dayKey(toTime(r, "run timestamp")) === today) n += 1;
    } catch {
      /* skip malformed history entry */
    }
  }
  return n;
}

/**
 * Build the goal string handed to `orchestra-enable start`.
 *
 * SECURITY: `payload` is untrusted external input. It is flattened to text,
 * stripped of control characters, whitespace-collapsed and truncated
 * (payload <= 200 chars, whole goal <= 500). The result is returned as an
 * in-process string — it is NEVER interpolated into a shell command; callers
 * that must pass it through a shell have to quote it as one argv element.
 *
 * @param {{source?:string, scheduleOrEvent?:string, payload?:*}} input
 * @returns {string}
 */
function buildRunGoal({ source, scheduleOrEvent, payload } = {}) {
  const src = sanitizeToken(source == null || source === "" ? "unknown" : source) || "unknown";
  const label = sanitizeText(scheduleOrEvent == null ? "" : scheduleOrEvent, 160) || "triggered run";
  let goal = `[automation:${src}] ${label}`;

  let summary = "";
  if (payload != null) {
    if (typeof payload === "string") {
      summary = sanitizeText(payload, PAYLOAD_SUMMARY_MAX);
    } else {
      try {
        summary = sanitizeText(JSON.stringify(payload), PAYLOAD_SUMMARY_MAX);
      } catch {
        summary = "";
      }
    }
  }
  if (summary) goal = `${goal} — ${summary}`;
  return sanitizeText(goal, MAX_GOAL_LENGTH);
}

/**
 * Normalize `project.yaml` → `orchestra.triggers`. Returns null when the
 * block is absent (triggers disabled) and throws on invalid values.
 *
 * Schema (see docs/automation-triggers.md):
 *   schedule:         "interval:<min>" | "daily:<HH:MM>" | 5-field cron-lite
 *   debounce_minutes: integer >= 0   (default 15)
 *   daily_budget:     integer >= 1   (default 6)
 *   events:           list of "git" | "github" (default both)
 */
function normalizeTriggerConfig(raw) {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("trigger-scheduler: orchestra.triggers must be a mapping (see docs/automation-triggers.md)");
  }

  const scheduleSpec = raw.schedule == null ? DEFAULT_SCHEDULE : raw.schedule;
  const schedule = parseSchedule(scheduleSpec);

  const debounceMinutes = raw.debounce_minutes == null ? DEFAULT_DEBOUNCE_MINUTES : Number(raw.debounce_minutes);
  if (!Number.isInteger(debounceMinutes) || debounceMinutes < 0) {
    throw new Error(`trigger-scheduler: debounce_minutes must be a non-negative integer (got ${raw.debounce_minutes})`);
  }

  const dailyBudget = raw.daily_budget == null ? DEFAULT_DAILY_BUDGET : Number(raw.daily_budget);
  if (!Number.isInteger(dailyBudget) || dailyBudget < 1) {
    throw new Error(`trigger-scheduler: daily_budget must be an integer >= 1 (got ${raw.daily_budget})`);
  }

  let events = [...DEFAULT_EVENTS];
  if (raw.events != null) {
    if (!Array.isArray(raw.events) || raw.events.length === 0) {
      throw new Error('trigger-scheduler: events must be a non-empty list (e.g. [git, github])');
    }
    events = [];
    for (const e of raw.events) {
      const name = String(e).trim().toLowerCase();
      if (!ALLOWED_EVENT_SOURCES.includes(name)) {
        throw new Error(`trigger-scheduler: unknown event source "${e}" (allowed: ${ALLOWED_EVENT_SOURCES.join(", ")})`);
      }
      if (!events.includes(name)) events.push(name);
    }
  }

  return { schedule, scheduleSpec: schedule.spec, debounceMinutes, dailyBudget, events };
}

module.exports = {
  MS_PER_MINUTE,
  CRON_SCAN_STEPS,
  MAX_GOAL_LENGTH,
  PAYLOAD_SUMMARY_MAX,
  ALLOWED_EVENT_SOURCES,
  DEFAULT_TRIGGER_CONFIG,
  parseSchedule,
  isDue,
  nextDue,
  shouldRun,
  dedupeKey,
  withinDailyBudget,
  tallyRunsToday,
  buildRunGoal,
  normalizeTriggerConfig,
};

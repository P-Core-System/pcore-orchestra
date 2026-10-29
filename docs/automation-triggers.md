# Automation Triggers — scheduled + event

**Status:** shipped (workstream D, 2026-10-29).
**Code:** `bundle/hooks/lib/trigger-scheduler.js` (pure functions, byte-identical
mirror in `bundle/opencode/hooks/lib/`), CLI `orchestra-enable.js triggers`,
tests `scripts/test-trigger-scheduler.js` (wired into CI).

## Why hybrid: events are primary, the schedule is a fallback

An event stream alone cannot notice quiet rot (nothing merged today = nothing
fired), and a schedule alone cannot see "issue #12 was reopened" — a pure cron
has **no natural re-trigger**: when the tick lands while the machine is asleep,
the work simply does not happen. So pcore-orchestra uses a hybrid:

- **External events are the PRIMARY trigger.** `git` (post-commit hook) and
  `github` (webhook/relay) push work in the moment it exists.
- **The schedule is a FALLBACK SWEEP.** A periodic `triggers run` re-decides
  from persisted state whether anything is still due, catching up missed
  windows instead of assuming delivery.

Every run — from either source — passes through the same guard chain before
`orchestra-enable start` is invoked.

```
 external events (PRIMARY)                schedule (FALLBACK sweep)
  git post-commit hook ────────┐   cron/systemd/CI timer every N min
  GitHub webhook relay ────────┤                 │
                              ▼                 ▼
                 ┌────────────────────────────────────────┐
                 │ guards — ALL must pass                 │
                 │  1. source allowlist   (events: cfg)   │
                 │  2. dedupe  per issue/PR/commit id     │
                 │  3. debounce one run per N minutes     │
                 │  4. daily budget  runs today < cap     │
                 │  5. schedule-due  (sweep runs only)    │
                 └───────────────────┬────────────────────┘
                                     ▼
              buildRunGoal() → sanitized, truncated goal string
                                     ▼
        orchestra-enable.js triggers run → startOrchestra(source="automation")
                                     ▼
                     plan → implement → verify → review
```

Manual escape hatch (always available, bypasses nothing but is never blocked):
`orchestra-enable.js start "<goal>"`.

## Guard table

| Guard | Function (in `trigger-scheduler.js`) | Protects against | Knob |
|---|---|---|---|
| **Thundering herd** (debounce) | `shouldRun({now, lastRun, debounceMinutes})` | N events landing in the same minute → N concurrent loops; retry storms | `debounce_minutes` (default 15, `0` disables) |
| **Per-item dedupe** | `dedupeKey(event)` + `state.dedupe` | The same issue/PR/commit re-triggering a run over and over | dedupe window = `debounce_minutes` (state pruned at 24 h) |
| **Daily budget** | `withinDailyBudget(runsToday, cap)` | Runaway automation burning the day away (cost/blast radius) | `daily_budget` (default 6, `>= 1`) |
| **Schedule due** | `isDue(now, lastRun, spec)` / `nextDue(...)` | Running the sweep when nothing is due (and never missing a due window) | `schedule` |
| **Source allowlist** | CLI (`triggers run --event`) | An unknown/compromised webhook source starting loops | `events: [git, github]` |
| **Fail loud** | `parseSchedule` / `normalizeTriggerConfig` / `dedupeKey` | A typo silently becoming "never runs" or "runs constantly" | — (throws, `triggers` exits 1 with the reason) |
| **Manual escape hatch** | `orchestra-enable start` | Lockout when guards or config misfire | always available |

Debounce and dedupe are checked **before** the budget, so the refusal message
always names the guard that actually fired. Guards are evaluated in this order
for `triggers run`:

- **event run** → source allowlist → dedupe → debounce → budget (the schedule
  does **not** gate events — they are primary);
- **sweep run** → schedule-due → debounce → budget.

## Config surface (`project.yaml`)

```yaml
orchestra:
  triggers:
    schedule: "interval:30"   # fallback sweep: interval:<m> | daily:<HH:MM> | cron-lite
    debounce_minutes: 15      # one run per 15 min across ALL sources
    daily_budget: 6           # hard cap of trigger runs per local day
    events:                   # enabled external event sources (fail loud on others)
      - git
      - github
```

- **Absent `orchestra.triggers` block = triggers disabled** (every `triggers`
  subcommand reports "not configured" and exits 1). Nothing runs implicitly.
- Defaults when the block exists: `schedule: interval:60`,
  `debounce_minutes: 15`, `daily_budget: 6`, `events: [git, github]`.
- Invalid values (bad schedule, `daily_budget: 0`, unknown event source,
  `events` as a bare string) **throw** — `triggers` exits 1 with
  `config error: …` instead of guessing.

### Schedule spec reference

| Form | Meaning | Example |
|---|---|---|
| `interval:<minutes>` | Every N minutes, measured from the last run | `interval:30` |
| `daily:<HH:MM>` | Once a day, local time | `daily:09:00` |
| 5-field cron-lite | `minute hour day-of-month month day-of-week` | `0 9 * * 1-5` |

cron-lite **supported subset**: `*`, `n`, `a-b`, `*/n`, `n/step` (n→max/step),
`a-b/n`, comma lists, day-of-week `0-7` (7 = Sunday). Day rule follows Vixie
cron: when **both** day-of-month and day-of-week are restricted, either may
match. **Not supported** (fails loud): month/day names (`MON`, `JAN`),
`@`-macros, seconds, `L`/`W`/`#`.

Semantics that matter:

- **Bootstrap:** a never-run schedule is due on the first sweep (a fresh
  install catches up the missed window instead of waiting a full period).
- **No backlog:** at most the **newest** missed occurrence counts — a three-day
  outage produces one catch-up run, never three queued runs.
- **Boundary:** `interval` is inclusive (`now - lastRun >= interval`), so a
  tick exactly on the boundary is due.
- **Local time:** `daily` and cron-lite match the host's local calendar;
  `nextDue` returns the next local occurrence (ISO-8601 in `status`).

## CLI

```
orchestra-enable.js triggers status   # schedule, last run, next due, budget used, dedupe count
orchestra-enable.js triggers due      # exit 0 = a sweep run would start now, exit 1 = not due
orchestra-enable.js triggers run      # evaluate guards, record the run, start the loop
orchestra-enable.js triggers run --event '<json>'   # event-driven run (flags BEFORE --event)
```

- `due` is a pure probe (cron/systemd/monitoring friendly): it prints which
  guard decided (`not due: schedule | debounce | daily budget …`).
- `run` re-evaluates the guards itself — a sweeper needs one command, not
  `due && run`. If a guard refuses, it exits 1 **without** touching state.
- `--event` payloads **must** carry `"source"` and the source must be listed in
  `events:`. Every other field is untrusted (see Security).
- Guard state lives in `<state>/trigger-state.json` (safe-write,
  `PCORE_STATE_DIR`-aware, gitignored): `last_run`, the recent `runs` list
  (capped at 100, rolled over on local midnight), and `dedupe` keys.
- `run` records the run **before** starting the loop, so a crash mid-start
  still counts against the guards (a failing start can never retry without
  limit).

## Install

### 1. Enable the config

Add the `orchestra.triggers:` block above to your project's `project.yaml`.

### 2. Schedule fallback sweep

Any periodic scheduler works — it only needs to run one command:

```cron
# every 30 minutes, local time
*/30 * * * * cd /path/to/repo && node bundle/hooks/orchestra-enable.js triggers run >> /var/log/orchestra-triggers.log 2>&1 || true
```

(`systemd` timer or a CI `schedule:` job work identically; use
`triggers due` instead of `triggers run` when you only want the exit code.)

### 3. Git event hook (post-commit)

Install the template — full copy also lives at
`templates/git-hooks/post-commit`:

```sh
#!/bin/sh
# .git/hooks/post-commit — P-Core Orchestra automation event trigger
#   cp templates/git-hooks/post-commit .git/hooks/post-commit
#   chmod +x .git/hooks/post-commit
# Guards (debounce / dedupe / budget) live in the CLI. This hook must NEVER
# block or fail a commit, so every error is swallowed on purpose.
set -u
ENABLE="${PCORE_ORCHESTRA_ENABLE:-orchestra-enable.js}"
SHA="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
# Only git's own hex output is interpolated here; the CLI re-sanitizes the
# whole payload when it builds the goal string.
EVENT="{\"source\":\"git\",\"type\":\"commit\",\"sha\":\"$SHA\"}"
if command -v "$ENABLE" >/dev/null 2>&1; then
  "$ENABLE" triggers run --event "$EVENT" >/dev/null 2>&1 || true
elif [ -f "$ENABLE" ]; then
  node "$ENABLE" triggers run --event "$EVENT" >/dev/null 2>&1 || true
fi
exit 0
```

The hook is deliberately dumb: it fires on every commit, and the CLI decides
whether a run may start. A run started *by* the hook commits its own docs →
the hook fires again → **debounce** stops the recursion.

### 4. GitHub events

There is no inbound server here — relay webhook payloads from your own
endpoint or an Actions step:

```sh
node bundle/hooks/orchestra-enable.js triggers run --event "$EVENT"   # EVENT='{"source":"github","type":"pull_request","number":42,...}'
```

### 5. Manual escape hatch

```bash
node bundle/hooks/orchestra-enable.js start "your goal here"   # never blocked by guards
```

## Security notes

- **External payload is untrusted.** `buildRunGoal()` flattens the payload to
  text, strips control characters, collapses whitespace, and truncates
  (payload ≤ 200 chars, whole goal ≤ 500). The goal is passed to
  `startOrchestra()` as an **in-process string — never shell-interpolated**;
  hook templates hand it over as a single argv element. Do not re-embed a goal
  into `sh -c` / `eval` downstream.
- **Source allowlist.** `--event` requires `source`, and the source must be in
  `events:` (`git` / `github` only). Unknown sources are refused before any
  state is read or written.
- **No identity, no run.** Dedupe requires an identity field
  (`key`/`id`/`number`/`sha`/`ref`/…); identity-less events fail loud rather
  than slipping through un-deduped.
- **Bounded blast radius.** Even a compromised webhook can start at most
  `daily_budget` runs per day, at most one per `debounce_minutes`.
- **State carries no secrets.** `trigger-state.json` holds only timestamps and
  dedupe keys (repo invariant: no secrets in state files).

## Terminology reference

Vocabulary borrowed from adjacent systems — **no API is adopted**:

- **LangGraph Platform** `client.crons.create(schedule, timezone, input, webhook,
  onRunCompleted)` — the "schedule + completion callback" shape for managed
  cron runs ([cron jobs docs](https://docs.langchain.com/langsmith/cron-jobs),
  [create API](https://reference.langchain.com/python/langgraph-sdk/_async/cron/CronClient/create)).
- **Inngest** trigger kinds `{event}` vs `{cron}` — the naming for the two
  sources this module exposes ([event & trigger concepts](https://www.inngest.com/docs/durable-execution/guides-and-advanced/events-and-triggers/event-and-trigger-concepts)).
- **GitHub Actions** `schedule:` plus repository events — the standard
  pairing vocabulary for time vs. activity triggers
  ([events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)).
- **DeepLearning.AI — "Loop Engineering with LangChain Deep Agents"** — the
  loop framing (execute → check → respond to events) this feature slots into
  ([course](https://www.deeplearning.ai/courses/loop-engineering-with-langchain-deep-agents)).

## Adopted

Design decisions actually taken from precedents:

1. **Hybrid event + cron configuration** — eloylp/agents
   [issue #66](https://github.com/eloylp/agents/issues/66): one config that can
   carry both a schedule and an event trigger. Adopted as the split above
   (`schedule` + `events` in one `orchestra.triggers` block), with the
   refinement that **events are primary and the schedule only sweeps**.
2. **"A cron has no natural re-trigger, so every scheduled unit must be
   retryable"** (Inngest's cron/event distinction). Adopted as an invariant:
   the sweep re-decides from persisted state every time and the guard chain
   makes repeat/idempotent fires safe — no run depends on having been woken
   exactly on its tick.
3. **Schedule is not a source of truth** — GitHub Actions disables scheduled
   workflows on public repositories after 60 days of repository inactivity, a
   reminder that time-based triggers silently stop. Adopted as: the schedule
   only *catches up* missed work that events should normally have delivered;
   `triggers status` always shows `last run` / `next due` so a dead sweep is
   visible instead of assumed.

## Testing

```bash
node scripts/test-trigger-scheduler.js   # deterministic, timezone-independent
node scripts/test-mirror-sync.js         # lib byte-identical across both hook trees
```

Covered: due/not-due across boundary times, daily rollover at midnight and at
the occurrence, debounce rejecting inside the window (boundary inclusive),
dedupe on the same issue id, budget blocking at the limit, malformed specs
failing loud, and `buildRunGoal` sanitization/truncation.

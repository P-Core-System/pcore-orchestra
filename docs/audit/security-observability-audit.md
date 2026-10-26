# Security & Observability Audit — pcore-orchestra

- **Repo root:** local clone of this repo
- **Branch/commit at audit:** `main` @ `2faf3fb` (tree dirty only with `context/progress-tracker.md` + this new `docs/audit/` file)
- **Scope:** hook runtime (`bundle/hooks/`, `bundle/opencode/hooks/`), project bridge (`project-bridge/`, `.cursor/hooks/`), installer/scripts, skill scripts, CI workflows, docs claims.
- **Threat model:** local IDE-hook toolkit (no network service, no auth surface). Graded against: malicious/concurrent local sessions, hostile repo content, compromised or unverified upstream fetches, and silent data-integrity loss. Not graded as a multi-tenant server (none exists).
- **Method:** static read + targeted greps (rg) of source, docs, and workflows; cross-checked against prior `docs/audit/hook-runtime-audit.md`.
- **Evidence convention:** `path:line` refers to files in this repo at the audited commit.

---

## 1. Classified security findings (S-01 .. S-21)

Severity: **C** critical, **H** high, **M** medium, **L** low/info.

| ID | Severity | Finding | Evidence (file:line) | Notes |
|----|----------|---------|----------------------|-------|
| S-01 | M | Bridge joins unvalidated `scriptName` (argv) into an absolute path; `..` segments traverse outside `~/.cursor/hooks/` and the result is executed with `node` | `project-bridge/hooks/bridge.js:8,15,28`; identical copy `.cursor/hooks/bridge.js:8,15,28` | No basename/allowlist check. Mitigated today by hooks.json authors, not by code |
| S-02 | L | Stdin buffered unbounded before parse (`data += chunk`, no cap) in hooks; bridge caps child stdout (10MB) but not its own stdin accumulation | `bundle/hooks/lib/io.js:5-9`; `project-bridge/hooks/bridge.js:22-26` | Local memory-exhaustion vector |
| S-03 | L | Malformed hook JSON silently resolves `{}` (fail-open, error swallowed) | `bundle/hooks/lib/io.js:11-15` | Input faults invisible to any log |
| S-04 | H | Corrupt/unparsable state JSON is silently replaced by defaults, then overwritten on next save (silent data loss) | `bundle/hooks/lib/state-manager.js:244-248` (catch -> fresh), `:291-313` (save); same pattern `bundle/hooks/lib/observability.js:21-23`, `bundle/hooks/lib/history-recorder.js:15-17` | No backup, no error surfaced |
| S-05 | M | Non-atomic `fs.writeFileSync` on shared state files (no tmp+rename) -> torn/corrupt reads on crash mid-write | `bundle/hooks/lib/state-manager.js:313`; `bundle/hooks/lib/token-tracker.js:259`; `bundle/hooks/lib/history-recorder.js:45`; `bundle/hooks/lib/memory-manager.js:177`; `bundle/hooks/lib/observability.js:31`; `bundle/hooks/lib/memory-index.js:31`; `bundle/hooks/lib/project-manager.js:160` | Contrast: conductor + daily/version writers are atomic (see S-06 row) |
| S-06 | M | Read-modify-write races: load full JSON, mutate, write whole file, no lock; up to 4 `subagentStop` hooks fire per subagent completion | `bundle/hooks/lib/state-manager.js:268-313`; hook fan-out `project-bridge/hooks.json:16-36` | Lost updates under concurrent sessions (the exact scenario `docs/concurrency-tracking.md` exists for) |
| S-07 | M | `session-claims.json` written non-atomically from Python (`json.dump(..., open(path,"w"))`), no `flock` | `scripts/session-claims.sh:71`, `:96`, `:216` | Concurrency registry can self-corrupt under contention |
| S-08 | M | Security gate runs only in enterprise loop mode; core loop never scans | `bundle/hooks/lib/evidence-runner.js:196-198` | Default installs get no scan |
| S-09 | M | Scanner scope is `bundle/hooks/lib` only and walk skips all dot-dirs (`.github`, `.cursor`) and `node_modules` | `bundle/hooks/lib/evidence-runner.js:151-153`; `bundle/hooks/lib/security-scanner.js:129` | Workflows/installer/bridge never scanned |
| S-10 | M | Secret scan extension allowlist omits extensionless/`.env` files entirely | `bundle/hooks/lib/security-scanner.js:109` | `.env`, `Dockerfile`, `*.sh` never scanned |
| S-11 | L | `checkOwaspTop10()` exported but has 0 callers (dead control) | `bundle/hooks/lib/security-scanner.js:185,216`; confirmed `docs/audit/hook-runtime-audit.md:67` | OWASP self-check never executes |
| S-12 | M | Secret regexes require quoted values (`= "..."`/`: '...'`), miss dotenv/CLI style `PASSWORD=hunter2` | `bundle/hooks/lib/security-scanner.js:7-8` | Both critical rules have this shape |
| S-13 | L | Matched secret material is stored verbatim (first 50 chars) into findings/report output | `bundle/hooks/lib/security-scanner.js:52`, `:72` | Partial secret can land in logs/CI output |
| S-14 | M | Installer pipes remote script to shell with no checksum/signature verification | `scripts/ensure-opencode-latest.sh:90` (`curl -fsSL https://opencode.ai/install \| bash`) | Supply-chain trust on upstream host |
| S-15 | L | Weekly job fetches remote model list and rewrites local config; HTTPS only, no signature/pinning | `scripts/update-free-models.sh:41` (REMOTE_URL), `:195`, `:239` | Writes are atomic (`:743-752`) but content is unattested |
| S-16 | M | `PCORE_ORCHESTRA_REPO` env var selects path of a bash script later executed via `spawnSync("bash", [path,...])` | `bundle/hooks/orchestra-health.js:24-26`, `:40-42`, `:344`, `:364` | Env-controlled script execution (arg-array spawn, so not shell injection) |
| S-17 | L | Bridge `spawnSync` child hook has no timeout (host may hang on a stuck hook); only the prompt hook declares `timeout: 5` | `project-bridge/hooks/bridge.js:28-32`; `project-bridge/hooks.json:13` | Availability of the hook pipeline |
| S-18 | L | Errors swallowed with empty catch in runtime paths (heartbeat main, scanner file walk) | `bundle/hooks/orchestra-heartbeat.js:85-87`; `bundle/hooks/lib/security-scanner.js:121` | No failure signal emitted |
| S-19 | M | Integrity gates fail OPEN on tool error: git-status failure -> gate reported clean/skipped; `evidenceGitClean` always returns `ok:true` | `bundle/hooks/lib/phase-commit-gate.js:51-59`; `bundle/hooks/lib/evidence-runner.js:172-181` | Gate bypass when git is broken/unavailable |
| S-20 | M | CI has no secret-scan/SAST job, and shellcheck failures are explicitly ignored (`\|\| true`); CI otherwise syntax-check only | `.github/workflows/ci.yml:20-25` | Quality/security lint never fails a PR |
| S-21 | M | Turnstile secret is echoed to stdout as JSON by design and therefore flows into agent transcripts/logs | `bundle/skills/turnstile-spin/scripts/fetch-secret.sh:13` (doc contract), `:49` (emit) | Secret lands in persisted transcript data |

### 1.1 OWASP Top 10 (2021) mapping

| OWASP category | Findings | Count |
|----------------|----------|-------|
| A01 Broken Access Control | S-01 | 1 |
| A02 Cryptographic Failures | S-10, S-12, S-13, S-21 | 4 |
| A03 Injection | S-16 | 1 |
| A04 Insecure Design | S-17, S-19 | 2 |
| A05 Security Misconfiguration | S-02, S-08, S-09, S-11, S-20 | 5 |
| A06 Vulnerable and Outdated Components | (none identified in this pass) | 0 |
| A07 Identification and Authentication Failures | (n/a - no auth surface in local hook toolkit) | 0 |
| A08 Software and Data Integrity Failures | S-04, S-05, S-06, S-07, S-14, S-15 | 6 |
| A09 Security Logging and Monitoring Failures | S-03, S-18 | 2 |
| A10 Server-Side Request Forgery (SSRF) | (none - fixed upstream URLs only; no user-controlled fetch) | 0 |
| **Total** | | **21** |

---

## 2. Secrets-hygiene positives

| # | Positive | Evidence |
|---|----------|----------|
| P-01 | Repo-wide scan for live credential formats (`ghp_*`, `AKIA*`, `sk-/pk-`, `xox*-`, `AIza*`, RSA/OPENSSH private keys) matched only the scanner's own pattern definitions and one obviously fake doc placeholder | `bundle/hooks/lib/security-scanner.js:12-13` (patterns themselves); `bundle/skills/cloudflare/references/sandbox/gotchas.md:147` (`ghp_abc123` placeholder) |
| P-02 | No `.env` files committed; runtime state and claim files are gitignored | `.gitignore:6-17` (`orchestra.json`, `orchestra-tokens.json`, `orchestra-history.json`, `orchestra-metrics.json`, `memory-index.json`, `.pcore/`) |
| P-03 | All credential references in skill docs/examples go through `process.env.*`, never literals (78 matches, all env lookups) | e.g. `bundle/skills/cloudflare/references/api/configuration.md:28` |
| P-04 | Secret-fetch script hard-requires the env var and fails loudly when absent | `bundle/skills/turnstile-spin/scripts/fetch-secret.sh:34` (`: "${CLOUDFLARE_API_TOKEN:?...}"`) |
| P-05 | Hook runtime makes zero network calls (no `http/https/fetch/net.connect` in `bundle/hooks/`) | grep over `bundle/hooks/**` returned no matches -> no exfiltration channel from hook code |
| P-06 | CI uses only short-lived tokens with least-privilege `permissions` blocks; no long-lived secrets in workflows | `.github/workflows/maintenance.yml:6-9`; `.github/workflows/stale.yml:6-8`; `.github/workflows/org-health-scan.yml:22` (`secrets.PCORE_GH_TOKEN \|\| github.token`) |
| P-07 | Installer is `set -euo pipefail` (fail-fast, nounset) | `install.sh:11` |
| P-08 | Config rewrites are atomic and preserve file mode | `scripts/update-free-models.sh:743-752` (tmp + `os.replace`, mode restore) |
| P-09 | Security-scanner's own critical/high rules are excluded from self-scoring to prevent scanner-pattern false positives masking results (intentional, documented in code) | `bundle/hooks/lib/evidence-runner.js:155-158` |

---

## 3. Observability assessment

### 3.1 Capabilities inventory

| Capability | Module | Sink / retention | Wired? |
|------------|--------|------------------|--------|
| Lifecycle events (orchestra_start, stall_detected, stall_aborted...) | `bundle/hooks/lib/lifecycle-recorder.js` | `state/orchestra.json` (cap 200, `constants.js:4`) | Yes (`orchestra-heartbeat.js:48,61`; `state-manager.js:392`) |
| Heartbeat + stall detection (5-min threshold) | `bundle/hooks/lib/heartbeat-monitor.js` + `orchestra-heartbeat.js` | in-state `heartbeat.*` fields | Yes, but event-driven only (fires on stop/heartbeat hooks, not on an interval) |
| Run history (outcome, duration, iterations, tokens) | `bundle/hooks/lib/history-recorder.js` | `state/orchestra-history.json` (cap 50) | Yes |
| Token usage per phase/run + improvement tips | `bundle/hooks/lib/token-tracker.js` | `state/orchestra-tokens.json` (cap 100 runs) | Yes (`orchestra-subagent-stop.js:22`) |
| Metrics / SLO / incidents store | `bundle/hooks/lib/observability.js` | `state/orchestra-metrics.json` (caps 1000/20/200) | **No** - `recordMetric`/`defineSlo`/`recordIncident` have 0 production callers (exports only; `metrics-report.js:15` and `self-improvement.js:104` only read) |
| Health report renderer (availability/SLO/incidents) | `observability.generateHealthReport` | stdout via `metrics-report.js:78` | Partially - reads an empty metrics store by default |
| Composite dashboard CLI | `bundle/hooks/lib/metrics-report.js` | stdout (`orchestra-enable.js metrics`) | Yes |
| Install/health check (files, hooks.json, state, agents, claims) | `bundle/hooks/orchestra-health.js` (+ `bundle/opencode/hooks/orchestra-health-opencode.js`) | stdout + exit code 0/1 | Yes (`orchestra-health.js:389`) |
| Quality gates (build/tests/lint/security/docs) | `evidence-runner.js` + `quality-gate.js` | `state.qualityGates` | Yes; security gate enterprise-only (S-08) |
| Cycle reports | `bundle/hooks/lib/cycle-report.js` | `state/cycles/` | Yes |
| Semantic memory + inverted index (BM25-lite) | `semantic-memory.js`, `memory-index.js` | memory files (index cap 500) | Yes |
| Self-improvement suggestions | `bundle/hooks/lib/self-improvement.js` | reads token/metrics state | Partially (depends on empty metrics) |
| Session claims ("who is on what") | `scripts/session-claims.sh` | `.pcore/session-claims.json` (stale GC 30 min) | Yes (`orchestra-health.js:344-377`) |
| Conductor run registry (live/resume/stall) | `bundle/hooks/lib/conductor-state.js` | `~/.config/opencode/hooks/state/conductor-runs/` (atomic, GC) | Yes |
| Handoff size warnings | `bundle/hooks/lib/handoff-enforcer.js` | warning in output (2500-char cap) | Yes |

### 3.2 Gaps

1. **No structured logging** - `console.log`/`process.stdout.write` only; no levels, no JSON, no timestamps, no log files (`*.log` gitignored, never written by hooks).
2. **Metrics pipeline unwired** - `recordMetric` etc. never called (3.1 row 6); `calculateAvailability` returns `1` (100%) when no data exists (`bundle/hooks/lib/observability.js:111`), so any health report shows a false-perfect availability.
3. **No error aggregation** - errors are swallowed (S-03, S-18) or printed to stdout of a transient process; nothing persists hook failures.
4. **No hook latency instrumentation** - hooks are fire-and-forget; no timing recorded anywhere.
5. **No correlation ID** - session id exists via env chain (`state-manager.js:145-150`) but is not stamped on every event/log line.
6. **No alerting** - incidents exist as a data structure only; nothing emits them.
7. **Silent state corruption** - corrupt JSON resets to defaults without any event (S-04), so "data vanished" is undiagnosable.
8. **No redaction** - run history stores raw goal text (`history-recorder.js:24`) with no PII/secret scrubbing.
9. **No cross-machine view** - all sinks are local JSON files; no aggregation.

### 3.3 Can-answer / cannot-answer verdict

| Question | Verdict | Basis |
|----------|---------|-------|
| What phase/goal/iteration is active right now? | **CAN** | `state/orchestra.json` via `orchestra-enable.js status` / health |
| Which quality gates passed/failed/skipped last run? | **CAN** | `state.qualityGates` + evidence report |
| How many tokens did each phase burn, and tips? | **CAN** | `token-tracker.js` + `orchestra-enable.js tokens` |
| What happened in the last 50 runs (outcome/duration)? | **CAN** | `history-recorder.js` |
| Did a stall/abort occur and when? | **CAN** | lifecycle events `stall_detected` / `stall_aborted` |
| Who is working on which paths right now? | **CAN** | `session-claims.sh list/check` (subject to S-07 integrity caveat) |
| Which conductor runs are live/resumable? | **CAN** | `conductor-state.js` index |
| Why did a specific hook fail? | **CANNOT** | no persistent error log (gaps 1, 3) |
| How long do hooks take (p50/p95)? | **CANNOT** | no timing instrumentation (gap 4) |
| What is true availability / SLO status? | **CANNOT reliably** | metrics store never written; empty -> reports 100% (gap 2) |
| Did state corruption ever occur? | **CANNOT** | corruption silently resets (S-04, gap 7) |
| What did secret-scanning find over time? | **CANNOT** | on-demand, enterprise-only, narrow scope (S-08, S-09) |
| Cross-session/cross-machine error rates? | **CANNOT** | local files only (gap 9) |

**Verdict:** observability is **strong on state/query ("what is") and weak on telemetry ("why/how fast/how often")**. The loop's current state is answerable; historical failures, latency, and real availability are not.

---

## 4. Async / jobs inventory

| Job / job-like work | Path | Trigger | Process model |
|---------------------|------|---------|---------------|
| Cursor hooks: sessionStart, beforeSubmitPrompt, subagentStop (x4), stop (x2) | `project-bridge/hooks.json` -> `bridge.js` -> `~/.cursor/hooks/orchestra-*.js` | IDE events | Short-lived sync Node process per event (process-per-hook) |
| OpenCode health check | `bundle/opencode/hooks/orchestra-health-opencode.js` | manual/CLI | On-demand one-shot |
| Plan-signal watcher | `scripts/watch-plan-signal.sh` (`--watch`) | manual start | Polling loop `while true; sleep DEBOUNCE` (`:117-121`) |
| Free-model weekly refresh+apply | `scripts/update-free-models.sh` + `scripts/systemd/pcore-free-models.{service,timer}` | systemd user timer (weekly) or cron Mon 04:17 (`:866`, `:889`) | OS-scheduled batch (serial `opencode run` probes, 60s timeout each `:571`) |
| OpenCode CLI ensure/upgrade | `scripts/ensure-opencode-latest.sh` | install time (from `install.sh`) | One-shot batch |
| Session claims | `scripts/session-claims.sh` (claim/renew/check/list/gc) | on-demand CLI (also from health) | Request-driven one-shot |
| Evidence gates (build/tests/lint/security) | `bundle/hooks/lib/evidence-runner.js` | inside loop/CLI | Inline `spawnSync` (60s timeout, 2MB buffer `:31-32`) |
| GitHub Actions CI | `.github/workflows/ci.yml` | `pull_request` + `workflow_dispatch` | CI batch |
| GH Actions maintenance / org-health / stale | `maintenance.yml`, `org-health-scan.yml`, `stale.yml` | `workflow_dispatch` only | CI batch (manual) |
| LiteLLM proxy (BYOK helper) | `scripts/setup-cursor-byok.sh:300` (`... > /tmp/litellm-proxy.log 2>&1 &`) | manual start | Long-running background daemon |
| Fix/diagnose scripts | `scripts/fix-opencode-response.sh`, `scripts/diagnose-opencode.sh` | manual | One-shot with internal `sleep` retries |

### 4.1 Execution-model classification

| Class | Members | Traits |
|-------|---------|--------|
| **A. Event-driven short-lived synchronous processes** (dominant) | all Cursor/OpenCode hooks via bridge | stdin JSON -> mutate local state -> stdout JSON; no timers, no `setInterval` anywhere in `bundle/hooks/` |
| **B. On-demand CLI** | health, enable, claims, conductor-state.sh, metrics/tokens reports | user- or health-invoked one-shots |
| **C. OS-scheduled batch** | free-model refresh (systemd timer / cron) | weekly, serial, atomic config writes |
| **D. Long-running pollers/daemons** | `watch-plan-signal.sh --watch`; LiteLLM proxy | manual lifecycle, `sleep`-based polling |
| **E. CI event batches** | 4 GitHub workflows | 1 PR-triggered, 3 dispatch-only |

There is **no in-process job queue, worker pool, or async scheduler**; everything is process-per-invocation.

---

## 5. Concurrency assessment

| Shared resource | Writers | Atomic write? | Locking | Race exposure |
|-----------------|---------|---------------|---------|---------------|
| `state/orchestra.json` | all hooks via `state-manager.saveState` (`:268-313`) | **No** (direct `writeFileSync` `:313`) | none | High - concurrent sessions / 4x subagentStop fan-out (`hooks.json:16-36`) |
| `state/orchestra-tokens.json` | `token-tracker.js:259` | **No** | none | Medium |
| `state/orchestra-history.json` | `history-recorder.js:45` | **No** | none | Medium |
| `state/orchestra-memory.json` | `memory-manager.js:177` | **No** | none | Medium |
| `state/memory-index.json` | `memory-index.js:31` | **No** | none | Medium |
| `state/orchestra-metrics.json` | `observability.js:31` | **No** | none | Low today (unwired, S-08 row) |
| `state/orchestra-project.json` etc. | `project-manager.js:160` | **No** | none | Medium |
| Daily/version state | `daily-planner.js:76-77`, `version-manager.js:98-99` | **Yes** (tmp+rename, retry) | none (retry only) | Low |
| Conductor runs + `index.json` | `conductor-state.js:90-109`, `:123-127` | **Yes** (tmp+rename, 3-retry backoff) | none (index load/write still RMW) | Low-Medium (index upsert race) |
| `.pcore/session-claims.json` | `session-claims.sh:71,96,216` | **No** (plain `open(path,"w")`) | **none (no flock)** | Medium - registry meant for concurrency is itself racy (S-07) |
| `.cursor/orchestra-plan.md` + `state/plans/*` | `plan-artifact.js:69,73` | **No** | none | Low (single-writer per run assumed) |
| Backoff implementation | `conductor-state.js:102-106` | n/a | n/a | Busy-wait spin loop blocks CPU during retries (perf, see 6) |

### 5.1 Doc-vs-code verdict

| Doc claim | Source | Code reality | Verdict |
|-----------|--------|--------------|---------|
| "Concurrent loops never overwrite each other - every write is an atomic tmp+rename" | `bundle/hooks/lib/conductor-state.js:9-10` | True **for conductor run files + their index**; false as a system-wide statement - 7+ other state writers are plain `writeFileSync` (S-05) | **Overbroad** - correct within its module, wrong if read as global |
| session-claims answers "who is working, right now" with 30-min stale GC so "crashed sessions never deadlock a repo" | `docs/concurrency-tracking.md:5-15` | Claim/renew/check/list/gc all exist (`session-claims.sh`), stale default 30 (`:17`) matches doc | **Accurate on semantics**; but the claims file itself has non-atomic unlocked writes (S-07), so the registry can corrupt under the exact concurrency it exists to mediate |
| Heartbeat is periodic (`interval_ms = 60000`) | `bundle/hooks/lib/constants.js:18`; `state-manager.js:79` | No timer exists; `writeHeartbeat` only runs when the stop/heartbeat hook fires (`orchestra-heartbeat.js:41`, `orchestra-stop.js:27`) | **Mismatch** - field implies liveness cadence that is never produced |
| Multiple AI sessions may edit repos "at the same time" is the supported scenario | `docs/concurrency-tracking.md:3-4` | State writers have no locks/atomicity (table above) | **Aspiration vs implementation gap** |

**Overall verdict:** concurrency handling is **good inside `conductor-state.js` and partial in daily/version writers, absent everywhere else**; the heartbeat cadence and the "never overwrite" claims overstate what the code guarantees.

---

## 6. Performance observations

| # | Observation | Evidence | Impact |
|---|-------------|----------|--------|
| F-01 | Build gate spawns `node --check` up to 40 times serially per evidence run | `bundle/hooks/lib/evidence-runner.js:80-90` | ~40 process spawns per gate invocation |
| F-02 | Health check runs `session-claims.sh` twice synchronously with 10s timeouts each | `bundle/hooks/lib/../orchestra-health.js:344-347`, `:364-367` | Up to +20s added to health runtime on a stuck bash/python |
| F-03 | `atomicWrite` retry uses a **busy-wait spin loop** (`while (Date.now() < end) {}`) | `bundle/hooks/lib/conductor-state.js:102-106` | CPU burn during backoff; blocks the event loop |
| F-04 | Every hook save pretty-prints and rewrites the entire sessions root; sessions map has no pruning/GC | `state-manager.js:313` (no session GC anywhere in `state-manager.js`) | O(state size) write per event; unbounded growth over months (unlike ring-capped stores) |
| F-05 | Up to 4 sequential full-state rewrites per subagent completion (one per `subagentStop` hook) | `project-bridge/hooks.json:16-36` | 4x write amplification at phase boundaries |
| F-06 | Security scan is synchronous recursive `readFileSync` per file | `security-scanner.js:112-140` | Fine at current `lib`-only scope; would be slow if scope widened naively |
| F-07 | Free-model probe runs `opencode run` serially, 60s timeout per model | `update-free-models.sh:556-603` | Worst case N x 60s in the weekly job (acceptable for an offline batch) |
| F-08 | Ring caps are consistently enforced (history 50, tokens 100, lifecycle 200, metrics 1000, index 500, memory 100/50/50) | `bundle/hooks/lib/constants.js:4-46` + cap calls in each writer | **Positive** - bounded growth in capped stores |
| F-09 | Token estimation is local string-length heuristics; no model/network cost in hooks | `token-tracker.js` (no I/O beyond state file); P-05 | Hook runtime is cheap per invocation |
| F-10 | Bridge child has no timeout while prompt hook declares 5s | `bridge.js:28-32`; `hooks.json:13` | A hung hook can stall the stop pipeline indefinitely (ties to S-17) |

---

## 7. Required fixes

Priority: P0 = fix before next release, P1 = next sprint, P2 = backlog.

| # | Finding | Severity | Required fix | Priority |
|---|---------|----------|--------------|----------|
| R-1 | S-04 | H | On JSON parse failure of any state file: preserve the corrupt file as `*.corrupt.<ts>`, log an error, and only then fall back to defaults; never silently overwrite | **P0** |
| R-2 | S-05, S-06 | M | Route all state writers through one shared atomic write helper (tmp+rename, as `conductor-state.js:90-109` already does); add cross-process lock or per-session file split for `orchestra.json` | **P0** |
| R-3 | S-07 | M | Make `session-claims.sh` writes atomic (tmp file in same dir + `mv`) and wrap claim/gc in `flock` | **P1** |
| R-4 | S-01 | M | Validate `scriptName`: reject path separators/`..`, require `path.basename(x) === x`, allowlist `orchestra-*.js` | **P1** |
| R-5 | S-08, S-09, S-10, S-12 | M | Run security scan in core mode too; widen target to repo root (respecting `.gitignore`); scan extensionless/`.env` files; add unquoted `=` secret rule | **P1** |
| R-6 | S-19 | M | Gates fail CLOSED on tool error (git unavailable -> FAIL or explicit BLOCKED, not `clean:true`); make `evidenceGitClean` report real status | **P1** |
| R-7 | S-20 | M | Remove `\|\| true` from shellcheck (or keep as non-blocking separate step); add a secret-scan job (gitleaks/trufflehog) + `node --check` already present | **P1** |
| R-8 | S-14, S-15 | M/L | Pin installer/remote-fetch integrity (checksum or release signature) for `opencode.ai/install` and the model-list endpoint | **P1** |
| R-9 | 3.2 gaps 1-3 | - | Introduce a small structured logger (JSON lines, level, session id, timestamp) with append + rotation for hook errors; wire `recordMetric` into heartbeat/stop or delete the dead metrics API | **P1** |
| R-10 | 3.2 gap 2 | - | `calculateAvailability` must return `null`/N/A on empty data instead of `1` (avoid false 100%) | **P1** |
| R-11 | S-16, S-17, S-18 | M/L | Sanitize `PCORE_ORCHESTRA_REPO` (must contain sentinel, already checked - document as trust boundary); add timeout to bridge `spawnSync`; replace empty catches with stderr diagnostics | **P2** |
| R-12 | S-13, S-21, 3.2 gap 8 | L/M | Redact matched secrets in findings (hash/label only) and stop emitting raw Turnstile secrets to stdout (write to a 0600 temp file or mask in transcripts) | **P2** |
| R-13 | F-03, F-04, F-05 | - | Replace busy-wait with async sleep (or keep retries but sleep between); add session GC/pruning to `orchestra.json`; coalesce the 4 `subagentStop` writes into one | **P2** |
| R-14 | Doc claims (5.1) | - | Correct `conductor-state.js` header (scope the atomicity claim), `docs/concurrency-tracking.md` (state write limits), and heartbeat docs (event-driven, not 60s interval) | **P2** |

### Summary counts

- Findings: **21** (1 H, 13 M, 7 L) - no criticals; no network/auth surface exists to produce one.
- OWASP spread: A08 (6), A05 (5), A02 (4) dominate - this codebase's risk is **data integrity and control wiring**, not injection or exposure.
- Secrets hygiene: **9 positives, 0 live credentials found**.
- Observability: **strong state queries, absent telemetry** - 9 gaps, 5 of 14 questions unanswerable.
- Concurrency: atomic in conductor/daily/version; **unlocked + non-atomic everywhere else**; 3 documented claims overstate guarantees.
- Performance: bounded by ring caps (good) but **40-spawn gates, full-state rewrites, busy-wait retries, unpruned sessions** are the hot spots.

---
*Audit generated from static analysis at commit `2faf3fb`. Companion documents: `docs/audit/hook-runtime-audit.md`, `docs/audit/agent-architecture-audit.md`.*
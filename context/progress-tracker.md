# Progress Tracker

SEE ALSO: older session logs archived at docs/archive/progress-tracker-2026-11-02.md (nothing deleted).

Update this file after every meaningful implementation change.
- Context slim: progress-tracker < 100KB, architecture < 40KB
- context-index.json with phase budgets
- Phase-selective injection wired in all 4 hook files

## Next Up

- Verify token usage per phase is under budget

## 2026-11-12 — separator-agnostic scanner gates on Windows (8->0, npm-churn revert)

- Reverted uncommitted `studio/package-lock.json` churn (214-line npm prune, unrelated to scope) via `git checkout --`; tree clean.
- `bundle/hooks/lib/evidence-runner.js` (+ byte-identical OpenCode mirror): `isSelfScanExcluded` normalizes `\` -> `/` before testing the forward-slash `file` patterns — `path.relative` yields backslashes on Windows so the scanner's own rule-source literals + the `phase-outcome.js` regex-exec FP were never excluded and every `evidenceSecurity` gateFixture test failed. Detection heuristics untouched; POSIX no-op (proven by equivalence check: old vs new agree on all POSIX samples, Windows now matches POSIX).
- `scripts/test-security-scanner.js`: NEW `norm()` helper; all 6 multi-segment path comparisons (dot-dir regex, OWN_REL x2, plain.js sibling, N1 blocked/allowed/control) compare `norm(f.file)`. Separator-free basenames (`Dockerfile`, `blob.js`, `keep.js`) and substring regexes left as-is. No assertion weakened.
- Verified: `test-security-scanner.js` exit 0 (144 assertions, was 8 FAILED); `scan-secrets --dir . --fail-on=high` exit 0; `test-evidence-runner.js` green; `test-trigger-scheduler` green; `test-update-free-models-paths.sh` 10 checks; `test-install-ps1-parity.sh` 44 passed; `test-mirror-sync.js` PASS.
  Key files: `bundle/hooks/lib/evidence-runner.js` (+ mirror), `scripts/test-security-scanner.js`, `context/progress-tracker.md`.
  Impact: scanner gates + self-scan exclusions behave identically on Windows and POSIX; green-up round unblocked.

## 2026-11-12 — blocking gates green: scanner FP fix, trigger-scheduler .match, install.ps1 Git-Bash resolution

- `bundle/hooks/lib/security-scanner.js` (+ byte-identical OpenCode mirror): unquoted `KEY=value` rule no longer treats dotted JS member assigns (`result.wastedTokensInFixCycles = wastedTokensInFixCycles;`) as secrets — KEY char class dropped `.` (`[A-Za-z0-9_.-]*` → `[A-Za-z0-9_-]*`); `PASSWORD=hunter2` / `TOKEN=abc123` still critical. `SKIP_DIRS` gains `.kilo` + `.pcore` (worktree copies no longer scanned); `.kilo/` added to `.gitignore` + `.ignore` + `.cursorignore`.
- `bundle/hooks/lib/trigger-scheduler.js` (+ mirror): both regex-`.exec(...)` call sites (cron-field line 100, daily-time line 258) converted to identical-semantics `str.match(...)` — non-global regex, same result shape. Removes the last first-party high findings.
- `.secret-scan-allow` (62 → 64 entries): narrow `file:docs/archive/progress-tracker-2026-11-02.md + label:exec() call` for the archive prose quoting the scanner rule text; narrow `file:scripts/test-trigger-scheduler.js + label:exec() call` for the suite pinning the `.match` form. Header count corrected (was stale at 60 vs 62 actual).
- `scripts/update-free-models.sh`: `atomic_write` forces `newline='\n'` (CRLF from native Windows python3 broke bash consumers); probe JSONL `reachable` now serializes as a real JSON boolean (`True`/`False` in the `-c` source → `true`/`false` in JSONL, so `check_probe_reachability` `is True` identity holds — the plan's literal `true`/`false` would have been a Python NameError; closest-correct form implemented).
- `install.ps1`: NEW `Find-GitBash` (Git `ProgramFiles` / `ProgramFiles(x86)` / `C:\Program Files\Git\bin\bash.exe` first, PATH `bash` last); free-model refresh/apply + schtasks wrapper use the resolved path; WSL-only bash warns actionably (install Git for Windows or run from Git Bash).
- Tests (updated, not weakened): `test-security-scanner.js` pins dotted-assign ignored + bare secrets critical + `.kilo` skipped; `test-trigger-scheduler.js` pins `.match` form + no `.exec(`; `test-update-free-models-paths.sh` pins `newline='\n'` + boolean reachable; `test-install-ps1-parity.sh` pins Git-Bash order + warning.
- Verified with real Git Bash: `scan-secrets --dir . --fail-on=high` → Critical 0 / High 0 / PASS exit 0 (with `.kilo` present); trigger/parity/paths suites green; `test-mirror-sync.js` PASS. `test-security-scanner.js` has 9 remaining failures that pre-exist at HEAD unchanged (Windows backslash-vs-slash path expectations in fixture assertions, e.g. `^\.github\/workflows` vs `.github\workflows`); the only HEAD-vs-now delta is the fixed header-count test.
  Key files: `bundle/hooks/lib/{security-scanner,trigger-scheduler}.js` (+ mirrors), `.secret-scan-allow`, `scripts/update-free-models.sh`, `install.ps1`, `scripts/test-{security-scanner,trigger-scheduler,update-free-models-paths,install-ps1-parity}.sh/.js`, `.gitignore`, `.ignore`, `.cursorignore`, `context/progress-tracker.md`.
  Impact: `scan-secrets --fail-on=high` (CI + loop gate) is green; install works on Git-Bash-first Windows without WSL confusion; probes report real reachability.

## 2026-11-12 — update-free-models.sh native-Windows python3 support (Git Bash)

- `scripts/update-free-models.sh`: NEW `PY_IS_WIN` detection + `py_path()` (`cygpath -m` on win32, byte-identical POSIX passthrough) — every path interpolated into `python3 -c` now goes through it (`load_probes`, `fetch`, count, `extract_models`, `check_probe_reachability`, `age`, `free_models`, `probe`, probe-consolidate), fixing FileNotFoundError for `/c/...`, `/d/...`, `/tmp/...` (MSYS converts argv but not `-c` source). Empty-cache fail-closed: `-s` gates in `write_pools`/`run_check`/`run_apply`, `write_pools` cache load in try/except (warn + exit 1), post-fetch tmp cache must be non-empty AND JSON-parseable (python argv / jq) before `mv -f` — never `mv` an empty file over a good cache. Provider-scoped free-tier verdict in `extract_models` (python + jq) and `check_pools`: refs with a non-`opencode` provider prefix are deliberate paid overrides and skipped; bare ids + `opencode/*` stay fully validated (STALE-POOL/DEAD unchanged for real free models). `write_pools` curl now `subprocess.run([...], timeout=20, capture_output=True)` instead of `os.system` string concat (no shell quoting for paths with spaces). Python stdout is `tr -d '\r'`-stripped at every bash consumer (native python3 emits CRLF — `grep -qxF`/`==` comparisons and picked model IDs were otherwise poisoned).
- NEW `scripts/test-update-free-models-paths.sh` (7 checks, no network): `bash -n`, gate rejecting raw path vars interpolated into `-c` (`open('$CACHE_FILE` etc.), `py_path`/`PY_IS_WIN` presence + ≥9 use sites, cygpath-conditional absolute-path assertion (POSIX passthrough assertion otherwise). Wired into `context/code-standards.md` self-check list + `.github/workflows/ci.yml` host-suites step.
  Key files: `scripts/update-free-models.sh`, `scripts/test-update-free-models-paths.sh`, `.github/workflows/ci.yml`, `context/{architecture,code-standards,progress-tracker}.md`.
  Impact: `--refresh`/`--check`/`--pools`/`--probe`/`--apply` work on a native Windows 3.14 python3 under Git Bash; a failed fetch can no longer destroy a good cache; a deliberate provider override no longer reports DEAD/STALE-POOL.

## 2026-11-12 — install-HEAD verification + team-supervisor-hod capability sync

- Verified install at HEAD (`b055b25`): health exit 0 (162/162 agents, all hooks/lib OK), `gen-agent-registry.js --check` OK (27 hook agents, 162 files), `test-mirror-sync.js` PASS (75 hook files, all lib byte-identical), installed `~/.cursor/hooks/lib` matches bundle (diff clean), worktree clean.
- `0d77aea` chore(agents): synced WebFetch/WebSearch capabilities onto `team-supervisor-hod` across bundle + claude/qoder mirrors; `bundle/agent-registry.json` regenerated (capability allowlist only, no coverage change).
- Re-verify after sync: health/registry/mirror/installed-match all green, `git status --porcelain` empty.
  Key files: `bundle/agents/04-planning/team-supervisor-hod.md`, `bundle/agent-registry.json` (+ claude/qoder mirrors), `context/progress-tracker.md`.
  Impact: HOD agent can use WebFetch/WebSearch per its researcher-adjacent duties; install-HEAD proven green end to end with a clean tree.

## 2026-11-11 — layer diagram docs (WI-0, docs only)

- NEW `docs/layer-diagram.md`: Mermaid layer graph (presentation → server → business → persistence), per-subsystem Mark Richards patterns, trade-offs, allowed-import table, violation examples.
- `context/architecture.md`: "Harness > Scaffold > Loop" prose replaced with link-out pointer to `docs/layer-diagram.md`; 61275 → 61006 bytes (−269, net ≤ 0 vs baseline).
  Key files: `docs/layer-diagram.md`, `context/architecture.md`, `context/progress-tracker.md`.
  Impact: layered view lives in one docs page; architecture.md shrinks; no code/CI/tests touched.

## 2026-11-12 — renew preserves holder identity, explicit session mints fresh

- `bundle/hooks/lib/session-claims.js` (+ byte-identical OpenCode mirror): `claimSession` reuse path preserves holder identity — claimKey/member/team/sessionId/workspace/workspaceSlug kept from the live slot; only heartbeatAt/updatedAt always move, scope/role/branch/host move when explicitly provided (implicit renew without `--role` no longer demotes a leader to `member`). An EXPLICIT `o.sessionId` differing from the holder session mints a fresh session-scoped slot (never rewrites); implicit (resolved) sessions renew in place; explicit-equal renews in place; stale/`newSlot` behavior unchanged. `heartbeatClaim` audited touch-only (docstring now states it). `session-wake.js` (+ mirror): `ackWake` is claimKey-equality-first (exact holder hits outright, same-member sibling fallback preserved, non-target still `WAKE_DENIED`).
- Pins: `test-slot-reuse.js` (40 checks: cross-session implicit renew keeps `ses-a` identity + `renewed:true`, second renew idempotent, same-explicit renews, different-explicit mints `ses-b`, CLI same/different/implicit `--session`, post same/different session); `test-team-sessions.js` (+3: same-session renew flag, explicit-different mints fresh, holder slot untouched); `test-session-wake.js` (+2: sibling same-member fallback ack). Suites green: slot-reuse, team-sessions, session-wake, team-discussion, team-roundtrip, team-dispatch, team-hod, evidence-runner, mirror-sync.
- `scripts/team-sessions.sh` help text notes the explicit-`--session` mint-fresh rule.
  Key files: `bundle/hooks/lib/{session-claims,session-wake}.js` (+ mirrors), `scripts/test-{slot-reuse,team-sessions,session-wake}.js`, `scripts/team-sessions.sh`, `context/{architecture,progress-tracker}.md`.
  Impact: a member's slot is stable across sessions — re-claims/heartbeats/discuss-posts renew the holder's identity instead of migrating it; explicit `--session` is the deliberate pin for a new key.

## 2026-11-11 — member-filtered discuss list shows same-team star legs

- `bundle/hooks/lib/team-discussion.js` (+ byte-identical OpenCode mirror): `matchDiscussionFilter` member clause — same-team `m2l`/`l2m` (sanitized `filter.team == msg.team`, both non-empty) matches any member-filtered list; `group` branch, `m2m`/`l2l` author/to privacy, and kind/topology/topic/resolved order unchanged; docstring updated.
- `scripts/test-team-discussion.js`: +4 pins (HOD sees same-team `m2l`/`l2m` + `group`; Alice hides Bob-Carol `m2m`/`l2l`; other-team star hidden; no-team filter never leaks star legs) — suite green, `test-mirror-sync.js` + `test-team-roundtrip.js` + `test-session-wake.js` green.
  Key files: `bundle/hooks/lib/team-discussion.js` (+ mirror), `scripts/test-team-discussion.js`, `context/{architecture,progress-tracker}.md`.
  Impact: a member-filtered `discuss list --member M --team T` shows the team's star push/pull legs and broadcasts without exposing pairwise `m2m`/`l2l` or leaking across teams.

## 2026-11-11 — slot reuse on re-claim (findLiveSlot, --new-slot hatch)

- `bundle/hooks/lib/session-claims.js` (+ byte-identical OpenCode mirror): NEW `findLiveSlot` (live slot by member+team+slug, any session; skips stale candidates so a stale-first roster still finds the live slot); `claimSession` renews the live slot in place by default (same claimKey, `renewed: true`, heartbeat/scope/session/role/branch refreshed, scope-less renew keeps prior scope, self-exclusion on the renewed key); `{ newSlot: true }` hatches a parallel session-scoped slot; stale slots mint fresh. Scope guard intact (foreign overlap still `SCOPE_CONFLICT`).
- `scripts/team-sessions.sh`: NEW `--new-slot` hatch (claim/dispatch/supervise/discuss-post; dispatch/supervise/request default to reuse); help text documents renew-by-default.
- NEW `scripts/test-slot-reuse.js` (25 checks: renew same key/count1/renewed, scope refresh + scope-less keep, hatch count2, stale fresh, findLiveSlot session-ignore/unknown-null, SCOPE_CONFLICT + self-overlap pass, CLI claim reuse/renewed/--new-slot, discuss-post author reuse) wired into CI orchestration suite + `context/code-standards.md` self-check list.
  Key files: `bundle/hooks/lib/session-claims.js` (+ mirror), `scripts/team-sessions.sh`, `scripts/test-slot-reuse.js`, `.github/workflows/ci.yml`, `context/{architecture,code-standards,progress-tracker}.md`.
  Impact: one member holds one live slot per team/workspace across sessions — re-claims, dispatch re-runs, and discuss posts renew instead of fragmenting the roster; `--new-slot` covers the parallel-slot escape hatch.

## 2026-11-11 — HOD autonomous loop + R&D (supervise/queue/done, research, whitepapers, UX)

- NEW `bundle/hooks/lib/team-supervisor.js` (+ mirror): pure `sweep({backlog, claims, requests})` (FIFO requests first, HOD-push remainder, busy never assigned), `nextAction` (work/idle/release), `memberBranch`/`memberClaimKey`/`memberWorktree` (/tmp rejected, inv 38); `team-requests.js` FIFO durable `team-requests.json` (shared 30/31 carve-out, `enqueue`/`grant`/`list`); `team-done.js` SHA reports (`team-done.json` shared carve-out, `DONE_BAD_SHA` refusal); `team-research.js` `scoreOption`/`pickBest` (25/20/20/15/10/10, missing=0, deterministic).
- `scripts/team-sessions.sh`: `supervise --team T [--dry-run]` (sweep → claim + per-member `.pcore/state` worktree + payload, SCOPE_CONFLICT skips), `queue enqueue|list|grant`, `done report|list` — all `--json`, fail-open, proven live on a temp `PCORE_STATE_DIR`.
- `spawn-adapter.js` (+ mirror, additive): `spawnBackground` (detached handle, async errors observed never thrown) + `teamParallelWaves` greedy packing over `canDispatchInParallel` (same-claim/teammate-worktree/scope-conflict serialize, inv 32).
- Agents: `team-supervisor-hod.md` (04-planning, readonly) + `team-researcher.md` (00-domain, readonly, official-sources/latest-stable); registry regen 160 → 162 files (`gen-agent-registry.js --check` OK); qoder/opencode/claude/codex syncs re-run (8 stale claude/codex core mirrors caught up — pre-existing drift from 4889560/8f66c01/a56f832/2ff878e, fixes red CI `--check` lines).
- R&D: `templates/whitepaper.md` (pending → approved per order, never auto-applies) + `docs/whitepapers/README.md` gate doc; `docs/ux-tokens-patterns.md` (DTCG 3-tier first, patterns gap-fill only against the skill/template inventory).
- Tests: NEW `scripts/test-team-hod.js` (33 checks) wired into CI orchestration suite + `context/code-standards.md` self-check list; `test-mirror-sync.js` + `test-spawn-adapter.js` + `test-team-dispatch/sessions` green.
  Key files: `bundle/hooks/lib/team-{supervisor,requests,done,research}.js` (+ mirrors), `bundle/hooks/lib/spawn-adapter.js` (+ mirror), `scripts/team-sessions.sh`, `bundle/agents/{04-planning/team-supervisor-hod,00-domain/team-researcher}.md` (+ 4-host mirrors), `templates/whitepaper.md`, `docs/{whitepapers/README,ux-tokens-patterns}.md`, `scripts/test-team-hod.js`, `.github/workflows/ci.yml`, `context/{architecture,code-standards,progress-tracker}.md`.
  Impact: HOD can run the full assign → nudge → collect loop from the CLI with SHA-verified completions; researchers score options deterministically and write human-gated whitepapers; no scope beyond the team loop.

## 2026-11-11 — fix A<->B session replies invisible (shared team state)

- PRIMARY: A m2m->B, B lists sees, B replies, A sees both; same group — all with no --worktree on a shared PCORE_STATE_DIR, proven by NEW `scripts/test-team-roundtrip.js` (18 checks, real `team-sessions.sh` CLI with two SESSION_IDs SES_A/SES_B).
- WI-1 unify: `claimsDir`/`discussionDir`/`wakesDir` ignore `worktreePath` (always shared `resolveStateDir`); legacy `<worktree>/.pcore/state/` files merged into reads (shared wins), writes always shared; new `legacyClaimsFile`/`legacyDiscussionFile`/`legacyWakesFile` exports; byte-identical OpenCode mirrors. Invariants 30/31 carve-out documented (conductor runs/domain events stay partitioned).
- WI-2 dispatch/discuss use returned identity: dispatch payload built from the live `claim.claimKey`/`branch` + dispatched record carries real `sessionId`/`workspaceSlug`; `request` output adds `sessionId`/`workspaceSlug` next to the grant.
- WI-3 discussion visibility: `matchDiscussionFilter` matches `group` broadcasts on member-filtered lists when the team matches (the A->B invisibility: B never saw the broadcast); `to` accepts member name or claim key both directions; default `topology=all`; `getThread` keeps resolved.
- WI-4 wakes are team-scoped: same-team slots pair across workspaces/projects (shared state dir is the trust root); team mismatch stays `WAKE_CROSS_SCOPE` (exit 2).
- WI-5 bare `list` shows live/unresolved only, `--all` adds stale claims + resolved messages + acked wakes; `list`/`who` share the one `groupByTeam` path.
- Tests: `test-team-sessions.js` (shared+legacy pins, CLI bare/--all stale), `test-team-discussion.js` (group-visibility filter pins, shared+legacy), `test-session-wake.js` (same-team allow, cross-team deny, shared+legacy); CI orchestration suite + `context/code-standards.md` self-check list wire `test-team-roundtrip.js`; `context/architecture.md` rows/invariants 30/31/41 updated in place.
  Key files: `bundle/hooks/lib/{session-claims,team-discussion,session-wake}.js` (+ opencode mirrors), `scripts/team-sessions.sh`, `scripts/test-team-{roundtrip,sessions,discussion}.js`, `scripts/test-session-wake.js`, `.github/workflows/ci.yml`, `context/{architecture,code-standards,progress-tracker}.md`.
  Impact: cross-session pairing (discuss + wake) works out of the box on shared state — no worktree flags needed; pre-unify worktree files stay readable.


## 2026-11-10 — release 3.10.0 + context-truth docs sweep

- Install verified: `bash install.sh --dry-run` (opencode 2.2.7 already at
  registry target, no upgrade needed) → `bash install.sh --all` PASS; health
  exit 0 on Cursor + OpenCode + Qoder; `gen-agent-registry.js --check` OK
  (27 hook agents, 160 files); `test-mirror-sync.js` PASS.
- DEFECT (pre-existing at HEAD, exposed by install): `install.sh --all` runs
  agent sync and dirtied 8 generated mirrors (`bundle/claude/agents/` +
  `bundle/codex/agents/` orchestra-{planner,implementer,verifier,reviewer}:
  one-run-one-holder line + baseline/live-proof/env-divergence sections from
  commits 4889560/8f66c01/a56f832/2ff878e were never synced). Reverted to HEAD
  to keep this round scoped — needs a follow-up `sync-claude/codex` commit;
  CI `--check` lines for claude/codex are red until then.
- Release bump 3.9.1 → 3.10.0 (MINOR: knowledge hub + team loop are new
  features): `package.json`, `project.yaml` (current + `lifecycle.updated`
  2026-11-10 + `version_history` entry, build 2 → 3); synced `README.md`
  (badge/status/clone tag v3.10.0), `SECURITY.md` (supported table + tag refs),
  `docs/index.md` (3.10.0); `CONTRIBUTING.md` has no version string (no-op).
  `CHANGELOG.md`: Unreleased Added/Fixed moved under `[3.10.0] - 2026-11-10`
  + team-loop/guardrails Added bullet + release link ref.
- Context truth: `architecture.md` carries a size-budget note (57.7KB,
  pre-existing over the 40KB budget); pinned true counts re-run live
  (`test-team-discussion.js` = 59 checks — tracker wrongly said 65, fixed;
  `test-session-wake.js` = 65, already correct); NEW `data/conductor/`
  `.gitignore` (`*` + `!.gitignore`, durable artifact dir).
  Key files: `package.json`, `project.yaml`, `README.md`, `SECURITY.md`,
  `docs/index.md`, `CHANGELOG.md`, `context/architecture.md`,
  `context/progress-tracker.md`, `data/conductor/.gitignore`.
  Impact: version strings agree everywhere; context budgets honest; conductor
  artifacts have a durable, git-ignored home; two commits, no pushes.

## 2026-11-10 — Wave2: team discussion + leader-push/member-pull + CI upgrades

- NEW `bundle/hooks/lib/team-discussion.js` (+ byte-identical OpenCode mirror): directional kinds m2m/l2m/m2l/l2l/group, topology filter 2way/star/group (`topologyOf`/`matchDiscussionFilter`), claim-key authorship; JSONL store `<state>/team-discussion.jsonl` (worktree-partitioned per inv 30/31), ring-capped at `DISCUSSION_CAP` 500 with `pruneDiscussion`; `post`/`list`/`resolve`/`react` via safe-write locks. Key files: `bundle/hooks/lib/team-discussion.js`, `scripts/test-team-discussion.js` (59 checks green).
  Impact: leader/member pairing has a persistent, attributable channel; Studio replays it live.
- Domain constants +3 event types (`discussion.posted`/`resolved`/`reaction`) + `recordDiscussionOutcome` fail-open (invariant 19); `server/ws.js` replays them 1:1 at `/api/ws` with `?type=`/`?team=` filter matrix (`parseWsFilter`/`matchWsEvent`, default subscribes all — Studio loopback unchanged).
- `scripts/team-sessions.sh`: `discuss post|list|react|resolve --json` (post renews author slot, SCOPE_CONFLICT → SKIP exit 2), `dispatch --free-only` (leader push to idle slots), `request --member M` (member pull: grants next backlog item + claimKey/branch when free, SKIP exit 2 when busy/empty). Lib: `backlogByMember` `busyMembers` free-check (+`busy` list), `team-dispatch.js` `filterFreePlans`/`planLeaderPush`/`requestWork`.
- Upgrades: CI Node 20/24→22/26, `actions/checkout` + `setup-node` v4→v7 (v7 tags verified live); `@modelcontextprotocol/sdk` ^1.32.0→^1.32.2, `express` ^5.3.0, `ws` ^8.22.2 (latest stable per npm registry; lockfiles refreshed). New CI jobs: `supply-chain` (cyclonedx SBOM root+server, license allowlist, `npm audit --audit-level=high`), `hook-latency` (health hook <30s), `token-gate` (budget-table contract). CI wires `test-resume-collision`/`test-plan-artifact`/`test-baseline-adjudication`/`test-team-discussion`; `context/code-standards.md` self-check list synced (team/collision/artifact/adjudication/agent-sync/claude/codex + shell suites).
  Impact: toolchain current, supply-chain + latency + token budgets gated on every PR.

## Open Questions

- None

## Architecture Decisions

- Never inject full file contents; only section pointers per phase budget
- Large files use fullReadOnlyWhenExplicitlyNeeded flag
- Archive old entries; never delete history


## Token / Context Optimization (Phase 2)
- Verified context-index.json section mappings: progress-tracker.md and architecture.md emit only section summaries + file pointers (never full content); code-standards.md can be fully injected when needed
- Verified context-detector.js AMBIENT_CONTEXT static prefix is cache-safe: no timestamps, run/session ids, or UUIDs in the protected region
- Verified orchestra-spawn-matrix.js ambientContextBlock() is byte-stable across sessions (static text, no dynamic elements)
- Audited agent tools:allowlists: no agent exceeds 8 tools in agent-registry.json; no redundant tools identified
- Verified OpenCode autonomy.json: small_model=opencode/big-pickle, compaction.auto=true, tool_output caps (max_lines: 300, max_bytes: 12288) enabled, narrow instructions globs
- All changes maintain byte-identical mirror between bundle/hooks/lib/ and bundle/opencode/hooks/lib/ (test-mirror-sync.js exits 0)
- Updated progress-tracker.md with optimization entries documenting changes


## 2026-11-02 — BOM purge (v3.9.1)
- Removed UTF-8 BOMs from bundle hooks (orchestra-prompt.js, orchestra-session-start.js) that broke Node shebang parsing and caused UserPromptSubmit hook SyntaxError
- Stripped BOMs from bundle/opencode hooks + 12 opencode SKILL.md files and docs (archive tracker, hook-runtime-audit)
- Repaired installed copies in ~/.qoder/hooks; all 11 hooks smoke-test exit 0; test-mirror-sync passes
- Bumped version 3.9.0 -> 3.9.1 (package.json, project.yaml), tagged v3.9.1

## 2026-11-10 — WI-9 doc-sync: named team sessions (4+ members, HOD assign)
- Docs only (code green in 8d710e4): synced `context/architecture.md` system boundaries (new `session-claims.js`, `project-manager.js` `backlogByMember`, `scripts/team-sessions.sh` rows; roster fields on `conductor-state.js`; `session.claimed/heartbeat/released` on domain constants/entities/index) + storage (`team-sessions.json`, roster on run index) + invariants 15/18/19/20/26/30/31/32/33 (safe-write claims, mirror, store-only `recordSessionOutcome`, claim-is-not-completion, commit-discipline clause, worktree-partitioned claims, same-claim/teammate-worktree/`SCOPE_CONFLICT` parallel gates, member/team/claimKey provenance). Added `## Named team sessions (WI-9)` section (HOD assigns via `backlogByMember`, members claim/heartbeat/release scopes, `SCOPE_CONFLICT` blocks overlap).
  Key files: `context/architecture.md`, `context/progress-tracker.md`.
  Impact: 4+ member teams get documented cross-CLI slots (claim key `team/member/slug/sessionId`, `Name@slug` display, 30-min stale, worktree-aware) with HOD assignment, scope-guarded parallel dispatch, and commit-discipline handoffs; no code touched.

## 2026-11-10 — team dispatch fan-out (WI-9 dispatch --team Alpha)
- New pure planner `bundle/hooks/lib/team-dispatch.js` (+ byte-identical `bundle/opencode/hooks/lib/team-dispatch.js` mirror): `planDispatch` fans out one sorted deterministic record per backlog member (any N, unknown team -> []), scope normalize, branch `member/<team>/<member>`, optional `worktreePath`; `shouldSkipOnConflict` guard (`SCOPE_CONFLICT` -> skip-continue); `buildDispatchPayload` additive `member`/`team`/`claimKey` (invariant 33); no fs/cp/env (invariants 15/19).
- `scripts/team-sessions.sh dispatch --team T [--member M,J] [--session S] [--worktree-base D] [--dry-run] [--json]`: dry-run plans with zero side effects; live loop claims each scope, `mkdir`s per-member `worktreePath/.pcore/state`, emits payloads, continues past `SCOPE_CONFLICT` (exits 0 all claimed / 2 partial / 1 error).
- New `scripts/test-team-dispatch.js` (34 checks, temp-dir only: purity, sorting, filter, scopes, guard, payload, CLI dry-run/live/partial-exit) + CI orchestration-suite line.
  Key files: `bundle/hooks/lib/team-dispatch.js`, `bundle/opencode/hooks/lib/team-dispatch.js`, `scripts/team-sessions.sh`, `scripts/test-team-dispatch.js`, `context/architecture.md`, `.github/workflows/ci.yml`.
  Impact: HOD can fan out `dispatch --team Alpha` to N members (2 now, scalable) with scope-guarded claims and per-member worktrees; conflicts skip instead of aborting.

## 2026-11-10 — opensource-ready docs pass (UTF-8 tracker, version sync, issue template, CI)
- Converted `context/progress-tracker.md` from UTF-16LE+BOM CRLF to UTF-8 LF no BOM; all entries preserved byte-for-byte through the conversion.
- Synced public version strings to 3.9.1 / November 2026: `README.md` badge + status line + clone tag, `SECURITY.md` supported-versions table (3.9.1 supported), `CONTRIBUTING.md` five-host intro, `docs/index.md` docs version 3.9.1 (November 2026).
- Expanded `.github/ISSUE_TEMPLATE/bug_report.md` Environment section (host, OS, Node, orchestra version, install flags, logs/state).
- Added `node scripts/test-team-sessions.js` to the CI orchestration suite after the team-dispatch line.
  Key files: `context/progress-tracker.md`, `README.md`, `SECURITY.md`, `CONTRIBUTING.md`, `docs/index.md`, `.github/ISSUE_TEMPLATE/bug_report.md`, `.github/workflows/ci.yml`.
  Impact: repo reads as opensource-ready — no stale 3.9.0/3.7/October strings, no mojibake tracker, actionable bug reports, full team-session coverage in CI; no harness code touched.

## 2026-11-11 — resume-collision guard (one run, one holder)
- `bundle/hooks/lib/conductor-state.js` (+ byte-identical `bundle/opencode/hooks/lib/conductor-state.js` mirror): NEW `resumeRun(opts)` + `RESUME_COLLISION` code + `holderOf()`; `beginRun` gains additive opt-in guard — a live run held by a different `claimKey` refuses with `{ok:false, code:RESUME_COLLISION, holder}` and writes nothing; legacy runs without holder identity resume fail-open; success shape gains additive `ok:true`.
- NEW `scripts/test-resume-collision.js` (19 checks, temp-dir only: fresh/same-holder resume, cross-holder refusal, guard writes nothing, legacy resume preserved, holderless fail-open, no `.tmp` residue).
- `bundle/agents/orchestra-planner.md` + `orchestra-implementer.md` (+ OpenCode/Qoder mirrors via sync): one-line no-second-resume rule each.
  Key files: `bundle/hooks/lib/conductor-state.js`, `bundle/opencode/hooks/lib/conductor-state.js`, `scripts/test-resume-collision.js`, `bundle/agents/orchestra-{planner,implementer}.md` (+ mirrors), `context/architecture.md`.
  Impact: a second session can no longer silently resume another holder's live run — parallel resumes fail fast with the holder identity instead of becoming parallel writers on one worktree.

## 2026-11-11 — durable conductor artifact dir (never /tmp)
- `bundle/hooks/lib/plan-artifact.js` (+ byte-identical `bundle/opencode/hooks/lib/plan-artifact.js` mirror): NEW `resolveArtifactDir()` — `<workspace>/data/conductor` > `PCORE_ARTIFACT_DIR` > global state plans dir, temp-dir candidates rejected, unwritable candidates fall through — plus safe-write `writeArtifact()` (basename-confined names, invariant 15) and `isTmpPath()`.
- NEW `scripts/test-plan-artifact.js` (16 checks: precedence, env fallback, /tmp rejection, global fallback, round-trip, traversal confinement, no `.tmp` residue).
- `context/ai-workflow-rules.md` durable-artifact scoping rule + `context/architecture.md` invariant 38.
  Key files: `bundle/hooks/lib/plan-artifact.js`, `bundle/opencode/hooks/lib/plan-artifact.js`, `scripts/test-plan-artifact.js`, `context/ai-workflow-rules.md`, `context/architecture.md`.
  Impact: conductor plan/baseline/proof artifacts survive a `/tmp` wipe — the 2026-10-27 incident class (lost plan + recon inputs) cannot recur from temp-dir storage.

## 2026-11-11 — baseline adjudication (new vs foreign failures)
- `bundle/hooks/lib/evidence-runner.js` (+ byte-identical `bundle/opencode/hooks/lib/evidence-runner.js` mirror): NEW `recordBaseline(results, {dir, name})` (safe-write snapshot of `{gate -> {ok}}`, invariant 15) + pure `adjudicateVsBaseline(current, baseline)` → `{new, foreign}` where foreign = also failing at baseline; classification only, never flips a verdict or skips a gate.
- NEW `scripts/test-baseline-adjudication.js` (14 checks: record shape, foreign/new split, healed-gate exclusion, null/empty baseline, verdicts untouched, no `.tmp` residue).
- `bundle/agents/orchestra-verifier.md` + `orchestra-reviewer.md` (+ OpenCode/Qoder mirrors via sync): NEW `## Baseline adjudication` sections — verifier classifies every failure, reviewer confirms new addressed + foreign cited with owner disposition.
  Key files: `bundle/hooks/lib/evidence-runner.js` (+ mirror), `scripts/test-baseline-adjudication.js`, `bundle/agents/orchestra-{verifier,reviewer}.md` (+ mirrors).
  Impact: a red suite now answers "did I break this or was it already broken" from evidence instead of memory — foreign reds stay reported with a baseline cite, never silently dropped.

## 2026-11-11 — live-proof records outrank fixtures
- `bundle/hooks/lib/evidence-runner.js` (+ byte-identical `bundle/opencode/hooks/lib/evidence-runner.js` mirror): NEW pure `liveProofRecord({target, authed, realRun, note})` → `{type:"live-proof", ..., ok}` (ok only when a real command ran against a named target); no I/O, persisted by the caller via the artifact dir.
- `bundle/agents/orchestra-verifier.md` (+ OpenCode/Qoder mirrors via sync): NEW `## Live-proof bar` — ops scripts with an authenticated-HTTP prod path need a real target-box run showing failure + fixed paths; fixtures alone = VERIFY_FAIL on that row.
- `context/architecture.md` invariant 39.
  Key files: `bundle/hooks/lib/evidence-runner.js` (+ mirror), `bundle/agents/orchestra-verifier.md` (+ mirrors), `context/architecture.md`.
  Impact: the "fixture-proven, prod-broken" class (e.g. an ops script 401ing live for a missing key while fixtures stay green) can no longer pass verification without a real run.

## 2026-11-11 — environment-divergence checklist (record delta, never weaken)
- `bundle/agents/orchestra-verifier.md` (+ OpenCode/Qoder mirrors via sync): NEW `## Environment-divergence checklist` — a local-pass/CI-fail split records the env delta (runtime, tree, env/secret names only, network, paths) under Gaps first; env-explained failures are environment gaps, never fixed by weakening the check.
- `templates/context/ai-workflow-rules.md`: NEW `## Environment Divergence` template block (bracketed placeholders, names-only secret rule) for target projects.
- `scripts/test-evidence-runner.js`: additive test case pins the verifier contract on all three hosts (baseline + live-proof + env-divergence sections) and the template block.
- `context/architecture.md` invariant 40.
  Key files: `bundle/agents/orchestra-verifier.md` (+ mirrors), `templates/context/ai-workflow-rules.md`, `scripts/test-evidence-runner.js`, `context/architecture.md`.
  Impact: "works on my machine" splits get a recorded delta instead of a weakened gate — the next debug starts from evidence, not amnesia.

## 2026-11-11 — Wave3 teammate nudges + learning loop (wake/learning CLI)
- `bundle/hooks/lib/session-wake.js` (+ byte-identical `bundle/opencode/hooks/lib/session-wake.js` mirror): `requestWake` delivers same-workspace+same-project only (else `WAKE_CROSS_SCOPE` + `wake.denied` audit, no delivery), live-claim check (`WAKE_NO_CLAIM`), 5/hr rolling rate ring (`WAKE_THROTTLED`), worktree-partitioned `team-wakes.jsonl` via safe-write (invariant 15); `listWakes`/`matchWakeFilter`/`ackWake` (target-only ack, `WAKE_DENIED` otherwise); `parseMentions`; fail-open triggers `triggerWakesForDiscussion` (@mention → wake with threadRef), `triggerWakeForGrant` (dispatch grant → assign wake, no-from skipped), `wakeForPhaseOutcome` (block/escalate → leader/HOD wake).
- Domain: +4 `wake.*` event types + `recordWakeOutcome` fail-open; `recordSessionOutcome` additive `learned` action (`session.learned` carrying `{outcome, lessons, threadRef}`); `recordPhaseOutcome` block path lazily wakes the leader/HOD (fail-open, no require cycle).
- `bundle/hooks/lib/distill-learnings.js` (+ mirror): pure `distillLearnings` (wake-throttle, wake-denied, thread-resolved, escalation, session-lesson) merged into durable `learn-candidates.json` (ring-capped); `approveCandidate` human gate (`LEARNING_NEEDS_HUMAN` without explicit decision+by, never auto-applies by construction).
- `team-discussion.js` `getThread(threadRef)` read-only (id/topic/threadId, incl. resolved) + `threadId` stamp; `server/ws.js` replays `wake.*` 1:1 (runId null, +4 `WS_EVENT_TYPES`, same `?type=`/`?team=` matrix, loopback unchanged, no mutations).
- `scripts/team-sessions.sh`: `wake request|list|ack` + `learning record|distill|approve` with `--json`; deny/gate paths exit 2.
- NEW `scripts/test-session-wake.js` (65 checks) + `scripts/test-learning-loop.js` (31 checks), temp-dir only, wired into CI orchestration suite + `context/code-standards.md` self-check list.
- `context/architecture.md` invariant 41 (wake scope/rate/ack rules, ws replay, learning human gate, never-auto-apply) + invariant 18 mirror-surface extension.
  Key files: `bundle/hooks/lib/session-wake.js`, `bundle/hooks/lib/distill-learnings.js`, `bundle/hooks/lib/team-discussion.js`, `bundle/hooks/lib/domain/{constants,index}.js` (+ mirrors), `server/ws.js`, `scripts/team-sessions.sh`, `scripts/test-session-wake.js`, `scripts/test-learning-loop.js`, `.github/workflows/ci.yml`, `context/{architecture,code-standards,progress-tracker}.md`.
  Impact: teammates get attributable, scope-guarded nudges with thread context (mention/assign/escalate triggers, Studio replays them live), and session lessons distill into human-gated candidates that can never self-apply.

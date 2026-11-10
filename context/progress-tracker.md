# Progress Tracker

SEE ALSO: older session logs archived at docs/archive/progress-tracker-2026-11-02.md (nothing deleted).

Update this file after every meaningful implementation change.
- Context slim: progress-tracker < 100KB, architecture < 40KB
- context-index.json with phase budgets
- Phase-selective injection wired in all 4 hook files

## Next Up

- Verify token usage per phase is under budget

## 2026-11-10 — Wave2: team discussion + leader-push/member-pull + CI upgrades

- NEW `bundle/hooks/lib/team-discussion.js` (+ byte-identical OpenCode mirror): directional kinds m2m/l2m/m2l/l2l/group, topology filter 2way/star/group (`topologyOf`/`matchDiscussionFilter`), claim-key authorship; JSONL store `<state>/team-discussion.jsonl` (worktree-partitioned per inv 30/31), ring-capped at `DISCUSSION_CAP` 500 with `pruneDiscussion`; `post`/`list`/`resolve`/`react` via safe-write locks. Key files: `bundle/hooks/lib/team-discussion.js`, `scripts/test-team-discussion.js` (65 checks green).
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

# Progress Tracker

SEE ALSO: older session logs archived at docs/archive/progress-tracker-2026-11-02.md (nothing deleted).

Update this file after every meaningful implementation change.
- Context slim: progress-tracker < 100KB, architecture < 40KB
- context-index.json with phase budgets
- Phase-selective injection wired in all 4 hook files

## Next Up

- Verify token usage per phase is under budget

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

- 2026-11-19 — T1/T2 token-diet: narrowed ambient instructions to AGENTS.md + CLAUDE.md; raised tool_output.max_bytes to 65536; tuned compaction buffer to 16000 with background:false; disabled update check; added agents.compaction model tie-in.  Key files: scripts/lib/opencode-token-profile.js, bundle/config/opencode/autonomy.json, docs/opencode.json.example, scripts/merge-autonomy-config.js, scripts/test-opencode-v2.json;  reductions: 116KB/request fixed prompt (~29K tokens/day).  Self-check suites: all exit 0.

# Progress Tracker

- 2026-11-18 — Integrated the ordered five-step engineering algorithm across every route: core planner/reviewer plus 7-stage conductor, ai-trigger, review-agent, implementer and verifier, with generated host mirrors and propagation checks. Files: `bundle/agents/{orchestra,orchestra-planner,orchestra-implementer,orchestra-verifier,orchestra-reviewer,ai-trigger,review-agent}.md`, OpenCode conductor, generated agents, `scripts/test-agent-sync.js`. Impact: requirement ownership, safe deletion and simplification precede speed/automation, with actual execution evidence checked at review and safety/quality gates preserved. Also fixed Cursor/OpenCode installs (bash + PowerShell) to ship the SDLC stage agents the conductor references, and made uninstall remove them.

SEE ALSO: older session logs archived at docs/archive/progress-tracker-2026-11-02.md (nothing deleted).

Update this file after every meaningful implementation change.
- Context slim: progress-tracker < 100KB, architecture < 40KB
- context-index.json with phase budgets
- Phase-selective injection wired in all 4 hook files

## Next Up

- Verify token usage per phase is under budget

## 2026-11-17 — context diet + request budget (why free pools died and startup felt heavy)

**Measured first (no guesses).** Ground truth came from `opencode debug agents`, `opencode.db`, and the host log — not from reading config:

| Finding | Evidence |
|---|---|
| Free pools die on **request count per day**, not tokens | log: `Rate limit exceeded: free-models-per-day-high-balance` (9) + `Free usage limit reached` (371) |
| Burn rate | 52,624 assistant calls / 7d (~7.5K/day); one team session ("Peter - Manager") alone = 3,859 calls |
| Per-call prompt was enormous | avg 127K tok/call (muse) and 327K tok/call (nemotron free), dominated by cache-read re-sends; 3.5B cache-read tok on 3 sessions |
| **172 agent files, 0 `hidden:`** | AGENTS.md claimed "phase agents are `hidden: true`"; only the 5 config-defined ones were. 182 rows inlined every request |
| Index cost | 182 agent rows ~10,332 tok + 106 skill rows ~8,601 tok = **~18.9K tok/request fixed**, and 102/106 skills were permission-DENIED (paying for capability that cannot fire) |
| Step ceilings | 157 agents at `steps: 200`, 5 at `500` → one runaway subagent could consume a whole day's quota |
| Startup weight | `opencode.db` 699 MB, `storage/` 524 MB, `~/.codex` 3.5 GB, 95 stale `opencode.json.bak*`, inotify `max_user_instances=128` with 29 "failed to subscribe" failures, 30× models.dev 10s timeouts |
| Reference docs were registered as agents | 5 `agents/references/*.md` appeared as prompt-visible agents (OpenCode turns every `.md` in that tree into an agent) |

**Fixes**

- NEW `scripts/lib/context-budget.js` — single source for the index surface: `VISIBLE_SUBAGENTS`, `INDEXED_SKILLS`, `STAGE_AGENTS`, role step caps (`conductor 80 / phase+stage 40 / specialist 20`), `clampSteps` (never raises), `COMPACTION_KEEP_TOKENS = 20000`, `dedupeFlat` (flat-host name conflicts resolve shallowest-first), `buildSpecialistIndex` (spawn **ids**, because nested agents are addressed `07-red-team/red-team-operator`, not by bare name), `fullIndexReport`.
- `scripts/sync-opencode-agents.js` — the actual bug: `toOpenCodeMarkdown` emitted `mode: subagent` with **no `hidden:`**. Now emits `hidden: true`, prunes probe/stale mirrors, declares role steps from the SSOT, and gives the OpenCode copy of `orchestra-spawn-matrix.md` inert frontmatter so a doc stops being an agent. `main()` is now `require.main`-guarded (it previously mutated the tree on import).
- NEW `scripts/orchestra-context-diet.js` — `report` / `--apply` / `--dry-run` / `--check` (CI gate) / `--restore` / `--shared` / `--trim-descriptions N`. Hides agents, moves unused **orchestra-owned** skills to `~/.config/opencode/lazy/skills/` + `skill-index.json`, generates `lazy/agent-index.md`, neutralizes doc-as-agent files. Foreign skills (other hosts / user-owned) are reported and never moved.
- NEW `bundle/hooks/lib/request-budget.js` (+ byte-identical OpenCode mirror, invariant 18) — per-UTC-day call ledger per pool with an **account-wide free bucket that outranks any single pool**, quota-day latch (`isQuotaDayError` matches `free-models-per-day` / `Free usage limit reached`, never a transient 429), `workSignature` + `recordAttempt` so the 3rd identical dispatch is refused, and `formatBudgetLine` that returns **""** while healthy so the guard adds no per-turn boilerplate. Ledger at `~/.pcore/state/request-budget.json` (device-level: quota is an account property — an earlier `__dirname` default wrote runtime state into the bundle and was fixed).
- NEW `scripts/orchestra-budget.js` — `status` / `charge` / `observe` / `check --agent --task` / `sync-opencode` (counts today's real assistant calls out of `opencode.db` instead of trusting spawn bookkeeping).
- `scripts/lib/opencode-token-profile.js` — `compaction.keep.tokens`, `warming:false`, `update:disable`, config-subagent hiding + step clamping with `RESERVED_AGENTS` (title/compaction/general/explore must stay visible or title generation breaks), and `ORCHESTRA_SKILLS` now derived from `INDEXED_SKILLS` so permission and index cannot disagree. `applyTokenProfile` no longer throws on a config without a `title` agent.
- `bundle/hooks/orchestra-subagent-stop.js` + `orchestra-prompt.js` (+ mirrors) — charge per completed spawn, latch on a real rejection, and inject the quota line only when constrained.
- NEW `scripts/orchestra-startup-doctor.js` — startup **weight** (not hangs; `diagnose-opencode.sh` already covers those): state-dir sizes, inotify headroom, watched skill files, index cost, `opencode.json` backup clutter, network pins, per-day quota. `--repair` does only safe work (backups → keep 3, `VACUUM`/`ANALYZE`, trim logs/tool-output by age); worktrees and session history are reported, never deleted.
- Cross-editor: **DeepAI Code added as a first-class host** — `SUPPORTED_HOSTS` + `dispatchSpawn` + `spawnDeepAI` (emits a `delegate_task` bundle with `role`, stable-per-round `clientRequestId`, and the round-re-entry rules inline), `PLATFORMS.deepai` (`noAmbient: true`), `toolsMatrixMarkdown` gained a DeepAI column plus new History-to-child / Prompt-index-diet rows, `spawnLine` is now table-driven (it silently fell through to Cursor wording for unknown hosts), NEW `scripts/health-deepai.js`, and a DeepAI section in `docs/orchestra-cross-platform.md`.
- Learning: `distill-learnings.js` gains `classifyRisk` / `autoApply` / `decayStale`. Risk-tiered instead of never-adopted: reversible coordination lessons self-apply; anything touching secrets, permissions, destructive commands, deploy, auth, **a quality gate, or how often the agent asks the user** stays human-gated. "Drop the reviewer stage to save time" is gated — that is exactly the kind of efficiency a self-improving loop will happily discover. `team-sessions.sh learning auto-adopt|relearn`.
- Conductor prompts (`bundle/agents/orchestra.md` + OpenCode mirror) gained **Context & quota discipline**: never enumerate specialists, read the lazy index only when needed, `budget check` before re-spawning ended work, stop on `QUOTA_LATCHED`, prefer fewer larger steps, report honestly when the loop stops early.
- `install.sh` / `install.ps1` run the diet during OpenCode install (previously the install re-copied all 45 skills and undid any diet), plus new free-model caps. CI + `code-standards.md` self-checks gained `test-request-budget.js` and `orchestra-context-diet.js --check`.
- SDLC 7-stage `test` gate agent existed **only** on OpenCode: `qa-agent` (and 4 more stage agents) had no `bundle/agents/` source, so Cursor/Qoder/Claude/Codex could not spawn the Test stage at all. All five promoted to the SSOT with correct word-wrapped descriptions; `sync-claude-agents.js` / `sync-codex-agents.js` no longer crash on duplicate basenames (they threw before), they resolve shallowest-first and report the 4 known overlaps.

**Result on this host:** agent index 10,332 → **96 tok/request** (184 visible → 5: the four built-ins + the conductor); visible agents 182 → 3 rows indexed; probes + stale mirrors + 4 identity docs gone; 95 config backups → 3; DB 699 → 667 MB; worst-case per-spawn request burn 200–500 → 20–80. Skill index remains ~8.7K tok/request and is now honest about why: 96 of ~105 indexed skill rows come from `~/.agents/skills` and `~/.claude/skills`, which orchestra does not own.

**Pre-existing reds found and fixed while verifying:** `test-opencode-v2` had 4 failing assertions — three of them nested inside another test and calling a module literally named `"opencode"`, one pinning `buffer 6000` after the value moved to 16000. `test-agent-sync` pinned `steps >= 200`, i.e. defended the waste. `test-claude-sync` / `test-codex-sync` asserted file counts that cannot hold on flat trees. All updated to the new contract. Still red at HEAD and still red (unchanged, untouched by this work): `test-adaptive-loop`, `test-handshake-contract`, `test-sixfile-validation`, plus `test-claude-sync`'s Claude-block and `test-qoder-sync`'s temp-dir ENOENT.
  Key files: `scripts/lib/{context-budget,opencode-token-profile}.js`, `scripts/{sync-opencode-agents,orchestra-context-diet,orchestra-budget,orchestra-startup-doctor,health-deepai}.js`, `bundle/hooks/lib/request-budget.js` (+ mirror), `bundle/hooks/orchestra-{subagent-stop,prompt}.js` (+ mirrors), `bundle/hooks/lib/{orchestra-spawn-matrix,spawn-adapter,distill-learnings}.js` (+ mirrors), `bundle/agents/{qa-agent,tech-lead,architect,product-owner,release-manager,orchestra}.md`, `bundle/config/opencode/autonomy.json`, `install.sh`, `install.ps1`, `scripts/team-sessions.sh`, `scripts/test-request-budget.js`, `.github/workflows/ci.yml`, `docs/orchestra-cross-platform.md`, `context/{architecture,code-standards,progress-tracker}.md`.
  Impact: the daily free-model limit stops being burned by unbounded steps and repeated dispatches; every request stops paying ~10K tokens for a specialist directory it cannot use; startup weight has a measured, repairable surface; and one more editor (DeepAI Code) runs the same loop with its own delegation contract instead of a guess.


## 2026-11-16 — SDLC 7-stage hook-library foundation

- `bundle/hooks/lib/constants.js` (+ byte-identical OpenCode mirror): added `LOOP_MODE_SDLC_7STAGE = "sdlc-7stage"`, `SDLC_7STAGE_PHASES` (plan/design/build/test/review/deploy→ai-trigger/tech-lead/coding-agent/qa-agent/review-agent/release-agent/sre-agent; build readonly=false, others true), `SDLC_7STAGE_PHASE_IDS`, `SDLC_7STAGE_END_TOKENS` (PLAN_READY/DESIGN_SIGNED_OFF/BUILD_COMPLETE/TESTS_PASS/REVIEW_APPROVED/DEPLOY_COMPLETE/OPERATE_STEADY_STATE); `PHASE_END_TOKENS` now layers 7-stage tokens on top of core (core intact, backward compat).
- `bundle/hooks/lib/phase-engine.js` (+ mirror): `SDLC_7STAGE_PHASE_CHAIN`/`SDLC_7STAGE_PHASE_MAP` via `buildPhaseChain`; `getPhaseChain`/`getPhasesForState`/`getPhasesForMode`/`getPhaseIdsForState`/`getPhaseIdsForMode` resolve the 7-stage chain when `loopMode === "sdlc-7stage"`; core/enterprise intact; added `isSdlc7StagePhase` helper.
- `bundle/hooks/lib/phase-outcome.js` (+ mirror): `tokensFor` handles sdlc-7stage → `SDLC_7STAGE_END_TOKENS[phase]`; mode-aware `isFixPhase`/`isGateEnforcedPhase` (core: verify/review; 7-stage: test/review/deploy); fix/gate results carry resolved expected tokens.
- `bundle/hooks/orchestra-subagent-stop.js` (+ mirror): `handleFixRequired` generalized — 7-stage replays the same stage with its fix agent (qa-agent/test, review-agent/review, release-agent/deploy); core still replays implement with orchestra-implementer. `getAgentForPhase` (via phase-engine) maps 7-stage ids to stage agents in the spawn path.
  Key files: `bundle/hooks/lib/{constants,phase-engine,phase-outcome}.js`, `bundle/hooks/orchestra-subagent-stop.js` (+ opencode mirrors), `context/progress-tracker.md`.
  Impact: hook-library foundation for the PLAN→DESIGN→BUILD→TEST→REVIEW→DEPLOY→OPERATE pipeline is in place; core 4-loop backward compat verified green (`test-mirror-sync.js` + `test-phase-outcome.js` all pass).

## 2026-11-14 — team-sessions skill finished (CLI-verbatim examples)

- `bundle/skills/team-sessions/SKILL.md`: finished the WI-9 draft so every CLI example matches `bash scripts/team-sessions.sh --help` verbatim. Fixes: wake request uses `--reason` (not `--body`) + `--thread/--message/--topology/--json`; discuss react/resolve are `--id/--emoji/--member/--team` (no `--topic`); done report examples use real hex SHAs (`abc1234` fails `isHexSha`); watch gains `--types/--once/--no-snapshot/--scope`. New sections: dispatch (exit 0/2/1, `--free-only`, `--dry-run`), supervise (HOD FIFO sweep), queue enqueue|list|grant, request (member pull, exit 2 busy/empty), claim renew-vs-`--new-slot` + explicit-`--session` mint-fresh, heartbeat/release/list/who/check/gc one-liners, learning record/distill/approve. Merged the two duplicated WS sections into one. Install needs no edit: `install.sh` copies `bundle/skills/*/` generically.
  Key files: `bundle/skills/team-sessions/SKILL.md`, `context/progress-tracker.md`.
  Impact: agents coordinating via `team-sessions.sh` get copy-paste-correct flags instead of stale draft examples.

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

## 2026-11-14 — SQLite team session store with cross-CLI support

- NEW `bundle/hooks/lib/session-store.js`: SQLite database layer (`DatabaseSync` from `node:sqlite`) at `<PCORE_STATE_DIR>/team-sessions.db` with tables `teams`, `members`, `claims`, `discussions`, `wakes`, `done_reports` — all partitioned by `project_slug` with proper indexes; `initDb()`, `getDb()`, `isAvailable()`, `resolveStateDir()`, `getDbPath()`, `resolveProjectSlug()`; fail-open when `node:sqlite` unavailable.
- NEW `bundle/hooks/lib/team-claims.js`: SQLite-primary claim management (`claimSession`, `findLiveSlot`, `heartbeatClaim`, `releaseClaim`, `getClaims`, `gcClaims`, `findClaim`) with safe-write JSON fallback via `session-claims.js`.
- NEW `bundle/hooks/lib/team-discussions.js`: SQLite-primary discussion storage (`postMessage`, `listMessages`, `getThread`, `resolveMessage`, `reactMessage`) with safe-write JSON fallback via `team-discussion.js`.
- Rewritten `bundle/hooks/lib/session-wake.js`: SQLite-primary wake management (`requestWake`, `listWakes`, `ackWake`, `recordWakeOutcome`) with safe-write JSON fallback; same-team scope guard, 5/hr rate ring.
- Rewritten `bundle/hooks/lib/team-done.js`: SQLite-primary completion reports (`recordDone`, `latestByMember`, `listDone`) with safe-write JSON fallback; `isHexSha` guard.
- Updated `scripts/team-sessions.sh`: `--use-sqlite` flag (default true), routes claim/discuss/wake/done through SQLite when available, falls back to JSON when SQLite unavailable.
  Key files: `bundle/hooks/lib/{session-store,team-claims,team-discussions,session-wake,team-done}.js`, `scripts/team-sessions.sh`, `context/progress-tracker.md`.
  Impact: team session state (claims, discussions, wakes, done reports) is stored in SQLite partitioned per project, works across all CLIs (Cursor, OpenCode, Qoder, Claude, Codex), with automatic safe-write JSON fallback when SQLite is unavailable.

## 2026-11-24 — Team auto-activation on post/wake (OpenCode synthetic input)

- NEW `bundle/hooks/lib/team-activation.js` (+ byte-identical mirror): pure `planActivations` (group same-team / explicit `--to` or `wake.to`, sender excluded by claimKey AND sessionId, stale/sessionless/no-URL skipped) + fail-open `activateEvent` with injectable sender; `(eventKind,eventId,recipientClaimKey,projectSlug)` reserved via INSERT OR IGNORE BEFORE send (at-most-once), sent/skipped/failed audit in `activations` table or `<state>/team-activations.jsonl`, 500-row cap, kill switch `PCORE_TEAM_ACTIVATE=0`.
- NEW `bundle/hooks/lib/opencode-synthetic.js` (+ mirror): validated URL/session/text, `POST /api/session/{id}/synthetic` via `opencode api post` with injectable runner, fail-open on missing server/API error.
- `constants.js` / `session-store.js` / `team-claims.js` / `session-claims.js` (+ mirrors): `server_url` on claims with migration + `activations` table/indexes; `--server-url` / `PCORE_OPENCODE_SERVER_URL` captured at claim; fixed missing SQLite INSERT binding so captured URLs survive reload.
- `team-discussions.js` / `session-wake.js` (+ mirrors): activation triggered once after durable store on post and on both SQLite/JSON delivered wake paths; fixed workspace resolution from author/target claim so the correct project partition is read. `scripts/team-sessions.sh`: removed JSON-only module shadowing in `discuss` so CLI posts trigger activation; `--server-url` flag + help.
- NEW `scripts/test-team-activation.js` (35 checks: fan-out, sender exclusion, targeted, skips, SQLite+JSON dedupe/audit, URL capture, triggers, kill switch, injected runner; no live server) + CI/self-check lines; NEW `docs/team-auto-activation.md` + docs/skills links.
  Key files: `bundle/hooks/lib/{team-activation,opencode-synthetic,constants,session-store,team-claims,session-claims,team-discussions,session-wake}.js` (+ mirrors), `scripts/{team-sessions.sh,test-team-activation.js}`, `docs/team-auto-activation.md`, `docs/index.md`, `bundle/skills/{team-sessions,orchestra-loop}/SKILL.md`, `context/{architecture,project-overview,code-standards,progress-tracker}.md`, `.github/workflows/ci.yml`.
  Impact: teammates with an OpenCode server URL are woken automatically and exactly once per post/wake; failures never break the team channel, every decision is auditable, and `PCORE_TEAM_ACTIVATE=0` or the WS watch client remain the rollback/fallback paths.
  Ordered-step evidence (this feature): **question** — owner unknown → Peter; endpoint contract checked against opencode.ai/api docs + local OpenCode v2.3.0 before coding; **delete** — nothing removed, `watch`/autostart preserved as fallback; **simplify** — two new libs only, existing claims/activations/JSONL reuse; **accelerate** — trigger after durable write, injected sender/runner in `test-team-activation.js` (35 checks) rather than a live server; **automate last** — kill switch `PCORE_TEAM_ACTIVATE=0`, pre-send dedupe, audit and `git revert` rollback added only after the prior steps held.

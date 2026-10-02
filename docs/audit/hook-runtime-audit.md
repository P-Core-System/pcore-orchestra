# HOOKS RUNTIME + STATE/MEMORY AUDIT — `pcore-orchestra`

> **Scope**: READ-ONLY architecture audit of this repo (all reads scoped to repo root).
> **Method note**: `rg` is not installed in the audit shell; equivalent `Select-String` scans
> scoped strictly to the repo root were used for all grep evidence. All paths repo-relative;
> line numbers cited from the working tree at audit time.
> **Status**: Report complete; spot-checks re-verified (see section 11).

---

## 1. Event wiring + entry hooks

### `bundle/hooks.json` (event wiring — **Cursor only**)

- L4-8 `sessionStart` → `node ./hooks/orchestra-session-start.js`
- L9-15 `beforeSubmitPrompt` (matcher `UserPromptSubmit`, `timeout: 5`) → `orchestra-prompt.js`
- L16-37 `subagentStop` → 4 chained scripts, each gated by agent-name regex matcher:
  - L16-21 `orchestra-subagent-stop.js` (27-agent matcher, `loop_limit: 12`)
  - L22-26 `orchestra-lifecycle.js` (same matcher, 12)
  - L27-31 `orchestra-memory.js` (matcher `orchestra-planner|orchestra-implementer|orchestra-verifier|orchestra-reviewer`, 12)
  - L32-36 `orchestra-quality-gate.js` (matcher `orchestra-reviewer|code-reviewer|release-manager`, `loop_limit: 5`)
- L38-47 `stop` → `orchestra-stop.js` + `orchestra-heartbeat.js` (both `loop_limit: 5`)
- **Host**: Cursor. `install.sh` L121-143 merges this into `~/.cursor/hooks.json`; `project-bridge/hooks.json` L1-49 is the per-repo variant that delegates every command through `node .cursor/hooks/bridge.js <script>`; `project-bridge/hooks/bridge.js` L14-34 re-execs `~/.cursor/hooks/<script>` with stdin passthrough (missing script → prints `{}`).
- **OpenCode**: no hooks.json registration anywhere (grep of `bundle/config`, `scripts/merge-autonomy-config.js`, `install.ps1` finds zero opencode hook event keys). `install.sh` L235-238 / `install.ps1` L207-213 copy `bundle/opencode/hooks/*` (byte-mirror of `bundle/hooks`) to `~/.config/opencode/hooks/` but nothing fires them; `context/architecture.md:7` states IDE integration = Cursor hooks API only; OpenCode runs conductor agent + `scripts/conductor-state.sh` CLI (`bundle/agents/orchestra.md:171-190`, `bundle/opencode/agents/orchestra.md:122-290`).

### Per-script behavior

| Script | Event | What it does (key fns) | State read/write |
|---|---|---|---|
| `orchestra-session-start.js` | `sessionStart` | L24-80 `main()`: `syncWorkspaceIdentity` → static parts (`AMBIENT_CONTEXT`, `PARENT_HANDOFF_CONTEXT`, six-file ctx L34-36, project.yaml injection L38-43) → dynamic (crash recovery via `detectCrashRecovery` L49, LTM via `loadLongTermMemory`/`buildMemoryContext` L72-74, token ctx L76) → `emit({additional_context})` | R `orchestra.json` (via `loadState` L26), R `orchestra-memory.json`, R `orchestra-tokens.json`; W only via `syncWorkspaceIdentity` (state) |
| `orchestra-prompt.js` | `beforeSubmitPrompt` | `extractPrompt`/`classifyPrompt` L150; command regexes: disable L124, enable L129, resume/approve-plan L133, bare resume L142; `startOrchestra(...)` L217; greenfield briefing L254-284, enterprise/core routing L286-292, `plan_only` notice L293; emits `additional_context` | R+W `orchestra.json` (`loadRootState` L121, `saveState`); reads project.yaml/`context/` |
| `orchestra-subagent-stop.js` | `subagentStop` | Main driver. `status!=="completed"` → no-op L305-308; `!state.active` → no-op L311. Else: `iteration++` L323, `endPhaseTimer` L325, `recordPhaseTokens` L326, `emitLifecycleEvent phase_complete` L327, push `memory.phases_completed` L345; `savePlanArtifact` on planner L352-359; `handlePlanOnlyPause` L361-368; `applyEvidenceToGates` on verifier L370-377; `reviewerNeedsFix`→`handleFixRequired` L379-384; `handlePhaseComplete` L386 → advance/complete/max-iter L132-298 | R+W `orchestra.json`; W `orchestra-history.json` (`recordOrchestrationRun` L189), `orchestra-tokens.json` (`finalizeRunTokens` L188), `orchestra-memory.json` (`flushShortToLong` L187), `orchestra-project.json` (`addTechDebt` L239), `orchestra-daily.json` L177-181, `orchestra-version.json` (`bumpProjectVersion` L157), `cycles/*.json` L191, `.cursor/orchestra-plan.md` + `state/plans/*.md`, `memory-index.json` |
| `orchestra-lifecycle.js` | `subagentStop` | L25-78: `resolveCompletedPhase` L9, `emitLifecycleEvent subagent_complete` L38 / `subagent_error` L45, pushes `memory.phases_completed`/`memory.errors` L53/L64, refreshes `heartbeat.last_beat` L74 | R+W `orchestra.json` only |
| `orchestra-memory.js` | `subagentStop` (4 phase agents) | L8-29: injects `buildMemoryContext(ltm)` only when `currentPhase` in {implement,implementation} **and** `iteration===1` L16-19; else `{}` | R `orchestra.json` + `orchestra-memory.json` |
| `orchestra-quality-gate.js` | `subagentStop` (reviewers) | L15-73: non-completed → `failGate("reviewer-approval")` L40-45; final reviewers → `applyEvidenceToGates` L48, regex `FIX_REQUIRED|VERIFY_FAIL`→fail / `ORCHESTRA_COMPLETE|VERIFY_PASS|reviewer`→pass L50-54, self-asserts `memory-updated` L56, docs gate from `progress-tracker.md` regex L57-61, emits report L64-66 | R+W `orchestra.json` (qualityGates) |
| `orchestra-stop.js` | `stop` | L11-57: only `status==="completed"` L16; `writeHeartbeat` L27; stall → silent (lets heartbeat own it) L31; `loop_count>=STOP_NUDGE_LOOP_LIMIT(3)` L36; else nudge "Launch **agent**" L49-56 | R+W `orchestra.json` |
| `orchestra-heartbeat.js` | `stop` | L33-83: `writeHeartbeat` L41; `isStalled` (phase_started_at > 300s) L43 → `stall_detected` event L48, `endPhaseTimer("stalled")` L54; count of `stall_detected` for phase >= `STALL_ATTEMPTS_ABORT_THRESHOLD`(2, `constants.js:25`) → `stall_aborted`, `active=false`, abort message L60-72; else stall nudge L75-77 | R+W `orchestra.json` |
| `orchestra-enable.js` | **CLI** (not a hook; `process.argv` L16) | Commands L37-233: `status/stop/pause/resume/ambient-off/ambient-on/start/memory[/clear/recall]/checkpoint/abort/history/tokens[/clear]/metrics/cycles` | R+W `orchestra.json`, `orchestra-memory.json`, `orchestra-tokens.json`; R `orchestra-history.json`, `orchestra-metrics.json` |
| `orchestra-lib.js` | none — barrel re-exporting 20 libs (L24-45) | **Never `require()`d anywhere** (0 hits across repo) → dead facade | — |
| *(not a hook)* `orchestra-health.js` | CLI; also invoked **as the evidence "lint" command** (`evidence-runner.js:128-136`) | checks hooks/lib/state/agents; `spawnSync("bash", [SESSION_CLAIMS_SCRIPT,...])` L344/364 | R `orchestra.json`; expected-file list includes dead `self-improvement.js`, `devops.js` L63 |

---

## 2. Lib modules (`bundle/hooks/lib/`, 35 files)

### Wired (required by hook entry scripts)

- **`state-manager.js`** — session state CRUD. Exports L455-474 (`loadRootState`, `loadState`, `saveState`, `startOrchestra`, `getSessionState`/`setSessionState`, `getSessionId` L145, `migrateToSessions` L184, `isRootState`/`isSessionShaped`). `STATE_PATH` L15 = `bundle/hooks/state/orchestra.json` (installed → `~/.cursor/hooks/state/orchestra.json`); optional project path `<root>/.cursor/hooks/state/orchestra.json` (`resolveStatePath` L176-181). `startOrchestra` L346-400 sets active/phase/iteration/gates/tokens, emits `orchestra_start`. Callers: all 8 hook scripts + `orchestra-health`, `checkpoint-manager`, `lifecycle-recorder`, `heartbeat-monitor`, `plan-artifact`, `conductor-state`, `workspace-identity`, `metrics-report` (~40 require sites). **Wired.**
- **`conductor-state.js`** — isolated per-run persistence for the *OpenCode conductor*. Exports L337-364 (`beginRun` L181, `heartbeat` L223, `completeRun` L290, `failRun` L299, `listRuns`/`listLiveRuns` L244/256, `isStale` L276, `findStale`, `gcRuns` L308, `migrateLegacy` L164). Storage: `PCORE_CONDUCTOR_STATE_DIR` || `~/.config/opencode/hooks/state/conductor-runs/<ws>/<sid>/<tid>.json` + `index.json` (L27-30); `atomicWrite` L90-109 = tmp+`renameSync` + 3 retries. **Not required by any hook** — only `scripts/test-conductor-state.js:29` (require) + `scripts/conductor-state.sh` (spawns node) + conductor agent markdown. **Wired at agent/CLI layer, zero hook-runtime coupling.**
- **`quality-gate.js`** — gate registry. Exports L121-130 (`initializeGates` L22, `passGate` L32, `failGate` L47, `skipGate` L62, `checkAllGatesPassed` L76, `generateGatesReport` L100). 14 gate IDs from `constants.js:109-114`. `checkAllGatesPassed` pulls required set from `evidence-runner.requiredGatesForMode` L81-82. Callers: `orchestra-quality-gate.js`, `orchestra-subagent-stop.js`, barrel. State: `session.qualityGates{passed,failed,skipped,allRequiredPassed}`. **Wired.**
- **`evidence-runner.js`** — runs real commands. Exports L249-259 (`runCmd` L27, `runEvidenceChecks` L187, `applyEvidenceToGates` L213, `requiredGatesForMode` L209, `evidenceBuild/Tests/Lint/Security`). `CORE_REQUIRED_GATES` L8-15 = build, tests, lint, reviewer-approval, docs-updated, memory-updated. Callers: subagent-stop L24 (preflight before verify L260; post-verifier L372), quality-gate hook L13, `quality-gate.js:81`. **Wired.**
- **`phase-commit-gate.js`** — git dirty check at phase boundary. Exports L108-114 (`checkPhaseCommitGate` L48, `buildCommitGateHandoff` L88, `porcelainLines` L32). `ALLOWED_DIRTY` L7-10 = only plan files; git failure → `clean:true, skipped:true` L51-59. Callers: subagent-stop L28 (L270-276), handoff-enforcer L7, `test-adaptive-loop.js:348`. **Wired.**
- **`prompt-classifier.js`** — activation classifier. Exports L230-247 (`extractPrompt` L41, `classifyPrompt` L154, `selectRoute` L78, `buildIntake` L136 + regexes). Activation rules L169-192; route: enterprise L79, greenfield L91, complexity→enterprise L103, informal→core L115, default core L126. Callers: `orchestra-prompt.js:6`, `orchestra-health.js:8`, tests. State: reads `session.ambient` L168. **Wired.**
- **`orchestra-spawn-matrix.js`** — Cursor vs OpenCode spawn syntax. Exports L96-103 (`PLATFORMS` L14-46, `spawnLine` L48, `handoffBlock` L55, `ambientContextBlock` L69, `toolsMatrixMarkdown` L83 — last unused). Callers: `context-detector.js:11`, `handoff-enforcer.js:8`, `scripts/lib` shim. **Wired** (`toolsMatrixMarkdown` dead).
- **`memory-manager.js`** — LTM store. Exports L314-326 (`loadLongTermMemory` L62, `saveLongTermMemory` L151, `flushShortToLong` L180, `buildMemoryContext` L242, `getAggregatedMemory` L86, `getSessionMemory` L308 — unused). `MEMORY_PATH` L21 = `state/orchestra-memory.json`. Caps on write L171-173 (100/50/50). Callers: session-start, prompt, subagent-stop, memory hook, enable, metrics-report. **Wired.**
- **`semantic-memory.js`** — keyword retrieval, **no embeddings**. Exports L103-109 (`tokenize` L11, `retrieveRelevantGoals` L51, `retrieveRelevantErrors` L69, `formatRelevantGoals` L90). `scoreEntry` L31-49: token-overlap x10 + recency boost + completed boost; comment L28-29: *"BM25-lite ... (no embeddings required). Upgrade path: optional hybrid with local embeddings"*. Callers: memory-manager L18, enable `memory recall` L144, test L288. **Wired.**
- **`memory-index.js`** — inverted index. Exports L77-82 (`INDEX_PATH` = `state/memory-index.json`, `indexCompletedGoal` L34, `searchMemoryIndex` L57). `INDEX_MAX_ENTRIES` 500 (L8, ring L21-30). Caller: `memory-manager.js:19` only, and only `indexCompletedGoal` (flush L207). **`searchMemoryIndex` has zero callers → dead export.** **Wired (write path only).**
- **`checkpoint-manager.js`** — pause/resume/crash. Exports L102-110 (`saveCheckpoint` L23, `pauseOrchestra` L30, `resumeOrchestra` L39, `detectCrashRecovery` L64 [beat >600s or stale start >600s], `abortOrchestra` L89 → records history `"aborted"`). Callers: session-start L13, prompt L23, subagent-stop L25, enable L6. State: `session.resumable{paused,paused_at,pause_reason,checkpoint,last_save}`. **Wired.**
- **`lifecycle-recorder.js`** — event log + phase timers. Exports L46-51 (`emitLifecycleEvent` L6, `startPhaseTimer` L15, `endPhaseTimer` L29, `getPhaseElapsedMs` L41). Cap: `events` sliced to last 200 L10-12 (`LIFECYCLE_MAX_EVENTS`, `constants.js:4`); **`phase_history` has no cap** (reset per `startOrchestra` L380). Callers: subagent-stop, lifecycle hook, heartbeat, `state-manager.startOrchestra` L347/392. **Wired.**
- **`history-recorder.js`** — run history. Exports L57-61 (`recordOrchestrationRun` L9, `loadOrchestrationHistory` L48). `HISTORY_PATH` = `state/orchestra-history.json`; cap 50 (`HISTORY_MAX_RUNS`, L40-42). Callers: subagent-stop L17 (completed/max_iterations), checkpoint-manager L91 (aborted), enable, metrics-report. **Wired.**
- **`heartbeat-monitor.js`** — stall detection. Exports L22-26 (`writeHeartbeat` L5, `isStalled` L10 [elapsed since `phase_started_at` > `stall_threshold_ms`||300000], `getStallDurationMs` L17). Callers: `orchestra-stop.js:8`, `orchestra-heartbeat.js:7`. **Wired.**
- **`handoff-enforcer.js`** — compact handoff builder. Exports L68-74 (`buildPhaseHandoff` L18, `MAX_HANDOFF_CHARS` 2500 L4, `validateHandoffCompact` L49, `handoffWarningBlock` L62). Composes plan line + commit-gate handoff L40-44. Callers: prompt L19, subagent-stop L23, test L167. **Wired.**
- **`daily-planner.js`** — daily journal. Exports L352-374 (`loadDailyState` L48, `saveDailyState` L91, `getOrCreateTodayEntry` L126, `generateDailySummary` L210, `atomicWrite` L70...). `DAILY_PATH` = `state/orchestra-daily.json`; cap 365 entries L112. Callers: subagent-stop L21 (completion L177-181), `self-improvement` (dead chain). Several exports unused by hooks (`addDailyGoal`, `startSprint`, `generateWeeklySummary`, `generateDailyEngineeringJournal` — 0 external callers). **Wired (thin slice).**
- **`project-manager.js`** — epics/milestones/stories/tasks/backlog/techDebt/ADRs. Exports L480-507. `PROJECT_PATH` = `state/orchestra-project.json`; `ringCap` L76 with caps L144-152 (50/100/500/2000/500/200/200/100). Callers: subagent-stop L20 (`addTechDebt` L239, `generateProjectSummary` L197), daily-planner L6, self-improvement (dead), health. Unused exports: `trackVelocity`, `generateBurndown`, most `add*` (0 callers). **Wired (thin slice).**
- **`token-tracker.js`** — token estimation/budgets. Exports L635-657. `TOKENS_PATH` = `state/orchestra-tokens.json`; budgets 10k/30k/15k/8k + cycle 63000 L14-21 (overridable via `orchestraConfig.token_budgets`, `orchestra-config.js:6-12`). `estimateTokens` = `ceil(chars/4)` L67; `recordPhaseTokens` L302 (prefers reported API usage L85-131); `finalizeRunTokens` L439 writes run + tips; caps runs 100 / tips 200 (L254-256). Callers: session-start L14, subagent-stop L22, `state-manager` L390, metrics-report, enable. **Wired.**
- **`observability.js`** — metrics/SLO/incidents. Exports L151-163; `METRICS_PATH` = `state/orchestra-metrics.json`; caps 1000/20/200 L28-30. Callers: metrics-report L7 (`generateHealthReport`, `loadMetricsState`), self-improvement (dead), barrel. **`recordMetric`/`defineSlo`/`recordIncident`/`resolveIncident` have 0 external callers → write path never invoked in hooks (metrics file stays default-empty).** **Wired (read path only).**
- **`security-scanner.js`** — regex secret/vuln/weak-crypto scanner. Exports L207-217 (`scanDirectory` L108, `generateSecurityReport` L149, `checkOwaspTop10` L185 — **0 callers → dead export**). Callers: `evidence-runner.evidenceSecurity` L150 (enterprise mode only) + health expected-files list. **Conditionally wired (core loop never scans).**
- **`constants.js`** — all caps + `CORE_PHASES` L61-66, `SDLC_PHASES` L71-104 (31 phases), `QUALITY_GATES` L109-114, `LOOP_MODE_*` L29-30, `STALL_ATTEMPTS_ABORT_THRESHOLD=2` L25, `STOP_NUDGE_LOOP_LIMIT=3` L26, `CRASH_RECOVERY_THRESHOLD_MS=600000` L20. **Wired everywhere (46 require sites).**
- **`orchestra-config.js`** — project.yaml `orchestra:` profile. Exports L94-103 (`normalizeOrchestraConfig` L29, `extractOrchestraFromIdentity` L54, `loadOrchestraConfigFromRoot` L61, `mergeRoute` L66 [enterprise wins], `buildOrchestraConfigSummary` L72). Callers: prompt L18, enable L115, context-detector L91, workspace-identity L5. **Wired.**
- **`plan-artifact.js`** — plan persistence. Exports L115-125 (`savePlanArtifact` L46 → writes `<ws>/.cursor/orchestra-plan.md` L69 **and** `state/plans/<runId>.md` L73; `hasPlanReady` L38 = `/\bPLAN_READY\b/i`; `buildPlanHandoffLine` L96). Sets `state.planArtifact.plan_ready` L80 — **flag is written but never read for gating**. Callers: subagent-stop L26 (L357), handoff-enforcer L6. **Wired.**
- **`context-detector.js`** — six-file + project.yaml detection/injection. Exports L150-162 (`AMBIENT_CONTEXT` L13, `PARENT_HANDOFF_CONTEXT` L19, `SIX_FILE_CONTEXT` L25-32, `detectSixFileContext` L49, `buildContextInjection` L125, `detectProjectYamlInWorkspaces` L81, `buildProjectYamlInjection` L89). Injection is a **pointer list** (which files exist + read order), not file contents L125-148. Callers: session-start, prompt, stop L7, workspace-identity. `detectFullWorkspaceContext` L110 unused. **Wired.**

### Related wired modules (outside the requested 35 but relevant)

`project-identity.js` (24KB YAML/JSON identity loader; 17 require sites), `version-manager.js` (`orchestra-version.json`, atomicWrite L92-99; wired via subagent-stop), `workspace-identity.js` (syncs project.yaml → session.project; wired via session-start/prompt/enable), `greenfield-intake.js` (`isGreenfieldPrompt` L179, briefing L194; wired via prompt-classifier/prompt), `greenfield-scaffold.js` (`shouldAutoScaffold` L49; wired via prompt L277), `metrics-report.js` (CLI `metrics` dashboard), `cycle-report.js` (`state/cycles/<runId>.json` + index, **index unbounded** L67-83; wired via subagent-stop/enable).

### DEAD lib modules (never executed by any caller)

| Module | Evidence |
|---|---|
| **`devops.js`** | Required only by `bundle/hooks/orchestra-lib.js:20` + `bundle/opencode/hooks/orchestra-lib.js:20`; `orchestra-lib.js` itself has **0 require sites**. All 7 exports (`generateGitHubActions`…`generateCloudflareWorkersConfig`) → 0 call sites repo-wide. Listed in `orchestra-health.js:63` expected-files (existence check only). **Dead.** |
| **`self-improvement.js`** | Same: required only by `orchestra-lib.js:19` (+ mirror). All 5 grep'd exports (`generateRetrospective`, `addLesson`, `addActionItem`, `scoreRetrospective`, `generateImprovementSuggestions`) → 0 callers. **Dead.** |
| **`orchestra-lib.js`** (entry) | `require("orchestra-lib")` → 0 hits across `bundle/`, `scripts/`, `project-bridge/`. Barrel of the two dead modules + 18 live ones. **Dead entry point.** |

**Dead exports inside otherwise-wired modules**: `memory-index.searchMemoryIndex`, `security-scanner.checkOwaspTop10`, `orchestra-spawn-matrix.toolsMatrixMarkdown`, `state-manager.resetProjectState`, `context-detector.detectFullWorkspaceContext`, `memory-manager.getSessionMemory`, most of `daily-planner`/`project-manager`/`observability` write APIs, and `phase-engine.advancePhase` (runtime uses direct assignment instead; only `scripts/test-adaptive-loop.js:142` calls it).

---

## 3. State machine (reconstructed)

### Phase definitions (`constants.js`)

- `CORE_PHASES` L61-66: `plan`→`implement`→`verify`→`review` (agents planner/implementer/verifier/reviewer; readonly: plan true, implement **false**, verify true, review true).
- `SDLC_PHASES` L71-104: 31 phases idea→…→continuous-improvement across categories discovery/design/planning/execution/quality/release/operations; only `implementation` (L89) is `readonly:false`.

### Chain construction (`phase-engine.js`)

- `buildPhaseChain` L12-31 → each phase `{agent, category, readonly, index, nextPhase (last→"done"), prevPhase}`; `CORE_PHASE_CHAIN` L39, `ENTERPRISE_PHASE_CHAIN` L40; `getPhaseChain(state)` L95-106 selects by `state.loopMode`; `getAgentForPhase` L112 (fallback `"orchestra-planner"` L113); `getNextPhase` L116; `getImplementPhaseId` L172 (`implement` vs `implementation`); `reviewerNeedsFix` L194-203 = `/FIX_REQUIRED|VERIFY_FAIL/i` on `[summary,result,output,final_text].join("\n")`.

### Run/session states (`state-manager.js` `DEFAULT_SESSION_STATE` L17-95)

- Flags: `active` (bool), `ambient` (bool), `planAwaitingConfirm` (**write-only**: set `orchestra-subagent-stop.js:105`, reset `state-manager.js:375`, never read), `loopMode` in {`core`,`enterprise`}, `iteration` 0…`max_iterations` (8 core / 16 enterprise / config; `startOrchestra` L378-379), `currentPhase` in {`idle`,`paused`} ∪ phase ids (dual-written to legacy `phase` L140).
- `resumable{paused, pause_reason in {manual, crash_recovery, plan_only, aborted}, checkpoint{phase,goal,iteration,last_subagent,started_at,loopMode,lifecycle_snapshot,memory_snapshot,timestamp}}` (`checkpoint-manager.js:9-21`).

### Transitions & triggers

| From → To | Trigger | Site |
|---|---|---|
| idle → active@start-phase | `classifyPrompt` activate → `startOrchestra(goal,state,source,opts)` (manual via enable `start` L122) | `state-manager.js:346-400` (core start=`plan` L353; enterprise start=`phases[0].id`) |
| active phase N → N+1 | host `subagentStop` `status==="completed"` → `handlePhaseComplete` (`state.currentPhase = chain.nextPhase` L135; `emitLifecycleEvent phase_advance` L137) | `orchestra-subagent-stop.js:132-298` |
| any → `idle` + completed | `chain.nextPhase==="done"` → gates/memory/tokens/history/cycle flush, `active=false`, `currentPhase="idle"` L193-194 | same L143-212 |
| any → `idle` + max-iter | `iteration >= max_iterations` (post-advance L215, or in fix path L78) → flush + `active=false` L225-226 / L82-83 | same L215-233, L78-90 |
| review → implement (loop) | `reviewerNeedsFix(input)` true → `handleFixRequired` sets `currentPhase=getImplementPhaseId` L66, pushes `FIX_REQUIRED` decision L71-76, `iteration` counts toward cap | same L63-100, L379-384 |
| plan → `paused` | `orchestraConfig.plan_only` && planner && phase plan → `handlePlanOnlyPause`: `saveCheckpoint`, `resumable.paused=true`, `pause_reason="plan_only"`, `active=false`, `currentPhase="paused"` L104-120 | same L102-130, L361-368 |
| paused → active | prompt matches `resume orchestra|continue orchestra|approve plan` (or bare `resume/continue` when not active) → `handleResume`/`handleBareResume` → `resumeOrchestra` L39-56 restores phase/goal/iteration | `orchestra-prompt.js:133-148`, `checkpoint-manager.js:39` |
| active → idle (disable) | prompt `disable orchestra|orchestra off` → `handleDisable` L27-38; CLI `ambient-off`/`stop` (`enable.js:45-55,91-99`) | prompt/enable |
| active → idle (stall abort) | ≥2 `stall_detected` events for same phase (`STALL_ATTEMPTS_ABORT_THRESHOLD=2`) → `stall_aborted`, `active=false` | `orchestra-heartbeat.js:43-72` |
| crash detection | session start or resume: `detectCrashRecovery` (last_beat or started_at older than 600s) → resume advisory / checkpointed pause | `checkpoint-manager.js:64-87`, `orchestra-session-start.js:49`, `orchestra-prompt.js:53` |
| active → aborted | CLI `abort` → `abortOrchestra` records history `"aborted"`, `paused=true`, `pause_reason="aborted"` | `orchestra-enable.js:171`, `checkpoint-manager.js:89-100` |

### Conductor run statuses (separate machine, `conductor-state.js`)

`beginRun` sets `status:"active"` L205 (idempotent resume L192-197); `completeRun` → `"completed"` L291; `failRun` → `"failed"` L300; `gcRuns` marks `"stalled"` or deletes L323; `isLiveStatus` treats `undefined|null|active|in_progress` live L235-237. Statuses documented in `bundle/agents/orchestra.md:171-176` (`begin/save/who/resume/complete/fail`).

---

## 4. State storage (paths, schema, atomicity, caps)

All paths `path.join(__dirname,"..","state", …)` → installed `~/.cursor/hooks/state/` (Cursor) or `~/.config/opencode/hooks/state/` (opencode mirror).

| File | Schema/keys | Atomic? | Retention |
|---|---|---|---|
| `orchestra.json` (`state-manager.js:15`) | `{version:3, sessions:{<sid>: {version,ambient,active,goal,loopMode,currentPhase,currentPhaseIndex,phaseCategory,phase,started_at,last_subagent,iteration,max_iterations,last_prompt,auto_started,intake,project{…},versioning{…},qualityGates{passed,failed,skipped,allRequiredPassed},lifecycle{events,phase_history},heartbeat{last_beat,phase_started_at,stall_threshold_ms,interval_ms},memory{phases_completed,files_changed,errors,decisions,context_summary},resumable{…},orchestraConfig,planArtifact,tokens,planAwaitingConfirm}}}` (defaults L17-95) | **NO** — direct `fs.writeFileSync` L313; no rename, **no locks anywhere** (grep for flock/lockfile/`.lock` = 0 hits) | `lifecycle.events` → last **200** (L10-12); `phase_history` **uncapped** within run (reset per start L380); **`sessions` map never pruned → unbounded**; `pid-<pid>` session-id fallback (`getSessionId` L151) creates a new key per process |
| `orchestra-memory.json` (`memory-manager.js:21`) | default on disk is legacy flat `{version,completed_goals,project_patterns,recent_files,error_patterns,user_preferences}`; runtime shape `{version:1,sessions:{sid:same}}` via `migrateToSessions` L48 | NO — `writeFileSync` L177 | completed_goals **100** / recent_files **50** / error_patterns **50** (L171-173) |
| `memory-index.json` (`memory-index.js:7`) | `{version,entries[],inverted{token:[id]}}` | NO L31 | **500** entries (L8, L21-30) |
| `orchestra-history.json` (`history-recorder.js:7`) | flat array `{goal,outcome,started_at,completed_at,duration_ms,iterations,phases_completed,files_changed,errors,tokens_*}` | NO L45 | **50** runs (L40-42) |
| `orchestra-tokens.json` (`token-tracker.js:11`) | `{version:1,sessions:{sid:{runs[],aggregates{total_*,by_agent,by_phase},tips[],last_summary}}}` | NO L259 | runs **100**, tips **200** (L254-256) |
| `orchestra-daily.json` (`daily-planner.js:8`) | sessions→`{entries[],currentSprint,sprintStart,sprintEnd}` | **YES** — tmp+`renameSync` L70-89 (backoff bug: L83 un-awaited `setTimeout` in sync fn → no real delay) | entries **365** (L112) |
| `orchestra-project.json` (`project-manager.js:17`) | sessions→`{vision,goals,epics,milestones,stories,tasks,backlog,techDebt,adrs,retrospectives,velocity,identity}` | NO L160 | ring caps 50/100/500/2000/500/200/200/100 (L144-152) |
| `orchestra-version.json` (`version-manager.js:8`) | version/changelog/releases | **YES** — tmp+rename L98-99 | changelog 500, releases 100 (`constants.js:41-42`) |
| `orchestra-metrics.json` (`observability.js:7`) | `{version,metrics[],slos[],incidents[]}` | NO L31 | 1000/20/200 (L28-30) |
| `cycles/<runId>.json` + `cycles/index.json` (`cycle-report.js:7,24,67`) | per-run audit report | NO | **index unbounded** |
| `plans/<runId>.md` + `<ws>/.cursor/orchestra-plan.md` (`plan-artifact.js:9,69,73`) | markdown plan | NO | unbounded |
| `conductor-runs/<ws>/<sid>/<tid>.json` + `index.json` (`conductor-state.js:27-30,113`) | run record + registry | **YES** — tmp+`renameSync`, 3 retries L90-109 | `gcRuns` prunes stale-active L308-335 |
| Missing on disk | `bundle/hooks/state/orchestra.json` **does not exist** (repo has only `orchestra-memory.json`), yet `install.sh:82-83` copies it (non-fatal — `loadRootState` synthesizes L227-231) | — | — |

**Locking: none.** Concurrent read-modify-write of the same `orchestra.json` by the 4 `subagentStop` scripts + 2 `stop` scripts (each `loadState → mutate → saveState`) is unsynchronized; `saveState` rewrites the **entire sessions root** (L292-313) → classic lost-update window if the host runs hook commands in parallel.

---

## 5. Memory layer

- **Short-term**: `state.memory` inside `orchestra.json` = `{phases_completed[], files_changed[], errors[], decisions[], context_summary}` (`state-manager.js:81-87`), plus run-scoped `state.tokens`, `state.lifecycle`, `state.evidence_preflight`/`evidence_gates` (written `orchestra-subagent-stop.js:263,374`). Reset each `startOrchestra` L383-385.
- **Long-term**: `orchestra-memory.json` per-session buckets `{completed_goals, project_patterns, recent_files, error_patterns, user_preferences}` (`memory-manager.js:23-29`). Flushed only at run end: `flushShortToLong(state, outcome)` called from subagent-stop completion L187 and max-iterations L219 (`flushShortToLong` L180-240 pushes goal record + files + error patterns, and `indexCompletedGoal` L207 → `memory-index.json`). Errors during phases are also auto-converted to tech-debt items L236-249.
- **Retrieval/injection**: `buildMemoryContext` L242-306 renders "Relevant past goals / Recent completed goals / Frequently modified files / Recurring error patterns". Injected at: session start (`orchestra-session-start.js:72-74`), prompt start (`orchestra-prompt.js:223-224,302`), implement-iteration-1 (`orchestra-memory.js:16-26`), CLI `memory recall`.
- **`semantic-memory.js`**: **not real embeddings** — tokenized stopword-filtered overlap scoring with recency/outcome boosts (`scoreEntry` L31-49); explicitly labeled "BM25-lite … no embeddings required" L28-29. No network/model calls anywhere in the hooks.
- **Six-file context**: `context-detector.js` *detects* `context/{project-overview,architecture,code-standards,ui-context,ai-workflow-rules,progress-tracker}.md` + `AGENTS.md`/`CLAUDE.md` (L25-71) and injects an ordered **reading list with check/cross existence marks** (`buildContextInjection` L125-148) — **contents are not read/inlined by hooks**; agents are instructed to read them. `project.yaml` → identity summary injection (`buildProjectYamlInjection` L89-100) incl. orchestra profile (route/max_iterations/plan_only/token budgets).

---

## 6. Completion verification — claimed vs system-verified

### What actually gates phase advance (system-verified)

1. Host `status === "completed"` (`orchestra-subagent-stop.js:305`) — required, but it is the IDE's claim that the subagent finished.
2. `reviewerNeedsFix` regex `/\bFIX_REQUIRED\b|\bVERIFY_FAIL\b/i` on reviewer output (`phase-engine.js:194-203`) → blocks advance, loops back to implement (L379-384 → L63).
3. `checkPhaseCommitGate` — **advisory only**: its message is appended to the handoff (L270-276), and `gate.clean===false` merely appends "commit or discard BEFORE launching" text (L272-274). **No block.**
4. `iteration >= max_iterations` → force stop (L78, L215).

### What is NOT verified (the gap)

- **End tokens are mostly decorative.** `PLAN_READY` appears only in prose (`orchestra-prompt.js:244,305`; heartbeat hint `orchestra-heartbeat.js:18`) and as a recorded flag `state.planArtifact.plan_ready` (`plan-artifact.js:38-40,80`) that nothing gates on. `IMPLEMENT_DONE`/`ORCHESTRA_COMPLETE` appear only in spawn-matrix doc text (`orchestra-spawn-matrix.js:25`) and handoff text (`phase-commit-gate.js:101`). `VERIFY_PASS`/`FIX_REQUIRED`/`ORCHESTRA_COMPLETE` are only **regex-scored into gate records** by `orchestra-quality-gate.js:50-54` — which does not influence `handlePhaseComplete`. **Planner can "complete" without ever emitting PLAN_READY; implementer without IMPLEMENT_DONE; verifier without VERIFY_PASS — chain advances on `status==="completed"` alone.**
- **Evidence failures do not block.** `applyEvidenceToGates` (verifier stop, L370-377) records pass/fail/skip into `state.qualityGates`, but `handlePhaseComplete` never consults `qualityGates.failed` — a red `npm test` still advances to review. At completion, failures are only *reported* (`allRequiredPassed` message L207; cycle report `quality_gates` `cycle-report.js:58-64`).
- **Self-asserted gates**: `passGate("memory-updated",…)` (`orchestra-subagent-stop.js:175`), `passGate("memory-updated",…)` (`orchestra-quality-gate.js:56`), `docs-updated` = regex hit for `progress-tracker.md` in summary or files_changed (`orchestra-quality-gate.js:57-61`), `reviewer-approval` pass = reviewer finished without FIX_REQUIRED (L52-53) or any `subagentType.includes("reviewer")` (L52).
- **No diff/test evidence is captured or compared against the plan**; the plan artifact is a file path handed off (`buildPlanHandoffLine` L96-113) — compliance is delegated entirely to LLM prompt discipline.
- The `quality-gate` hook runs evidence only for final reviewers (non-final agents emit `{}`, L70-72).

---

## 7. Shell execution inventory

All execution is `spawnSync` with **fixed argv arrays and no `shell:true`** (no string interpolation into a shell → no injection surface from prompt text):

| Where | Command(s) | Timeout | Purpose |
|---|---|---|---|
| `evidence-runner.js:28` `runCmd` | `npm run build --silent` (L56), `npm test --silent` (L111), `node --check <file>` ×≤40 hook files (L81), `node scripts/test-adaptive-loop.js` (L99), `node bundle/hooks/orchestra-health.js` (L130), `git status --porcelain` (L173) | **60 000 ms**, maxBuffer 2MB (L31-32) | build/tests/lint/security(non-shell)/git-status gates; run inside `subagentStop`/quality-gate hooks → **blocks the hook** up to 60s per command |
| `phase-commit-gate.js:13` | `git status --porcelain` | 15 000 ms (L16) | dirty-tree report at every phase boundary |
| `orchestra-health.js:344,364` | `bash <SESSION_CLAIMS_SCRIPT> check\|list` | default | health CLI only |
| `project-bridge/hooks/bridge.js:28` | `node <global hook script>` | none | delegation |

Safety notes: (a) `npm run build/test` executes whatever scripts the **target workspace's** `package.json` defines — equivalent to running CI locally, from within a Cursor hook process; (b) `security-scanner` is in-process regex (no subprocess) and only in enterprise mode; (c) hooks themselves never run `git commit`/`git push` — commit gate is advisory text only.

---

## 8. Reconstructed event flow (prompt submitted → run complete)

1. **`sessionStart`** → `orchestra-session-start.js` → `additional_context` = ambient/handoff blocks + six-file + project.yaml + (if `state.active`: crash-recovery or "ACTIVE — phase X" + completed phases) + LTM + token context.
2. **`beforeSubmitPrompt(UserPromptSubmit)`** → `orchestra-prompt.js` → `extractPrompt` → control-regex checks (disable/enable/resume) → `classifyPrompt` → if not active: emit ambient-only; if active same goal: re-emit handoff (`buildPhaseHandoff`); else `startOrchestra` → writes session `{active:true, currentPhase:"plan"|enterprise-first, iteration:0, lifecycle reset, qualityGates reset, tokens init}` + `orchestra_start` event → emits "auto-started… launch **orchestra-planner**" + handoff + commit-gate + memory + context instructions.
3. Parent agent spawns `Task(subagent_type="orchestra-planner")` (spawn syntax from `spawnLine`, `handoff-enforcer.js:23`).
4. **`subagentStop` ×4** (when subagent finishes):
   - `orchestra-subagent-stop.js`: `status!=="completed"`→exit; else iteration++, timers, token record, `phase_complete` event, `phases_completed.push`, `savePlanArtifact` (planner), plan-only pause branch, verifier→`applyEvidenceToGates` (runs build/test/lint/git), reviewer→`reviewerNeedsFix`→`handleFixRequired` (back to implement), else `handlePhaseComplete` → `state.currentPhase = next`, `phase_advance` event, if next==`verify` run evidence **preflight** + `checkPhaseCommitGate`, restart phase timer, emit `followup_message` = "Launch **<next agent>**" + handoff + gate/evidence blocks; when next==`done` → version bump+changelog, gates `passGate` batch, `flushShortToLong`, `finalizeRunTokens`, `recordOrchestrationRun("completed")`, `writeCycleReport`, `active=false`, completion summary message.
   - `orchestra-lifecycle.js`: `subagent_complete`/`subagent_error` event + memory push + `heartbeat.last_beat`.
   - `orchestra-memory.js`: LTM context inject if implement & iteration 1.
   - `orchestra-quality-gate.js`: (reviewers only) evidence→gates + marker regex scoring + report emitted as `additional_context`.
5. Parent reads `followup_message` → spawns next agent → repeat (steps 3-4) through `plan→implement→verify→review→done`.
6. **`stop`** (each main-agent turn end): `orchestra-stop.js` writes heartbeat + emits "Launch **<agent>**" nudge (unless stalled / loop_count≥3 / phase idle-done-paused); `orchestra-heartbeat.js` writes heartbeat, and if `phase_started_at` >300s emits `stall_detected` + relaunch nudge, aborting after 2 stalls for that phase.
7. **Completion paths**: `done` (full flush + summary) · `max_iterations` (flush + "stop chaining") · `FIX_REQUIRED` loop · `plan_only` pause awaiting "approve plan" · CLI stop/abort/pause.
8. **OpenCode path (no hooks)**: user talks to `orchestra` conductor (`default_agent`), which task-spawns phases and persists run state via `bash scripts/conductor-state.sh begin/save/who/resume/complete/fail/gc` → `conductor-state.js` atomic per-run JSONs + `index.json`.

---

## 9. Explicit gaps (observed, non-speculative)

1. **No database** — all persistence is JSON files under `~/.cursor/hooks/state/` (and `conductor-runs/` for OpenCode); no transactionality across files (a completion touches 8+ files with independent writes; a crash mid-flush leaves partial state).
2. **Race/lost-update risk**: main `orchestra.json` writes are plain `writeFileSync` (`state-manager.js:313`), no lock, full-root rewrite; up to 6 hook processes per turn (`subagentStop`×4 + `stop`×2, each load→mutate→save) can clobber each other. Atomic tmp+rename exists only in `conductor-state`, `daily-planner`, `version-manager`.
3. **`sessions` map unbounded** (no GC in `saveState`); `pid-<pid>` fallback session ids accumulate; `orchestra-history`/tokens/metrics have caps but sessions/projects/cycles index do not.
4. **Completion markers not enforced**: phase advance needs only host `status==="completed"`; `PLAN_READY`/`IMPLEMENT_DONE`/`VERIFY_PASS`/`ORCHESTRA_COMPLETE` are prose/regex-for-gates only; `planArtifact.plan_ready` never gates.
5. **Verification is advisory**: failing evidence gates and a dirty git tree do not stop phase advance (`handlePhaseComplete` never reads `qualityGates.failed`; commit gate message only).
6. **Gates partly self-asserted** (`memory-updated`, `docs-updated` via regex, `reviewer-approval` via absence of a token).
7. **`daily-planner.atomicWrite` backoff bug** (L83 un-awaited promise in sync fn) → retries immediate, backoff ineffective.
8. **`conductor-state` decoupled from hooks** — two parallel state machines (`orchestra.json` vs `conductor-runs/`), only the latter is atomic; Cursor path never writes conductor runs.
9. **Dead code**: `devops.js`, `self-improvement.js`, `orchestra-lib.js` (0 callers), plus ~15 dead exports (`searchMemoryIndex`, `checkOwaspTop10`, `advancePhase` runtime-unused, `resetProjectState`, `detectFullWorkspaceContext`, `recordMetric/defineSlo/recordIncident`, most `add*` PM/daily APIs, `toolsMatrixMarkdown`).
10. **OpenCode hooks copy is inert**: `bundle/opencode/hooks/*` installed but no event registration; health/CLI only.
11. **Evidence runner runs workspace build/test inside a hook** with a 60s cap per command — slow/failing builds stall `subagentStop` handling; `git status` failure silently downgrades commit gate to PASS (`phase-commit-gate.js:51-59`) and git-status evidence to `ok:true` (`evidence-runner.js:174-180`).
12. **`bundle/hooks/state/orchestra.json` missing** while `install.sh:82-83` copies it (non-fatal; state synthesizes on read).

---

## 10. Cross-cutting summary

- **Two parallel state machines**: Cursor hook state (`orchestra.json`, non-atomic, no locks) vs OpenCode conductor state (`conductor-runs/`, atomic). They never exchange data.
- **The gate that matters is a single regex**: `FIX_REQUIRED|VERIFY_FAIL` on reviewer output. Everything else — evidence gates, commit gate, end tokens — is advisory or decorative.
- **Read model**: hooks never inline file contents (six-file context = pointer list; plan = path handed to next agent). All "verification" that the work matches the plan is delegated to the LLM agents.
- **Write model**: one flat JSON root rewritten wholesale per hook invocation, with per-file retention caps that do not apply to the root `sessions` map itself.

---

## 11. Verification (spot-check re-run at report write time)

| Claim | Result |
|---|---|
| `orchestra-lib.js` never required (0 sites) | verified — 0 hits across `bundle/hooks`, `scripts`, `project-bridge` |
| `devops`/`self-improvement` required only by the dead barrel | verified — `orchestra-lib.js:20` / `:19` only |
| `bundle/hooks.json` wiring (4× subagentStop, 2× stop, loop_limits 12/5) | verified — exact match L1-49 |
| `saveState` non-atomic, no locks | verified — `fs.writeFileSync` at L313; zero rename/lock hits in file |
| `reviewerNeedsFix` = sole quality blocker (`FIX_REQUIRED\|VERIFY_FAIL`) | verified — L194-203 |
| `searchMemoryIndex` / `checkOwaspTop10` dead exports | verified — definition sites only |

All other line citations were taken during the audit read pass; treat any post-edit drift as line-shift (function-level evidence remains authoritative).

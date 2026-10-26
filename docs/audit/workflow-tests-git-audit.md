# Workflow / Tests / Git Audit — pcore-orchestra

| Field | Value |
|---|---|
| Repo root | local clone of this repo (Windows dev machine) |
| HEAD | `2faf3fb` (fix(orchestra): who shows live runs incl. in_progress; list honors status filter) |
| Branch / remote | `main` / `origin` = https://github.com/P-Core-System/pcore-orchestra.git |
| Audit date | 2026-10-02 |
| Tooling | node v24.14.0, git 2.46.0.windows.1, PowerShell 5.1 |
| Working-tree state at audit | dirty: ` M context/progress-tracker.md`, `?? docs/audit/` (both left untouched by this audit) |
| Prior audits in series | `docs/audit/hook-runtime-audit.md` (2026-10-02 09:34), `docs/audit/agent-architecture-audit.md` (2026-10-02 09:42) |

---

## 1. Claim → Verdict Matrix

Verdict key: **PASS** = claim reproduced; **FAIL** = claim demonstrably false/stale; **PARTIAL** = claim true only under a narrow reading; **ADVISORY** = mechanism exists but does not enforce what the prose implies.

| # | Claim | Source (file:line) | Verdict | Evidence |
|---|---|---|---|---|
| C1 | Zero npm dependencies; no root `package.json` | `docs/01-OVERVIEW-AND-ARCHITECTURE.md:62`, `docs/03-…LIMITATIONS.md:256` | PASS | `Test-Path package.json` → `False`; only template package.json exists (turnstile-spin worker, not installed) |
| C2 | No database; JSON-file persistence only | `docs/03:18`, `docs/03:196` | PASS | State = `bundle/hooks/state/orchestra*.json` family; no DB driver anywhere in `bundle/` |
| C3 | State schema is `"version": 2` | `docs/03:32` (schema block), `docs/03:151-154` (migration table ends at V2) | **FAIL (stale)** | `bundle/hooks/lib/state-manager.js:18` `version: 3` (also `:193`, `:228`, `:245`); live health output reports `version: 3`; docs/03 has no V3 row |
| C4 | "All 9 hook scripts exist" (health check category 1) | `docs/03:284` | **FAIL (stale count)** | `bundle/hooks/orchestra-health.js:45-54` checks **10** named hook files; `bundle/hooks/` contains **11** `orchestra-*.js` (incl. `orchestra-health.js` itself) |
| C5 | Health check has **6** categories | `docs/03:280-288` | **FAIL (stale)** | Actual run emits ~11 sections: Hooks, Lib modules, hooks.json, State, Memory, Classification, Agents, Enterprise State Files, Project Identity, Adaptive loop, Session-claims |
| C6 | "The only code with formal tests" = turnstile-spin vitest (4 files) | `docs/03:316` | **FAIL (stale)** | 3 standalone node suites exist in `scripts/` (`test-adaptive-loop.js`, `test-conductor-state.js`, `test-state-manager-compat.js`) — 63 assertions total, all green; referenced by `evidence-runner.js:99` |
| C7 | Git tag `v1.0.0` exists | `docs/03:357` | **FAIL** | `git tag -l` → **0 tags** in this clone |
| C8 | No deployment pipeline; installation is the deployment | `docs/03:329` | PASS | `.github/workflows/` = `ci.yml` (lint only), `maintenance.yml`, `org-health-scan.yml`, `stale.yml`; no build/release/deploy workflow |
| C9 | CI validates JS syntax + shellcheck | `.github/workflows/ci.yml:20-25` | PASS | `node --check` loop over `scripts/*.js bundle/**/*.js templates/**/*.js`; `shellcheck … \|\| true` (L25) — shellcheck failures **do not fail CI** |
| C10 | CI runs the test suites | implied by "Testing & Deployment" (`docs/03:276-325`) | **FAIL** | `ci.yml` has **no test step**; suites are not executed in CI at all |
| C11 | Health check passes on install (`node … orchestra-health.js`) | `docs/03:304-308`, `docs/03:346` | PASS (Windows WARN) | Exit **0**, prints `All checks passed.`; but also prints `WARN check: script error (exit 127)` for `session-claims.sh` — bash receives an unquoted Windows path whose backslashes are eaten (`<mangled Windows home path>`), plus non-fatal `validation errors: project.name is required; project.slug is required` |
| C12 | The 3 repo test suites pass | repo `scripts/test-*.js` | PASS | 30 + 23 + 10 = **63 PASS / 0 FAIL**, all exit 0 (full output §2) |
| C13 | Test "phase commit gate passes on clean tree" proves clean-tree enforcement | `scripts/test-adaptive-loop.js:350-354` | **PARTIAL (weak)** | Assertion only checks `typeof gate.clean === "boolean"` + `gate.message` truthy. Run from temp copy (no `.git`) the gate **skips** (§2 note); run against real repo root it returns `clean:false` (tree dirty). The test passes either way — it cannot fail for the wrong verdict |
| C14 | Phase commit gate blocks the next phase on a dirty tree | `docs/production-loop.md:43,62`, `bundle/agents/orchestra-verifier.md:26,74,83` | **ADVISORY (not enforced)** | `bundle/hooks/orchestra-subagent-stop.js:268-276` computes the gate, `:286-296` only appends `commitGateBlock` to `followup_message`; no phase halt. Corroborated by `docs/audit/hook-runtime-audit.md:218` ("commit gate message only") |
| C15 | Gate fails closed when git is unavailable | reader may infer from "must be empty" wording | **FAIL (fail-open by design)** | `bundle/hooks/lib/phase-commit-gate.js:51-59` → returns `clean:true, skipped:true` on any git error |
| C16 | Porcelain output is parsed correctly | implied by `phase-commit-gate.js:63-66` | **FAIL (off-by-one bug)** | `runGit` trims the whole stdout (`phase-commit-gate.js:20-21`), destroying the leading space of the **first** `XY ` line; `line.slice(3)` then drops one char of the path. Repro: `" M context/progress-tracker.md"` → parsed `"ontext/progress-tracker.md"` (observed live in gate output `M  ontext/progress-tracker.md`). Consequence: a first-line plan file can never match `ALLOWED_DIRTY` (`:7-10`), and displayed blocking paths are truncated |
| C17 | Verifier evidence gate `git-status` reports tree state | `evidence-runner.js:172-181` | PARTIAL | Dirt is *reported* but always `ok:true` (L178, comment L175); on git error the gate is mislabeled `docs-updated` (L174) instead of `git-status` |
| C18 | "Only implementer commits"; hooks never commit/push | `docs/02:177`, `docs/audit/hook-runtime-audit.md:191` | PASS | Grep of `bundle/hooks/**`: only `git status --porcelain` spawns (`phase-commit-gate.js:33`, `evidence-runner.js:173`); zero `git commit`/`git push` in hook runtime |
| C19 | Verifier hard-fails (`VERIFY_FAIL`) on dirty tree | `bundle/agents/orchestra-verifier.md:26,74,83` | PARTIAL | Enforced only via agent **prompt text**; no code path emits VERIFY_FAIL for dirt (C14/C17) |
| C20 | Worktree / branch isolation exists | `docs/01:83` (P1), `docs/03:385,429` — self-declared **missing** | PASS (gap honestly declared) | Repo-wide grep: **zero** `git worktree`, `worktree add`, `checkout -b` in any script; worktree appears only in prose as gap/future (`docs/greenfield-and-gaps.md:72`, `docs/agent-harness-recommendations.md:175`, `docs/greenfield-and-gaps.md:…` P4) |
| C21 | Install fails if health fails | natural reading of `docs/03:346` "Runs health checks" | **FAIL** | `install.sh:288,296` → `node …health… \|\| true`; `install.ps1:286,290` runs health without checking `$LASTEXITCODE`. Install always exits success regardless of health |
| C22 | "No external downloads — installer copies locally" (supply-chain table) | `docs/03:259` | PARTIAL | `install.sh:175` invokes `scripts/ensure-opencode-latest.sh`, which does `npm view opencode-ai@…` + install (network op, bypassable via `--skip-opencode-upgrade`) |
| C23 | session-claims health sub-check works | `orchestra-health.js:339-382` | FAIL on Windows | bash spawn gets a backslash path → exit 127 (`<mangled Windows home path>`); health still exits 0 |
| C24 | Working tree contains only repo content | — | **FAIL (stray artifact)** | Directory a directory named after the drive-letter path with `:` and `\` replaced by private-use glyphs (U+F03A/U+F05C) exists at repo root, containing only `.pcore/session-claims.json` (1072 B) — a session-claims run against a PUA-mangled path. Git-ignored via `.gitignore:17 .pcore/` so it never shows in `git status` |
| C25 | Health "Classification" validates 6 sample prompts | `docs/03:291-300` | PASS | All 6 samples OK in run output (§2.4): activate/skip verdicts match the documented table |

---
## 2. Exact Test Run Outputs

### 2.0 Temp-copy note (methodology)

All suites were executed from a **temp copy** of the repo at
`%LOCALAPPDATA%\Temp\opencode\pcore-orchestra-audit` (robocopy mirror excluding `.git/`,
`node_modules/`, and the stray PUA directory), so that:

- test side-effects (state files, cycle reports, plan artifacts) could not dirty the real working tree;
- the audit could observe how the phase-commit-gate behaves **outside** a git repo (skip path) vs **inside**
  the real repo (dirty-tree path) — both probes reported below.

The temp copy contains **no `.git`**, which matters for interpretation of the commit-gate test (see C13).
Real-repo probes were run separately against the local clone of this repo.

### 2.1 `node scripts/test-adaptive-loop.js` — exit 0

```
COUNTS: PASS=30 FAIL=0  EXITCODE=0
PASS  default implement routes to core
PASS  enterprise flag routes to enterprise
PASS  complexity signals select enterprise
PASS  short complexity beats informal [C2] enterprise
PASS  bare security audit activates enterprise
PASS  short informal still starts core with infer
PASS  startOrchestra core starts at plan
PASS  startOrchestra enterprise starts at idea
PASS  core agent ids are orchestra-*
PASS  core phase chain plan -> implement -> verify -> review -> done
PASS  advancePhase uses core loopMode
PASS  normalizePhaseFields migrates legacy phase
PASS  questions do not activate
PASS  orchestra config defaults from project.yaml shape
PASS  extractOrchestraFromIdentity reads orchestra block
PASS  mergeRoute keeps explicit enterprise over project core
PASS  startOrchestra applies orchestraConfig max_iterations
PASS  handoff enforcer rejects verbose prompts
PASS  enterprise phase picker filters SDLC chain
PASS  validatePhaseFilter flags unknown ids
PASS  filtered enterprise starts at first enabled phase
PASS  syncWorkspaceIdentity refreshes stale slug when idle
PASS  syncWorkspaceIdentity skips full sync when orchestra active
PASS  semantic memory retrieves relevant goals by keyword
PASS  tokenize strips stop words
PASS  savePlanArtifact writes workspace plan file
PASS  writeCycleReport creates cycle json
PASS  phase commit gate passes on clean tree
PASS  greenfield build a note app routes enterprise with intake
PASS  greenfield stack briefing includes recommended

All adaptive loop tests passed.
```

> Note: the log above is transcribed from `%LOCALAPPDATA%\Temp\opencode\audit-tests.log`;
> `->` in the phase-chain line represents a non-ASCII arrow present in the original console output
> (encoding of the source string in `scripts/test-adaptive-loop.js`, not this file).

### 2.2 `node scripts/test-conductor-state.js` — exit 0

```
COUNTS: PASS=23 FAIL=0  EXITCODE=0
PASS  two sessions -> two distinct run files
PASS  sess-a run file exists
PASS  sess-b run file exists
PASS  index lists both sessions
PASS  same session+task -> same file path
PASS  second begin resumes (not fresh)
PASS  startedAt preserved across resume
PASS  listRuns active for wsA has sess-a + sess-b
PASS  getRunBySession finds live sess-b
PASS  isStale true for old heartbeat
PASS  findStale finds planted stale run
PASS  isStale false for fresh run
PASS  legacy stashed on run
PASS  legacy goal read
PASS  legacy original renamed (gone)
PASS  legacy *.migrated.* created once
PASS  second begin does not re-read legacy
PASS  no .tmp.* residue
PASS  in_progress run stays live (listLiveRuns) and in list --status in_progress
PASS  activeSessionIds includes in_progress run
PASS  completed run absent from live but present in list --status completed
PASS  all run JSON files parse

PASS (all checks)
```

Harness isolation: sets `PCORE_CONDUCTOR_STATE_DIR` to `mkdtempSync(os.tmpdir()+conductor-state-)`
(`scripts/test-conductor-state.js:21-27`) — writes never touch `~/.config/opencode`.

### 2.3 `node scripts/test-state-manager-compat.js` — exit 0

```
COUNTS: PASS=10 FAIL=0  EXITCODE=0
PASS  saveState(session) does not throw
PASS  saveState(session) targets a string path
PASS  loadState returns session with .active
PASS  loadState session has .goal
PASS  loadRootState returns .sessions
PASS  loadRootState.sessions[sid] matches
PASS  flat disk migrates to sessions
PASS  loadState after flat migrate has .active
PASS  DEFAULT_STATE aliases DEFAULT_SESSION_STATE

PASS (all checks)
```

Harness isolation: `mkdtempSync(os.tmpdir()+orchestra-state-)` + `PCORE_SESSION_ID=test-compat-session`
(`scripts/test-state-manager-compat.js:12,27`).

**Suite total: 3 suites / 63 assertions / 0 failures / 0 skips; every suite exit code 0.**

### 2.4 Health check (run from temp copy) — exit 0

```
node bundle/hooks/orchestra-health.js  →  EXIT=0
```

Key output lines (verbatim):

```
=== Enterprise health check ===
OK  orchestra-lib.js … OK  orchestra-quality-gate.js        (10 hook scripts)
=== Lib modules ===
OK  constants.js … OK  memory-index.js, phase-commit-gate.js, greenfield-intake.js,
    greenfield-scaffold.js, hooks.json                         (34 lib entries)
    hooks.json: events sessionStart/beforeSubmitPrompt/subagentStop/stop
    lifecycle/memory/heartbeat/quality gate hooks OK; subagent patterns: 27
=== State ===   version: 3, active: false, phase: idle, ambient: true,
    project/versioning/qualityGates/heartbeat/lifecycle/memory/resumable: present
=== Long-term Memory ===  OK state/orchestra-memory.json (0/0/0)
=== Classification samples ===  OK x6 ("fix import error"→true … "no orchestra just explain"→false)
=== Agents ===  OK … Agents: 27 present, 0 missing
=== Enterprise State Files ===  INIT orchestra-project.json / version / daily / metrics
=== Project Identity System ===
    validation errors: project.name is required; project.slug is required
    validation warnings: project.type / lifecycle.stage / version.channel not in standard enums
=== Adaptive loop install ===  OK no nested hooks/lib/lib; LOOP_MODE_CORE present; core starts at plan
=== Session-claims ===
    OK session-claims.sh exists at …\scripts\session-claims.sh
    WARN check: script error (exit 127)
    stderr: /bin/bash: <mangled path>scripts session-claims.sh: No such file or directory
All checks passed.
```

Notes: (a) identity validation **errors** and the session-claims **WARN** do not affect exit code;
(b) the health run **INIT**'d four enterprise state files inside the temp copy (side-effect confirmed);
(c) exit code 0 matches `docs/03:346` "Runs health checks" but contradicts any claim that health gates install (C21).

### 2.5 Phase-commit-gate probes (not a suite — direct API calls)

| Probe | Command | Result |
|---|---|---|
| Temp copy (no `.git`) | `checkPhaseCommitGate({}, {cwd: <temp>})` | `{"clean":true,"skipped":true,"message":"Git status unavailable (fatal: not a git repository …) — skip commit gate."}` → **fail-open** (C15) |
| Real repo root (dirty) | `checkPhaseCommitGate({}, {cwd: <repo>})` | `{"clean":false,"skipped":false,"blocking":["M  ontext/progress-tracker.md","?? docs/audit/"]}` → first path **truncated** (`context` → `ontext`) proving C16 off-by-one |
| Synthetic plan-file line | `" M .cursor/orchestra-plan.md"` after global `trim()` + `slice(3)` | parses to `"cursor/orchestra-plan.md"`; `ALLOWED_DIRTY` regex `^\.cursor\/orchestra-plan\.md$` → **false** — allowed file would be flagged blocking if it is the first porcelain line |

---
## 3. Git / Worktree Flow Trace (file:line)

### 3.1 Where git is actually invoked at runtime (complete inventory)

| Site | Call | Timeout | Purpose | Blocking? |
|---|---|---|---|---|
| `bundle/hooks/lib/phase-commit-gate.js:12-23` (`runGit`) | `spawnSync("git", args)` | 15 000 ms | generic runner | — |
| `bundle/hooks/lib/phase-commit-gate.js:32-37` (`porcelainLines`) | `git status --porcelain` | 15 s | dirty-tree check before phase advance | **No** — result only formatted into `followup_message` (see 3.2) |
| `bundle/hooks/lib/evidence-runner.js:172-181` (`evidenceGitClean`) | `git status --porcelain` (via `runCmd`, 60 000 ms / 2 MB cap at `:31-32`) | 60 s | evidence report line | **No** — `ok:true` always (`:178`); on git error returns gate `docs-updated` `ok:true` (`:174`) |
| `scripts/session-claims.sh:58` | `git -C <repo> rev-parse --abbrev-ref HEAD` | default | record claiming branch in `.pcore/session-claims.json` | n/a (CLI only) |
| `scripts/init-project.sh:488`, `scripts/init-project.ps1:373` | prints suggested `git init && git add -A && git commit` | n/a | **echo only** — scaffold never runs git itself | n/a |
| `docs/production-loop.md:14,43,62` | documents "implementer → git commit (required) → clean tree" | n/a | prose policy | — |

**Zero occurrences** of `git commit`, `git push`, `git checkout`, `git merge`, `git branch`, `git worktree`, or `git clone` in any runtime hook/lib/script (repo-wide grep; `git clone` appears only in README/docs/skill markdown as instructions). Hooks are advisory-only w.r.t. git — confirmed previously in `docs/audit/hook-runtime-audit.md:191`.

### 3.2 The phase-commit-gate control flow (Cursor side)

```
orchestra-subagent-stop.js:28        require checkPhaseCommitGate
  → :258-266  if nextPhase == "verify" → runEvidenceChecks(state) → evidenceBlock (report only)
  → :268-276  gate = checkPhaseCommitGate(state)          // try/catch; failure swallowed
      commitGateBlock = gate.message
      if !gate.clean && nextPhase in {verify,review} → append "Parent: commit or discard…"
  → :286-296  emit({ followup_message: [ …, buildPhaseHandoff(...), commitGateBlock || null, evidenceBlock || null ] })
  → :297      return true                                  // phase ALWAYS advances
```

Citations: `bundle/hooks/orchestra-subagent-stop.js:257-298`.
Gate internals: `phase-commit-gate.js:48-86` (`checkPhaseCommitGate`), `:88-106` (`buildCommitGateHandoff`).
Skip/fail-open path: `:51-59` — any non-zero git exit ⇒ `{clean:true, skipped:true, message:"Git status unavailable … skip commit gate."}`.
Allowed-dirty regexes: `:7-10` (`\.cursor/orchestra-plan\.md`, `orchestra-plan\.md`); per-line match at `:39-42`; parse at `:63-66` (uses `line.slice(3)` — off-by-one after global stdout trim, see C16).

### 3.3 Agent-level (prompt) git policy — text only

| Agent | File:line | Rule |
|---|---|---|
| implementer | `bundle/agents/orchestra-implementer.md:64,85-91,110` | stage plan files (`git add <files>`), commit, `git status --porcelain` empty before `IMPLEMENT_DONE`; parent won't launch verifier otherwise |
| verifier | `bundle/agents/orchestra-verifier.md:26,74,83` | dirty tree ⇒ `VERIFY_FAIL` |
| conductor (OpenCode) | `bundle/opencode/agents/orchestra.md:385`, `bundle/agents/orchestra.md:284` | run `git status --porcelain` before each post-implement phase |
| skill | `bundle/skills/orchestra-loop/SKILL.md:151,165` | parent checks porcelain before next subagent |
| spec | `context/specs/phase-commit-gate-workflow.md:14,19` | documents gate + parent duty |

**Enforcement gap:** no code emits `VERIFY_FAIL` for dirt; the only machine gate is a message string. Verdict rows C14/C19.

### 3.4 Worktree / branch-isolation flow — DOES NOT EXIST

| Probe | Result |
|---|---|
| grep `git worktree` / `worktree add` / `checkout -b` / `git clone` across `*.js,*.sh,*.ps1` | **0 hits** (only markdown prose: `README.md:21,335`, `bundle/opencode/skills/setup/SKILL.md:28,40,58,226`, cloudflare skill sandbox refs) |
| `docs/03-…LIMITATIONS.md:385` | "Branch Isolation \| P1 \| Medium" listed under **Missing Features** |
| `docs/03-…LIMITATIONS.md:429` | Roadmap: "Orchestra auto-creates git branch → implements → verifies → merges or creates PR" (P1, v1.1 — not implemented) |
| `docs/01-OVERVIEW-AND-ARCHITECTURE.md:83` | P1 backlog "Run orchestration in isolated git branches" |
| `docs/greenfield-and-gaps.md:72` | gap row "Parallel worktrees — One implementer at a time" |
| `docs/agent-harness-recommendations.md:175` | "No parallel writes — sequential phases; use worktrees only for explicitly parallel features" |
| `context/specs/quality-evidence-gates.md:10` | "Out of scope: … parallel worktrees (gap)" |
| `context/progress-tracker.md:198` | P4 future: "SQLite FTS / hybrid embeddings / worktrees" |
| `docs/production-loop.md:123`, `docs/agent-orchestra-rag-research.md:69,153,190` | worktrees listed as *future/research* capability only |

**Conclusion:** the entire git story is (a) prompt text requiring the implementer to commit, plus (b) two read-only `git status --porcelain` probes whose results are printed but never gate execution. There is **no branch creation, no worktree, no merge/PR automation** anywhere in code — and the docs correctly self-declare this as a missing P1 feature (see §6).

### 3.5 Observed live gate output (evidence of C16)

Real repo probe at audit time returned:

```
blocking = [
  "M  ontext/progress-tracker.md",                     ← 'c' of "context" eaten by slice(3) after trim()
  "?? \"docs/P-Core Orchestra \342\200\224 Master … Prompt.md\"",   ← file created 2026-10-02 10:02 during audit session (not by this audit; left untouched)
  "?? docs/audit/"                                     ← this audit's directory
]
```

Working-tree baseline at audit start was ` M context/progress-tracker.md` + `?? docs/audit/` (from `git status --short`); the Master-Engineering prompt file appeared at 10:02:32 while the audit ran (external writer; recorded, not modified).

---
## 4. Engineering-Concepts Table (Project → Worktree)

Concepts as actually implemented in this repo, in dependency order; citations are the authoritative definition site.

| Concept | Definition (as implemented) | Canonical storage / site | Key file:line | Status |
|---|---|---|---|---|
| **Project** | Identity record for a target repo: name, slug, type, lifecycle, version, stack, orchestra block — parsed from `project.yaml` (fallback `project.json`) | `<repo>/project.yaml` | `bundle/hooks/lib/project-identity.js:6-7` (`PROJECT_YAML_NAME`), `:11` (`DEFAULT_PROJECT_IDENTITY`), `:114` (type enum), `:194` (minimal YAML parser) | Implemented; health check reports enum warnings for this repo's own `project.yaml` |
| **Project identity (runtime)** | Loaded/validated identity injected into state + greenfield scaffold routing | in-session `state.project` | `bundle/hooks/lib/project-identity.js:177-194`, health check `orchestra-health.js` "Project Identity System" section | Implemented |
| **Workspace** | The cwd / repo root an orchestration runs against; detected via `project.yaml`/`context/` presence; identity slug may auto-refresh when idle | process cwd + `workspace-identity` lib | `bundle/hooks/lib/workspace-identity.js` (tested at `scripts/test-adaptive-loop.js:~200` "syncWorkspaceIdentity…") | Implemented |
| **Session** | One editor session; ID derived at runtime, namespaces all state (`migrateToSessions` upgrades legacy flat files) | `state/orchestra.json` → `sessions[sid]` | `bundle/hooks/lib/state-manager.js:145` (`getSessionId`), `:184` (`migrateToSessions`), `:228/:245` (`version:3` root shape) | Implemented (V3 root schema — docs/03 still shows V2, see C3) |
| **State (root + session)** | JSON CRUD: `loadRootState`/`loadState`/`saveState`/`startOrchestra`; V1→V3 deep-merge migration | `~/.cursor/hooks/state/orchestra.json` (installed) / `bundle/hooks/state/orchestra.json` (source, gitignored) | `state-manager.js:15` (`STATE_PATH`), `:255`, `:268`, `:456-474` (exports) | Implemented; covered by `test-state-manager-compat.js` (10 PASS) |
| **Run (conductor run)** | Per-orchestration run file for OpenCode conductor: begin/heartbeat/complete/fail, stale detection, legacy migration; atomic tmp+rename | `~/.config/opencode/hooks/state/conductor-runs/<ws>/<sid>/<tid>.json` + `index.json` | `bundle/hooks/lib/conductor-state.js:27-30` (paths), `:90-109` (atomicWrite), `:181/223/290` (begin/heartbeat/complete) | Implemented; covered by `test-conductor-state.js` (23 PASS) |
| **Phase** | `plan → implement → verify → review → done` core chain (enterprise = filtered SDLC chain); transitions in `phase-engine.js` | `state.currentPhase` + `phase_history[]` | `bundle/hooks/lib/phase-engine.js`; constants `bundle/hooks/lib/constants.js`; exercised by `scripts/test-adaptive-loop.js` (30 PASS) | Implemented |
| **Subagent / Agent** | 4 core role agents + 27 enterprise specialists; spawn via Cursor `Task(subagent_type)` or OpenCode `task`; 27-name matcher chains `subagentStop` | `bundle/agents/*.md`, `bundle/opencode/agents/*.md`, `bundle/hooks.json` matcher | `bundle/hooks.json:19,24` (27 names, loop_limit 12), `docs/audit/agent-architecture-audit.md:71` | Implemented; 133/160 agents not auto-chained (prior audit) |
| **Bridge (project bridge)** | Repo-local `.cursor/hooks.json` delegating every hook to global `~/.cursor/hooks/<script>` via `bridge.js` | `<repo>/.cursor/hooks.json` + `.cursor/hooks/bridge.js` | `project-bridge/hooks/bridge.js:3,28`; installed by `install.sh:309-310` / `install.ps1:278` | Implemented |
| **Quality gate (evidence)** | Runs `node --check`, `npm test`, `npm build`, `npm lint`, security scan, `git status` and records pass/fail per gate | `state.qualityGates` | `bundle/hooks/lib/evidence-runner.js:27` (`runCmd`, 60 s), `:187-207` (`runEvidenceChecks`), `:213-219` (`applyEvidenceToGates`) | **Recorded but non-blocking** (gate results never consulted for phase advance — `hook-runtime-audit.md:173`) |
| **Phase commit gate** | Advisory porcelain check at phase boundary; message injected into handoff | none (ephemeral) | `bundle/hooks/lib/phase-commit-gate.js:48-86`; wired `orchestra-subagent-stop.js:268-276` | Advisory only; fail-open on git error; first-line parse bug (C15/C16) |
| **Plan artifact** | `.cursor/orchestra-plan.md` written per cycle, gitignored, exempt from commit gate | `<repo>/.cursor/orchestra-plan.md` | `.gitignore:5`; `ALLOWED_DIRTY` `phase-commit-gate.js:7-10`; `lib/plan-artifact.js` | Implemented (exemption broken for first porcelain line — C16) |
| **Session claim** | File-lock-ish claim of a repo by a session: `<repo>/.pcore/session-claims.json` | `$repo/.pcore/session-claims.json` | `scripts/session-claims.sh:34,46,61`; health check `orchestra-health.js:339-382` | Implemented (bash fails on Windows path → WARN, C23; a PUA-mangled-path artifact dir exists, C24) |
| **Commit** | Human/implementer action only; convention `<type>(<scope>): <desc>`; hooks never commit | working tree | policy `docs/02:177`; prompts `bundle/agents/orchestra-implementer.md:85-91` | Prompt-level only |
| **Branch** | Not created by any code; feature-branch flow exists only as contributor instructions | — | `README.md:335`; missing-feature rows `docs/03:385` | **Not implemented** (declared P1 gap) |
| **Worktree** | Not present anywhere; only referenced as future parallel-implementer strategy | — | `docs/03:429`, `docs/greenfield-and-gaps.md:72`, `context/progress-tracker.md:198` | **Not implemented** (declared gap) |

---
## 5. Install / Deploy Findings

### 5.1 Install surface

| Item | Finding | Evidence |
|---|---|---|
| Installers | `install.sh` (bash, `set -euo pipefail` at `:11`) and `install.ps1` (`$ErrorActionPreference="Stop"` at `:16`) — dual-platform as claimed | docs/03:331-337 |
| Copy strategy (sh) | `cp -f` hook scripts, `cp -rf` lib dir (deliberately replaces `lib` to avoid `lib/lib/` nesting), `robocopy` not used on Unix | `install.sh:76-79` |
| Copy strategy (ps1) | `robocopy … /E /NDL /NJH /NJS /NP`; lib dir pre-deleted to avoid nesting | `install.ps1:57,75,85,95,197,204` |
| hooks.json merge | Embedded Node heredoc dedups by command name; never overwrites unrelated user hooks | `install.sh:121-143`, `install.ps1:115-141`; invariant `context/architecture.md:285` |
| Autonomy merge | `scripts/merge-autonomy-config.js --cursor/--opencode` invoked mid-install | `install.sh` (~`:144`), `install.ps1:144,246` |
| External skill links | `ln -sf` → `~/.agents/skills/` with `cp -r` fallback; ps1 uses `New-Item -SymbolicLink` w/ SilentlyContinue | `install.sh:152-153,258-259`, `install.ps1:107-109,237-239` |
| Project bridge | `--project` copies `project-bridge/hooks.json` + `hooks/bridge.js` into `<cwd>/.cursor/` | `install.sh:309-310`, `install.ps1:278` |
| Repo scoping | Auto-installs `setup-repo-scoping.sh` + `opencode-maintenance.sh` into `~/.local/bin` | `install.sh:323,331`, `install.ps1:313-317` |
| State preservation | Default `orchestra.json` copied only if absent | `install.sh:83`, `install.ps1:60-62,224` |

### 5.2 Health-gating (install never fails on health)

| Installer | Behavior | Verdict |
|---|---|---|
| `install.sh:284-298` | `health_cursor()` / `health_opencode()` run `node …orchestra-health*.js \|\| true` | **Health failures cannot fail install** (C21). The `set -e` at `:11` is neutralized by `\|\| true` |
| `install.ps1:282-290` | Health node processes run; `$LASTEXITCODE` **never checked** | Same outcome on Windows |
| Health script itself | Prints `All checks passed.` and exits 0 even with WARN (session-claims exit 127) and identity **validation errors** | C11/C23; observed in §2.4 |

### 5.3 Network / supply-chain touchpoints

| Item | Finding | Evidence |
|---|---|---|
| Core payload | Local-only copy; zero npm deps; no lockfiles at repo root | C1, `Test-Path package.json` → False |
| OpenCode CLI upgrade | `install.sh:175` → `bash scripts/ensure-opencode-latest.sh` which runs `npm view opencode-ai@…` (`ensure-opencode-latest.sh:50`) + install; skippable via `--skip-opencode-upgrade` | Contradicts an unqualified reading of "No external downloads" (C22, docs/03:259) |
| Free-model ops | `scripts/update-free-models.sh --refresh` fetches model catalogs (network) — post-install tooling, not part of `install.sh` default path | `context/architecture.md:57` |
| Third-party code | Vendored UI skills (MIT) documented in `THIRD_PARTY.md` | repo root |

### 5.4 CI / deploy pipeline

| Item | Finding | Evidence |
|---|---|---|
| Pipeline claim | "**no deployment pipeline.** Installation is the deployment" | `docs/03:329` — **accurate** |
| `.github/workflows/ci.yml` | 25 lines: triggers `workflow_dispatch` + `pull_request` to main only (**not push to main**); job `lint`: `node --check` over `scripts/*.js bundle/**/*.js templates/**/*.js`, then `shellcheck install.sh scripts/*.sh \|\| true` (shellcheck failures ignored) | `ci.yml:3-6,12-25` |
| Tests in CI | **Not run** — no suite invocation anywhere in CI | C10 |
| Other workflows | `maintenance.yml`, `org-health-scan.yml`, `stale.yml` (housekeeping, not deploy) | `.github/workflows/` |
| Release | Docs say "Git tags: `v1.0.0`" | `docs/03:357` — **clone has 0 tags** (C7) |
| Rollback | Documented as `git checkout -- bundle/` + reinstall — matches reality (no artifacts/versions to roll back to) | `docs/03:350-353` |
| Post-install smoke | `docs/production-loop.md:96` "install smoke" = `node ~/.cursor/hooks/orchestra-health.js` | consistent with §2.4 behavior (exit 0 regardless) |

### 5.5 Observed anomalies during audit

1. **Stray PUA directory** at repo root: a directory named after the drive-letter path with `:` and `\` replaced by private-use glyphs (U+F03A/U+F05C) containing only `.pcore/session-claims.json` (1072 B) — a session-claims run against a path whose `:`/`\` were replaced by private-use glyphs. Hidden from `git status` because `.gitignore:17` ignores `.pcore/` (confirmed via `git status --ignored` → `!! …/.pcore/`). Left untouched.
2. **External file write mid-audit**: `docs/master-engineering-prompt.md` (35 937 B; since renamed from its original long title) appeared at 10:02:32 while this audit ran; recorded in §3.5, not modified.
3. **Pre-existing dirty file**: `context/progress-tracker.md` modified — left as-is per instructions.

---

## 6. docs/03 Self-Declared Limitations (verbatim inventory)

Source: `docs/03-DATABASE-SECURITY-TESTING-LIMITATIONS.md`.

### 6.1 Missing Tests (§12, lines 318-325)

| Area | Self-declared impact |
|---|---|
| Hook scripts (no unit tests) | Low — thin orchestrators, tested through health check |
| Lib modules (no unit tests) | Low-medium — pure functions, health check validates integration |
| Checkpoint manager (no resume/abort tests) | Medium — complex state transitions |
| Install scripts (no cross-platform CI) | Medium — tested manually |

> Audit note: the "only code with formal tests = turnstile vitest" statement (line 316) is **outdated** — three node suites exist and pass (C6). Conversely, lib/hook unit coverage is still essentially the 3 suites + health check, so the *gap* rows remain fair.

### 6.2 Technical Debt (§13, lines 367-374)

| # | Debt | Impact | Fix effort |
|---|---|---|---|
| 1 | No unit tests for lib modules | Low | Medium |
| 2 | No TypeScript types | Low | Low |
| 3 | Classification regex is fragile (edge cases) | Medium | Low |
| 4 | No error classification in history | Low | Low |
| 5 | Memory only injected on phase 1 implement | Medium | Low |
| 6 | No logging framework | Medium | Medium |

### 6.3 Known Bugs (line 378)

- Self-declared: "**None.** All critical (C1-C3) and important (I1-I6) issues from code review have been resolved."
- **Audit contradiction:** at least C16 (porcelain first-line off-by-one) and C15 (fail-open gate) are live defects/behaviors not reflected here; docs/03's "Known Bugs: None" is **overstated** relative to code evidence.

### 6.4 Missing Features (lines 382-390)

| # | Feature | Priority | Impact |
|---|---|---|---|
| 1 | Durable Skills | P1 | Medium |
| 2 | Branch Isolation | P1 | Medium |
| 3 | MVP Mode | P2 | Low |
| 4 | `context/specs/` Template | P2 | Low |
| 5 | RAG / Codebase Indexing | P2 | Medium |
| 6 | Background Agents | P2 | Low |
| 7 | P-Core CLI Integration | P3 | Low |

(Note: `context/specs/` template — item 4 — appears **done** in practice: `templates/context/specs/` exists per `context/architecture.md:60`, and 9 spec files live in this repo's `context/specs/`. The docs/03 row is likely stale.)

### 6.5 Scalability Limits (lines 394-401)

| Limit | Value | Notes |
|---|---|---|
| Concurrent orchestrations | 1 | Single global state file |
| Long-term memory | 100 goals / 50 files / 50 errors | Ring buffer caps |
| Lifecycle events | 200 | Ring buffer |
| History runs | 50 | Ring buffer |
| Phase duration | Unlimited | Stall detection only; no hard timeout |
| Token budget | 63k per cycle | Per-agent limits |

### 6.6 Other self-declared scope exclusions

- Security §11: "no network endpoints, no authentication, no user accounts, no external API calls" (line 196); authz = agent frontmatter table (lines 219-224).
- Roadmap P1 (lines 425-429): Durable Skills + **Branch Isolation**; P2 (433-437): MVP Mode, RAG, Context Specs; P3 (441-443): P-Core CLI, Background Agents.

---

## 7. Bottom Line

1. **Tests: green, but thin and CI-orphaned.** All three repo suites pass (30 + 23 + 10 = 63 assertions, exit 0 each) and are hermetic (tmpdir state), plus the health check exits 0. But no suite runs in CI (`ci.yml` = syntax-check + `shellcheck || true` only), docs/03 undercounts the test inventory ("only turnstile vitest", "6 health categories", "9 hook scripts", "state V2"), and the flagship "phase commit gate passes on clean tree" test asserts only `typeof clean === "boolean"` — it passes on a dirty repo and on a non-git copy alike.
2. **Git/worktree flow: advisory text, zero mechanics, with two live defects.** Runtime git usage is limited to two read-only `git status --porcelain` probes (`phase-commit-gate.js:33`, `evidence-runner.js:173`); nothing ever commits, pushes, branches, or creates worktrees — branch isolation and worktrees are honestly declared missing P1/P4 gaps in docs/03 and elsewhere. The gate is non-blocking (`orchestra-subagent-stop.js:286-296` message-only), **fail-open** when git is unavailable (`phase-commit-gate.js:51-59`), and mis-parses the first porcelain line because `runGit` trims the whole stdout before `line.slice(3)` — observed live (`"M  ontext/progress-tracker.md"`) and proven to break the plan-file exemption. Evidence gates are likewise recorded but never consulted for phase advance.
3. **Install/deploy: copy-based, self-declaring, and health-blind.** Install = local copy + hooks.json merge + skill symlinks, with one network op (OpenCode CLI npm upgrade, skippable); there is no deployment pipeline, no release tags in the clone (contradicting docs/03's `v1.0.0`), and **neither installer can fail on a health error** (`install.sh:288,296 \|\| true`; `install.ps1` ignores `$LASTEXITCODE`) — while the health check itself exits 0 despite WARNs and identity validation errors. Net: the repo's stated limitations are largely accurate and candid (worktrees/branch isolation correctly declared absent), but the docs' bug-free/testing-version claims lag the code, and the enforcement points that exist are message-only.
# P-Core Orchestra — Deep Architecture & Workflow Audit (Master Report)

> **Date:** 2026-10-02 · **Repo:** `github.com/P-Core-System/pcore-orchestra` (local clone `D:\Learning Web Development\pcore\pcore-orchestra`, branch `main` @ `2faf3fb`, clean tree before audit)
> **Method:** Four parallel specialist inspections (runtime/state, agents/AI/MCP, docs-vs-code/tests/git, security/observability/async) plus direct verification reads by the conductor. Every claim below cites an evidence file, a source file, or a command output. No feature is credited because documentation mentions it.

## Evidence index (companion files in this directory)

| Evidence file | Bytes | Covers |
|---|---|---|
| `hook-runtime-audit.md` | 40,881 | Event wiring, 35 lib modules, state machine, state storage, memory, completion verification, shell execution, event flow, gaps |
| `agent-architecture-audit.md` | 33,638 | Orchestra + enterprise agents, AI gateway absence, MCP table, tool surfaces, spawn/parallelism/handoff, verification log |
| `workflow-tests-git-audit.md` | 37,074 | 25-row claim→verdict matrix, executed test suites, git/worktree trace, engineering-concepts table, install/deploy, docs/03 limitations |
| `security-observability-audit.md` | 26,868 | 21 classified security findings, OWASP map, observability inventory, job inventory, concurrency assessment |

Cross-references below use short names: **[runtime]**, **[agents]**, **[workflow]**, **[security]**.

---

## 1. Repository Discovery

**What this repository is:** a *distribution bundle* of IDE-agent orchestration assets (Node hook scripts, Markdown agent/skill definitions, config profiles, shell CLIs, templates) installed into `~/.cursor/` and `~/.config/opencode/`. It is **not** an application: there is no server process, no HTTP listener (`createServer|listen(` = 0 hits in `bundle/**`), no database, no queue, no package manifest at root (zero npm dependencies) **[agents §3; workflow C1]**.

1,875 files total. Directory inventory:

```text
Path                    Purpose                                   Important files                          Status
------------------------ ----------------------------------------- ---------------------------------------- ----------------------
bundle/ (1,740 files)   Payload copied to ~/.cursor + ~/.config/   hooks.json, ORCHESTRA.md                 Implemented
  bundle/hooks.json      Cursor event wiring (4 events)            sessionStart, beforeSubmitPrompt (5s),   Implemented
                                                                    subagentStop x4 (loop_limit 12/5),
                                                                    stop x2 (loop_limit 5)
  bundle/hooks/ (11 js)  Hook entry scripts                        orchestra-prompt.js, -subagent-stop.js,  Implemented
                                                                    -session-start.js, -quality-gate.js,
                                                                    -lifecycle.js, -memory.js, -stop.js,
                                                                    -heartbeat.js, -enable.js (CLI),
                                                                    -health.js, -lib.js (DEAD barrel)
  bundle/hooks/lib/(35)  Orchestration library                     state-manager, phase-engine,             Partial
                                                                    conductor-state, evidence-runner,
                                                                    quality-gate, prompt-classifier,
                                                                    memory-manager, token-tracker, ...
                                                                    DEAD: devops.js, self-improvement.js,
                                                                    orchestra-lib.js [runtime §2]
  bundle/agents/ (165)   Cursor agent prompt templates             orchestra.md + 4 phase agents +          Implemented (prompt-only)
                                                                    155 numbered specialists + 5 refs
  bundle/opencode/(165)  OpenCode mirror (frontmatter converted)   same set, mode: subagent                 Implemented (synced by
                                                                                                             scripts/sync-opencode-agents.js)
  bundle/skills/ (637)   38 skill folders (UI, Cloudflare,         orchestra-loop, prompt-intake,           Partial (mostly docs;
                        security, data, ops)                      ui-ux-pro-max, turnstile-spin, ...       25 executable scripts)
  bundle/skills-cursor/  17 Cursor built-in skills                 review, shell, sdk, ...                  Implemented (vendored)
  bundle/rules/          Always-on Cursor rule                    orchestra-loop.mdc                       Implemented
  bundle/config/         Permission/autonomy profiles              cursor/{permissions,sandbox,cli-         Implemented (see §17)
                                                                    autonomy}.json,
                                                                    opencode/autonomy.json
  bundle/opencode/hooks/ Byte-mirror of hooks (inert copy)        orchestra-health-opencode.js only used   Partial — installed but
                                                                    as CLI; NO event registration for        never fired by OpenCode
                                                                    OpenCode [runtime §1]
scripts/ (31)            Operator CLIs + tests + systemd           conductor-state.sh, session-claims.sh,   Implemented
                                                                    update-free-models.sh, init-context,
                                                                    sync-opencode-agents.js,
                                                                    test-{adaptive-loop,conductor-state,
                                                                    state-manager-compat}.js,
                                                                    systemd/pcore-free-models.{service,timer}
project-bridge/ (2)      Per-repo .cursor bridge                   hooks.json, hooks/bridge.js              Implemented
templates/ (41)          Six-file context + AGENTS.md +            context/, AGENTS.md, project.yaml        Implemented
                        project.yaml templates
context/ (21)            This repo's own six-file methodology      architecture.md, progress-tracker.md,    Implemented
                                                                    harness-scaffold-loop.md
docs/ (16 + plans +      Feature docs, plans, research, THIS       01-04 overview docs, autonomous-         Partial — contains stale
audit/ (5))              audit                                      workflow.md, greenfield-and-gaps.md,     + phantom claims
                                                                    orchestra-cross-platform.md
.github/ (8)             CI + templates                             workflows/ci.yml (node --check +         Partial — no tests in CI
                                                                    shellcheck || true), maintenance.yml
.cursor/ (3)             Repo-as-project bridge + runtime state    hooks.json, hooks/bridge.js,             Implemented (state artifact)
                                                                    hooks/state/continual-learning.json
stray dir D??Learning... Runtime artifact of a path-join bug        .pcore/session-claims.json               Dead/junk — should be
                                                                                                             removed [workflow §install]
```

**Not present anywhere (searched, not assumed):** applications, services, workers, APIs, MCP server implementation, database layer, queues, model/provider adapters, authentication/authorization services, embeddings/vector storage, deployment infrastructure (installation *is* the deployment — **[workflow C8]**).

**Implementation-status legend** used throughout: **Implemented** (code path executes) · **Partial** (exists but advisory/thin/unwired) · **Placeholder** (schema/exports with no caller) · **Docs-only** (prose claims, no code) · **Dead** (never reachable).

---

## 2. Actual Architecture

Reconstructed from source, not from README.

```text
═══════════ PATH A — Cursor IDE (hooks-driven, ambient) ═══════════

User prompt
  │ beforeSubmitPrompt (timeout 5s)  [bundle/hooks.json:9-15]
  ▼
orchestra-prompt.js
  ├─ prompt-classifier.js  (regex: disable/enable/resume, activate?, route core|enterprise|greenfield)
  ├─ state-manager.startOrchestra()  → writes sessions[sid] in state/orchestra.json
  └─ stdout: additional_context = "Launch **orchestra-planner**" + handoff(≤2500 chars)
  ▼
HOST MODEL spawns Task(subagent_type="orchestra-planner")     ← instruction, NOT programmatic spawn
  ▼
Planner finishes → host reports status:"completed"
  │ subagentStop x4  [bundle/hooks.json:16-37]
  ▼
orchestra-subagent-stop.js  (driver)
  ├─ reviewerNeedsFix(): /FIX_REQUIRED|VERIFY_FAIL/i on reviewer text  ← THE real quality gate
  ├─ handlePhaseComplete(): currentPhase = next (phase-engine chain)
  ├─ plan-artifact.savePlanArtifact() → .cursor/orchestra-plan.md + state/plans/<run>.md
  ├─ evidence-runner.applyEvidenceToGates() → runs npm build/test/lint (60s cap) — RECORDS ONLY
  ├─ phase-commit-gate.checkPhaseCommitGate() → git status --porcelain — MESSAGE ONLY
  └─ stdout: followup_message = "Launch **<next agent>**" + handoff
orchestra-lifecycle.js / -memory.js / -quality-gate.js append events, LTM context, gate records
  ▼
loop (host loop_limit 12, iteration cap 8) → plan → implement → verify → review → done
  │
  │ stop events → orchestra-stop.js (nudge) + orchestra-heartbeat.js
  │               (stall >300s → stall_detected; 2 stalls → abort run)
  ▼
Completion flush (subagent-stop when next=="done"):
  history-recorder(50 runs) + token-tracker(finalize) + memory-manager.flushShortToLong
  + cycle-report(cycles/<runId>.json) + version-manager.bump + active=false

═══════════ PATH B — OpenCode CLI (conductor-driven, no hooks) ═══════════

User prompt → default_agent "orchestra" (bundle/opencode/agents/orchestra.md, steps: 500)
  ▼
Conductor spawns task(orchestra-planner) → ... → task(orchestra-reviewer)  (sequential, one at a time)
  ▼ after each phase: bash scripts/conductor-state.sh begin|save|who|resume|complete|fail
conductor-state.js → atomic per-run JSON
    ~/.config/opencode/.../conductor-runs/<workspace>/<session>/<task>.json + index.json
  ▼
ORCHESTRA_COMPLETE / FIX_REQUIRED (prose tokens) → complete | fix loop (max 3) | escalate (5 resumes)
```

**Service boundaries:** none (no services). **Package boundaries:** `bundle/` (payload) ↔ `scripts/` (operators that mutate payload/targets) ↔ `project-bridge/` (delegating shim). Hooks import only from `bundle/hooks/lib/`; nothing imports across into `scripts/` except `evidence-runner.js` spawning `node scripts/test-adaptive-loop.js` and `orchestra-health.js` as child processes.

**Dependency direction:** host IDE → hooks → lib → JSON state files. The repo never calls out over the network from hooks (0 `fetch`/`http.request`/`require("http|https|net|tls")` in hook code — verified directly and in **[agents §3]**).

**Data flow:** all state = flat JSON files under `bundle/hooks/state/` (installed → `~/.cursor/hooks/state/`), whole-root read-modify-write per hook invocation, no transactions across files.

**Control flow (critical):** the orchestrator never *calls* the next agent. It emits instructions (`followup_message` / `additional_context`) that the host LLM is expected to obey. **Spawning is prose, compliance is hope** — this is the single most important architectural fact in the system.

**Asynchronous flow:** none in-process. Every hook is a fresh synchronous `node` process (stdin JSON → stdout JSON). Concurrency risk exists only *between* hook processes racing the same state file (**[security §concurrency]**).

**Error flow:** fail-open everywhere — `main().catch(() => emit({}))`, malformed stdin → `{}`, corrupt state JSON → silently reset to defaults (finding **S-04, High**), `git` failure → commit gate reports PASS (**`phase-commit-gate.js:51-59`**), build/test failure → gate *recorded red* but phase still advances (**[runtime §6]**).

**Entry points (the only ways to start work):** (1) Cursor prompt event → `orchestra-prompt.js`; (2) OpenCode `default_agent: orchestra`; (3) CLI `node ~/.cursor/hooks/orchestra-enable.js start "<goal>"`; (4) manual `bash scripts/conductor-state.sh begin`.
---

## 3. Explain the Core Runtime

There is no long-running process. The "runtime" = 11 hook entry scripts + 35 lib modules executed as short-lived `node` processes by the host IDE, plus a separate conductor CLI path for OpenCode.

| Name | Location | Responsibility | Called by | Calls | State | Current limitations |
|---|---|---|---|---|---|---|
| `orchestra-prompt.js` | `bundle/hooks/` | Classify prompt, start/resume/disable loop, inject context | Cursor `beforeSubmitPrompt` | `prompt-classifier`, `state-manager`, `checkpoint-manager`, `context-detector`, `greenfield-*` | R/W `orchestra.json` | 5s timeout; bare words (`continue`, `disable orchestra`) act as control plane; no payload validation |
| `orchestra-subagent-stop.js` | `bundle/hooks/` | Phase advance, fix-loop, completion flush — the driver | Cursor `subagentStop` (27-name matcher) | `phase-engine`, `evidence-runner`, `phase-commit-gate`, `plan-artifact`, `quality-gate`, `history/token/memory/cycle/version-manager` | R/W `orchestra.json` + 8 satellite files | Advances on host `status==="completed"` regardless of gate failures; up to 6 sibling hook processes race the same file |
| `orchestra-lifecycle.js` | `bundle/hooks/` | Event log + heartbeat refresh | `subagentStop` | `lifecycle-recorder` | `orchestra.json` (200-event cap) | `phase_history` uncapped within run |
| `orchestra-memory.js` | `bundle/hooks/` | Inject LTM context at implement/iteration 1 | `subagentStop` (4 phase agents) | `memory-manager` | reads | Injects exactly once per run |
| `orchestra-quality-gate.js` | `bundle/hooks/` | Score reviewer markers into gate records | `subagentStop` (reviewers) | `quality-gate`, `evidence-runner` | `qualityGates` | Gate results never block advance (see §15) |
| `orchestra-stop.js` / `orchestra-heartbeat.js` | `bundle/hooks/` | Nudge + stall detection (300s, abort after 2 stalls) | Cursor `stop` | `heartbeat-monitor`, `lifecycle-recorder` | `heartbeat` | Stall depends on host firing `stop` |
| `orchestra-session-start.js` | `bundle/hooks/` | Context injection (six-file pointers, project.yaml, LTM, crash recovery) | `sessionStart` | `context-detector`, `checkpoint-manager`, `memory/token-tracker` | reads (+ workspace identity sync) | Injects pointer lists, not file contents |
| `state-manager.js` | `lib/` | Session CRUD, `startOrchestra`, session-id resolution | all hooks | — | `orchestra.json` root | **Non-atomic `writeFileSync` (L313), no locks, sessions map unbounded** |
| `phase-engine.js` | `lib/` | Phase chains (core 4 / enterprise 32), `reviewerNeedsFix` | subagent-stop, prompt, tests | `constants.js` | pure | `advancePhase` unused at runtime (direct assignment instead) |
| `conductor-state.js` | `lib/` | Per-run atomic store for OpenCode conductor | `scripts/conductor-state.sh`, tests | — | `conductor-runs/<ws>/<sid>/<tid>.json` | **Not required by any hook** — Cursor path never uses it |
| `quality-gate.js` + `evidence-runner.js` | `lib/` | 14-gate registry; runs `npm build/test`, `node --check`, health, git status via `spawnSync` (60s, fixed argv) | subagent-stop, quality-gate hook | `constants`, `security-scanner` (enterprise only) | `qualityGates` | Failures recorded, not enforced; runs workspace's own npm scripts inside a hook |
| `phase-commit-gate.js` | `lib/` | `git status --porcelain` at boundaries | subagent-stop | git | handoff text | Advisory message only; git error ⇒ PASS (fail-open) |
| `memory-manager.js` + `semantic-memory.js` + `memory-index.js` | `lib/` | LTM flush/aggregate; BM25-lite keyword scoring (**no embeddings**); inverted index (write-only) | session-start/prompt/subagent-stop | — | `orchestra-memory.json` (100/50/50 caps), `memory-index.json` (500) | `searchMemoryIndex` has 0 callers; index is written but never queried |
| `token-tracker.js` | `lib/` | Budgets (10k/30k/15k/8k, cycle 63k), estimation `ceil(chars/4)` or reported usage | hooks | — | `orchestra-tokens.json` | Estimates dominate; no model attribution |
| `orchestra-enable.js` | `bundle/hooks/` | Operator CLI (14 commands: status/stop/pause/resume/abort/checkpoint/memory/history/tokens/metrics/cycles/...) | human/agent shell | all of the above libs | all state | — |

**Configuration loading:** no env-var framework. Precedence = hardcoded `constants.js` caps → `project.yaml` `orchestra:` profile (`orchestra-config.js`: route, `max_iterations`, `plan_only`, token budgets, phase filter) → runtime state. Env vars used: `PCORE_SESSION_ID`/`OPENCODE_SESSION_ID` (session keying), `PCORE_CONDUCTOR_STATE_DIR`, `PCORE_ORCHESTRA_REPO` (selects script path — finding S-16), `CURSOR_HOME`/`AGENTS_HOME` (install targets).

**Logging:** none as a subsystem — every hook `emit()`s one JSON blob to stdout; failures swallowed (`orchestra-lifecycle.js:80-82` fail-open with no counter). Persistent "logs" = state-file arrays (`lifecycle.events` capped 200, `orchestra-history.json` 50 runs, `cycles/` reports).

**Lifecycle:** session start injects → prompt starts loop → subagentStop advances → stop nudges/heartbeat → completion flush writes 8+ files (no transaction; crash mid-flush leaves partial state). **Shutdown:** process exit after stdout write; no graceful-close concerns. **DI:** none — plain `require()` graph; `orchestra-lib.js` barrel exists but is dead (0 require sites).

---

## 4. Explain the AI Gateway

**Verdict: `DOCUMENTED BUT NOT IMPLEMENTED / NOT PRESENT.`**

Evidence (re-verified directly): `axios|http.request|https.request|node-fetch` in `*.js` → **0 matches**; `fetch(` in hook/scripts `.js` → **0 matches**; `createServer|listen(` → **0 matches**; `require("http|https|net|tls")` in hooks → **0**. The only network code in the repo is **catalog fetch, not inference**: `scripts/update-free-models.sh:41,195` (`curl https://opencode.ai/zen/v1/models`) writing `state/{free-models,model-pools,probes}.json` and rewriting `~/.config/opencode/opencode.json` model pins weekly (systemd `pcore-free-models.timer`). Skill docs mentioning AI gateways (`bundle/skills/cloudflare/references/ai-gateway/*`) are **teaching material for Cloudflare's gateway, not this repo's code**. `scripts/setup-cursor-byok.sh --litellm` generates a launcher for an **external** `litellm` binary — delegation, not a built-in gateway.

| Gateway feature | Status | Evidence |
|---|---|---|
| Supported providers | None in-code; static model *names* in frontmatter/config | `autonomy.json` `"model": "opencode/big-pickle"` |
| Model abstraction / routing | Docs-only (prose model policy) | `.github/copilot-instructions.md`; README "Model Routing" claim |
| Request/response format, structured output, streaming, timeout, retry, fallback, cost tracking | **NOT PRESENT** | zero HTTP code |
| Token/cost tracking | Partial — estimated or host-reported usage, per-agent budgets | `token-tracker.js:14-21,67` |
| Error handling | N/A (no calls) | — |

**Traced AI request (actual):**

```text
Agent (e.g. orchestra-implementer, Cursor/OpenCode)
  → host harness tool call (Cursor Task / OpenCode task)   ← model execution happens HERE,
  → host's own provider stack (outside this repo)              fully outside P-Core Orchestra
  → host returns text
  → hook regex-scopes the text (FIX_REQUIRED|VERIFY_FAIL, end tokens)
  → state updated
```

P-Core Orchestra never sees a model, provider, prompt payload, or response body. It is a **meta-layer around** the harness, not a gateway.

---

## 5. Explain the Agent System

**Definition:** an agent = one Markdown file with YAML frontmatter + a prompt body. No executable agent code exists anywhere (1 code fence in all 165 files: one bash block in `orchestra.md`).

- **Inventory:** 165 files per platform (`bundle/agents/`, `bundle/opencode/agents/`): 5 core (`orchestra` conductor + planner/implementer/verifier/reviewer), 155 numbered specialists across 37 category dirs (`01-idea`…`14-research`, incl. 13 `07-*-team` dirs), 5 `references/` docs. OpenCode mirrors generated by `scripts/sync-opencode-agents.js` (`mode: subagent`, drops `model`, `steps: 500`). **[agents §1-2]**
- **Frontmatter:** `readonly` (planner/verifier/reviewer + 152 specialists; implementer is the writer), `permission` blocks (conductor: `task` allowlist of 43 patterns under `"*": deny`, `bash: allow`, `edit: deny`), `model: composer-2.5` ×151 / `grok-4.6` ×4 (Cursor side only). **`tools:` key = 0 occurrences**; `hidden:` in frontmatter = 0 (hidden-ness comes from `autonomy.json` `agent.*.hidden` on 164/167 entries).
- **Lifecycle:** created per spawn by the host; no persistence, no warm agents, no instance state. "Lifecycle" = phase chain in `constants.js` (`CORE_PHASES` plan→implement→verify→review; `SDLC_PHASES` = **32 enterprise phases** idea→continuous-improvement, only `implementation` writable).
- **System prompt** (conductor `orchestra.md`): decide-first rules → NEVER-STOP golden rule → core vs full-delivery modes → specialist routing table → auto-continue/end-token table (`PLAN_READY`, `IMPLEMENT_DONE`, `VERIFY_PASS|VERIFY_FAIL`, `ORCHESTRA_COMPLETE|FIX_REQUIRED`) → resume rules (max 5 resumes, same `task_id`) → conductor-state CLI usage → read-only conductor rules.
- **Execution loop:** Cursor = hook-driven chaining via `followup_message` prose; OpenCode = conductor sequentially `task`-spawning phases with `conductor-state.sh` bookkeeping. Planning = the planner agent's Markdown plan saved to `.cursor/orchestra-plan.md` + `state/plans/<run>.md` (`plan-artifact.js`, detected via `/\bPLAN_READY\b/i` — flag stored but **never used for gating**).
- **Tool calls / result handling:** delegated entirely to the host; hooks only consume the host's `status` field and the agent's text.
- **Failures/retries:** `FIX_REQUIRED|VERIFY_FAIL` regex → loop back to implement (`handleFixRequired`); iteration cap 8 (core)/16 (enterprise); stall abort after 2×300s; conductor: 3 fix loops + 5 resumes then escalate. **Cancellation:** CLI `stop/pause/abort`, `disable orchestra` prompt phrase, heartbeat abort.
- **Agent-to-agent interaction:** **none directly** — only through `handoff-enforcer.js` (goal + 3-5 plan bullets + last 3 phases/errors, ≤2500 chars) appended to the followup instruction.

**Capability determination (evidence-based):**

| Capability | Supported? | Evidence |
|---|---|---|
| Single agent | Yes | phase chain assigns exactly one agent per phase |
| Multiple agents (sequential) | Yes | plan→implement→verify→review; enterprise 32-phase chain |
| **Parallel agents** | **No** | `Promise.all|parallel|concurrent` in `bundle/hooks/**` = 1 hit (a prose comment in `token-tracker.js:385`); "parallel tracks" exists only as prompt text in `orchestra.md:134,203` |
| Delegation | Yes (prose-level) | conductor `task` allowlist; host spawns |
| Handoff | Yes | `handoff-enforcer.js` (2500-char contract) |
| Persistent agents | No | Markdown templates re-spawned per phase; no instance memory |
| Long-running agents | No | hook `loop_limit`s (12/5) + 8 iterations + stall abort bound every run |

**Registry integrity problem:** five mutually inconsistent agent inventories — doc "35 specialists" vs **155 actual**; 43-pattern conductor allowlist (covers 46/160, omits `market-researcher` which the conductor's own table spawns); 27-name `subagentStop` matcher (133 specialists get no auto-chain); 167 `autonomy.json` entries; agent-selector's claimed "104-agent registry". Plus end-token mismatches: conductor expects `TEAM_SELECTED`/`WORKFLOW_PLAN_READY`, agents emit `AGENTS_SELECTED`/`WORKFLOW_ORCHESTRATED`. **[agents §2, §8]**

---

## 6. Explain Tools

P-Core Orchestra defines no tool-call protocol of its own. Effective tools = host harness tools ∩ permission profiles:

| Tool surface | Classification | Notes / risk |
|---|---|---|
| Host `Task`/`task` spawn, `Edit`/`Write`, `Bash`, `websearch/webfetch` | Execution / Mutation / AI | Conductor: `edit: deny`; implementer: `edit: allow`; OpenCode global `permission["*"]="allow"` |
| `evidence-runner.js` `runCmd` → `npm run build/test --silent`, `node --check` ×40, health, `git status` | Execution (in-hook) | Fixed argv, no `shell:true`, 60s/2MB; executes the **target workspace's** package scripts inside a Cursor hook |
| `security-scanner.js` | Read-only (fs regex) | Enterprise mode only; scans `bundle/hooks/lib` only; `checkOwaspTop10` dead |
| `phase-commit-gate.js` → `git status --porcelain` | Git (read) | Never commits/pushes — commits are **prose-enforced** in `orchestra-implementer.md:59-87` |
| `orchestra-enable.js` / `conductor-state.sh` / `session-claims.sh` CLIs | Mutation (state) | 14 commands; state-only |
| 38/39 skill folders (25 executable scripts: Python/CJS/SH) | Mixed | `turnstile-spin/scripts/worker-deploy.sh` **deploys to Cloudflare**; `ui-ux-pro-max` search scripts; external API calls live here, not in hooks |
| Cursor `cli-autonomy.json` merged to `~/.cursor/cli-config.json` | **Dangerous** | `allow: Shell(**)/Write(**)/Delete(**)/Mcp(*:*)`, `deny: []`, `approvalMode: unrestricted`, `sandbox: disabled` |
| `permissions.json` `terminalAllowlist` (57: `curl`,`wget`,`docker`,`pwsh`...) + `sandbox.json` network `allow` | **Dangerous / conflicting** | Two conflicting sandbox directives shipped in one bundle |
| OpenCode `autonomy.json` bash rules | Guarded | 13 explicit denies (`git push --force`, `rm -rf /`, `dd`, fork bomb); read/edit deny `*.env`, `**/.ssh/**` |

**Tool access control:** declarative JSON permission files only — no runtime enforcement code in this repo (enforcement is the host's). There is no in-repo RBAC, no per-agent tool audit trail.

---

## 7. Explain MCP

| MCP Capability | Implemented? | Location | Purpose |
|---|---|---|---|
| MCP **server** (expose hooks/state/memory) | **NOT PRESENT** | — (0 `@modelcontextprotocol` imports, 0 `createServer`) | Roadmap only: `docs/agent-orchestra-rag-research.md:154` (P4) |
| MCP **tools** (own) | **NOT PRESENT** | — | — |
| MCP **resources/prompts** (own) | **NOT PRESENT** | — | — |
| MCP **transport/auth** (own) | **NOT PRESENT** | — | — |
| OpenCode MCP client config shipped by bundle | **NOT PRESENT** (no `mcp` key) | `bundle/config/opencode/autonomy.json` | Existing user `mcp` only **preserved** on merge (`merge-autonomy-config.js:335,372`) |
| Cursor MCP allowlist (client policy) | Policy only | `bundle/config/cursor/permissions.json:59-69` (context7, supabase, Neon, obsidian...) | Auto-approve user-supplied servers |
| Cursor CLI MCP wildcard | Policy only | `cli-autonomy.json:10` `Mcp(*:*)` | Allow all MCP tools |
| Disable remote MCP (client mgmt) | Implemented (config edit) | `scripts/fix-opencode-response.sh:93-105` | Unhang OpenCode desktop |
| External MCP servers referenced by skills (Cloudflare, n8n, chrome-devtools, Context7) | Docs-only in this repo | `bundle/skills/*/...` | Teaching material for consuming agents |

**How an external AI agent interacts with P-Core Orchestra today (evidence-based):**
- **OpenCode:** full integration — installer sets `default_agent: orchestra` + `permission.task: allow`; conductor drives everything (`install.sh:171-264`).
- **Cursor:** full integration via hooks + project bridge.
- **Claude Code:** **no installer target** (no `.claude/` dir); only `CLAUDE.md`/`AGENTS.md` prose + manual skill symlinks per skill README. No hook wiring, no conductor registration.
- **Codex / Copilot:** docs-only (`templates/AGENTS.authoring.md:125-127`, `.github/copilot-instructions.md`).
- **Any MCP-based client:** cannot connect — there is no MCP server to connect to.
---

## 8. Explain Orchestration

**How a task starts:** prompt classified (`prompt-classifier.js:154` `classifyPrompt` — activation regexes L169-192, route: enterprise/greenfield/complexity/informal→core) → `startOrchestra()` (`state-manager.js:346-400`) sets `active:true, currentPhase:"plan"|enterprise-first, iteration:0` → emitted instruction tells the host to spawn `orchestra-planner`.

**Planning:** planner agent writes a Markdown plan (prose discipline: goal, steps, files, risks, done-when — `orchestra-planner.md:61,82`); `savePlanArtifact` persists it when output matches `PLAN_READY`.

**Agent selection/assignment:** hardcoded phase→agent maps in `constants.js` (`CORE_PHASES` L61-66, `SDLC_PHASES` L71-104) + `phase-engine.getAgentForPhase` (fallback `orchestra-planner`) + spawn syntax from `orchestra-spawn-matrix.js`. Enterprise routing tables live in **prose** (`orchestra.md:104-126`). The `agent-selector`/`project-type-classifier` agents are prompt-only specialists.

**Execution:** strictly sequential, one phase at a time (conductor: "strict order — one task at a time", `orchestra.md:180-191`). **Parallel execution: not implemented** (see §5). **Dependencies:** linear chain only — `buildPhaseChain` (`phase-engine.js:12-31`) gives each phase `nextPhase/prevPhase`; no DAG, no fan-out/fan-in.

**Failures & retries:** reviewer output regex `FIX_REQUIRED|VERIFY_FAIL` → `handleFixRequired` → jump to implement (`orchestra-subagent-stop.js:63-100`); iteration cap; heartbeat stall abort (2×300s); conductor-side: 3 fix loops, 5 resumes. Evidence/commit-gate failures **do not fail the phase** (§15).

**Completion:** `nextPhase === "done"` → flush history/tokens/memory/cycles/version + summary (`orchestra-subagent-stop.js:143-212`). In OpenCode, `complete` CLI call marks run `completed`.

**Actual workflow (as implemented):**

```text
Goal (prompt text)
  ↓ classifyPrompt  [lib/prompt-classifier.js]
startOrchestra     [lib/state-manager.js]  ── writes sessions[sid]
  ↓ (host spawns) orchestra-planner
PLAN_READY?  → saved as plan artifact (advisory flag, never gated)
  ↓ subagentStop: handlePhaseComplete → followup_message
orchestra-implementer  (only writable phase; prose commit gate)
  ↓ subagentStop: preflight evidence (build/test/lint — recorded), commit gate (message)
orchestra-verifier     → applyEvidenceToGates (runs commands; result RECORDED)
  ↓
orchestra-reviewer     → reviewerNeedsFix?  ── YES ──→ back to implementer (fix loop)
  │ NO
done → flush 8 files, record run, active=false
```

Where the system actually *enforces*: (1) host `status==="completed"`, (2) the `FIX_REQUIRED|VERIFY_FAIL` regex, (3) iteration/stall caps. Everything else — plan compliance, evidence gates, commit gate, end tokens — is advisory or decorative **[runtime §6]**.

---

## 9. Explain Engineering Workflow

| Concept | Exists? | Implementation | Notes |
|---|---|---|---|
| Project | Partial | `project-manager.js` (`orchestra-project.json`, ring caps) + `workspace-identity.js` sync from `project.yaml` | Only `addTechDebt`/`generateProjectSummary` wired into hooks; `addEpic/addStory/addTask/addAdr` are library-only (0 hook callers) |
| Goal | Implemented | `state.goal` (`state-manager.js`), CLI `start "<goal>"`, LTM `completed_goals` | One global goal per workspace |
| Epic | Library-only | `project-manager.js addEpic`, `MAX_EPICS=50` | No consumer |
| Ticket | **Missing** (as named) | nearest: `Story` with `acceptanceCriteria` (`project-manager.js:207`) | No ticket symbol in code |
| Task | Library-only | `addTask`, `MAX_TASKS=2000` | No consumer |
| Acceptance Criteria | Partial | field in `project-manager.js`; live loop uses plan's prose "Done when" checked by verifier prompt | Prose discipline, not machine-checked |
| DoneWhen | Prose-only | `orchestra.md:199`, `greenfield-intake.js:239` mentions | No schema field, no evaluator |
| Review | Implemented | `quality-gate.js` + `orchestra-quality-gate.js` hook | Records gates; doesn't block advance |
| Evidence | Partial | `evidence-runner.js` (build/tests/lint/reviewer-approval/docs-updated gates) | Failures recorded, not enforced; `docs-updated` = regex on summary; `memory-updated` self-asserted |
| Artifact | Implemented | `.cursor/orchestra-plan.md` + `state/plans/<run>.md` (`plan-artifact.js`), `cycles/<runId>.json` (`cycle-report.js`), history records | Plan is the only allowed-dirty file |
| Decision | Implemented | `state.memory.decisions[]` (`orchestra-subagent-stop.js:71`) + `addAdr`/`MAX_ADRS=200` (library-only ADR form) | |
| Handoff | Implemented | `handoff-enforcer.js` (2500-char contract: goal + 3-5 bullets + last 3 failures) | |
| Run | Implemented | `conductor-state.js` per-run files + `index.json` + `scripts/conductor-state.sh` (10 subcommands); cycle `run_id`; session claims (`session-claims.sh`, 30-min lease) | OpenCode path only for conductor-runs; Cursor runs tracked in `orchestra-history.json` |
| Worktree | **Absent** (self-declared gap) | zero code; `docs/greenfield-and-gaps.md:72`, `docs/03` Missing-Features P1 "Branch Isolation", progress-tracker P4 | Confirmed: `git worktree list` = 1 entry; no branch/merge/push code |

---

## 10. Explain State Machines

**No formal state-machine library** (no xstate/FSM constructs). State = plain object fields mutated by hook code, with hand-written transition functions.

**Machine A — Cursor run/session state** (`state-manager.js DEFAULT_SESSION_STATE` L17-95):

- States: `currentPhase ∈ {idle, paused} ∪ {plan, implement, verify, review}` (core) or 32 SDLC ids (enterprise); flags `active`, `resumable{paused, pause_reason ∈ {manual, crash_recovery, plan_only, aborted}, checkpoint{...}}`; `loopMode ∈ {core, enterprise}`; `iteration 0..max` (8/16/config).
- Transitions (trigger → site): prompt-activate → `startOrchestra` L346; host `subagentStop`+`completed` → `handlePhaseComplete` advances `state.currentPhase = chain.nextPhase` (`orchestra-subagent-stop.js:135`); `FIX_REQUIRED|VERIFY_FAIL` → implement (L63-100); `plan_only` after plan → `paused` (L104-120); prompt phrase `resume|continue|approve plan` → `resumeOrchestra` (`checkpoint-manager.js:39`); `disable orchestra|orchestra off` → idle (prompt L27-38); ≥2 stalls → `stall_aborted` (`orchestra-heartbeat.js:60-72`); beat/age >600s → crash detection (`checkpoint-manager.js:64`); CLI `stop/abort/pause`; iteration ≥ max → force stop.
- Validation rules: essentially none — no schema checks; `planAwaitingConfirm` is written (`orchestra-subagent-stop.js:105`) but never read (dead flag); `phase` duplicates `currentPhase` (dual-write for back-compat).

**Machine B — OpenCode conductor run** (`conductor-state.js`): `active` → `completed|failed|stalled` (via `beginRun/completeRun/failRun/gcRuns`), `resumeAttempts` per phase key (max 5), idempotent `beginRun`, atomic writes.

**Informal state** (no formal machine): `qualityGates{passed,failed,skipped}`, `heartbeat{last_beat,phase_started_at}`, `tokens`, `planArtifact.plan_ready`, `lifecycle.events`, `memory.*`, session claims JSON, daily planner entries, `orchestra-project.json` backlog fields. Two parallel state systems (**orchestra.json vs conductor-runs/**) that never exchange data — a consistency boundary in itself **[runtime §10]**.

---

## 11. Explain Memory and Context

| What is remembered | Where stored | Who can access | How retrieved | Expiry |
|---|---|---|---|---|
| Active run: goal, phase, iteration, decisions, errors, gates, lifecycle | `~/.cursor/hooks/state/orchestra.json` (installed) | all hooks (same machine) | full-file load per hook | lifecycle events cap 200; **sessions map never pruned** |
| Completed goals, error patterns, frequent files, preferences | `orchestra-memory.json` (100/50/50 caps) | hooks + `orchestra-enable.js memory` | `buildMemoryContext` injected at session start / prompt / implement-iter-1 | caps on write; per-session buckets |
| Keyword index of goals | `memory-index.json` (500) | `memory-manager` writes | **never queried** (`searchMemoryIndex` = 0 callers) | ring 500 |
| Run history | `orchestra-history.json` (50) | CLI `history` | full read | 50 runs |
| Token usage | `orchestra-tokens.json` (100 runs/200 tips) | `tokens` CLI | | caps |
| Project identity | target repo `project.yaml` + `context/` six files | agents (via pointer injection) | `context-detector.js` injects an ordered **file list** — contents are NOT read by hooks; agents must read them | never |
| Plan | `.cursor/orchestra-plan.md` + `state/plans/<runId>.md` | next phase agent (path in handoff) | handoff line | unbounded growth |
| Per-run conductor state | `conductor-runs/<ws>/<sid>/<tid>.json` | conductor CLI | `who/list/resume` | `gcRuns` prunes stale |

- **Conversation history: not stored** — hooks keep no chat transcript; handoff = ≤2500 chars of goal/bullets/failures.
- **Embeddings/vector storage: none.** `semantic-memory.js` is explicitly "BM25-lite... (no embeddings required)" (L28-29): token-overlap ×10 + recency/outcome boosts.
- **Context compression/retrieval:** none beyond caps. Token-tracker gives budget tips only.
- **Context-loss risks (evidence):** (1) corrupt `orchestra.json` → silently reset to defaults = total run+memory loss (finding **S-04 High**); (2) non-atomic multi-file completion flush = partial state on crash; (3) `pid-<pid>` session-id fallback creates a fresh empty session per process when host env vars are absent — prior context orphaned; (4) six-file injection is pointers only — agent may skip reading; (5) handoff truncates to 2500 chars by contract; (6) OpenCode path never writes Cursor LTM and vice versa.

---

## 12. Explain Database / Data Model

**Technology: none (no DB).** Persistence = 13 flat JSON files under `bundle/hooks/state/` (installed `~/.cursor/hooks/state/`) + `conductor-runs/`. No ORM, no migrations (a one-shot legacy `migrateLegacy` in `conductor-state.js` and `migrateToSessions` in `state-manager.js`), no tenant boundaries (single-user, single-machine trust model).

Conceptual "ER" (all relationships by convention, no keys enforced):

```text
orchestra.json
  └─ sessions[sid] ──┬─ lifecycle{events[], phase_history[]}
                     ├─ memory{phases_completed[], files_changed[], errors[], decisions[]}
                     ├─ qualityGates{passed[], failed[], skipped[]}
                     ├─ heartbeat{}, tokens{}, resumable{checkpoint{}}, planArtifact{}
orchestra-memory.json  └─ sessions[sid]{ completed_goals[], error_patterns[], recent_files[] }
orchestra-history.json   [] flat runs (goal, outcome, duration, tokens)
orchestra-tokens.json    └─ sessions[sid]{ runs[], aggregates{}, tips[] }
orchestra-project.json   └─ sessions[sid]{ epics[], milestones[], stories[], tasks[],
                                           backlog[], techDebt[], adrs[], velocity{} }
orchestra-version.json   version, changelog[], releases[]
orchestra-metrics.json   metrics[] ← ALWAYS EMPTY (write path never called)
cycles/<runId>.json      per-run report + index.json (unbounded)
plans/<runId>.md         plan snapshots
conductor-runs/...       run{status, resumeAttempts{}, phases{}} + index.json  (atomic)
```

**Defects (evidence-based):** no primary keys anywhere (arrays with positional identity); no indexes (full-file parse per hook); `files_changed[]` **never populated** → history/top-files/version-gate all downstream-dead (**S-09**-class); duplicated state (`phase` vs `currentPhase`; gates recorded in both `qualityGates` and `evidence_gates`); consistency risk: completion touches 8+ files non-transactionally; unbounded growth in `sessions`, `cycles/index`, plans; non-atomic writes in 7 of ~10 writers (**[security §concurrency]**). Missing audit records: `audit_log: false` default (`project-identity.js:78`).
---

## 13. Explain Jobs and Async Execution

**No queue, no worker pool, no scheduler library, no `schedule:` in CI** (verified in `.github/workflows/`). Inventory:

| Job | Trigger | Queue | Worker | Input | Output | Retry | Failure handling | Persistence |
|---|---|---|---|---|---|---|---|---|
| Hook callbacks (sessionStart, beforeSubmitPrompt 5s, subagentStop ×4 loop 12, stop ×2 loop 5) | IDE events via `bundle/hooks.json` v2 | none | one `node <hook>.js` sync process each | stdin JSON | stdout JSON + state writes | none (host may re-fire events) | fail-open `emit({})` | `state/*.json` |
| `pcore-free-models.{service,timer}` | systemd weekly (`OnCalendar=weekly`) | systemd | bash `update-free-models.sh --refresh --apply` | remote model catalog (15s curl) | rewritten `opencode.json` model pins | single-shot | writes best-effort | `state/free-models.json`, `model-pools.json`, `probes.json` |
| `watch-plan-signal.sh` | manual `--watch/--once` (2s poll) | none | shell poller | `<target>/.pcore/signal-state.txt` | `pending-signal.json` + `signals.log` | none | — | `.pcore/` |
| `session-claims.sh` | invoked by `orchestra-health.js` | none | bash | repo path | claim lease JSON (30-min stale) | none | non-atomic write | `.pcore/session-claims.json` |
| `conductor-state.sh` | manual/LLM CLI | none | bash → node | goal/phase summaries | atomic run JSON + index | JS: 3 retries w/ backoff | `fail` records failed status | `conductor-runs/` |
| GitHub `ci.yml` | PR→main + dispatch | GH Actions | ubuntu | checkout | `node --check` + `shellcheck || true` | GH default | lint-only | artifacts |
| `maintenance.yml`, `org-health-scan.yml`, `stale.yml` | **workflow_dispatch only** | GH Actions | github-script | — | issues/labels | n/a | — | — |

**Classification:** execution is **synchronous, event-driven** (hooks) + **scheduled** (one weekly timer) + **manual CLI**. Nothing is queue-based; nothing runs in the background of the app itself (there is no app process). `daily-planner`, `heartbeat-monitor`, `plan-artifact` are libraries invoked inside hooks, not jobs.

---

## 14. Explain Git / Worktree Integration

**Actual supported surface (all of it):**

| Feature | Status | Evidence |
|---|---|---|
| Read `git status --porcelain` | **Implemented** | `phase-commit-gate.js:13` (15s timeout) and `evidence-runner.js:173` (60s) — the only two git call sites in runtime code |
| Commit | **Prose-enforced only** | `orchestra-implementer.md:43,59-87` "Hard gate — commit before next phase"; verifier prompt dirty-tree ⇒ `VERIFY_FAIL` (`orchestra-verifier.md:26,74,83`). No `git commit` in any code. |
| Branch / merge / push / PR / conflict detection | **Absent** | 0 matches for `git branch|merge|push|gh pr` in `bundle/` + `scripts/` runtime code |
| Worktrees | **Absent** (self-declared P1 gap ×3) | `docs/greenfield-and-gaps.md:72`, `docs/03` Missing Features, progress-tracker P4 |
| Parallel coding agents | **Absent** | §5 |

**Real flow today (substituting for the hypothetical Ticket→Worktree flow):**

```text
Prompt → startOrchestra(goal)          [no ticket entity]
  → planner writes .cursor/orchestra-plan.md   [artifact, not committed — ALLOWED_DIRTY]
  → implementer edits in working tree          [single tree, no isolation]
      prose: "commit before next phase"        [no machine check that it did]
  → subagentStop: phase-commit-gate → git status --porcelain → message in handoff (advisory;
      git missing/error ⇒ reported CLEAN — fail-open, phase-commit-gate.js:51-59)
  → verifier prompt: dirty tree ⇒ VERIFY_FAIL   [LLM judgment, not a hook block]
  → reviewer → done
```

Two concurrent agents would race on **one working tree** — no mechanism prevents it besides session claims (advisory 30-min lease JSON).

---

## 15. Explain Quality and Verification

**Controls that exist:**

| Control | Where | Enforced? |
|---|---|---|
| ~~3 unit/behavior test suites~~ → **17 suites / 554 named checks** | `scripts/test-*.js` | **CLOSED by Phase 3** (`836fe47`): every suite is registered in `.github/workflows/ci.yml` and the secret scan runs as a required step |
| CI syntax lint (`node --check` over all JS, both hook trees) + `shellcheck --severity=error` + blocking secret scan | `.github/workflows/ci.yml` | **CLOSED by Phase 3** (`836fe47`): `\|\| true` removed, shellcheck blocking on errors, `scripts/scan-secrets.js --fail-on=high` is a required step |
| Evidence gates (build, tests, lint, reviewer-approval, docs-updated, memory-updated, +8 enterprise) | `evidence-runner.js`, `quality-gate.js` | **Recorded, NOT enforced** — `handlePhaseComplete` never reads `qualityGates.failed` (**[runtime §6]**) |
| Phase commit gate | `phase-commit-gate.js` | Advisory message; fail-open on git error |
| Reviewer end-token regex (`FIX_REQUIRED|VERIFY_FAIL` → fix loop) | `phase-engine.js:194-203` | **The only enforced quality control** |
| Host `status==="completed"` | `orchestra-subagent-stop.js:305` | The only advance precondition |
| Verifier/reviewer prompt checklists | `orchestra-verifier.md`, `orchestra-reviewer.md` | LLM self-discipline |
| Security scanner (regex secrets/vulns) | `security-scanner.js` | Enterprise mode only; scope = `bundle/hooks/lib` only; `checkOwaspTop10` dead |
| Human review | README claims "Human Checkpoints (auth/payments/security/scope-creep)" | **PARTIALLY closed by Phase 3** (`d0aa26f`): `domain/review-queue.js` derives the pending queue from the event log and the quality-gate hook injects a `## Human review queue` block on blocked/`needs_human`. Still **advisory**: nothing in the loop *creates* a ticket whose `humanReview.required` is true, so the queue is empty until something writes a `review.requested` / `needs_human` event |

**"Agent says completed" vs "System verified completed":**

```text
Agent says completed     → host returns status:"completed"  → phase advances.     ← SUFFICIENT today
System-verified          → evidence gates recorded + end tokens + commit gate    ← NONE of these block
```

Tests actually executed during this audit (**[workflow §2]**): all 3 suites **63/63 PASS, exit 0** (run from a temp copy for the writing suite), health check exit 0, commit-gate probe `clean:true` on the real repo — proving the harness's own tests are green while enforcement gaps remain.

---

## 16. Explain Observability

**What exists (all local JSON):** lifecycle events (cap 200) + per-phase durations (`lifecycle-recorder.js`); run history 50 runs w/ goal/outcome/duration/iterations/tokens (`history-recorder.js`); token accounting vs budgets (`token-tracker.js`, estimates `ceil(chars/4)`); per-run cycle reports (`cycles/<runId>.json`); heartbeat/stall events; health CLI (`orchestra-health.js`); metrics/SLO/incidents **framework** (`observability.js`) whose write functions (`recordMetric`, `defineSlo`, `recordIncident`) have **0 production callers** → `orchestra-metrics.json` always empty → `calculateAvailability` returns **100% vacuously** (finding in **[security §2]**); session claims advisory.

**Operator question answers:**

| Question | Answerable? | How / why not |
|---|---|---|
| What happened? | **Yes (recent)** | `lifecycle.events` (200), history (50), cycles |
| Why did it happen? | Partially | `memory.errors[]`, error patterns in LTM; no stack traces |
| Which agent did it? | Yes | `last_subagent`, `phases_completed`, per-phase timers |
| Which model did it? | **No** | 0 `model_used`/`PCORE_MODEL` hits in hooks — models are invisible to this layer |
| Which tools were used? | **No** | no tool telemetry; `toolsMatrixMarkdown` is static doc |
| What changed (files)? | **No** | `files_changed[]` never populated → history always `[]` |
| How long did it take? | Yes | phase durations + run `duration_ms` |
| Did it actually succeed? | Weakly | outcome recorded from host status + reviewer regex; evidence failures visible only in gate records nobody blocks on; health can never go red |

No traces, no metrics backend, no structured log sink (stdout JSON only), no cross-machine aggregation, hook failures silently swallowed, session ids fall back to `pid-<pid>` (unstable correlation).

---

## 17. Security Audit

**21 findings, 0 Critical (1 High, 13 Medium, 7 Low)** — full table with `file:line` in **[security §1]** + OWASP mapping. No network/auth surface exists in the runtime (hooks are local stdin/stdout), so no remote attack surface; risk is **local integrity, supply chain, and fail-open design**. Summary of the load-bearing findings:

| ID | Sev | Finding (evidence) |
|---|---|---|
| S-04 | **High** | Corrupt/unparsable state JSON silently replaced by defaults → **total state+memory loss without signal** (`state-manager.js` load path) |
| S-05/S-06/S-07 | Med | Non-atomic `writeFileSync` + read-modify-write races on shared state (7 writers); `session-claims.json` non-atomic |
| S-14 | Med | Installer pipes remote script to shell without checksum/signature (`ensure-opencode-latest.sh`, reached by default `install.sh:175` path) |
| S-19 | Med | Integrity gates **fail OPEN**: git-status error → commit gate PASS; tool error → evidence ok — **PARTIALLY closed by Phase 3** (`d05a54f`): the docs-updated gate is diff-derived and FAILS closed with `reason: "git-error"` (only a non-repo yields SKIP). **Still open**: `phase-commit-gate.js:50-56` returns `clean: true` / "skip commit gate" when git is unavailable |
| S-08/S-09/S-10/S-12 | Med | Security scanner gaps: core loop never scans; scope skips dot-dirs/.env; secret regexes miss `PASSWORD=hunter2` dotenv style — **CLOSED by Phase 3** (`de09ddc`: security gate is a CORE_REQUIRED_GATE, dot-dirs + extensionless files are walked, unquoted `KEY=value` secrets are detected) |
| S-16 | Med | `PCORE_ORCHESTRA_REPO` env selects path of a bash script spawned by health |
| S-20 | Med | CI has no secret-scan/SAST; shellcheck non-blocking — **CLOSED by Phase 3** (`836fe47`): `scripts/scan-secrets.js --dir . --fail-on=high` is a required step (exit 1 on high/critical) with documented `.secret-scan-allow` entries, and `shellcheck` no longer has `\|\| true` (blocking at `--severity=error`) |
| S-11/S-13 | Low | `checkOwaspTop10()` was dead code and matched secrets were stored verbatim — **CLOSED by Phase 3** (`de09ddc`): OWASP results are surfaced as advisory categories, and every finding excerpt is redacted + clamped before it is persisted. Other Low findings (S-01/S-02/S-03/S-15/S-17/S-18/S-21) unchanged |
| S-01/S-02/S-03/S-15/S-17/S-18/S-21 | Low | unvalidated scriptName join, unbounded stdin buffer, fail-open parse, dead OWASP check, matched secrets stored verbatim (50 chars), weekly remote config rewrite, no spawn timeout, swallowed errors, Turnstile test-secret echoed by design |
| (from **[agents §5]** and **[security]**) | Med | Permission posture: Cursor CLI profile = `Shell(**)`, `deny: []`, `approvalMode: unrestricted`, `sandbox: disabled`; conflicting sandbox files; terminal allowlist incl. `curl/wget/docker`; prompt-word control plane (`disable orchestra` / bare `continue` short-circuit in `prompt-classifier.js:124,142`) with zero prompt-injection handling |

**Positives:** no committed secrets (repo-wide `sk-`/`ghp_`/`AKIA`/private-key scan = only scanner regexes + Cloudflare public test keys); all hook shell exec is fixed-argv `spawnSync` (no `shell:true`, no string interpolation from prompts); `set -euo pipefail` installers; OpenCode bash deny-list (force-push, `rm -rf /`, `dd`, fork bomb) + env/ssh read-deny.

**RBAC / tenant isolation / authorization: not applicable as implemented** — single-user local tool; there is no authn, no authz beyond the declarative permission JSONs, no audit log (`audit_log: false`).

---

## 18. Test the Actual Workflow

Executed during this audit (observed, not assumed) — details in **[workflow §2]**:

1. `node scripts/test-state-manager-compat.js` → **9/9 PASS**, exit 0 (write-free, run in repo).
2. `node scripts/test-conductor-state.js` → **23/23 PASS**, exit 0.
3. `node scripts/test-adaptive-loop.js` → **30/30 PASS**, exit 0 (run in isolated temp copy because it writes gitignored `state/{plans,cycles,orchestra.json}`).
4. Commit-gate probe `checkPhaseCommitGate({}, {cwd: repo})` → `clean:true, skipped:false, "Phase commit gate PASS"`.
5. Health check `node bundle/hooks/orchestra-health.js` → exit 0 (Windows WARN on bash sub-check, **[workflow C23]**).
6. Prompt classification probe (health-bundled): 6 sample prompts classified activate/skip correctly.

**Representative end-to-end trace** (`create goal → assign → execute → persist → validate → complete`), reconstructed from the executed tests + code reading:

```text
state-manager.startOrchestra(goal)              → sessions[sid]{active:true, currentPhase:"plan"}
phase-engine.getPhaseChain → planner            → chain.plan.nextPhase = "implement"
(plan artifact saved on PLAN_READY)             → state/plans/<runId>.md + .cursor/orchestra-plan.md
"implement complete" (host status completed)    → handlePhaseComplete → currentPhase="implement→verify"
  preflight evidence (node scripts/test-adaptive-loop.js) → gates recorded in qualityGates
  phase-commit-gate → git status → handoff message
verifier completes → applyEvidenceToGates       → qualityGates{...}
reviewer completes, no FIX_REQUIRED             → nextPhase "done" → flush:
  history-recorder (1 new run row) + token-tracker finalize + flushShortToLong (LTM)
  + cycles/<runId>.json + version bump + active:false
conductor path (OpenCode): conductor-state.sh begin → save ×N → complete → run{status:"completed"}
```

Actual files touched per completion: `orchestra.json`, `orchestra-history.json`, `orchestra-tokens.json`, `orchestra-memory.json`, `orchestra-version.json`, `orchestra-daily.json`, `cycles/<runId>.json` + `index.json`, `memory-index.json`, plan files — **9+ writes, no transaction**. Events emitted: `orchestra_start`, `phase_complete`, `phase_advance`, `subagent_complete`, `stall_detected` (200-event ring). A full live Cursor run was **not** executed (requires a host IDE session); everything above is from executed unit tests + traced code paths.

---

## 19. Current Capability Matrix

| Capability | Status | Evidence | Notes |
|---|---|---|---|
| Core Runtime | **Implemented** | 11 hooks + 35 lib modules; 3 suites 63/63 green | Synchronous, fail-open, no locks |
| AI Gateway | **Missing** | 0 fetch/HTTP/provider code **[agents §3]** | Delegated to host harness by design |
| Agents | **Implemented** | 165 md × 2 platforms; 4-phase chain live | Prompt-only; registry conflicts; no parallelism |
| Tools | **Partial** | host permissions + evidence-runner + 25 skill scripts | No tool protocol of its own; dangerous CLI allowlist |
| MCP | **Missing** | no server/tools/resources; policy-only rows **[agents §4]** | Roadmap P4 only |
| Memory | **Partial** | LTM 100/50/50 + BM25-lite + six-file pointers | No embeddings; index write-only; corrupt-state loss (S-04) |
| Orchestration | **Implemented** | Cursor hook chain + OpenCode conductor, both live | Enforcement = 1 regex + host status; sequential only |
| Tasks | **Partial** | Stories/Tasks schema exists (`project-manager.js`) | Library-only; no ticket entity in the live loop |
| Goals | **Implemented** | `state.goal`, LTM `completed_goals`, CLI start | One goal per workspace |
| Worktrees | **Missing** | 0 code; 3 self-declared gap notes | |
| Git | **Partial** | 2 read-only `git status` probes; commits prose-enforced | No branch/merge/PR; gate fails open |
| Quality Gates | **Partial** | 14-gate registry + evidence runner | Recorded, not enforced; 2 self-asserted gates |
| Evidence | **Partial** | `evidence-runner.js`, plan/cycle artifacts | Failures advisory; `files_changed` dead |
| Human Review | **Missing** | README claim, no code; `needs_human` never produced | |
| Artifacts | **Implemented** | plan md + plans/ + cycles/ + history | |
| Decisions | **Partial** | `memory.decisions[]` live; ADR store library-only | |
| Handoffs | **Implemented** | `handoff-enforcer.js` 2500-char contract | |
| Observability | **Partial** | lifecycle/history/tokens/cycles local JSON | Metrics empty; no model/tool/file telemetry |
| RBAC | **Missing** | permission JSONs only; single-user trust model | |
| Audit | **Partial** | lifecycle ring (200) + cycles | `audit_log: false`; secrets stored verbatim in findings |
---

## 20. DoneWhen Comparison

Reference workflow: `Triage → Aligning → Ready → In Progress → In Review → Done`, with Epic/Ticket/Acceptance Criteria/Tests/Artifacts/Decisions/History/Agent Claim/Handoff/Worktree/Human Review/Goal-based execution.

### Already exists in P-Core

- **Goal-based execution** — the native organizing primitive (`state.goal`, ambient activation, one goal/workspace). Stronger than DoneWhen's ticket-first framing for chat-driven work.
- **Agent Handoff** — `handoff-enforcer.js` (compact, bounded, tested) — genuinely good; keep as-is.
- **Artifacts** — plan md + per-run cycle reports + history = a real evidence trail.
- **Run** — `conductor-state.sh` per-run isolation + registry + resume attempts is the most production-grade piece of state code in the repo (atomic, idempotent, GC).
- **Review phase** — reviewer agent + gate records + `FIX_REQUIRED` loop (the only enforced gate).
- **Implementation History (partial)** — `lifecycle.events`, `orchestra-history.json`, decisions array.
- **Checkpoint/Resume** — pause/resume/abort/crash-recovery with saved phase context.

### Partially exists

- **Ticket** → Story/Task schemas exist but are unwired (library-only `project-manager.js`). No ID, no status flow in the live loop.
- **Acceptance Criteria** → stored on stories (unused) + plan "Done when" prose (used, but unenforced).
- **Tests as completion criterion** → evidence runner executes them but failures don't block; CI doesn't run them at all.
- **Engineering Decisions** → decisions array live; formal ADR store (`addAdr`, cap 200) unwired.
- **Human Review** → claimed in README, absent in code.
- **Evidence** → collected but not required for "Done" (completion = reviewer regex + host status).

### Missing

- **Triage / Aligning / Ready states** (no pre-work states at all — a prompt either starts or doesn't).
- **In Review as a distinct state** (review is a phase, not a workflow state with a human assignee).
- **Ticket/Epic lifecycle, IDs, links** in the live loop.
- **Agent Claim** — closest = `session-claims.sh` (advisory 30-min lease, non-atomic) — not integrated with task assignment.
- **Git Worktree / branch isolation / parallel agents.**
- **A machine-checked Definition of Done** (DoneWhen's core idea).

### Better implemented elsewhere in P-Core

- **Run persistence**: `conductor-state.js` (this repo) beats every other P-Core repo's state handling — this is the pattern to generalize.
- **Multi-service AI consumers / bridge auth / DB**: pcore-brain + pcore-n8n-bridge already solve API-shaped concerns P-Core Orchestra doesn't have (no gateway needed here — see §4).
- **Server ops/monitoring**: pcore-monitor owns metrics/uptime; P-Core Orchestra should not grow its own metrics backend (its `observability.js` is a dead-end — either wire it or delete it).
- **Project memory across a monorepo**: workspace-level context hygiene already lives in each repo's six-file `context/` + `progress-tracker.md` — orchestrated from here but owned there.

### Should belong in Orchestra

- Phase/run state machine + enforcement (gates that actually block), handoff, run registry, evidence recording, agent spawn matrix, memory flush.
- Worktree-per-run and claim/handoff integration (when built).
- Done-when evaluator (structured, checked by verifier, not prose).

### Should belong in P-Core Core (shared repo / per-repo context layer)

- Six-file context methodology, `project.yaml` identity, `AGENTS.md` entry, progress-tracker — already there; Orchestra should **consume** them (it does, via pointer injection).
- Any future DB/embedding store shared across P-Core repos (pcore-brain memory schema is the natural home).

### Should belong in a future Studio/UI

- Triage/Aligning/Ready board, ticket CRUD, human-review queue, live run dashboard over `conductor-runs/index.json` + `orchestra-history.json`, gate/evidence visualizer, token/cost dashboards.

---

## 21. Identify Architectural Gaps (prioritized)

**P0-1 — Quality gates don't gate.**
- Problem: phase advance requires only host `status==="completed"`; evidence failures, dirty trees, missing end tokens never block.
- Why it matters: the product's core promise ("verified completion") is unenforced; an agent can claim done and the loop celebrates.
- Current behavior: `handlePhaseComplete` ignores `qualityGates.failed`; `plan_ready` flag written, never read; end tokens regex-scored into records only.
- Evidence: **[runtime §6]**, `orchestra-subagent-stop.js:132-298`, `phase-engine.js:194-203`.
- Recommended abstraction: a single `evaluatePhaseOutcome()` that returns `ADVANCE | FIX | BLOCK` from (host status ∩ required gates ∩ token ∩ commit gate), consumed by `handlePhaseComplete`.
- Affected: `orchestra-subagent-stop.js`, `quality-gate.js`, `evidence-runner.js`, `phase-commit-gate.js`. Complexity: **low-medium** (data exists; wiring + tests).

**P0-2 — State corruption / lost updates (S-04/S-05/S-06).**
- Problem: silent reset of corrupt state; non-atomic RMW across 7 writers; no locks.
- Why it matters: total memory/run loss + racing hooks clobber each other — unreliable completion at the data layer.
- Evidence: **[security]**; contrast correct pattern already in-repo (`conductor-state.js:90-109` atomicWrite, `daily-planner.js:70-89`).
- Recommended: shared `atomic-write + backup-on-parse-failure + file lock` helper; migrate all writers; corrupt file → quarantine, not reset.
- Affected: all `lib/*` writers. Complexity: **medium** (mechanical, high test value).

**P1-1 — No ticket/epic/task entity in the live loop.**
- Problem: work items exist only as free-text goals; schemas (`project-manager.js`) unwired.
- Why it matters: DoneWhen-style Triage→Done, acceptance criteria, and human review need a durable work item with ID/status.
- Recommended: minimal `WorkItem{id, goal, ac[], status, run_ids[], files}` persisted per workspace; planner creates it; loop advances *its* status through a real state machine.
- Affected: new small lib + `state-manager` + planner/verifier prompts. Complexity: **medium**.

**P1-2 — No worktree/branch isolation → no safe parallel agents.**
- Problem: single working tree; sessions-claims advisory; parallelism prose-only.
- Why it matters: multi-agent (P5) and safe human+agent co-work both blocked.
- Recommended: `git worktree add` per run under `.pcore/worktrees/<run>`, claim = worktree ownership record; sequential-first (don't build parallel until P0 gates exist).
- Affected: new `lib/worktree.js`, implementer prompt, verifier cwd. Complexity: **high** (Windows+CI+host tooling interactions).

**P1-3 — Enforcement depends on prose compliance across two hosts.**
- Problem: spawn, chain, and completion are LLM instructions; Cursor and OpenCode run *different* engines (hooks vs conductor) with different caps (8 vs 500 steps, 12 vs 3 fix loops).
- Why it matters: behavior drifts per host/model; hooks can't enforce what the conductor enforces and vice versa.
- Recommended: converge on the conductor-state run registry as the single source of truth; make Cursor hooks thin adapters over the same `run` API; codify the phase contract (entry/exit conditions) in one module both consume.
- Affected: `conductor-state.js`, `state-manager.js`, `bundle/hooks.json`, `orchestra.md`. Complexity: **medium-high**, phased.

**P1-4 — Registry fragmentation (43/27/167/155/104 inventories).**
- Problem: conductor allowlist, hook matcher, config, docs, agent-selector all disagree; end-token mismatches (`TEAM_SELECTED` vs `AGENTS_SELECTED`).
- Why it matters: spawned agents silently unchained (133 specialists bypass `subagentStop`); corporate tier partially broken.
- Recommended: one generated registry (agents dir → JSON) consumed by matcher/allowlist/docs; CI drift check.
- Affected: `hooks.json`, `orchestra.md`, `autonomy.json`, new `scripts/gen-agent-registry.js`. Complexity: **low-medium**.

**P2-1 — Observability dead-ends**: empty metrics, no model/tool/file telemetry, `files_changed` never populated, health can't go red. Wire `recordMetric` + populate `files_changed` (or delete both claims).
**P2-2 — MCP server for external agents** (Claude Code/Codex access): expose run/status/gate tools — but only after P0 gates exist, otherwise MCP exposes an unreliable loop.
**P2-3 — Human review checkpoint** (auth/payments/security): a `needs_human` state the loop actually enters and waits on (today the status string exists only in prose).
**P2-4 — Docs drift** (phantom files, stale counts, "judge passes", "6 hooks"): make doc-sync a CI check (counts + referenced paths exist).
**P3-1 — Embeddings/memory upgrade** (BM25-lite → hybrid) — only with real usage data.
**P3-2 — Studio/UI** over run registry + history.
**P3-3 — Parallel multi-agent DAG execution** — gated on P0-1/P1-2.

---

## 22. Identify Architectural Risks

| Risk | Evidence | Impact |
|---|---|---|
| **Unreliable completion** (the flagship risk) | One regex + host status as gates; evidence/commit advisory **[runtime §6]** | False "done" erodes trust; downstream repos (per AGENTS.md workflow) rely on VERIFY_PASS |
| **State inconsistency** | 9+ non-transactional writes/completion; 2 parallel state systems; non-atomic writers | Lost runs/memory; half-flushed completions |
| **Context loss** | S-04 silent reset; pid-fallback sessions; 2500-char handoff; pointer-only six-file injection | Runs resume into amnesia |
| **Over-coupling to host prose** | Spawning/chaining = emitted instructions; Cursor vs OpenCode divergence | Behavior changes with host/model upgrade, invisible to tests |
| **Agent hallucination surface** | Self-asserted gates (`memory-updated`), regex-scored docs gate, prose commit gate | Agents can satisfy "verification" without doing work |
| **Unsafe tool execution posture** | `Shell(**)`/`deny:[]`/`sandbox disabled` CLI profile; `curl\|bash` install fallback; weekly unattended config rewrite from unpinned endpoint | Supply-chain + local escalation (S-14, **[agents §5]**) |
| **Race conditions** | 6 hook processes/turn RMW same file; no locks (S-05/S-06) | Lost updates under any concurrency |
| **Poor observability** | Dead metrics, no model/tool attribution, swallowed hook errors | Incidents undiagnosable; health green by construction |
| **Duplicated abstractions** | 2 state engines, 2 agent trees (sync via script), 3 hook mirrors (bundle/opencode byte-copies), 5 agent registries, conflicting sandbox configs | Double maintenance; drift already observed |
| **Unclear ownership / doc drift** | Phantom docs (`setup-guide.md` etc.), stale counts (11 vs 35 modules), README "judge" | New contributors misled; audit-worthy claims untrue |
| **Premature abstraction** | 32-phase enterprise chain + 155 stub agents (many 22-line templates) + dead modules (`devops.js`, `self-improvement.js`, `orchestra-lib.js`, ~15 dead exports) + G1-G8 gates that don't exist | Complexity budget spent on unwired surfaces |
| **Vendor lock-in** | Frontmatter/model policy assumes Cursor `composer-2.5` + OpenCode free pools; hooks target Cursor's specific event schema | Host API changes break the loop (OpenCode hooks already inert) |
| **Insufficient isolation** | Single working tree; single-user trust; no RBAC | Blocks multi-agent and any multi-user future |
| **No security scanning in core loop** | Scanner enterprise-only, lib-dir-only, regex gaps (S-08..S-12) | Core-loop users get zero security gating |
---

## 23. Produce the Final Architecture

### CURRENT (as-built, summarized)

```text
Cursor:  Prompt ─hooks→ classifier/state ─prose→ Host LLM ─spawns→ phase agent ─prose→ next phase
                                                                    │
OpenCode: default_agent conductor ──task spawns──→ phase agents      │
              └── conductor-state.sh (atomic per-run JSON)          ▼
                                        13 JSON state files (non-atomic, unlocked, fail-open)
                                        evidence gates: recorded, not enforced
                                        AI gateway / MCP / DB / worktrees / parallelism: ABSENT
```

### PROPOSED — P-Core Orchestra v1

Preserves: hook entry points, phase chain, handoff contract, plan/cycle artifacts, conductor-state run registry, six-file context consumption, spawn matrix, installers, 4-phase core loop + optional enterprise inserts.

```text
                     ┌────────────────────────────────────────────────┐
                     │              Run Contract (single module)       │
                     │  beginRun → phase states → evaluateOutcome()    │
                     │  → ADVANCE | FIX | BLOCK(needs_human) → complete│
                     └───────────────┬────────────────────────────────┘
   Host events ──adapters────────────┤                ▲
   (Cursor hooks / OpenCode          ▼                │ gates: tests, lint,
    conductor prompt)        ┌──────────────┐   commit-dirty, done-when,
                             │ Run Store    │   end-token — ALL blocking
                             │ (atomic,     │──────────────────────────┘
                             │  locked,     │
                             │  quarantined)│──→ WorkItem {id, goal, ac[], status,
                             └──────┬───────┘        run_ids[], files_changed[]}
                                    │                 status: triage→ready→in_progress
                              artifacts: plan,        →in_review→done | needs_human
                              cycles, history,
                              evidence records
                                    │
              Worktree layer (v1.x): one `git worktree` per run, claim = ownership
                                    │
   AI execution: REMAINS in host harness (no gateway) · MCP server (read-mostly:
   run/status/gates/history tools) exposes the loop to Claude Code/Codex/Studio
```

Key principles: (1) **one run contract** both hosts adapt to; (2) **gates block** — completion is evaluated, not announced; (3) **work item** replaces free-text goal as the durable unit (goal stays as its human-readable field); (4) **no AI gateway** (delegation is correct); (5) Studio/UI reads the run store, never the hooks.

---

## 24. Recommended Repository Evolution

```text
CURRENT STRUCTURE                          PROPOSED STRUCTURE
bundle/hooks/ (11 + lib 35, mixed)   ──►   src/runtime/          hook entry adapters (thin)
bundle/hooks/lib/ (35, 3 dead)       ──►   src/run/              run contract, phase eval, gates
                                             src/store/           atomic JSON store + quarantine
                                             src/workitem/        work item + status machine
                                             src/memory/          LTM, handoff, context injection
                                             src/evidence/        evidence-runner, commit gate
                                             src/registry/        generated agent registry (NEW)
bundle/agents + bundle/opencode/agents ─►  agents/ (single source, generated per-host frontmatter)
bundle/opencode/hooks/ (byte mirror)  ──►  DELETE mirror; install-time transform only
bundle/skills/, skills-cursor/, rules, config/  ──►  keep as-is (payload, low churn)
scripts/ (31)                          ──►  scripts/ keep + gen-agent-registry.js, migrate-state.js
docs/ (stale/phantom)                  ──►  docs/ + CI doc-drift check; audit/ kept as evidence
(no src/tests)                         ──►  tests/ (move the 3 suites; add gate-enforcement tests)
```

**Migration steps:** (1) introduce `src/store` atomic helper, migrate writers, keep file paths stable (no data migration needed); (2) extract run contract from `orchestra-subagent-stop.js` + `conductor-state.js` behind one API, adapters first, behavior parity tests from existing 63 checks; (3) generate agent registry from `agents/`, derive `hooks.json` matcher + conductor allowlist, CI diff; (4) delete dead code (`orchestra-lib.js`, `devops.js`, `self-improvement.js`, dead exports) — note ADR-012-style constraints: prefer gating over deleting user-visible behaviors (quality-gate hook stays); (5) fold `bundle/opencode/hooks` mirror into install transform; (6) worktree layer only after (2). Every proposed package has a named consumer; nothing exists "for organization".

---

## 25. Implementation Roadmap

### Phase 0 — Stabilize
- **Features:** atomic+locking store with corrupt-file quarantine (P0-2); fix `files_changed` population or remove its consumers; wire `recordMetric` or delete availability claim; kill dead modules/exports; end-token + allowlist registry consistency fix (`AGENTS_SELECTED`/`WORKFLOW_ORCHESTRATED` alignment); fix installer findings S-14/S-16; restore BOM/encoding + remove stray `D??...` artifact dir; doc-drift CI check (phantom paths, module counts).
- **Files:** `lib/state-manager.js`, `lib/{observability,memory-manager,history-recorder,cycle-report,version-manager,daily-planner}.js`, `bundle/hooks.json`, `orchestra.md`, `install.sh`, `scripts/ensure-opencode-latest.sh`, `docs/01,03,04`.
- **Dependencies:** none. **Outcome:** state can no longer silently vanish; docs tell the truth. **Acceptance:** corrupt-state fixture → quarantined + run preserved; 7 writers atomic; CI fails on phantom doc path; existing 63 checks still green.

### Phase 1 — Core orchestration
- **Features:** `evaluatePhaseOutcome()` enforcing gates (P0-1); needs_human BLOCK state; commit gate blocking (fail-closed on git error); plan_ready token actually checked; single run-contract module consumed by both Cursor subagent-stop and conductor CLI (P1-3 v1).
- **Files:** new `src/run/` (or `lib/run-contract.js`), `orchestra-subagent-stop.js`, `quality-gate.js`, `evidence-runner.js`, `phase-commit-gate.js`, `orchestra.md`, `conductor-state.sh`.
- **Dependencies:** Phase 0 store. **Outcome:** "system verified completion" is real. **Acceptance:** failing `npm test` ⇒ phase BLOCKED/FIX (new tests prove it); missing `PLAN_READY` blocks implement; parity tests across both hosts.

### Phase 2 — Engineering state
- **Features:** WorkItem entity + Triage→Ready→In Progress→In Review→Done (+needs_human) status machine; acceptance-criteria field enforced at verify; wire existing `addEpic/addStory` schemas into it instead of new parallel schemas; agent claims upgrade (`session-claims` → atomic, keyed by WorkItem).
- **Files:** `lib/workitem.js` (new), `project-manager.js` (wire), `state-manager.js`, planner/verifier prompts, `session-claims.sh`.
- **Dependencies:** Phase 1. **Outcome:** DoneWhen-shaped states exist as data, not prose. **Acceptance:** end-to-end test: create item → run → done-when checked → status transition persisted; AC missing ⇒ verify fails.

### Phase 3 — Evidence and verification
- **Features:** structured evidence records (command, exit code, duration, output excerpt) attached to run; docs-updated gate reads real diff (not summary regex); security scan in core loop (fix S-08..S-12); CI runs the 3+ suites (fix C10) + secret scan (S-20); human-review queue surfaced on needs_human.
- **Files:** `evidence-runner.js`, `security-scanner.js`, `.github/workflows/ci.yml`, plan/cycle reporters.
- **Dependencies:** Phases 1-2. **Outcome:** success is provable, auditable. **Acceptance:** completion record embeds evidence; CI blocks merge on test/secret failures.
- **Status (2026-10-02): DELIVERED.** Evidence records + durable runs `9249073`/`f911dc6`, hook-attached records `b01323b`, diff-derived docs gate `d05a54f`, security core loop + scanner hardening `de09ddc`, review queue `d0aa26f`, state-dir relocation `28fe67c`, CI suites + blocking secret scan `836fe47`, doc sync this commit. Closes S-08, S-09, S-10, S-11, S-12, S-13, S-20 and C10; **partially** closes S-19 (`phase-commit-gate.js` still skips on git error) and human review (the queue is derived and surfaced, but nothing yet creates a `humanReview.required` ticket).

### Phase 4 — Context and project memory
- **Features:** handoff includes work-item context + evidence digest (replaces bare bullets where needed); six-file pointer → verifier actually reads/validates critical context (progress-tracker touched when claimed); memory retrieval wired (`searchMemoryIndex` used or removed); hybrid retrieval upgrade only if usage warrants (P3-1).
- **Files:** `handoff-enforcer.js`, `memory-manager.js`, `memory-index.js`, `semantic-memory.js`, `context-detector.js`.
- **Dependencies:** Phase 2. **Outcome:** no silent amnesia across sessions. **Acceptance:** resume-after-crash test passes with full context; memory query path covered by tests.

### Phase 5 — Multi-agent execution
- **Features:** git worktree per run (P1-2) + claim=ownership; parallel phase execution where the registry proves independence; host-agnostic spawn adapter (Claude Code/Codex targets); MCP read-only server exposing run/status/gates/history (P2-2).
- **Files:** new `src/worktree/`, `registry/`, `mcp/`; `install.sh` new targets.
- **Dependencies:** Phases 1-3 (gates MUST block before parallelism exists). **Outcome:** safe parallel agents + external-agent access. **Acceptance:** two runs on one repo touch disjoint trees; MCP client reads a completed run's evidence.

### Phase 6 — Studio/UI
- **Features:** board over WorkItems (Triage→Done), live run viewer (`conductor-runs/index.json` + history), gate/evidence visualizer, human-review inbox, token/cost charts (from `orchestra-tokens.json`).
- **Files:** new `studio/` (separate app; reads run store read-only — no new coupling into hooks).
- **Dependencies:** Phases 2-3. **Outcome:** operators answer "what happened / did it succeed" visually. **Acceptance:** UI reflects a real run without parsing hooks' stdout.

---

## 26. Final Executive Summary

### What P-Core Orchestra is today

A **local, hook-based orchestration meta-layer** for AI coding agents in Cursor IDE and OpenCode CLI: 11 Node hook scripts + a 35-module library + 165 Markdown agent prompt templates per platform + 38 skills + shell CLIs, installed into `~/.cursor` and `~/.config/opencode`. It classifies prompts, chains a plan→implement→verify→review loop by emitting instructions to the host LLM, records state in ~13 flat JSON files, and offers long-term memory, token budgets, checkpoints, and plan/cycle artifacts. It is **not** a server, has **no** API/database/queue/MCP/AI-gateway, and executes **no** model calls itself — model work belongs entirely to the host harness.

### What actually works

Ambient activation and classification (`prompt-classifier.js`); the 4-phase chain with fix-loop on `FIX_REQUIRED|VERIFY_FAIL`; the conductor path with atomic per-run state, resume attempts, and GC (`conductor-state.js` — the best-engineered component); checkpoint/pause/resume/crash recovery; handoff enforcement (2500 chars); plan and cycle artifacts; LTM flush with caps; token budgets/estimates; heartbeat stall-abort (2×300s); the operator CLI (14 commands); installers + project bridge; the repo's own 3 test suites (**63/63 pass, executed during this audit**); evidence *collection* (build/test/lint commands really run via `spawnSync`); the six-file context pointer injection.

### What is incomplete

Quality gates **record but never block** (P0-1); state writes are non-atomic/locking-free with silent corrupt-reset (P0-2, High); `files_changed` and metrics never populated (observability can't go red); work-item/epic/task schemas exist but are unwired; human review claimed but absent; commit gate advisory + fail-open; security scanner enterprise-only with regex gaps; `bundle/opencode/hooks` mirror inert; ~3 dead modules + ~15 dead exports; CI doesn't run the tests; docs contain phantom files and stale counts; 43/27/167/155 agent inventories disagree; two conductor end-tokens mismatch their agents.

### Biggest architectural gaps

1. **Completion is asserted, not verified** — the entire value proposition rests on one regex plus the host's `status` field.
2. **State integrity** — lost updates and silent resets undermine memory and resume.
3. **No durable work item** — no Ticket/Epic/AC lifecycle, so DoneWhen-style states have nothing to attach to.
4. **No isolation (worktrees) and no parallelism** — single working tree caps the system at one sequential agent.
5. **Dual-host divergence** — hooks (Cursor) vs conductor (OpenCode) are two engines over two state systems; 133 specialist agents never auto-chain.

### What should NOT be built yet

AI gateway/model router (delegation is correct); own database or metrics backend (pcore-monitor/local JSON suffice); embeddings store; MCP server before gates block (it would expose an unreliable loop); Studio/UI before WorkItems + evidence exist; parallel/DAG execution before Phase 1 enforcement; more agent prompt templates (165 already, many 22-line stubs).

### What should be built next

Phase 0 + Phase 1 immediately: **atomic/quarantining state store** and **blocking phase-outcome evaluation** (`ADVANCE|FIX|BLOCK`), plus registry generation to fix the 43/27/167/155 drift. These are small, testable changes to existing modules (`state-manager.js`, `orchestra-subagent-stop.js`, `quality-gate.js`) that convert the existing advisory machinery into enforcement — no rewrite required.

### How DoneWhen-inspired concepts fit

P-Core already owns the **execution** end of DoneWhen (goal-based runs, handoff, review phase, artifacts, run registry, checkpoint/resume) — often well. DoneWhen's missing 60% is the **pre-work and proof** half: Triage/Aligning/Ready states, a real Ticket with acceptance criteria, machine-checked Done, human review, and claim/worktree isolation. Those map onto existing unwired P-Core schemas (`project-manager.js` stories/AC, `session-claims.sh`, README's phantom human checkpoints) rather than requiring greenfield design — adopt the *states and the Definition-of-Done enforcement*, not a foreign framework.

### Recommended P-Core Orchestra v1

**One run contract, one atomic run/work-item store, gates that block, both hosts as thin adapters.** Keep: hooks, phase chain, handoff, artifacts, conductor-state pattern, six-file consumption, host-delegated AI execution. Fix: enforcement (P0-1), state integrity (P0-2), registry drift (P1-4). Add: WorkItem status machine (Phase 2), evidence-backed Done (Phase 3), then worktrees/parallel/MCP (Phase 5), Studio reading the store (Phase 6). Explicitly exclude: AI gateway, own DB, premature parallelism.

### Long-term P-Core vision

P-Core Orchestra becomes the **verified execution spine of the P-Core org**: any repo's `AGENTS.md` + six-file context + `project.yaml` declares *what* a project is; Orchestra supplies *how work runs* (plan→execute→verify→review with blocking evidence) across hosts (Cursor, OpenCode, Claude Code/Codex via MCP) and eventually across repos (workspace/program level), while P-Core Core owns identity/context methodology, pcore-brain owns shared AI/memory infrastructure, and Studio owns human-facing triage/review/dashboards. The differentiator is **evidence-based completion** — a run is Done only when the system, not the agent, says so — which is precisely the gap this audit shows must be closed first.

---

*End of master report. Line-level evidence for every section lives in the four companion files in `docs/audit/`. Audit mode was read-only: no source files were modified; test suites were executed from a temp copy where they write state.*
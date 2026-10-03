# Phase 5 — Multi-agent Execution: Implementation Plan

## Goal
Enable safe concurrent orchestration runs via git worktrees, parallel phase execution for independent phases, host-agnostic spawn adapter for Cursor/OpenCode/Claude Code/Codex, and an MCP read-only server exposing run/status/gates/history.

---

## Context alignment
- **Scope boundary (IN Phase 5):** Git worktree isolation per run, claim=ownership model, parallel phase execution where registry proves independence, spawn abstraction layer (`spawn-adapter.js`), MCP read-only server (`@modelcontextprotocol/sdk`), install targets for new components.
- **Scope boundary (DEFERRED to Phase 6):** Studio/UI dashboard, DAG-based multi-agent scheduling, human-review inbox UI, token/cost visualization.
- **Architecture invariants respected:**
  - Invariant 15: Atomic state writes via `safe-write.js` — new worktree/registry/mcp modules use it
  - Invariant 18: Mirror sync — all new `bundle/hooks/**` files duplicated to `bundle/opencode/hooks/**`
  - Invariant 19: Domain fail-open — MCP server is read-only, never mutates domain state
  - Invariant 21: Evidence records immutable — MCP exposes existing records, doesn't create them
  - Invariant 22: Docs-updated diff-derived — worktree runs get correct diff base via `recordRunDiffBase`
  - Invariant 25: Human-review queue producer — MCP exposes queue, doesn't replace it
  - Invariant 26: Handoff evidence digest — worktree isolation ensures evidence belongs to correct run
  - Invariant 27: Six-file validation — worktree root passed to validator
  - Invariant 28: Memory retrieval — worktree-aware session state
  - Invariant 29: Progress-tracker claim — worktree isolation prevents cross-run contamination

---

## Approach (ordered tasks)

### Task 1: Worktree Infrastructure (`src/worktree/`)
**Prerequisite:** Fix `detectWorkspaceRoot` to be worktree-aware (currently returns project root)
- Create `bundle/hooks/lib/worktree.js` with:
  - `createWorktree(runId, baseCommit)` → `git worktree add .pcore/worktrees/<runId> <baseCommit>`
  - `removeWorktree(runId)` → `git worktree remove --force`
  - `getWorktreePath(runId)` → absolute path
  - `listWorktrees()` → array of `{runId, path, head, locked}`
  - `claimWorktree(runId, sessionId)` → writes `.pcore/worktree-claims.json` (atomic via safe-write)
- Create `scripts/test-worktree.js` (RED first): tests for create/remove/list/claim, cleanup on failure
- Update `evidence-runner.js:detectWorkspaceRoot` to resolve worktree root from `state.worktree.path` when present
- Update `recordRunDiffBase` to record `state.worktree = { path, baseCommit, createdAt }`
- Update `orchestra-subagent-stop.js` and `orchestra-quality-gate.js` to pass `cwd: state.worktree?.path` to evidence runner

### Task 2: Domain Store Partitioning (run-isolated domain events)
**Prerequisite:** Current `domain-events.json` is global ring-cap 500; `review-queue.pendingReview()` keys by `entityId = sessionId`
- Modify `bundle/hooks/lib/domain/store.js`:
  - Add `runId` parameter to `appendEvent`, `loadEvents`, `saveCheckpoint`, `loadCheckpoint`
  - Store per-run: `<stateDir>/domain-events/<runId>.json` (ring-cap per run)
  - Keep global index `<stateDir>/domain-runs-index.json` mapping `runId → {sessionId, startedAt, status}`
  - `loadEvents(runId)` returns that run's events; no runId → all (for CLI tooling)
- Modify `review-queue.js`: `pendingReview(runId)` filters by run; `formatQueue` unchanged
- Create `scripts/test-domain-run-partition.js` (RED first): concurrent runs don't collide on queue

### Task 3: Registry Independence Analysis (`src/registry/`)
**Prerequisite:** Agent registry exists (`bundle/agent-registry.json`); need independence proof
- Create `bundle/hooks/lib/registry/phase-independence.js`:
  - `buildPhaseGraph(loopMode)` → DAG from `phase-engine.js` chains
  - `proveIndependent(phaseA, phaseB, registry)` → true if no shared state/write sets
  - Write sets derived from agent `readonly` frontmatter + known file patterns
  - Export `INDEPENDENT_PHASE_PAIRS` for core/enterprise modes
- Create `scripts/test-phase-independence.js` (RED first): asserts known independent pairs (e.g., `plan` || `analysis` in enterprise; `verify` || `documentation` in enterprise)
- Update `orchestra.md` conductor prompt with parallel-spawn instructions for proven-independent phases

### Task 4: Host-Agnostic Spawn Adapter (`src/spawn/`)
**Prerequisite:** Current hooks emit prose `followup_message` instructing host to spawn; no abstraction
- Create `bundle/hooks/lib/spawn/spawn-adapter.js`:
  - Interface: `spawn(agentId, input, options) → Promise<{status, output, tokens}>`
  - Implementations: `CursorSpawnAdapter` (uses `Task` tool via emitted instruction — *prose fallback*), `OpenCodeSpawnAdapter` (calls `task` tool via conductor), `ClaudeCodeSpawnAdapter` (MCP `tools/call` when server available), `CodexSpawnAdapter` (future)
  - Factory `getSpawnAdapter(host)` detects host from `process.env.CURSOR_HOME` / `OPENCODE_CONFIG_DIR` / `CLAUDE_CODE_ENTRYPOINT`
  - All adapters emit standardized `RunResult` shape
- Create `scripts/test-spawn-adapter.js` (RED first): factory returns correct adapter; adapters implement interface

### Task 5: MCP Read-Only Server (`src/mcp/`)
**Prerequisite:** First npm dependency in hooks (`@modelcontextprotocol/sdk` latest stable)
- Add `@modelcontextprotocol/sdk` to `package.json` (devDependency for now; install.sh copies to `~/.cursor/hooks/node_modules` or documents global install)
- Create `bundle/hooks/lib/mcp/server.js`:
  - Resources: `orchestra://runs/{runId}`, `orchestra://runs/{runId}/evidence`, `orchestra://runs/{runId}/gates`, `orchestra://runs/{runId}/history`, `orchestra://queue`
  - Tools: `get_run_status`, `list_runs`, `get_evidence`, `get_gates`, `get_queue`, `search_history`
  - Read-only: no mutating tools; uses existing `conductor-state.js` + `domain/store.js` read paths
  - Auth: none (local-only stdio transport); document that production deployments add TLS
- Create `bundle/hooks/orchestra-mcp-server.js` entry point (stdio transport)
- Create `scripts/test-mcp-server.js` (RED first): server starts, resources return correct schema, tools return data
- Update `install.sh` with `--mcp` flag to install server script + register in Cursor/OpenCode MCP config

### Task 6: Integration & Wire-Up
- Update `orchestra-subagent-stop.js`:
  - At `startOrchestra` / phase start: call `worktree.createWorktree` for new runs
  - Pass `state.worktree.path` as `cwd` to all evidence/checkpoint/gate calls
  - On `done`/`max_iterations`/`stall_aborted`: call `worktree.removeWorktree`
- Update `orchestra-prompt.js` / `orchestra-session-start.js`:
  - Initialize `state.worktree` for new runs
  - Ensure `state.diffBase` recorded at run start (already done in Phase 3)
- Update `conductor-state.sh` / `conductor-state.js`:
  - `beginRun` accepts `--worktree` flag; stores `worktree.path` in run JSON
  - `listRuns` includes worktree info
- Update `install.sh`:
  - New targets: `--worktree`, `--mcp`, `--spawn-adapter` (or bundle into `--all`)
  - Copy new lib modules to both `~/.cursor/hooks/lib/` and `~/.config/opencode/hooks/lib/`

### Task 7: Documentation & Progress Tracking
- Update `context/architecture.md`: add invariants 30–33 (worktree isolation, registry independence, spawn abstraction, MCP read-only)
- Update `context/progress-tracker.md`: Phase 5 entries with commit SHAs
- Update `docs/orchestra-cross-platform.md`: document spawn adapter + MCP for Claude Code/Codex

---

## Files to touch

### New files (all mirrored to `bundle/opencode/hooks/lib/`):
- `bundle/hooks/lib/worktree.js` — worktree CRUD, claims, cleanup
- `bundle/hooks/lib/domain/store.js` (modified) — run-partitioned events
- `bundle/hooks/lib/domain/review-queue.js` (modified) — run-scoped `pendingReview`
- `bundle/hooks/lib/registry/phase-independence.js` — independence DAG + proofs
- `bundle/hooks/lib/spawn/spawn-adapter.js` — host-agnostic spawn interface + adapters
- `bundle/hooks/lib/mcp/server.js` — MCP read-only server (resources + tools)
- `bundle/hooks/orchestra-mcp-server.js` — MCP stdio entry point
- `scripts/test-worktree.js` — RED-first tests
- `scripts/test-domain-run-partition.js` — RED-first tests
- `scripts/test-phase-independence.js` — RED-first tests
- `scripts/test-spawn-adapter.js` — RED-first tests
- `scripts/test-mcp-server.js` — RED-first tests

### Modified existing files:
- `bundle/hooks/lib/evidence-runner.js` — `detectWorkspaceRoot` worktree-aware; `recordRunDiffBase` records worktree
- `bundle/hooks/orchestra-subagent-stop.js` — worktree lifecycle, pass `cwd` to evidence/checkpoint/gate
- `bundle/hooks/orchestra-quality-gate.js` — pass `cwd` to evidence runner
- `bundle/hooks/orchestra-prompt.js` — initialize worktree state
- `bundle/hooks/orchestra-session-start.js` — initialize worktree state
- `bundle/hooks/lib/conductor-state.js` — `beginRun` stores worktree path
- `scripts/conductor-state.sh` — `--worktree` flag
- `install.sh` — new install targets, MCP registration
- `package.json` — add `@modelcontextprotocol/sdk` (latest stable)
- `context/architecture.md` — invariants 30–33
- `context/progress-tracker.md` — Phase 5 entries

---

## Git commit strategy

Each task = one atomic commit (or logical atomic group). Phase commits: implementer commits all code **before** verify; docs commit after review if needed.

| Commit | Message | Files |
|--------|---------|-------|
| 1 | `feat(worktree): add worktree isolation per run (create/remove/claim)` | `lib/worktree.js`, `test-worktree.js`, `evidence-runner.js` (detectWorkspaceRoot), `orchestra-subagent-stop.js`, `orchestra-prompt.js`, `orchestra-session-start.js` |
| 2 | `feat(domain): partition domain events by runId; review-queue run-scoped` | `lib/domain/store.js`, `lib/domain/review-queue.js`, `lib/domain/index.js`, `test-domain-run-partition.js` |
| 3 | `feat(registry): phase independence analysis for parallel execution` | `lib/registry/phase-independence.js`, `test-phase-independence.js`, `bundle/agents/orchestra.md` (conductor prompt) |
| 4 | `feat(spawn): host-agnostic spawn adapter (Cursor/OpenCode/Claude Code/Codex)` | `lib/spawn/spawn-adapter.js`, `test-spawn-adapter.js` |
| 5 | `feat(mcp): read-only MCP server exposing run/status/gates/history/queue` | `lib/mcp/server.js`, `orchestra-mcp-server.js`, `test-mcp-server.js`, `package.json` (+@modelcontextprotocol/sdk) |
| 6 | `feat(integration): wire worktree lifecycle into hooks + conductor` | `orchestra-subagent-stop.js`, `orchestra-quality-gate.js`, `conductor-state.js`, `conductor-state.sh` |
| 7 | `chore(install): add --mcp --worktree targets; register MCP in Cursor/OpenCode` | `install.sh` |
| 8 | `chore(docs): architecture invariants 30-33; progress-tracker Phase 5 entries` | `context/architecture.md`, `context/progress-tracker.md`, `docs/orchestra-cross-platform.md` |

---

## Risks / open questions

| Risk | Mitigation |
|------|------------|
| **Windows git worktree support** | Test on Windows CI; `git worktree` works on Windows 10+ with Git for Windows; fallback to directory copy if unavailable (documented limitation) |
| **Worktree cleanup on crash** | `orchestra-heartbeat.js` stall detection + `gcRuns` already clean stale runs; add `worktree.removeWorktree` in `completeRun`/`failRun`/`gcRuns` |
| **Concurrent runs hitting git index lock** | Each worktree has its own `.git/worktrees/<name>/index`; no shared index contention |
| **MCP server as first npm dependency in hooks** | Add as `devDependency`; install.sh documents `npm install --prefix ~/.cursor/hooks` or global install; keep hooks zero-runtime-dep by lazy-require |
| **Mirror sync drift (bundle/hooks vs bundle/opencode/hooks)** | All new lib files created in both locations simultaneously; `test-mirror-sync.js` catches drift |
| **Spawn adapter Cursor path remains prose** | Cursor `Task` tool cannot be called programmatically from hook; adapter emits instruction — documented as known limitation; OpenCode/Claude Code/Codex get true programmatic spawn |
| **Registry independence proof completeness** | Start with conservative pairs (phases in different categories with disjoint `readonly` sets); expand as evidence accumulates |

---

## Done when (testable criteria)

1. **Worktree isolation:** `node scripts/test-worktree.js` → 100% pass; two concurrent `orchestra-enable.js start "goal"` runs create disjoint `.pcore/worktrees/<runId>` with correct `HEAD`; `git status` in each shows only that run's changes.
2. **Domain partitioning:** `node scripts/test-domain-run-partition.js` → 100% pass; two concurrent runs produce separate `domain-events/<runId>.json`; `reviewQueue.pendingReview(runId)` returns only that run's items.
3. **Phase independence:** `node scripts/test-phase-independence.js` → 100% pass; `proveIndependent("verify", "documentation", registry)` returns `true` for enterprise mode; conductor prompt includes parallel-spawn directives for proven pairs.
4. **Spawn adapter:** `node scripts/test-spawn-adapter.js` → 100% pass; factory returns correct adapter per host env; all adapters implement `spawn()` interface.
5. **MCP server:** `node scripts/test-mcp-server.js` → 100% pass; `node orchestra-mcp-server.js` starts, responds to `resources/read` and `tools/call` with correct schemas; Cursor/OpenCode MCP config registers it.
6. **Integration:** Full orchestra run (core loop) completes with worktree created at start, evidence run inside worktree, worktree removed at done; `orchestra-health.js` shows worktree count = 0 after completion.
7. **Mirror sync:** `node scripts/test-mirror-sync.js` → 0 diffs.
8. **CI:** All 20+ suites (including 5 new) pass; `gen-agent-registry.js --check` OK; `scan-secrets --dir . --fail-on=high` exit 0.

---

## Complexity estimate

| Metric | Count |
|--------|-------|
| **New files** | 11 (5 lib modules + 5 tests + 1 MCP entry) |
| **Modified files** | 10 (6 hooks + 2 conductor + install.sh + package.json + 2 context docs) |
| **Components** | 4 (Worktree, Domain Partitioning, Registry Independence, Spawn Adapter, MCP Server) |
| **Implementation difficulty** | **High** — Windows worktree behavior, MCP SDK integration, cross-host spawn abstraction, domain store migration without data loss |
| **Estimated steps** | ~55 of 60 budget (leaves 5 for iteration/fixes) |

---

## Step budget tracking

| Task | Estimated steps | Cumulative |
|------|-----------------|------------|
| Worktree infrastructure + tests | 12 | 12 |
| Domain partitioning + tests | 10 | 22 |
| Registry independence + tests | 8 | 30 |
| Spawn adapter + tests | 8 | 38 |
| MCP server + tests | 10 | 48 |
| Integration wiring | 5 | 53 |
| Install + docs + mirror sync | 5 | 58 |
| Buffer for fixes/iteration | 2 | 60 |

**PLAN_READY**

# Loop-Engineering Roadmap — 2026-10-29

> **For agentic workers:** this is a forward plan, not an approved execution ticket. Implement only the section the conductor's plan explicitly names; each section is self-contained and shippable on its own.

**Goal:** close the three remaining loop-engineering gaps identified in the 2026-10 research refresh (`docs/agent-harness-recommendations.md` § 2026-10, `docs/agent-orchestra-rag-research.md` § 2026-10).

**Baseline:** completion contract in every handoff (`buildCompletionContract` — forbidden-actions + human-gate clauses, shipped 2026-10-29); plan artifact, hybrid FTS recall, phase profiles, plan-only mode all shipped.

---

## 1. Phase 4 — context-aware verify

**Gap:** the verifier handoff already carries work-item context (ticket ID + AC count) and an evidence digest (`buildHandoffEnforcement`), but the verifier does not treat the six-file context as a required read before issuing a verdict — a run can PASS while `context/architecture.md` invariants or `context/code-standards.md` conventions were never consulted.

**Design:**

- Handoff enrichment: `buildHandoffEnforcement` already emits `Work item: <id> (AC: n)` and `Evidence: <gate:PASS/FAIL …>`; extend the spawn payload with a `sixFile` summary (present/missing list — the quality-gate verify-entry scan already computes `state.qualityGates.missingContext`).
- Verifier contract: `bundle/agents/orchestra-verifier.md` "When invoked" gains a step — when the project has a `context/` folder, read `architecture.md` + `code-standards.md` (+ `ai-workflow-rules.md` verification checklist, already present) **before** the verdict; invariants violated → named as blockers under VERIFY_FAIL.
- Evidence rubric row: add a `context-check` row to the binary rubric (`<invariant> → file:line where the diff respects/violates it`).
- Non-regression: missing context files alone never flip the verdict (existing rule from the six-file gap block stays: note under **Gaps**, do not FAIL on absence).

**Done when:**

- [ ] Verifier prompt requires six-file reads (when present) before verdict; rubric has the context-check row.
- [ ] Spawn payload carries `sixFile.missing` (already wired) and the handoff names the context files to read.
- [ ] `test-handoff-enforcer.js` unchanged or extended without weakening the char cap.
- [ ] Agent mirrors regenerated (`sync-opencode-agents.js --force-core`, `sync-qoder-agents.js`); both `--check` green.

**Risk:** verifier token budget (~15k) — mitigate by reading only `architecture.md`/`code-standards.md` sections the diff touches, never full-file dumps.

---

## 2. Retry new-evidence check (FIX_REQUIRED replay hygiene)

**Gap:** a FIX_REQUIRED replay can send the implementer back with the same failing command and no new evidence; the loop burns iterations repeating a check that was never re-run differently. The hill-climbing loop has escalation after 2 cycles (`ESCALATION_AFTER_FIX_CYCLES`) but nothing forces *new evidence* per retry.

**Design:**

- Replay contract: on FIX_REQUIRED, the reviewer's numbered blockers must each state (a) the exact failing command, and (b) what new evidence a passing retry must show (expected output delta). Document in `bundle/agents/orchestra-reviewer.md` (FIX_REQUIRED output template) and mirror to verifier's FAIL-blockers template.
- Hook enforcement: in `orchestra-subagent-stop.js` `handleFixRequired`, record `state.memory.last_failed_commands` (normalized command strings from the verifier/reviewer output). On the next fix replay handoff, append a "Retry evidence" line naming the previously failing commands; if the next verify's evidence digest shows the *same* gate still FAIL with no new command having run, the handoff adds a directive to reproduce differently (not the same command), feeding the existing escalation path.
- Bounded: the hook does not block — it annotates. Hard stops stay with `max_iterations` and the escalation line (fail-safe invariant: hooks advise, gates decide).

**Done when:**

- [ ] FIX_REQUIRED template requires failing command + expected new evidence per blocker.
- [ ] `handleFixRequired` persists last failed commands; replay handoff carries the "Retry evidence" line.
- [ ] TDD: new asserts in `scripts/test-handoff-enforcer.js` (or a dedicated suite) for the retry line; existing 33/33 stay green.
- [ ] OpenCode/Qoder mirrors byte-identical; all sync `--check` gates green.

---

## 3. State-file versioning policy

**Gap:** `orchestra.json` (runtime state) and committed config can evolve independently; a hook upgrade that changes state shape can read a stale state file written by an older bundle with no explicit policy for schema drift.

**Policy (design only — implement as a small `schemaVersion` gate):**

- **Committed config** (version-controlled): `bundle/` payload, `project.yaml` (`orchestra.*` profiles), `hooks.json`, agent markdown. Versioned by git + `project.yaml` version bumps; never written at runtime.
- **Runtime state** (gitignored): `hooks/state/orchestra.json` (or `$PCORE_STATE_DIR/orchestra.json`), memory/FTS DBs, token counters, plan artifacts in the target repo's `.cursor/`. Never committed; never read across machines without a migration.
- **Schema version field:** runtime state gains `schemaVersion: <int>` written by `state-manager.js` on every save. Readers (`state-manager.js` load path) compare against the bundle's current schema version:
  - equal → load normally;
  - older → load + best-effort migrate in memory (preserve goal/memory, drop unknown-shaped fields) + rewrite on next save;
  - newer (state written by a newer bundle than the reading hooks) → do NOT guess: treat the run as not resumable, back the file up as `orchestra.json.bak-<ts>`, start fresh, and surface a one-line warning in the sessionStart injection.
- **PCORE_STATE_DIR:** already honored for location; the policy applies identically to the overridden dir — the env var moves the state, it does not change the version rules.
- Fail-safe: any migration error falls back to the same "back up + fresh start" path (never crash a hook on state parsing — invariant 19 style).

**Done when:**

- [ ] `schemaVersion` written on save; load path branches (equal/older/newer) implemented with the backup+fresh fallback.
- [ ] Tests: older-state migration preserves goal/memory; newer-state triggers backup + fresh session; corrupted state never throws.
- [ ] `context/architecture.md` storage-model row updated; mirrors byte-identical; sync `--check` gates green.

---

## Ordering & effort

| Section | Effort | Depends on | Value |
|---------|--------|-----------|-------|
| 1. Context-aware verify | Medium (agent text + payload plumbing) | none | closes the last "PASS without reading invariants" hole |
| 2. Retry evidence check | Medium (`handleFixRequired` + templates) | none | makes FIX_REQUIRED loops converge instead of repeat |
| 3. State versioning | Small–medium (`state-manager.js`) | none | forward-compat guard for every future state change |

Sections are independent; ship in any order. Each ends with the standard gates: `node --check` on touched JS, `scripts/test-handoff-enforcer.js`, `scripts/test-mirror-sync.js`, `sync-opencode-agents.js --check`, `sync-qoder-agents.js --check`.

---

*Created: 2026-10-29 — from the 2026-10 loop-engineering refresh (see `docs/agent-harness-recommendations.md` § 2026-10 loop-engineering status).*

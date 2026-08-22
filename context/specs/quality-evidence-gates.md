# Spec: quality-evidence-gates

## Goal

On final review phase (or when advancing to verify in enterprise mode), orchestra runs command-evidence checks (build, tests, lint, security, git status) and applies results to quality gates — gates must pass before `ORCHESTRA_COMPLETE`.

## Context

- Related overview/architecture sections: `context/architecture.md` (System boundaries → `evidence-runner.js`, Enterprise Quality Gates 1-14, Invariants #7), `context/ai-workflow-rules.md` (Six-file integration rules #4, System design triggers), `docs/production-loop.md` (production checklist)
- Out of scope: Eval harness (gap), always-on security scan (gap), parallel worktrees (gap)

## Requirements

1. `evidence-runner.js`: `runEvidenceChecks(state, options)` runs build, tests, lint, (security if enterprise), git status
2. Build evidence: `npm run build` if package.json has build script; else `node --check` on hook JS files
3. Tests evidence: `npm test` or `test-adaptive-loop.js` if present
4. Lint evidence: `orchestra-health.js` as smoke test for orchestra installs
5. Security evidence: `security-scanner.js` if present (critical/high findings = fail)
6. Git status evidence: reports dirty/clean (does not fail gate, informs reviewer)
7. `applyEvidenceToGates(state, passGate, failGate, skipGate)` maps results to quality gates
8. Core mode: only CORE_REQUIRED_GATES required (build, tests, lint, reviewer-approval, docs-updated, memory-updated)
9. Enterprise mode: all QUALITY_GATES required (14 gates including coverage, roadmap, release-notes, daily-journal, tech-debt, changelog, version)
10. Enterprise skip defaults: coverage, roadmap-updated, release-notes-updated, daily-journal-updated, tech-debt-recorded, changelog-updated, version-updated skipped if not produced
11. Evidence report injected into verifier/reviewer context via handoff
12. Reviewer must confirm all applicable gates pass before `ORCHESTRA_COMPLETE`

## Acceptance criteria

- [ ] `runEvidenceChecks(state, { cwd: "/project/with/package.json" })` → runs `npm run build`, `npm test`, health check
- [ ] `runEvidenceChecks(state, { cwd: "/orchestra/repo" })` → runs `node --check` on hook files, health check
- [ ] `applyEvidenceToGates` with all passing → `qualityGates.allRequiredPassed: true`
- [ ] `applyEvidenceToGates` with failing build → `qualityGates.failed` includes build, `allRequiredPassed: false`
- [ ] Core mode skips enterprise gates (marks skipped with "core loop — enterprise gate N/A")
- [ ] Enterprise mode attempts all gates; unproduced gates skipped with "not produced this run — skip"
- [ ] Evidence report format: `## Evidence checks\nRoot: ...\nMode: ...\n- PASS/FAIL **gate**: details`

## Done when (verifiable)

- Command: `node -e "const e=require('./bundle/hooks/lib/evidence-runner.js'); e.runEvidenceChecks({loopMode:'core'}, {cwd:process.cwd()}).then(r=>console.log(r.report))"` → prints evidence report
- Command: `node bundle/hooks/orchestra-health.js` → health check passes (used as lint evidence)
- Command: In a project with failing build, run evidence → shows FAIL build gate

## Files (expected)

- `bundle/hooks/lib/evidence-runner.js` — evidence checks + gate application
- `bundle/hooks/lib/constants.js` — `QUALITY_GATES` array
- `bundle/hooks/orchestra-verifier.js` — verifier hook runs evidence
- `bundle/opencode/hooks/lib/evidence-runner.js` — OpenCode mirror
- `docs/production-loop.md` — production checklist (soft gate reference)

## Risks

- Build/test commands may not exist in target project (handled: SKIPPED = pass)
- Security scanner not present by default (optional gate)
- Git dirty tree doesn't fail but blocks phase commit gate (separate check in phase-commit-gate.js)
- Long-running builds may exceed hook timeout (60s in evidence-runner)
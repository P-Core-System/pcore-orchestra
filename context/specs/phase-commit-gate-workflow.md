# Spec: phase-commit-gate-workflow

## Goal

Every orchestra phase that changes the repository must commit before the next phase starts. The implementer commits code before `IMPLEMENT_DONE`; the verifier and reviewer enforce clean tree; the parent commits docs/progress-tracker after `ORCHESTRA_COMPLETE` if dirty. Only allowed dirty file is `.cursor/orchestra-plan.md` (gitignored).

## Context

- Related overview/architecture sections: `context/architecture.md` (Invariants #11, Enterprise Quality Gates), `docs/production-loop.md` (Phase commit gate table, Production checklist), `bundle/hooks/lib/phase-commit-gate.js` (checkPhaseCommitGate, buildCommitGateHandoff)
- Out of scope: Git commit message formatting (handled by implementer conventions), branch isolation (gap), pre-commit hooks in target projects

## Requirements

1. `phase-commit-gate.js`: `checkPhaseCommitGate(state, options)` runs `git status --porcelain` at repo root (from `state.project.identityFile` or cwd)
2. Allowed dirty patterns: `.cursor/orchestra-plan.md`, `orchestra-plan.md` (gitignored plan artifacts)
3. Blocking dirty: any other modified, added, deleted, renamed files
4. Returns `{ clean, blocking, allowed, message, skipped }` — `clean: false` blocks next phase
5. `buildCommitGateHandoff(state, nextAgentId)` injects gate message into phase handoff text
6. Parent (conductor) MUST check gate before launching next subagent (`git status --porcelain` clean)
7. Implementer MUST commit with conventional message before emitting `IMPLEMENT_DONE`
8. On `FIX_REQUIRED`: implementer commits fixes before re-verify (separate commit)
9. After `ORCHESTRA_COMPLETE`: if `progress-tracker.md` or docs dirty, parent commits `docs(context): ...` or `docs(progress): ...`
10. OpenCode mirror: same gate logic in `bundle/opencode/hooks/lib/phase-commit-gate.js`

## Acceptance criteria

- [ ] `checkPhaseCommitGate()` returns `clean: true` on clean tree (only allowed dirty files)
- [ ] `checkPhaseCommitGate()` returns `clean: false` with `blocking` list when code files uncommitted
- [ ] `buildCommitGateHandoff()` includes gate message for verifier/reviewer handoffs
- [ ] Implementer agent prompt includes "commit before IMPLEMENT_DONE" rule
- [ ] Verifier agent prompt includes "enforce clean tree before verify" rule
- [ ] Reviewer agent prompt includes "review git diff, suggest docs commit" rule
- [ ] OpenCode mirror has identical gate logic

## Done when (verifiable)

- Command: `node -e "const p=require('./bundle/hooks/lib/phase-commit-gate.js'); console.log(p.checkPhaseCommitGate({}))"` → returns gate result object
- Command: In a dirty repo, `node -e "const p=require('./bundle/hooks/lib/phase-commit-gate.js'); console.log(p.checkPhaseCommitGate({}).clean)"` → `false`
- Command: `grep -A5 "commit before" bundle/agents/orchestra-implementer.md` → shows commit requirement
- Command: `grep -A5 "clean tree" bundle/agents/orchestra-verifier.md` → shows clean tree enforcement

## Files (expected)

- `bundle/hooks/lib/phase-commit-gate.js` — gate check + handoff builder
- `bundle/opencode/hooks/lib/phase-commit-gate.js` — OpenCode mirror
- `bundle/agents/orchestra-implementer.md` — commit before IMPLEMENT_DONE
- `bundle/agents/orchestra-verifier.md` — clean tree enforcement
- `bundle/agents/orchestra-reviewer.md` — git diff review + docs commit suggestion
- `bundle/opencode/agents/orchestra-*.md` — OpenCode mirrors
- `docs/production-loop.md` — phase commit gate table + production checklist

## Risks

- Non-git repos (handled: `skipped: true`, gate passes with warning)
- Large binary files committed accidentally (mitigated: conventional commit + reviewer diff review)
- Race condition if parent doesn't wait for gate (mitigated: handoff text injection enforces sequential)
- User has local pre-commit hooks that fail (mitigated: orchestra doesn't run user hooks, only checks porcelain)
# Spec: orchestra-adaptive-routing

## Goal

Ambient orchestra routes normal implement/fix prompts to the core 4-phase loop (plan → implement → verify → review), and only uses enterprise SDLC when explicitly requested or clearly complex.

## Context

- Related: `context/architecture.md` (adaptive loops), `context/progress-tracker.md` (V3.2+)
- Out of scope: inventing new marketplace skills; rewriting Cloudflare skill packs

## Requirements

1. Default ambient route is `core`; start phase is `plan`
2. `/enterprise` or complexity signals select enterprise; start phase is `idea`
3. Short/informal goals (`next improve`, `fix it`) start **core** with `inferFromContext` — planner expands from progress-tracker/git
4. Global install replaces `hooks/lib` (no nested `lib/lib`)
5. Quality gates on final review use command evidence

## Acceptance criteria

- [x] `classifyPrompt("fix login…")` → `route: core`
- [x] `classifyPrompt("/enterprise …")` → `route: enterprise`
- [x] `classifyPrompt("next improve")` → core + `inferFromContext: true` (no clarify block)
- [x] `startOrchestra` core → `currentPhase: plan`
- [x] `install.sh` removes `hooks/lib` before copy
- [x] `evidence-runner.js` present; health checks it

## Done when (verifiable)

- Command: `node scripts/test-adaptive-loop.js` → all PASS
- Command: `node bundle/hooks/orchestra-health.js` → All checks passed (includes adaptive install section)
- Command: `test ! -d ~/.cursor/hooks/lib/lib && grep -q LOOP_MODE_CORE ~/.cursor/hooks/lib/state-manager.js` → success

## Files (expected)

- `bundle/hooks/lib/prompt-classifier.js` — routing
- `bundle/hooks/lib/state-manager.js` — start phase
- `bundle/hooks/lib/phase-engine.js` — core + enterprise chains
- `bundle/hooks/lib/evidence-runner.js` — gate evidence
- `install.sh` — clean lib replace

## Risks

- User Cursor session may still hold old hook process until restart

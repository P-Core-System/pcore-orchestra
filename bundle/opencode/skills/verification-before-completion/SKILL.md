---
name: verification-before-completion
description: >-
  Require command evidence before claiming done. Use proactively before
  VERIFY_PASS, ORCHESTRA_COMPLETE, or "all fixed" statements. Run tests, lint,
  health, or git checks — never trust claims without output.
---

# Verification before completion

## Rule

No `VERIFY_PASS` / `ORCHESTRA_COMPLETE` / "done" without **evidence** (command output).

## Minimum evidence (pick what exists)

| Check | Command examples |
|-------|------------------|
| Syntax | `node --check <file>` |
| Tests | `node scripts/test-adaptive-loop.js`, `npm test`, `pytest` |
| Health | `node bundle/hooks/orchestra-health.js` |
| Git | `git status --porcelain`, `git diff --stat` |
| Lint/type | project scripts from `AGENTS.md` / `package.json` |

## Output

```markdown
## Evidence
| Check | Command | Result |
|-------|---------|--------|
| ... | ... | PASS/FAIL + brief |

## Verdict
VERIFY_PASS | VERIFY_FAIL
```

## Fail closed

- Missing runner → `SKIPPED: reason` (not silent PASS)
- Any required check FAIL → `VERIFY_FAIL` with blockers
- Do not fix code in verifier phase — report for implementer

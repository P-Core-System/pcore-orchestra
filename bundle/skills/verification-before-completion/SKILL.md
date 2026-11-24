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
| WS server | `node server/studio-api.js --port 3110` (binds 127.0.0.1) |
| WS client | `node scripts/team-listen.js --member M --team Alpha --types discussion.posted --port 3110 --once 1 --no-snapshot` |
| Team roster | `bash scripts/team-sessions.sh who --team Alpha` |
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
- WS server not reachable on 127.0.0.1:3110 → `SKIPPED: ws-server-down` (not silent PASS)
- WS client cannot connect → `VERIFY_FAIL` — team sessions cannot communicate
- Any required check FAIL → `VERIFY_FAIL` with blockers
- Do not fix code in verifier phase — report for implementer

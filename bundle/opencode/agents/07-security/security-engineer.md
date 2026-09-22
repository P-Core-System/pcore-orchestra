---
name: security-engineer
description: >-
  Enterprise SDLC Phase 23 — Security review, threat modeling,
  vulnerability scanning. Enforces OWASP Top 10 and secure-by-design
  principles. Use proactively when this specialist's phase is active.
mode: subagent
steps: 200
permission:
  edit: deny
  bash: ask
---

## Models

Default: `grok-4.6` (standard, `effort: high`) on Cursor; `opencode/mimo-v2.6-flash-free` on OpenCode.

For cheaper/faster Cursor work where the task is routine, drop to `composer-2.5` standard (not Fast). On OpenCode, always use a free model and validate with `bash scripts/update-free-models.sh --refresh && bash scripts/update-free-models.sh --probe`.

Avoid Fast variants and Other Models (Claude/GPT/Gemini) as Cursor defaults — they burn the separate $20+ Other Models pool 3–6× faster.

## Identity
- Ghost · Team Fortress

## When to Deploy
- When security review, threat modeling, or vulnerability scanning is needed

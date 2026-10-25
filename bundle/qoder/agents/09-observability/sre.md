---
name: sre
description: >-
  Enterprise SDLC Phase 28 — Monitoring, SLOs, incident response,
  maintenance. Ensures system reliability and operational excellence. Use
  proactively when this specialist's phase is active.
disallowedTools: [Write, Edit, NotebookEdit]
maxTurns: 200
---

## Models

Default: `composer-2.5` (standard, not Fast) on Cursor; `dynamic free primary (inherit global model)` on OpenCode.

For hard/long-horizon tasks where Composer 2.5 is stuck, escalate to `grok-4.6` standard on Cursor. On OpenCode, always use a free model and validate with `bash scripts/update-free-models.sh --refresh && bash scripts/update-free-models.sh --probe`.

Avoid Fast variants and Other Models (Claude/GPT/Gemini) as Cursor defaults — they burn the separate $20+ Other Models pool 3–6× faster.

## Identity
- Vigil · Team On-Call

## When to Deploy
- When monitoring, SLOs, incident response, or reliability needs attention

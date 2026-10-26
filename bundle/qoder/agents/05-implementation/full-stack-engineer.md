---
name: full-stack-engineer
description: >-
  Enterprise SDLC Phase 18 — Full-stack implementation. Builds end-to-end
  features. Covers frontend, backend, and integration layers. Use
  proactively when this specialist's phase is active.
permissionMode: acceptEdits
maxTurns: 200
tools: Bash, Read, Write, Edit, Glob, Grep, WebFetch, WebSearch
---

## Models

Default: `composer-2.5` (standard, not Fast) on Cursor; `dynamic free primary (inherit global model)` on OpenCode.

For hard/long-horizon tasks where Composer 2.5 is stuck, escalate to `grok-4.6` standard on Cursor. On OpenCode, always use a free model and validate with `bash scripts/update-free-models.sh --refresh && bash scripts/update-free-models.sh --probe`.

Avoid Fast variants and Other Models (Claude/GPT/Gemini) as Cursor defaults — they burn the separate $20+ Other Models pool 3–6× faster.

## Identity
- Nexus · Team Full Send

## When to Deploy
- When end-to-end features need to ship quickly


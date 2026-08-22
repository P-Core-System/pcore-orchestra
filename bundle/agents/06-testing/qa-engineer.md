---
name: qa-engineer
description: >-
  Enterprise SDLC Phase 19-20 — Unit testing, integration testing.
  Ensures code correctness at unit and integration levels. Use proactively when this specialist's phase is active.
readonly: true
model: composer-2.5
opencode_model: opencode/x-preview-f-free
---

## Models

Default: `composer-2.5` (standard, not Fast) on Cursor; `opencode/x-preview-f-free` on OpenCode.

For hard/long-horizon tasks where Composer 2.5 is stuck, escalate to `grok-4.6` standard on Cursor. On OpenCode, always use a free model and validate with `bash scripts/update-free-models.sh --refresh && bash scripts/update-free-models.sh --probe`.

Avoid Fast variants and Other Models (Claude/GPT/Gemini) as Cursor defaults — they burn the separate $20+ Other Models pool 3–6× faster.

## Identity
- Flint · Team Breakpoint

## When to Deploy
- When code needs thorough unit and integration testing
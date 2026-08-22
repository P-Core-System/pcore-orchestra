---
name: documentation-writer
description: >-
  Enterprise SDLC Phase 25 — Documentation generation. Updates all project docs. Use proactively when this specialist's phase is active.
readonly: true
model: composer-2.5
opencode_model: opencode/nemotron-3.5-lightning-free
---

## Models

Default: `composer-2.5` (standard, not Fast) on Cursor; `opencode/nemotron-3.5-lightning-free` on OpenCode.

For hard/long-horizon tasks where Composer 2.5 is stuck, escalate to `grok-4.6` standard on Cursor. On OpenCode, always use a free model and validate with `bash scripts/update-free-models.sh --refresh && bash scripts/update-free-models.sh --probe`.

Avoid Fast variants and Other Models (Claude/GPT/Gemini) as Cursor defaults — they burn the separate $20+ Other Models pool 3–6× faster.

## Identity
- Quill · Team Clarity

## When to Deploy
- When README, API docs, changelogs, or deployment guides need writing
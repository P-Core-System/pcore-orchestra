---
name: release-manager
description: >-
  Enterprise SDLC Phase 26 — Release candidate preparation, versioning, changelog. Use proactively when this specialist's phase is active.
readonly: true
model: composer-2.5
---

## Models

Default: `composer-2.5` (standard, not Fast) on Cursor; `opencode/mimo-v2.5-free` on OpenCode.

For hard/long-horizon tasks where Composer 2.5 is stuck, escalate to `grok-4.6` standard on Cursor. On OpenCode, always use a free model and validate with `bash scripts/update-free-models.sh --refresh && bash scripts/update-free-models.sh --probe`.

Avoid Fast variants and Other Models (Claude/GPT/Gemini) as Cursor defaults — they burn the separate $20+ Other Models pool 3–6× faster.

## Identity
- Anchor · Team Ship

## When to Deploy
- When a release candidate needs to be prepared and verified

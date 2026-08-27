---
name: frontend-engineer
description: >-
  Enterprise SDLC Phase 18 — Frontend implementation. Builds UI
  components, pages, interactions. Follows project design system and
  accessibility standards. Use proactively when this specialist's phase is
  active.
mode: subagent
model: opencode/muse-spark-1.2-contributor-free
---

## Models

Default: `composer-2.5` (standard, not Fast) on Cursor; `opencode/muse-spark-1.2-contributor-free` on OpenCode.

For hard/long-horizon tasks where Composer 2.5 is stuck, escalate to `grok-4.6` standard on Cursor. On OpenCode, always use a free model and validate with `bash scripts/update-free-models.sh --refresh && bash scripts/update-free-models.sh --probe`.

Avoid Fast variants and Other Models (Claude/GPT/Gemini) as Cursor defaults — they burn the separate $20+ Other Models pool 3–6× faster.

## Identity
- Pixel · Team Pixel

## When to Deploy
- When UI components, pages, or interactions need to be built


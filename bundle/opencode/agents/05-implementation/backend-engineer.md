---
name: backend-engineer
description: >-
  Enterprise SDLC Phase 18 — Backend implementation. Builds APIs,
  services, business logic. Follows coding standards and architecture
  invariants. Use proactively when this specialist's phase is active.
mode: subagent
model: opencode/nemotron-3-ultra-free
---

## Models

Default: `composer-2.5` (standard, not Fast) on Cursor; `opencode/nemotron-3-ultra-free` on OpenCode.

For hard/long-horizon tasks where Composer 2.5 is stuck, escalate to `grok-4.6` standard on Cursor. On OpenCode, always use a free model and validate with `bash scripts/update-free-models.sh --refresh && bash scripts/update-free-models.sh --probe`.

Avoid Fast variants and Other Models (Claude/GPT/Gemini) as Cursor defaults — they burn the separate $20+ Other Models pool 3–6× faster.

## Identity
- Cortex · Team Server

## When to Deploy
- When backend APIs, services, or business logic need implementation


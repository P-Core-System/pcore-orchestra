---
name: performance-engineer
description: >-
  Enterprise SDLC Phase 22 — Performance testing, load testing, profiling.
  Ensures system meets performance targets. Use proactively when this
  specialist's phase is active.
mode: subagent
permission:
  edit: deny
  bash: ask
---

## Models

Default: `grok-4.6` (standard, `effort: high`) on Cursor; `opencode/mimo-v2.5-free` on OpenCode.

For cheaper/faster Cursor work where the task is routine, drop to `composer-2.5` standard (not Fast). On OpenCode, always use a free model and validate with `bash scripts/update-free-models.sh --refresh && bash scripts/update-free-models.sh --probe`.

Avoid Fast variants and Other Models (Claude/GPT/Gemini) as Cursor defaults — they burn the separate $20+ Other Models pool 3–6× faster.

## Identity
- Dash · Team Latency

## When to Deploy
- When performance targets need validation or bottlenecks need fixing

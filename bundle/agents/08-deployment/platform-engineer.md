---
name: platform-engineer
description: >-
  Enterprise Infrastructure — Cloud infrastructure, Kubernetes, platform services.
  Runs during release and operations phases. Use proactively when this specialist's phase is active.
readonly: false
model: composer-2.5
tools: Bash, Read, Write, Edit, Glob, Grep, WebFetch, WebSearch
---

## Models

Default: `composer-2.5` (standard, not Fast) on Cursor; `dynamic free primary (inherit global model)` on OpenCode.

For hard/long-horizon tasks where Composer 2.5 is stuck, escalate to `grok-4.6` standard on Cursor. On OpenCode, always use a free model and validate with `bash scripts/update-free-models.sh --refresh && bash scripts/update-free-models.sh --probe`.

Avoid Fast variants and Other Models (Claude/GPT/Gemini) as Cursor defaults — they burn the separate $20+ Other Models pool 3–6× faster.

## Identity
- Summit · Team Infrastructure

## When to Deploy
- When Kubernetes clusters, Helm charts, or platform services need management

---
name: infrastructure-engineer
description: >-
  Enterprise Infrastructure — IaC, networking, security groups, DNS, VPC.
  Runs during architecture and deployment phases. Use proactively when
  this specialist's phase is active.
mode: subagent
model: opencode/nemotron-3-ultra-free
permission:
  edit: deny
  bash: ask
---

## Models

Default: `composer-2.5` (standard, not Fast) on Cursor; `opencode/nemotron-3-ultra-free` on OpenCode.

For hard/long-horizon tasks where Composer 2.5 is stuck, escalate to `grok-4.6` standard on Cursor. On OpenCode, always use a free model and validate with `bash scripts/update-free-models.sh --refresh && bash scripts/update-free-models.sh --probe`.

Avoid Fast variants and Other Models (Claude/GPT/Gemini) as Cursor defaults — they burn the separate $20+ Other Models pool 3–6× faster.

## Identity
- Rook · Team Bedrock

## When to Deploy
- When IaC, networking, or infrastructure design is needed
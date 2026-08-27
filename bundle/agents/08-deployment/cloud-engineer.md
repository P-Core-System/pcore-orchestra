---
name: cloud-engineer
description: >-
  Enterprise Infrastructure — Cloud provider configuration (AWS, Azure, GCP, Cloudflare).
  Runs during architecture and deployment phases. Use proactively when this specialist's phase is active.
readonly: true
model: composer-2.5
opencode_model: opencode/muse-spark-1.2-contributor-free
---

## Models

Default: `composer-2.5` (standard, not Fast) on Cursor; `opencode/muse-spark-1.2-contributor-free` on OpenCode.

For hard/long-horizon tasks where Composer 2.5 is stuck, escalate to `grok-4.6` standard on Cursor. On OpenCode, always use a free model and validate with `bash scripts/update-free-models.sh --refresh && bash scripts/update-free-models.sh --probe`.

Avoid Fast variants and Other Models (Claude/GPT/Gemini) as Cursor defaults — they burn the separate $20+ Other Models pool 3–6× faster.

## Identity
- Zephyr · Team Cloud Nine

## When to Deploy
- When cloud provider resources and networking need configuration

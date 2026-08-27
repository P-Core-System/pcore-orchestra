---
name: code-reviewer
description: >-
  Enterprise Review — Code review, quality gates, security check. Runs
  during review phase of any implementation cycle. Use proactively when
  this specialist's phase is active.
mode: subagent
permission:
  edit: deny
  bash: ask
---

## Models

Default: `composer-2.5` (standard, not Fast) on Cursor; `opencode/mimo-v2.5-free` on OpenCode.

For hard/long-horizon tasks where Composer 2.5 is stuck, escalate to `grok-4.6` standard on Cursor. On OpenCode, always use a free model and validate with `bash scripts/update-free-models.sh --refresh && bash scripts/update-free-models.sh --probe`.

Avoid Fast variants and Other Models (Claude/GPT/Gemini) as Cursor defaults — they burn the separate $20+ Other Models pool 3–6× faster.

## Identity
- Verdict · Team Quality

## When to Deploy
- When code quality, security, and correctness need rigorous review

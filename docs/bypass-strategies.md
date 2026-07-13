# Bypass Limit Strategies

Reference guide for extending usage beyond Cursor and OpenCode free-tier limits. All strategies are legitimate (BYOK is officially supported by both platforms) or documented for awareness.

## Table of Contents

- [Cursor IDE](#cursor-ide)
  - [Current Limits](#cursor-limits)
  - [BYOK (Bring Your Own Key)](#cursor-byok)
  - [LiteLLM Proxy for Blocked Models](#cursor-litellm)
  - [Token Optimization](#cursor-token-optimization)
  - [What Does NOT Work](#cursor-broken)
- [OpenCode CLI](#opencode-cli)
  - [Current Limits](#opencode-limits)
  - [Free Zen Models](#opencode-zen-free)
  - [Multi-Key Rotation Proxy](#opencode-multi-key)
  - [OpenRouter Multi-Key (Mux)](#opencode-openrouter)
  - [Local Model Fallback](#opencode-local)
- [Cost Comparison](#cost-comparison)

---

## Cursor IDE {#cursor-ide}

### Current Limits {#cursor-limits}

| Plan | Fast requests/month | Slow pool | Premium models | Cost |
|------|-------------------|-----------|----------------|------|
| Hobby (free) | 50 + 2000 completions | Yes | Limited | $0 |
| Pro | 500 | Yes (queued) | All | $20/mo |
| Business | 500/seat | Yes | All | $40/seat/mo |
| Ultra | 5,000 | Slower fallback | All + early-access | $200/mo |

Once fast requests are exhausted, every prompt waits in the slow pool (20-60s latency during peak hours). **Tab completions also consume fast requests.**

### BYOK — Bring Your Own Key {#cursor-byok}

Cursor explicitly supports BYOK. When you use your own API key, requests go directly to the provider — Cursor's monthly fast-request counter **does not increment**.

#### Option A: Direct Provider Key

1. Get an API key from OpenAI, Anthropic, or Google
2. Cursor → Settings → Models → paste key into provider section
3. Click Verify

**Limitation:** Cursor's BYOK UI only supports specific providers. For custom/OpenAI-compatible endpoints, use Option B.

#### Option B: OpenAI-Compatible Proxy (Recommended)

This is the real unlock. Cursor accepts a custom base URL for OpenAI-compatible endpoints.

**Using Hypereal (supports GPT-5.4, Claude Opus 4.7, Sonnet 4.6, Gemini 3 Pro):**

1. Sign up at hypereal.cloud, copy your API key
2. Cursor → Settings → Models → OpenAI API Key
3. Toggle "Override OpenAI Base URL"
4. Set base URL: `https://api.hypereal.cloud/v1`
5. Paste your Hypereal key (`ck_...`)
6. Enable desired models, click Verify

**Using LLM Gateway (200+ models):**

1. Sign up at llmgateway.io
2. Cursor → Settings → Models → OpenAI API Key
3. Toggle "Override OpenAI Base URL"
4. Set base URL to your gateway endpoint
5. Paste gateway API key, Verify

**Cost:** BYOK charges you at provider API rates. Typically $80-150/mo for heavy use — cheaper than Ultra, with no cap.

> **Note:** GPT-5.5 BYOK is currently broken in Cursor (confirmed May 2026). Use Claude Opus 4.7, Sonnet 4.6, or Gemini 3 Pro until Cursor ships a fix.

### LiteLLM Proxy for Blocked Models {#cursor-litellm}

If you specifically need GPT-5.5 in Cursor, use LiteLLM as a relay. Cursor talks to LiteLLM, LiteLLM talks to the provider — Cursor's validation never sees the blocked model identifier.

```bash
pip install "litellm[proxy]"
export OPENAI_API_BASE=https://api.hypereal.cloud/v1
export OPENAI_API_KEY=ck_...
python -m litellm.proxy.proxy_cli --model gpt-5.5
```

LiteLLM starts on `http://localhost:4000`. In Cursor, set the base URL to `http://localhost:4000/v1`.

### Token Optimization {#cursor-token-optimization}

Reduce token consumption to stretch your free tier further:

**Disable background features that silently burn tokens:**

```jsonc
// .cursor/config.json
{
  "agent.background": false,
  "completions.autoTrigger": "minimal",
  "context.autoAttach": {
    "maxSizeKB": 50
  }
}
```

**Disable Tab completions** if hitting monthly cap early:
- Cursor → Settings → Cursor Tab → Disable
- You keep Cmd+K and Chat, which you control manually

**Write efficient prompts:**
- Weak: "Make this faster"
- Strong: "Optimize this Python function for memory efficiency, keep time complexity O(n)"

**Avoid hidden token sinks:**
- Background agents add 15-20% overhead per request
- Attached files count fully (attach only relevant sections)
- Multi-step conversations accumulate

### What Does NOT Work {#cursor-broken}

| Method | Why it fails |
|--------|-------------|
| cursor-free-vip / trial reset tools | Server-side detection updated 2025-2026; accounts banned |
| Multiple Cursor accounts | Billing fingerprint detection; banned quickly |
| "Cursor unlimited" reseller accounts | Shared logins banned within days |
| Asking Cursor support for bump | Refused unless enterprise contract |

---

## OpenCode CLI {#opencode-cli}

### Current Limits {#opencode-limits}

OpenCode has two tiers:

| Tier | Endpoint | Models | Cost |
|------|----------|--------|------|
| **Zen Free** | `https://opencode.ai/zen/v1` | `minimax-m2.5-free`, `big-pickle`, `north-mini-code-free`, `mimo-v2.5-free`, `qwen3.6-plus-free`, `nemotron-3-super-free`, `ling-2.6-flash`, `hy3-preview-free` | $0 |
| **Go (Paid)** | `https://opencode.ai/zen/go/v1` | `deepseek-v4-flash`, `kimi-k2.7`, `qwen3.7-max`, GLM, all Go models | $5 first month, $10/mo after |

**Go limits:** $12/5hrs, $30/week, $60/month usage caps.

**Free model caveat:** Several free models may use collected data for model training during the free period. Do not use free tier for sensitive code.

### Free Zen Models {#opencode-zen-free}

Current free models (as of July 2026):

```
minimax-m2.5-free
big-pickle
north-mini-code-free
mimo-v2.5-free
qwen3.6-plus-free
nemotron-3-super-free
ling-2.6-flash
hy3-preview-free
```

Free models have stricter rate limits and lower quality. They're real models, not demos — but they're best for testing and light tasks.

### Multi-Key Rotation Proxy {#opencode-multi-key}

For heavy orchestration workloads, pool multiple API keys with automatic failover.

**opencode-go-multi-auth** — Recommended for Go + Zen:

```bash
# Install (OpenCode plugin mode)
# Plugin auto-starts proxy on OpenCode launch

# Add providers to ~/.config/opencode/opencode.json:
```

```json
{
  "provider": {
    "opencode-go": {
      "options": { "baseURL": "http://localhost:18905" },
      "models": {
        "deepseek-v4-flash": {}
      }
    },
    "multi-auth-zen": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "OpenCode Zen (multi-auth)",
      "options": { "baseURL": "http://localhost:18905/zen" },
      "models": {
        "deepseek-v4-flash-free": {},
        "mimo-v2.5-free": {},
        "qwen3.6-plus-free": {},
        "minimax-m3-free": {},
        "nemotron-3-ultra-free": {},
        "north-mini-code-free": {}
      }
    }
  }
}
```

**Features:**
- Round-robin, priority failover, weighted cycle strategies
- Auto-failover on 402/429 (rate limit) with cooldown
- Circuit breaker for 5xx errors
- Web dashboard on `localhost:18904`
- Session stickiness for cache reuse

**Strategies:**

| Strategy | Best for |
|----------|----------|
| `priority_failover` (default) | Keep one account warm for cache reuse |
| `round_robin` | Simple load spreading |
| `weighted_cycle` | Proportional traffic distribution |

**Important:** Provider name must be unique. Do NOT use `opencode-zen` or `opencode` — those collide with built-in providers and bypass the proxy.

### OpenRouter Multi-Key (Mux) {#opencode-openrouter}

**Mux** — Multi-key routing via OpenRouter:

```bash
# Add OpenRouter API keys via /mux command
# Select models via /mux models
# Enable via Tab in prompt or /mux → Enable
```

- Routes across multiple OpenRouter API keys
- Auto-switches when credits run low
- Works with any model on OpenRouter

### Local Model Fallback {#opencode-local}

Why burn API tokens on simple tasks? Use local models for boilerplate:

```bash
# Run Ollama or LM Studio locally
# Point OpenCode to local endpoint

# In opencode.json:
{
  "provider": {
    "local": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "http://localhost:11434/v1" },
      "models": {
        "qwen3-coder": {}
      }
    }
  }
}
```

**Smart routing pattern:**

```python
def route_task(prompt):
    if is_boilerplate(prompt):
        return local_model(prompt)    # Free, fast
    elif is_complex(prompt):
        return paid_model(prompt)     # Capable, costs tokens
    else:
        return free_model(prompt)     # Free, medium quality
```

### Claude Code + OpenCode Free Models {#opencode-claude-code}

Use Claude Code for free by routing through OpenCode Zen free models via a Cloudflare Worker proxy:

1. Deploy OpenCode Cowork Proxy Worker to Cloudflare
2. Set `ANTHROPIC_BASE_URL=http://your-worker.workers.dev/zen`
3. Set `ANTHROPIC_API_KEY` to any non-empty string
4. Set model to `minimax-m2.5-free` (or any free Zen model)

**Model routing tokens:**

| Setting | Result | Cost |
|---------|--------|------|
| `free-auto` | Auto-picks best free model | Free |
| `go-auto` | Auto-picks best paid model | Paid |
| `claude-haiku-*` | Maps to `free-auto` | Free |
| `claude-sonnet-*` | Maps to `go-auto` | Paid |

---

## Token Optimization {#token-optimization}

Bypassing limits is only half the story. The other half is spending tokens efficiently. See **[docs/token-optimization.md](token-optimization.md)** for the full guide.

Quick wins:
- Enable `compaction.prune: true` — saves 30-50% tokens in long sessions
- Use phase-specific models — budget for planner/verifier, capable for implementer
- Set agent `steps` limits — prevent runaway token consumption
- Use `small_model` for titles/summaries — $0.001 instead of $0.05+

```bash
bash scripts/setup-opencode-optimal.sh --balanced  # auto-generates optimized config
```

---

## Cost Comparison {#cost-comparison}

| Setup | Monthly cost | Unlimited? | Quality |
|-------|-------------|------------|---------|
| Cursor Free (no BYOK) | $0 | No (50 fast) | Limited |
| Cursor + BYOK (Hypereal) | $20 + $80-150 API | Yes | High |
| Cursor Ultra | $200 | Capped at 5000 | High |
| OpenCode Free (Zen) | $0 | Rate-limited | Medium |
| OpenCode Go | $5-10 | $60/mo cap | High |
| OpenCode Go + Multi-key | $10-30 (multiple accounts) | Effectively yes | High |
| OpenCode Free + Local models | $0 | Yes | Medium-High |
| Cursor + Orchestra + BYOK | $20 + API costs | Yes | High (multi-agent) |
| OpenCode + Orchestra + Multi-key | $10-30 | Yes | High (multi-agent) |

**Best value for orchestration workloads:**
- **Cursor users:** BYOK with Hypereal ($20 + API) — no slow pool, all models available
- **OpenCode users:** Go subscription + multi-key rotation ($10-30) — automatic failover across accounts
- **Zero budget:** OpenCode Zen free models + local Ollama fallback — works, with quality tradeoffs

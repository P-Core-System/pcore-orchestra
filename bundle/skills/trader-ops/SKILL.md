---
name: trader-ops
description: Operate the pcore-trader production bot on pcore-server — deploy, recover, and verify. Use when deploying crypto-trader code, recovering failed systemd services, restarting the observer bot, or fixing Telegram message truncation. Covers deploy-vps.sh pitfalls, git-pull recovery, service/port inventory, and the lossless pagination pattern.
---

# P-Core Trader Operations (pcore-server)

## Host inventory (verified 2026-11-06)

| Item | Value |
|---|---|
| SSH host | `pcore-server` (expect IP 18.143.176.54; retired IPs: 13.115.84.100, 54.255.182.90, 47.128.228.24) |
| Remote root | `/home/ubuntu/pcore/crypto-trader` (its own git clone of `P-Core-System/pcore-trader`, branch `main`) |
| Panel | `http://127.0.0.1:4030` (`/healthz`), public via cloudflared → crypto-ops URL |
| Brain serve | `http://127.0.0.1:4096/health` (pcore-brain-serve; heartbeat alerts when down; never auto-restarted) |
| Always-on services | `crypto-trader-bot`, `crypto-trader-panel`, `crypto-trader-observer`, `crypto-trader-auto-manager`, `crypto-trader-monitor` |
| Timer-fired services | signal, futures, margin, learn, harvest, backup, self-heal, autofix, agent-* heartbeats (`systemctl list-timers 'crypto-trader-*'`) |
| Logs | `<root>/logs/<name>.log` + `<name>.err` (observer writes `observer.err` — read it for tracebacks) |

## Deploy from Windows (Git Bash) — the rsync trap

`scripts/deploy-vps.sh` **stops services first, then rsyncs**. Git Bash has no `rsync`, so it aborts mid-way:
services stay down and code never syncs.

Recovery procedure (preferred over re-running the script from Windows):

```bash
ssh pcore-server "cd /home/ubuntu/pcore/crypto-trader && git fetch origin \
  && git status --porcelain | wc -l   # must be 0 before ff-only pull
  && git pull --ff-only origin main"
```

Then compile-check before restarting (a single syntax error crash-loops every service):

```bash
ssh pcore-server "cd /home/ubuntu/pcore/crypto-trader \
  && venv/bin/python -m py_compile tools/crypto/advisor.py tools/crypto/observer_bot.py"
```

Restart (crash-loop backoff leaves `failed` until reset):

```bash
ssh pcore-server "sudo systemctl reset-failed crypto-trader-bot crypto-trader-observer; \
  sudo systemctl restart crypto-trader-bot crypto-trader-panel \
    crypto-trader-auto-manager crypto-trader-monitor crypto-trader-observer; \
  sleep 8; systemctl is-active crypto-trader-bot crypto-trader-panel \
    crypto-trader-auto-manager crypto-trader-monitor crypto-trader-observer"
```

Note: `deploy-vps.sh` never restarts `crypto-trader-observer` — restart it manually after any
change to `tools/crypto/observer_bot.py`. From WSL/Linux the script works, but it syncs `.env`
too: only `BINANCE_DEMO, BINANCE_PAPER_SIMULATE, BITGET_DEMO, CRYPTO_PG_DSN, CRYPTO_TRADING_MODE`
are preserved from remote.

If the remote tree is dirty or diverged, do NOT force — stop and reconcile; the server also
auto-commits deploys (`git add -A && git commit -m "deploy: ..."`), so remote history can differ.

## Telegram delivery: never truncate agent replies

Telegram caps a message at 4096 code points (use 4000). Hard slices like `result[:3800]`
cut reports mid-word. The lossless pattern (used for /doctor, /observer, AI Fix):

```python
from tools.crypto.replies import chunk_safe  # splits on line/word edges, nothing dropped

chunks = chunk_safe(f"{heading}\n\n{_esc(body)}")
await status.edit_text(chunks[0], parse_mode="HTML")   # replace "Running…" message
for extra in chunks[1:]:
    await msg.reply_text(extra, parse_mode="HTML")
```

Rules:
- Escape (`_esc`) BEFORE chunking; `chunk_safe` cuts on newline boundaries so HTML tags stay paired.
- `truncate_safe` (adds "…") is for status lines and log tails only, never for full reports.
- If edit_text fails (old message pruned), fall back to reply_text for the first chunk too.

## Env-flag triage on the server

Signal behavior lives in `<root>/.env` (e.g. `CRYPTO_SIGNAL_MIN_CONFIDENCE`, `CRYPTO_SIGNAL_1D_TREND_MODE=1`,
`CRYPTO_SIGNAL_15M_ENTRY_MODE=1`, `CRYPTO_SIGNAL_SYMBOL_FOCUS=BTC/USDT,ETH/USDT,XRP/USDT`,
`CRYPTO_SIGNAL_ADVANCED_MODE=1`, `CRYPTO_TRADING_MODE=demo`, `BITGET_DEMO=1`).
A code-default change (e.g. confidence 0.80 → 0.35) does NOT take effect while `.env` pins the old value —
check `grep -n KEY .env` after deploys, then restart the affected service.

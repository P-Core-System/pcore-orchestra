# Spec: model-routing-per-platform

## Goal

Orchestra routes model selection per platform and per agent role: Cursor uses `composer-2.5` (daily) → `grok-4.6` (hard tasks); OpenCode uses free models only with **dynamic** assignment — `scripts/update-free-models.sh --apply` picks the highest-stability probe-reachable free model (any pool; light-pool head fallback) as primary and a reachable heavy/free model as fallback from the live cache (no hardcoded free-model IDs; curated `KNOWN_FREE` covers stealth-free models like `big-pickle` whose id lacks "free" and whose Zen pricing is empty), refreshed weekly via systemd timer / cron.

## Context

- Related overview/architecture sections: `docs/orchestra-cross-platform.md` (Models by platform table), `docs/01-OVERVIEW-AND-ARCHITECTURE.md` (Model Routing row), `scripts/update-free-models.sh` (preflight + pool generation + `--apply` + `--schedule`), `scripts/systemd/pcore-free-models.{service,timer}` (weekly refresh), `scripts/lib/opencode-token-profile.js` (REASONING per agent), `bundle/config/opencode/autonomy.json` (model mappings — rewritten by `--apply`)
- Out of scope: Cursor model picker UI, third-party model API keys, model fine-tuning

## Requirements

1. Cursor agent frontmatter: `model: composer-2.5` for core agents; enterprise specialists (architect, tech-lead, security, performance) use `model: grok-4.6`
2. OpenCode agent frontmatter: **no** `model:` hardcodes — agents inherit top-level `model`/`small_model` (set by `--apply` from probe-ordered free pools; no hardcoded free IDs)
3. OpenCode: `scripts/update-free-models.sh --refresh` fetches live Zen catalog → writes `model-pools.json` ordered by `probes.json`; `--apply` picks primary (highest-stability reachable) + heavy fallback and rewrites **only** global `model`/`small_model` in `bundle/config/opencode/autonomy.json`, `docs/opencode.json.example`, and installed `opencode.json`, and **strips** agent frontmatter/`agent.*.model` hardcodes — fetches first if cache missing/empty; aborts only if fetch fails with no cache; `--check` validates configured models exist in cache/pools and flags UNREACHABLE via probes; `--pools` prints pool contents; `--schedule` installs weekly refresh (systemd user timer `OnCalendar=weekly`, cron fallback)
4. `opencode-token-profile.js`: `REASONING` object maps each agent to `reasoningEffort`/`textVerbosity` (conductor/verifier low; planner/implementer/reviewer medium)
5. `merge-autonomy-config.js`: free-tier **per-agent** `model` keys are **deleted** (inherit global); static deny-list only when the cache is absent (offline first-run). Custom/paid provider models are never touched. Probe-unreachable free IDs in cache are also stripped from agents
6. OpenCode `opencode.json.example`: top-level `model` / `small_model` / `provider.opencode.models` track the `--apply` primary (highest-stability probe-ordered free model); agent blocks have no `model` key
7. Conductor-first routing: `orchestra` conductor is `default_agent` with `mode: primary`, `reasoningEffort: low`; phase agents are `hidden: true`
8. Docs: `README.md` feature table + token optimization table reflect model routing; `docs/orchestra-cross-platform.md` Models section current (dynamic, no hardcoded free IDs)
9. `install.sh` / `install.ps1` on the OpenCode path run `--refresh --apply` once (non-fatal offline) then install the weekly schedule (systemd/cron on Linux, schtasks on Windows)

## Acceptance criteria

- [x] Cursor agents in `bundle/agents/orchestra-*.md` have `model: composer-2.5` or `grok-4.6`
- [x] OpenCode agents in `bundle/opencode/agents/orchestra-*.md` have **no** `model:` frontmatter (inherit global `model`)
- [x] `bash scripts/update-free-models.sh --refresh && bash scripts/update-free-models.sh --check` → exits 0 (configured models in pools; no DEAD/UNREACHABLE)
- [x] `bash scripts/update-free-models.sh --apply` → rewrites global model only + strips agent hardcodes; fetches first if cache missing/empty; aborts only if fetch fails with no cache
- [x] `bash scripts/update-free-models.sh --pools` → prints frontend/heavy/light pool contents (probe-ordered)
- [x] `bash scripts/update-free-models.sh --schedule` → `systemctl --user list-timers` shows `pcore-free-models.timer` (or cron entry when systemd missing)
- [x] `node scripts/lib/opencode-token-profile.js` exports `REASONING` with correct per-agent values
- [x] `merge-autonomy-config.js` strips free-tier per-agent models (inherit); deny-list only when cache absent

## Done when (verifiable)

- Command: `bash scripts/update-free-models.sh --refresh && bash scripts/update-free-models.sh --check` → PASS
- Command: `bash scripts/update-free-models.sh --apply` → prints `primary:` / `heavy fallback:` from pools; `rg -n 'model:' bundle/opencode/agents/orchestra-*.md` → no matches (inherit)
- Command: `grep -r "model:" bundle/agents/orchestra-*.md | head -5` → shows `composer-2.5` or `grok-4.6`
- Command: `node -e "const p=require('./scripts/lib/opencode-token-profile.js'); console.log(p.REASONING.planner)"` → `{ reasoningEffort: 'medium', textVerbosity: 'medium' }`
- Command: installed `~/.config/opencode/opencode.json` `model` matches `--apply` primary after `bash install.sh --opencode`

## Files (expected)

- `bundle/agents/orchestra-*.md` — Cursor agent frontmatter with `model:`
- `bundle/agents/01-idea/.../10-review/` — enterprise specialists with `model:` + `opencode_model:`
- `bundle/opencode/agents/orchestra-*.md` — OpenCode agents with **no** `model:` (inherit global; stripped by `--apply`)
- `scripts/update-free-models.sh` — preflight + pool generation + `--apply` + `--schedule`
- `scripts/systemd/pcore-free-models.service` / `.timer` — weekly refresh+apply (OnCalendar=weekly)
- `scripts/lib/opencode-token-profile.js` — `REASONING`, `applyTokenProfile`, provider variants
- `scripts/merge-autonomy-config.js` — cache-backed dead model patching (static deny-list fallback)
- `bundle/config/opencode/autonomy.json` — base model config (rewritten by `--apply`)
- `docs/orchestra-cross-platform.md` — Models by platform section
- `docs/01-OVERVIEW-AND-ARCHITECTURE.md` — Model Routing row
- `README.md` — feature table + token optimization table + weekly refresh commands

## Risks

- OpenCode free models change availability (mitigated: weekly `--refresh --apply` timer + `--check` preflight)
- Cursor `composer-2.5` / `grok-4.6` may be renamed (mitigated: `setup-cursor-model.sh` validates)
- Region-blocked/dead free models (mitigated: cache membership is source of truth; `--check` fails on DEAD ids; deny-list only as offline fallback)
- Desktop vs CLI sidecar mismatch for OpenCode (mitigated: `fix-opencode-response.sh` + health check `--heal`)
- Offline first-run has no cache (mitigated: `--apply` fetches first and aborts only if fetch fails with no cache; install keeps existing IDs and warns; static deny-list covers merge)
- Frontmatter does not support env interpolation (mitigated: agents omit `model:` entirely and inherit top-level `model`; no weekly frontmatter rewrites)
# Spec: model-routing-per-platform

## Goal

Orchestra routes model selection per platform and per agent role: Cursor uses `composer-2.5` (daily) → `grok-4.6` (hard tasks); OpenCode uses free models only with **dynamic** assignment — `scripts/update-free-models.sh --apply` picks the light free-pool head as primary and the heavy free-pool head as fallback from the live cache (no hardcoded free-model IDs), refreshed weekly via systemd timer / cron.

## Context

- Related overview/architecture sections: `docs/orchestra-cross-platform.md` (Models by platform table), `docs/01-OVERVIEW-AND-ARCHITECTURE.md` (Model Routing row), `scripts/update-free-models.sh` (preflight + pool generation + `--apply` + `--schedule`), `scripts/systemd/pcore-free-models.{service,timer}` (weekly refresh), `scripts/lib/opencode-token-profile.js` (REASONING per agent), `bundle/config/opencode/autonomy.json` (model mappings — rewritten by `--apply`)
- Out of scope: Cursor model picker UI, third-party model API keys, model fine-tuning

## Requirements

1. Cursor agent frontmatter: `model: composer-2.5` for core agents; enterprise specialists (architect, tech-lead, security, performance) use `model: grok-4.6`
2. OpenCode agent frontmatter: `model: opencode/<primary>` where primary is the light free-pool head assigned by `--apply` (all agents inherit the same weekly free primary; no hardcoded free IDs)
3. OpenCode: `scripts/update-free-models.sh --refresh` fetches live Zen catalog → writes `model-pools.json` (frontend/heavy/light); `--apply` picks primary (light) + heavy fallback from cache/pools and atomically rewrites `bundle/config/opencode/autonomy.json`, `docs/opencode.json.example`, installed free-tier refs, and agent frontmatter `model:` lines — fetches first if cache missing/empty; aborts only if fetch fails with no cache; `--check` validates configured models exist in cache/pools; `--pools` prints pool contents; `--schedule` installs weekly refresh (systemd user timer `OnCalendar=weekly`, cron fallback)
4. `opencode-token-profile.js`: `REASONING` object maps each agent to `reasoningEffort`/`textVerbosity` (conductor/verifier low; planner/implementer/reviewer medium)
5. `merge-autonomy-config.js`: prefers **cache-backed** model replacements — free-tier agent models absent from `state/free-models.json` are replaced with cache primary/heavy; the static deny-list is used only when the cache is absent (offline first-run). Custom/paid provider models are never touched
6. OpenCode `opencode.json.example`: `model` / `small_model` / `provider.opencode.models` keys all track the `--apply` primary (light free pool head)
7. Conductor-first routing: `orchestra` conductor is `default_agent` with `mode: primary`, `reasoningEffort: low`; phase agents are `hidden: true`
8. Docs: `README.md` feature table + token optimization table reflect model routing; `docs/orchestra-cross-platform.md` Models section current (dynamic, no hardcoded free IDs)
9. `install.sh` / `install.ps1` on the OpenCode path run `--refresh --apply` once (non-fatal offline) then install the weekly schedule (systemd/cron on Linux, schtasks on Windows)

## Acceptance criteria

- [x] Cursor agents in `bundle/agents/orchestra-*.md` have `model: composer-2.5` or `grok-4.6`
- [x] OpenCode agents in `bundle/opencode/agents/orchestra-*.md` have `model: opencode/<light-free-pool-head>` (set by `--apply`; no hardcoded free IDs)
- [x] `bash scripts/update-free-models.sh --refresh && bash scripts/update-free-models.sh --check` → exits 0 (all configured models in pools)
- [x] `bash scripts/update-free-models.sh --apply` → rewrites autonomy.json + example + agent frontmatter from cache; fetches first if cache missing/empty; aborts only if fetch fails with no cache
- [x] `bash scripts/update-free-models.sh --pools` → prints frontend/heavy/light pool contents
- [x] `bash scripts/update-free-models.sh --schedule` → `systemctl --user list-timers` shows `pcore-free-models.timer` (or cron entry when systemd missing)
- [x] `node scripts/lib/opencode-token-profile.js` exports `REASONING` with correct per-agent values
- [x] `merge-autonomy-config.js` replaces dead free-tier models in user's `opencode.json` using cache pools (deny-list only when cache absent)

## Done when (verifiable)

- Command: `bash scripts/update-free-models.sh --refresh && bash scripts/update-free-models.sh --check` → PASS
- Command: `bash scripts/update-free-models.sh --apply` → prints `primary:` / `heavy fallback:` from pools; `rg -n 'model:' bundle/opencode/agents/orchestra-*.md` matches primary
- Command: `grep -r "model:" bundle/agents/orchestra-*.md | head -5` → shows `composer-2.5` or `grok-4.6`
- Command: `node -e "const p=require('./scripts/lib/opencode-token-profile.js'); console.log(p.REASONING.planner)"` → `{ reasoningEffort: 'medium', textVerbosity: 'medium' }`
- Command: installed `~/.config/opencode/opencode.json` `model` matches `--apply` primary after `bash install.sh --opencode`

## Files (expected)

- `bundle/agents/orchestra-*.md` — Cursor agent frontmatter with `model:`
- `bundle/agents/01-idea/.../10-review/` — enterprise specialists with `model:` + `opencode_model:`
- `bundle/opencode/agents/orchestra-*.md` — OpenCode agent frontmatter with `model:` (rewritten by `--apply`)
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
- Frontmatter does not support env interpolation (mitigated: `--apply` rewrites literal `model:` lines weekly instead of templating)
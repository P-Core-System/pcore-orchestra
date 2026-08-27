# Spec: model-routing-per-platform

## Goal

Orchestra routes model selection per platform and per agent role: Cursor uses `composer-2.5` (daily) → `grok-4.6` (hard tasks); OpenCode uses free models only (`mimo-v2.5-free` (ox-alpha) primary, `mimo-v2.5-free` for verifier/small_model), with preflight validation against live model catalog.

## Context

- Related overview/architecture sections: `docs/orchestra-cross-platform.md` (Models by platform table), `docs/01-OVERVIEW-AND-ARCHITECTURE.md` (Model Routing row), `scripts/update-free-models.sh` (preflight + pool generation), `scripts/lib/opencode-token-profile.js` (REASONING per agent), `bundle/config/opencode/autonomy.json` (model mappings)
- Out of scope: Cursor model picker UI, third-party model API keys, model fine-tuning

## Requirements

1. Cursor agent frontmatter: `model: composer-2.5` for core agents; enterprise specialists (architect, tech-lead, security, performance) use `model: grok-4.6`
2. OpenCode agent frontmatter: `model: mimo-v2.5-free (ox-alpha)` for planner/implementer/reviewer/conductor; `model: mimo-v2.5-free` for verifier/small_model
3. OpenCode: `scripts/update-free-models.sh --refresh` fetches live Zen catalog → writes `model-pools.json` (frontend/heavy/light); `--check` validates configured models exist in pools; `--pools` prints pool contents
4. `opencode-token-profile.js`: `REASONING` object maps each agent to `reasoningEffort`/`textVerbosity` (conductor/verifier low; planner/implementer/reviewer medium)
5. `merge-autonomy-config.js`: patches dead model refs (e.g., `deepseek-v4-flash-free` → `mimo-v2.5-free`) in `opencode.json` during install
6. OpenCode `opencode.json.example`: `model: mimo-v2.5-free (ox-alpha)`, `small_model: mimo-v2.5-free`, provider variants for both
7. Conductor-first routing: `orchestra` conductor is `default_agent` with `mode: primary`, `reasoningEffort: low`; phase agents are `hidden: true`
8. Docs: `README.md` feature table + token optimization table reflect model routing; `docs/orchestra-cross-platform.md` Models section current

## Acceptance criteria

- [ ] Cursor agents in `bundle/agents/orchestra-*.md` have `model: composer-2.5` or `grok-4.6`
- [ ] OpenCode agents in `bundle/opencode/agents/orchestra-*.md` have `model: mimo-v2.5-free (ox-alpha)` / `mimo-v2.5-free`
- [ ] `bash scripts/update-free-models.sh --check` → exits 0 (all configured models in pools)
- [ ] `bash scripts/update-free-models.sh --pools` → prints frontend/heavy/light pool contents
- [ ] `node scripts/lib/opencode-token-profile.js` exports `REASONING` with correct per-agent values
- [ ] `merge-autonomy-config.js` patches known dead models in user's `opencode.json`

## Done when (verifiable)

- Command: `bash scripts/update-free-models.sh --refresh && bash scripts/update-free-models.sh --check` → PASS
- Command: `grep -r "model:" bundle/agents/orchestra-*.md | head -5` → shows `composer-2.5` or `grok-4.6`
- Command: `grep -r "model:" bundle/opencode/agents/orchestra-*.md | head -5` → shows `mimo-v2.5-free` (ox-alpha) / `mimo-v2.5-free`
- Command: `node -e "const p=require('./scripts/lib/opencode-token-profile.js'); console.log(p.REASONING.planner)"` → `{ reasoningEffort: 'medium', textVerbosity: 'medium' }`

## Files (expected)

- `bundle/agents/orchestra-*.md` — Cursor agent frontmatter with `model:`
- `bundle/agents/01-idea/.../10-review/` — enterprise specialists with `model:` + `opencode_model:`
- `bundle/opencode/agents/orchestra-*.md` — OpenCode agent frontmatter with `model:`
- `scripts/update-free-models.sh` — preflight + pool generation
- `scripts/lib/opencode-token-profile.js` — `REASONING`, `applyTokenProfile`, provider variants
- `scripts/merge-autonomy-config.js` — dead model patching
- `bundle/config/opencode/autonomy.json` — base model config
- `docs/orchestra-cross-platform.md` — Models by platform section
- `docs/01-OVERVIEW-AND-ARCHITECTURE.md` — Model Routing row
- `README.md` — feature table + token optimization table

## Risks

- OpenCode free models change availability (mitigated: `--refresh` + `--check` preflight)
- Cursor `composer-2.5` / `grok-4.6` may be renamed (mitigated: `setup-cursor-model.sh` validates)
- Region-blocked free models (mitigated: `mimo-v2.5-free` / `hy3-free` / `muse-spark-*` documented as avoid)
- Desktop vs CLI sidecar mismatch for OpenCode (mitigated: `fix-opencode-response.sh` + health check `--heal`)
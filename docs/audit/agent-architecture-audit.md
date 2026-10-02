# P-Core Orchestra — Agent System / AI / Tools / MCP Evidence Report

**Scope:** `D:\Learning Web Development\pcore\pcore-orchestra` (single-repo; all reads scoped to this root)
**Date:** 2026-10-02 · **Mode:** read-only audit (evidence only, no speculation)
**Headline numbers re-verified 2026-10-02** (counts re-run; see §8 Verification Log)
**Tooling note:** `rg` is **not installed** in this environment (`Get-Command rg` → not found). Substituted the built-in Grep tool (regex-equivalent, scoped paths) + targeted PowerShell/Node parses. No repo files were modified by the audit itself; this report is the only artifact written.

---

## 1. Orchestra agents (5 core + 4 identity refs + 1 spawn matrix)

### Frontmatter — Cursor (`bundle/agents/`) vs OpenCode (`bundle/opencode/agents/`)

| File | Cursor frontmatter | OpenCode frontmatter | Delta |
|---|---|---|---|
| `orchestra.md` (351 / 456 lines) | `mode: primary`, `readonly: true`, `model: composer-2.5`, `reasoningEffort: low`, `permission` block (task allowlist + `bash: allow`, `edit: deny`, `websearch/webfetch: allow`) | `mode: primary`, `steps: 500`, `reasoningEffort: low`, **same** `permission` block; **no `readonly`, no `model`** | +105 lines OpenCode-only "Dynamic step allocation" (500-step budget; phase weights plan .15 / implement .40 / verify .20 / review .10 / reserve .15; full-delivery weights; `complexity_multiplier = 1.0 + files*0.05 + components*0.1`) |
| `orchestra-planner.md` (93/105) | `readonly: true`, `model: composer-2.5` | `mode: subagent`, `steps: 500`, `permission: edit: deny / bash: allow` | body identical except OpenCode adds `## Step budget awareness` ("Always finish with `PLAN_READY` even if you run low on steps") |
| `orchestra-implementer.md` (119/128) | `model: composer-2.5`, **no `readonly`** (writable) | `mode: subagent`, `steps: 500`, **no `permission` block** (edit inherits global allow) | only agent allowed to write on both platforms |
| `orchestra-verifier.md` (95/106) | `readonly: true`, `model: composer-2.5` | `mode: subagent`, `steps: 500`, `permission edit: deny/bash: allow` | +description sentence "Use proactively when this specialist's phase is active" |
| `orchestra-reviewer.md` (113/124) | `readonly: true`, `model: composer-2.5` | `mode: subagent`, `steps: 500`, `permission edit: deny/bash: allow` | same |

- **`tools:` key = 0 occurrences** across all 165+165 agent `.md` files (both trees). Tool access is expressed only via `permission.*` (+ host harness defaults).
- **`hidden: true` = 0 occurrences in agent frontmatter.** All 160 frontmattered OpenCode agents use `mode: subagent` (159) / `mode: primary` (1, orchestra); `steps` present in 159 (missing only `08-deployment/documentation-writer.md`); `permission` present in 155. Hidden-ness comes **only from config**: `bundle/config/opencode/autonomy.json` → `agent.*.hidden = true` on **164 of 167** entries (visible: `orchestra`, `general`, `explore`). The only `hidden: true` strings in the whole agents tree are the **doc claim** at `bundle/agents/references/orchestra-spawn-matrix.md:21` (and its mirror).
- `sync-opencode-agents.js:104-105` is the converter: emits `mode: subagent`, `steps: <int || 200>`, `permission: edit: <readonly?deny:allow> / bash: allow / websearch: allow / webfetch: allow`, **drops `model`** ("Agents inherit the main/global model"), appends "Use proactively…" (`ensureProactive`, L70-74).

### System-prompt structure (conductor `bundle/agents/orchestra.md`)
`Decide first` (L67-71) → **NEVER STOP golden rule** (L73-80: all phases end with tokens / user "stop" / **5 failed resumes**) → Workflow Modes core vs full delivery (L82-102) → project-type specialist routing table (L104-126) → Corporate tier (L128-139) → **Auto-continue on max steps table** (L141-150) → Resume rules + prompt template (L152-165) → State persistence via `scripts/conductor-state.sh` (L167-178) → `Loop — Core Mode (strict order — one task at a time)` (L180-191) → `Loop — Full Delivery` 8 phases (L193-254) → session-claims (L255-262) → conductor rules (L264-270: "Read-only: edit denied… Never nest orchestra inside orchestra… task prompts under 2,500 chars") → research/version policy (L272-280) → phase commit gate (L282-286) → model policy (L288-290) → phase/category tables (L292-337) → final report (L339-341) → Cursor cross-reference (L343-345).

### Expected end tokens
- Core: `PLAN_READY`, `IMPLEMENT_DONE`, `VERIFY_PASS` | `VERIFY_FAIL`, `ORCHESTRA_COMPLETE` | `FIX_REQUIRED`; auto-continue table at `orchestra.md:145-150`.
- Specialists named in conductor: `DESIGN_SPEC_COMPLETE`, `TASK_BREAKDOWN_COMPLETE` (L126), `ARCHITECTURE_COMPLETE` (L212), `UAT_COMPLETE` (L232), `DEPLOY_COMPLETE` (L238), `POST_DEPLOY_COMPLETE` (L244), `TEAM_SELECTED`, `PROJECT_CLASSIFIED`, `WORKFLOW_PLAN_READY`, `GOVERNANCE_PASS`, `CORPORATE_RELEASE_COMPLETE` (L132-139).
- **Mismatch:** conductor expects `agent-selector` → `TEAM_SELECTED` (L132) but `00-workflow/agent-selector.md:58` says **`End with AGENTS_SELECTED`**; conductor expects `workflow-orchestrator` → `WORKFLOW_PLAN_READY` (L134) but `workflow-orchestrator.md:57` says **`End with WORKFLOW_ORCHESTRATED`**. (`project-type-classifier` → `PROJECT_CLASSIFIED` matches.)
- ~100+ per-agent tokens in the enterprise set (e.g. `FRONTEND_IMPL_COMPLETE`, `ANALYSIS_COMPLETE`, `RESEARCH_COMPLETE`).

### Spawning
- **Cursor:** `Task(subagent_type="orchestra-planner", …)` — `references/orchestra-spawn-matrix.md:5`, `bundle/rules/orchestra-loop.mdc:38-40`, `bundle/skills/orchestra-loop/SKILL.md:11-16`, `orchestra.md:345`.
- **OpenCode:** `task(agent="orchestra-planner", …)` — spawn-matrix.md:18, `bundle/ORCHESTRA.md:19-24` ("conductor → task(planner) → task(implementer)… **no Cursor hooks**").
- **Hooks do not call any spawn API.** `orchestra-subagent-stop.js:286-296` emits `{ followup_message: "Launch **<nextAgentId>**…\n" + buildPhaseHandoff(...) }` to stdout (`lib/io.js emit()` = `process.stdout.write(JSON)`). Spawning remains an instruction to the parent model.
- **Fallback:** if Cursor `Task` rejects `subagent_type=orchestra-*`, parent must "run phases itself or spawn `generalPurpose` with instructions from `~/.cursor/agents/orchestra-*.md` — do not stop the loop" (spawn-matrix.md:10-12, SKILL.md:32).
- **Resume/max-steps:** detect missing token → resume via `task_id` (never restart), pass progress, **max 5 resumes/phase then escalate**, save state after each (`orchestra.md:152-165`, SKILL.md Auto-continue table). Machine-tracked: `scripts/conductor-state.sh:129-131` `run.resumeAttempts[key] = (…||0)+1`; commands `begin|save|heartbeat|list|who|resume|complete|fail|gc` (L31-44); legacy `~/.config/opencode/state/orchestra-state.json` auto-migrates once (`orchestra.md:178`).
- **Identity files:** `bundle/agents/references/orchestra-{planner,implementer,verifier,reviewer}-identity.md` — each 10 lines, "**Not required**… Workflow lives in `orchestra-*.md`" (optional flavor: Blueprint/Anvil/Prism/Gavel). `install.sh:195-196` and `sync-opencode-agents.js:125-142` copy **only** `orchestra-spawn-matrix.md` to OpenCode `references/` — yet `bundle/opencode/agents/references/` contains **all 5** (stale) and `autonomy.json` registers all 5 as hidden agents (`orchestra-planner-identity`, `orchestra-spawn-matrix`, …).
---

## 2. Enterprise agent inventory

- **Count: 155** files under numbered category dirs (**37** dirs: `00-business`(5) … `14-research`(3)); +5 core +5 references = **165** in `bundle/agents/`, **165** in `bundle/opencode/agents/`. (Files themselves are *not* numbered — numbering is on directories: `00-*`×5, `01`-`06`, `07-*`×13, `08`-`10`, `11-*`×6, `12`-`14`.)
- Frontmatter (numbered, Cursor): `name`/`description`/`model` = 155; `readonly: true` = **152** (3 missing: `backend-engineer`, `database-engineer`, `full-stack-engineer` — i.e. the writers); `permission` = 133 (`edit: deny`, `bash: allow`). Models: `composer-2.5` ×151, `grok-4.6` ×4 (`architect`, `tech-lead`, `performance-engineer`, `security-engineer`).
- **Shape — generic prompt templates, NOT executable:** length distribution `≤25 lines: 19` · `26-60: 68` · `61-120: 68`; **0** `tools:` keys; **1** code fence total in all 165 files (`orchestra.md:257` ```bash for conductor-state CLI). Every agent is `Models` + `Identity (Codename ▸ Team)` + `When to Deploy` + `When invoked` + markdown output tables + a single `End with <TOKEN>` line.
- **Samples:**
  - `05-implementation/backend-engineer.md` — **22 lines, stub**: Models/Identity/When to Deploy only; no `readonly`, no `permission` (Cursor → can edit).
  - `06-testing/qa-engineer.md` — 22 lines, `readonly: true`.
  - `07-security/security-engineer.md` — 22 lines, `readonly: true`, `model: grok-4.6`.
  - `09-observability/observer.md` — 22 lines stub.
  - `07-red-team/penetration-tester.md` — 64 lines: `permission edit: deny/bash: allow` + pentest report tables (Scope/Attack Surface/Findings CVSS/Attack Chain).
  - `05-implementation/frontend-engineer.md` — 96 lines: capability lists (frameworks/state/styling/perf) + `## Frontend Implementation` markdown template + `End with FRONTEND_IMPL_COMPLETE`.
  - `14-research/research-scientist.md` — 57 lines: Research Framework tables (hypothesis/literature/experiment).

### Doc (`references/orchestra-spawn-matrix.md`) vs lib (`hooks/lib/orchestra-spawn-matrix.js`) — mismatches

| # | Doc claim | Code reality |
|---|---|---|
| 1 | "Enterprise Specialist Agents **(35)**" listing only **10** sections (01-idea…10-review + 07-security) | **155** files under numbered dirs; **27 of 37** category dirs absent from doc: all `00-*` (22 files), all `07-*` teams except `07-security` (39 files), all `11-*` (33), `12/13/14-*` (9) → **117 files undocumented** |
| 2 | Doc is the selection reference | `lib/orchestra-spawn-matrix.js` contains **no agent inventory at all** — only `PHASE_AGENTS` (4, L7-12), `PLATFORMS` (L14-46), `spawnLine`, `handoffBlock`, `ambientContextBlock`, `toolsMatrixMarkdown`. Doc↔lib structurally unverifiable (no shared list) |
| 3 | "Phase agents: `hidden: true` — not in @ menu" (doc L21) | **0** agent frontmatter files contain `hidden:`; hidden lives only in `autonomy.json` (164 entries, incl. 5 reference docs) |
| 4 | Quality gates `G1: Plan … G8: Post-Deploy` (doc L103-112) | Code gates = `QUALITY_GATES = ["build","tests","coverage","lint","security","reviewer-approval","docs-updated","version-updated","changelog-updated","roadmap-updated","memory-updated","daily-journal-updated","release-notes-updated","tech-debt-recorded"]` (`hooks/lib/constants.js:109-113`) — different taxonomy, no G1-G8 ids anywhere in code |
| 5 | Core = 4 agents | ✔ matches `PHASE_AGENTS` exactly |
| 6 | Spawn syntax/chain/entry/state paths | ✔ all match `PLATFORMS.cursor/opencode` strings |

### Additional registry-count conflicts (all four disagree)
- **43** `permission.task` allowlist patterns in conductor frontmatter (`orchestra.md:16-58`, behind `"*": deny` at L15) → prefix-match covers **46/160** agent files; **114 uncovered**, including **`market-researcher` — which the conductor's own Full-Delivery table spawns** (`orchestra.md:303`), plus `security-engineer`, every red/blue/purple/black/green/white-team agent, all `11-*` data/ML agents, `cloud-engineer`, `site-reliability-engineer`.
- **27** names in `bundle/hooks.json` `subagentStop` matcher (L19) → only **27/160** agents auto-chain; **133** get no `subagentStop` handling (same matcher duplicated L24; `orchestra-memory.js` matcher = only the 4 phase agents L29; `orchestra-quality-gate.js` = 3 names L34).
- **167** `agent` entries in `bundle/config/opencode/autonomy.json` (164 hidden; includes `general`, `explore`, and the 5 reference docs).
- **"104-agent registry"** claimed in `00-workflow/agent-selector.md:4`.
---

## 3. AI gateway / provider adapters — **DOCUMENTED BUT NOT IMPLEMENTED / NOT PRESENT**

Grep evidence (repo-wide, code files):
- `api.openai|api.anthropic|openrouter|v1/chat/completions|v1/responses` → **1 executable hit**: `scripts/setup-cursor-byok.sh:159` `echo " - OpenRouter: openrouter.ai (multi-provider)"` (help text). All other hits are **skill reference docs** (`bundle/skills/cloudflare/references/ai-gateway/*`, `agents-sdk/references/*` — tutorials for Cloudflare's gateway, not this repo's code) and `n8n-workflow-patterns` doc snippets.
- `axios|http.request|https.request|node-fetch` in `*.js` → **0 matches**.
- `fetch(` in `*.js` → **0 matches**.
- `createServer|listen(` in `*.js` → **0 matches** ⇒ **no HTTP client and no HTTP server anywhere in this repo.**
- `child_process` usage exists only for local process exec: `hooks/lib/evidence-runner.js:3,28` (spawnSync `npm run build/test/lint`, 60s timeout), `hooks/lib/phase-commit-gate.js:13` (git), `project-bridge/hooks/bridge.js:28` (spawn global hook), `hooks/orchestra-health.js:342`, `scripts/lib/opencode-version.js:6`.
- `require("https"/"http"/"net"/"tls")` → **0 matches**.

**Model config (static, config-time only):**
- `bundle/config/opencode/autonomy.json` → `"model": "opencode/big-pickle"`, `"small_model": "opencode/big-pickle"`, `"provider": { "opencode": { "models": { "big-pickle": { "variants": { "fast": {…} } } } } }`. **No `mcp` key**; top keys = `model, small_model, compaction, tool_output, watcher, default_agent, snapshot, instructions, permission, agent, provider`. Same shape in `docs/opencode.json.example` (`provider` at L220, no `mcp`).
- `bundle/config/cursor/{cli-autonomy,permissions,sandbox}.json` contain **no model field** (model policy lives in prose + `scripts/setup-cursor-model.sh`, which explicitly "does NOT write to the binary IDE state database (state.vscdb); instead it guides the user" and edits `~/.cursor/cli-config.json`).
- **Model *catalog* fetch (not inference):** `scripts/update-free-models.sh:41,106,195` `curl -sS https://opencode.ai/zen/v1/models` → writes `state/{free-models,model-pools,probes}.json` + rewrites global model (`--apply`). Weekly `scripts/systemd/pcore-free-models.timer`.
- **Only gateway-adjacent artifact:** `scripts/setup-cursor-byok.sh --litellm` (L257-335) `pip install litellm[proxy]` then generates `start-litellm-proxy.sh` running `python3 -m litellm.proxy.proxy_cli --model … --port …` — **delegation to an external third-party binary**, optional flag, Cursor BYOK only. `scripts/setup-opencode-proxy.sh:194-199` writes a `provider` baseURL (`https://opencode.ai/zen/v1`) into config.
- **Dead/latent model-selection code:** `merge-autonomy-config.js` — `pickCacheModels()` (L215) and `pickOfflineModels()` (L296) are **defined but never called** (grep: only their definitions); `pickCacheModels` references **undeclared `reachableLight`** at L236 (would throw `ReferenceError` if reached with an empty `reachableAll`); `loadFreeModelCache` (L198) *is* used by `patchUnreliableAgentModels` (L267) to strip stale `opencode/*` per-agent pins.

**Verdict:** no AI gateway, no model router, no provider adapter for inference, no request/response pipeline exists in this repo. **Model execution is fully delegated to the host harness (Cursor / OpenCode).** This repo contributes only: static model *naming* in frontmatter/config, install-time *selection* from a fetched free-model catalog, prose model policy (`.github/copilot-instructions.md:17-21`), and an optional external litellm launcher.

---

## 4. MCP — capability table

Code-level MCP hits (25 across `*.js/json/sh/ps1`): none implement MCP; all are **allow / preserve / disable / document**.

| MCP Server | Tools | Resources | Prompts | Transport | Auth | Implemented? | Location | Purpose |
|---|---|---|---|---|---|---|---|---|
| **P-Core Orchestra MCP server** (expose hooks/state/memory) | — | — | — | — | — | **NOT PRESENT** (0 `@modelcontextprotocol` imports, 0 `createServer`, 0 `/mcp` routes, 0 HTTP server) | — | Roadmap only: `docs/agent-orchestra-rag-research.md:154` "MCP memory server → Expose semantic-memory via MCP", `:191` "MCP memory recall tool" under **P4 medium-term** |
| **OpenCode MCP client config shipped by bundle** | — | — | — | — | — | **NOT PRESENT** — `autonomy.json` and `docs/opencode.json.example` have **no `mcp` key** | `bundle/config/opencode/autonomy.json` | Existing user `mcp` is only **preserved** on merge: `merge-autonomy-config.js:335-336,372`; `install.sh:263,277` "mcp preserved" |
| **Cursor MCP allowlist** (client-side policy for user-supplied servers) | policy only | policy only | policy only | n/a | n/a | **Policy only** (no server code) | `bundle/config/cursor/permissions.json:59-69` — `context7:*, brightspace:*, zotero:*, obsidian:*, supabase:*, Neon:*/neon:*, plugin-context7-*, plugin-prisma-*` + `:77` autoRun allow | Grants auto-approval for docs/DB MCP lookups |
| **Cursor CLI MCP wildcard** | `Mcp(*:*)` | — | — | — | — | **Policy only** | `bundle/config/cursor/cli-autonomy.json:10` merged into `~/.cursor/cli-config.json` (`merge-autonomy-config.js:78-111`) | Allow *all* MCP tools in Cursor CLI |
| **Remote-MCP disable switch** (client mgmt) | n/a | n/a | n/a | n/a | n/a | **Implemented (client config edit)** | `scripts/fix-opencode-response.sh:26,93-105` (`for ([k,v] of Object.entries(cfg.mcp)) … "Disabled remote MCP"`) | Unhang OpenCode desktop startup |
| **External MCP servers referenced by skills** (chrome-devtools, n8n-mcp, Cloudflare `https://mcp.cloudflare.com/mcp`, Context7) | external | external | external | stdio/HTTP (theirs) | theirs | **Docs-only in this repo** | `bundle/skills/web-perf/SKILL.md:18-27`, `n8n-workflow-patterns/README.md:36-43`, `cloudflare-email-service/references/cli-and-mcp.md:53-55`, `agents-sdk/references/mcp.md` (teaches building MCP servers *on Cloudflare Workers*) | Reference material for the consuming agent |
| **Doc rows** | — | — | — | — | — | **Docs-only** | `hooks/lib/orchestra-spawn-matrix.js:91` ("MCP \| Cursor MCP config \| opencode.json → mcp (remote can block startup)"); `docs/orchestra-cross-platform.md:56`, `docs/token-optimization.md:133,344-354` | Cross-platform matrix / token policy |

### How Claude Code / Codex / OpenCode can interact **today** (evidence-based)
- **OpenCode — full integration (real path):** `install.sh:16,26-28,171-264` installs to `~/.config/opencode/{agents,skills,hooks,state}`, merges `autonomy.json` → `opencode.json` with `default_agent: "orchestra"`, `permission.task: allow`, skill deny-by-default; conductor then `task`-spawns phases; health = `node ~/.config/opencode/hooks/orchestra-health-opencode.js` (`AGENTS.md:87`). External skill discovery via symlinks `~/.agents/skills/*` (`AGENTS.md:105`).
- **Cursor — full integration:** `install.sh --cursor` → `~/.cursor/{hooks,agents,skills,rules,hooks.json,permissions.json,sandbox.json,cli-config.json}`; per-project `project-bridge/hooks/bridge.js` + `.cursor/hooks.json` (repo root has both) re-invokes the global hooks (`bridge.js:4,12-28`).
- **Claude Code — NO installer target.** `install.sh` writes only `~/.cursor` + `~/.config/opencode` (L15-16); **`.claude/` directory ABSENT** in repo. What exists: `CLAUDE.md:4-5` ("Claude Code reads this file natively"), `AGENTS.md` pointer, and **manual skill symlinking** documented per-skill (`bundle/skills/turnstile-spin/README.md:32` `ln -s … ~/.claude/skills/turnstile-spin`), plus authoring guidance `templates/AGENTS.authoring.md:113-118` (`.claude/skills/`). ⇒ Claude Code can read the methodology + skills, but **there is no hook wiring, no conductor registration, no `Task`-equivalent spawn config** for it.
- **Codex — docs only.** `templates/AGENTS.authoring.md:125-127` ("Codex picks up `AGENTS.md` with no extra config"); repo-root `AGENTS.md` exists; **`.codex/` ABSENT**; no installer path.
- **Copilot — docs only:** `.github/copilot-instructions.md` (read-order + model-routing policy).
- **MCP path for any of them:** not usable through this repo — there is no MCP server to connect to (table row 1).
---

## 5. Tools agents can actually invoke

**A. Host tool permissions (the effective toolset)**
- Conductor (both platforms): `task` (43 allow patterns, `"*": deny`), `bash: allow`, `edit: deny`, `websearch/webfetch: allow` (`orchestra.md:59-62`; identical in `autonomy.json:142-150` + `skill: { "*": deny, orchestra-loop: allow, prompt-intake: allow }`).
- Phase agents: planner/verifier/reviewer `edit: deny` + `bash: allow` (+ `task: deny`, websearch/webfetch allow in `autonomy.json:160-231`); **implementer `edit: allow`** (`autonomy.json:181`).
- Global OpenCode: `permission["*"] = allow`, `task: allow`, `websearch/webfetch: allow`, `skill` deny-by-default with **4 allowed** (`orchestra-loop`, `verification-before-completion`, `prompt-intake`, `greenfield-product`) + `internal-*: deny` (`autonomy.json:76-86`).
- No agent declares a `tools:` list → tool surface = harness defaults ∩ permission blocks.

**B. Skills (in-repo "capability packs")**
- `bundle/skills/` = **38** top-level folders; `bundle/opencode/skills/` = **39** (extra: `setup` — **Cursor/OpenCode skill-set mismatch**); `bundle/skills-cursor/` = **17** Cursor built-ins (`babysit, canvas, create-hook, create-rule, create-skill, create-subagent, loop, migrate-to-skills, review, review-bugbot, review-security, sdk, shell, split-to-prs, statusline, update-cli-config, update-cursor-settings`).
- Categories of the 38: **orchestration/intake** (orchestra-loop, prompt-intake, verification-before-completion, greenfield-product, grill-me, grill-with-docs); **security** (full-spectrum-security, offensive-defensive-security, security-compliance, policy-legal); **UI/design** (brand, design-system, design-taste-frontend, frontend-design, ui-styling, ui-ux-pro-max, web-design-master); **Cloudflare/workers** (cloudflare, cloudflare-email-service, cloudflare-one, cloudflare-one-migrations, durable-objects, workers-best-practices, wrangler, turnstile-spin, agents-sdk, sandbox-sdk); **data/ML** (ai-ml-pipeline, data-pipeline, linguistic-analysis); **ops/content** (deployment-ops, performance-engineering, web-perf, testing-qa, research-innovation, content-documentation, customer-success, n8n-workflow-patterns).
- **Executable skill code = 25 scripts in 5 skills:** `ui-ux-pro-max/scripts/{search,core,design_system,validate_data}.py`, `ui-styling/scripts/{tailwind_config_gen,shadcn_add}.py`, `design-system/scripts/{validate-tokens,generate-tokens,embed-tokens}.cjs + 4 .py` (incl. **`fetch-background.py`**), `brand/scripts/*.cjs` ×4, `turnstile-spin/scripts/{worker-deploy,widget-create,validate,persist-skill,fetch-secret,auth-probe}.sh` (**worker-deploy.sh deploys to Cloudflare**).

**C. Shell CLIs in-repo**
- `scripts/` = **25 files**: `conductor-state.sh`, `session-claims.sh`, `init-context/init-project(.sh/.ps1)`, `merge-autonomy-config.js`, `sync-opencode-agents.js`, `slim-enterprise-agents.js`, `update-free-models.sh`, `setup-{cursor-model,cursor-byok,opencode-optimal,opencode-proxy,repo-scoping}`, `fix-opencode-response.sh`, `diagnose-opencode.sh`, `opencode-maintenance.sh`, `watch-plan-signal.sh`, `ensure-opencode-latest(.sh/.ps1)`, `sanitize-opencode-config.js`, `test-{adaptive-loop,conductor-state,state-manager-compat}.js`; `scripts/lib/` (opencode-version, opencode-config-sanitize, opencode-token-profile, + **re-export shim** `orchestra-spawn-matrix.js` → `require("../../bundle/hooks/lib/…")`, 179 bytes); `scripts/systemd/{pcore-free-models.service,timer}`.
- Health CLIs documented: `node ~/.cursor/hooks/orchestra-health.js`, `orchestra-enable.js status|tokens|memory|stop`, `node ~/.config/opencode/hooks/orchestra-health-opencode.js` (`AGENTS.md:82-87`).

**D. In-repo tool runner (executed by hooks, not by a model)**
- `bundle/hooks/lib/evidence-runner.js` — `runCmd()` `spawnSync` with 60s timeout; runs `npm run build`/tests/lint before verify (called from `orchestra-subagent-stop.js:260` `runEvidenceChecks`).
- `hooks/lib/security-scanner.js` — regex secret/vuln rules (Stripe/GitHub/AWS keys, `eval(`, `innerHTML`, MD5…), file-system only.
- `hooks/lib/{quality-gate,phase-commit-gate,token-tracker,memory-manager,checkpoint-manager,plan-artifact,cycle-report}.js` — state/gate bookkeeping. `bundle/hooks` = 11 hook entry files + 41 `lib/` modules; `bundle/opencode/hooks` mirrors them (verified **identical hash** for `orchestra-subagent-stop.js`, `orchestra-lib.js`, `lib/handoff-enforcer.js`, `lib/phase-engine.js`, `lib/orchestra-spawn-matrix.js`; `orchestra-prompt.js` differs slightly).

**E. Dangerous / high-privilege surfaces & permission control**
- `bundle/config/cursor/cli-autonomy.json` → merged to `~/.cursor/cli-config.json` (`merge-autonomy-config.js:78-111`): `"allow": ["Shell(**)","Read(**)","Write(**)","Delete(**)","WebFetch(**)","WebSearch(**)","Mcp(*:*)","Task(**)","GenerateImage(**)"]`, **`"deny": []`**, **`"approvalMode": "unrestricted"`**, `"autoAcceptWebSearch": true`, `"webFetchDomainAllowlist": ["*"]`, **`"sandbox": {"mode": "disabled"}`**.
- `bundle/config/cursor/sandbox.json` → `~/.cursor/sandbox.json` (separate merge L141-173): `"type": "workspace_readwrite"`, `additionalReadwritePaths` = `$HOME/.cursor/{hooks,skills}`, `$HOME/.agents/skills`, **`$HOME/.config/opencode`** (agent-writable installed config), `networkPolicy.default: "allow"` denying only `169.254.169.254` + `metadata.google.internal`. ⇒ two conflicting sandbox directives in the bundle (CLI `disabled` vs `workspace_readwrite`) landing in two different config files.
- `bundle/config/cursor/permissions.json` → `~/.cursor/permissions.json`: `terminalAllowlist` = 57 commands incl. **`curl`, `wget`, `docker`, `Remove-Item`, `pwsh`, `cmd`, `git`, `gh`**; `mcpAllowlist` 9 entries; `autoRun.allow_instructions` (8) vs `block_instructions` (6: force-push, mass deletion, prod DB, secrets/SSH, Cursor/OS security settings, ssh/kubectl) — soft natural-language steering only, no code enforcement in-repo.
- OpenCode `autonomy.json` permission: `bash["*"]="allow"` with **13 explicit denies** (`git push --force`, `git reset --hard`, `rm -rf /|~`, `git clean -fdx`, `mkfs.*`, `dd of=/dev/*`, `shred`, fork-bomb); `read/edit` deny `*.env`, `*.env.*`, `**/.ssh/**`, `**/credentials.json`; `external_directory["*"]="allow"` incl. **`~/.config/opencode/**`** (self-modification of its own config); `doom_loop: deny`.

---

## 6. Agent-to-agent: conductor spawn flow, parallelism, handoff

**Spawn flow**
- **OpenCode (conductor-driven, sequential):** `orchestra.md:180-191` — `Loop — Core Mode (strict order — one task at a time)`: task → planner (`PLAN_READY`) → [design/planning inserts] → task → implementer (`IMPLEMENT_DONE`, committed) → task → verifier (`VERIFY_PASS/FAIL`) → task → reviewer (`ORCHESTRA_COMPLETE`), with `conductor-state.sh save` after each phase. Full-delivery = 8 sequential phases (`orchestra.md:193-254`); VERIFY_FAIL → implementer again, **max 3 fix loops** (L246-249); missing token → resume same `task_id`, **max 5** (L251-253).
- **Cursor (hooks-driven chaining):** `bundle/hooks.json` — `beforeSubmitPrompt` → `orchestra-prompt.js` (classifier + `additional_context` injection, L165-213); `subagentStop` (matcher = 27 agent names, **`loop_limit: 12`**) → `orchestra-subagent-stop.js` → emits `followup_message` "Launch **<nextAgentId>**… Phase N of M" + handoff (L286-296); abort at "Orchestra hit max iterations" (L230-232); `stop` → `orchestra-stop.js` + `orchestra-heartbeat.js` (stall nudge, `followup_message` L67-76); `orchestra-memory.js` / `orchestra-quality-gate.js` append `additional_context`.
- Iteration constants: `DEFAULT_MAX_ITERATIONS = 8`, `STOP_NUDGE_LOOP_LIMIT = 3` (`hooks/lib/constants.js:16,26`) — distinct from the conductor's prose "5 resumes".
- State: single goal per workspace (`~/.cursor/hooks/state/orchestra.json`, "One global goal at a time" `orchestra-loop.mdc`); isolation-keyed runs via `conductor-state.sh` (`orchestra.md:167-178`).

**Parallelism — none at execution level**
- `Promise.all|parallel|concurrent|for await` across `bundle/hooks/**` = **1 hit**: `lib/token-tracker.js:385` prose *"Grep with head_limit before reads; batch parallel file reads"*. All `async` in hooks is only `readStdinJson()` (stdin). Every hook is a single sequential stdin→stdout process; no worker/fork/queue.
- Parallelism exists **only as prompt text**: `orchestra.md:134-135` "Tracks run in parallel where independent", `:203` "Spawn in parallel or sequence as needed"; `references/orchestra-spawn-matrix.md:90-99` "Parallel? Yes" column; research doc lists **"Parallel implementers / Worktree orchestration" as P4 unimplemented** (`docs/agent-orchestra-rag-research.md` P4 row, P5 "Full graph orchestration — LangGraph/AutoGen … only if enterprise customers need DAG").

**Handoff**
- `bundle/hooks/lib/handoff-enforcer.js` (74 lines): `MAX_HANDOFF_CHARS = 2500` (L4), `HANDOFF_RULES` (L7-13: goal 1 line + 3-5 plan bullets + prior failures; **no chat history/tool logs/file contents**; no edits between phases; commit gate), `buildPhaseHandoff(state, nextAgentId)` (L18-46: goal, "Auto-continue: spawnLine(cursor, next)", last 3 `phases_completed`, last 3 `errors`, plan line, commit-gate line), `validateHandoffCompact` / `handoffWarningBlock` (L49-66).
- **Usage:** `orchestra-subagent-stop.js:23` (phase chain message), `orchestra-prompt.js:19` (over-length warning on user prompt, L196-199), `lib/context-detector.js:10,20` (`handoffBlock("cursor")` context injection), `lib/orchestra-spawn-matrix.js:55` (`handoffBlock`), tested by `scripts/test-adaptive-loop.js:167`. Mirrored byte-identically in `bundle/opencode/hooks/lib/`.
- Contract doc: `orchestra-spawn-matrix.md:114-116` "Handoff (both) — Goal (1 line) + plan bullets + prior failures only."
---

## 7. Explicit NOT-implemented / NOT-present statements (consolidated)

1. **AI gateway / provider adapter / model router for inference — NOT PRESENT.** 0 HTTP client calls, 0 `fetch`, 0 provider endpoints in code; only catalog fetch (`opencode.ai/zen/v1/models`), static config, prose policy, and an optional external litellm launcher.
2. **In-repo HTTP server — NOT PRESENT** (0 `createServer`/`listen`) ⇒ no bridge, no API, no webhook receiver.
3. **MCP server (tools/resources/prompts/transport/auth) — NOT PRESENT**; roadmap-only (`agent-orchestra-rag-research.md` P4). Bundle ships **no** `mcp` config — it only *preserves* a user's existing `mcp` and can *disable* remote entries.
4. **Parallel agent execution — NOT IMPLEMENTED** (prompt-only; no `Promise.all`/queue/worker in hooks).
5. **G1–G8 quality-gate machinery from the spawn matrix — NOT IMPLEMENTED** under those ids (code uses a different 14-name `QUALITY_GATES` list).
6. **Claude Code / Codex / Copilot integration beyond documentation — NOT IMPLEMENTED** (no `.claude/`, `.codex/` dirs; installer targets only `~/.cursor` + `~/.config/opencode`).
7. **Registry consistency — BROKEN:** four conflicting inventories (35 doc / 43 allowlist / 27 hook-matcher / 167 config entries / "104" in agent-selector) vs **155** actual numbered-category agents; plus conductor↔agent end-token mismatches (`TEAM_SELECTED` vs `AGENTS_SELECTED`, `WORKFLOW_PLAN_READY` vs `WORKFLOW_ORCHESTRATED`) and stale reference docs registered as hidden agents.
8. **`pickCacheModels`/`pickOfflineModels` in `merge-autonomy-config.js` — dead code**, with an undeclared `reachableLight` reference at L236.

---

## 8. Verification Log (2026-10-02 spot-check)

| Claim | Re-check method | Result |
|---|---|---|
| 155 numbered agents / 165 total per tree | `Get-ChildItem bundle/agents -Recurse -Filter *.md` + dir-name `^\d{2}` filter | **155** under numbered dirs; core = `orchestra{,-planner,-implementer,-verifier,-reviewer}.md`; refs = 5; dirs = 37 → total **165**; `bundle/opencode/agents` = **165** |
| `tools:` key absent | `Select-String '^tools:'` over both trees | **0** |
| `hidden: true` absent from agent frontmatter | `Select-String 'hidden:\s*true'` over both agent trees | **2 hits, both docs**: `references/orchestra-spawn-matrix.md:21` + mirror (confirms doc↔file mismatch) |
| 43 task-allow patterns | read `bundle/agents/orchestra.md:13-62` | L15 `"*": deny`; **L16-58 = 43** `allow` patterns; L59-62 bash/edit/websearch/webfetch |
| Skill counts | directory counts | **38** `bundle/skills` / **39** `bundle/opencode/skills` (+`setup`) / **17** `skills-cursor` |
| `readonly: true` coverage (Cursor) | `Select-String '^readonly: true'` over `bundle/agents` | **156** matches (= 152 numbered + conductor + 3 phase agents; consistent with 3 numbered agents lacking it) |
| End-token mismatches | `Select-String 'End with'` on workflow agents | `AGENTS_SELECTED` (`agent-selector.md:58`), `WORKFLOW_ORCHESTRATED` (`workflow-orchestrator.md:57`), `PROJECT_CLASSIFIED` (`project-type-classifier.md:56`) — first two contradict conductor `orchestra.md:132,134` |
| Iteration constants | `Select-String` on `hooks/lib/constants.js` | `DEFAULT_MAX_ITERATIONS = 8` (L16), `STOP_NUDGE_LOOP_LIMIT = 3` (L26) |
| G1–G8 gates | `Select-String '^\| G'` on spawn-matrix doc | 8 doc rows G1–G8; no code counterpart |

**Environment limitation:** `rg` unavailable (verified `Get-Command rg` → not found; no ripgrep under cargo/choco/scoop). All searches used the built-in Grep tool or `Select-String` — equivalent regex semantics, scoped to this repo root per `AGENTS.md` performance rules.
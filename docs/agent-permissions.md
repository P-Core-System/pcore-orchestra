# Agent permissions — OpenCode permission model (v2.0.29)

Reference facts verified via `opencode debug agents` at OpenCode `v2.0.29`.

## Scope

This doc covers **OpenCode** agent/conductor permission behavior only. Cursor side
(`bundle/config/cursor/`, `bundle/hooks/**`) is byte-identical across hosts and is
**not** touched by the RC1–RC5 permission fixes — see `docs/orchestra-cross-platform.md`.

## (a) Frontmatter syntax rule + why V1 is the repo standard

### Rule

OpenCode agent markdown carries permission declarations in **two places**, and they are
not interchangeable:

| Location | Shape | Status | Notes |
|----------|-------|--------|-------|
| Frontmatter | V1 object `permission: { edit: "deny", ... }` | **Repo standard** | Honored on all agent files |
| Config (`autonomy.json` `agents.*.permissions[]`) | V2 array of `{action, resource, effect}` | Config standard | Honored **only when `name:` is absent** |

### Why V1 frontmatter is the standard

All 160 agents carry a `name:` field. In OpenCode `v2.0.29`, **V2 permissions arrays
are honored ONLY when `name:` is absent** — because every agent has `name:`, every V2
array in agent frontmatter is silently dropped. V1 `permission:` objects in frontmatter
are the only reliable per-agent declaration.

The `tools:` key is **deprecated since v1.1.1**; its aliases weaken deny precision
(`write` → `edit`), so `tools:` is not used anywhere in the agent tree (0 occurrences
across all 160+160 agent `.md` files).

**Takeaway:** per-agent permission behavior goes in V1 `permission:` frontmatter;
global/broad policy goes in V2 `permissions[]` in `autonomy.json` (native config V2).

## (b) ID-namespacing rule for conductor allowlist

### Rule

The conductor `permission.task` allowlist must match real agent **`dir/name` IDs**, not
bare names. Allowlist entries are namespaced globs such as `05-implementation/*`,
`orchestra-*`, `00-workflow/*`, etc.

### Why

In the RC1 conductor config, bare-name globs (e.g. `backend-engineer`, `security-engineer`)
matched **0/42** specialists — OpenCode resolves agent IDs as `dir/name`, so bare names
never resolved. Switching to namespaced globs (`dir/*`) achieved **160/160** coverage.
Any new agent added to `bundle/opencode/agents/` must therefore be added to the conductor
allowlist under its `dir/*` namespace (regenerated from `bundle/agent-registry.json` by
`scripts/gen-agent-registry.js` between BEGIN/END markers — additive only).

## (c) Precedence property — agent DENY beats global allow

### Property

**Agent-level DENY beats a later global allow.** When an agent frontmatter carries
`permission: { edit: "deny" }` and the global config also allows `edit: "*": allow`,
the agent-level deny wins for that agent.

### What NOT to do

Do **NOT** pin the resolution chain. Cold vs warm reload disagreed on whether agent-level
or global rules resolve first, so the only safe contract to test is the **property**
(agent deny beats global allow), not a particular chain order. Tests should assert the
property end-to-end rather than assuming cold-warm resolution order.

## (d) Deferred tech debt

| Item | Status | Gate |
|------|--------|------|
| Frontmatter V2-array migration (convert `permission:` objects to `permissions[]` arrays in agent markdown) | **Deferred** | Gated on an upstream OpenCode fix for the `name:` legacy-loader drop (arrays silently dropped while `name:` present) |

Until upstream fixes `name:`, V1 frontmatter `permission:` remains the only reliable
per-agent form; do not migrate agent frontmatter to V2 arrays.

## (e) RC1–RC5 summary table

| RC | Change | What it fixed |
|----|--------|---------------|
| **RC1** | ID-namespaced conductor allowlist (bare names → `dir/*` globs) | `permission.task` allowlist matched 0/42 specialists; namespaced globs achieve 160/160 |
| **RC2** | Frontmatter syntax standardization (V1 `permission:`; `tools:` dropped; V2 arrays only in config) | V2 arrays silently dropped on all 160 `name:`-carrying agents; V1 frontmatter is the reliable form |
| **RC3** | Deny-first root strip: `"*": deny` first rule, keep `read*` allow + `shell* allow` | Prevents prompt loops (builtin bash default is ask; stripping read/shell causes re-prompt loops) |
| **RC4** | Default-export plugin `{id, setup}` via `ctx.session.hook("context")` + SystemPart; `install.sh`/`install.ps1` MUST copy `bundle/opencode/plugins/` | Orchestra-ambient plugin now ships and registers on install |
| **RC5** | Observability log fail-open: input/spawn/permission events; byte-identical hooks/lib mirrors | `harness-observability.js` logs `input.received`, `input.classified`, `spawn.attempted`, `spawn.result`, `permission.denied` to `harness-observability.json` (ring-capped, fail-open, PCORE_STATE_DIR-aware) |

## Files owned

- `bundle/config/opencode/autonomy.json` — OpenCode native-V2 autonomy profile (agents/permissions/providers)
- `bundle/opencode/hooks/lib/harness-observability.js` — RC5 observability log (byte-identical mirror at `bundle/hooks/lib/harness-observability.js`)
- `bundle/opencode/agents/orchestra.md` — conductor agent (deny-first `permission.task` allowlist)
- `scripts/gen-agent-registry.js` / `bundle/agent-registry.json` — SSOT that regenerates the conductor allowlist

## Do not touch

- Cursor files under `bundle/config/cursor/`, `bundle/hooks/`, `bundle/agents/` (Cursor side) — byte-identical, out of scope for OpenCode permission fixes
- `~/.config/opencode` and `~/.cursor` installed state — install-time only

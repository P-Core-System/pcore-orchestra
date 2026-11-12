# UX Tokens + Patterns Gap-Fill

R&D-side UX rule (enforced by the `team-researcher` agent): tokens first,
patterns only where missing.

## Tokens (DTCG 3-tier)

Source of truth: `templates/architectures/25-design-tokens.md`.
Tier 1 primitives → Tier 2 semantic → Tier 3 component (only on
divergence). Themes swap the semantic layer only. Any new token ships
DTCG `$value`/`$type` JSON through the Style Dictionary pipeline —
never a bare hex in a component.

## Pattern inventory (what already exists — never restyle)

| Source | Covers |
|--------|--------|
| `bundle/skills/ui-ux-pro-max/` | product UX flows, `search.py` research |
| `bundle/skills/design-system/` | component contracts |
| `bundle/skills/ui-styling/`, `frontend-design`, `design-taste-frontend` | styling, taste |
| `templates/architectures/22-ui-ux.md`, `24-ui-component.md`, `28-web-design-master.md` | structure guidance |

## Gap-fill process

1. Researcher names the missing pattern + the inventory entries checked.
2. Proposal references Tier 2 semantic tokens only (no new primitives
   unless Tier 2 cannot express it — then primitives ship first).
3. Lands as a whitepaper (`docs/whitepapers/`), human-gated per order.
4. Only `approved` patterns enter the codebase, via a normal plan →
   implement → verify → review loop.

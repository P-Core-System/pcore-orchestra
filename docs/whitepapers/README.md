# Whitepapers

Human-gated R&D output, one file per order (`<slug>.md` from
`templates/whitepaper.md`).

Gate: every whitepaper lands as `Status: pending`. A human approves per
order (approve = flip to `approved` with name + date). Approval never
auto-applies — no code path edits product files, docs, or prompts from a
whitepaper; a phase agent reads `approved` rows and edits files itself.

R&D rules (see `team-researcher` agent):
- Official sources only (docs, registry metadata, release notes).
- Latest stable versions, verified live (`npm view`, PyPI JSON, GitHub
  releases) — never alpha/beta/rc unless the order pins it.
- Ranked with `team-research.js` `pickBest` (margins shown).
- UX: DTCG 3-tier tokens first, patterns gap-fill only.

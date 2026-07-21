# Progress Tracker

Update this file after every meaningful implementation change.

## Current Phase

- V3.3.3 closed — informal core inference + complexity precedence verified

## Current Goal

- Short/informal prompts run core plan→implement→verify→review; complexity still enterprise

## Completed

- V3.2 adaptive loop; V3.3 OpenCode mirrors / evidence gates / intake+verify skills / specs templates
- V3.3.1 install `lib/` replace fix; slim enterprise agents
- V3.3.2 dogfood specs, health adaptive checks, agents-skills links
- **V3.3.3**
  - Short/informal (`fix it`, `pls`, `next improve`) → core + `informal_inferred`
  - Complexity beats informal (`migrate architecture`, `security audit` → enterprise)
  - Tests: startOrchestra core→plan; docs synced (no clarify-block route)
  - Prompt hook + planner expand informal goals from progress-tracker/git

## Next Up

1. Restart Cursor to load V3.3.3 hooks
2. Optional: further agent `references/` split for identity one-liners
3. Optional: OpenCode `opencode.json` example with `steps` + `doom_loop` + task allowlist

## Open Questions

- `project.yaml` vs `project.json`?

## Architecture Decisions

- Install replaces directory trees; never nest `lib/lib`
- Core ambient default; enterprise opt-in
- Short/informal → infer from context (do not clarify-block)
- Evidence gates on final review only

## Application Building Context

Read the following files in order before implementing
or making any architectural decision:

0. `project.yaml` — project identity, version, lifecycle
   stage, team, and stack definition
1. `context/project-setup.md` — onboarding guide, version/lifecycle
   management, and daily workflow
2. `docs/architecture/` — architecture templates matching
   the project type (auto-scaffolded by init-project)
3. `context/project-overview.md` — product definition,
   goals, features, and scope
4. `context/architecture.md` — system structure,
   boundaries, storage model, system design &
   infrastructure, and invariants
5. `context/ui-context.md` — theme, colors, typography,
   and component conventions
6. `context/code-standards.md` — implementation rules
   and conventions
7. `context/ai-workflow-rules.md` — development workflow,
   scoping rules, and delivery approach
8. `context/progress-tracker.md` — current phase,
   completed work, open questions, and next steps
9. `context/specs/` — optional unit specs (one file per
   feature); see `specs/README.md`

Update `context/progress-tracker.md` after each
meaningful implementation change.
Update `project.yaml` lifecycle stage and version when
the project advances through SDLC phases.

If implementation changes the architecture, scope, or
standards documented in the context files, update the
relevant file before continuing.

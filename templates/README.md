# Six-File Context templates

Blank templates from the **Six-File Context Methodology** (JavaScript Mastery). Use `scripts/init-context.sh` to copy these into any project as `context/` + root `AGENTS.md`.

Do not edit these for project-specific content — fill copies in the target repo instead.

| File | Purpose |
|------|---------|
| `context/project-overview.md` | Product, goals, scope |
| `context/architecture.md` | Stack, boundaries, invariants |
| `context/code-standards.md` | Implementation conventions |
| `context/ui-context.md` | Design tokens, components |
| `context/ai-workflow-rules.md` | Agent behavior rules |
| `context/progress-tracker.md` | Phase, completed, next steps |
| `project-setup.md` | Onboarding guide — version/lifecycle management, daily workflow, context maintenance |
| `AGENTS.md` | Entry point — read order for coding agents |

See the methodology README in your download for AI prompts to generate each file's content.

For `project.yaml`, architecture templates, and project identity scaffolding, use `scripts/init-project.sh`.

## Architecture templates (2026 additions)

| Template | Topic |
|----------|-------|
| `architectures/25-design-tokens.md` | Design tokens — W3C DTCG 3-tier (primitives → semantic → component) |
| `architectures/26-folder-structure.md` | Feature-based modules, single-package & monorepo with per-package AGENTS.md |
| `architectures/27-system-design.md` | C4-lite system design doc (Context, Container, data flows, NFRs, ADRs) |
| `AGENTS.authoring.md` | How to write `AGENTS.md` for OpenCode / Cursor / Claude / Copilot / Codex |

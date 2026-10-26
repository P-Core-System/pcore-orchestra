# UI Context

This repository has one product UI: the local **Studio** dashboard (`studio/`, React + Vite + Tailwind). The rest of the repo ships CLI install scripts, Node hook scripts, and Markdown agent definitions.

## Studio UI

- **Read-only dashboard** served by `server/studio-api.js` on `127.0.0.1`; it visualizes work items, runs, gates, evidence, reviews, tokens, and the phase graph.
- **Tokens:** DTCG three-tier model in `studio/src/styles.css` — primitive CSS variables → semantic aliases (`--color-semantic-success|warning|error|info`) → component classes. Light mode is the `:root` default; dark mode is the `.dark` class.
- **Components:** shadcn-style primitives over Tailwind; keep status color semantics stable (success = pass, warning = fix required, error = fail).
- **Accessibility:** keyboard reachable, visible focus rings, WCAG AA contrast in both themes.

## Docs presentation (when editing README or future docs site)

| Token | Value | Use |
|-------|-------|-----|
| Primary | `#6366f1` | Links, emphasis in diagrams |
| Success | `#22c55e` | Health check pass, VERIFY_PASS |
| Warning | `#f59e0b` | FIX_REQUIRED, opt-out hints |
| Error | `#ef4444` | VERIFY_FAIL, install errors |
| Muted | `#64748b` | Secondary text |

## Markdown conventions

- Tables for install paths and command reference.
- Code fences with language tags (`bash`, `powershell`, `json`).
- Mermaid optional for phase flow in README.

## Target projects

When bootstrapping UI apps via `init-context.sh`, developers fill `ui-context.md` in **their** repo using `templates/context/ui-context.md`. Orchestra does not generate UI tokens automatically.

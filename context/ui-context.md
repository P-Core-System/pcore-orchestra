# UI Context

This repository has no product UI. It ships CLI install scripts, Node hook scripts, and Markdown agent definitions.

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

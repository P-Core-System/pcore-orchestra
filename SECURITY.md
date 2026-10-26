# Security Policy

## Supported Versions

Orchestra is a developer tool installed globally on your machine. Security fixes are applied to
`main` and distributed through the repository (no tagged releases yet).

| Version | Supported |
|---------|-----------|
| latest (main) | ✅ |

## Reporting a Vulnerability

**Do not open a public issue for security vulnerabilities.**

Please report security concerns privately:

- **GitHub Security Advisories**: Use the "Report a vulnerability" button on the repository
- **Email**: Contact the repository owner through GitHub

Include:
- A clear description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if you have one)

We will acknowledge receipt within 72 hours and provide a timeline for resolution.

## What We Scan

Orchestra runs a self-contained secret scan on every change:

- `scripts/scan-secrets.js --dir . --fail-on=high` — blocks on critical/high findings
- Runs in CI (`.github/workflows/ci.yml`) and in-loop via `evidenceSecurity` gate
- Both use the same `security-scanner.js` so they can never disagree

## Known False Positives (Allowlisted)

Some findings are intentionally allowlisted in `.secret-scan-allow`:

| File | Rule | Reason |
|------|------|--------|
| `bundle/hooks/lib/security-scanner.js` | `private key` | Scanner holds RSA/SSH header literals its own rules search for |
| `bundle/hooks/lib/phase-outcome.js` | `exec() call` | `RegExp.prototype.exec()`, not `child_process` |
| `scripts/gen-agent-registry.js` | `exec() call` | Same regex-exec false positive |
| `scripts/test-security-scanner.js` | Multiple | Synthetic fixtures the scanner test suite feeds to prove detection |
| `docs/audit/*.md` | Multiple | Audit reports quote scanner rule regexes |
| `bundle/skills/*/` | Various | Vendored third-party documentation with API-key examples |

All allowlist entries carry a documented reason and a narrow `file:` + `label:` scope. Blanket directory allowlists are not used for executable trees.

## Dependency Updates

Orchestra follows the **latest stable only** policy:

- Libraries, tools, frameworks, and runtimes are pinned to latest stable releases
- No alpha/beta/rc/next/dev/canary unless user-requested or project-pinned
- `npm audit fix` is run regularly to resolve vulnerabilities
- Free OpenCode models are refreshed weekly via `scripts/update-free-models.sh --refresh --apply`

## Responsible Disclosure

We follow responsible disclosure practices. Security researchers who report vulnerabilities in good faith will be credited (if desired) and we will work with you on a coordinated fix timeline.

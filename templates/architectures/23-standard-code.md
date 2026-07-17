# Standard Code Architecture
*Coding Standards — Linting — Type Safety — CI Gates — Documentation — Review*

**Type mapping:** `type: all` (applies to every project)
**Category:** Code quality & developer workflow

## Project Structure

```text
project-root/
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                   # Lint → Typecheck → Test → Build
│   │   ├── quality-gate.yml          # Code quality gate (blocking)
│   │   └── release.yml              # Version bump + publish
│   └── CODEOWNERS                    # Ownership per path
│
├── .husky/
│   ├── pre-commit                   # Lint-staged
│   ├── commit-msg                   # Commitlint validation
│   └── pre-push                     # Typecheck + test
│
├── src/                              # Source code
│   ├── index.ts
│   ├── types/                        # Shared type definitions
│   │   ├── global.d.ts
│   │   └── vendor.d.ts
│   ├── lib/                          # Internal utilities
│   │   ├── errors.ts
│   │   └── logger.ts
│   └── __tests__/                    # Test mirror hierarchy
│
├── scripts/                          # DevOps / tooling scripts
│   ├── check-types.sh
│   ├── validate-deps.sh
│   └── generate-docs.sh
│
├── docs/                             # Project documentation
│   ├── architecture/
│   ├── api/
│   ├── contributing.md
│   └── style-guide.md
│
├── .editorconfig                     # Editor consistency
├── .gitignore
├── .prettierrc                       # Formatting
├── .eslintrc.cjs                     # Linting rules
├── .lintstagedrc.cjs                 # Lint on stage
├── commitlint.config.cjs             # Commit message convention
├── tsconfig.json                     # TypeScript strict mode
├── tsconfig.paths.json               # Path aliases
├── vitest.config.ts                  # Test configuration
├── package.json
└── README.md
```

## Architectural Overview

Standard Code Architecture defines the universal rules, tooling, and conventions every project follows regardless of domain. It enforces consistency, reduces cognitive load, and bakes quality into the development loop.

```text
[ Developer Writes Code ]
    │
    ▼
[ Pre-commit Hook ]
    ├── Format (Prettier)
    ├── Lint (ESLint)
    └── Lint-staged (staged files only)
    │
    ▼
[ Commit Message Validation ]
    ├── Commitlint (Conventional Commits)
    └── Blocked if: invalid format, missing scope
    │
    ▼
[ Pre-push Hook ]
    ├── TypeCheck (tsc --noEmit)
    └── Unit Tests (vitest related)
    │
    ▼
[ CI Pipeline (GitHub Actions) ]
    ├── 1. Install dependencies
    ├── 2. Lint all files
    ├── 3. TypeCheck all files
    ├── 4. Run full test suite + coverage
    ├── 5. Build / Bundle
    ├── 6. Security scan
    ├── 7. Quality gate (coverage %, lint errors, vulns)
    └── 8. (Optional) E2E tests, visual regression
    │
    ▼
[ Pull Request ]
    ├── Required: CI green
    ├── Required: Code review approval
    ├── Required: No unresolved conversations
    └── Auto-merge on pass (optional)
    │
    ▼
[ Merge → Release Pipeline ]
    ├── Conventional commit analysis → semver bump
    ├── Changelog generation
    └── Publish to registry / deploy
```

## Integration with Project Identity

```yaml
project:
  type: web
  name: my-project
  display_name: "My Project"

stack:
  languages:
    - typescript
  frameworks: []
  databases: []
  package_manager: pnpm
  runtime: node

integrations:
  ci_cd: github-actions
  monitoring: ""
  analytics: ""

quality:
  linting: eslint
  formatting: prettier
  type_checking: tsc-strict
  testing:
    unit: vitest
    e2e: playwright
    coverage_threshold: 80
  commit_convention: conventional-commits
  hooks: husky
```

## Standards

### 1. Code Formatting (Prettier)

Every file must pass Prettier formatting. No debate on style — automated.

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "arrowParens": "always"
}
```

### 2. Linting (ESLint)

- **`@typescript-eslint/strict-type-checked`** — Full strict mode
- **`import/order`** — Enforce import order: external → internal → relative
- **`no-console`** — Warn (allow `logger.info()`)  
- **`no-unused-vars`** — Error (allow underscore prefix: `_unused`)
- **`@typescript-eslint/explicit-function-return-type`** — Error for public API, warn for internals

### 3. TypeScript Strict Mode

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "noPropertyAccessFromIndexSignature": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": false
  }
}
```

### 4. Commit Convention (Conventional Commits)

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

| Type | Usage |
|------|-------|
| `feat` | New feature (→ minor bump) |
| `fix` | Bug fix (→ patch bump) |
| `breaking` | Breaking change (→ major bump) |
| `docs` | Documentation only |
| `style` | Formatting only (no logic change) |
| `refactor` | Code change without fix/feature |
| `test` | Adding or updating tests |
| `chore` | Build process, deps, tooling |
| `perf` | Performance improvement |

### 5. Testing Standards

| Layer | Tool | Coverage Target | Required |
|-------|------|----------------|----------|
| Unit | Vitest | ≥ 80% lines | Yes (CI gate) |
| Integration | Vitest + MSW | ≥ 70% lines | Recommended |
| E2E | Playwright | Critical paths | Yes |
| Accessibility | axe-core | 0 violations | Yes (CI gate) |
| Visual | Chromatic/Percy | Changed components | Recommended |

### 6. Code Review Checklist

Every pull request must satisfy:

- [ ] CI pipeline passes (lint, typecheck, test, build, security)
- [ ] No `console.log`, `debugger`, or `TODO` without issue reference
- [ ] Public API exports documented with TSDoc
- [ ] Error handling: no silent catches, meaningful error messages
- [ ] Tests cover the change (new logic requires new tests)
- [ ] No secrets committed (`.env` files, tokens, keys)
- [ ] Types are strict (no `any`, minimal `as` casts)
- [ ] Imports follow the project ordering convention
- [ ] PR description explains WHAT and WHY (not just HOW)

### 7. File Naming Conventions

| Category | Convention | Example |
|----------|------------|---------|
| React components | PascalCase | `UserProfile.tsx` |
| Hooks | `use` prefix, camelCase | `useAuth.ts` |
| Utilities | camelCase | `formatDate.ts` |
| Constants | UPPER_SNAKE_CASE | `API_ENDPOINTS.ts` |
| Types/Interfaces | PascalCase (type preferred) | `UserProfile.ts` |
| Test files | `.test.ts(x)` suffix | `UserProfile.test.tsx` |
| Styles | `.module.css` suffix | `UserProfile.module.css` |
| Config files | kebab-case | `tailwind.config.ts` |

### 8. Dependency Management

- Pin exact versions for production deps (`"react": "18.3.1"`)
- Use `^` for dev deps (allow minor/patch updates)
- Run `pnpm audit` / `npm audit` weekly
- Use `depcheck` to find unused dependencies
- No duplicate packages (enforced by package manager)
- Prefer built-in Node.js APIs over npm polyfills when available

## Setup Sequence

```bash
# 1. Initialize project with TypeScript
pnpm create next-app@latest my-app --typescript
cd my-app

# 2. Install tooling
pnpm add --save-dev \
  eslint @eslint/js typescript-eslint \
  prettier eslint-config-prettier \
  husky lint-staged \
  @commitlint/cli @commitlint/config-conventional \
  vitest @vitest/coverage-v8 \
  depcheck

# 3. Initialize Husky
npx husky init
echo "npx lint-staged" > .husky/pre-commit
echo "npx tsc --noEmit && npx vitest run --changed" > .husky/pre-push
echo "npx --no -- commitlint --edit \$1" > .husky/commit-msg

# 4. Create config files (.eslintrc.cjs, .prettierrc, commitlint.config.cjs, etc.)
# 5. Set up CI workflow in .github/workflows/ci.yml
```

## Key Dependencies

| Package | Purpose |
|---------|---------|
| `typescript` | Strict type checking |
| `eslint` | Code linting |
| `@typescript-eslint` | TypeScript-specific lint rules |
| `prettier` | Code formatting |
| `husky` | Git hooks |
| `lint-staged` | Run linters on staged files |
| `@commitlint/cli` | Commit message validation |
| `vitest` | Unit & integration testing |
| `depcheck` | Unused dependency detection |
| `tsx` | TypeScript execution without build |

## Best Practices

- **Strict mode from day one** — Adding strict mode to an existing codebase is exponentially harder. Start strict.
- **Lint on stage, not on all files** — `lint-staged` runs only on changed files. Fast pre-commit hooks mean developers won't skip them.
- **Every rule has a reason** — If a lint rule is disabled, document why in a comment. No blanket disable comments.
- **TypeScript is your first test** — Strict TypeScript catches more bugs than most unit tests. Leverage the type system before writing tests.
- **Conventional commits automate releases** — Semantic-release or changesets parse commit messages for version bumps and changelogs.
- **Prefer `type` over `interface`** — `type` is more constrained (no declaration merging) which makes it safer for public API boundaries.
- **No `any`, minimal `as`** — `as` casts subvert the type system. Prefer type guards and branded types for runtime validation.
- **Reviewer time is sacred** — Small PRs (< 400 lines) get reviewed faster and more thoroughly. Break large changes into stacked PRs.

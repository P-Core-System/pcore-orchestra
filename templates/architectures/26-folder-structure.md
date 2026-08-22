# Folder Structure Architecture
*Feature-Based Modules — Single Package & Monorepo — Module Boundaries*

**Type mapping:** `type: web`, `type: mobile`, `type: api`, `type: ai`, `type: devops`, `type: library`, `type: saas`, `type: internal-tool`, `type: oss`, `type: cli`, `type: game`, `type: data`
**Category:** Project layout & module boundaries

## Principle: Organize by Feature, Not by Type

Group code by **feature/module** (what the user or domain cares about) instead of by
**type** (controllers/, models/, services/). Type-based layout scatters a single
feature across many folders and becomes unreadable as a project grows. Feature-based
modules keep everything a feature needs in one place and make boundaries explicit.

```text
✅ FEATURE-BASED                 ❌ TYPE-BASED
src/                             src/
  auth/                            controllers/
    login.ts                       auth.controller.ts
    session.ts                     user.controller.ts
    auth.routes.ts                 order.controller.ts
  orders/                          models/
    order.ts                       auth.model.ts
    pricing.ts                     user.model.ts
    orders.routes.ts               services/
  users/                           auth.service.ts
    profile.ts                     order.service.ts
                                   routes/
                                     auth.routes.ts
                                     order.routes.ts
```

A module owns its routes, domain logic, data access, and types. Cross-module
calls go through a public entry point (the module's `index.ts`), never into a
sibling's internals.

## Single-Package Tree

```text
src/
├── modules/                        # feature modules (the boundary unit)
│   ├── auth/
│   │   ├── index.ts                # PUBLIC API — only this is imported elsewhere
│   │   ├── login.ts
│   │   ├── session.ts
│   │   ├── auth.routes.ts
│   │   └── auth.types.ts
│   ├── orders/
│   │   ├── index.ts
│   │   ├── order.ts
│   │   ├── pricing.ts
│   │   └── orders.routes.ts
│   └── users/
│       ├── index.ts
│       └── profile.ts
│
├── shared/                         # cross-cutting, used by many modules (no domain logic)
│   ├── db.ts
│   ├── logger.ts
│   ├── errors.ts
│   └── http.ts
│
├── app.ts                          # composition root — wires modules
├── server.ts                       # entry point
└── AGENTS.md                       # repo-root agent guidance
```

## Monorepo Tree

```text
packages/
├── auth/                           # independent feature package
│   ├── src/
│   │   ├── index.ts                # PUBLIC API
│   │   ├── login.ts
│   │   └── session.ts
│   ├── package.json                # its own versions
│   └── AGENTS.md                   # package-scoped agent guidance
│
├── orders/                         # independent feature package
│   ├── src/
│   │   ├── index.ts
│   │   ├── order.ts
│   │   └── pricing.ts
│   ├── package.json
│   └── AGENTS.md
│
├── shared-ui/                      # shared, no domain logic
│   ├── src/index.ts
│   ├── package.json
│   └── AGENTS.md
│
└── app/                            # the deployable shell
    ├── src/server.ts
    ├── package.json
    └── AGENTS.md

AGENTS.md                           # monorepo-root agent guidance (glob pointers)
package.json                        # workspaces
turbo.json                          # task orchestration
```

### Per-Package AGENTS.md (monorepo)

Each package carries its own `AGENTS.md` so coding agents scope edits correctly.
The root `AGENTS.md` points at them with glob patterns:

```markdown
<!-- repo-root AGENTS.md -->
## Packages
- `packages/auth/**` — auth domain; see packages/auth/AGENTS.md
- `packages/orders/**` — order + pricing; see packages/orders/AGENTS.md
- `packages/shared-ui/**` — presentational only; see packages/shared-ui/AGENTS.md
```

A package `AGENTS.md` keeps it short — what the package owns, its public API, and
hard boundaries (e.g. "orders may import auth; auth must NOT import orders").

## Documenting Module Boundaries

Boundaries belong in each module's **Architecture Notes** (the `## Architecture
Notes` section of its `AGENTS.md`, or `context/architecture.md` for single-package
projects). Record:

- **What the module owns** — the domain it is responsible for
- **Public API** — the only symbols other modules may import (its `index.ts`)
- **Forbidden imports** — which modules it must never reach into
- **Shared vs owned** — what lives in `shared/` vs inside the module
- **Data ownership** — which tables/collections the module exclusively writes

```markdown
## Architecture Notes — orders module
- Owns: order lifecycle, pricing, discounts.
- Public API: `packages/orders/src/index.ts` (OrderService, Pricecalc).
- May import: auth (session), shared/*.
- MUST NOT import: users/profile internals (use auth for identity only).
- Data: writes `orders`, `order_items`; reads `products` (read-only via product API).
```

## Integration with Project Identity

```yaml
project:
  type: web
  name: my-app
  display_name: "My App"

stack:
  languages: [typescript]
  module_strategy: feature-based
  monorepo: false            # or true + workspaces
```

## Best Practices

- **Module = boundary unit** — everything a feature needs lives inside it.
- **One public entry point** — `index.ts` is the only thing other modules import.
- **Document boundaries in Architecture Notes** — unstated boundaries erode.
- **`shared/` is for infra, not domain** — no business logic leaks into shared.
- **Monorepo per-package AGENTS.md** — keep agent scope tight with glob pointers.
- **Forbid cyclic imports** — enforce directionality in CI (e.g. `madge --circular`).
- **Rename-friendly** — feature folders move as a unit; type folders don't.

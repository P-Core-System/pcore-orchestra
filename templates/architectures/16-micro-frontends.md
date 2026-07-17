# Micro Frontends Architecture
*Decompose Frontends by Domain — Independent Teams — Autonomous Deployment*

**Type mapping:** `type: web`, `type: saas`
**Category:** Frontend architecture

## Project Structure

```text
micro-frontends/
├── host/                       # Shell / Container application
│   ├── src/
│   │   ├── shell/              # Layout, navigation, auth
│   │   ├── remote-loader/      # Module federation / iframe loader
│   │   └── shared-context/     # Cross-cutting concerns (auth, theme)
│   ├── webpack.config.js
│   └── package.json
│
├── mfe-header/                 # Micro frontend: Header & Navigation
│   ├── src/
│   │   ├── components/
│   │   ├── hooks/
│   │   └── index.ts
│   └── package.json
│
├── mfe-catalog/                # Micro frontend: Product Catalog
│   ├── src/
│   │   ├── pages/
│   │   ├── components/
│   │   └── services/
│   └── package.json
│
├── mfe-checkout/              # Micro frontend: Checkout
│   ├── src/
│   ├── Dockerfile
│   └── package.json
│
├── mfe-account/               # Micro frontend: User Account
│   ├── src/
│   ├── Dockerfile
│   └── package.json
│
├── shared/                    # Shared library (bundled, not runtime)
│   ├── ui/
│   │   ├── buttons/
│   │   ├── forms/
│   │   └── icons/
│   ├── utils/
│   └── types/
│
├── infrastructure/            # Deployment configs
│   ├── k8s/
│   └── terraform/
├── package.json
└── README.md
```

## Core Concepts

### What are Micro Frontends?

Micro Frontends extend microservices principles to the frontend world. Each micro frontend is an independent, self-contained application that owns a specific business domain (catalog, checkout, account). They are developed, tested, and deployed autonomously by separate teams, and composed at runtime by a shell container.

```text
[ Browser ]
     │
     ▼
[ Shell / Container ] ─── (Layout, routing, auth context)
     │
     ├── [ mfe-header ]  ─── Deployed independently by Team A
     ├── [ mfe-catalog ] ─── Deployed independently by Team B
     ├── [ mfe-checkout ] ── Deployed independently by Team C
     └── [ mfe-account ] ─── Deployed independently by Team D
```

## Integration with Project Identity

```yaml
project:
  type: web
  name: my-mfe-portal

stack:
  languages:
    - typescript
    - javascript
    - css
  frameworks:
    - react
    - vue
    - svelte
    - module-federation
  package_manager: pnpm
  runtime: node

infrastructure:
  cloud: cloudflare
  cdn: cloudflare

environments:
  development:
    url: "http://localhost:3000"
  production:
    url: "https://app.example.com"
```

## Integration Strategies

| Strategy | Description | Pros | Cons |
|----------|-------------|------|------|
| **Web Components** | Each MFE exports native custom elements | Framework-agnostic, future-proof | Limited interop, smaller ecosystem |
| **Module Federation** | Webpack 5 runtime module loading | Shared dependencies, no duplication | Tight Webpack coupling |
| **iframe** | Each MFE in an isolated iframe | Maximum isolation, simple | SEO issues, poor perf, limited UX |
| **Single SPA** | Meta-framework orchestrating MFEs | Framework-agnostic, routing | Extra abstraction layer |
| **Podium** | Server-side composition | Good perf, simple model | Node.js only |

## Key Design Principles

### Autonomous Teams
Each micro frontend is owned by a single team. The team owns the full lifecycle: design, develop, test, deploy, and operate.

### Technology Agnostic
Teams choose their own stack. One MFE might use React, another Vue, another Svelte. The shell composes them regardless.

### Domain Ownership
Each MFE maps to a business subdomain (catalog, checkout, account). No shared code at runtime — duplication is acceptable.

### Independent Deployment
Each MFE has its own CI/CD pipeline. Team A can deploy their MFE without coordinating with Teams B, C, or D.

## Cross-Cutting Concerns

### Communication Between MFEs
- **Events:** Custom DOM events or a shared event bus for loose coupling
- **Shared state:** Auth tokens, user preferences — passed via the shell's context
- **URL state:** Route-based communication (the shell manages routing, passes params down)

### Shared Dependencies
- Use Module Federation's `shared` option to deduplicate frameworks (React, Vue) at runtime
- Avoid sharing business logic — each MFE owns its domain completely
- Share UI primitives via a design system package (versioned, released independently)

### Styling Isolation
- CSS Modules, CSS-in-JS, or Shadow DOM within each MFE
- Design tokens (CSS custom properties) for consistent theming without class collision

## Best Practices

* **Define clear contracts** — Each MFE exposes a well-defined API (props, events, routes). Document these contracts.
* **Start with a monolith, split when it hurts** — Don't start with micro frontends. Slice along team boundaries when coordination costs exceed the complexity of splitting.
* **Keep MFEs coarse-grained** — Each MFE should represent a meaningful business capability, not a single UI component.
* **Invest in the shell** — The shell (container) handles routing, auth, and layout. It must be stable and performant.
* **Test integration points** — E2E tests that verify MFEs compose correctly in the shell.
* **Plan for version drift** — Different MFEs will be on different versions of your design system. Ensure backward compatibility.

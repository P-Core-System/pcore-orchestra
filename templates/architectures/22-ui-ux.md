# UI/UX Design System Architecture
*Design Tokens — Component Library — Accessibility — User Flows — Visual Regression*

**Type mapping:** `type: web`, `type: mobile`, `type: saas`
**Category:** Design system & user experience

## Project Structure

```text
design-system/
├── packages/
│   ├── tokens/                       # Design tokens
│   │   ├── src/
│   │   │   ├── colors.ts
│   │   │   ├── typography.ts
│   │   │   ├── spacing.ts
│   │   │   ├── shadows.ts
│   │   │   ├── breakpoints.ts
│   │   │   ├── motion.ts
│   │   │   ├── borders.ts
│   │   │   └── index.ts              # Composite export
│   │   ├── dist/                     # Generated outputs
│   │   │   ├── tokens.css            # CSS custom properties
│   │   │   ├── tokens.scss           # SCSS variables
│   │   │   ├── tokens.json           # Raw token data
│   │   │   └── tokens.d.ts           # TypeScript types
│   │   └── package.json
│   │
│   ├── icons/                        # Icon library
│   │   ├── src/
│   │   │   ├── assets/               # SVG source files
│   │   │   ├── generated/            # Auto-generated React components
│   │   │   ├── Icon.tsx              # Base Icon component
│   │   │   └── IconSprite.tsx        # SVG sprite variant
│   │   └── scripts/
│   │       └── optimize-icons.ts     # SVG optimization pipeline
│   │
│   ├── components/                   # Component library
│   │   ├── src/
│   │   │   ├── Button/
│   │   │   │   ├── Button.tsx
│   │   │   │   ├── Button.test.tsx
│   │   │   │   ├── Button.stories.tsx
│   │   │   │   ├── Button.module.css
│   │   │   │   └── index.ts
│   │   │   ├── Input/
│   │   │   ├── Modal/
│   │   │   ├── Table/
│   │   │   ├── Tabs/
│   │   │   └── index.ts              # Barrel export
│   │   ├── shared/
│   │   │   ├── polymorphic.ts        # Polymorphic component types
│   │   │   ├── forward-ref.ts        # Ref forwarding helper
│   │   │   └── slot.ts               # Slot composition pattern
│   │   └── package.json
│   │
│   └── theme/                        # Theming engine
│       ├── src/
│       │   ├── createTheme.ts        # Theme factory
│       │   ├── light.ts             # Light theme
│       │   ├── dark.ts              # Dark theme
│       │   ├── high-contrast.ts     # A11y high-contrast theme
│       │   └── ThemeProvider.tsx     # React context provider
│       └── package.json
│
├── apps/
│   ├── storybook/                    # Component showcase
│   │   ├── stories/
│   │   ├── .storybook/
│   │   │   ├── main.ts
│   │   │   ├── preview.ts           # Theme decorator
│   │   │   └── manager.ts
│   │   └── package.json
│   │
│   └── docs/                         # Documentation site
│       ├── content/
│       │   ├── getting-started/
│       │   ├── foundations/          # Color, typography, spacing
│       │   ├── components/           # Component usage guides
│       │   ├── patterns/             # Common UI patterns
│       │   └── accessibility/        # A11y guidelines
│       ├── public/
│       └── package.json
│
├── tools/
│   ├── token-transformer.ts          # Token → platform formats
│   ├── svg-optimizer.ts              # SVG optimization
│   └── visual-diff.ts                # Visual regression runner
│
├── .storybook/
├── turbo.json                        # Turborepo config (monorepo)
├── package.json
└── README.md
```

## Architectural Overview

### Design Token Pipeline

Design tokens are the atomic units of visual design. They flow from a single source of truth to all platforms and frameworks.

```text
[ Design Tokens (TypeScript) ]
    │
    ├── Token Transformer
    │       │
    │       ▼
    │   ┌──────────────────────────────────────────────┐
    │   │  dist/tokens.css   │  dist/tokens.scss   │  dist/tokens.json  │
    │   │  dist/tokens.d.ts  │  dist/tokens.less   │  dist/tokens.swift  │
    │   └──────────────────────────────────────────────┘
    │
    ├── Theme Engine
    │       │
    │       ▼
    │   createTheme({ base, overrides }) → ThemeProvider
    │       │
    │       ├── Light theme (default)
    │       ├── Dark theme
    │       └── High-contrast theme (a11y)
    │
    └── Component Library
            │
            ├── Use CSS custom properties from tokens.css
            ├── Accept theme context from ThemeProvider
            └── Export typed component props
```

### Component Hierarchy

```text
[ Foundation Layer ]
    Design Tokens → Theme → Global Styles

[ Primitive Layer ]
    Button | Input | Select | Checkbox | Radio | Switch | Icon
    → Functional, unstyled or minimally styled
    → Accept `as` prop for polymorphism
    → Forward refs for form libraries

[ Composite Layer ]
    FormField | DataTable | Pagination | DatePicker | Combobox
    → Compose primitives
    → Manage internal state & focus trapping
    → ARIA patterns built-in

[ Pattern Layer ]
    SearchWithFilters | CreateEditForm | SettingsPanel | Wizard
    → Compose composites for domain use cases
    → Provide default layouts & behaviors
    → Customizable via slot props

[ Page / Feature Layer ]
    (Implemented in consuming apps)
    → Compose patterns into pages
    → Connect to data layer (React Query, etc.)
```

## Integration with Project Identity

```yaml
project:
  type: web
  name: my-design-system
  display_name: "My Design System"

stack:
  languages:
    - typescript
    - css
    - scss
  frameworks:
    - react
    - storybook
    - nextjs
  databases: []
  package_manager: pnpm
  runtime: node

environments:
  development:
    url: "http://localhost:6006"
    branch: dev
  staging:
    url: "https://staging--ds.mycompany.com"
    branch: main
  production:
    url: "https://ds.mycompany.com"
    branch: main

integrations:
  ci_cd: github-actions
  monitoring: ""
  analytics: ""
```

## Layer Responsibilities

### 1. Design Tokens

Single source of truth for all visual properties. Tokens are categorized by type and follow a naming convention:

```
{category}-{property}-{variant}-{state}
```
Examples:
- `color-background-primary-hover`
- `typography-heading-lg-weight`
- `spacing-layout-section-gap`

Tooling: Style Dictionary, Tamagui, or custom token transformer.

### 2. Theme Engine

Maps tokens to named themes (light, dark, high-contrast). Supports runtime switching without flicker.

- **CSS custom properties** — Preferred for runtime theming
- **React context** — ThemeProvider injects current theme
- **OS preference** — Respects `prefers-color-scheme` and `prefers-contrast`
- **Override system** — App-level overrides for branding variants

### 3. Component Library

Every component follows a consistent contract:

```typescript
interface ComponentProps {
  className?: string        // CSS-in-JS or module override
  style?: CSSProperties     // Inline style escape hatch
  as?: React.ElementType    // Polymorphic element
  ref?: React.Ref<HTMLElement>
  // Domain props follow
}
```

- **All components accessible** — Keyboard navigation, focus management, ARIA attributes, screen reader support
- **All components tested** — Unit (Vitest/Jest), a11y (axe-core), interaction (Testing Library), visual (Chromatic/Percy)
- **All components documented** — Storybook stories, usage examples, prop tables, migration guides

### 4. Icons

- SVGs optimized via SVGO pipeline
- Auto-generated React components with tree-shakeable exports
- `Icon` base component handles sizing, coloring, and RTL mirroring
- Sprite variant for performance-critical contexts

### 5. Documentation & Showcase

- Storybook for interactive component exploration
- Documentation site for guidelines, patterns, and usage
- Versioned releases matching the consuming app's release cycle

## Accessibility Requirements

| Requirement | Verification |
|---|---|
| WCAG 2.2 AA minimum (AAA preferred) | axe-core, manual audit |
| Keyboard navigation with visible focus | Testing Library user events |
| Screen reader announcements | ARIA live regions |
| Color contrast ≥ 4.5:1 (normal) / 3:1 (large) | Token-level contrast checking |
| Reduced motion support | `prefers-reduced-motion` |
| Zoom to 400% without loss | Responsive testing |
| Focus order matches visual order | Tab-order audit |

## Setup Sequence

```bash
# 1. Create monorepo (Turborepo or Nx)
pnpm create turbo design-system --example with-react
cd design-system

# 2. Add token package
mkdir packages/tokens && cd packages/tokens
pnpm add style-dictionary --save-dev

# 3. Add component package
mkdir packages/components && cd packages/components
pnpm add react react-dom
pnpm add @testing-library/react vitest --save-dev

# 4. Set up Storybook
npx storybook@latest init --type react

# 5. Add visual regression
pnpm add chromatic --save-dev

# 6. Add accessibility testing
pnpm add @axe-core/playwright --save-dev
```

## Key Dependencies

| Package | Purpose |
|---------|---------|
| `react` / `react-dom` | Component rendering |
| `nextjs` | Docs site framework |
| `storybook` | Component showcase |
| `style-dictionary` | Token → platform code |
| `vitest` + `@testing-library/react` | Unit & interaction testing |
| `@axe-core/playwright` | A11y automation |
| `chromatic` / `percy` | Visual regression |
| `svgo` | SVG optimization |
| `turbo` | Monorepo orchestration |
| `tailwindcss` | Utility-first CSS (optional layer) |

## Best Practices

- **Single source of truth** — Tokens define every visual property. No hardcoded colors or spacing in components.
- **Accessibility is not optional** — Every component must pass axe-core before merge. Color contrast validated at token level.
- **Component as code** — Components are versioned, tested, documented, and released like any other package.
- **Semantic versioning** — Breaking visual changes = major version. New components = minor. Patches = bug fixes.
- **Consumption agnostic** — Components don't import from app-specific modules. Data fetching is the consumer's responsibility.
- **Visual regression gate** — PRs must pass visual diff check. Human review required for any pixel change.
- **Theme before component** — Always test new components in all themes (light, dark, high-contrast).
- **RTL support** — Every component must work in both LTR and RTL layouts. Use `padding-inline-start` over `padding-left`.

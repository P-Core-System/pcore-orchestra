# UI Component Architecture
*Composition — State Management — Rendering — Testing — Accessibility — Performance*

**Type mapping:** `type: web`, `type: mobile`, `type: saas`
**Category:** Component design patterns

## Project Structure

```text
src/
├── components/
│   ├── ui/                           # Primitive / shared components
│   │   ├── Button/
│   │   │   ├── Button.tsx
│   │   │   ├── Button.test.tsx
│   │   │   ├── Button.stories.tsx
│   │   │   ├── Button.module.css
│   │   │   └── index.ts
│   │   ├── Dialog/
│   │   ├── Tooltip/
│   │   └── index.ts                  # Barrel exports
│   │
│   ├── forms/                        # Form components
│   │   ├── FormField/
│   │   ├── Select/
│   │   ├── DatePicker/
│   │   └── index.ts
│   │
│   ├── layout/                       # Layout components
│   │   ├── Stack/
│   │   ├── Grid/
│   │   ├── Container/
│   │   ├── Sidebar/
│   │   └── index.ts
│   │
│   ├── data/                         # Data-display components
│   │   ├── DataTable/
│   │   ├── Pagination/
│   │   ├── Card/
│   │   └── index.ts
│   │
│   └── patterns/                     # Domain patterns
│       ├── SearchWithFilters/
│       ├── ConfirmDeleteDialog/
│       └── EmptyState/
│
├── hooks/                            # Shared hooks
│   ├── use-media-query.ts
│   ├── use-intersection-observer.ts
│   ├── use-debounce.ts
│   └── index.ts
│
├── lib/                              # Utilities
│   ├── cn.ts                         # Class name merger
│   ├── focus-manager.ts
│   ├── keyboard.ts
│   └── types.ts                      # Shared component types
│
└── styles/                           # Global styles
    ├── globals.css
    ├── reset.css
    └── tokens.css                    # Design tokens as CSS vars
```

## Architectural Overview

UI Component Architecture defines the patterns, contracts, and boundaries for building a scalable component system. Components are organized by responsibility, follow consistent patterns, and are optimized for composition, testing, and accessibility.

```text
[ Component Categories ]
    ┌─────────────────────────────────────────────────────────────┐
    │                                                             │
    │   PRIMITIVE              COMPOSITE              PATTERN     │
    │   ┌──────────┐          ┌──────────┐          ┌──────────┐  │
    │   │ Button   │          │ FormField│          │SearchW/  │  │
    │   │ Input    │ ────────▶│ DataTable│ ────────▶│ Filters  │  │
    │   │ Dialog   │ compose  │ DatePicker│  compose│ConfirmDel│  │
    │   │ Tooltip  │          │ Combobox │          │EmptyState│  │
    │   └──────────┘          └──────────┘          └──────────┘  │
    │                                                             │
    │   [Polymorphic]       [Stateful + AOM]     [Domain logic]  │
    │   [Unstyled/ Minimal]  [Keyboard nav]      [App-specific]   │
    │   [Ref forwarding]     [Focus trapping]    [Reusable pages] │
    │                                                             │
    └─────────────────────────────────────────────────────────────┘

[ State Layers ]                  [ Rendering Strategies ]
    ┌──────────────┐              ┌────────────────────┐
    │ URL params   │              │ Server Component   │
    │ Search params│              │ Static Generation  │
    ├──────────────┤              ├────────────────────┤
    │ Server state │              │ Client Component   │
    │ React Query  │              │ Hydration on Mount │
    ├──────────────┤              ├────────────────────┤
    │ Client state │              │ Streaming SSR      │
    │ Zustand / Jotai│            │ Progressive Loading│
    ├──────────────┤              └────────────────────┘
    │ Form state   │
    │ React Hook Form│
    ├──────────────┤
    │ UI state     │
    │ useState / useReducer│
    └──────────────┘
```

## Integration with Project Identity

```yaml
project:
  type: web
  name: my-app
  display_name: "My Application"

stack:
  languages:
    - typescript
    - css
  frameworks:
    - react
    - nextjs
  databases: []
  package_manager: pnpm
  runtime: node

components:
  library: shadcn-ui
  styling: tailwindcss-css-modules
  testing:
    interaction: "@testing-library/react"
    visual: chromatic
    a11y: axe-core
  documentation: storybook
```

## Component Contracts

### Primitive Components

Smallest building blocks. Pure, composable, unstyled or minimally styled.

```typescript
interface ButtonProps {
  children: React.ReactNode
  variant?: "primary" | "secondary" | "ghost" | "danger"
  size?: "sm" | "md" | "lg"
  disabled?: boolean
  loading?: boolean
  as?: React.ElementType            // Polymorphic
  className?: string
}

// Ref forwarding for form libraries
const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ children, variant = "primary", as: Component = "button", ...props }, ref) => {
    return (
      <Component ref={ref} className={cn(styles.base, styles[variant])} {...props}>
        {children}
      </Component>
    )
  }
)
Button.displayName = "Button"
```

### Composite Components

Combine primitives with state management and accessibility patterns.

```typescript
// Compound component pattern
<Select>
  <Select.Trigger>
    <Select.Value placeholder="Choose..." />
  </Select.Trigger>
  <Select.Content>
    <Select.Item value="1">Option 1</Select.Item>
    <Select.Item value="2">Option 2</Select.Item>
  </Select.Content>
</Select>
```

### Pattern Components

Higher-level compositions for common UI scenarios. May connect directly to application state.

```typescript
// Slot-based customisation
<SearchWithFilters
  slots={{
    header: <AdvancedFilters />,
    emptyState: <EmptyState icon={SearchIcon} message="No results" />,
  }}
  onSearch={handleSearch}
/>
```

## Composition Patterns

### 1. Compound Components

Related components that share implicit state via React context.

```typescript
// Tabs compound
<Tabs defaultValue="tab1">
  <Tabs.List>
    <Tabs.Trigger value="tab1">Tab One</Tabs.Trigger>
    <Tabs.Trigger value="tab2">Tab Two</Tabs.Trigger>
  </Tabs.List>
  <Tabs.Content value="tab1">Content 1</Tabs.Content>
  <Tabs.Content value="tab2">Content 2</Tabs.Content>
</Tabs>
```

### 2. Polymorphic Component

Render as any HTML element or custom component via the `as` prop.

```typescript
<Button as="a" href="/settings">Settings</Button>
<Button as={Link} href="/profile">Profile</Button>
```

### 3. Slot / Render Prop

Override specific parts of a component's rendering.

```typescript
<DataTable
  columns={columns}
  data={data}
  slots={{
    header: <CustomHeader />,
    row: (row) => <CustomRow row={row} />,
    emptyState: <EmptyState />,
  }}
/>
```

### 4. Controlled / Uncontrolled

Support both controlled (external state) and uncontrolled (internal state) usage.

```typescript
// Controlled
<DatePicker value={date} onChange={setDate} />

// Uncontrolled  
<DatePicker defaultValue={today} />
```

## State Management Boundaries

| State Type | Where | Tool |
|---|---|---|
| URL state | URL / search params | `useSearchParams`, `nuqs` |
| Server state | Cache layer | TanStack Query / SWR |
| Global client state | Cross-component shared state | Zustand / Jotai / Context |
| Form state | Form scope | React Hook Form / Formik |
| UI state | Single component | `useState` / `useReducer` |
| Animation state | Animation scope | Framer Motion / CSS transitions |

## Rendering Strategy Decision Tree

```text
Is the data static and universal?
├── YES → Static Generation (SSG / ISR)
└── NO
    └── Can the component render without client JS?
        ├── YES → Server Component (RSC)
        │   └── Does it need interactivity?
        │       ├── YES → Add client boundary around interactive parts only
        │       └── NO → Keep as Server Component
        └── NO → Client Component
            └── Is initial data already fetched on server?
                ├── YES → Hydrate via React Query dehydrate
                └── NO → Fetch on client with loading state
```

## Accessibility Checklist

- [ ] Semantic HTML elements (`<button>`, `<nav>`, `<dialog>`)
- [ ] ARIA roles, labels, and descriptions
- [ ] Keyboard navigation (Tab, Enter, Escape, Arrow keys)
- [ ] Focus management (auto-focus, focus trap, focus restoration)
- [ ] Screen reader announcements (aria-live regions)
- [ ] Visible focus indicators (not just outline: none)
- [ ] Color contrast compliance (WCAG 2.2 AA)
- [ ] Reduced motion support (`prefers-reduced-motion`)
- [ ] Touch target size ≥ 44×44px (mobile)
- [ ] Error messages linked to inputs via aria-describedby

## Testing Strategy

```text
[ Unit Tests ]
    vitest + @testing-library/react
    → Component renders with props
    → User events trigger expected behavior
    → Conditional rendering based on state

[ Interaction Tests ]
    @testing-library/user-event
    → Click, type, focus, keyboard navigation
    → Async operations and loading states
    → Error states and edge cases

[ Accessibility Tests ]
    vitest + @axe-core/playwright
    → Automated a11y audit on every component
    → 0 violations required

[ Visual Regression ]
    Chromatic / Percy
    → Every storybook story captured
    → PR visual diff required

[ E2E ]
    Playwright
    → Full-page flows (not component-isolated)
```

## Setup Sequence

```bash
# 1. Initialize app
pnpm create next-app@latest my-app --typescript --tailwind --app

# 2. Install core component deps
pnpm add @radix-ui/react-dialog @radix-ui/react-select @radix-ui/react-tabs
pnpm add @tanstack/react-query
pnpm add react-hook-form @hookform/resolvers zod

# 3. Install dev tooling
pnpm add --save-dev \
  @testing-library/react @testing-library/user-event @testing-library/jest-dom \
  @axe-core/playwright \
  vitest @vitejs/plugin-react \
  storybook @storybook/react @storybook/test

# 4. Create component template
#    src/components/ui/Button/Button.tsx + Button.test.tsx + Button.stories.tsx + index.ts
```

## Key Dependencies

| Package | Purpose |
|---------|---------|
| `@radix-ui/*` | Unstyled accessible primitives |
| `@tanstack/react-query` | Server state |
| `react-hook-form` + `zod` | Form handling + validation |
| `clsx` / `tailwind-merge` | Class name composition |
| `framer-motion` | Declarative animations |
| `@testing-library/react` | Component testing |
| `@axe-core/playwright` | A11y automation |
| `storybook` | Component development & docs |

## Best Practices

- **One component per file** — Named exports in a directory with index barrel. Avoid default exports.
- **Colocate tests and stories** — `Button.tsx`, `Button.test.tsx`, `Button.stories.tsx` live together.
- **Primitives are pure** — No side effects. No data fetching. No app-specific logic. Accept props and render.
- **Composites manage state** — FormField manages focus, error, and validation state. DataTable manages sort, filter, and selection.
- **Patterns connect to app** — Patterns may query React Query or navigate. They are the boundary between UI and domain.
- **Server-first rendering** — Default to Server Components. Add client boundaries only where interactivity is needed.
- **Props should be explicit** — Avoid `...rest` prop spreading on public components. Be explicit about what's accepted.
- **Style with CSS modules or Tailwind** — No runtime CSS-in-JS (avoids bundle cost and SSR issues).
- **Name event handlers with `on` prefix** — `onClick`, `onChange`, `onSelect` — matching native DOM conventions.
- **Loading, empty, error, and success states** — Every data-driven component must handle all four states.

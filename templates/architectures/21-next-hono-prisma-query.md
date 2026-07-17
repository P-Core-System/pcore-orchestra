# Next.js + Hono + Prisma + React Query + shadcn/ui Stack
*End-to-End TypeScript — Type-Safe API Layer — Server Components — Modern UI*

**Type mapping:** `type: web`, `type: saas`
**Category:** Full-stack web application

## Project Structure

```text
next-hono-app/
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── (marketing)/              # Route group: public pages
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx              # Landing page
│   │   │   └── about/page.tsx
│   │   ├── (dashboard)/              # Route group: authenticated pages
│   │   │   ├── layout.tsx            # Dashboard layout with sidebar
│   │   │   ├── page.tsx              # Dashboard home
│   │   │   ├── orders/
│   │   │   └── settings/
│   │   ├── api/                      # API route handlers (Hono)
│   │   │   └── [[...route]]/
│   │   │       └── route.ts          # Hono app handler — catches all /api/*
│   │   ├── layout.tsx                # Root layout
│   │   ├── providers.tsx             # QueryClient + Theme providers
│   │   └── globals.css
│   │
│   ├── server/                       # Server-only code
│   │   ├── db/
│   │   │   ├── prisma.ts             # Prisma client singleton
│   │   │   └── schema.prisma         # Prisma schema
│   │   ├── api/                      # Hono API app
│   │   │   ├── index.ts              # Hono app creation + middleware
│   │   │   ├── routes/               # Route modules
│   │   │   │   ├── auth.ts
│   │   │   │   ├── orders.ts
│   │   │   │   └── users.ts
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts           # Auth middleware (Clerk / NextAuth)
│   │   │   │   └── rate-limit.ts
│   │   │   └── lib/
│   │   │       ├── context.ts        # Hono context helpers
│   │   │       └── errors.ts         # Error handling
│   │   └── services/                 # Business logic layer
│   │       ├── order.service.ts
│   │       └── user.service.ts
│   │
│   ├── client/                       # Client-only code
│   │   ├── api/                      # Hono RPC client
│   │   │   └── client.ts             # Type-safe client from Hono server types
│   │   ├── hooks/                    # React Query hooks
│   │   │   ├── use-orders.ts         # useQuery + useMutation wrappers
│   │   │   ├── use-auth.ts
│   │   │   └── use-users.ts
│   │   ├── stores/                   # Client state (Zustand if needed)
│   │   └── lib/
│   │       └── query-keys.ts         # Query key factories
│   │
│   ├── components/                   # Shared React components
│   │   ├── ui/                       # shadcn/ui primitives
│   │   │   ├── button.tsx
│   │   │   ├── card.tsx
│   │   │   ├── dialog.tsx
│   │   │   └── table.tsx
│   │   ├── forms/                    # Form components with react-hook-form
│   │   │   ├── order-form.tsx
│   │   │   └── login-form.tsx
│   │   └── layout/
│   │       ├── sidebar.tsx
│   │       └── navbar.tsx
│   │
│   └── lib/                          # Shared utilities
│       ├── validations/              # Zod schemas (shared server + client)
│       │   ├── order.ts
│       │   └── auth.ts
│       ├── constants.ts
│       └── utils.ts                  # cn() helper, etc.
│
├── prisma/                           # Prisma standalone config
│   ├── schema.prisma                 # (or here if not in src/)
│   ├── migrations/
│   └── seed.ts
│
├── public/
├── .env
├── .env.local
├── components.json                   # shadcn/ui config
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── package.json
└── README.md
```

## Architectural Overview

### What This Stack Does

This is the modern "T3-inspired" full-stack TypeScript stack replacing tRPC with Hono for the API layer. Hono provides an ultra-fast, standards-based HTTP framework that integrates directly into Next.js route handlers. Hono RPC delivers end-to-end type safety from server procedures to client calls — similar to tRPC but with standard REST endpoints.

```text
[ Browser ]
    │
    ├── Server Components ──────────────────────────────────────┐
    │   (fetch data directly from services, no API call needed)  │
    │                                                             │
    └── Client Components ──────────────────────────────────────┐│
        │                                                        ││
        ▼  (Hono RPC client — type-safe, no manual fetch)        ▼▼
[ Next.js Route Handler: /api/[[...route]] ]
    │
    ▼
[ Hono App ]
    │
    ├── Middleware (auth, rate-limit, logging)
    ├── Routes (orders, users, auth)
    │       │
    │       ▼
    ├── [ Prisma Client ] ──→ [ PostgreSQL / SQLite / PlanetScale ]
    │
    └── [ External APIs ] ──→ [ Payment, Email, AI ]
```

## Integration with Project Identity

```yaml
project:
  type: web
  name: my-next-hono-app
  display_name: "Next.js Hono App"

stack:
  languages:
    - typescript
    - css
  frameworks:
    - nextjs
    - hono
    - prisma
    - tanstack-react-query
    - shadcn-ui
    - tailwindcss
  databases:
    - postgresql
    - sqlite
  package_manager: pnpm
  runtime: node

environments:
  development:
    url: "http://localhost:3000"
    branch: dev
  staging:
    url: "https://staging.example.com"
    branch: main
  production:
    url: "https://example.com"
    branch: main

integrations:
  ci_cd: github-actions
  monitoring: vercel
  analytics: posthog
```

## Layer Responsibilities

### 1. Next.js App Router (Framework)

Handles routing, rendering strategies (RSC, SSR, SSG), and serves as the application shell. Server Components fetch data directly from the service layer; Client Components use React Query + Hono RPC for interactive data.

- **Server Components** — Default. Fetch data inline from services. Zero client JS.
- **Client Components** — `"use client"` only where interactivity is needed. Use React Query for data.
- **Route Groups** — `(marketing)`, `(dashboard)` organize by auth/layout concerns.

### 2. Hono API Layer (Server)

Ultra-lightweight HTTP framework (3KB bundle, WinterCG compliant) handling all `/api/*` requests. Provides:

- **RPC type safety** — Export `AppType` from the Hono app, import on the client for fully typed `hc` client calls.
- **Zod validation** — `@hono/zod-validator` validates request bodies and params at the edge.
- **Middleware chain** — Auth, logging, rate limiting run before route handlers.

### 3. Prisma ORM (Data)

Type-safe database access with auto-generated client. Schema defines models, relations, and indexes. Migrations are version-controlled SQL files.

- **Singleton pattern** — Global Prisma client cached in development, fresh per request in production.
- **Soft deletes** — Use `deletedAt` fields instead of hard deletes for auditability.
- **Connection pooling** — Use `@prisma/adapter-pg` with PgBouncer for serverless deployments.

### 4. React Query / TanStack Query (Client Data)

Manages server state on the client — caching, background refetching, optimistic updates, pagination.

- **Query hooks** — Thin wrappers around `useQuery`/`useMutation` with typed Hono RPC calls.
- **Query key factories** — Centralized key definitions in `lib/query-keys.ts`.
- **Prefetching** — Server Components can prefetch data and dehydrate to the client QueryClient.
- **Infinite queries** — For paginated lists with cursor-based pagination.

### 5. shadcn/ui + Tailwind CSS (UI)

Component library built on Radix UI primitives. Tailwind CSS for styling. Copy-paste components into your codebase — full ownership, no dependency lock-in.

- **`components/ui/`** — Primitive components (button, dialog, table, form).
- **`components/forms/`** — Composed form components with react-hook-form + Zod.
- **Custom components** — Feature-specific components in `components/` root.

## Data Flow Patterns

### Pattern A: Server Component Direct Fetch

```typescript
// app/dashboard/page.tsx — Server Component
import { getOrders } from "@/server/services/order.service"

export default async function DashboardPage() {
  const orders = await getOrders({ limit: 10 })
  // Renders directly — no API call, no client JS
  return <OrderList orders={orders} />
}
```

### Pattern B: Client Component with React Query + Hono RPC

```typescript
// components/orders/order-list.tsx — Client Component
"use client"
import { useQuery } from "@tanstack/react-query"
import { client } from "@/client/api/client"

export function OrderList() {
  const { data, isLoading } = useQuery({
    queryKey: ["orders", "list"],
    queryFn: async () => {
      const res = await client.api.orders.$get()
      return res.json()
    },
  })
  // ...
}
```

### Pattern C: Mutation with Optimistic Update

```typescript
const mutation = useMutation({
  mutationFn: async (data: CreateOrderInput) => {
    const res = await client.api.orders.$post({ json: data })
    return res.json()
  },
  onMutate: async (newOrder) => { /* optimistic update */ },
  onSettled: () => queryClient.invalidateQueries({ queryKey: ["orders"] }),
})
```

## Setup Sequence

```bash
# 1. Create Next.js app
pnpm create next-app@latest my-app --typescript --tailwind --app --src-dir
cd my-app

# 2. Install core deps
pnpm add hono @hono/zod-validator zod
pnpm add @tanstack/react-query
pnpm add prisma @prisma/client --save-dev
pnpm dlx prisma init

# 3. Init shadcn/ui
pnpm dlx shadcn@latest init
pnpm dlx shadcn@latest add button card dialog table form

# 4. Set up Hono API handler in src/app/api/[[...route]]/route.ts
```

## Key Dependencies

| Package | Purpose |
|---------|---------|
| `next` | App framework with App Router, RSC, SSR |
| `hono` | Ultra-fast API framework with RPC type safety |
| `@hono/zod-validator` | Zod integration for request validation |
| `@tanstack/react-query` | Server state management, caching, mutations |
| `@prisma/client` | Type-safe database ORM |
| `prisma` | Schema management, migrations |
| `zod` | Runtime validation + TypeScript inference |
| `shadcn/ui` | Radix-based component collection |
| `tailwindcss` | Utility-first CSS framework |
| `react-hook-form` | Performant form management |
| `@hookform/resolvers` | Zod resolver for react-hook-form |

## Best Practices

- **Server Components by default** — Only add `"use client"` when interactivity requires it (event handlers, useEffect, useState, context providers).
- **Hono RPC for type safety** — Export `AppType` and use `hc()` on the client for fully typed API calls. Never manually type fetch responses.
- **Prisma singleton in dev, fresh in production** — Use the global `PrismaClient` pattern for hot-reload safety.
- **React Query for all client data** — No `useEffect` + fetch. Every API call goes through a query key factory.
- **Prefetch on server, hydrate on client** — Use `prefetchQuery` + `HydrationBoundary` for instant page loads.
- **Centralize Zod schemas** — Define validation schemas once in `lib/validations/`. Use on both server (Hono middleware) and client (react-hook-form resolver).
- **shadcn/ui is your code** — Components are copied into your project. Customize them freely, update via CLI.
- **Environment variables** — Use `NEXT_PUBLIC_*` prefix only for client-side variables. Everything else stays server-only.

# GraphQL Architecture
*Declarative Data Fetching — Strongly Typed — Single Endpoint — Client-Driven Queries*

**Type mapping:** `type: api`, `type: web`, `type: mobile`
**Category:** API architecture

## Project Structure

```text
graphql-api/
├── src/
│   ├── schema/                     # GraphQL schema definitions
│   │   ├── types/                  # Type definitions / SDL files
│   │   │   ├── User.graphql
│   │   │   ├── Order.graphql
│   │   │   └── Product.graphql
│   │   ├── inputs/                 # Input type definitions
│   │   │   ├── CreateUserInput.graphql
│   │   │   └── OrderFilter.graphql
│   │   ├── enums/
│   │   └── directives/             # Custom directives
│   │
│   ├── resolvers/                  # Resolver implementations
│   │   ├── query/
│   │   │   ├── user.ts
│   │   │   ├── order.ts
│   │   │   └── search.ts
│   │   ├── mutation/
│   │   │   ├── createUser.ts
│   │   │   ├── placeOrder.ts
│   │   │   └── updateProfile.ts
│   │   ├── subscription/
│   │   │   ├── orderStatus.ts
│   │   │   └── notifications.ts
│   │   └── data-loader/            # DataLoader for batching
│   │       ├── userLoader.ts
│   │       └── orderLoader.ts
│   │
│   ├── services/                   # Business logic layer
│   │   ├── userService.ts
│   │   └── orderService.ts
│   │
│   ├── db/                         # Data access
│   │   ├── models/
│   │   └── loaders/
│   │
│   └── gateway/                    # Federation / gateway logic
│       ├── supergraph.ts
│       └── subgraphs/
│           ├── users/
│           ├── orders/
│           └── products/
│
├── tests/
│   ├── integration/
│   └── e2e/
├── codegen.yml                     # GraphQL Codegen config
├── schema.graphql                  # Merged schema (generated)
└── package.json
```

## Core Concepts

### What is GraphQL?

GraphQL (Facebook, 2015) is a query language and runtime for APIs. Clients declare exactly what data they need; the server returns precisely that — no over-fetching, no under-fetching. A single endpoint handles all data operations, and the type system ensures contract validation on both sides.

```text
[ Client (Web / Mobile) ]
        │
        ▼  POST /graphql { "query": "...", "variables": {...} }
[ GraphQL Gateway / Server ]
        │
        ├──→ [ Resolver: users ] ───→ [ User Service ] ───→ [ DB ]
        ├──→ [ Resolver: orders ] ──→ [ Order Service ] ───→ [ DB ]
        └──→ [ Resolver: products ] ─ [ Product Service ] ── [ DB ]
        │
        ▼  { "data": { ... } }
[ Client receives exactly the requested fields ]
```

## Integration with Project Identity

```yaml
project:
  type: api
  name: my-graphql-api

stack:
  languages:
    - typescript
    - javascript
    - ruby
    - python
  frameworks:
    - apollo-server
    - yoga-graphql
    - graphql-js
    - nexus
    - pothos
  databases:
    - postgresql
    - mongodb
    - redis
  package_manager: pnpm
  runtime: node
```

## Key Patterns

### Schema-First vs Code-First

| Approach | Description | Pros | Cons |
|----------|-------------|------|------|
| **Schema-First** | Write SDL files, generate types | Clear contract, language-agnostic | Tooling overhead |
| **Code-First** | Define schema in code (Nexus, TypeGraphQL, Pothos) | Single source of truth, TS native | Tight language coupling |

### Resolver Pattern

Each field in the GraphQL schema maps to a resolver function:

```typescript
Query: {
  user: (_, { id }, context) => context.userService.findById(id),
  orders: (_, { filter }, context) => context.orderService.find(filter),
},
User: {
  orders: (user, _, context) =>
    context.orderService.findByUserId(user.id),
}
```

### DataLoader Pattern (N+1 Prevention)
Use DataLoader to batch and cache database queries per request, eliminating the N+1 query problem:

```typescript
const userLoader = new DataLoader(async (ids) => {
  const users = await db.users.findByIds(ids);
  return ids.map(id => users.find(u => u.id === id));
});
```

### GraphQL Federation
Split a monolithic GraphQL schema into multiple **subgraphs** managed by separate teams, composed into a unified **supergraph** via Apollo Gateway or Hive Gateway.

```text
[ Client ]
    │
    ▼
[ Apollo Gateway / Supergraph ]
    │
    ├── [ Subgraph: Users ]   ─── Owned by Team A
    ├── [ Subgraph: Orders ]  ─── Owned by Team B
    ├── [ Subgraph: Products ] ─── Owned by Team C
    └── [ Subgraph: Reviews ]  ─── Owned by Team D
```

## Operation Types

| Operation | Purpose | Example |
|-----------|---------|---------|
| `Query` | Data fetching (GET equivalent) | `{ user(id: 1) { name email } }` |
| `Mutation` | Data modification (POST/PUT/DELETE) | `mutation { createUser(input: {...}) { id } }` |
| `Subscription` | Real-time data (WebSocket) | `subscription { orderStatusChanged { id status } }` |

## Best Practices

* **Use DataLoader religiously** — Never write a resolver that directly queries a database without batching. N+1 is the #1 GraphQL performance killer.
* **Design schema by use case, not by DB tables** — The GraphQL schema is a contract for clients, not a mirror of your database schema.
* **Implement pagination with Connections** — Use the Relay Connection spec (`edges { node } pageInfo`) for cursor-based pagination.
* **Set query depth & cost limits** — Protect against malicious deep/massive queries. Use `maxDepth`, `maxAliases`, and field-cost analysis.
* **Persist queries in production** — Use Automatic Persisted Queries (APQ) or persisted query maps to reduce request size and prevent ad-hoc queries.
* **Version-free evolution** — Add fields and types without breaking existing clients. Deprecate fields with `@deprecated` directive rather than removing them.
* **Monitor resolver performance** — Track per-resolver execution time, error rates, and call counts. Identify hot spots.
* **Secure authorization at the resolver level** — Never trust the client. Authorize every field access based on user context, not schema visibility.

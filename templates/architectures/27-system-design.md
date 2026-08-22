# System Design Document
*C4-Lite — Context · Containers · Data Flows · NFRs · ADRs*

**Type mapping:** `type: web`, `type: api`, `type: saas`, `type: data`, `type: internal-tool`
**Category:** System design & architecture documentation

> A lightweight C4 adaptation. C4 models software as nested containers (System →
> Container → Component → Code). This template captures the two highest-value
> levels (Context + Container) plus the decisions that matter, without the full
> drawing overhead. Draw real C4 diagrams where a picture earns its place.

## 1. Context Diagram (C4 Level 1)

Who uses the system and what external systems it touches. Keep it to actors +
the system + external dependencies.

```text
[ Customer ]          [ Admin ]
      \                  /
       \                /
        ▼              ▼
   ┌────────────────────────┐
   │     <System Name>      │
   └────────────────────────┘
        │              │
        ▼              ▼
  [ Payment Gateway ]  [ Email Provider ]
        │
        ▼
   [ Auth Provider (OAuth) ]
```

| Actor / System | Role | Notes |
|----------------|------|-------|
| Customer | Primary end user | Web + mobile |
| Admin | Operates content/config | Internal staff |
| Payment Gateway | Charges cards | Stripe |
| Email Provider | Transactional mail | Postmark |

## 2. Container Diagram (C4 Level 2)

The deployable pieces: services, datastores, caches, queues, and the UIs that
talk to them. One row per container.

```text
[ Web SPA ] --HTTPS--> [ API Gateway ]
                            |
              +-------------+-------------+
              ▼             ▼             ▼
        [ Auth Service ] [ Orders Svc ] [ Billing Svc ]
              |               |               |
              ▼               ▼               ▼
        [ Postgres ]    [ Postgres ]    [ Postgres ]
              |               |               |
              └------> [ Message Queue ] <----┘
                            │
                            ▼
                     [ Worker Service ]
```

| Container | Responsibility | Tech | Data owned |
|-----------|----------------|------|-----------|
| Web SPA | User interface | React + Vite | none (client state only) |
| API Gateway | Routing, auth, rate limit | Hono | none |
| Auth Service | Identity, sessions | Node | users, sessions |
| Orders Service | Order lifecycle | Node | orders, order_items |
| Billing Service | Invoicing | Node | invoices |
| Postgres (×3) | Persistence | Postgres 16 | per-service schemas |
| Message Queue | Async events | Redis Streams | event log |
| Worker Service | Background jobs | Node | none |

## 3. Data Flows

Narrate the critical paths. For each flow, name the trigger, the containers
involved, and the persistence touched.

**Flow: Place an order**
1. Web SPA → API Gateway `POST /orders`
2. API Gateway authenticates via Auth Service, forwards to Orders Service
3. Orders Service writes `orders` + `order_items`, publishes `OrderPlaced`
4. Billing Service consumes `OrderPlaced`, writes `invoices`, calls Payment Gateway
5. Worker Service sends confirmation email via Email Provider

**Flow: Authentication**
1. Web SPA → API Gateway `POST /login`
2. API Gateway delegates to Auth Service → issues session token
3. Token verified on every subsequent request at the gateway

(Add one flow block per critical path — signup, payout, reporting, etc.)

## 4. Non-Functional Requirements (NFRs)

| Category | Requirement | Target / Verification |
|----------|-------------|----------------------|
| Performance | p95 API latency | < 200 ms (observed in staging) |
| Availability | uptime | 99.9% monthly (status page) |
| Scalability | peak load | 5k req/s sustained (load test) |
| Security | data at rest | AES-256; TLS 1.2+ in transit |
| Security | auth | OAuth 2.1; MFA for admin |
| Privacy | retention | PII purged after 90 days |
| Observability | tracing | every request has trace_id |
| Cost | infra budget | < $Xk/month (cloud bill alert) |
| Compliance | standard | SOC 2 Type II (annual audit) |

## 5. Architecture Decision Records (ADRs)

Pointers to the decisions behind the design. Each ADR records context, decision,
and consequences. Store them under `docs/adr/` (or `context/adr/`).

| ADR | Title | Status | Link |
|-----|-------|--------|------|
| ADR-001 | Use Postgres per service (not shared DB) | Accepted | [docs/adr/001-postgres-per-service.md](docs/adr/001-postgres-per-service.md) |
| ADR-002 | Redis Streams for async events | Proposed | [docs/adr/002-redis-streams.md](docs/adr/002-redis-streams.md) |
| ADR-003 | Hono over Express for gateway | Accepted | [docs/adr/003-hono-gateway.md](docs/adr/003-hono-gateway.md) |

ADR template (one file each):

```markdown
# ADR-00N: <Title>

## Status
Accepted | Proposed | Deprecated | Superseded by ADR-00X

## Context
What problem we faced and the constraints.

## Decision
What we decided and why.

## Consequences
What gets easier, what gets harder, what we'll revisit.
```

## Integration with Project Identity

```yaml
project:
  type: web
  name: my-system
  display_name: "My System"

architecture:
  style: c4-lite
  containers: [web-spa, api-gateway, auth-svc, orders-svc, postgres, queue]
```

## Best Practices

- **Two C4 levels are enough** — Context + Container cover most decisions.
- **Diagrams are ASCII until they earn a tool** — keep them in-repo, editable.
- **Every container owns its data** — shared databases are the #1 coupling trap.
- **NFRs are testable** — a target you can't measure isn't a requirement.
- **ADRs outlive the diagram** — record *why*, not just *what*; link them.
- **Refresh on change** — update this doc when a container or flow changes.

# CQRS — Command Query Responsibility Segregation
*Separate Reads from Writes — Independent Scaling — Optimized Models — Eventual Consistency*

**Type mapping:** `type: api`, `type: saas`, `type: data`
**Category:** Data architecture

## Project Structure

```text
cqrs-system/
├── src/
│   ├── command/                      # Write side
│   │   ├── commands/
│   │   │   ├── CreateOrderCommand.ts
│   │   │   ├── CancelOrderCommand.ts
│   │   │   └── UpdateInventoryCommand.ts
│   │   ├── handlers/
│   │   │   ├── CreateOrderHandler.ts
│   │   │   ├── CancelOrderHandler.ts
│   │   │   └── UpdateInventoryHandler.ts
│   │   └── models/
│   │       ├── OrderAggregate.ts      # Write model (normalized)
│   │       └── InventoryItem.ts
│   │
│   ├── query/                        # Read side
│   │   ├── queries/
│   │   │   ├── GetOrderByIdQuery.ts
│   │   │   ├── GetUserOrdersQuery.ts
│   │   │   └── GetDashboardQuery.ts
│   │   ├── handlers/
│   │   │   ├── GetOrderByIdHandler.ts
│   │   │   ├── GetUserOrdersHandler.ts
│   │   │   └── GetDashboardHandler.ts
│   │   └── models/
│   │       ├── OrderReadModel.ts      # Read model (denormalized)
│   │       └── DashboardProjection.ts
│   │
│   ├── shared/
│   │   ├── events/
│   │   │   ├── OrderCreatedEvent.ts
│   │   │   ├── OrderCancelledEvent.ts
│   │   │   └── InventoryAdjustedEvent.ts
│   │   └── bus/
│   │       ├── IEventBus.ts           # Event bus port
│   │       └── IMediator.ts           # Command/query dispatcher
│   │
│   ├── infrastructure/
│   │   ├── write-db/                  # Write-optimized store
│   │   │   ├── repositories/
│   │   │   │   └── OrderRepository.ts
│   │   │   └── migrations/
│   │   ├── read-db/                   # Read-optimized store
│   │   │   ├── repositories/
│   │   │   │   └── OrderReadRepository.ts
│   │   │   └── projections/
│   │   │       └── OrderProjection.ts # Syncs write → read
│   │   ├── event-bus/
│   │   │   └── KafkaEventBus.ts
│   │   └── config/
│   │       └── di.ts
│   │
│   └── api/                           # Presentation
│       ├── controllers/
│       │   ├── OrderCommandController.ts  # POST/PUT/DELETE
│       │   └── OrderQueryController.ts    # GET
│       └── routes/
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── tsconfig.json
├── package.json
└── README.md
```

## Core Concept

### What is CQRS?

CQRS (Command Query Responsibility Segregation) separates read and write operations into different models. Commands (writes) change state; queries (reads) return data. They use entirely separate models, and often separate databases, enabling each to be independently optimized for its workload.

```text
[ Client ]
    │
    ├── [ POST/PUT/DELETE ] ──────────────────────────────────┐
    │                                                          │
    ▼                                                          ▼
[ Command Controller ]                              [ Query Controller ]
    │                                                          │
    ▼                                                          ▼
[ Command Handler ]                                   [ Query Handler ]
    │                                                          │
    ▼                                                          ▼
[ Write Model (Normalized) ]                    [ Read Model (Denormalized) ]
    │                                                          ▲
    │              ┌──────────────────────────┐                │
    └──────────────│  Projection / Sync Layer  │───────────────┘
                   │  (Event → Read Model)    │
                   └──────────────────────────┘
```

## Integration with Project Identity

```yaml
project:
  type: api
  name: my-cqrs-system

stack:
  languages:
    - typescript
    - csharp
    - java
  frameworks:
    - express
    - nestjs
    - spring-boot
  databases:
    - postgresql         # Write store
    - redis               # Read cache
    - elasticsearch       # Search read model
  infrastructure:
    - kafka               # Event bus for projections
    - docker

integrations:
  monitoring: datadog
  ci_cd: github-actions
```

## When to Use CQRS

### Good Fit
- Systems where read and write workloads have drastically different shapes
- Collaborative domains where multiple users modify the same data
- Systems requiring audit trails or time-travel querying
- High-throughput applications where optimizing one operation shouldn't penalize the other

### Poor Fit
- Simple CRUD applications with symmetric read/write patterns
- Small teams where the complexity overhead isn't justified
- Domains requiring strong consistency between reads and writes

## Key Components

### Commands (Write Side)
- Named in imperative tense: `CreateOrder`, `CancelInvoice`, `UpdateProfile`
- Validated by command handlers before execution
- Return success/failure — never domain data
- Executed against the write model (normalized, optimized for integrity)

### Queries (Read Side)
- Named in interrogative tense: `GetOrderById`, `FindAllActiveOrders`
- Return data without side effects
- Executed against read models (denormalized, optimized for display)
- Read models can be cached, indexed, or pre-computed

### Projections
- Subscribe to events published by the write side
- Update read models to reflect changes
- Can rebuild from scratch by replaying all events

### Synchronization Strategies

| Strategy | Latency | Consistency | Complexity |
|----------|---------|-------------|------------|
| Synchronous projection | Immediate | Strong | Low |
| Event-driven projection | ~ms | Eventual | Medium |
| Batch sync | Minutes | Eventual | Low |
| Change Data Capture (CDC) | Real-time | Eventual | High |

## Best Practices

* **Start simple** — CQRS adds complexity. Begin with separate models in the same database; split databases only when performance demands it.
* **Commands are validated, queries are optimized** — Commands prioritize data integrity; queries prioritize response time.
* **Design projections to be rebuildable** — Enables recovery from read model corruption by replaying the event stream.
* **Handle eventual consistency explicitly** — Read models may lag behind writes. Design the UI to handle stale data gracefully.
* **Don't split everything** — Only separate reads and writes where the trade-off makes sense. Simple lookups can share a model.
* **Use a mediator/bus pattern** — Decouple controllers from handlers with a command/query dispatcher (MediatR, NestJS CQRS).

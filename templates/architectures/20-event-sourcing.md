# Event Sourcing Architecture
*Immutable Event Log — Complete Audit Trail — Temporal Queries — Event Replay*

**Type mapping:** `type: api`, `type: saas`, `type: data`
**Category:** Data architecture

## Project Structure

```text
event-sourcing-system/
├── src/
│   ├── domain/                        # Domain model & aggregates
│   │   ├── aggregates/
│   │   │   ├── OrderAggregate.ts
│   │   │   ├── AccountAggregate.ts
│   │   │   └── InventoryAggregate.ts
│   │   ├── events/                    # Event definitions
│   │   │   ├── OrderPlaced.ts
│   │   │   ├── OrderConfirmed.ts
│   │   │   ├── OrderCancelled.ts
│   │   │   ├── MoneyDeposited.ts
│   │   │   └── MoneyWithdrawn.ts
│   │   └── value-objects/
│   │       └── Money.ts
│   │
│   ├── application/                   # Use cases / command handlers
│   │   ├── commands/
│   │   │   ├── PlaceOrderCommand.ts
│   │   │   └── CancelOrderCommand.ts
│   │   ├── handlers/
│   │   │   ├── PlaceOrderHandler.ts
│   │   │   └── CancelOrderHandler.ts
│   │   └── services/
│   │       └── AccountService.ts
│   │
│   ├── infrastructure/
│   │   ├── event-store/               # Event store implementation
│   │   │   ├── PostgresEventStore.ts  # Events table + snapshots
│   │   │   ├── KafkaEventStore.ts     # Kafka as event log
│   │   │   └── interfaces/
│   │   │       └── IEventStore.ts     # Event store port
│   │   ├── projections/              # Read model builders
│   │   │   ├── OrderProjection.ts
│   │   │   ├── AccountBalanceProjection.ts
│   │   │   └── DashboardProjection.ts
│   │   ├── repositories/
│   │   │   └── EventSourcedRepository.ts
│   │   └── config/
│   │       └── event-store-config.ts
│   │
│   └── api/                           # Entry points
│       ├── controllers/
│       ├── graphql/
│       └── subscribers/
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── tsconfig.json
├── package.json
└── README.md
```

## Core Concepts

### What is Event Sourcing?

Event Sourcing stores every state change as an immutable event in an append-only log, rather than storing only the current state. The current state of any entity is derived by replaying its event stream. This enables complete audit trails, temporal queries, and system reconstruction from scratch.

```text
Traditional CRUD:     UPDATE users SET balance = 1200 WHERE id = 1
Event Sourcing:       APPEND { type: "MoneyDeposited", amount: 200 }
                      APPEND { type: "MoneyWithdrawn", amount: 50 }
                      APPEND { type: "MoneyDeposited", amount: 100 }

Current state computed by replaying ALL events:
  Initial:    Account(id=1, balance=0)
  + Deposit:  Account(id=1, balance=200)
  + Withdraw: Account(id=1, balance=150)
  + Deposit:  Account(id=1, balance=250)
```

## Integration with Project Identity

```yaml
project:
  type: api
  name: my-event-sourcing-system

stack:
  languages:
    - typescript
    - csharp
    - java
    - kotlin
  frameworks:
    - axon-framework
    - eventuate
    - nestjs-cqrs
  databases:
    - postgresql         # Event store
    - kafka              # Event streaming
    - elasticsearch      # Projections/search
  infrastructure:
    - kafka
    - docker
```

## Key Building Blocks

### Events
Immutable records of past facts. Named in past tense: `OrderPlaced`, `MoneyDeposited`, `CustomerRelocated`. Each event carries a timestamp, aggregate ID, version number, and payload.

### Aggregate
A domain entity whose state is derived by replaying its event stream. Aggregates enforce business invariants and produce events when commands are executed.

### Event Store
An append-only database that stores events in order. Implementations include Postgres (events table), EventStoreDB, Kafka (with infinite retention), or DynamoDB.

### Projections
Read models built by subscribing to the event stream. They maintain materialized views optimized for specific query patterns. Examples: order list, account balance, dashboard stats. Projections can be rebuilt by replaying all events.

### Snapshots
Periodic state saves that prevent replaying the entire event stream. After 100 events, save the aggregate's state. Future loads replay from the snapshot forward.

## Processing Pipeline

```text
[ Command ]
    │
    ▼
[ Command Handler ]
    │
    ▼
[ Aggregate ] ─── (Validates invariants, emits event)
    │
    ▼
[ Event Store ] ── (Append-only write)
    │
    ├────→ [ Projection 1 ] ──→ [ Read Model (Postgres) ]
    ├────→ [ Projection 2 ] ──→ [ Read Model (Elasticsearch) ]
    └────→ [ Event Bus ] ────→ [ Other Services ]
```

## Event Sourcing vs CRUD

| Aspect | CRUD | Event Sourcing |
|--------|------|---------------|
| Data stored | Current state only | Immutable event log |
| History | Overwritten on UPDATE | Full retention forever |
| Audit trail | Custom logging | Built-in via event stream |
| Temporal query | Impossible | Replay events to any point |
| Debugging | What's the current value? | How did we get here? |
| Storage | Compact | Can grow large (compaction needed) |
| Complexity | Low | High |
| Learning curve | Shallow | Steep |

## Best Practices

* **Events are immutable facts** — Never update or delete an event. Append new events to correct errors or change state.
* **Name events in domain language** — `OrderPlaced`, not `OrderCreatedInDatabase`. Events should tell a story.
* **One aggregate = one event stream** — Each aggregate instance has its own ordered sequence of events.
* **Snapshot periodically** — After N events (e.g., 100), save aggregate state to avoid replaying the full history.
* **Handle schema evolution** — Events are permanent. New fields must be optional. Use upcasting to migrate old events to new schemas.
* **Projections are disposable** — Read models can be rebuilt at any time by replaying events. Treat projections as derived data, not source of truth.
* **Design idempotent consumers** — The same event delivered twice must produce the same projection state.
* **Plan for event volume** — Event stores grow quickly. Implement event retention policies, archival, and compaction strategies.

# Event-Driven Architecture (EDA)
*Asynchronous — Decoupled — Scalable — Resilient — Real-Time*

**Type mapping:** `type: api`, `type: saas`, `type: internal-tool`, `type: data`
**Category:** Distributed messaging

## Project Structure

```text
event-driven-system/
├── producers/                # Event publishers
│   ├── order-service/
│   │   └── src/
│   │       ├── events/       # Event definitions
│   │       ├── publishers/   # Kafka/RabbitMQ publishers
│   │       └── domain/       # Business logic
│   └── user-service/
├── consumers/                # Event subscribers
│   ├── notification-service/
│   ├── analytics-service/
│   └── audit-service/
├── brokers/                  # Event infrastructure
│   ├── kafka/
│   │   ├── topics/           # Topic configurations
│   │   ├── schemas/          # Avro/Protobuf schemas
│   │   └── connect/          # Kafka Connect configs
│   └── rabbitmq/
│       ├── queues/
│       └── exchanges/
├── shared/
│   ├── event-schemas/        # Shared event contracts
│   └── event-library/        # Client libraries
├── infrastructure/
│   ├── docker-compose.yml
│   └── monitoring/           # Kafka metrics, consumer lag
├── docker-compose.yml
└── README.md
```

## Architectural Overview

### What is Event-Driven Architecture?

EDA is a software architecture pattern where services communicate by producing and consuming events rather than calling each other directly. An event is a significant change in state — `OrderPlaced`, `PaymentReceived`, `UserSignedUp`. Producers publish events to a broker; consumers subscribe and react independently. Producers have no knowledge of consumers.

### Three Structural Pieces

1. **Event Producers** — Services that detect state changes and publish events describing them.
2. **Event Routers (Brokers)** — Infrastructure that receives events and delivers them to subscribers (Kafka, RabbitMQ, NATS, AWS SNS/SQS, GCP Pub/Sub).
3. **Event Consumers** — Services that subscribe to specific event types and react. Multiple consumers can process the same event for different purposes.

## Integration with Project Identity

```yaml
project:
  type: api
  name: my-event-driven-system

stack:
  languages:
    - typescript
    - javascript
    - java
    - go
  frameworks:
    - kafka-client
    - rabbitmq-client
  databases:
    - postgresql
    - redis
  infrastructure:
    - kafka
    - docker
    - kubernetes

integrations:
  ci_cd: github-actions
  monitoring: prometheus+grafana
```

## EDA vs Request-Response

| Concern | Request-Response | Event-Driven |
|---------|-----------------|--------------|
| Coupling | Tight — caller knows callee | Loose — producer ignores consumers |
| Scaling | Linear, bounded by slowest service | Independent per consumer group |
| Failure handling | Retry/circuit-breaker at caller | DLQ + replay at broker level |
| Data consistency | Strong (transactional) | Eventual |
| Real-time | Polling or WebSockets | Push via stream subscription |
| Audit trail | Application-level logging | Immutable event log built-in |

## Event Types

```text
Event Types
 ├── Domain Event
 │    └── Business fact: OrderPlaced, PaymentFailed
 ├── Integration Event
 │    └── Cross-service: OrderConfirmedIntegrationEvent
 ├── Event Notification
 │    └── Minimal data (ID only): OrderStatusChanged(orderId)
 └── Event-Carried State Transfer
      └── Full state: OrderDetails{orderId, status, items...}
```

## Processing Pipeline

```text
[ Producer Service ]
        │
        ▼  (publishes event)
[ Event Broker ] ──── Kafka / RabbitMQ / SNS+SQS
        │
        ├────→ [ Consumer A ] ───── (Notification service)
        ├────→ [ Consumer B ] ───── (Analytics service)
        └────→ [ Consumer C ] ───── (Audit logging)
        
        ┌────── Dead Letter Queue ──────┐
        │                                │
        └────→ Failed messages routed for replay
```

## Key Patterns

### Event Sourcing
Store every state change as an immutable event. Current state is derived by replaying the event stream. Enables complete audit trail and time-travel queries.

### CQRS with Event-Driven
Commands write to the event store; projections build read-optimized views. Queries never touch the write path.

### Saga Pattern
Coordinate distributed transactions via events. Each step publishes an event that triggers the next step. Failed steps emit compensating events to undo previous work.

### Outbox Pattern
Write events to an outbox table within the same database transaction as business data. A separate process publishes outbox events to the broker — ensures exactly-once delivery without distributed transactions.

### Dead Letter Queue (DLQ)
Capture events that consumers repeatedly fail to process. Prevents poison messages from blocking the queue. Enables later analysis and reprocessing.

## Best Practices

* **Design idempotent consumers** — Same event delivered twice must produce the same result.
* **Use schema registry** — Enforce event contract versioning with Avro/Protobuf/JSON Schema.
* **Track causality** — Include correlation IDs and causation IDs in every event header.
* **Choose the right broker** — Kafka for high-throughput streams; RabbitMQ for reliable task queues.
* **Monitor consumer lag** — Track how far behind consumers are from the head of the stream.
* **Plan for schema evolution** — Events are immutable; new fields must be optional with defaults.
* **Implement DLQs** — Never lose a message; always have a fallback path for failures.

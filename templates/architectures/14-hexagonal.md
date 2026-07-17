# Hexagonal Architecture (Ports & Adapters)
*Domain Isolation — Technology Agnostic — Highly Testable — Swappable Infrastructure*

**Type mapping:** `type: api`, `type: web`, `type: internal-tool`
**Category:** Application architecture

## Project Structure

```text
hexagonal-app/
├── internal/                      # Go-style layout; adapt to TypeScript/Python
│   ├── core/                      # Domain + application — inside the hexagon
│   │   ├── domain/
│   │   │   ├── entity/
│   │   │   │   ├── user.go
│   │   │   │   └── order.go
│   │   │   ├── service/          # Domain services
│   │   │   └── vo/               # Value objects
│   │   │
│   │   └── ports/                # Interface definitions (the ports)
│   │       ├── in/               # Driving ports (inbound — called by external)
│   │       │   ├── UserService.go
│   │       │   └── OrderService.go
│   │       └── out/              # Driven ports (outbound — called by core)
│   │           ├── UserRepository.go
│   │           ├── OrderRepository.go
│   │           ├── EmailSender.go
│   │           └── EventPublisher.go
│   │
│   └── adapters/                 # Outside the hexagon — exterior implementations
│       ├── in/                   # Driving adapters (inbound — HTTP, gRPC, CLI)
│       │   ├── http/
│       │   │   ├── handler/
│       │   │   ├── middleware/
│       │   │   └── router.go
│       │   ├── grpc/
│       │   └── consumer/        # Message queue consumers
│       │
│       └── out/                  # Driven adapters (outbound — DB, APIs, queues)
│           ├── repository/
│           │   ├── postgres/
│           │   │   └── user_repo.go
│           │   ├── memory/
│           │   │   └── user_repo.go
│           │   └── mongodb/
│           │       └── user_repo.go
│           ├── email/
│           │   └── sendgrid.go
│           └── messaging/
│               └── kafka_publisher.go
│
├── cmd/                          # Application entry points
│   └── server/
│       └── main.go               # Wiring + DI composition root
├── config/
│   └── config.go
├── pkg/
│   └── shared/                   # Shared utilities (not domain)
├── tests/
│   ├── unit/                     # Core tests — no infrastructure needed
│   ├── integration/              # Adapter tests — with real DB/API
│   └── e2e/
├── go.mod
├── Dockerfile
└── README.md
```

## Core Concepts

### What is Hexagonal Architecture?

Introduced by Alistair Cockburn (2005), Hexagonal Architecture (Ports & Adapters) isolates the application core behind **ports** (interfaces) while **adapters** implement those ports to connect the core to the outside world. The hexagon shape is symbolic — it represents the application boundary with multiple connection points.

```text
                    ┌─────────────────┐
    ┌───────────────│   HTTP Adapter   │───────────────┐
    │               └────────┬────────┘               │
    │                        │ (driving port)         │
    ▼                        ▼                        ▼
┌─────────┐          ┌─────────────────┐          ┌─────────┐
│  CLI    │─────────▶│  P O R T S      │◀─────────│  gRPC   │
│ Adapter │          │  (Interfaces)    │          │ Adapter │
└─────────┘          │                 │          └─────────┘
                     │ ┌─────────────┐ │
    ┌─────────┐      │ │  Domain     │ │      ┌─────────┐
    │ Postgres│◀─────│ │  + Use      │ │─────▶│  Kafka  │
    │ Adapter │      │ │  Cases      │ │      │ Adapter │
    └─────────┘      │ └─────────────┘ │      └─────────┘
                     │                 │
    ┌─────────┐      │    Core         │      ┌─────────┐
    │ SendGrid│◀─────│  (Inside        │─────▶│  Redis  │
    │ Adapter │      │   Hexagon)      │      │ Adapter │
    └─────────┘      └─────────────────┘      └─────────┘
                          │
                          ▼
                    All dependencies point INWARD
```

## Integration with Project Identity

```yaml
project:
  type: api
  name: my-hexagonal-app

stack:
  languages:
    - typescript
    - go
    - java
    - python
    - csharp
  frameworks:
    - express
    - gin
    - spring-boot
    - fastapi
  databases:
    - postgresql
    - mysql
  package_manager: pnpm
  runtime: node
```

## Driving vs Driven Sides

### Driving (Primary / Inbound) Side
The side that initiates calls **into** the application core. These are the entry points.

| Port | Adapter Examples |
|------|-----------------|
| `UserService` (use case interface) | HTTP controller, gRPC handler, CLI command, MQ consumer |
| `OrderService` | REST handler, GraphQL resolver, batch processor |

### Driven (Secondary / Outbound) Side
The side that the application core calls **out to**. These are the external dependencies.

| Port | Adapter Examples |
|------|-----------------|
| `UserRepository` | Postgres adapter, MongoDB adapter, InMemory adapter |
| `EmailSender` | SendGrid adapter, Mailgun adapter, SMTP adapter |
| `EventPublisher` | Kafka adapter, RabbitMQ adapter, SNS adapter |

## Comparing Hexagonal vs Clean vs Onion

| Aspect | Hexagonal | Clean | Onion |
|--------|-----------|-------|-------|
| Author | Alistair Cockburn (2005) | Robert C. Martin (2012) | Jeffrey Palermo (2008) |
| Core concept | Ports & Adapters | Dependency Rule | Domain-centric layers |
| Testability | High | High | High |
| Infrastructure swap | Replace adapter | Replace outer layer | Replace outer layer |
| Learning curve | Moderate | High | Moderate |
| Suitable scale | Medium to large | Large | Medium to large |

## Best Practices

* **Ports are owned by the core** — Interfaces are defined in the domain layer, not the adapter layer.
* **Adapter implementations are trivial** — An adapter's job is to translate between port calls and external APIs. No business logic in adapters.
* **Test the core without infrastructure** — Provide fake/mock adapters for repository ports; test use cases in isolation.
* **DI composition at the entry point** — Wire real adapters into ports only in `main()` or the composition root.
* **One adapter per technology** — If you need Postgres AND MongoDB for the same port, write two adapters and swap via config.
* **Don't expose adapter types to the core** — Domain entities should never import HTTP request types, ORM annotations, or serialization decorators.

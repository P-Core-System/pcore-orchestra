# Clean Architecture
*Domain-Centric — Dependency Inversion — Testable — Framework-Independent*

**Type mapping:** `type: web`, `type: api`, `type: saas`
**Category:** Application architecture

## Project Structure

```text
clean-app/
├── src/
│   ├── domain/                    # Inner layer — enterprise business rules
│   │   ├── entities/
│   │   │   ├── User.ts
│   │   │   └── Order.ts
│   │   ├── value-objects/
│   │   │   ├── Email.ts
│   │   │   └── Money.ts
│   │   ├── events/
│   │   │   └── DomainEvent.ts
│   │   └── repositories/          # Ports (interfaces)
│   │       ├── IUserRepository.ts
│   │       └── IOrderRepository.ts
│   │
│   ├── application/               # Second layer — use cases
│   │   ├── use-cases/
│   │   │   ├── CreateUserUseCase.ts
│   │   │   └── PlaceOrderUseCase.ts
│   │   ├── ports/                 # Input/output ports
│   │   │   ├── in/                # Input ports (incoming)
│   │   │   │   └── ICreateUserInput.ts
│   │   │   └── out/               # Output ports (outgoing)
│   │   │       ├── IEmailService.ts
│   │   │       └── IEventPublisher.ts
│   │   └── dto/
│   │       └── CreateUserDTO.ts
│   │
│   ├── infrastructure/            # Third layer — adapters
│   │   ├── persistence/
│   │   │   ├── postgres/
│   │   │   │   └── UserRepository.ts  # Adapter implements IUserRepository
│   │   │   └── sqlite/
│   │   │       └── UserRepository.ts
│   │   ├── email/
│   │   │   └── SendGridEmailService.ts
│   │   ├── messaging/
│   │   │   └── KafkaEventPublisher.ts
│   │   └── config/
│   │       └── dependency-injection.ts
│   │
│   └── presentation/             # Fourth layer — frameworks & drivers
│       ├── http/
│       │   ├── controllers/
│       │   ├── middleware/
│       │   └── routes/
│       ├── graphql/
│       └── cli/
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── tsconfig.json
├── package.json
└── README.md
```

## The Dependency Rule

### What is Clean Architecture?

Clean Architecture (Robert C. Martin, 2012) organizes code into concentric layers. The Dependency Rule states: **dependencies must always point inward**. Outer layers depend on inner layers — never the reverse. The innermost domain layer has zero external dependencies.

```text
┌────────────────────────────────────────────┐
│  Frameworks & Drivers  (HTTP, DB, CLI)     │
│  ┌──────────────────────────────────────┐  │
│  │  Interface Adapters  (Controllers)   │  │
│  │  ┌────────────────────────────────┐  │  │
│  │  │  Application / Use Cases       │  │  │
│  │  │  ┌──────────────────────────┐  │  │  │
│  │  │  │  Domain / Entities       │  │  │  │
│  │  │  │  (Pure business logic,   │  │  │  │
│  │  │  │   zero dependencies)     │  │  │  │
│  │  │  └──────────────────────────┘  │  │  │
│  │  └────────────────────────────────┘  │  │
│  └──────────────────────────────────────┘  │
└────────────────────────────────────────────┘
       ▲ Dependencies point inward ▲
```

## Integration with Project Identity

```yaml
project:
  type: web
  name: my-clean-app

stack:
  languages:
    - typescript
    - csharp
    - java
    - python
  frameworks:
    - express
    - nestjs
    - spring-boot
    - fastapi
  databases:
    - postgresql
    - mongodb
  package_manager: pnpm
  runtime: node
```

## Layer Responsibilities

### Domain Layer (Innermost)
- **Entities** — Core business objects with critical business rules
- **Value Objects** — Immutable objects identified by their values (Email, Money)
- **Repository Interfaces** — Contracts for data access (ports)
- **Domain Events** — Notifications of state changes within the domain
- **No external dependencies** — Zero imports from frameworks, databases, or HTTP libraries

### Application Layer
- **Use Cases** — Application-specific business rules. Orchestrate entities and call repository ports
- **Input/Output Ports** — Interfaces defining how external actors interact with the application
- **DTOs** — Data transfer objects for use case inputs/outputs
- Depends only on domain layer

### Infrastructure Layer
- **Persistence Adapters** — Implement repository interfaces (Postgres, MongoDB, InMemory)
- **External Service Adapters** — Email, messaging, payment gateway implementations
- **DI Configuration** — Wire up dependencies at composition root
- Depends on application/domain layers

### Presentation Layer (Outermost)
- **HTTP Controllers** — Parse requests, call use cases, format responses
- **GraphQL Resolvers** — Same controller pattern for GraphQL
- **CLI Commands** — Command-line entry points
- Depends on application layer (through ports)

## Best Practices

* **Dependency injection is essential** — Wire adapters into ports at the composition root; the domain never instantiates infrastructure.
* **Test domain in isolation** — Domain entities and use cases are pure logic — test with zero mocks.
* **Mock at ports, not implementations** — Test use cases by providing mock implementations of output ports.
* **Frameworks are tools, not kings** — Never let framework annotations or base classes leak into the domain.
* **Don't over-engineer small projects** — Clean Architecture adds structure. Use it for systems maintained by multiple teams over years.
* **Use consistent error types** — Domain exceptions (`UserNotFoundError`) should not be HTTP exceptions.
* **Keep entities anemic-free** — Entities should contain behavior, not just getters/setters.

## Testing Strategy

| Layer | Test Type | What to Test |
|-------|-----------|-------------|
| Domain | Unit | Entity invariants, value object validation, domain rules |
| Application | Unit + Integration | Use case orchestration, port mocking |
| Infrastructure | Integration | Real DB queries, external API contracts |
| Presentation | Integration + E2E | HTTP status codes, request/response shapes |

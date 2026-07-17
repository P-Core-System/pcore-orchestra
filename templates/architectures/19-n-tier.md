# Layered (N-Tier) Architecture
*Separation of Concerns — Horizontal Layering — Unidirectional Dependencies — Enterprise Foundation*

**Type mapping:** `type: web`, `type: api`, `type: saas`, `type: internal-tool`
**Category:** Enterprise application architecture

## Project Structure

```text
n-tier-app/
├── src/
│   ├── presentation/              # Layer 1: UI / API
│   │   ├── controllers/
│   │   │   ├── UserController.ts
│   │   │   └── OrderController.ts
│   │   ├── middleware/
│   │   ├── validators/
│   │   ├── routes/
│   │   ├── views/                 # For server-rendered apps
│   │   └── dtos/                  # Data Transfer Objects
│   │
│   ├── business/                  # Layer 2: Business Logic
│   │   ├── services/
│   │   │   ├── UserService.ts
│   │   │   ├── OrderService.ts
│   │   │   └── PaymentService.ts
│   │   ├── interfaces/
│   │   │   ├── IUserRepository.ts
│   │   │   └── IOrderRepository.ts
│   │   ├── validators/            # Domain validation
│   │   └── exceptions/
│   │
│   ├── data/                      # Layer 3: Data Access
│   │   ├── repositories/
│   │   │   ├── UserRepository.ts
│   │   │   ├── OrderRepository.ts
│   │   │   └── ProductRepository.ts
│   │   ├── models/                # ORM models / schemas
│   │   ├── migrations/
│   │   └── seeders/
│   │
│   └── cross-cutting/             # Shared concerns
│       ├── logging/
│       ├── auth/
│       ├── cache/
│       └── config/
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── tsconfig.json
├── package.json
└── README.md
```

## Architectural Overview

### What is N-Tier Architecture?

N-Tier (Layered) Architecture divides an application into logical layers, each with a specific responsibility. The classic three-tier model separates presentation, business logic, and data access. Dependencies flow **top-down**: the presentation layer depends on the business layer, which depends on the data layer.

```text
[ Client / Browser ]
        │
        ▼
┌──────────────────────────────────┐
│   PRESENTATION LAYER             │  (UI, Controllers, DTOs)
│   - Controllers / Routers        │
│   - Input validation             │
│   - View rendering / JSON format │
└──────────────┬───────────────────┘
               │ Depends on
               ▼
┌──────────────────────────────────┐
│   BUSINESS LAYER                 │  (Services, Domain Logic)
│   - Business rules & policies    │
│   - Service orchestration        │
│   - Transaction management       │
└──────────────┬───────────────────┘
               │ Depends on
               ▼
┌──────────────────────────────────┐
│   DATA ACCESS LAYER              │  (Repositories, ORM)
│   - Database queries             │
│   - Data transformation          │
│   - Connection management        │
└──────────────┬───────────────────┘
               │
               ▼
         [ Database ]
```

## Integration with Project Identity

```yaml
project:
  type: web
  name: my-n-tier-app

stack:
  languages:
    - csharp
    - java
    - typescript
    - python
    - php
  frameworks:
    - aspnet-core
    - spring-boot
    - nestjs
    - django
    - laravel
  databases:
    - postgresql
    - sql-server
    - mysql
  package_manager: npm
  runtime: node
```

## Layer Responsibilities

### Presentation Layer
- Handles HTTP requests/responses (controllers, middleware)
- Input validation (request shape, types, required fields)
- DTO mapping (transforms domain models to API responses)
- Session management, authentication cookie handling
- **Should not contain** business rules or direct database queries

### Business Layer (Service Layer)
- Business rules and validation logic
- Orchestration of multi-step operations
- Transaction boundaries and data consistency
- Authorization decisions
- Defines repository interfaces (inversion of control)
- **Should not contain** HTTP-specific types or SQL queries

### Data Access Layer
- Database queries (via ORM or raw SQL)
- Implementation of repository interfaces
- Data mapping between domain models and database schema
- Migration and schema management
- **Should not contain** business logic or HTTP types

## Variations

| Tier Count | Name | Typical Layers |
|-----------|------|---------------|
| 2-Tier | Client-Server | Client + Database (no business layer) |
| 3-Tier | Standard | Presentation + Business + Data |
| 4-Tier | Extended | Presentation + Business + Data + Integration |
| N-Tier | Enterprise | Multiple specialized layers + message queues |

## Best Practices

* **Maintain strict layer isolation** — Controllers should never directly access repositories. Services should never know about HTTP requests. Enforce via folder structure and architecture tests.
* **Use interfaces for loose coupling** — Business layer defines repository interfaces; data layer implements them. Enables unit testing and database swapping.
* **Keep layers focused and cohesive** — Each layer has one job. If you're mixing view formatting with database queries, you've violated the separation.
* **DTOs protect internal models** — Never expose ORM entities directly to the presentation layer. Use Data Transfer Objects to decouple internal schema from external API.
* **Cross-cutting concerns are layer-aware** — Logging, caching, and auth should be consistent across layers but implemented independently per layer's needs.
* **Add architecture tests** — Enforce layer dependency rules with automated tests (NetArchTest, ArchUnit). A controller importing from the data layer should fail CI.
* **Choose the right tier count** — Start with 3 tiers. Add layers (integration, messaging, cache) only when the complexity justifies them.

## Common Anti-Patterns

| Anti-Pattern | Description | Fix |
|-------------|-------------|-----|
| **Fat Controllers** | Business logic in controllers | Move to service layer |
| **Anemic Domain** | Services have logic, models are pure data | Add behavior to domain models |
| **God Service** | One service handles everything | Split by domain bounded context |
| **Sql in Views** | Raw queries in presentation templates | Use service layer for data access |
| **Circular Dependencies** | A → B → A across layers | Extract shared logic, use DI |

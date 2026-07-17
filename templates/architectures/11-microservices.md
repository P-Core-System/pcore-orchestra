# Microservices Architecture
*Independently Deployable — Decoupled — Domain-Oriented — Resilient — Scalable*

**Type mapping:** `type: api`, `type: saas`, `type: internal-tool`
**Category:** Distributed systems

## Project Structure

```text
microservices-system/
├── services/
│   ├── user-service/
│   │   ├── src/
│   │   │   ├── api/           # Controllers, routes
│   │   │   ├── domain/        # Entities, value objects, aggregates
│   │   │   ├── application/   # Use cases, ports
│   │   │   └── infrastructure/# DB adapters, message clients
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── order-service/         # Same structure
│   ├── payment-service/
│   ├── inventory-service/
│   └── notification-service/
├── api-gateway/               # Central ingress
│   ├── routes/
│   ├── middleware/
│   └── Dockerfile
├── shared/
│   ├── types/                 # Shared TypeScript types
│   ├── event-schemas/         # Avro/JSON schema registry
│   └── eslint-config/
├── infrastructure/
│   ├── k8s/                   # Kubernetes manifests
│   ├── terraform/             # IaC
│   └── monitoring/            # Prometheus, Grafana configs
├── docker-compose.yml
├── package.json               # Root workspace
└── README.md
```

## Core Principles

### What Are Microservices?

Microservices architecture structures an application as a collection of small, autonomous services modeled around business domains. Each service runs in its own process, owns its data, communicates via lightweight protocols (HTTP/gRPC/events), and can be deployed, scaled, and maintained independently.

### Key Benefits

* **Independent deployability:** Ship updates to one service without redeploying the entire system.
* **Technology diversity:** Each service can use the best language/framework for its domain.
* **Focused teams:** Small teams own end-to-end responsibility for a bounded context.
* **Granular scaling:** Scale only the services that need it, reducing infrastructure cost.
* **Resilience isolation:** A failure in one service does not cascade to others.

## Integration with Project Identity

```yaml
project:
  type: api
  name: my-microservices

stack:
  languages:
    - typescript
    - javascript
    - go
    - rust
    - python
  frameworks:
    - express
    - fastify
    - hono
    - nestjs
    - fastapi
  databases:
    - postgresql
    - redis
    - mongodb
  infrastructure:
    - docker
    - kubernetes
    - kafka

infrastructure:
  cloud: aws
  regions:
    - us-east-1

integrations:
  ci_cd: github-actions
  monitoring: datadog
```

## Communication Patterns

```text
[ Client / External ]
        │
        ▼
[ API Gateway ] ──────── (Auth, rate limiting, routing)
        │
        ├──→ [ User Service ] ──── [ Postgres ]
        ├──→ [ Order Service ] ─── [ Postgres ]
        ├──→ [ Payment Service ] ─ [ Postgres ]
        └──→ [ Notification ] ──── [ Queue ]
        
        ┌────── Event Bus (Kafka/RabbitMQ) ──────┐
        │                                         │
        ▼                                         ▼
[ Order Service ] ──publishes──→ [ Inventory ] ──consumes──→ [ Notification ]
```

## Key Design Patterns

### Database per Service
Each service owns its private database — no shared schema. Data integration happens via events or API composition.

### API Gateway
Single entry point for all clients. Handles auth, routing, rate limiting, and response aggregation.

### Service Discovery
Services register themselves on startup; clients resolve addresses dynamically (Consul, Kubernetes DNS, Eureka).

### Circuit Breaker
Wrap remote calls to fail fast when a downstream service is degraded. Prevent cascading failures.

### Saga Pattern
Coordinate multi-service transactions using choreography (events) or orchestration (dedicated coordinator).

### Observability Stack
- **Logging:** Centralized log aggregation (ELK, Loki)
- **Metrics:** Prometheus + Grafana dashboards
- **Tracing:** Distributed tracing (OpenTelemetry, Jaeger)

## Best Practices

* **Domain-driven boundaries:** Align service boundaries to business capabilities, not technical layers.
* **API-first design:** Define contracts (OpenAPI, gRPC proto) before implementation.
* **Asynchronous where possible:** Use event-driven communication for non-critical paths.
* **Automated CI/CD:** Every service has its own build, test, and deploy pipeline.
* **Health checks:** Every service exposes `/health` and `/ready` endpoints.
* **Graceful degradation:** Design fallbacks when dependencies are unavailable.
* **Containerize everything:** Docker + Kubernetes or similar orchestration.
* **Defensive boundaries:** Validate all inputs, handle partial failures explicitly.

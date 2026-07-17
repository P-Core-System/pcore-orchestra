# Serverless Architecture
*Event-Triggered — Auto-Scaling — Pay-Per-Use — Zero Infrastructure Management*

**Type mapping:** `type: api`, `type: ai`, `type: data`, `type: devops`
**Category:** Cloud-native infrastructure

## Project Structure

```text
serverless-app/
├── functions/                    # Lambda / Cloud Functions
│   ├── api/
│   │   ├── users/
│   │   │   ├── handler.ts         # GET /users, POST /users
│   │   │   ├── middleware.ts
│   │   │   └── model.ts
│   │   ├── orders/
│   │   │   ├── handler.ts
│   │   │   └── model.ts
│   │   └── index.ts               # Router entry
│   ├── event-handlers/
│   │   ├── order-placed.ts        # Triggered by event bus
│   │   ├── user-signed-up.ts
│   │   └── file-uploaded.ts
│   ├── scheduled/                 # Cron jobs
│   │   ├── daily-report.ts
│   │   └── cleanup-task.ts
│   └── stream-processors/
│       ├── clickstream.ts
│       └── analytics.ts
│
├── shared/                        # Shared code bundled per function
│   ├── types/
│   ├── utils/
│   └── db.ts                     # DB client (serverless-optimized)
│
├── infrastructure/                # IaC
│   ├── terraform/
│   │   ├── main.tf
│   │   ├── api-gateway.tf
│   │   ├── functions.tf
│   │   ├── databases.tf
│   │   └── queues.tf
│   ├── serverless.yml             # Serverless Framework
│   └── cdk/                       # AWS CDK / Pulumi
│       └── stack.ts
│
├── storage/                       # Connection configs
│   ├── tables.ts                  # DynamoDB schema
│   └── buckets.ts                 # S3 / R2 config
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

### What is Serverless Architecture?

Serverless is a cloud-native execution model where the cloud provider dynamically manages infrastructure allocation. You write functions triggered by events (HTTP requests, queue messages, file uploads, scheduled timers). Scaling, high availability, and capacity provisioning are handled entirely by the provider — you pay only for compute time consumed.

```text
[ Client / Event Source ]
        │
        ▼
   [ API Gateway ] ───── (HTTP endpoints, auth, throttling)
        │
        ▼
 [ Functions (FaaS) ] ── (Stateless, auto-scaling compute units)
        │
        ├──→ [ Databases ]     ─ DynamoDB, Aurora Serverless, Neon
        ├──→ [ Queues/Streams] ─ SQS, SNS, Kafka, EventBridge
        ├──→ [ Storage ]       ─ S3, R2, EFS
        └──→ [ External APIs ] ─ Payment, email, SaaS
```

## Integration with Project Identity

```yaml
project:
  type: api
  name: my-serverless-app

stack:
  languages:
    - typescript
    - python
    - go
    - rust
    - java
  frameworks:
    - hono
    - fastify
    - fastapi
    - express
  databases:
    - dynamodb
    - neon
    - sqlite
  infrastructure:
    - cloudflare
    - aws-lambda
    - terraform

infrastructure:
  cloud: cloudflare
  regions:
    - auto
```

## Key Characteristics

### Benefits
- **Zero infrastructure management** — No servers to patch, provision, or monitor
- **Automatic scaling** — From zero to thousands of concurrent executions
- **Pay-per-use** — No cost when idle. Billed per request + compute duration
- **Event-driven by nature** — Functions react to events from queues, streams, HTTP, cron
- **Faster time-to-market** — Focus on business logic, not infrastructure

### Limitations
- **Cold starts** — First invocation after idle incurs latency overhead
- **Execution timeout** — Most platforms cap execution at 15-30 minutes
- **Stateless by design** — No local state between invocations
- **Concurrency limits** — Account-level and function-level caps
- **Debugging complexity** — Local emulation ≠ cloud behavior

## Common Patterns

### API Backend
Functions behind API Gateway handling REST or GraphQL requests. Use frameworks like Hono, Fastify, or FastAPI for routing.

### Event-Driven Processing
Functions triggered by events from SQS, EventBridge, Kafka, or storage events. Process orders, resize images, transform data.

### Scheduled Tasks (Cron)
CloudWatch Events / Scheduler triggers functions on a schedule. Generate reports, cleanup expired data, sync with external systems.

### Fan-Out
Single event triggers multiple functions in parallel. `FileUploaded` can trigger thumbnail generation, virus scanning, and metadata extraction simultaneously.

### Backend for Frontend (BFF)
Lightweight API layer optimized for a specific client (web, mobile, third-party). Handles auth, data transformation, and aggregation.

## Stateless Function Pattern

```text
[ Request ]
     │
     ▼
[ Cold Start? ] ──Yes──→ [ Init: DB connect, load config ] ──→ [ Handle ]
     │ No                                                         │
     └────────────────────────────────────────────────────────────┘
                                                                  │
                                                                  ▼
                                                           [ Response ]
                                                                  │
                                                                  ▼
                                                        [ No state saved ]
```

## Best Practices

* **Optimize cold starts** — Reduce bundle size, prefer interpreted runtimes (JS/Python) for latency-sensitive paths, use provisioned concurrency for critical functions.
* **Design for idempotency** — Functions may be invoked multiple times (retries). Same event must produce same result.
* **Use serverless-optimized databases** — DynamoDB, Neon (serverless Postgres), Turso (SQLite), Upstash (Redis). Avoid long-lived connections.
* **Keep functions single-purpose** — One trigger, one responsibility. Compose via orchestration if needed.
* **Monitor everything** — Track invocations, duration, errors, cold starts, and throttles. Use CloudWatch, Datadog, or Cloudflare observability.
* **Secure by default** — Least privilege IAM roles, environment variables for secrets, validate all inputs.
* **Bundle carefully** — Exclude dev dependencies, use tree-shaking, consider Lambda Layers or OCI containers for large dependencies.
* **Implement structured logging** — JSON-formatted logs with correlation IDs for debugging across function invocations.

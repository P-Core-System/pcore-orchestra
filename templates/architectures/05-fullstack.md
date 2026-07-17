# Full Stack System Structure
*Frontend + Backend + Database*

**Type mapping:** `type: web`, `type: saas`, `type: internal-tool`
**Category:** Full-stack application

## Directory Tree

```text
fullstack-system/
├── frontend/
│   ├── public/
│   └── src/
│       ├── assets/
│       ├── components/
│       ├── pages/
│       ├── hooks/
│       ├── context/
│       ├── services/
│       ├── utils/
│       ├── App.jsx
│       ├── main.jsx
│       └── index.css
│   ├── .env
│   └── vite.config.js
├── backend/
│   └── src/
│       ├── config/
│       ├── controllers/
│       ├── models/
│       ├── routes/
│       ├── middleware/
│       ├── services/
│       ├── utils/
│       ├── app.js
│       └── server.js
│   └── .env
├── database/
│   └── schema.sql
├── .gitignore
├── package.json
└── README.md
```

## Three-Tier System Blueprint

### 1. Presentation Layer (Frontend - React)

The user interaction tier is completely isolated within the `frontend/` working space. Built as a fast, single-page client engine using modern bundlers (like Vite), it handles rendering, dynamic state updates, and interface transitions.

* **Core Task:** Transforms abstract entity JSON matrices returned from data endpoints into interactive views.

### 2. Logic Tier (Backend - Node.js / Express)

The application core engine is hosted safely in the `backend/` domain, managing incoming access routes, authorization pipelines, and domain rules.

* **Core Task:** Validates identity states via custom tracking middleware, executes business rules, and structures schema queries for the storage layer.

### 3. Storage Layer (Database - Relational / Document Store)

The system's persistent memory tier houses physical indexes, structural schemas, data relations, and tracking tables.

* **Core Task:** Handles fast data writes, updates metrics, and returns indexed records under rigorous transaction properties.

## Integration with Project Identity

```yaml
project:
  type: web
  name: my-fullstack-app

stack:
  languages:
    - typescript
    - javascript
  frameworks:
    - react
    - nextjs
    - hono
    - express
    - drizzle
  databases:
    - postgresql
    - sqlite
  package_manager: pnpm
  runtime: node

environments:
  development:
    url: "http://localhost:5173"
    branch: dev
  staging:
    url: "https://staging.my-app.com"
    branch: main
  production:
    url: "https://my-app.com"
    branch: main
```

## Architectural Interaction Map

### System Operational Sequence

```
User Interface (React Client) → Secure Network Ingress (Express API Node) → Data Engine (SQL / NoSQL)
```

1. **User Interaction:** The actor invokes an operation on the user interface workspace.
2. **API Payload Forwarding:** The frontend app issues a structured network request (e.g., Axios call) targeting API ingress tracks.
3. **Ingress Control Lifecycle:** The backend processes parameters against custom access guards and parsing filters.
4. **Domain Computation:** Service files apply analytical logic rules and coordinate with database persistence instances.
5. **Storage Commitment:** The database processes queries safely, returns output sets, and updates internal tracking indexes.
6. **Data Transport Delivery:** The API tier converts system responses into consistent JSON objects, streaming them back to hydration modules in the client layer.

## Component Responsibilities

| Layer | Responsibility |
|-------|---------------|
| Frontend | UI, user interaction, client-side state |
| Backend | Business logic, API, server-side state |
| Database | Data storage, integrity, queries |

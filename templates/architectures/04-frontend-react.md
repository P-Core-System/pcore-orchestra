# Frontend Folder Structure (React)
*Scalable — Modular — Maintainable*

**Type mapping:** `type: web`
**Category:** Frontend application

## Folder Structure

```text
src/
├── assets/
│   ├── images/
│   ├── icons/
│   ├── fonts/
│   └── svgs/
├── components/
│   ├── common/
│   └── features/
├── hooks/
│   ├── useAuth.js
│   └── useDebounce.js
├── pages/
│   ├── home/
│   ├── about/
│   ├── profile/
│   └── NotFound.jsx
├── services/
│   ├── api.js
│   └── authService.js
├── store/
│   ├── index.js
│   └── slices/
├── utils/
│   ├── helpers.js
│   └── constants.js
├── styles/
│   ├── global.css
│   └── variables.css
├── routes/
│   ├── AppRoutes.jsx
│   └── PrivateRoute.jsx
├── App.jsx
├── main.jsx
├── .env
├── .gitignore
├── package.json
└── README.md
```

## Architectural Design Strategy

### Why Standardize the React Workspace?

This project structure enforces high cohesion and low coupling across single-page web applications. By separating generic UI containers from specialized logic handlers, front-end architecture remains predictable as teams expand and codebase scopes scale.

### Core Domain Allocations

* `assets/` → Unprocessed asset blocks including font faces, static images, icon systems, and layout vectors.
* `components/` → Presentation bricks split into structural reusable atomic units (`common/` buttons, forms) and specific feature blocks (`features/` dashboard widgets).
* `hooks/` → State machines containing customized hooks (`useAuth`, `useDebounce`) isolating pure React hooks lifecycle algorithms away from rendering markups.
* `pages/` → Route layouts containing layout views that wire feature components into complete, screen-level views.
* `services/` → Dynamic clients handling remote API queries, client instance properties, and HTTP tracking middleware.
* `store/` → Global application data nodes utilizing modern slice engines (Redux Toolkit, Zustand stores).
* `utils/` → Functional computation modules containing stateless calculation routines, validation tools, and global application constants.
* `styles/` → Presentation rules mapping base variables, global overrides, and design system design grids.
* `routes/` → Declarative routers executing route interceptors, role authorization constraints, and code-split lazy rendering.

## Integration with Project Identity

```yaml
project:
  type: web
  name: my-app

stack:
  languages:
    - typescript
    - css
  frameworks:
    - react
    - nextjs
    - vite
    - tailwindcss
  package_manager: pnpm
  runtime: node

environments:
  development:
    url: "http://localhost:5173"
  production:
    url: "https://my-app.com"
```

## In-App Data Processing Blueprint

### Interaction Pathway

1. **User Interaction:** The actor executes an operation on the client interface view.
2. **Router Handling:** The routing engine captures state changes and mounts matching target elements from the `pages/` namespace.
3. **Component Grid Lifecycle:** The layout aggregates necessary feature blocks, triggering layout hooks.
4. **Logic Separation:** Context hooks interact with global state machines (`store/`) or fire outbound requests via backend wrappers (`services/`).
5. **Data Hydration:** Backend data sets map back down into functional parameters, re-rendering UI presentations safely.

### Best Practices Checklist

* **Enforce Strict Atomic Reusability:** Ensure components inside `components/common/` map cleanly to pure, side-effect-free presentational models relying entirely on passed variables.
* **Leverage Import Aliases:** Configure project settings (`jsconfig.json` or `tsconfig.json`) to allow absolute syntax calls (e.g., `import button from '@/components/common/button'`), stripping away brittle nested relative tracks (`../../../../`).
* **Keep Component Layouts Clean:** Keep complex data aggregation, interceptors, and business logic calculations housed cleanly in isolated custom hooks or external logic layers.
* **Maintain Naming Conventions:** Standardize component structures using clear PascalCase configurations (e.g., `UserProfileCard.jsx`) while storing standard hooks and helpers using descriptive camelCase notation (e.g., `useLocalStorage.js`).

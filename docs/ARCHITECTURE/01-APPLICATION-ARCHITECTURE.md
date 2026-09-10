# 01 — Application Architecture

The monorepo, its workspaces, and how the two applications relate.

---

## Repository Layout

```
Callibrator/
├── CLAUDE.md              agent operating instructions
├── AGENTS.md              role definitions and workflows
├── README.md              entry point
├── Makefile               deployment and development targets
├── package.json           workspace root (turbo scripts)
├── pnpm-workspace.yaml    workspace members
├── turbo.json             task graph and caching
├── tsconfig.json          TypeScript base (frontend only in practice)
│
├── docs/                  reference documentation — this folder
├── MEMORY/                decisions, change records, specs
├── TASKS/                 execution plan
├── deploy/                compose stacks and Helm charts
│
├── backend/               Express · JavaScript · CommonJS
│   ├── index.js           app assembly, middleware order, route mounting
│   ├── src/
│   │   ├── routes/api/    53 route modules
│   │   ├── routes/internal/  migration.route.js — the only internal router
│   │   ├── controllers/   56
│   │   ├── services/      76
│   │   ├── models/        72 + index.js (the barrel, and the hook installation site)
│   │   ├── middlewares/   21
│   │   ├── validators/    37 Joi schemas
│   │   ├── migrations/    18, Umzug
│   │   ├── utils/         20
│   │   ├── constants/     5
│   │   ├── config/        4
│   │   ├── workers/       1
│   │   ├── templates/     email and certificate HTML
│   │   └── tests/         342 files, unit + e2e
│   ├── docs/              generated API docs, SVG illustrations, audit reports
│   ├── Dockerfile
│   └── swagger.json       generated
│
└── frontend/              Next.js 16 · React 19 · TypeScript
    ├── src/
    │   ├── app/           App Router — dashboard, blog, auth, api proxy
    │   ├── api/           client.ts + services/ (51 services, 51 tests)
    │   ├── components/    shared UI, landing, layouts, editor, motion
    │   ├── stores/        Zustand slices
    │   ├── hooks/         cross-cutting hooks
    │   ├── lib/           socket, certificate PDF, upload URL, sound
    │   ├── contexts/      React contexts
    │   ├── types/         shared TypeScript types
    │   └── proxy.ts       API proxying
    ├── Dockerfile
    └── docs/
```

## Workspace Configuration

The root declares workspaces in **two** places, which is a real inconsistency worth knowing:

- `package.json` has an npm-style `"workspaces": ["backend", "frontend", "packages/*"]`
- `pnpm-workspace.yaml` declares the same members

`packages/*` matches nothing. There is no shared package, because there is nothing to share between a CommonJS JavaScript backend and a TypeScript frontend — no shared types, no shared validation. The glob is aspirational.

Turbo drives the task graph:

```json
{
  "tasks": {
    "dev":       { "cache": false, "persistent": true },
    "build":     { "outputs": ["dist/**"], "cache": true },
    "test":      { "cache": true, "outputs": ["coverage/**"] },
    "typecheck": { "cache": true },
    "lint":      { "cache": true }
  },
  "globalDependencies": ["**/.env.local", "**/.env"]
}
```

`typecheck` runs meaningfully only in `frontend/`. The backend has no TypeScript to check (ADR-030).

## How the Two Applications Talk

```
Browser ──▶ Next.js ──▶ Express API
                │
                ├─ server components / route handlers: server-to-server
                └─ client components: direct to the API origin, Bearer token
```

`frontend/src/app/api/v1/[...path]` is a catch-all proxy, and `frontend/src/proxy.ts` supports it. This lets the browser call a same-origin path while the server forwards to the API — useful where a strict CSP or a corporate proxy makes a cross-origin call awkward.

Both paths exist. Which one a given service uses is a per-service decision, and `frontend/src/api/client.ts` is where the base URL is resolved (`NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_API_VERSION`).

## Backend Layering

```
route → middleware chain → validator → controller → service → model
```

| Layer | Responsibility | Must not |
|---|---|---|
| route | mount path, compose middleware | contain logic |
| validator | Joi schema for body, query, params | touch the database |
| controller | unwrap request, call service, send envelope | open transactions, query models |
| service | business logic, transactions, orchestration | touch `req` or `res` |
| model | schema, associations, instance methods | contain workflow logic |

Two known violations, both worth fixing rather than codifying:

- a handful of controllers query models directly,
- a handful of services accept `req`-shaped objects.

### The validator trap

`validate(schema)` from `validation.middleware.js` returns middleware. Passing `schema.validate` directly to Express **500s every request** on that route, because Express calls it with `(req, res, next)` and Joi expects a value.

The same shape appeared as a defect where a controller spread a Joi schema into a plain object and then called `schema.validate` on the result — `schema.validate is not a function`, on every request.

### The params-versus-body trap

Several endpoints take an identifier as a **path parameter** and validated it in `req.body`, which 400ed every request. The fix is to merge before validating:

```js
validate(schema)({ ...req.params, ...req.body })
```

This shape recurred across feature flags, tenant lifecycle and data retention. When adding an endpoint with both path params and a body, check which one the validator reads.

## Model Barrel and Hook Installation

`backend/src/models/index.js` is more than a barrel. It:

1. constructs the Sequelize instance,
2. loads every model,
3. wires associations,
4. **installs the global tenant hooks** from `utils/tenantScope.util.js`.

It exports `sequelize`, **not** `db`. A service destructuring `db` from it gets `undefined`, and `db.sequelize.transaction()` then throws — which is exactly what broke every workflow create and update until it was fixed.

## Frontend Layering

```
page (app/) → hook (hooks/) → service (api/services/) → client.ts → API
                   │
                   └── store (stores/) for cross-cutting state
```

Each dashboard domain keeps its own `components/` and `hooks/` beside its `page.tsx`. Only genuinely shared UI lives in `src/components/`.

Zustand stores exist for state that outlives a page: auth, menu tree, tenant branding, toasts, notifications, and a few domain caches.

## Testing Layout

| Location | Kind | Count |
|---|---|---|
| `backend/src/tests/` | unit and integration | 342 files |
| `backend/src/tests/e2e/modules/` | live-server E2E, one per module | 51 specs |
| `frontend/src/api/services/*.service.test.ts` | mocked contract tests | 51 |
| `frontend/**/__tests__/` | component tests | — |
| `automate/` | Playwright browser suite | 71 tests |

The backend unit suite runs against a 100% coverage gate; the frontend against 70%. See [`../TESTING/00-TEST-STRATEGY.md`](../TESTING/00-TEST-STRATEGY.md).

## Build Outputs

| Command | Produces |
|---|---|
| `backend: npm run build` | `swagger.json` regenerated, then `dist/backend` via pkg |
| `backend: npm run build:bun` | `dist/boilerplate` via `bun build --compile` |
| `frontend: npm run build` | standard `.next` output |
| `frontend: npm run compile` | `dist/` standalone binary via `next-bun-compile` |

The backend build regenerates the OpenAPI spec first. A build that skips it ships a spec describing the previous version, which is worse than shipping none.

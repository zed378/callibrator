# 00 — System Architecture

---

## The Shape

```
                          ┌──────────────────────────┐
                          │   Browser / API client   │
                          └────────────┬─────────────┘
                                       │ HTTPS
                          ┌────────────▼─────────────┐
                          │   nginx  (reverse proxy) │
                          │   TLS · routing · ACME   │
                          └──────┬─────────────┬─────┘
                                 │             │
                  ┌──────────────▼───┐   ┌─────▼──────────────────┐
                  │  Next.js 16      │   │  Express (JavaScript)  │
                  │  React 19 · SSR  │──▶│  modular monolith      │
                  │  compiled (bun)  │   │  compiled (pkg)        │
                  └──────────────────┘   └─────┬──────────────────┘
                                               │
        ┌──────────┬──────────┬────────────────┼──────────┬──────────┐
        ▼          ▼          ▼                ▼          ▼          ▼
  ┌──────────┐ ┌───────┐ ┌──────────┐  ┌────────────┐ ┌───────┐ ┌────────┐
  │ Postgres │ │ Redis │ │ RabbitMQ │  │ Object     │ │ MQTT  │ │ ClamAV │
  │ pgvector │ │       │ │          │  │ storage    │ │mqtt   │ │        │
  │ +pgvector│ │       │ │          │  │ local|s3|  │ │(embed)│ │        │
  │          │ │       │ │          │  │ nfs        │ │       │ │        │
  └──────────┘ └───────┘ └──────────┘  └────────────┘ └───────┘ └────────┘
```

Socket.IO runs on the same Express server and shares its port.

## Design Decisions That Explain Everything Else

### It is a modular monolith, not microservices

One Express process serving 54 route modules across 33 functional domains, mounted 56 times — `oidc` and `menu-groups` are each mounted twice.

This is the right shape here for a specific reason: **tenant isolation is a cross-cutting invariant, and cross-cutting invariants are cheap in one process and expensive across many.** The isolation mechanism is a set of global Sequelize hooks reading an `AsyncLocalStorage` context. In a microservice architecture the same guarantee needs every service to independently implement it correctly, and the failure of any one is a data breach.

The cost is a single deployable and a single failure domain, both accepted (PR-12).

### The database engine is not assumed

**PostgreSQL is the only supported database (ADR-039).** The platform was designed for PostgreSQL *or* MySQL (ADR-029), and several schema choices still show it — a materialised path instead of recursive CTEs, `VIRTUAL` columns instead of generated ones. Those designs stand until a decision changes them; they are no longer required.

The MySQL claim was never a capability: `mysql2` was not a dependency, and search, webhooks and RAG used PostgreSQL-only SQL. pgvector is required: `document_chunks.embedding` is `vector(1536)` and retrieval is a tenant-scoped cosine-distance search. The former non-PostgreSQL branch — which returned the five most *recent* chunks as "context" regardless of relevance — was removed with MySQL support (ADR-039). Full-text search is [`../SEARCH/02-FULL-TEXT.md`](../SEARCH/02-FULL-TEXT.md); webhook fan-out is [`../WEBHOOK/00-WEBHOOK-ARCHITECTURE.md`](../WEBHOOK/00-WEBHOOK-ARCHITECTURE.md).

## Request Pipeline

Order is load-bearing; `backend/index.js` is the source of truth.

```
compression
  → HTTPS redirect            (production + FORCE_HTTPS only)
  → helmet                    (CSP, frame-ancestors none, object-src none)
  → hpp                       (parameter pollution)
  → CORS                      (explicit allowlist, credentials true, never "*")
  → rate limiter              (global, 15-min window)
  → body parser               (10 MB; raw body preserved for the Stripe webhook)
  → timeout 30s               (→ 408)
  → request id                (→ X-Request-Id)
  → accessLog, activityLog
  → static: /.well-known, /uploads (nosniff + inline), /public
  → globalSanitizer
  → swagger
  ─────────────────── per route ───────────────────
  → auth                      (JWT → req.user, req.tenantId)
  → tenantContext             (AsyncLocalStorage: tenantId, isSuperAdmin, isSystemTask)
  → dynamicAccess / rbac / abac
  → validate(schema)          (Joi)
  → controller → service → model
  ─────────────────────────────────────────────────
  → notFound
  → errorHandler
```

Four points about this order:

- **`globalSanitizer` runs before every route** but after the body parser, which is why `req.rawBody` survives it — the sanitizer rewrites `req.body`, `req.query` and `req.params` only.
- **`tenantContext` runs after `auth`** because it reads `req.tenantId`, which auth sets (honouring the super-admin `x-tenant-id` override).
- **CORS never reflects an arbitrary origin.** The policy runs with `credentials: true`, and reflecting `*` with credentials lets any site make authenticated cross-origin requests. In production with no configured origins it rejects.
- **The rate limit is 5,000/15 min in production and 100,000 outside it.** A full browser E2E run exhausts a production budget and then fails for reasons unrelated to the code under test. `RATE_LIMIT_MAX` overrides either way.

## Layers Inside the Monolith

```
routes/        53 modules — mounting, middleware composition
  ↓
validators/    37 Joi schemas
  ↓
controllers/   56 — HTTP in, HTTP out, no business logic
  ↓
services/      76 — business logic, transactions
  ↓
models/        72 Sequelize models + global tenant hooks
  ↓
database
```

Cross-cutting: `middlewares/` (21), `utils/` (20), `constants/` (5), `config/` (4), `workers/` (1).

A controller that opens a transaction, or a service that touches `req`, is a layering violation. Both exist in a few places and both are wrong.

## Realtime

Socket.IO on the same server (ADR-031). Authentication uses a short-lived socket token minted by the API, not the access token — a long-lived credential should not be handed to a transport that holds it for the life of a connection.

Rooms are per tenant. The join takes a **raw id**, not a prefixed room name; passing a prefix joins a room nobody publishes to and the symptom is silence, not an error.

## Frontend Architecture in One Paragraph

Next.js App Router. `src/app/dashboard/*` is the authenticated surface, one directory per domain, each with local `components/` and `hooks/`. `src/api/services/*.service.ts` is one module per backend domain (51 of them, each with a sibling test). `src/stores/*` holds Zustand slices for cross-cutting state. The sidebar is rendered from the server-resolved menu tree, so an unauthorised surface is **absent**, not hidden. Detail in [`02-FRONTEND-ARCHITECTURE.md`](./02-FRONTEND-ARCHITECTURE.md).

## What Is Deliberately Absent

| Absent | Why |
|---|---|
| Service mesh, API gateway | one process; nginx is enough |
| Separate admin deployment | the admin surface is role-gated inside the same app |
| Data warehouse | reporting runs on the operational database until measurement says otherwise |
| GraphQL | REST plus a generated OpenAPI spec, with a client SDK story that already works |
| Shared `packages/` workspace | referenced by the workspace glob, currently empty — no code is shared between a JavaScript backend and a TypeScript frontend |

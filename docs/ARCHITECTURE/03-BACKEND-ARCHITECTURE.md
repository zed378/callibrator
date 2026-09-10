# 03 — Backend Architecture

Coding standards are in [`../BACKEND/00-BACKEND-STANDARDS.md`](../BACKEND/00-BACKEND-STANDARDS.md). The per-module deep reference is [`../BACKEND/10-MODULE-REFERENCE.md`](../BACKEND/10-MODULE-REFERENCE.md). This document is the structure.

---

## What It Is

An Express modular monolith in **JavaScript (CommonJS)**, not TypeScript (ADR-030). `"type": "commonjs"`, entry `index.js`, Node 24.

Anyone acting on an instruction to "remove the `any` types" or "enable strict mode" in `backend/` is working from a stale premise. There are no types to remove.

## Composition Root

`backend/index.js` is where everything is assembled, in this order:

```
1.  security      compression, HTTPS redirect, helmet, hpp, CORS
2.  throttling    global rate limiter
3.  parsing       express.json (10 MB, raw-body hook for the Stripe webhook), urlencoded
4.  resilience    30s timeout → 408
5.  correlation   crypto.randomUUID() → req.requestId → X-Request-Id
6.  logging       accessLog, activityLogger
7.  static        /.well-known (ACME), /uploads (nosniff + inline), /public
8.  sanitising    globalSanitizer
9.  docs          swagger UI + swagger.json
10. routing       53 route modules
11. health        GET /health (503 when the database is unreachable), GET /
12. errors        notFound, errorHandler
```

The order is behaviour, not style. Four consequences worth stating:

- The raw-body hook fires **only** for `/api/v1/billing/webhook`. Moving that mount without moving the prefix silently breaks Stripe signature verification.
- `globalSanitizer` rewrites `req.body`, `req.query`, `req.params` — and not `req.rawBody`, which is why the webhook still works.
- Static `/uploads` sits **before** the sanitizer and before routing, so upload serving does not pay for either.
- `/health` calls `db.authenticate()` and returns **503** on failure. It is a readiness probe, not a liveness ping.

## Directory Responsibilities

| Directory | Count | Responsibility |
|---|---|---|
| `routes/api/` | 53 | mount path and middleware composition only |
| `routes/internal/` | 1 | `migration.route.js` — schema operations over HTTP |
| `validators/` | 37 | Joi schemas |
| `controllers/` | 56 | request in, envelope out |
| `services/` | 76 | business logic and transactions |
| `models/` | 72 | schema, associations, instance methods |
| `middlewares/` | 21 | cross-cutting concerns |
| `utils/` | 20 | pure helpers |
| `constants/` | 5 | roles, rate limits, tenant, app |
| `config/` | 4 | environment resolution |
| `migrations/` | 18 | Umzug migrations |
| `workers/` | 1 | RabbitMQ consumer |
| `templates/` | — | email and certificate HTML |

## The Middleware Set

| Middleware | Does |
|---|---|
| `auth` | verifies the JWT, loads the user and role, sets `req.user` and `req.tenantId`, honours the super-admin tenant override, rejects suspended tenants |
| `tenantContext` | opens the `AsyncLocalStorage` scope carrying `{ tenantId, isSuperAdmin, isSystemTask }` |
| `dynamicAccess(resource, action)` | menu-group RBAC plus ABAC |
| `rbac([roles])` | role-level gate by `ROLE_LEVELS` |
| `abac` | attribute-based rules |
| `validate(schema)` | Joi validation → 400 with field detail |
| `validateUuid` | rejects malformed path ids before they reach the database |
| `globalSanitizer` | input sanitisation across body, query, params |
| `inputValidation` | additional input hardening |
| `auditLog` | writes the `audit_logs` row |
| `accessLog`, `activityLog` | request and activity logging |
| `enforceQuota` | quota check **before** the handler |
| `sessionSecurity` | session binding checks |
| `sessionCleanup` | expired-session sweep |
| `retentionScheduler` | data-retention cron |
| `calibrationScheduler` | calibration due sweep |
| `backup` | tenant backup scheduling |
| `createFolder` | upload directory preparation |
| `errorHandlers` | central error mapping |
| `notFound` | 404 terminator |

`sessionCleanup`, `retentionScheduler`, `calibrationScheduler` and `backup` are scheduling concerns living in `middlewares/` because they are installed at app assembly time. They are not per-request middleware, and the directory name misleads.

## Tenant Isolation

The single most important mechanism in the backend. Full treatment: [`../BACKEND/05-TENANT-SCOPING.md`](../BACKEND/05-TENANT-SCOPING.md) and [`../SECURITY/05-MULTI-TENANCY-SECURITY.md`](../SECURITY/05-MULTI-TENANCY-SECURITY.md).

```
AsyncLocalStorage (tenantContext.middleware.js)
        │  { tenantId, isSuperAdmin, isSystemTask }
        ▼
global Sequelize hooks (tenantScope.util.js, installed by models/index.js)
        │
        ├─ beforeFind / beforeBulkUpdate / beforeBulkDestroy → inject WHERE
        └─ beforeCreate / beforeUpdate                        → stamp tenantId
```

Resolution:

| Condition | Result |
|---|---|
| `options.skipTenantScope` | skip — explicit, greppable |
| no CLS context | skip — pre-auth, public, migrations, schedulers |
| `isSystemTask` | skip |
| `isSuperAdmin` | skip |
| `tenantId` present | filter |
| otherwise | **deny** — `tenantId = NO_TENANT_UUID` |

`NO_TENANT_UUID` is `00000000-0000-0000-0000-000000000000`: a valid UUID chosen over a sentinel string because tenant columns are UUID-typed, and a non-UUID literal makes PostgreSQL raise a type error — turning a denial into a 500.

`tenantKeyOf()` accepts **both** `tenantId` and `tenant_id`, because `sessions` uses the snake_case attribute.

## Error Handling

`AppError(status, message)` from `utils/appError.util.js`, mapped centrally by `errorHandlers.middleware.js` to:

```json
{ "success": false, "status": 400, "message": "...", "data": null }
```

`details` is attached **only** outside production.

The rule that matters: **the error mapper forwards recognised error types only.** A raw `pg` error message carries SQL; a raw Node error carries a file path. No amount of care at the call site fixes a mapper that passes unknown errors through.

## Response Envelope

`utils/response.util.js` exports `success`, `error`, `paginated`, `notFound`, `badRequest`, `unauthorized`, `forbidden`, `login`, `paginate`.

```json
{ "success": true, "status": 200, "message": "...", "data": [], "meta": { "total": 0, "page": 1, "limit": 20, "totalPages": 0 } }
```

`meta` is a **top-level sibling of `data`**, never nested inside it. `paginated()` builds it. See [`../API/00-API-STANDARDS.md`](../API/00-API-STANDARDS.md).

`login()` additionally attaches `token` and a trimmed `session` object.

## Models and the Barrel

`models/index.js` constructs Sequelize, loads all 72 models, wires associations, and installs the tenant hooks. It exports **`sequelize`**, not `db`.

A service writing `const { db } = require("../models")` gets `undefined` and then throws on `db.sequelize.transaction()`. That was a real defect across three workflow functions.

Conventions:

| | |
|---|---|
| Primary key | `UUID` / `UUIDV4` |
| Columns | `underscored` — `isDeleted` in code, `is_deleted` in the database |
| Soft delete | `paranoid: true` plus an `isDeleted` boolean on most models |
| Not soft-deleted | `audit_logs`, `iot_readings`, and most join tables |

Two recurring Sequelize traps:

- **`required: false` on optional includes.** Sequelize defaults an include with a `where` to an INNER JOIN, which drops every parent whose optional association is null. This produced two separate "the list is empty" defects — risks with no assignee, and certificates with any null actor FK.
- **`.unscoped()`** is needed to see soft-deleted rows past a `defaultScope`.

## Workers and Schedulers

One worker (`workers/`), consuming RabbitMQ for batch jobs and notification fan-out. `BATCH_JOBS_INLINE=true` processes in-process instead, so local development needs no broker.

Cron-style work runs through `node-cron`:

| Variable | Default | Job |
|---|---|---|
| `SESSION_CLEANUP_SCHEDULER` | — | expired sessions |
| `BACKUP_SCHEDULER` | — | tenant backups |
| `RETENTION_SCHEDULER` | — | data-retention purge (`disabled` turns it off) |

Idempotency is not optional in the worker. "Check then mark" is racy — two consumers can both pass the check before either marks. Use an atomic `SET NX`, and make sure a failed attempt **releases** its claim, or three retries become one attempt and two no-ops with identical logs.

## Embedded Services

Two things run inside the Express process rather than beside it:

| | |
|---|---|
| **Socket.IO** | same server, same port |
| **MQTT broker** | `aedes` + `aedes-server-factory`, for IoT telemetry ingest |

An embedded MQTT broker is unusual. It is here so a hospital deployment does not need a separate broker to accept device telemetry, which matters in an on-premise install where every additional service is a procurement conversation.

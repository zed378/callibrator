# 11 — Dual-Backend Architecture

> **Superseded in part by ADR-134 (2026-10-08, plan).** The root `shared/` area, shared UI components and a per-backend frontend adapter described here are **not** the plan any more: shared code lives in `packages/*` (logic and design tokens only; each platform renders its own UI), and one OpenAPI-generated client serves both engines. See [`docs/SHARED/01-ARCHITECTURE.md`](../SHARED/01-ARCHITECTURE.md) § 9. The rest of this document stands until P32-09 rewrites it.

> **Scope:** This document describes the **target** architecture as of 2026-09-27 (ADR-089). The current runtime is the TypeScript backend only (`backend/src/`). The Go backend engine (`backend-go/`) is a future implementation assigned exclusively to **Phase 999**. Nothing documented under Go here exists in the repository today. Do not implement any of it before Phase 999 is entered.

Related documents:
- Current backend runtime: [`03-BACKEND-ARCHITECTURE.md`](./03-BACKEND-ARCHITECTURE.md)
- Multi-frontend architecture: [`12-MULTI-FRONTEND-AND-SHARED-COMPONENTS.md`](./12-MULTI-FRONTEND-AND-SHARED-COMPONENTS.md)
- Go porting specification: [`../BACKEND/12-GO-PORTING-SPECIFICATION.md`](../BACKEND/12-GO-PORTING-SPECIFICATION.md)
- Go coding standards: [`../ENGINEERING/15-GO-CODING-STANDARDS.md`](../ENGINEERING/15-GO-CODING-STANDARDS.md)
- Backend interoperability contract: [`../API/14-BACKEND-INTEROPERABILITY-CONTRACT.md`](../API/14-BACKEND-INTEROPERABILITY-CONTRACT.md)
- Phase 999 implementation backlog: [`../../TASKS/PHASE-999-GO-MIGRATION-AND-DUAL-BACKEND.md`](../../TASKS/PHASE-999-GO-MIGRATION-AND-DUAL-BACKEND.md)
- Decision record: [`../../MEMORY/DECISIONS.md`](../../MEMORY/DECISIONS.md) § ADR-089

---

## 1. Why Dual-Backend?

The existing TypeScript backend (`backend/src/`) is a mature Node.js/Express modular monolith serving 53 route modules, 71 Sequelize models, and 76 services. It handles all platform domains: authentication, calibration, QMS, IoT telemetry, e-signatures, GDPR, billing, SCIM provisioning, and more.

The rationale for introducing a second backend engine instead of continuing to evolve the TypeScript backend exclusively:

| Motivation | Detail |
|---|---|
| **Concurrency ceiling** | Node.js is single-threaded. Under high-concurrency ingest (IoT telemetry, batch calibration scheduling, simultaneous PDF generation), a single event-loop bottleneck limits throughput even with horizontal scaling |
| **Memory footprint** | The Node.js + Express process carrying all 71 models, Socket.IO, and 8 worker threads has a meaningful baseline memory cost per replica. Go's goroutines are orders of magnitude cheaper, making tight-packing across replicas feasible |
| **Binary startup and deployment** | Go compiles to a self-contained binary with no runtime dependency. The Node.js process requires a node version, `node_modules`, and careful treatment of non-bundled assets (`swagger.json`, `src/templates`, `docs/`; see the DevOps engineer note in `AGENTS.md`) |
| **Type-checked domain contract** | After Phase 9 closes, the TypeScript backend will have a formally typed domain contract. That contract forms the specification against which the Go backend is built — parity is measurable, not assumed |

### What Dual-Backend Does Not Mean

- It does not mean microservices. Both backends are monoliths scoped to the same domain.
- It does not mean the TypeScript backend is deprecated. It is the reference implementation and remains supported indefinitely.
- It does not mean requests are split across backends by resource type in Phase 999. The initial operational model is **full backend per deployment**, with the Go backend optionally acting as a proxy target for high-throughput paths over time once parity is proven.
- It does not mean the database schema changes. Both backends share the same PostgreSQL 18 schema.

---

## 2. Conceptual Architecture Diagram

```text
                         CALLIBRATOR PLATFORM
                                  │
      ┌───────────────────────────┴───────────────────────────┐
      │          Root-Level Shared Area (target: shared/)     │
      │  components/ · utilities/ · types/ · contracts/       │
      └───────────────────────────┬───────────────────────────┘
                                  │
               ┌──────────────────┴──────────────────┐
               │         Browser / API Client         │
               └──────────────────┬──────────────────┘
                                  │ HTTPS
               ┌──────────────────▼──────────────────┐
               │          nginx (reverse proxy)       │
               │         TLS · routing · ACME         │
               └────────────┬─────────────┬───────────┘
                            │             │
           ┌────────────────▼──┐       ┌──▼─────────────────┐
           │  TypeScript Front │       │   Go Front Target  │
           │  (Next.js 16 /    │       │   (future Phase    │
           │   React 19 / TS)  │       │    999 adapter)    │
           └────────────┬──────┘       └──────┬─────────────┘
                        │                     │
           ┌────────────▼──────┐       ┌──────▼─────────────┐
           │  TS API Adapter   │       │  Go API Adapter    │
           │  (services/api.ts)│       │  (services/api-go) │
           └────────────┬──────┘       └──────┬─────────────┘
                        │                     │
           ┌────────────▼──────┐       ┌──────▼─────────────┐
           │ TypeScript Backend│       │   Go Backend       │
           │  (backend/src/)   │       │   (backend-go/)    │
           │  existing,        │       │   future,          │
           │  reference impl   │       │   Phase 999 only   │
           └────────────┬──────┘       └──────┬─────────────┘
                        │                     │
               ┌────────┴──────┬──────────────┴────────────┐
               │               │                            │
         ┌─────▼──────┐  ┌─────▼─────┐  ┌─────────────────▼──┐
         │ PostgreSQL │  │  Redis    │  │ RabbitMQ / Storage  │
         │  18 +      │  │  (cache · │  │  ClamAV · MQTT     │
         │  pgvector  │  │   session)│  │  (client, external) │
         └────────────┘  └───────────┘  └────────────────────┘
```

---

## 3. Existing TypeScript Backend — Authoritative Specification

### 3.1 Location and Entry Points

| Path | Role |
|---|---|
| `backend/index.js` | Composition root — mounts everything, in order |
| `backend/src/routes/api/` | 53 route modules |
| `backend/src/routes/internal/` | 2 internal routes (`health`, `migration`) |
| `backend/src/services/` | 76 services |
| `backend/src/controllers/` | 56 controllers |
| `backend/src/validators/` | 37 Joi validators (migrating to Zod in Phase 9) |
| `backend/src/models/` | 71 Sequelize models + `models/index.js` barrel |
| `backend/src/middlewares/` | 21 middlewares |
| `backend/src/migrations/` | 63 numbered migration files (`0001`–`0090`, with gaps for reserved blocks) |
| `backend/src/templates/` | HTML email and certificate PDF templates |

### 3.2 Language Status

**As-built: JavaScript / CommonJS** (`"type": "commonjs"`, entry `index.js`, Node 24).
**Target: strict TypeScript** (ADR-038), migrated module by module under Phase 9.

Until Phase 9 closes, `backend/src/` contains **zero `.ts` source files**. Instructions to "add types to the backend" or "fix the TypeScript errors in backend/" rest on a stale premise.

### 3.3 Responsibility Domains

| Domain | Primary service file(s) | Key models |
|---|---|---|
| Authentication & sessions | `auth.service.js`, `session.service.js` | `users`, `sessions`, `api_keys` |
| RBAC & ABAC | `role.service.js`, `permission.service.js` | `roles`, `menu_groups`, `role_menu_groups` |
| MFA & WebAuthn | `mfa.service.js`, `webauthn.service.js` | `users.mfaSecret`, `webauthn_credentials` |
| OIDC provider | `oidc.service.js` | `oidc_clients`, `oidc_authorization_codes` |
| SCIM provisioning | `scim.service.js` | `users`, `scim_tokens` |
| Tenant lifecycle | `tenant.service.js` | `tenants`, `tenant_keys`, `tenant_settings` |
| Calibration devices | `calibrationDevice.service.js` | `calibration_devices`, `calibration_device_attachments` |
| Calibration records | `calibrationRecord.service.js` | `calibration_records` |
| Certificates & e-signature | `certificate.service.js`, `kms.service.js` | `certificates`, `certificate_signers`, `tenant_keys` |
| Warehouse & stock | `warehouse.service.js`, `stock.service.js` | `warehouses`, `locations`, `stock_items` |
| QMS | `nonConformance.service.js`, `capa.service.js`, `sop.service.js` | `non_conformances`, `capas`, `sops` |
| IoT telemetry | `iot.service.js` | `iot_readings`, `calibration_devices.iotDeviceToken` |
| Webhooks (outbox) | `webhook.service.js`, `webhookDeliveryScheduler.middleware.js` | `webhooks`, `webhook_deliveries` |
| Object storage | `storage.service.js` + drivers: `local.storage.js`, `s3.storage.js`, `nfs.storage.js` | `attachments` |
| Billing & metering | `billing.service.js`, `meteredBilling.service.js` | `billing_plans`, `usage_records` |
| GDPR & retention | `gdpr.service.js`, `retention.service.js` | per-domain `*_retention_policies` |
| Audit logging | All services via transaction hook | `audit_logs` |

### 3.4 Tenant Isolation Mechanism

The TypeScript backend enforces tenant isolation via **global Sequelize hooks** reading an **`AsyncLocalStorage`** context. This is the most critical security mechanism in the platform.

```
auth.middleware.js
    sets req.tenantId (honouring SUPERADMIN x-tenant-id override)
            │
tenantContext.middleware.js
    AsyncLocalStorage.run({ tenantId, isSuperAdmin, isSystemTask })
            │
models/index.js — installs global hooks once at startup
    beforeFind / beforeBulkUpdate / beforeBulkDestroy → WHERE tenant_id = $tenantId
    beforeCreate / beforeUpdate                       → stamps tenantId from context
```

Source files:
- `backend/src/middlewares/tenantContext.middleware.js`
- `backend/src/utils/tenantScope.util.js`
- `backend/src/models/index.js`

**This mechanism does not exist in the Go backend.** Phase 999 must implement the equivalent — `context.Context` propagation + explicit SQL predicates — and prove it via the two-tenant test suite before any Go domain is considered production-ready.

### 3.5 Critical Invariants the Go Backend Must Preserve

These are not preferences. Violating any of them is a compliance regression or a security defect.

| Invariant | Source of truth | Risk if broken |
|---|---|---|
| Cross-tenant request returns **404**, never 403 | `tenantScope.util.js` deny branch; `NO_TENANT_UUID` | Tenant membership oracle — id enumeration leaks which tenants own which resources |
| Every mutation writes an audit row **inside the transaction** | All services `sequelize.transaction()` blocks | A rolled-back action with a committed audit row records something that did not happen; a committed action with no audit row is a compliance gap (ISO 17025 / 21 CFR Part 11) |
| `calibration_records` are append-only | PostgreSQL trigger (`0079-calibration-records-append-only.js`) + application-role `REVOKE` (P6-03, ADR-062) | FDA 21 CFR Part 11 Part 11 originality violation |
| Certificate state machine transitions are gated | `certificate.service.js` state validator; invalid transition → 409 | A `PUT` bypassing the gate can approve a certificate without an e-signature (A-64) |
| Secrets never appear in list responses | `defaultScope` on models; `withoutRedactedSettings` in `tenant.service.js` | Password hashes, TOTP secrets, private keys, IoT device tokens in API responses |
| Session revocation is per-request | `session.service.js` lookups against the `sessions` table | A revoked JWT continues to work until its `exp` — effectively no revocation |

### 3.6 Known Coupling and Technical Debt Relevant to Porting

These are documented defects or structural patterns that the porting effort must handle deliberately:

| Issue | Location | Implication for Go porting |
|---|---|---|
| `sessions` uses snake_case attributes (`tenant_id`, `user_id`, `token_hash`) — unlike every other model | `backend/src/models/session.model.js` | Go struct tags must use `db:"tenant_id"` not `db:"tenantId"` for this table |
| `models/index.js` exports `sequelize`, not `db` | `backend/src/models/index.js` | Not applicable to Go, but the domain principle (single authoritative connection pool) must be preserved |
| `DECIMAL` and `COUNT` come back from PostgreSQL as strings in the Node.js driver | `pg` node adapter | Go's `pgx` driver returns `pgtype.Numeric` — parse correctly; do not assume numeric types |
| Worker `isSystemTask` spans entire consumer loop in some schedulers | Various `*Scheduler.middleware.js` files | Go worker goroutines must set tenant context narrowly, per-job, not globally |
| `document_chunks` similarity search is not tenant-scoped by the ORM hook | `iot.service.js`, vector search path | Go must add `AND tenant_id = $1` explicitly to every cosine-distance query |
| `webhook_deliveries` outbox claimed with `FOR UPDATE SKIP LOCKED` | `webhookDeliveryScheduler.middleware.js` | Go dispatcher must replicate the same `SELECT ... FOR UPDATE SKIP LOCKED` claim pattern |

---

## 4. Future Go Backend Engine — Target Specification

> **Status: Planned (Phase 999).** Nothing in this section is built. Do not create `backend-go/` or any Go source files until Phase 999 is formally entered.

### 4.1 Location and Module Structure

Target root: `backend-go/`

```text
backend-go/
├── cmd/
│   └── server/
│       └── main.go              # Application entry point; wires all dependencies
├── internal/
│   ├── domain/                  # Entities, value objects, domain errors, repository interfaces
│   │   ├── device/
│   │   │   ├── device.go        # Device entity, CalibrationResult, DeviceStatus enum
│   │   │   └── repository.go   # DeviceRepository interface (consumed by application layer)
│   │   ├── calibration/
│   │   ├── certificate/
│   │   ├── tenant/
│   │   ├── user/
│   │   ├── audit/
│   │   └── errors.go            # Sentinel domain errors: ErrNotFound, ErrTenantMismatch, ErrInvalidTransition
│   ├── application/             # Use cases, service implementations, DTO definitions
│   │   ├── device/
│   │   │   ├── service.go       # DeviceService: GetByID, Create, Update, SoftDelete, Restore
│   │   │   └── dto.go           # CreateDeviceRequest, DeviceResponse, DeviceListResponse
│   │   ├── calibration/
│   │   └── certificate/
│   ├── infrastructure/          # Database, cache, queue, storage implementations
│   │   ├── persistence/
│   │   │   ├── device_repo.go   # PostgreSQL DeviceRepository implementation
│   │   │   ├── session_repo.go  # NOTE: sessions table uses snake_case columns
│   │   │   └── db.go            # pgx connection pool initialization
│   │   ├── cache/
│   │   │   └── redis.go         # Redis client, cache helper, session store
│   │   ├── queue/
│   │   │   └── rabbitmq.go      # RabbitMQ producer and consumer
│   │   └── storage/
│   │       ├── local.go         # Local filesystem driver
│   │       ├── s3.go            # S3-compatible driver
│   │       └── nfs.go           # NFS driver
│   └── transport/
│       ├── http/
│       │   ├── handler/
│       │   │   ├── device.go    # HTTP handlers for /api/v1/calibration-devices
│       │   │   └── health.go    # GET /health — returns 503 if DB unreachable
│       │   ├── middleware/
│       │   │   ├── auth.go      # JWT validation, sets tenant context
│       │   │   ├── tenant.go    # Injects tenant ID into context.Context
│       │   │   ├── rbac.go      # Permission gate evaluation
│       │   │   ├── ratelimit.go # Redis-backed rate limiter
│       │   │   ├── request_id.go# X-Request-Id generation
│       │   │   └── recover.go   # Panic recovery → 500
│       │   └── router/
│       │       └── router.go    # Route registration and middleware composition
│       └── websocket/
│           └── hub.go           # Socket-equivalent realtime hub (future)
├── pkg/
│   ├── tenant/
│   │   ├── context.go           # context.Context key types; FromContext(); IntoContext()
│   │   └── middleware.go        # HTTP middleware that injects tenant from JWT into context
│   ├── logger/
│   │   └── logger.go            # slog-based structured logger with requestId + tenantId fields
│   ├── validator/
│   │   └── validator.go         # Struct-tag validation helper used by HTTP handlers
│   └── apperr/
│       └── apperr.go            # AppError type; domain-to-HTTP status code translation map
├── migrations/                  # SQL migration files (compatible format; shared schema)
├── tests/
│   ├── integration/             # Live PostgreSQL tests for repositories
│   └── parity/                  # Contract-level tests asserting identical behavior vs TS backend
├── go.mod
└── go.sum
```

### 4.2 Tenant Isolation in Go

The equivalent of the TypeScript backend's `AsyncLocalStorage` mechanism is Go's `context.Context`. The Go backend **must** propagate tenant identity from the HTTP transport layer through every repository call.

Pattern — transport layer injects:
```go
// pkg/tenant/context.go
type contextKey struct{}

func IntoContext(ctx context.Context, tenantID string) context.Context {
    return context.WithValue(ctx, contextKey{}, tenantID)
}

func FromContext(ctx context.Context) (string, error) {
    v, ok := ctx.Value(contextKey{}).(string)
    if !ok || v == "" {
        // This is the deny branch: must never allow queries without a tenant.
        return "", ErrTenantContextMissing
    }
    return v, nil
}
```

Pattern — every repository call:
```go
// internal/infrastructure/persistence/device_repo.go
func (r *deviceRepo) FindByID(ctx context.Context, id string) (*domain.Device, error) {
    tenantID, err := tenant.FromContext(ctx)
    if err != nil {
        return nil, err // → transport layer maps to 404 for unauthenticated; 500 for misconfigured pipeline
    }
    row := r.db.QueryRow(ctx,
        "SELECT id, tenant_id, name, serial_number, ... FROM calibration_devices WHERE id = $1 AND tenant_id = $2 AND is_deleted = false",
        id, tenantID,
    )
    // ...
}
```

**The deny branch matters.** If `FromContext` returns an error, the repository must surface it rather than querying without the predicate. The TypeScript backend's equivalent was a bug before ADR-029 fix: the early-return on "no context" applied no filter, allowing an authenticated principal with no tenant to see all rows.

### 4.3 Invariants Go Must Reproduce

Same table as §3.5, with Go implementation approach:

| Invariant | Go implementation pattern |
|---|---|
| Cross-tenant 404 | `tenant.FromContext` → absent row → `ErrNotFound` → `apperr.NotFound` → HTTP 404 |
| Audit row in transaction | `pgx.Tx`; audit insert inside the same `tx.Exec(...)` block before `tx.Commit()` |
| Append-only calibration records | PostgreSQL trigger already enforces it at DB level; no additional Go logic needed |
| Certificate state machine | Explicit Go transition table in `internal/domain/certificate/`; invalid transition → `ErrInvalidTransition` → HTTP 409 |
| Secrets excluded from responses | Response struct definitions in `dto.go` must not include password, mfa_secret, private_key fields; use `json:"-"` tags |
| Session revocation per-request | `session_repo.LookupValid(ctx, tokenHash)` must query `sessions` table, not only JWT exp |

### 4.4 Shared Infrastructure Access

Both backends read from and write to the same infrastructure tier. Because they share a database, **both must enforce the same schema invariants**: tenant_id predicates, soft-delete flags, append-only triggers, and transaction discipline.

| Infrastructure | TS Backend binding | Go Backend binding (target) |
|---|---|---|
| PostgreSQL 18 + pgvector | Sequelize 6 ORM | `pgx/v5` driver + raw SQL or `sqlc` generated code |
| Redis | `ioredis` (RESP2 protocol pinned) | `go-redis/v9` |
| RabbitMQ | `amqplib` | `rabbitmq/amqp091-go` |
| Object storage | `backend/src/services/storage.service.js` multi-driver | `internal/infrastructure/storage/` multi-driver |
| ClamAV | `node-clam` via TCP socket | TCP socket client (no official Go SDK; raw protocol or thin wrapper) |
| SMTP | `nodemailer` | `net/smtp` or `jordan-wright/email` |

---

## 5. Backend Coexistence Model

During Phase 999, both backends may run simultaneously behind nginx. The coexistence model is **full-backend-per-deployment** initially: a deployment runs one backend or the other, not both simultaneously for the same tenant. This simplifies the operational model and avoids split-brain scenarios for session state.

Incremental path to partial routing (aspirational, after full parity is proven):
```
Phase 999a  : Go backend serves all endpoints for a test tenant; TS backend serves all others
Phase 999b  : Go backend serves IoT ingest and read-heavy endpoints for all tenants
Phase 999c  : Go backend serves all endpoints for all tenants; TS backend on standby
```

This sequencing is **not yet decided**. It will be documented as a Phase 999 sub-ADR when implementation begins.

---

## 6. Decision Record

This architecture is recorded as **ADR-089** in [`../../MEMORY/DECISIONS.md`](../../MEMORY/DECISIONS.md).

Key constraints from ADR-089:
1. TypeScript backend is not deprecated. It remains the production reference implementation.
2. Go backend is an additional engine, not a replacement.
3. All Go implementation work lives in Phase 999, strictly after Phase 9 and Upstream PHP Feature Adoption (Phases 12 … 31, `TASKS/PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md`).
4. Current scope (2026-09-27): documentation and planning only.

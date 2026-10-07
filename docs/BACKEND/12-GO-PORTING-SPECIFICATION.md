# 12 — Go Porting Specification

> **Status: Planned (Phase 999). Nothing in this document is built.** No `backend-go/` directory, no Go source files, no `go.mod` exists in this repository today. Do not implement any of this before Phase 999 is formally entered — after Phase 9 (TypeScript migration) closes and Upstream PHP Feature Adoption (Phases 12 … 31) is absorbed into the product.

Architecture overview: [`../ARCHITECTURE/11-DUAL-BACKEND-ARCHITECTURE.md`](../ARCHITECTURE/11-DUAL-BACKEND-ARCHITECTURE.md).
Go coding standards: [`../ENGINEERING/15-GO-CODING-STANDARDS.md`](../ENGINEERING/15-GO-CODING-STANDARDS.md).
API interoperability contract: [`../API/14-BACKEND-INTEROPERABILITY-CONTRACT.md`](../API/14-BACKEND-INTEROPERABILITY-CONTRACT.md).
Phase 999 task backlog: [`../../TASKS/PHASE-999-GO-MIGRATION-AND-DUAL-BACKEND.md`](../../TASKS/PHASE-999-GO-MIGRATION-AND-DUAL-BACKEND.md).

---

## 1. Porting Principles

These are not preferences. A port that violates any of them is not a port — it is a new system with undefined behaviour parity.

### 1.1 Observable Parity

The Go backend's external surface must be **indistinguishable** from the TypeScript backend for any client that obeys the documented API contract. "Observable" means:

- The same HTTP status code for the same input in the same state.
- The same JSON response envelope: `{ "success": true, "data": ..., "meta": ... }`. No variation in key names, nesting, or field presence for fields the TypeScript backend guarantees.
- The same error `message` text for the same validation failure on the same field — frontend error displays depend on it.
- The same audit log row shape written to `audit_logs` on the same mutation.
- The same state machine transitions accepted and rejected for `certificate_status`, `calibration_result`, etc.

Two known exceptions that are deliberate and do not require matching: (a) internal log format (the Go backend uses `log/slog` JSON; the TS backend uses winston); (b) stack traces in development error `details` (never surfaced in production).

### 1.2 No Behaviour Change Under Porting

Porting is a **translation**, not a redesign. If the TypeScript backend has a bug, the Go backend reproduces the same buggy behaviour until a separate decision is made to fix it. The reason is testability: a parity test suite compares the two backends, and a "fix" looks like a divergence until it is explicitly recorded as an approved deviation.

Known deviation candidates that need an ADR before the Go backend can differ from the TS backend:
- Idempotency behaviour on `POST /api/v1/billing/webhook` (the TS backend has no idempotency key; the Go backend may introduce one)
- Worker deduplication semantics (TS workers have no `SET NX` claim; if Go workers add one, the behaviour change needs a recorded decision)
- Decimal serialization (TS backend serializes Sequelize `DECIMAL` as a string because `node-postgres` returns strings; Go's `pgx` returns `pgtype.Numeric` — the Go backend must decide whether to match the string output or move to a number and record the change)

### 1.3 Incremental Domain-by-Domain Porting

The porting sequence is not arbitrary. It follows a lowest-coupling-first order:
1. **Auth & Sessions** — the authentication contract gates everything else; parity here unlocks token reuse
2. **Tenant Management** — core platform dependency; nothing else is meaningful without it
3. **Calibration Devices & Records** — primary product value; highest test coverage in the TS backend
4. **Certificates & E-Signatures** — high compliance stakes; requires crypto parity
5. **QMS (NC, CAPA, SOP, Risk)** — no external dependencies outside the core DB
6. **Warehouse & Stock** — complex but self-contained
7. **Billing & Metering** — Stripe webhook signature verification must match exactly
8. **SCIM, OIDC, WebAuthn** — protocol-heavy; convert last when the base is stable

This order will be finalised when Phase 999 begins and the TS backend Phase 9 conversion is complete — the TypeScript types produced there are the formal input specification for the Go port.

### 1.4 The Porting Precondition

Phase 9 must be closed and all TypeScript types merged before Phase 999 begins. The reason: the TS types from Phase 9 are the specification. A port started against the JavaScript backend means porting against implicit contracts and JSDoc comments that may not reflect what the code actually does.

This is not a scheduling preference. [`docs/ENGINEERING/04-TYPESCRIPT-STANDARDS.md`](../ENGINEERING/04-TYPESCRIPT-STANDARDS.md) defines `TenantId`, `UserId`, `CertificateStatus` and other branded types. These are the input types the Go backend's domain layer must match. A port that starts from `any`-typed JavaScript is porting the wrong contract.

---

## 2. Source Inventory

The TypeScript backend as of the last re-count (2026-09-23, basis for Phase 9 planning). Counts are the authoritative input to porting scope:

| Layer | Count | Directory |
|---|---|---|
| Route modules | 53 API + 2 internal | `backend/src/routes/api/`, `backend/src/routes/internal/` |
| Controllers | 57 | `backend/src/controllers/` |
| Services | 77 (71 + 6 storage drivers) | `backend/src/services/` |
| Validators | 37 | `backend/src/validators/` |
| Models | 72 | `backend/src/models/` |
| Middlewares | 21 | `backend/src/middlewares/` |
| Utils | 20 | `backend/src/utils/` |
| Constants | 5 | `backend/src/constants/` |
| Config files | 4 | `backend/src/config/` |
| Migrations | 63 | `backend/src/migrations/` |
| Workers | 1 | `backend/src/workers/` |
| Tests (unit + E2E) | 309 suites + 53 E2E specs | `backend/src/tests/` |

The Go port needs to cover 53 route surfaces — the internal routes (`health`, `migration`) may be Go-native rather than ported.

---

## 3. Layer Mapping

Each TypeScript layer maps to a Go package structure. The mapping is structural, not one-to-one by file. One TS service file often maps to one Go application service + one Go repository implementation.

### 3.1 Canonical Mapping Format

Every domain in the porting inventory is documented using this table:

| TypeScript Source | Go Target Package | Porting Priority | Parity Notes |
|---|---|---|---|
| `routes/api/device.route.js` | `internal/transport/http/router/` (route registration) | P1 | Path, method, middleware composition |
| `controllers/device.controller.js` | `internal/transport/http/handler/device.go` | P1 | Response envelope, status codes |
| `services/device.service.js` | `internal/application/device/service.go` | P1 | Business rules, state transitions, transactions |
| `validators/device.validator.js` | `internal/application/device/dto.go` (struct tags) | P1 | Same validation rules, same 400 field-level errors |
| `models/device.model.js` | `internal/domain/device/device.go` (entity) + `internal/infrastructure/persistence/device_repo.go` | P1 | Column names, soft delete, tenant scoping |
| `middlewares/tenantContext.middleware.js` | `pkg/tenant/middleware.go` | P0 (prerequisite for all) | `context.Context` injection |
| `middlewares/auth.middleware.js` | `internal/transport/http/middleware/auth.go` | P0 | JWT verification, SUPERADMIN override |
| `middlewares/dynamicAccess.middleware.js` | `internal/transport/http/middleware/rbac.go` | P0 | Permission gate before handler |
| `utils/tenantScope.util.js` | `pkg/tenant/context.go` + repo-level SQL predicates | P0 | Deny branch: no context → `NO_TENANT_UUID` → 0 rows |
| `utils/response.util.js` | `pkg/response/response.go` | P0 | Envelope helpers: `Success()`, `Paginated()`, `Error()` |
| `utils/appError.util.js` | `pkg/apperr/apperr.go` | P0 | AppError, domain error → HTTP status table |

### 3.2 Module-Level Mapping (by domain)

#### Auth & Sessions

| TS Source | Go Target | Notes |
|---|---|---|
| `services/auth.service.js` | `internal/application/auth/service.go` | Login, register, OTP, password reset, token refresh |
| `services/session.service.js` | `internal/application/auth/session_service.go` | Session lookup, revocation; `sessions` table is snake_case — `tenant_id`, `user_id`, `token_hash` |
| `models/session.model.js` | `internal/infrastructure/persistence/session_repo.go` | **CRITICAL**: columns are snake_case, not camelCase. Go struct must use `db:"tenant_id"` not `db:"tenantId"`. This broke the TS nightly retention purge — do not repeat it in Go. |
| `models/user.model.js` | `internal/domain/user/user.go` | `defaultScope` excludes `password`, `mfaSecret`, `otpCode`, `webauthnPublicKey` — Go struct must use `json:"-"` for these |
| `middlewares/auth.middleware.js` | `internal/transport/http/middleware/auth.go` | JWT verification; honour `x-tenant-id` for SUPERADMIN only; reject suspended tenants |

#### Calibration Devices

| TS Source | Go Target | Notes |
|---|---|---|
| `services/calibrationDevice.service.js` | `internal/application/device/service.go` | CRUD, soft delete, IoT token generation, pagination |
| `models/calibrationDevice.model.js` | `internal/domain/device/device.go` | `serialNumber` is globally unique on the column — a known cross-tenant oracle (P6-06). The Go model must **not** change the constraint without an ADR |
| `services/iot.service.js` | `internal/application/iot/service.go` | MQTT client (not broker), `device/#` topic subscription, tenant-scoped ingest. Similarity search on `document_chunks` must include explicit `WHERE tenant_id = $1` — the ORM hook does not reach vector searches |

#### Certificates & E-Signatures

| TS Source | Go Target | Notes |
|---|---|---|
| `services/certificate.service.js` | `internal/application/certificate/service.go` | State machine: `draft → submitted → pending_approval → approved → signed → revoked`. Invalid transition → 409 Conflict. |
| `services/kms.service.js` | `internal/application/kms/service.go` | AES-256 wrapping of tenant private keys. Requires `ENCRYPT_KEY` env var. If absent at startup, must refuse to start — same fail-fast behaviour as TS |
| `models/certificate.model.js` | `internal/domain/certificate/certificate.go` | `certificateStatus` ENUM — Go type must be `string` with an explicit validation set, not a generic string |

#### Audit Logging

This is not one service — it is a cross-cutting concern that every mutating service in the TS backend implements. Go must replicate it:

```go
// Every mutation in the Go backend:
tx, _ := db.Begin(ctx)
defer tx.Rollback(ctx)

// 1. Perform the mutation
_, err = tx.Exec(ctx, "UPDATE calibration_devices SET ... WHERE id=$1 AND tenant_id=$2", id, tenantID)

// 2. Write audit row INSIDE the same transaction
_, err = tx.Exec(ctx, `
    INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, changes, ip_address, created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
    newUUID(), tenantID, userID, "UPDATE", "calibration_device", id, changesJSON, ipAddr,
)

tx.Commit(ctx)
```

**An audit row that survives a rolled-back transaction records something that did not happen.** An action with no audit row is a 21 CFR Part 11 / ISO 17025 compliance gap. Both are violations. The TS backend enforces this by requiring the `sequelize.transaction()` callback to always insert the audit row inside the callback block.

---

## 4. Tenant Isolation — Go Implementation

This is the most critical section. The TypeScript backend's tenant isolation uses `AsyncLocalStorage` (CLS) + global Sequelize hooks. Go has no equivalent ORM hook mechanism. **Every SQL query in every Go repository function must include an explicit tenant predicate.**

### 4.1 The Deny Branch

```go
// pkg/tenant/context.go

type contextKey struct{ name string }

var tenantKey = &contextKey{"tenantId"}

// NO_TENANT_UUID matches the TS backend constant.
// It is a valid UUID that no real tenant will ever hold.
// PostgreSQL accepts it without a type error.
// It returns zero rows — which is the correct deny behaviour.
const NO_TENANT_UUID = "00000000-0000-0000-0000-000000000000"

func IntoContext(ctx context.Context, tenantID string) context.Context {
    return context.WithValue(ctx, tenantKey, tenantID)
}

func FromContext(ctx context.Context) string {
    v, ok := ctx.Value(tenantKey).(string)
    if !ok || v == "" {
        // Return the deny UUID, not an empty string.
        // An empty string creates a type error in PostgreSQL (tenant_id is UUID).
        // The deny UUID returns zero rows — the deny branch.
        return NO_TENANT_UUID
    }
    return v
}
```

The previous TypeScript implementation had a bug here: the early-return on "no context" applied **no filter at all**, meaning an authenticated principal with no tenant saw every row. `NO_TENANT_UUID` was the fix. The Go implementation must replicate the fixed behaviour, not the original.

### 4.2 Every Repository Function Carries the Predicate

```go
// internal/infrastructure/persistence/device_repo.go

func (r *deviceRepo) FindByID(ctx context.Context, deviceID string) (*domain.Device, error) {
    tenantID := tenant.FromContext(ctx)

    var d domain.Device
    err := r.db.QueryRow(ctx,
        `SELECT id, tenant_id, name, serial_number, calibration_interval_days,
                next_calibration_date, is_deleted, created_at, updated_at
         FROM calibration_devices
         WHERE id = $1 AND tenant_id = $2 AND is_deleted = false`,
        deviceID, tenantID,
    ).Scan(
        &d.ID, &d.TenantID, &d.Name, &d.SerialNumber,
        &d.CalibrationIntervalDays, &d.NextCalibrationDate,
        &d.IsDeleted, &d.CreatedAt, &d.UpdatedAt,
    )

    if errors.Is(err, pgx.ErrNoRows) {
        return nil, domain.ErrNotFound // → HTTP 404; same for "not yours" as "not found"
    }
    return &d, err
}
```

**There is no ORM hook to fall back on.** If `WHERE tenant_id = $2` is omitted, the query returns rows belonging to any tenant. This is the highest-consequence defect possible in the platform. Every new repository method is a PR review checklist item.

### 4.3 Bypasses

These are the four sanctioned bypass patterns in the TS backend. Go must replicate the same patterns with the same constraints:

| Bypass | Go equivalent | Rule |
|---|---|---|
| `skipTenantScope` | Pass `tenant.BypassContext(ctx)` | Must be accompanied by a comment explaining why; greppable |
| `isSystemTask` | `tenant.SystemContext(ctx)` | Scope narrowly — per job, not per worker goroutine lifetime |
| `isSuperAdmin` | `tenant.SuperAdminContext(ctx)` | By design |
| No CLS context (pre-auth, public routes) | Handler runs before auth middleware, no tenant injected | The `NO_TENANT_UUID` deny branch applies if something accidentally queries |

`isSystemTask` spanning an entire worker loop is the defect that exists in the TS backend today (documented in `AGENTS.md`). The Go worker implementation must scope it per-job, not per-loop-iteration.

---

## 5. State Machine Parity

The TS backend enforces state machine transitions for several entities. The Go backend must reproduce the same transition tables and reject the same invalid transitions with the same HTTP 409 status code.

### 5.1 Certificate Status

```
draft → submitted → pending_approval → approved → signed → revoked
```

- `draft → submitted`: valid when certificate has at least one signer assigned
- `submitted → pending_approval`: automatic on signer confirmation
- `pending_approval → approved`: requires APPROVER role
- `approved → signed`: requires e-signature key present and KMS-decryptable
- `* → revoked`: any state can be revoked by a user with REVOKER permission
- Any other transition → **409 Conflict** (not 400, not 500)

Source of truth: `backend/src/services/certificate.service.js` → `validateTransition()`.

### 5.2 Calibration Result

```
pass | fail | conditional_pass
```

Result is set once per record and is append-only — `calibration_records` has a PostgreSQL trigger enforcing no UPDATEs. The Go backend must not attempt to UPDATE this table; it must INSERT a new record.

### 5.3 Work Order Status

```
draft → open → in_progress → completed | cancelled
```

Source of truth: `backend/src/services/maintenance.service.js` → `updateWorkOrderStatus()`.

---

## 6. Data Type Parity

### 6.1 DECIMAL and COUNT

The TypeScript backend returns `DECIMAL` columns as strings because `node-postgres` passes them through as strings from PostgreSQL. The TS backend documents this and adds a `get()` accessor that converts to `Number()` on read (documented in `docs/BACKEND/00-BACKEND-STANDARDS.md` §3).

Go's `pgx/v5` returns `pgtype.Numeric` for `NUMERIC`/`DECIMAL` columns. The Go backend must decide at porting time whether to:
- Match the TS output (serialize as string `"90.00"`) — no client change required
- Emit a number (`90`) — a potential breaking change for clients that do string comparison

**This decision requires an ADR before porting the first service that returns a DECIMAL field.** Do not assume either behaviour.

### 6.2 Timestamps

All timestamps must be serialized as ISO 8601 UTC strings:
```
2026-09-27T23:47:12.000Z   // correct
2026-09-27T23:47:12+07:00  // WRONG — clients parse TZ suffix inconsistently
1727477232000              // WRONG — epoch never exposed in TS API
```

Go's `time.Time` serializes to RFC3339 by default (`time.RFC3339Nano`). The JSON struct tag must not override this to a local format.

### 6.3 Nullable Fields

Go structs must use pointer types for nullable database columns:

```go
type Device struct {
    ID                      string     `json:"id" db:"id"`
    TenantID                string     `json:"tenant_id" db:"tenant_id"`
    Name                    string     `json:"name" db:"name"`
    SerialNumber            *string    `json:"serial_number" db:"serial_number"`           // nullable
    NextCalibrationDate     *time.Time `json:"next_calibration_date" db:"next_calibration_date"` // nullable
    CalibrationIntervalDays int        `json:"calibration_interval_days" db:"calibration_interval_days"`
    IsDeleted               bool       `json:"is_deleted" db:"is_deleted"`
    CreatedAt               time.Time  `json:"created_at" db:"created_at"`
    UpdatedAt               time.Time  `json:"updated_at" db:"updated_at"`
}
```

`*string` serializes as `null` when nil — matching the TS backend's `null` for cleared fields. A non-pointer `string` serializes as `""` — which is **not null** and breaks clients that check `=== null`.

### 6.4 JSON Field Names

All JSON output keys must be `snake_case`. The TS backend uses `underscored: true` on Sequelize models, which transforms `camelCase` attribute names to `snake_case` column names but keeps `camelCase` in JavaScript code. The JSON serialization in `response.util.js` passes the Sequelize model output directly — which means:

- Sequelize attribute `isDeleted` → JSON key `is_deleted` ✓
- Sequelize attribute `tenantId` → JSON key `tenant_id` ✓
- Sequelize attribute `serialNumber` → JSON key `serial_number` ✓

Go struct tags must match this output exactly. Any field that deviates breaks a frontend that reads the key by name.

---

## 7. Response Envelope Parity

The Go backend must implement the identical envelope to `backend/src/utils/response.util.js`.

```go
// pkg/response/response.go

type SuccessResponse struct {
    Success bool        `json:"success"`
    Status  int         `json:"status"`
    Message string      `json:"message"`
    Data    interface{} `json:"data"`
    Meta    *MetaBlock  `json:"meta,omitempty"`
}

type MetaBlock struct {
    Total        int                    `json:"total"`
    Page         int                    `json:"page"`
    Limit        int                    `json:"limit"`
    TotalPages   int                    `json:"total_pages"`
    CustomCounts map[string]int         `json:"custom_counts,omitempty"`
}

type ErrorResponse struct {
    Success bool   `json:"success"`
    Status  int    `json:"status"`
    Message string `json:"message"`
    Data    any    `json:"data"` // always null
}

func Success(w http.ResponseWriter, status int, message string, data any) { ... }
func Paginated(w http.ResponseWriter, data any, total, page, limit int) { ... }
func Error(w http.ResponseWriter, status int, message string) { ... }
```

**`meta` is a top-level sibling of `data`. It is never nested inside `data`.** This was the cause of empty QMS and SOP screens in the existing frontend (documented in `docs/API/00-API-STANDARDS.md`). The Go backend must not reproduce the bug.

**`data` must be `null` in error responses**, not `{}` or `[]`. The frontend checks `response.data` for list rendering; an empty object renders as a non-empty entity. A null is unambiguous.

---

## 8. Parity Test Strategy

No Go domain is considered ported until:

1. **Contract tests pass** against the Go backend using the same test fixtures as the TS backend.
2. **Two-tenant tests assert 404** for every `:id` route. Same fixture structure as `backend/src/tests/fixtures/twoTenants.js` (described in `docs/BACKEND/05-TENANT-SCOPING.md` §Testing).
3. **Audit log tests assert** that every mutation inserts an audit row matching the expected shape.
4. **State machine tests assert** that invalid transitions return 409.
5. **Parity diff test**: the same HTTP request, sent to both backends with identical state, returns byte-equivalent responses (after stripping `X-Request-Id` and timestamps). Any diff that is not in the approved deviation register is a blocker.

The parity diff test is the most important one. It is the only test that cannot be satisfied by writing the Go test to match what the Go backend does — it must match what the TypeScript backend does.

---

## 9. PR Checklist for Every Ported Domain

- [ ] Two-tenant test for every `:id` route asserting **404**, not 200 or 403
- [ ] Audit log test asserting the row is written in the same transaction
- [ ] State machine test asserting invalid transitions return 409
- [ ] `tenant_id` predicate present in every SQL query — greppable, no exceptions
- [ ] Nullable columns use pointer types (`*string`, `*time.Time`)
- [ ] JSON keys match TS output exactly — run parity diff
- [ ] Secrets (`password`, `mfaSecret`, `privateKey`, `iotDeviceToken`) absent from response structs (use `json:"-"`)
- [ ] `NO_TENANT_UUID` deny branch covered by a test
- [ ] No global mutable state introduced
- [ ] `context.Context` is the first parameter of all I/O functions
- [ ] Error response `data` is `null`, not `{}` or `[]`
- [ ] Decimal fields: serialization decision recorded in the ADR, test asserting the agreed format

# 14 — Backend Interoperability & API Contract

> **Status: Planned (Phase 999).** The Go backend does not exist. This document defines the contract both backends must satisfy as a precondition for the Go backend to serve production traffic. Every section marked "both backends" describes what the TypeScript backend already does (`backend/src/`) and what the Go backend (`backend-go/`) must reproduce.

TypeScript backend API standards (the reference): [`00-API-STANDARDS.md`](./00-API-STANDARDS.md).
Go porting specification: [`../BACKEND/12-GO-PORTING-SPECIFICATION.md`](../BACKEND/12-GO-PORTING-SPECIFICATION.md).
Multi-frontend architecture: [`../ARCHITECTURE/12-MULTI-FRONTEND-AND-SHARED-COMPONENTS.md`](../ARCHITECTURE/12-MULTI-FRONTEND-AND-SHARED-COMPONENTS.md).

---

## 1. The Single Overriding Rule

> **Equivalent external behaviour. Independent internal implementation.**

Neither backend needs to share internal structure, ORM, or language idioms. Both must produce HTTP responses that are byte-equivalent for the same input in the same database state (after accounting for approved deviations recorded below).

A frontend client, a third-party integration, or the contract test suite must be unable to distinguish which backend engine produced a given response. If it can tell the difference, the Go backend is not ready for production.

---

## 2. Response Envelope

Both backends produce the same envelope structure. Source of truth for the TypeScript backend: `backend/src/utils/response.util.js`.

### 2.1 Success — Single Entity

```json
{
  "success": true,
  "status": 200,
  "message": "Success",
  "data": {
    "id": "a1b2c3d4-0000-0000-0000-000000000001",
    "tenant_id": "a1b2c3d4-0000-0000-0000-000000000002",
    "name": "Torque Wrench A",
    "serial_number": "TW-2026-001",
    "calibration_interval_days": 365,
    "next_calibration_date": "2027-09-27T00:00:00.000Z",
    "is_deleted": false,
    "created_at": "2026-09-27T23:47:12.000Z",
    "updated_at": "2026-09-27T23:47:12.000Z"
  }
}
```

### 2.2 Success — Collection with Pagination

```json
{
  "success": true,
  "status": 200,
  "message": "Success",
  "data": [
    { ... },
    { ... }
  ],
  "meta": {
    "total": 137,
    "page": 1,
    "limit": 20,
    "totalPages": 7,
    "customCounts": {
      "overdue": 12,
      "due_soon": 8
    }
  }
}
```

**`meta` is a top-level sibling of `data`.** It is never nested inside `data`. There is no `data.meta`, `data.rows`, `data.items`, or `data.total`. This constraint has been violated twice in the TypeScript backend's history — on `GET /qms/nc`, `GET /qms/capa`, and `GET /sop` — and in each case the corresponding frontend list rendered as empty with no error for weeks. The Go backend must not reproduce the bug.

### 2.3 Error

```json
{
  "success": false,
  "status": 400,
  "message": "Validation failed",
  "data": null
}
```

**`data` is always `null` in error responses.** Not `{}`, not `[]`, not omitted. The frontend checks `response.data` for content rendering. A non-null value on an error response produces undefined behaviour in list components.

`details` is attached only when the responding backend is not in production mode (`NODE_ENV !== "production"` in TS; an equivalent environment flag in Go). This field must never appear in production responses — it carries internal error messages that can include SQL fragments, file paths, or stack traces.

### 2.4 Authentication Response (Login)

Login responses attach two extra top-level keys alongside `data`:

```json
{
  "success": true,
  "status": 200,
  "message": "Login successful",
  "data": {
    "id": "...",
    "email": "user@example.com",
    "name": "...",
    "role": "OPERATOR"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "session": {
    "id": "...",
    "createdAt": "2026-09-27T23:47:12.000Z",
    "expiresAt": "2026-09-28T23:47:12.000Z"
  }
}
```

`token` and `session` are top-level siblings of `data`. The frontend reads `response.token` and `response.session` directly. A Go backend that nests them inside `data` breaks the login flow.

---

## 3. HTTP Status Codes

Both backends must use the same status codes for the same situations. The TS backend's mapping is in `backend/src/utils/appError.util.js` and `backend/src/middlewares/errorHandlers.middleware.js`.

| Code | Meaning | When |
|---|---|---|
| 200 | OK | Successful GET, PUT, PATCH |
| 201 | Created | Successful POST that creates a resource |
| 204 | No Content | Successful DELETE (body-less) |
| 400 | Bad Request | Validation failure — always includes field-level detail |
| 401 | Unauthenticated | Missing, malformed, or expired token; revoked session |
| 403 | Forbidden | Authenticated principal lacks the required permission **within their own tenant** |
| **404** | **Not Found** | **Resource does not exist — and resource belongs to a different tenant** |
| **409** | **Conflict** | **Invalid state machine transition** |
| 408 | Request Timeout | Request exceeded the 30-second handler timeout |
| 429 | Too Many Requests | Rate limited; accompanies `X-RateLimit-*` headers |
| 500 | Internal Server Error | Unhandled error; never reveals internal details |
| 503 | Service Unavailable | `GET /health` when the database is unreachable |

### 3.1 404 for Cross-Tenant — Not 403

A resource belonging to another tenant returns **404**, identical to a resource that does not exist. The Go backend must replicate this exactly.

**Why:** A 403 response says "this resource exists and you may not have it". That confirmation turns ID enumeration into a working tenant-membership oracle. An attacker who can probe with arbitrary IDs and distinguish 403 from 404 learns which IDs are real and which tenant owns them. 404 for both "not found" and "not yours" makes the two cases indistinguishable.

Source: `backend/src/utils/tenantScope.util.js` — the deny branch returns zero rows, which the service layer translates to `ErrNotFound`, which the error handler maps to 404.

### 3.2 409 for Invalid State Transitions

A request to approve a certificate that is still in `draft` is not a validation failure (the input is syntactically valid) and not a server error. It is a conflict with the current state of the resource. It returns 409.

Source: `backend/src/services/certificate.service.js` — `validateTransition()` throws `AppError(409, ...)` for invalid transitions.

The TS backend originally threw a plain `Error` for this case, which the error handler mapped to 500. That hid a genuine design gap behind a stack trace and was fixed as a defect. The Go backend must not reproduce the pre-fix behaviour.

---

## 4. Data Representation

Both backends must serialize data identically for any field a client reads.

### 4.1 JSON Key Convention

All JSON keys are `snake_case`. The TypeScript backend produces this because Sequelize uses `underscored: true` on all models, converting camelCase attribute names to snake_case JSON output.

```
✓  "tenant_id"        "serial_number"     "created_at"     "is_deleted"
✗  "tenantId"         "serialNumber"      "createdAt"       "isDeleted"
```

A Go struct tag `json:"tenantId"` produces the wrong key. The frontend reads `device.tenant_id`. A key mismatch is a silent undefined value, not a parse error.

### 4.2 Timestamps

All timestamps are serialized as **ISO 8601 UTC strings**.

```
✓  "2026-09-27T23:47:12.000Z"       (UTC, millisecond precision)
✓  "2026-09-27T23:47:12Z"           (UTC, no millis — acceptable)
✗  "2026-09-27T23:47:12+07:00"      (local TZ offset — NOT acceptable)
✗  1727477232000                     (epoch millis — never)
✗  "27 Sep 2026"                     (human format — never)
```

Go's `time.Time.MarshalJSON()` produces RFC3339 by default, which includes the timezone offset. Use `time.UTC` on all stored times, or marshal with `.UTC().Format(time.RFC3339Nano)`.

### 4.3 Nullable Fields

A nullable field that is unset is serialized as JSON `null`:

```json
{ "serial_number": null, "next_calibration_date": null }
```

Never serialize a null as an absent key, as `""`, or as `0`. The frontend differentiates `null` (explicitly cleared or never set) from absent (field not part of this response schema). A zero value `""` on a string field can trigger display of an empty string where a placeholder should appear.

### 4.4 Identifiers

Primary keys are UUID v4 strings:
```
"id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
```

Not integers, not short IDs, not base64. The TS backend creates all primary keys as `UUIDV4` in Sequelize model definitions. Existing integer PKs (if any legacy tables have them) are surfaced as numbers. Both backends must agree on the type for each table's PK — mixing string UUID and integer for the same resource is a client-side type error.

### 4.5 Decimal Serialization

**This is an open decision pending the decimal parity ADR.** The TS backend returns `DECIMAL` columns as strings because `node-postgres` passes them through as strings. This means:
```json
{ "uncertainty": "0.050000", "measurement": "25.000000" }
```

The Go backend with `pgx/v5` can return `float64` numbers:
```json
{ "uncertainty": 0.05, "measurement": 25.0 }
```

These are **not equivalent** to a JavaScript client that does `if (value === "0.050000")`. Whichever format the Go backend uses must be documented in the parity ADR and a contract test must assert the agreed format. Until the ADR is recorded, the Go backend must match the TS backend's string output.

---

## 5. Authentication and Authorization Contract

### 5.1 Bearer Token

```
Authorization: Bearer <jwt>
```

Both backends verify the same JWT. The JWT is signed with the same secret (`JWT_SECRET` environment variable). The JWT payload shape must be identical:

```json
{
  "userId": "...",
  "tenantId": "...",
  "role": "OPERATOR",
  "sessionId": "...",
  "iat": 1727477232,
  "exp": 1727563632
}
```

**The TypeScript backend deliberately does not pass `maxAge` to the JWT verifier.** A `maxAge` of 15 minutes against tokens signed with a one-day `expiresIn` rejected every token 15 minutes after login. The `exp` claim governs — nothing second-guesses it. The Go backend must not add `maxAge` verification.

### 5.2 Tenant Headers

| Header | Who may send | Effect |
|---|---|---|
| `x-tenant-id` | `SUPERADMIN` only | Act as that tenant; non-SUPERADMIN callers have it ignored |
| `x-tenant-code` | `SUPERADMIN` only | Same, by tenant code rather than UUID |
| `X-Tenant-ID` (capital) | Tenant-pinned frontend builds | Sent on every call by a `NEXT_PUBLIC_TENANT_ID` build |

For a non-SUPERADMIN the override headers are **silently ignored**, not rejected. A probe that sends `x-tenant-id: <other-tenant-uuid>` to a non-SUPERADMIN session receives back the caller's own data — not an error that confirms the header is meaningful.

### 5.3 Request Correlation

Every request gets a `X-Request-Id` header in the response:
```
X-Request-Id: a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

Generated per-request by `crypto/rand` (Go: `uuid.New().String()`). The header is exposed through CORS so browser clients can read it. It must appear in every log line for the request — this is what connects a user's bug report ("I got an error around 23:47") to the server log.

### 5.4 RBAC Gate — Before Handler

Every authenticated endpoint is preceded by a permission gate. No endpoint is reachable without one. The TS backend has no build guard that enforces this — it is a review requirement.

For the Go backend, the router composition must enforce it structurally:

```go
// router.go — every authenticated route group requires auth + rbac
protected := r.Group("/api/v1")
protected.Use(middleware.Auth)
protected.Use(middleware.Tenant)

// Each route additionally specifies its permission
devices := protected.Group("/calibration-devices")
devices.GET("", middleware.RBAC("device", "read"), handler.ListDevices)
devices.POST("", middleware.RBAC("device", "write"), handler.CreateDevice)
devices.GET("/:id", middleware.RBAC("device", "read"), handler.GetDevice)
devices.PUT("/:id", middleware.RBAC("device", "write"), handler.UpdateDevice)
devices.DELETE("/:id", middleware.RBAC("device", "write"), handler.DeleteDevice)
```

A route registered without `middleware.RBAC(...)` is reachable by any authenticated user regardless of role. The same gap exists in the TS backend and is documented in `AGENTS.md`. The Go backend must not reproduce it.

---

## 6. Rate Limiting

The TS backend's rate limits (from `docs/API/00-API-STANDARDS.md`):

| Scope | Window | Limit |
|---|---|---|
| Global | 15 min | 5,000 (production) / 100,000 (non-production) |
| Auth endpoints | 15 min | 20 |
| OTP / password reset | 1 hour | 5 |

The Go backend must implement the same limits, using the same Redis instance. Rate limit keys must include the tenant ID or IP address — a key that only uses the route path allows one tenant to exhaust the budget for all tenants on that route.

Rate limit responses carry `X-RateLimit-*` headers and return 429:
```
X-RateLimit-Limit: 5000
X-RateLimit-Remaining: 4873
X-RateLimit-Reset: 1727477232
Retry-After: 127
```

---

## 7. CORS

Both backends enforce an explicit allowlist from the `CORS_ORIGIN` environment variable (comma-separated). A wildcard `*` with `credentials: true` is forbidden — it allows any site to make authenticated cross-origin requests on behalf of a logged-in user.

| Environment | No origins configured |
|---|---|
| Production | Reject |
| Non-production | Allow all |

The Go backend must replicate this distinction. A Go backend that defaults to `*` in all environments has a CORS security regression vs the TS backend.

---

## 8. Public Endpoints

These endpoints require no token. Both backends must agree on this list — a Go backend that requires auth for a public endpoint breaks the public certificate verification flow, which is load-bearing for regulatory audit use cases.

```
GET  /health
GET  /
GET  /oidc/.well-known/openid-configuration
GET  /oidc/.well-known/jwks.json
GET  /api/v1/certificates/verify/:certificateNumber
GET  /api/v1/content/posts/public
GET  /api/v1/content/posts/public/:slug
GET  /api/v1/content/categories/public
GET  /api/v1/tenants/public
POST /api/v1/auth/login
POST /api/v1/auth/register
POST /api/v1/auth/send-otp
POST /api/v1/auth/reset-password
GET  /api/v1/auth/activation
POST /api/v1/billing/webhook    (Stripe signature verification, not token auth)
POST /api/v1/iot/ingest         (IoT device-token authentication, not JWT)
```

Adding any endpoint to this list is a security decision that requires an ADR. Neither backend may add a public endpoint without one.

---

## 9. Breaking Change Policy

### 9.1 What Is a Breaking Change

A change is breaking if it causes a client that was working before the change to fail after it:

| Change | Breaking? |
|---|---|
| Removing a JSON field from a response | **Yes** — clients may read it |
| Renaming a JSON field | **Yes** — clients read by name |
| Changing a field's type (string → number) | **Yes** — see decimal ADR discussion |
| Changing a 200 to a 404 | **Yes** |
| Changing a 409 to a 400 | **Yes** |
| Adding a new optional field to a response | No |
| Adding a new endpoint | No |
| Adding a new optional query parameter | No |

### 9.2 Field Deprecation Process

Fields scheduled for removal must pass through a deprecation cycle:
1. Mark the field deprecated in Swagger docs for the current version
2. Keep the field populated for at least one full release cycle
3. Remove only in a new API major version (`/api/v2`) with a migration guide

### 9.3 Approved Deviations

Deviations from exact TS parity that are permitted without a breaking change declaration:

| Deviation | Reason | ADR |
|---|---|---|
| Log format (Go slog vs TS winston) | Internal concern; not observable by clients | Not needed |
| Stack traces in development `details` | Internal concern; suppressed in production | Not needed |
| Internal error codes (`"DEVICE_NOT_FOUND"` vs raw message) | Internal-only field if added by Go | ADR required if exposed |
| `DECIMAL` as number vs string | **Pending — must be resolved before first decimal field ported** | Required |

Any deviation not in this table is either a bug or requires an ADR before shipping.

---

## 10. Contract Test Structure

Both backends pass the same contract test suite. A domain is not considered ported until its contract tests pass against the Go backend with a live PostgreSQL database (not mocks).

```
tests/parity/
├── auth_contract_test.go       — login, token refresh, logout, 401 on revoked token
├── device_contract_test.go     — CRUD, two-tenant 404, soft-delete visibility
├── calibration_contract_test.go — record creation, append-only enforcement
├── certificate_contract_test.go — state machine transitions, 409 for invalid moves
└── helpers/
    ├── two_tenants.go          — creates two tenant DB contexts for isolation tests
    └── assert_envelope.go     — asserts response matches canonical envelope shape
```

The contract tests run against a Docker-compose test environment with both backends running simultaneously. A `diff` of the two responses (same request, same state) with approved deviations stripped must be empty.

The parity diff test is the only test that cannot pass by writing the Go test to match what the Go backend happens to do — it must match what the TypeScript backend does. This distinction is what makes it a contract test rather than a unit test.

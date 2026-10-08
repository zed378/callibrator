# 00 — API Standards

> **ADR-136 (2026-10-08) — target, not built:** the API contract moves to a language-neutral, contract-first `contracts/` folder (OpenAPI 3.1, AsyncAPI 3, a behaviour spec, an error-code catalogue); every backend generates its validators from it and is proved by one black-box conformance suite; ports replace Node module by module behind a gateway. See [`docs/CONTRACT/`](../CONTRACT/00-README.md). Where this document describes the code-first contract (ADR-103) or a full-port parity model (ADR-089), it describes **today's** state; ADR-136 is the plan.

Read this before any other `API/` document. Every contract in this folder assumes it.

- **Base path:** `/api/v1`
- **Interactive docs:** Scalar at `/docs` on the API origin, and `/api/v1/docs` through the frontend's proxy (the path a signed-in browser uses). **Behind sign-in:** tenant admin or the super admin; an API key is refused. Replaced Swagger UI in P9-25 (**ADR-103**; the route is `backend/src/routes/internal/apiDocs.route.ts`, mounted by `backend/src/docs/apiDocs.ts` under `SWAGGER_ENABLED`, off in production by default).
- **Machine-readable spec:** OpenAPI **3.1**, the committed `backend/openapi.json`, served at `/docs/openapi.json` (and at `/docs.json`, same gate). **Generated, never hand-edited:** `npm run openapi:generate` builds it from the per-route `*.openapi.ts` modules (the Zod schemas `validate()` enforces, via `zod-openapi`) merged with the `@swagger` JSDoc of the routes not yet moved. CI fails when the committed file is stale, when Spectral finds a new error, and when oasdiff finds a breaking change against `main` (ADR-103). *(As-built until 2026-09-30: `swagger.json` from JSDoc only, Swagger UI, unauthenticated where mounted.)*
- **Operation extensions:** `x-permission` (the route chain's gate — checked against the mounted router by `tests/guards/openapiRoutes.p925.test.ts`), `x-audited`, `x-rate-limit`; code-first operations only, during the migration.

---

## The Response Envelope

Produced by `backend/src/utils/response.util.js`. Every endpoint uses it.

### Success

```json
{
  "success": true,
  "status": 200,
  "message": "Success",
  "data": { }
}
```

### Success with pagination

```json
{
  "success": true,
  "status": 200,
  "message": "Success",
  "data": [ ],
  "meta": {
    "total": 137,
    "page": 1,
    "limit": 20,
    "totalPages": 7,
    "customCounts": { "active": 120, "inactive": 17 }
  }
}
```

**`meta` is a top-level sibling of `data`. It is never nested inside it.** Rows go in `data`. There is no `data.rows`, no `data.items`, no `data.meta`.

This is stated forcefully because it has been violated in shipped code. `GET /qms/nc`, `GET /qms/capa` and `GET /sop` returned `{ total, ..., nonConformances: [] }` inside `data`, and every corresponding frontend list rendered empty — with no error anywhere. A client written against the envelope fails silently when the envelope changes, which is the worst failure mode available.

Two more were found by the frontend audit (F-13) and brought onto the envelope, backend and frontend together (ADR-074): `GET /sessions` sent `data: { sessions, meta }` (fixed by A-111), and `GET /metered-billing/history` sent `data: { rows, meta }`. Both now answer rows in `data` and pagination in the top-level `meta`, pinned through their real routers by `backend/src/tests/routes/envelope.f13.test.js`. The 408 a timed-out request receives is in the envelope too (`requestTimeout.middleware.js`, F-14).

`customCounts` is optional and carries domain-specific tallies.

### Error

```json
{
  "success": false,
  "status": 400,
  "message": "Serial number already exists",
  "data": null
}
```

`details` is attached **only** when `NODE_ENV !== "production"`.

### Authentication response

Login attaches two extra top-level keys:

```json
{
  "success": true,
  "status": 200,
  "message": "Login successful",
  "data": { },
  "token": "eyJhbGciOi...",
  "session": { "id": "...", "createdAt": "...", "expiresAt": "..." }
}
```

`token` and `session` are siblings of `data`, not inside it.

## Status Codes

| Code | Meaning | Notes |
|---|---|---|
| 200 | OK | |
| 201 | Created | |
| 400 | Bad request | validation failure, with field detail |
| 401 | Unauthenticated | missing, malformed or expired token |
| 403 | Forbidden | authenticated, lacks the permission |
| 404 | Not found | **also returned for "exists but not yours"** |
| **409** | **Conflict** | invalid state transition — see below |
| 408 | Request timeout | the 30s handler timeout |
| 429 | Too many requests | rate limited — the global limiter sends draft-6 `RateLimit-*` headers (ADR-088); see [`../DEVELOPER/03-RATE-LIMITS-AND-ERROR-CODES.md`](../DEVELOPER/03-RATE-LIMITS-AND-ERROR-CODES.md) |
| 500 | Server error | |
| 503 | Service unavailable | `/health` when the database is unreachable |

### 404 for cross-tenant, never 403

A resource belonging to another tenant returns **404**, identical to one that does not exist. Returning 403 would confirm the id is real, which turns an id-enumeration attempt into a working tenant-membership oracle.

Non-existent, soft-deleted and not-yours must be indistinguishable.

### 409 for invalid transitions

Approving a certificate in `draft` is not a validation failure and not a server error. It is a conflict with the current state, and it returns 409.

Before this was fixed it threw a plain `Error` and surfaced as a 500, which hid a genuine design gap — there was no submit transition at all — behind a stack trace.

## Authentication

```
Authorization: Bearer <jwt>
```

The token carries its own `exp`. The verifier deliberately does **not** pass `maxAge`: a `maxAge` of `15m` against tokens signed with a one-day `expiresIn` rejected every token fifteen minutes after login and forced a re-login. The token expiry governs; nothing second-guesses it.

Refresh at `POST /api/v1/auth/refresh`.

## Tenant Headers

| Header | Who may use it | Effect |
|---|---|---|
| `x-tenant-id` | `SUPERADMIN` only | act inside that tenant |
| `x-tenant-code` | `SUPERADMIN` only | same, by code |
| `X-Tenant-ID` | tenant-pinned frontend builds | sent on every call by a `NEXT_PUBLIC_TENANT_ID` build |

For a non-super-admin the override headers are **ignored, not rejected** — a probe returns the caller's own data rather than an error confirming the header means something.

## Correlation

Every response carries `X-Request-Id` (a `crypto.randomUUID()` per request), exposed through CORS so a browser client can read it. Quote it in any bug report.

## Rate Limiting

| Scope | Window | Limit |
|---|---|---|
| Global | 15 min | 5,000 production / 100,000 otherwise (`RATE_LIMIT_MAX` overrides) |

**Corrected 2026-09-28 (ADR-088).** This table also listed "Auth endpoints 15 min / 20" and "OTP / password reset 1 hour / 5". Those limiters (`authLimiter`, `otpLimiter`) are **defined in `backend/index.js` and mounted nowhere**; only `defaultLimiter` runs (`app.use(defaultLimiter)`). Sign-in is protected by the per-identifier-and-address throttle of ADR-059, which **never locks an account** (A-185) — the earlier "can lock accounts" was also wrong. The global limiter sends draft-6 `RateLimit-*` headers (`standardHeaders: true`), not `X-RateLimit-*`. The authoritative, code-grounded list of every limiter and counter is [`../DEVELOPER/03-RATE-LIMITS-AND-ERROR-CODES.md`](../DEVELOPER/03-RATE-LIMITS-AND-ERROR-CODES.md).

## CORS

Explicit allowlist from `CORS_ORIGIN` (comma-separated). Credentials are enabled.

**A wildcard `*` is deliberately not honoured.** The policy runs with `credentials: true`, and reflecting an arbitrary origin with credentials would let any website make authenticated cross-origin requests on behalf of a logged-in user.

| Environment | No origins configured |
|---|---|
| production | **reject** |
| otherwise | allow all |

Requests with no `Origin` header (server-to-server, curl, Postman) are allowed.

## Limits

| | |
|---|---|
| Body size | 10 MB (`json` and `urlencoded`) |
| Request timeout | 30s → 408 |
| Default page size | 20 |

Anything that could exceed 30s belongs in a batch job, not a request.

## Validation

Joi, via `validate(schema)` from `validation.middleware.js`.

**Two traps that have each caused a class of production defect:**

1. **Passing `schema.validate` directly to Express 500s every request** on that route. Express calls it as `(req, res, next)`; Joi expects a value. Always use `validate(schema)`.
2. **Where an identifier is a path parameter, the validator must see it.** Several endpoints validated `req.body` for an id that only ever arrives in `req.params`, and 400ed every request. The fix merges first:

   ```js
   { ...req.params, ...req.body }
   ```

   This recurred across feature flags, tenant lifecycle and data retention.

Path UUIDs are additionally checked by `validateUuid` before they reach the database.

## Known Mount Aliases and Surprises

These are real and deliberate. They are documented here because each of them looks like a bug on first encounter.

| Surprise | Reality |
|---|---|
| `/api/v1/menu-group-roles` | serves the **same router** as `/api/v1/menu-groups` |
| `/api/v1/tenant-lifecycle` | **does not exist** — mounted at `/api/v1/tenants/:tenantId/...` |
| `/api/v1/data-retention` | **does not exist** — mounted at `/api/v1/tenants/:tenantId/...` |
| Tenant backups | also under `/api/v1/tenants/:tenantId/backups` |
| OIDC | mounted **twice**: `/api/v1/oidc` and `/oidc` at the host root, because discovery advertises `<issuer>/oidc/...` |
| SCIM | at `/api/v1/scim/v2`, with SCIM-cased paths — `/Users`, `/Groups` |
| `DELETE /api/v1/users/delete` | reads `userId` from the **query string**, not the path |
| Warehouse locations | **flat** at `/warehouses/locations`, not nested under a warehouse id |
| Stock update, transfer, opname | `PATCH`, not `PUT` |
| `menuGroupRole.getAdminMenuGroups` | hits a doubled path `/menu-groups/menu-groups/admin` |
| `GET /certificates/verify/:certificateNumber` | **public**, no authentication |
| `GET /content/posts/public`, `/posts/public/:slug`, `/categories/public` | **public** |
| `GET /tenants/public` | **public** — pre-auth branding for pinned frontend builds |

## Public Endpoints

The complete list of endpoints reachable without a token:

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
POST /api/v1/auth/login, /register, /send-otp, /reset-password
GET  /api/v1/auth/activation
POST /api/v1/billing/webhook          (signature-verified, not token-authenticated)
POST /api/v1/iot/ingest               (device-token authenticated)
```

Anything not on this list requires a Bearer token. Adding to it is a security decision that needs an ADR.

## Versioning

`/api/v1` is the only version. Breaking changes require a new prefix, not a mutation of this one (ADR-019). Additive changes — new optional fields, new endpoints — are not breaking.

## Known Contract Drift

`GET`/`POST` bodies documented in Swagger for the **GDPR** endpoints diverge from the enforced Joi validators. This is documented drift, not a mystery. Tracked in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md).

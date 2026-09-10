# 04 — Middleware Pipeline

21 middlewares in `backend/src/middlewares/`. Composition order is in `backend/index.js`, and the order is behaviour, not style.

---

## Global Pipeline

```
compression
  → HTTPS redirect            production + FORCE_HTTPS only
  → helmet                    CSP · object-src none · frame-ancestors none
  → hpp                       parameter pollution
  → CORS                      explicit allowlist · credentials true · never "*"
  → rate limiter              global, 15-minute window
  → body parser               10 MB; raw body preserved for the Stripe webhook only
  → timeout 30s               → 408
  → request id                → X-Request-Id
  → accessLog · activityLog
  → static                    /.well-known · /uploads (nosniff+inline) · /public
  → globalSanitizer
  → swagger
  ── per route ──
  → auth → tenantContext → dynamicAccess/rbac/abac → validate → handler
  → notFound → errorHandler
```

### Four order dependencies that matter

| Dependency | Why |
|---|---|
| `globalSanitizer` after the body parser | it rewrites `req.body`, `req.query`, `req.params` — and **not** `req.rawBody`, which is why the Stripe signature still verifies |
| `tenantContext` after `auth` | it reads `req.tenantId`, which auth sets |
| Static `/uploads` before the sanitizer and routing | upload serving pays for neither |
| Rate limiter before the body parser | a flood is rejected before 10 MB is parsed |

## Per-Route Middlewares

### `auth`

Verifies the JWT, loads the user and role, sets `req.user` and `req.tenantId`, honours the super-admin `x-tenant-id` / `x-tenant-code` override, and **rejects suspended tenants** (BR-3).

The override headers are honoured **only** for `SUPERADMIN`. For anyone else they are **ignored, not rejected** — a probe returns the caller's own data rather than an error confirming the header means something.

**The `maxAge` defect worth remembering:** the verifier deliberately does not pass `maxAge`. A `maxAge` of `15m` against tokens signed with a one-day `expiresIn` rejected every token fifteen minutes after login, platform-wide. The token's own `exp` governs.

### `tenantContext`

Opens the `AsyncLocalStorage` scope:

```js
tenantStorage.run({ tenantId, isSuperAdmin, isSystemTask }, () => next());
```

That context is read by the global Sequelize hooks. It used to also open a per-request transaction and set a PostgreSQL GUC for Row Level Security — both removed with RLS (ADR-029), which took two round-trips and a wrapping transaction off every authenticated request.

### `dynamicAccess(resource, action)`

Menu-group RBAC plus ABAC. The default gate for almost every route.

### `rbac([roles])`

Role-level gate comparing `ROLE_LEVELS` numerically. For operations expressed as a privilege floor — tenant backups are gated at `TENANT_ADMIN` (level 8) so both admin roles satisfy one check.

**A role absent from `ROLE_LEVELS` resolves to the lowest privilege.** Fails closed — correct — but silently.

### `validate(schema)`

Joi. See [`03-VALIDATION.md`](./03-VALIDATION.md). Never pass `schema.validate` directly; it 500s every request.

### `validateUuid`

Rejects a malformed path id before it reaches the database, where it would raise a type error and become a 500.

### `enforceQuota`

Runs **before** the handler (BR-15), so a rejected request never performs a partial write. Enforcing afterwards leaves the system in the state the quota exists to prevent.

### `auditLog`

Writes the `audit_logs` row — **inside the transaction of the action it describes**. An audit row surviving a rolled-back action records something that did not happen.

### `sessionSecurity`

Session binding checks against `ip_address` and `user_agent`. Strict IP binding breaks users on mobile networks that rotate addresses; the balance struck here is a product decision and should be stated rather than emergent.

## The Middlewares That Are Not Middleware

Four live in `middlewares/` because they are installed at app assembly, but they are **schedulers**, not per-request handlers:

| File | Job | Variable |
|---|---|---|
| `sessionCleanup` | expired sessions | `SESSION_CLEANUP_SCHEDULER` |
| `retentionScheduler` | data-retention purge | `RETENTION_SCHEDULER` (`disabled` turns it off) |
| `calibrationScheduler` | due and overdue sweep | — |
| `backup` | tenant backups | `BACKUP_SCHEDULER` |

The directory name misleads. Worth knowing before looking for where the nightly purge is triggered.

**On more than one replica, each of these runs once per replica** — every backup twice, every purge twice. Exactly one replica must run schedulers, and the Helm chart refuses to render a configuration with more than one cron-enabled replica ([`../DEVOPS/09-KUBERNETES.md`](../DEVOPS/09-KUBERNETES.md)).

## Security Middlewares in Detail

### helmet

```
default-src 'self'          script-src 'self' 'unsafe-inline'
style-src   'self' 'unsafe-inline' https:
img-src     'self' data: https:
object-src  'none'          frame-ancestors 'none'
```

`'unsafe-inline'` is there because bundled swagger-ui injects inline assets. `crossOriginResourcePolicy: cross-origin` so the separate-origin frontend can load `/uploads` images.

**That relaxation does not transfer** to the Next.js origin serving user-authored `posts.contentHtml`, which should be stricter.

### CORS

Explicit allowlist from `CORS_ORIGIN`, credentials enabled, **wildcard deliberately not honoured** — reflecting an arbitrary origin with credentials lets any site make authenticated cross-origin requests.

Production with no configured origins **rejects**. Outside production it allows all, and that branch keys on `NODE_ENV` rather than an opt-in flag so it cannot be left on by forgetting to unset something.

### Rate limiters

| Scope | Window | Max |
|---|---|---|
| Global | 15 min | **5,000 production / 100,000 otherwise** |
| Auth | 15 min | 20 |
| OTP / reset | 1 hour | 5 |

The non-production figure exists because a full browser E2E run exhausts a production budget and then fails for reasons unrelated to the code under test. It must never reach production.

### `errorHandlers`

Maps `AppError` to the envelope. `details` only outside production.

**It forwards recognised error types only.** A raw `pg` message carries SQL; a raw Node message carries a file path. No care at the call site fixes an over-permissive mapper — unrecognised errors become a generic 500 with the request id.

## Composing a Route

```js
router.post(
  "/",
  auth,
  dynamicAccess("equipment", "write"),
  validate(createDeviceSchema),
  deviceController.create,
);

router.get(
  "/:calibrationDeviceId",
  auth,
  dynamicAccess("equipment", "read"),
  validateUuid("calibrationDeviceId"),
  deviceController.getById,
);
```

**Nothing prevents omitting the permission gate.** A route without one works for everyone with a token, and there is no build guard that fails it.

That is the single most likely authorization defect in the codebase, and the guard is in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md).

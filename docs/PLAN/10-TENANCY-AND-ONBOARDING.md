# 10 — Tenancy and Onboarding

Modules: `HDC-TENANT` (5), `HDC-TLC` (6), `HDC-BAK` (7).

Security treatment of the tenant boundary is in [`../SECURITY/05-MULTI-TENANCY-SECURITY.md`](../SECURITY/05-MULTI-TENANCY-SECURITY.md), which is mandatory reading. This document covers the product shape.

---

## What a Tenant Is

One customer organisation — a hospital, a hospital group member, or a calibration provider. `tenants` carries:

| Group | Columns |
|---|---|
| Identity | `name`, `code`, `subdomain`, `domain`, `email` |
| Branding | `logo`, `primaryColor` |
| Commercial | `plan`, `billingCycle`, `billingEmail`, `limitSeats`, `limitStorageMb` |
| Contact | `contactName`, `contactEmail`, `contactPhone` |
| Lifecycle | `status` (`active` / `suspended` / `deleted`), `trialEndsAt` |
| Extension | `settings` (JSONB), plus `tenant_settings` key-value rows |
| Hierarchy | `parentId` |

Two extension mechanisms coexist. `settings` (JSONB on the tenant) is for structured configuration read as a unit; `tenant_settings` (one row per key) is for values written and read independently, including granular lifecycle state. Reach for `tenant_settings` when a value changes on its own schedule.

## Tenant Hierarchy

A hospital group with member hospitals is modelled as a parent tenant with children. `tenants.parentId` (migration `0013`) holds the edge; `tenant_hierarchies` materialises the traversal:

| Column | Purpose |
|---|---|
| `tenantCode`, `parentCode` | the edge, by code |
| `path` | materialised ancestor path, indexed |
| `depth` | distance from root |

A materialised path rather than recursive CTEs, because the platform must run on MySQL as well as PostgreSQL (ADR-029) and recursive CTE support differs.

**Isolation is not inherited.** A parent tenant does not automatically see child tenant data; the tenant predicate is still exact-match on `tenantId`. Cross-tenant visibility for a group requires an explicit, audited path — it is not a side effect of the hierarchy.

## Onboarding

```
1. SUPERADMIN creates the tenant
2. First tenant admin user is created
3. Tenant is usable
   ── everything below is optional ──
4. Branding
5. Storage
6. Custom domain
7. Federated identity
8. Backup schedule
```

### Step 1 — create the tenant

`POST /api/v1/tenants/create`. Collects `name`, `code`, `plan`, seat and storage limits.

Two fields are **derived rather than collected** (ADR-036):

- `subdomain` is required by the model but was never collected by the form; it is derived from `code`.
- `email` is optional in the form but required by the model; it falls back.

Before that fix, tenant creation returned a 500 `notNull` violation for every request. The fix is worth knowing because it means `subdomain` may not look like anything a user typed.

### Step 2 — first user

Roles are **global and pre-seeded**; there is no per-tenant role creation step. The first user is created with a `tenantId` and a `roleId` of `HEALTHCARE ADMIN` or `CALIBRATOR ADMIN`.

### Step 4 — branding

`logo` and `primaryColor` are readable **before authentication** when the frontend is pinned to a tenant with `NEXT_PUBLIC_TENANT_ID`. The login and register pages then render that tenant branding, and every API call carries `X-Tenant-ID`.

This is the single-tenant-branded-frontend deployment: one backend, many branded frontends. Leaving `NEXT_PUBLIC_TENANT_ID` empty produces the default multi-tenant build.

### Step 5 — storage

A tenant may bring its own S3-compatible bucket (`/dashboard/storage`), which moves that tenant storage cost and capacity off the platform. Credentials are encrypted at rest with KMS-style wrapping; tenant-supplied endpoints are SSRF-checked, operator-supplied ones are not (BR-14).

### Step 6 — custom domain

`custom_domains` with `domainType` of `custom`, `subdomain` or `vanity`, moving through `pending_verification → active`, or `verification_failed`, `deleting`, `deleted`.

Verification uses a `verificationToken`. TLS is provisioned over ACME when `CUSTOM_DOMAINS_ENABLED` and `TLS_AUTO_PROVISION` are set. `ACME_DIRECTORY_URL` **defaults to the Let's Encrypt staging directory** — a deployment that forgets to point it at production gets certificates no browser trusts, and the failure appears at the browser rather than in any log.

ACME HTTP-01 challenge files are written at runtime and served from `storagePath(".well-known")`, not a CWD-relative path. A path that shifts with the launch directory produces challenge failures that look like DNS problems.

### Step 8 — backups

`tenant_backups` supports on-demand and cron-scheduled backups (`cronExpression`), with `retentionDays`, `expiresAt`, a `recordCount`, and a status of `pending`, `in_progress`, `completed`, `failed` or `deleted`. Restore sets `restoredAt`.

## Lifecycle

```
active ⇄ suspended
   │
   └──▶ deleted
```

The `tenants.status` ENUM has exactly these three values. Granular lifecycle state beyond them — `offboarded`, for instance — lives in `tenant_settings` under `lifecycle_status`.

That split is the fix from ADR-037: the service originally wrote uppercase values such as `SUSPENDED` and a state `offboarded` that the ENUM did not contain, producing `invalid enum value` 500s on every suspend, resume and offboard.

### The suspension trap

Suspending a tenant blocks every request from its users (BR-3). Suspending the **default** tenant blocks the super-admin who lives in it, including the request that would reverse it. Recovery requires a direct database update.

Any script or test that suspends a tenant must create a disposable one first. This is a documented rule in [`../TESTING/03-E2E-TESTING.md`](../TESTING/03-E2E-TESTING.md) because it was learned by doing it.

## Mount Paths

The lifecycle and data-retention routers are mounted under `/api/v1/tenants/...`:

```js
app.use("/api/v1/tenants", tenantLifecycleRoutes);
app.use("/api/v1/tenants", dataRetentionRoutes);
```

Not at `/api/v1/tenant-lifecycle` or `/api/v1/data-retention`, despite the file names. The same is true of `tenantBackupRoutes`.

Path parameters merge with the body in these routers: several endpoints originally validated `tenantId` in `req.body` when it was a path parameter, and 400ed every request. The fix merges `{ ...req.params, ...req.body }` before validation.

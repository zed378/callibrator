# 04 — Tenant API

Base: `/api/v1/tenants` (four routers share it), `/api/v1/tenant-hierarchy`, `/api/v1/custom-domains`, `/api/v1/admin`.

Modules `HDC-TENANT` (5), `HDC-TLC` (6), `HDC-BAK` (7).

---

## Four Routers on One Base Path

```js
app.use("/api/v1/tenants", tenantRoutes);
app.use("/api/v1/tenants", tenantBackupRoutes);
app.use("/api/v1/tenants", tenantLifecycleRoutes);
app.use("/api/v1/tenants", dataRetentionRoutes);
```

There is **no** `/api/v1/tenant-lifecycle` and **no** `/api/v1/data-retention`, despite the file names. Everything hangs off `/api/v1/tenants/:tenantId/...`.

## `/api/v1/tenants` — core, 11 endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/all` | admin | list tenants |
| POST | `/detail` | admin | one tenant — **POST with the id in the body** |
| GET | `/public` | **public** | pre-auth branding for a pinned frontend |
| POST | `/create` | `SUPERADMIN` | create a tenant |
| PATCH | `/edit` | admin | update |
| DELETE | `/delete` | `SUPERADMIN` | delete |
| POST | `/settings` | admin | write a setting |
| PATCH | `/settings` | admin | update a setting |
| POST | `/user-count` | admin | seat usage |
| POST | `/:tenantId/logo` | admin | upload a logo |
| DELETE | `/:tenantId/logo` | admin | remove a logo |

### `GET /public`

Unauthenticated, and deliberately so. A frontend pinned with `NEXT_PUBLIC_TENANT_ID` renders that tenant logo, name and colour on the **login page**, before anyone has signed in.

It must therefore expose branding only — name, logo, primary colour. Anything else on this endpoint is a pre-auth information disclosure.

### `POST /create` and two derived fields

Rate-limited to 10/min. Collects `name`, `code`, `plan`, `limitSeats`, `limitStorageMb`.

Two fields are **derived, not collected** (ADR-036):

- `subdomain` — required by the model, never present in the form, derived from `code`
- `email` — optional in the form, required by the model, falls back

Before that fix every create returned a 500 `notNull` violation. Worth knowing because `subdomain` may not resemble anything a user typed.

## `/api/v1/tenants/:tenantId/backups` — 7 endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/:tenantId/backups` | create a backup |
| GET | `/:tenantId/backups` | list |
| GET | `/:tenantId/backups/stats` | statistics |
| GET | `/:tenantId/backups/:backupId` | one backup |
| GET | `/:tenantId/backups/:backupId/download` | download |
| POST | `/:tenantId/backups/:backupId/restore` | restore |
| DELETE | `/:tenantId/backups/:backupId` | delete |

Gated at `TENANT_ADMIN` level (8) by `rbac()` — which is why the logical `TENANT_ADMIN` tier exists at all: one gate covering both `HEALTHCARE ADMIN` and `CALIBRATOR ADMIN`.

Restore is destructive and must be audited with both the backup id and the actor.

## `/api/v1/tenants/:tenantId/*` — lifecycle, 7 endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/:tenantId/status` | lifecycle status |
| POST | `/:tenantId/suspend` | suspend |
| POST | `/:tenantId/resume` | resume |
| POST | `/:tenantId/grace-period` | set a grace period |
| POST | `/:tenantId/offboard` | begin offboarding |
| POST | `/:tenantId/offboard/cancel` | cancel offboarding |
| GET | `/:tenantId/export` | export tenant data |

### Two fixes worth carrying forward

**Params merged with body.** These endpoints originally validated `tenantId` in `req.body` when it only ever arrives as a path parameter, and 400ed every request. Fixed by validating `{ ...req.params, ...req.body }`.

**Status vocabulary.** The service wrote uppercase values such as `SUSPENDED` and a state `offboarded` that the ENUM does not contain, producing `invalid enum value` 500s on suspend, resume and offboard alike. `tenants.status` has exactly three values — `active`, `suspended`, `deleted` — and granular state such as `offboarded` lives in `tenant_settings` under `lifecycle_status` (ADR-037).

### The suspension trap

Suspending a tenant blocks every request from its users (BR-3). Suspending the **default** tenant blocks the super-admin who lives in it, including the request that would reverse it — recovery needs a direct database update.

Any test or script that suspends must create a **disposable** tenant first. This is a rule because it was learned by doing it.

## `/api/v1/tenants/:tenantId/*` — data retention, 8 endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/:tenantId/policy` | read the retention policy |
| PUT | `/:tenantId/policy` | write it |
| GET | `/:tenantId/legal-hold` | list holds |
| POST | `/:tenantId/legal-hold` | place a hold |
| DELETE | `/:tenantId/legal-hold` | release |
| POST | `/:tenantId/purge` | run a purge |
| POST | `/:tenantId/mask-pii` | mask PII |
| POST | `/:tenantId/anonymize` | anonymise |

A purge **must** skip anything under legal hold (BR-16). A retention policy that outranks a legal hold is a compliance incident.

Two defects fixed here that generalise:

- `POST /:tenantId/legal-hold` 500ed on every call because a controller spread a Joi schema into a plain object and then called `schema.validate` on the result — `schema.validate is not a function`.
- `POST /:tenantId/purge` 500ed with `column "tenantId" does not exist`, because the sessions purge used `tenantId` where the `sessions` model attribute is `tenant_id`. This also broke the nightly retention cron.

## `/api/v1/tenant-hierarchy` — 9 endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/tree` | full hierarchy |
| GET | `/:tenantId/children` | direct children |
| GET | `/:tenantId/parent` | parent |
| GET | `/:tenantId/descendants` | all descendants |
| GET | `/:tenantId/ancestors` | all ancestors |
| POST | `/:parentId/children` | add a child |
| PUT | `/:tenantId/parent` | reparent |
| DELETE | `/:tenantId/parent` | detach |
| GET | `/cross-tenant-roles` | roles spanning tenants |

Backed by `tenant_hierarchies` with a materialised `path` and `depth`, so ancestor and descendant queries are a prefix match rather than recursion — required because the platform must also run on MySQL.

**Hierarchy does not grant visibility.** A parent tenant does not automatically see child data; the tenant predicate is still exact-match. Cross-tenant visibility needs an explicit, audited path.

## `/api/v1/custom-domains` — 7 endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/domains` | list |
| POST | `/domains` | register |
| POST | `/domains/:domainId/verify` | trigger verification |
| GET | `/domains/:domainId/status` | status |
| GET | `/domains/:domainId/dns` | required DNS records |
| POST | `/domains/:domainId/default` | make default |
| DELETE | `/domains/:domainId` | remove |

States: `pending_verification`, `active`, `verification_failed`, `deleting`, `deleted`. Types: `custom`, `subdomain`, `vanity`.

TLS is provisioned over ACME when `CUSTOM_DOMAINS_ENABLED` and `TLS_AUTO_PROVISION` are set. **`ACME_DIRECTORY_URL` defaults to the Let's Encrypt staging directory** — forgetting to point it at production yields certificates no browser trusts, and the failure appears in the browser rather than in any log.

Challenge files are written at runtime under `storagePath(".well-known")` and served from there. A CWD-relative path shifts with the launch directory, and the resulting failures look like DNS problems.

## `/api/v1/admin` — 3 endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/tenants` | `SUPERADMIN` | cross-tenant listing |
| PATCH | `/tenants/:id/status` | `SUPERADMIN` | set status |
| PATCH | `/tenants/:id/flags` | `SUPERADMIN` | set flags |

Operator-only, and every call bypasses tenant scoping by role. Each must be audited.

# 12 — Admin Surface

Module: `HDC-ADMIN` (30). Routes: `/admin`, `/migration`.

---

## Two Kinds of Administrator

The word "admin" covers two very different trust levels, and conflating them is how privilege escalation happens.

| | Tenant administrator | Platform operator |
|---|---|---|
| Roles | `HEALTHCARE ADMIN`, `CALIBRATOR ADMIN` (level 8) | `SUPERADMIN` (level 10) |
| Scope | one tenant | all tenants |
| Tenant scoping | enforced | bypassed by design |
| Can create tenants | no | yes |
| Can run migrations | no | yes |
| Can answer support tickets | yes, within their tenant | yes, cross-tenant |
| Can raise support tickets | yes | **no** (BR-13) |

`SUPERADMIN` short-circuits every permission check and every tenant predicate. There is no second gate behind it. That makes the super-admin account the highest-value credential in the system, and the treatment it needs is in [`../SECURITY/03-AUTHENTICATION-SECURITY.md`](../SECURITY/03-AUTHENTICATION-SECURITY.md).

## Cross-Tenant Targeting

A super-admin can act inside a specific tenant by sending a header:

```
x-tenant-id:   <uuid>
x-tenant-code: <code>
```

`auth.middleware.js` honours these **only** for `SUPERADMIN`. For anyone else they are ignored — not rejected, ignored — so a probe returns the caller's own tenant data rather than an error that would confirm the header is meaningful.

The frontend sends `X-Tenant-ID` for a different reason: a tenant-pinned build (`NEXT_PUBLIC_TENANT_ID`) sends it on every call. Same header, two purposes; the middleware distinguishes by role.

## Platform Administration

`/api/v1/admin` — operator-only. System health, cross-tenant listings, and platform-level operations.

## Migration Endpoint

`/api/v1/migration` is mounted from `src/routes/internal/`, the only router under `internal/` rather than `api/`. It runs and inspects database migrations over HTTP.

That capability is genuinely dangerous and exists because the platform ships as a **compiled binary** with no shell in the runtime image (see [`../DEVOPS/02-CONTAINERIZATION.md`](../DEVOPS/02-CONTAINERIZATION.md)). Without it there is no way to run a migration in a deployed container.

It also carries the demo seeder, gated behind `SEED_DEMO=true`:

| Endpoint | Gate | Effect |
|---|---|---|
| `GET /api/v1/migration/seed-demo` | `SEED_DEMO=true` | seeds ~80 demo rows across every business module, idempotent on re-run |

Also available as a standalone script at `src/scripts/seedDemo.js`. The seeder writes through models directly rather than over HTTP, and teardown removes what it created.

**Rule: `SEED_DEMO` must never be true in production.** A demo seeder that runs against real data is a data-integrity incident.

## Migrations

`backend/src/migrations/`, run through `src/scripts/migrate.js` with Umzug.

```bash
npm run migrate          # up
npm run migrate:undo     # down
npm run migrate:status   # pending
```

Eighteen migrations, `0001` to `0018`. Notable ones:

| Migration | What it did |
|---|---|
| `0001-underscore-class-models` | established the `underscored` column convention |
| `0003-add-search-vectors` | full-text search vectors |
| `0012-enable-rls-policies` | added PostgreSQL Row Level Security |
| `0015-drop-rls-policies` | **removed it again** — ADR-029 |
| `0016-add-attachment-storage-key` | pluggable storage |
| `0018-add-document-chunks` | `CREATE EXTENSION vector` for pgvector RAG |

`0012` followed by `0015` is the visible scar of the isolation-mechanism change. Both are kept; a migration is history, and squashing them would erase the record that RLS was tried.

### The silent no-op trap

A migration wrapped in a blanket `try/catch` around `describeTable` will be **marked applied while doing nothing**. Umzug records success; the column never appears; the failure surfaces weeks later as a runtime error about a missing column.

After running migrations, verify the columns actually exist in the database. Do not trust the migration log alone.

Also: the Umzug context **is** the QueryInterface. Writing `context.sequelize.getQueryInterface()` fails in a way that the same blanket catch will swallow.

## Feature Flags

`HDC-FLAG` (27), route `/feature-flags`, surface `/dashboard/feature-flags`.

Flags are set per tenant per key: `POST /:tenantId/:flagKey` with `{ enabled }`. Both identifiers are **path parameters**; the validator merges `{ ...req.params, ...req.body }` before validating. Validating the body alone 400ed every request, which is worth knowing because the same shape recurs across tenant-lifecycle and data-retention.

## Network Security

`HDC-NETSEC` (28), route `/network-security`, surface `/dashboard/network-security`. IP allowlisting and network-level access policy per tenant.

## Global Search

`HDC-SEARCH` (29), route `/search`. Spans the major domain entities, backed by the search vectors from migration `0003`. Tenant-scoped like everything else — search is a common place for isolation to leak, because it queries many tables at once and one missed predicate is enough.

## Health and Root

Two unauthenticated endpoints outside `/api/v1`:

| Endpoint | Returns |
|---|---|
| `GET /health` | 200 with uptime, memory, pid, node version and `database: "connected"`; **503** with `database: "disconnected"` when `db.authenticate()` fails |
| `GET /` | 200 liveness |

`/health` is a genuine readiness probe — it proves the database is reachable, not merely that the process is running. Compose and Kubernetes both use it, and a container that returns 503 here is correctly kept out of rotation.

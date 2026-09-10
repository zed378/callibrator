# 04 — Database Architecture

Table-by-table detail is in [`../DATABASE/`](../DATABASE/00-DATA-MODEL.md). This document covers the engine strategy, access patterns and operational shape.

---

## Engine-Agnostic by Constraint

The platform runs on **PostgreSQL or MySQL** (`DB_DIALECT`). That is not a nice-to-have; it is a customer requirement from on-premise hospital deployments that already run a MySQL estate and will not add a second engine.

ADR-029 records it, and it is the reason for several decisions that look strange in isolation:

| Consequence | Why |
|---|---|
| Tenant isolation lives in the ORM, not in Row Level Security | RLS is PostgreSQL-only |
| `tenant_hierarchies` materialises `path` and `depth` | recursive CTE support and syntax differ |
| Sequelize rather than a query builder or raw SQL | dialect abstraction is the point |
| No `GENERATED ALWAYS AS` columns — `rpn` and `overallScore` are Sequelize `VIRTUAL` | computed-column syntax differs |
| pgvector features **degrade** rather than differ | MySQL has no equivalent |

pgvector is the honest exception. `document_chunks.embedding` is `vector(1536)` and migration `0018` runs `CREATE EXTENSION vector`. On MySQL the AI/RAG module is unavailable. That is a documented capability difference, not a portability claim.

The compose stack therefore uses `pgvector/pgvector:pg17`, not `postgres:17-alpine` — plain Postgres lacks the extension and migration `0018` fails.

## Connection Pool

| Variable | Default |
|---|---|
| `DB_POOL_MAX` | 10 (dev) / 20 (production) |
| `DB_POOL_MIN` | 2 |
| `DB_POOL_ACQUIRE_TIMEOUT` | 30000 ms |
| `DB_POOL_IDLE_TIMEOUT` | 10000 ms |

The acquire timeout matching the 30-second request timeout is deliberate: a request waiting for a connection should fail at roughly the same moment the request itself gives up, rather than acquiring a connection nobody is waiting for any more.

TLS via `DB_SSL`, `DB_SSL_CA`, `DB_SSL_REJECT_UNAUTHORIZED`.

## Schema Scale

| | Count |
|---|---|
| Models | 72 |
| Tenant-scoped | ~60 |
| Global | `roles`, `menu_groups`, `categories`, `posts`, `role_menu_permissions`, `user_menu_permissions` |
| Soft-deleted (`paranoid`) | ~40 |
| Append-only by construction | `audit_logs` |

## Naming Conventions

| Layer | Convention | Example |
|---|---|---|
| Sequelize attribute | camelCase | `isDeleted` |
| Database column | snake_case (`underscored`) | `is_deleted` |
| Table | snake_case plural | `calibration_devices` |

Three real inconsistencies, all of which have caused defects:

1. **`sessions` uses `tenant_id`, `user_id`, `token_hash`** as *attribute* names, not just column names. A purge written as `Session.destroy({ where: { tenantId } })` failed with `column "tenantId" does not exist` and broke the nightly retention cron. `tenantKeyOf()` in the scoping util checks both spellings for exactly this reason.
2. **`UsageMetrics`** is the one camelCase table name. Only matters in raw SQL, where PostgreSQL will require quoting.
3. **`tenants.billingCycle`** is `monthly`/`yearly` while **`subscriptions.billingCycle`** is `Monthly`/`Annually`. Two vocabularies for one idea.

## Indexing Strategy

Indexes follow the queries that actually run:

| Index | Serves |
|---|---|
| `calibration_devices(next_calibration_date)` | every scheduler query, dashboard tile and overdue report |
| `calibration_records(is_compliant)` | compliance rate |
| `calibration_records(device_id)`, `(calibration_date)` | device history |
| `iot_readings(device_id, timestamp)` | telemetry windows — always queried as a pair |
| `certificates(certificate_number)` | **public verification lookups** |
| `attachments(resource_type, resource_id)` | polymorphic lookup |
| `posts(slug)`, `(published_at)` | public content |
| `sessions(token_hash)` | every authenticated request |
| `plan_quotas(tenant_id, metric)` | quota check on the hot path |
| `UsageMetrics(tenantId, metric, periodStart)` | metering rollups |
| `tenant_id` on every scoped table | the mandatory predicate |
| `is_deleted` on soft-deleted tables | the default scope |

`certificates(certificate_number)` and `sessions(token_hash)` are the two that face the outside world on every request of their kind. They are not optional.

Every tenant-scoped table indexes `tenant_id` because the isolation hook adds that predicate to **every** query — an unindexed `tenant_id` makes isolation expensive as well as correct.

## Transactions

Opened in the **service** layer, never in a controller.

```js
const { sequelize } = require("../models");   // NOT { db }

await sequelize.transaction(async (t) => {
  // ...
});
```

Operations that must be atomic:

| Operation | Why |
|---|---|
| Stock transfer state changes | quantity must move exactly once (BR-10) |
| Workflow step advance plus action record | a decision without a record is unauditable |
| Certificate transition plus e-signature record | the signature must not outlive a failed transition |
| Tenant creation plus first user | a tenant with no admin is unreachable |
| Batch job progress plus result | progress that disagrees with the result is worse than none |

Audit rows are written **inside** the transaction of the action they describe. An audit row that survives a rolled-back action records something that did not happen.

## Soft Delete

Most models are `paranoid: true` **and** carry an `isDeleted` boolean, which is belt and braces — Sequelize `paranoid` uses `deletedAt`, and `isDeleted` is a denormalised, indexable flag used by `defaultScope`.

Two operational notes:

- Setting `is_deleted` (snake_case) in application code silently does nothing. The attribute is `isDeleted`.
- `.unscoped()` is required to see soft-deleted rows.

`audit_logs` is deliberately **not** paranoid and has no delete path. The absence is the control (BR-6).

## Migrations

Umzug, `backend/src/migrations/`, 18 files.

```bash
npm run migrate            # up
npm run migrate:undo       # down
npm run migrate:status     # pending
```

The `0012` → `0015` pair (enable RLS, then drop RLS) is kept rather than squashed. A migration history is a record; removing the evidence that RLS was tried would leave the next person to rediscover why it does not work here.

### Two traps

**The Umzug context IS the QueryInterface.** Writing `context.sequelize.getQueryInterface()` throws.

**A blanket `try/catch` around `describeTable` marks a migration applied while doing nothing.** Umzug records success, the column never appears, and the failure surfaces weeks later as a missing-column runtime error.

After migrating, verify the columns exist in the database. The migration log is not evidence.

## Backup

Two independent layers:

| Layer | Scope | Where |
|---|---|---|
| Tenant backup | one tenant's rows, scheduled or on demand, with retention | `tenant_backups` |
| Infrastructure backup | the whole database | [`../DEVOPS/04-DATABASE-BACKUP.md`](../DEVOPS/04-DATABASE-BACKUP.md) |

Tenant backup is a product feature — a customer exporting or restoring their own data. Infrastructure backup is disaster recovery. Neither substitutes for the other.

## Growth

| Table | Growth | Managed by |
|---|---|---|
| `iot_readings` | highest volume | retention purge |
| `audit_logs` | monotonic, no delete path | nothing — a compliance decision is required before anything can |
| `sessions` | bounded | expiry sweep |
| `webhook_deliveries` | bounded | exhaustion plus retention |
| `notifications` | moderate | retention |

Neither high-volume table is partitioned. That is the correct next step when row counts make retention insufficient, and it is in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md) rather than pre-built.

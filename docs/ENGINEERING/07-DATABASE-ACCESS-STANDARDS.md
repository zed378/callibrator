# 07 — Database Access Standards

PostgreSQL 18 with pgvector, **only** (ADR-039). Sequelize 6 with global tenant-scoping hooks (ADR-029).

---

## The Default Path: the ORM, Scoped

Every model with a `tenantId` (or `tenant_id`) attribute is filtered by the hooks in `utils/tenantScope.util.js`:

```
options.skipTenantScope  → skip    explicit, greppable, auditable
no request context       → skip    pre-auth, public, migrations, schedulers
context.isSystemTask     → skip    background work spanning tenants
context.isSuperAdmin     → skip    cross-tenant operator
context.tenantId         → filter
otherwise                → DENY    tenantId = NO_TENANT_UUID
```

You do not add the tenant predicate yourself. You do not remove it without `skipTenantScope`, and every use of that is a review item.

### Models the hooks do not scope

A model with **no** tenant attribute is invisible to the hooks. The important one is **`Tenant`**: `Tenant.findByPk(req.params.tenantId)` returns any tenant in the system. Loading it by an id from the request requires an explicit ownership check. Its absence on `tenant-hierarchy` is audit finding **A-01**, a cross-tenant write.

## Writes Are Stamped, Not Trusted

`tenantId` on create comes from the principal. A `tenantId` in the request body is ignored at best and an attack at worst.

## Transactions and the Audit Row

```js
await sequelize.transaction(async (transaction) => {
  const record = await Model.create(data, { transaction });
  await AuditLog.create({ …, changes: { after: record } }, { transaction });
});
```

The audit row is written **inside** the transaction of the action it describes. One that survives a rollback records something that did not happen.

Get `sequelize` from the models barrel by that name. **Destructuring `db` from it yields `undefined`** — every workflow write 500ed until that was fixed.

## Includes

**An optional association needs `required: false`.** Without it Sequelize emits an INNER JOIN and a row whose optional foreign key is null disappears from the result. It is the most repeated defect shape in this codebase — certificates, then risks, and it is latent on `maintenance_work_orders`.

## Attribute Names

| Model | Attribute style | Trap |
|---|---|---|
| almost all | camelCase attributes, snake_case columns (`underscored: true`) | write `isDeleted`, not `is_deleted` |
| **`sessions`** | **snake_case attributes** (`user_id`, `tenant_id`, `is_revoked`) | `Session.destroy({ where: { tenantId } })` fails — it broke the nightly retention purge |
| **`UsageMetrics`** | camelCase **table and columns** in the database (`"tenantId"`, `"periodStart"`) | quote them in raw SQL |

## Raw SQL

Raw SQL **bypasses the scoping hooks entirely.**

| Rule | Why |
|---|---|
| carry the tenant predicate explicitly, as a **bound** parameter | the hooks are not there |
| use **`bind`** for `$n` placeholders | `replacements` only substitutes `?` and `:name`. Passing `$1` as a replacement makes PostgreSQL answer `there is no parameter $1` — which, behind a `catch`, read all metered usage as zero |
| never interpolate a value into the SQL string | parameterise; identifiers from a fixed allow-list only |
| every new raw query is a review item | it is where isolation can leak |

Target (P9-07): a `sql<Row>(text, bind)` helper that accepts bind parameters only; direct `db.query` banned by lint.

Current raw-SQL sites that touch tenant data: `search.service.js` (full-text search), `ai.service.js` (pgvector insert and retrieval), `meteredBilling.service.js` (usage aggregate and reset). Each carries `tenant_id` explicitly.

## PostgreSQL Features Are Allowed

With one engine (ADR-039), these no longer need a portability excuse — but each new use is still a design decision, recorded where it matters:

`JSONB` and its operators · `tsvector` / GIN · generated columns · partial and expression indexes · recursive CTEs · `pgvector` · `REVOKE` grants.

Existing designs chosen for MySQL's sake — the materialised path in `tenant_hierarchies`, `VIRTUAL` columns for `rpn` and `overallScore` — stand until a decision changes them.

## Soft Delete

Most domain tables are `paranoid` or carry `isDeleted`. Use `.unscoped()` deliberately to see deleted rows, never by accident. Uniqueness on soft-deleted tables must account for deleted rows, or re-creating a deleted record fails with a constraint error.

A **global** unique constraint is a cross-tenant existence oracle: `calibration_devices.serialNumber` is unique across all tenants, so a failure reveals that another hospital holds that serial (P6-06).

## Migrations

| Rule | Why |
|---|---|
| Umzug; the file's context **is** the QueryInterface | `context.sequelize.getQueryInterface()` throws |
| no blanket `try/catch` | a swallowed failure is recorded as applied while doing nothing |
| verify columns after migrating | the migration log is not evidence |
| **never edit an applied migration** | it changes nothing on databases that ran it, and diverges on new ones |
| **names are frozen once applied** | `schema_migrations` records `0001-underscore-class-models.js` *with* the suffix; changing the manifest string re-runs the migration (P9-23) |

Detail: [`../DATABASE/13-MIGRATIONS.md`](../DATABASE/13-MIGRATIONS.md).

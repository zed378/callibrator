# 13 — Migrations

Umzug. `backend/src/migrations/`, driven by `backend/src/scripts/migrate.js`.

```bash
npm run migrate          # up
npm run migrate:undo     # down
npm run migrate:status   # pending
```

---

## The Eighteen

| # | Migration | What it did |
|---|---|---|
| 0001 | `underscore-class-models` | established the `underscored` column convention |
| 0002 | `add-stripe-invoice-id` | `invoices.stripeInvoiceId` |
| 0003 | `add-search-vectors` | full-text search vectors behind `/api/v1/search` |
| 0004 | `add-mfa-fields` | `users.mfaEnabled`, `users.mfaSecret` |
| 0005 | `add-batch-jobs` | `batch_jobs` |
| 0006 | `add-capas` | `capas` |
| 0007 | `add-sop-documents` | `sop_documents`, `sop_training_acknowledgments` |
| 0008 | `extend-vendors-qualification` | `approvalStatus`, audit dates |
| 0009 | `add-uncertainty-budgets` | `calibration_devices.uncertaintyBudget` — the ISO 17025 requirement |
| 0010 | `add-iot-fields` | `iotEnabled`, `iotDeviceToken`, `readingTolerance` |
| 0011 | `add-esignature-records` | `e_signature_records` — the Part 11 evidence table |
| **0012** | **`enable-rls-policies`** | **added PostgreSQL Row Level Security** |
| 0013 | `add-tenant-parent-id` | `tenants.parentId` |
| 0014 | `add-user-webauthn-fields` | passkey credential columns |
| **0015** | **`drop-rls-policies`** | **removed it again** — ADR-029 |
| 0016 | `add-attachment-storage-key` | `attachments.storageKey` for pluggable storage |
| 0017 | `add-signature-workflows` | `signature_workflows`, `_steps`, `signature_records` |
| 0018 | `add-document-chunks` | `document_chunks` plus `CREATE EXTENSION vector` |

## The `0012` → `0015` Scar

Row Level Security was added and then removed three migrations later.

**Both are kept.** Squashing them would erase the evidence that RLS was tried, and the next person would rediscover the reasons the hard way.

Why it was removed (ADR-029):

1. **RLS is PostgreSQL-only.** The platform must also run on MySQL, and an isolation mechanism that exists on one engine is not an isolation mechanism.
2. **The policy had a fail-open branch.** `app.current_tenant = ''` matched **every row**. A request arriving without the session variable set saw everything.
3. It cost two round-trips and a wrapping transaction per authenticated request, to set and reset the GUC.

Isolation now lives in the ORM layer, deny-by-default, engine-agnostic — `backend/src/utils/tenantScope.util.js`. See [`../BACKEND/05-TENANT-SCOPING.md`](../BACKEND/05-TENANT-SCOPING.md).

Point 2 is the one worth carrying forward as a rule: **an isolation mechanism whose "no context" branch permits rather than denies is not an isolation mechanism.** The replacement resolves an absent tenant to a UUID no tenant will ever own.

## Two Traps That Have Both Bitten

### 1. The Umzug context IS the QueryInterface

```js
// ✗ throws
module.exports.up = async ({ context }) => {
  const qi = context.sequelize.getQueryInterface();
};

// ✓
module.exports.up = async ({ context: queryInterface }) => {
  await queryInterface.addColumn("table", "column", { /* … */ });
};
```

### 2. A blanket try/catch marks a migration applied while doing nothing

```js
// ✗ this migration will be recorded as successful and change nothing
try {
  const desc = await queryInterface.describeTable("calibration_devices");
  if (!desc.uncertainty_budget) {
    await queryInterface.addColumn(/* … */);
  }
} catch (e) { /* ignore */ }
```

If `describeTable` throws — or if the trap above throws inside the block — the catch swallows it, Umzug records success, and the column never appears. The failure surfaces weeks later as a runtime error about a missing column, with a migration log that says everything applied cleanly.

**Verify the columns in the database after migrating. The migration log is not evidence.**

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'calibration_devices';
```

A post-migration assertion step comparing expected columns against `information_schema` is in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md) as the mechanical fix.

## Writing a Migration

1. **Write `down` as well as `up`.** A migration with no rollback is a one-way door, and the moment you need it is an incident.
2. **Idempotent guards are fine; blanket catches are not.** Check for the column, add it if absent, and let a genuine error fail loudly.
3. **Expand and contract for anything breaking.** Add the new column, backfill, switch the code, then drop the old column in a later migration. One migration that renames a column in place breaks every running instance during the deploy.
4. **Test on an empty database and on a copy of production data.** The two fail differently: empty catches ordering, populated catches constraint violations against real values.
5. **Verify the resulting columns.** See above.
6. **Consider MySQL.** `CREATE EXTENSION`, `JSONB` and generated-column syntax are not portable. `0018` is PostgreSQL-only by necessity; anything else that is should be a deliberate decision with an ADR.

## Running Migrations in a Deployed Container

The backend ships as a **compiled binary with no shell in the runtime image**, so there is no way to exec in and run a script.

That is why `/api/v1/migration` exists — an internal router (`src/routes/internal/migration.route.js`) that runs and inspects migrations over HTTP.

It is a genuinely dangerous capability and it is the only option available. It must be `SUPERADMIN`-gated, audited, and unreachable from the public internet.

The same router carries the demo seeder behind `SEED_DEMO=true` — roughly 80 rows across every business module, idempotent, with teardown. **`SEED_DEMO` must never be true in production.**

## Startup Behaviour

The backend runs `db.sync()` and migrations **at boot**. Two consequences:

- Compose must gate the backend on `postgres: service_healthy` (`pg_isready`), not on `service_started`. Starting against a database that is not accepting connections produces a crash loop that looks like a code fault.
- On more than one replica, two instances will attempt migrations simultaneously. Exactly one should run them, or migrations need to be advisory-locked. This is a prerequisite for horizontal scaling, alongside the two in [`../ARCHITECTURE/08-DEPLOYMENT-ARCHITECTURE.md`](../ARCHITECTURE/08-DEPLOYMENT-ARCHITECTURE.md).

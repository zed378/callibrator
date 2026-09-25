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

1. **RLS is PostgreSQL-only.** The platform then had to run on MySQL, and an isolation mechanism that exists on one engine is not an isolation mechanism. *(That requirement was dropped by ADR-039; the other two reasons stand.)*
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

### The mechanical fix — every boot verifies the schema (P6-05)

As-built 2026-09-24 (ADR-062). After `db.sync()` and the migrator, the backend compares **every model's
columns** with `information_schema.columns`, and checks the **control objects that exist only in migrations** by
name — the `calibration_records` append-only trigger and void CHECK (0057), the per-tenant serial index (0026), the
stock-adjustment reason CHECK (0059), the case-insensitive `users` email and username indexes (0063, ADR-063) — and **refuses to start** on a mismatch, naming each one
(`backend/src/utils/schemaVerify.util.js`, called from `backend/index.js`):

- a model table or column the database lacks — the silent no-op migration;
- a column the model does **not** declare that is `NOT NULL` with no default — every insert would fail on it
  (an undeclared nullable column is only a note);
- a missing control object.

It runs before the backend drops to the application role, because `information_schema` shows a role only the
columns it holds privileges on. It is not wrapped in a catch; `SCHEMA_VERIFY=warn` downgrades a mismatch to error
logs on every boot — for a recovery, not a steady state.

```bash
make migrate               # restarts the backend (which migrates at boot), then:
make migrate-verify        # prints the last boot's [schema-verify] verdict; fails unless OK
make migrate-verify-host   # HOST: npm run migrate:verify against backend/.env's database, exit 1 on a mismatch
```

Proved against PostgreSQL 16 and 18.6 — a synced and migrated database passes; a dropped column, a dropped trigger and an
undeclared `NOT NULL` column each fail it: `backend/src/tests/services/dataIntegrity.p6.live.test.js`. On 18.6 a fresh
boot (`db.sync()` + all migrations) and an upgrade from the pre-batch-6 schema (`fabc3be`, with legacy rows) both
pass the verifier (ADR-062).

**Blanket catches still in existing migrations** (audited 2026-09-24, A-243). All ran long ago on every database;
the verifier now catches their failure mode, so they are recorded rather than rewritten:
`0001` and `0005` wrap `describeTable` in a catch that skips on **any** error (`0002`, `0004`, `0009`, `0013`, `0016` no
longer do — D-14, ADR-063); `0014` swallows
any `addIndex`/`removeIndex` error; `0017` swallows `DROP TYPE` errors and its `down`'s `dropTable`; `0018` swallows
`CREATE EXTENSION vector` and the ivfflat index (deliberate — pgvector is optional there, and the `ALTER TABLE …
vector` after it fails loudly without the extension). `0014`/`0023`/`0028`/`0029`/`0031` narrow their catch to
"table does not exist" and re-throw everything else — the correct shape.

## Writing a Migration

0. **`up` never drops a table that may hold data** (D-09, ADR-063). A re-run is possible whenever `schema_migrations`
   is lost — a data-only restore, a rebuilt database — so `up` refuses rather than rebuilds (see `0011`). The whole
   migrator is re-run over a populated database, with `schema_migrations` emptied, by
   `backend/src/tests/migrations/dataIdentity.dbA.live.test.js`, which asserts every row count is unchanged.
1. **Write `down` as well as `up`.** A migration with no rollback is a one-way door, and the moment you need it is an incident.
2. **Idempotent guards are fine; blanket catches are not.** Check for the column, add it if absent, and let a genuine error fail loudly.
3. **Expand and contract for anything breaking.** Add the new column, backfill, switch the code, then drop the old column in a later migration. One migration that renames a column in place breaks every running instance during the deploy.
4. **Test on an empty database and on a copy of production data.** The two fail differently: empty catches ordering, populated catches constraint violations against real values.
5. **Verify the resulting columns.** See above.
5a. **What `db.sync()` does and does not do on an existing database** (D-13, D-20, ADR-064 — observed on PostgreSQL
   18.6, 2026-09-25). It creates a missing **table**, and it adds a model's missing **`indexes` entries**; it never
   adds a **column**, never changes a column's type, default or foreign key, and never adds an **enum value**. So:
   a new column on an existing model always needs a migration; so does a new enum value, and a changed `onDelete`
   (`0066`). And because sync runs **before** the migrator, a model `indexes` entry — or any index — naming a
   column that only a migration creates breaks `sync()` on every existing database: such an index lives in the
   migration only, and the model gains it in a later release. An expression or partial index (`0070`) cannot be
   declared on the model at all.
6. **PostgreSQL only (ADR-039).** `CREATE EXTENSION`, `JSONB`, generated columns and `tsvector` are all fair game — no portability shim, no dialect branch. **Never edit an applied migration** to remove its old dialect guard; write a new one if behaviour must change. (Formerly: "consider MySQL". Anything PostgreSQL-only used to need a deliberate decision with an ADR.

## Running Migrations in a Deployed Container

The backend ships as a **compiled binary with no shell in the runtime image**, so there is no way to exec in and run a script.

That is why `/api/v1/migration` exists — an internal router (`src/routes/internal/migration.route.js`) that runs and inspects migrations over HTTP.

It is a genuinely dangerous capability and it is the only option available. It must be `SUPERADMIN`-gated, audited, and unreachable from the public internet.

The same router carries the demo seeder behind `SEED_DEMO=true` — roughly 80 rows across every business module, idempotent, with teardown. **`SEED_DEMO` must never be true in production.**

## Startup Behaviour

The backend runs `db.sync()` and migrations **at boot**. Two consequences:

- Compose must gate the backend on `postgres: service_healthy` (`pg_isready`), not on `service_started`. Starting against a database that is not accepting connections produces a crash loop that looks like a code fault.
- After migrating, the backend verifies the schema (above) and, when `DB_APP_ROLE` is set, drops every pooled
  connection to that role with `SET ROLE` (P6-03, `backend/src/utils/dbRole.util.js`). The owner login is used for
  sync and migrations only. One consequence: the internal `/api/v1/migration` "migrate" and "drop" endpoints run
  `db.sync()` as the application role and now **fail** — creating or dropping tables is not something the running
  application may do. Migrate by restarting the backend (`make migrate`).
- On more than one replica, two instances will attempt migrations simultaneously. Exactly one should run them, or migrations need to be advisory-locked. This is a prerequisite for horizontal scaling, alongside the two in [`../ARCHITECTURE/08-DEPLOYMENT-ARCHITECTURE.md`](../ARCHITECTURE/08-DEPLOYMENT-ARCHITECTURE.md).

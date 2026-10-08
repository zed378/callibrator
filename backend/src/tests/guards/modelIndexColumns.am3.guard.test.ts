/**
 * AM-3 — no model declares an index on a column that a MIGRATION adds.
 *
 * WHY
 *
 * The boot (backend/index.js → utils/migrationLock.util#runSchemaSetup) runs
 * `db.sync()` BEFORE the migrator. On a table that already exists, Sequelize
 * 6.37.8's `Model.sync()` skips CREATE TABLE but still builds every entry of
 * the model's `_indexes` the database does not have (model.js, `sync`:
 * `showIndex` → `missingIndexes` → `addIndex`) — `options.indexes`, including
 * `indexes[].unique` and partial-index `where` keys, plus the GIN index of a
 * JSONB attribute declared `index: true`. On an UPGRADED database the column
 * such an index names does not exist yet — the migration that adds it runs
 * after sync — so the boot dies with
 *
 *   column "api_key_id" does not exist — CREATE INDEX calibration_records_api_key_id
 *
 * and the migration that would have fixed it never runs. A FRESH database
 * hides it (sync creates the column from the model), which is why every unit
 * test and every fresh E2E stack stayed green while the deploy was blocked.
 *
 * Attribute-level `unique: true` is only emitted inside CREATE TABLE
 * (model.js `refreshAttributes` → `uniqueKeys`), so it cannot block an
 * upgrade boot. It is held here anyway: on a migration-added column it makes a
 * fresh database and an upgraded one differ unless the migration builds the
 * same constraint — the index belongs in the migration only (0096's pattern).
 *
 * HOW
 *
 *  - the MIGRATION side is read statically, with the TypeScript parser, from
 *    every file in src/migrations (and pending/): each `addColumn(table, col)`
 *    call and each SQL string `ALTER TABLE t ... ADD COLUMN c` reachable from
 *    the migration's `up` (a `down` that re-adds a dropped column is not an
 *    addition). Constants, `for (... of ...)` loops over constant arrays and
 *    objects (`Object.entries/keys/values/freeze`), small helper functions and
 *    template literals are evaluated; a site whose table or column it cannot
 *    evaluate FAILS the guard (closed world — a new migration shape must be
 *    readable, never silently skipped);
 *  - the MODEL side is the REAL barrel on an unconnected PostgreSQL-dialect
 *    Sequelize (the a148 technique): every model's `_indexes` — exactly what
 *    sync() would build — and every attribute declared `unique`.
 *
 * Not "a test generated from the code it tests" (CLAUDE.md, Evidence): the
 * subject is the pair (models, migrations); the expectation is the reviewed
 * ALLOW list below, and a stale entry fails.
 */
import { scanMigrationSource, scanMigrations, scanSharedModuleSource, type Added } from "../fixtures/migrationScan";
import type * as SequelizeModule from "sequelize";
import type * as ModelsModule from "../../models";

jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual<typeof SequelizeModule>("sequelize");
  const db = new Sequelize({ dialect: "postgres", logging: false });
  db.query = (() => Promise.resolve([])) as unknown as typeof db.query;
  return { db };
});

/**
 * A model index (or unique attribute) on a migration-added column that is
 * NOT an upgrade blocker, because every supported upgrade base already has the
 * column. The supported upgrade base is ce74932 (2026-09-29, the last release
 * deployed; its last migration is 0090) — so only columns added by 0090 or
 * earlier can be listed. Keyed `table.column`; a key that no longer matches an
 * offender fails ("stale").
 */
const ALLOW: Readonly<Record<string, string>> = Object.freeze({
  "invoices.stripe_invoice_id":
    "A unique ATTRIBUTE (Invoice.stripeInvoiceId), which sync() emits only inside CREATE TABLE, so it " +
    "never blocks an upgrade boot; migration 0002 adds the column with the same `unique: true`, so a " +
    "fresh and an upgraded database both have the constraint. 0002 predates the upgrade base ce74932.",
});

// ---------------------------------------------------------------------------
// The migration side: tests/fixtures/migrationScan (the closed-world static
// evaluator moved there unchanged, 2026-09-30, so D-20 reads the migrations the
// same way).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The model side, and the core check.
// ---------------------------------------------------------------------------

/** One column a model asks the database to index. */
interface IndexedColumn {
  table: string;
  column: string;
  /** How it is declared: the sync() index name, or `unique attribute <name>`. */
  how: string;
}

interface IndexDefinition {
  name?: string;
  fields: (string | { name?: string; attribute?: string })[];
  where?: unknown;
}

interface ModelLike {
  name: string;
  getTableName(): string | { tableName: string };
  getAttributes(): Record<string, { field?: string; unique?: unknown }>;
}

const tableOf = (m: ModelLike): string => {
  const t = m.getTableName();
  return typeof t === "string" ? t : t.tableName;
};

/** What sync() would index on an existing table (`_indexes`), and every unique attribute. */
const modelIndexedColumns = (models: readonly ModelLike[]): IndexedColumn[] => {
  const out: IndexedColumn[] = [];
  for (const model of models) {
    const table = tableOf(model);
    const indexes = (model as unknown as { _indexes?: IndexDefinition[] })._indexes ?? [];
    for (const index of indexes) {
      const columns = index.fields.map((f) => (typeof f === "string" ? f : (f.name ?? f.attribute ?? "")));
      if (index.where && typeof index.where === "object") {
        columns.push(...Object.keys(index.where));
      }
      for (const column of columns) {
        out.push({ table, column, how: `index ${index.name ?? "(unnamed)"}` });
      }
    }
    for (const [attribute, definition] of Object.entries(model.getAttributes())) {
      if (definition.unique) {
        out.push({ table, column: definition.field ?? attribute, how: `unique attribute ${model.name}.${attribute}` });
      }
    }
  }
  return out;
};

interface Offender {
  key: string;
  how: string;
  addedBy: string[];
}

/** The core check: model-indexed columns that a migration adds. */
const offenders = (indexed: readonly IndexedColumn[], added: readonly Added[]): Offender[] => {
  const addedBy = new Map<string, Set<string>>();
  for (const a of added) {
    const key = `${a.table}.${a.column}`;
    addedBy.set(key, (addedBy.get(key) ?? new Set()).add(a.file));
  }
  const out = new Map<string, Offender>();
  for (const i of indexed) {
    const key = `${i.table}.${i.column}`;
    const files = addedBy.get(key);
    if (files) {
      const prev = out.get(key);
      out.set(key, {
        key,
        how: prev ? `${prev.how}; ${i.how}` : i.how,
        addedBy: [...files].sort(),
      });
    }
  }
  return [...out.values()].sort((a, b) => a.key.localeCompare(b.key));
};

// ---------------------------------------------------------------------------

describe("AM-3 — no model index on a column a migration adds (db.sync() runs before the migrator)", () => {
  const models = jest.requireActual<typeof ModelsModule>("../../models") as unknown as {
    sequelize: { models: Record<string, ModelLike> };
  };
  const allModels = [...new Set(Object.values(models.sequelize.models))];
  const scan = scanMigrations();

  it("reads every column-adding site of every migration (closed world: an unreadable one fails)", () => {
    expect(scan.unresolved).toEqual([]);
  });

  it("is not vacuous: it finds known additions of old and new migrations", () => {
    const keys = new Set(scan.added.map((a) => `${a.table}.${a.column}`));
    expect([...keys]).toEqual(
      expect.arrayContaining([
        // 0105 — raw SQL in a loop over TARGETS built by a helper.
        "calibration_records.api_key_id",
        "stock_adjustments.api_key_id",
        "stock_transfers.api_key_id",
        // 0096 — addColumn(TABLE, COLUMN).
        "certificates.verification_token",
        // 0003 — a template over Object.entries, with an unevaluable GENERATED expression.
        "calibration_devices.search_vector",
        // 0059 — a loop over a frozen tuple array.
        "stock_adjustments.stock_id",
        // 0102 — Object.entries of a constant object.
        "tenants.address",
        // 0090 — Object.entries of a helper's returned object.
        "webhooks.previous_secret_expires_at",
      ]),
    );
    // A `down` that re-adds a dropped column is not an addition (0044 restores iot_device_token).
    const token = scan.added.filter((a) => a.column === "iot_device_token");
    expect(token.map((a) => a.file)).not.toContain("0044-iot-device-token-hash.ts");
  });

  it("P20-07: sees the client-facility columns 0117 – 0123 add, though they share a helper module", () => {
    const keys = new Set(scan.added.map((a) => `${a.table}.${a.column}`));
    expect([...keys]).toEqual(
      expect.arrayContaining([
        "audit_logs.client_facility_id",
        "calibration_devices.client_facility_id",
        "calibration_records.client_facility_id",
        "certificates.client_facility_id",
        "maintenance_work_orders.client_facility_id",
        "iot_readings.client_facility_id",
        "attachments.client_facility_id",
        "attachments.rekey_pending",
        "non_conformances.client_facility_id",
        "warehouses.client_facility_id",
        "users.client_facility_id",
        "users.facility_binding_pending",
      ]),
    );
  });

  it("P20-07: a shared migration module may not add a column or create an index (closed world) — comments aside", () => {
    expect(scanSharedModuleSource("x.shared.ts", "/** ADD COLUMN in a comment */ export const f = 1;").unresolved).toEqual([]);
    expect(scanSharedModuleSource("x.shared.ts", "const s = `ALTER TABLE ${t} ADD COLUMN c UUID`;").unresolved).toEqual([
      "x.shared.ts: a shared migration module adds a column — write it in the migration's own up",
    ]);
    expect(scanSharedModuleSource("x.shared.ts", "const s = 'CREATE UNIQUE INDEX i ON t (c)';").unresolvedIndexes).toEqual([
      "x.shared.ts: a shared migration module creates an index — write it in the migration's own up",
    ]);
  });

  it("finds the models' sync() indexes (not vacuous)", () => {
    const indexed = modelIndexedColumns(allModels);
    expect(indexed.length).toBeGreaterThan(100);
    expect(indexed).toEqual(expect.arrayContaining([expect.objectContaining({ table: "certificates", column: "certificate_number" })]));
  });

  it("no model index or unique attribute names a migration-added column, except the reviewed ALLOW list", () => {
    const found = offenders(modelIndexedColumns(allModels), scan.added).filter((o) => !(o.key in ALLOW));
    expect(found).toEqual([]);
  });

  it("every ALLOW entry is still an offender (a stale entry fails)", () => {
    const current = new Set(offenders(modelIndexedColumns(allModels), scan.added).map((o) => o.key));
    expect(Object.keys(ALLOW).filter((k) => !current.has(k))).toEqual([]);
  });

  it("bites: the pre-fix `{ fields: [\"api_key_id\"] }` on calibration_records is an offender", () => {
    const fixture: ModelLike = {
      name: "CalibrationRecordPreFix",
      getTableName: () => "calibration_records",
      getAttributes: () => ({ apiKeyId: { field: "api_key_id" } }),
    };
    Object.assign(fixture, { _indexes: [{ name: "calibration_records_api_key_id", fields: ["api_key_id"] }] });
    const found = offenders(modelIndexedColumns([fixture]), scan.added);
    expect(found).toEqual([
      {
        key: "calibration_records.api_key_id",
        how: "index calibration_records_api_key_id",
        addedBy: ["0105-api-key-actor-columns.ts"],
      },
    ]);
  });

  it("bites: a partial index's WHERE column and a unique attribute count too", () => {
    const fixture: ModelLike = {
      name: "CertificatePreFix",
      getTableName: () => "certificates",
      getAttributes: () => ({ verificationToken: { field: "verification_token", unique: true } }),
    };
    Object.assign(fixture, { _indexes: [{ name: "x", fields: ["tenant_id"], where: { submitted_by: null } }] });
    const keys = offenders(modelIndexedColumns([fixture]), scan.added).map((o) => o.key);
    expect(keys).toEqual(["certificates.submitted_by", "certificates.verification_token"]);
  });

  it("bites: the evaluator reads the shapes migrations use, and refuses what it cannot read", () => {
    const src = `
      const TABLE = "t1";
      const COLS = { a: 1, b: 2 };
      const PAIRS = Object.freeze([["c", "INT"], ["d", "TEXT"]]);
      const mk = (table: string) => Object.freeze({ table, col: \`\${table}_x\` });
      const TARGETS = [mk("t2")];
      export = {
        up: async ({ context }: any) => {
          for (const [column] of Object.entries(COLS)) { await context.addColumn(TABLE, column, {}); }
          for (const [name, ddl] of PAIRS) { await context.sequelize.query(\`ALTER TABLE \${TABLE} ADD COLUMN \${name} \${ddl}\`); }
          for (const t of TARGETS) { await context.sequelize.query(\`ALTER TABLE "\${t.table}" ADD COLUMN IF NOT EXISTS "\${t.col}" INT\`); }
          const rows = await context.sequelize.query("SELECT 1");
          for (const r of rows) { await context.addColumn(TABLE, r.name, {}); }
        },
        down: async ({ context }: any) => { await context.addColumn(TABLE, "restored", {}); },
      };`;
    const result = scanMigrationSource("fixture.ts", src);
    expect(result.added.map((a) => `${a.table}.${a.column}`)).toEqual(["t1.a", "t1.b", "t1.c", "t1.d", "t2.t2_x"]);
    expect(result.unresolved).toEqual([expect.stringContaining("fixture.ts:13: addColumn(TABLE, r.name)")]);
  });
});

/**
 * P24-02a (ADR-129 Am. 3) — the transform's first built steps on a REAL PostgreSQL 18, run on the
 * transform role's own connection (config/upstreamImport#createTransformDb), never as the owner:
 *
 *  - migration 0134: down / up / up rebuilds the same objects; the transform role may read, insert
 *    and update `client_facilities` (no DELETE) and only INSERT `audit_logs`; everything else in
 *    `public` stays closed to it;
 *  - the facilities step: names normalised, duplicates merged into the lowest legacy id with a
 *    device, a facility without devices and an empty name quarantined, an operator-made facility
 *    adopted, codes F-0001… after the highest, the source DATETIME read in Asia/Jakarta;
 *  - the audit step: one CREATE row per facility written, in its tenant and facility, actor
 *    `system:upstream-transform`, no legacy id; a re-run of the same values writes nothing; a
 *    changed name updates the facility and writes one UPDATE row;
 *  - the provider tenant: a tenant without a self facility, or a second provider, is refused
 *    PROVIDER_TENANT_INVALID; a failed transform leaves no facility and no audit row behind.
 *
 * Synthetic values only (`… Sintetis …`, example.test); nothing from upstream.
 *
 *   docker run -d --name p2402-pg18 -e POSTGRES_PASSWORD=p2402pass -p 127.0.0.1:55231:5432 pgvector/pgvector:pg18
 *   DB_HOST=127.0.0.1 DB_PORT=55231 DB_NAME=p2402_scratch DB_USER=postgres DB_PASS=p2402pass \
 *     npm run test:live -- --only=p2402a
 *   docker rm -f p2402-pg18
 */
import type { Transaction } from "sequelize";
import { env } from "../../config/env";
import type { StepContext, TransformStep } from "../../services/upstreamImport/transform/steps";
import type * as StepsModule from "../../services/upstreamImport/transform/steps";
import type * as LedgerModule from "../../services/upstreamImport/transform/ledger";
import type * as RunnerModule from "../../services/upstreamImport/transform/runner";
import type * as ConfigModule from "../../config/upstreamImport";

const APP_ROLE = "callibrator_app";
const IMPORT_ROLE = "callibrator_import";
const TRANSFORM_ROLE = "callibrator_transform";
const PROVIDER = "a2402000-0000-4000-8000-0000000000a1";
const SECOND = "a2402000-0000-4000-8000-0000000000a2";
const NO_SELF = "a2402000-0000-4000-8000-0000000000a3";
const PRE_MADE = "a2402000-0000-4000-8000-0000000000b1";
const RUN_1 = "a2402000-0000-4000-8000-0000000000e1";
const RUN_2 = "a2402000-0000-4000-8000-0000000000e2";
const RUN_3 = "a2402000-0000-4000-8000-0000000000e3";
const RUN_4 = "a2402000-0000-4000-8000-0000000000e4";
const ZONE = "Asia/Jakarta";

type Row = Record<string, unknown>;
interface LiveDb {
  options: { logging: unknown };
  query(sql: string, options?: object): Promise<[Row[], unknown]>;
  transaction(): Promise<Transaction>;
  transaction<T>(fn: (t: Transaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  getQueryInterface(): unknown;
}
interface Migration {
  up(o: { context: unknown }): Promise<void>;
  down(o: { context: unknown }): Promise<void>;
}

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

/* eslint-disable @typescript-eslint/no-require-imports -- the graph is loaded after the environment is set; typed by the members used */
const load = () => ({
  db: (require("../../config") as { db: LiveDb }).db,
  models: require("../../models") as unknown,
  migrator: (require("../../config/migrator") as { migrator: { pending(): Promise<unknown[]> } }).migrator,
  migrationLock: require("../../utils/migrationLock.util") as { runSchemaSetup(options: object): Promise<unknown> },
  steps: require("../../services/upstreamImport/transform/steps") as typeof StepsModule,
  ledger: require("../../services/upstreamImport/transform/ledger") as typeof LedgerModule,
  runner: require("../../services/upstreamImport/transform/runner") as typeof RunnerModule,
  config: require("../../config/upstreamImport") as typeof ConfigModule,
  m0134: require("../../migrations/0134-upstream-transform-facilities") as Migration,
});
/* eslint-enable @typescript-eslint/no-require-imports */

/** One synthetic facility row: [id, name, created_at or null]. */
type Facility = readonly [id: number, name: string, createdAt: string | null];

const FACILITIES: readonly Facility[] = [
  [1, "RS Sintetis Satu", "2024-01-02 08:00:00"],
  [2, "  rs   sintetis   SATU ", null],
  [3, "Klinik Sintetis Dua", null],
  [4, "   ", null],
  [5, "Puskesmas Sintetis Tiga", "2024-03-04 23:30:00"],
  [6, "Fasilitas Buatan Operator", null],
];
/** The facilities with a device in the register (3 has none; 4's name is empty). */
const WITH_DEVICES = [1, 2, 5, 6];

describe("P24-02a — the facilities and audit steps on live PostgreSQL 18, as the transform role", () => {
  jest.setTimeout(300_000);
  let g: ReturnType<typeof load>;
  let transformDb: LiveDb;

  const rows = async (sql: string): Promise<Row[]> => (await g.db.query(sql))[0];

  /** The PostgreSQL error `sql` raises AS `role` (inside a rolled-back transaction), or null. */
  const errorAs = async (role: string, sql: string): Promise<string | null> => {
    const t = await g.db.transaction();
    try {
      await g.db.query(`SET LOCAL ROLE ${role}`, { transaction: t });
      await g.db.query(sql, { transaction: t });
      return null;
    } catch (err) {
      const e = err as { parent?: { code?: string; message?: string } };
      return `${e.parent?.code ?? "?"} ${e.parent?.message ?? String(err)}`;
    } finally {
      await t.rollback();
    }
  };

  /** Statements run AS the import role (the staging schema's owner), committed. */
  const asImport = async (...statements: string[]): Promise<void> => {
    const t = await g.db.transaction();
    await g.db.query(`SET LOCAL ROLE ${IMPORT_ROLE}`, { transaction: t });
    for (const statement of statements) {
      await g.db.query(statement, { transaction: t });
    }
    await t.commit();
  };

  const literal = (value: string | null): string => (value === null ? "NULL" : `'${value.replace(/'/g, "''")}'`);

  /** Stage the facilities (with `rename` applied) and one device per facility with devices, for `run`. */
  const stage = (run: string, rename: Readonly<Record<number, string>> = {}): Promise<void> =>
    asImport(
      `INSERT INTO upstream_import.stg_mst_faskes (import_run_id, source_row_number, id, name_faskes, phone, address, img_logo, created_at, updated_at)
       VALUES ${FACILITIES.map(([id, name, createdAt], i) => `('${run}', ${String(i + 1)}, ${String(id)}, ${literal(rename[id] ?? name)}, '021-000${String(id)}', NULL, NULL, ${literal(createdAt)}, NULL)`).join(", ")}`,
      `INSERT INTO upstream_import.stg_trx_inventory (import_run_id, source_row_number, id, id_client)
       VALUES ${WITH_DEVICES.map((client, i) => `('${run}', ${String(i + 1)}, ${String(100 + client)}, ${String(client)})`).join(", ")}`,
    );

  /** A synthetic stand-in for the devices step (P24-02 builds it): every staged device quarantined `no_device`. */
  const devicesStub = (): TransformStep => ({
    id: "devices_stub",
    writes: ["calibration_devices"],
    sources: [{ table: "trx_inventory", legacyId: 's."id"::text' }],
    run: async (context: StepContext) => {
      const source = { table: "trx_inventory", legacyId: 's."id"::text' };
      const staged = await g.ledger.classify(context, source);
      await g.ledger.quarantineRows(
        context,
        staged.map((r) => ({ sourceTable: "trx_inventory", sourceRowNumber: r.sourceRowNumber, legacyId: r.legacyId, reason: "no_device" as const })),
      );
    },
  });

  /** The built steps (facilities, audit) around the stub. */
  const steps = (): TransformStep[] => {
    const [facilities, audit] = ["client_facilities", "audit_logs"].map((id) => g.steps.TRANSFORM_STEPS.find((s) => s.id === id) as TransformStep);
    return [facilities as TransformStep, devicesStub(), audit as TransformStep];
  };

  const transform = (runId: string, tenantId = PROVIDER, list: TransformStep[] = steps()) =>
    g.runner.runTransform({ runId, db: transformDb, runner: transformDb, role: TRANSFORM_ROLE, tenantId, sourceZone: ZONE, steps: list });

  const facilities = (): Promise<Row[]> =>
    rows(
      `SELECT name, code, kind, status, is_self, legacy_id, phone, (created_at AT TIME ZONE 'UTC')::text AS created FROM client_facilities
        WHERE tenant_id = '${PROVIDER}' ORDER BY code`,
    );
  const importAudits = (): Promise<Row[]> =>
    rows(
      `SELECT a.action::text AS action, a.resource_type, a.tenant_id, a.client_facility_id = a.resource_id::uuid AS own_facility,
              a.user_id, a.actor_type::text AS actor_type, a.changes, f.code
         FROM audit_logs a JOIN client_facilities f ON f.id = a.resource_id::uuid
        WHERE a.actor_name = 'system:upstream-transform' ORDER BY a.created_at, f.code`,
    );

  beforeAll(async () => {
    const name = env("DB_NAME") ?? "";
    if (!name.includes("scratch")) {
      throw new Error(`Refusing to build a schema in DB_NAME="${name}": use a scratch database (see the header)`);
    }
    g = load();
    g.db.options.logging = false;
    await g.migrationLock.runSchemaSetup({ sequelize: g.db, migrator: g.migrator, logger });
    expect(await g.migrator.pending()).toEqual([]);
    await g.db.query(
      `INSERT INTO tenants (id, name, subdomain, email, created_at, updated_at) VALUES
         ('${PROVIDER}', 'Penyedia Kalibrasi Sintetis', 'p2402-penyedia', 'penyedia@example.test', now(), now()),
         ('${SECOND}', 'Penyedia Sintetis Kedua', 'p2402-kedua', 'kedua@example.test', now(), now()),
         ('${NO_SELF}', 'Tanpa Fasilitas Sendiri', 'p2402-tanpa', 'tanpa@example.test', now(), now())`,
    );
    await g.db.query(
      `INSERT INTO client_facilities (id, tenant_id, name, code, is_self, created_at, updated_at) VALUES
         (gen_random_uuid(), '${PROVIDER}', 'Penyedia Kalibrasi Sintetis', 'SELF', true, now(), now()),
         (gen_random_uuid(), '${SECOND}', 'Penyedia Sintetis Kedua', 'SELF', true, now(), now()),
         ('${PRE_MADE}', '${PROVIDER}', 'Fasilitas Buatan Operator', 'OP-1', false, now(), now())`,
    );
    await asImport(
      `CREATE TABLE IF NOT EXISTS upstream_import.stg_mst_faskes (import_run_id uuid NOT NULL, source_row_number bigint NOT NULL,
         id integer, name_faskes varchar(255), phone varchar(50), address varchar(255), img_logo varchar(255),
         created_at timestamp without time zone, updated_at timestamp without time zone, PRIMARY KEY (import_run_id, source_row_number))`,
      `CREATE TABLE IF NOT EXISTS upstream_import.stg_trx_inventory (import_run_id uuid NOT NULL, source_row_number bigint NOT NULL,
         id integer, id_client integer, PRIMARY KEY (import_run_id, source_row_number))`,
    );
    transformDb = g.config.createTransformDb() as unknown as LiveDb;
  });

  afterAll(async () => {
    await transformDb.close();
    await g.db.close();
  });

  it("0134: down / up / up on the migrated database rebuilds the same objects", async () => {
    const objects = async (): Promise<Row[]> =>
      rows(
        `SELECT 'c:' || conname || ':' || pg_get_constraintdef(oid) AS o FROM pg_constraint
          WHERE conname IN ('upstream_sql_imports_transform_tenant', 'quarantine_reason_vocabulary')
         UNION ALL SELECT 'g:' || table_name || ':' || privilege_type FROM information_schema.role_table_grants
                    WHERE grantee = '${TRANSFORM_ROLE}' AND table_schema = 'public'
         UNION ALL SELECT 'col:' || column_name || ':' || data_type FROM information_schema.columns
                    WHERE table_name = 'upstream_sql_imports' AND column_name = 'transform_tenant_id'
         ORDER BY 1`,
      );
    const before = await objects();
    expect(before.map((r) => String(r["o"]).replace(/:CHECK.*/, ""))).toEqual([
      "c:quarantine_reason_vocabulary",
      "c:upstream_sql_imports_transform_tenant",
      "col:transform_tenant_id:uuid",
      "g:audit_logs:INSERT",
      "g:client_facilities:INSERT",
      "g:client_facilities:SELECT",
      "g:client_facilities:UPDATE",
    ]);
    expect(String(before[0]?.["o"])).toContain("'facility_without_devices'");
    await g.m0134.down({ context: g.db.getQueryInterface() });
    expect(await rows(`SELECT count(*)::int AS n FROM information_schema.role_table_grants WHERE grantee = '${TRANSFORM_ROLE}' AND table_schema = 'public'`)).toEqual([{ n: 0 }]);
    expect(await rows("SELECT pg_get_constraintdef(oid) LIKE '%facility_without_devices%' AS has FROM pg_constraint WHERE conname = 'quarantine_reason_vocabulary'")).toEqual([
      { has: false },
    ]);
    await g.m0134.up({ context: g.db.getQueryInterface() });
    await g.m0134.up({ context: g.db.getQueryInterface() });
    expect(await objects()).toEqual(before);
  });

  it("the transform role: client_facilities read / insert / update, no delete; audit_logs insert only; the rest of public closed", async () => {
    expect(await errorAs(TRANSFORM_ROLE, "SELECT 1 FROM client_facilities LIMIT 1")).toBeNull();
    expect(await errorAs(TRANSFORM_ROLE, `UPDATE client_facilities SET phone = NULL WHERE id = '${PRE_MADE}'`)).toBeNull();
    expect(await errorAs(TRANSFORM_ROLE, `DELETE FROM client_facilities WHERE id = '${PRE_MADE}'`)).toMatch(/^42501 permission denied for table client_facilities/);
    expect(await errorAs(TRANSFORM_ROLE, "SELECT 1 FROM audit_logs LIMIT 1")).toMatch(/^42501 permission denied for table audit_logs/);
    expect(await errorAs(TRANSFORM_ROLE, "UPDATE audit_logs SET action = action")).toMatch(/^42501/);
    // users holds column grants since 0135 (P24-02b, proved column by column in upstreamTransform.p2402b.live).
    for (const table of ["tenants", "calibration_devices", "calibration_records", "upstream_sql_imports"]) {
      expect([table, await errorAs(TRANSFORM_ROLE, `SELECT 1 FROM ${table} LIMIT 1`)]).toEqual([table, expect.stringMatching(/^42501/)]);
    }
    expect(await errorAs(APP_ROLE, "SELECT 1 FROM upstream_import.id_map")).toMatch(/^42501/);
  });

  it("a tenant without a self facility is refused PROVIDER_TENANT_INVALID and nothing is written", async () => {
    await stage(RUN_1);
    await expect(transform(RUN_1, NO_SELF)).rejects.toMatchObject({ code: "PROVIDER_TENANT_INVALID" });
    expect(await rows(`SELECT count(*)::int AS n FROM client_facilities WHERE tenant_id = '${NO_SELF}'`)).toEqual([{ n: 0 }]);
  });

  it("the first transform: facilities normalised, merged, adopted, coded and quarantined; one CREATE audit row each", async () => {
    const summary = await transform(RUN_1);
    expect(summary.steps.map((s) => [s.step, s.sources])).toEqual([
      ["client_facilities", [{ table: "mst_faskes", staged: 6, mapped: 4, unchanged: 0, quarantined: { facility_without_devices: 1, value_out_of_range: 1 } }]],
      ["devices_stub", [{ table: "trx_inventory", staged: 4, mapped: 0, unchanged: 0, quarantined: { no_device: 4 } }]],
      ["audit_logs", []],
    ]);
    expect(await facilities()).toEqual([
      { name: "RS Sintetis Satu", code: "F-0001", kind: "other", status: "active", is_self: false, legacy_id: 1, phone: "021-0001", created: "2024-01-02 01:00:00" },
      { name: "Puskesmas Sintetis Tiga", code: "F-0002", kind: "other", status: "active", is_self: false, legacy_id: 5, phone: "021-0005", created: "2024-03-04 16:30:00" },
      { name: "Fasilitas Buatan Operator", code: "OP-1", kind: "other", status: "active", is_self: false, legacy_id: 6, phone: null, created: expect.any(String) as string },
      { name: "Penyedia Kalibrasi Sintetis", code: "SELF", kind: "other", status: "active", is_self: true, legacy_id: null, phone: null, created: expect.any(String) as string },
    ]);
    const mapped = await rows(
      `SELECT m.legacy_id, f.code, m.tenant_id, m.client_facility_id = m.target_id AS own, m.source_values
         FROM upstream_import.id_map m JOIN client_facilities f ON f.id = m.target_id WHERE m.source_table = 'mst_faskes' ORDER BY m.legacy_id`,
    );
    expect(mapped).toEqual([
      { legacy_id: "1", code: "F-0001", tenant_id: PROVIDER, own: true, source_values: null },
      { legacy_id: "2", code: "F-0001", tenant_id: PROVIDER, own: true, source_values: { mergedIntoLegacyId: "1", name_faskes: "  rs   sintetis   SATU " } },
      { legacy_id: "5", code: "F-0002", tenant_id: PROVIDER, own: true, source_values: null },
      { legacy_id: "6", code: "OP-1", tenant_id: PROVIDER, own: true, source_values: null },
    ]);
    expect(await rows("SELECT legacy_id, reason FROM upstream_import.quarantine WHERE source_table = 'mst_faskes' ORDER BY legacy_id")).toEqual([
      { legacy_id: "3", reason: "facility_without_devices" },
      { legacy_id: "4", reason: "value_out_of_range" },
    ]);
    const audits = await importAudits();
    expect(audits.map((a) => [a["action"], a["code"]])).toEqual([
      ["CREATE", "F-0001"],
      ["CREATE", "F-0002"],
      ["CREATE", "OP-1"],
    ]);
    for (const a of audits) {
      expect(a).toMatchObject({ resource_type: "ClientFacility", tenant_id: PROVIDER, own_facility: true, user_id: null, actor_type: "system" });
      expect(a["changes"]).toEqual({ operation: "UPSTREAM_IMPORT", source: "skp_ipm", importRunId: RUN_1, sourceTable: "mst_faskes", targetTable: "client_facilities" });
    }
  });

  it("the same values again (a second run): every facility unchanged, nothing written, no audit row", async () => {
    await stage(RUN_2);
    const summary = await transform(RUN_2);
    expect(summary.steps[0]?.sources[0]).toMatchObject({ staged: 6, mapped: 0, unchanged: 4 });
    expect((await facilities()).map((f) => f["code"])).toEqual(["F-0001", "F-0002", "OP-1", "SELF"]);
    expect(await importAudits()).toHaveLength(3);
  });

  it("a renamed facility updates its row (code kept) and writes one UPDATE audit row", async () => {
    await stage(RUN_3, { 5: "Puskesmas   Sintetis Tiga Baru" });
    const summary = await transform(RUN_3);
    expect(summary.steps[0]?.sources[0]).toMatchObject({ staged: 6, mapped: 1, unchanged: 3 });
    expect((await facilities()).find((f) => f["legacy_id"] === 5)).toMatchObject({ name: "Puskesmas Sintetis Tiga Baru", code: "F-0002" });
    const audits = await importAudits();
    expect(audits.slice(3).map((a) => [a["action"], a["code"], (a["changes"] as Row)["importRunId"]])).toEqual([["UPDATE", "F-0002", RUN_3]]);
  });

  it("a second provider tenant is refused PROVIDER_TENANT_INVALID; a failed transform rolls its facilities and audit rows back", async () => {
    await stage(RUN_4);
    await expect(transform(RUN_4, SECOND)).rejects.toMatchObject({ code: "PROVIDER_TENANT_INVALID" });
    const auditsBefore = (await importAudits()).length;
    await asImport(`UPDATE upstream_import.stg_mst_faskes SET name_faskes = 'Fasilitas Sintetis Baru Empat' WHERE import_run_id = '${RUN_4}' AND id = 3`);
    await asImport(`INSERT INTO upstream_import.stg_trx_inventory (import_run_id, source_row_number, id, id_client) VALUES ('${RUN_4}', 99, 199, 3)`);
    const leaveOne: TransformStep = { id: "leaves_one", writes: ["calibration_devices"], sources: [{ table: "trx_inventory", legacyId: 's."id"::text' }], run: () => Promise.resolve() };
    const [facilitiesStep, , audit] = steps();
    // The audit step runs BEFORE the failing one here, so its rows are written — and rolled back.
    await expect(transform(RUN_4, PROVIDER, [facilitiesStep as TransformStep, audit as TransformStep, leaveOne])).rejects.toMatchObject({
      code: "TRANSFORM_INCOMPLETE",
    });
    expect((await facilities()).map((f) => f["code"])).toEqual(["F-0001", "F-0002", "OP-1", "SELF"]);
    expect(await importAudits()).toHaveLength(auditsBefore);
  });
});

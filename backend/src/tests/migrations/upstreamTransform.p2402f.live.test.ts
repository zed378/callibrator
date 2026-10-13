/**
 * P24-02f (ADR-129 Am. 8) — the transform's calibrations step on a REAL PostgreSQL 18, on the
 * transform role's own connection, after the facilities, users, device-type and register steps:
 *
 *  - migration 0140: down / up / up rebuilds the same column grants and reasons; the transform role
 *    cannot read an API key's hash, nor change an imported record beyond closing it;
 *  - without a usable import key, a row with no resolvable person fails the transform
 *    `IMPORT_KEY_MISSING` and nothing is written; with it: the person, a numbered former user and
 *    "Upstream import" as performers (the key the actor of the last two), `external_date` at 00:00 in
 *    the source zone, the device's facility, no laboratory; `no_device` and `future_calibration_date`
 *    quarantined; CREATE audit rows with the facility;
 *  - a re-run writes nothing; a changed date is a correction: a new record supersedes the old one,
 *    which is closed — the append-only trigger accepts exactly that.
 *
 * Synthetic values only; nothing from upstream.
 *
 *   docker run -d --name p2402-pg18 -e POSTGRES_PASSWORD=p2402pass -p 127.0.0.1:56240:5432 pgvector/pgvector:pg18
 *   DB_HOST=127.0.0.1 DB_PORT=56240 DB_USER=postgres DB_PASS=p2402pass npm run test:live -- --only=p2402f
 *   docker rm -f p2402-pg18
 */
import type { Transaction } from "sequelize";
import { env } from "../../config/env";
import type { TransformStep } from "../../services/upstreamImport/transform/steps";
import type * as StepsModule from "../../services/upstreamImport/transform/steps";
import type * as RunnerModule from "../../services/upstreamImport/transform/runner";
import type * as ConfigModule from "../../config/upstreamImport";

const IMPORT_ROLE = "callibrator_import";
const TRANSFORM_ROLE = "callibrator_transform";
const PROVIDER = "a2402000-0000-4000-8000-0000000000a7";
const SELF = "a2402000-0000-4000-8000-0000000000a8";
const KEY = "a2402000-0000-4000-8000-0000000000b9";
const ZONE = "Asia/Jakarta";
const RUN_1 = "a2402000-0000-4000-8000-0000000000ea";
const RUN_2 = "a2402000-0000-4000-8000-0000000000eb";
const RUN_3 = "a2402000-0000-4000-8000-0000000000ec";

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
  runner: require("../../services/upstreamImport/transform/runner") as typeof RunnerModule,
  config: require("../../config/upstreamImport") as typeof ConfigModule,
  m0140: require("../../migrations/0140-upstream-transform-calibrations") as Migration,
});
/* eslint-enable @typescript-eslint/no-require-imports */

/** [id, id_client, id_alat, id_user, no_qrcode, nama_alat] */
const DEVICES: readonly (readonly (string | number | null)[])[] = [
  [101, 1, 1, 7, "QR-F101", "Pompa Sintetis"],
  [102, 2, 1, null, "QR-F102", "Monitor Sintetis"],
];

/** [id, id_inventory, id_user, nama_ruangan, tanggal_kalibrasi, created_at] */
const CALIBRATIONS: readonly (readonly (string | number | null)[])[] = [
  [1, 101, 7, "ICU", "2025-04-01", "2025-04-02 10:00:00"],
  [2, 101, 99, null, "2025-05-01", null],
  [3, 102, null, " IGD ", "2025-06-01", null],
  [4, 999, 7, null, "2025-06-02", null],
  [5, 101, 7, null, "2099-01-01", null],
];

describe("P24-02f — the calibrations step on live PostgreSQL 18, as the transform role", () => {
  jest.setTimeout(300_000);
  let g: ReturnType<typeof load>;
  let transformDb: LiveDb;

  const rows = async (sql: string): Promise<Row[]> => (await g.db.query(sql))[0];

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

  const asImport = async (...statements: string[]): Promise<void> => {
    const t = await g.db.transaction();
    await g.db.query(`SET LOCAL ROLE ${IMPORT_ROLE}`, { transaction: t });
    for (const statement of statements) {
      await g.db.query(statement, { transaction: t });
    }
    await t.commit();
  };

  const lit = (value: string | number | null): string => (value === null ? "NULL" : typeof value === "number" ? String(value) : `'${value.replace(/'/g, "''")}'`);
  const values = (run: string, list: readonly (readonly (string | number | null)[])[]): string =>
    list.map((r, i) => `('${run}', ${String(i + 1)}, ${r.map(lit).join(", ")})`).join(", ");

  /** Stage the synthetic world for `run`; `moved` gives calibration 1 another date. */
  const stage = (run: string, moved: string | null = null): Promise<void> =>
    asImport(
      `INSERT INTO upstream_import.stg_mst_faskes (import_run_id, source_row_number, id, name_faskes) VALUES ${values(run, [[1, "RS Sintetis Satu"], [2, "Klinik Sintetis Dua"]])}`,
      `INSERT INTO upstream_import.stg_auth_groups (import_run_id, source_row_number, id, name, description) VALUES ${values(run, [[1, "admin", null]])}`,
      `INSERT INTO upstream_import.stg_users (import_run_id, source_row_number, id, email, username, fullname, active, created_at, updated_at) VALUES
         ${values(run, [[7, "teknisi.f@example.test", "teknisif", "Teknisi Sintetis", 1, "2023-06-01 09:00:00", null]])}`,
      `INSERT INTO upstream_import.stg_auth_groups_users (import_run_id, source_row_number, group_id, user_id) VALUES ${values(run, [[1, 7]])}`,
      `INSERT INTO upstream_import.stg_mst_alat (import_run_id, source_row_number, id, nama_alat) VALUES ${values(run, [[1, "Pompa Infus"]])}`,
      `INSERT INTO upstream_import.stg_trx_inventory (import_run_id, source_row_number, id, id_client, id_alat, id_user, no_qrcode, nama_alat) VALUES ${values(run, DEVICES)}`,
      `INSERT INTO upstream_import.stg_trx_kalibrasi (import_run_id, source_row_number, id, id_inventory, id_user, nama_ruangan, tanggal_kalibrasi, created_at) VALUES
         ${values(run, CALIBRATIONS.map((c) => (moved !== null && c[0] === 1 ? [...c.slice(0, 4), moved, c[5] ?? null] : c)))}`,
    );

  const steps = (): TransformStep[] =>
    ["client_facilities", "users", "device_types", "vendors", "warehouses", "calibration_devices", "calibration_records", "audit_logs"].map(
      (id) => g.steps.TRANSFORM_STEPS.find((s) => s.id === id) as TransformStep,
    );

  const transform = (runId: string) =>
    g.runner.runTransform({ runId, db: transformDb, runner: transformDb, role: TRANSFORM_ROLE, tenantId: PROVIDER, sourceZone: ZONE, steps: steps() });

  const recordAudits = (): Promise<Row[]> =>
    rows(
      `SELECT action::text AS action, changes ->> 'operation' AS operation, count(*)::int AS n, bool_and(client_facility_id IS NOT NULL) AS facility
         FROM audit_logs WHERE actor_name = 'system:upstream-transform' AND resource_type = 'CalibrationRecord' GROUP BY 1, 2 ORDER BY 1, 2`,
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
    await g.db.query(`INSERT INTO tenants (id, name, subdomain, email, created_at, updated_at) VALUES ('${PROVIDER}', 'Penyedia Sintetis F', 'p2402f', 'p@example.test', now(), now())`);
    await g.db.query(`INSERT INTO client_facilities (id, tenant_id, name, code, is_self, created_at, updated_at) VALUES ('${SELF}', '${PROVIDER}', 'Penyedia Sintetis F', 'SELF', true, now(), now())`);
    // The roles P18-01 assigns (the application's seed makes them; a migrated scratch database has none).
    await g.db.query(
      `INSERT INTO roles (id, name, created_at, updated_at)
       SELECT gen_random_uuid(), n, now(), now()
         FROM unnest(ARRAY['CALIBRATOR ADMIN', 'TECHNICIAN', 'ROOM USER', 'HEALTHCARE TECHNICIAN', 'HEALTHCARE ADMIN']) AS n
        WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.name = n)`,
    );
    const common = "import_run_id uuid NOT NULL, source_row_number bigint NOT NULL";
    const pk = "PRIMARY KEY (import_run_id, source_row_number)";
    await asImport(
      `CREATE TABLE IF NOT EXISTS upstream_import.stg_mst_faskes (${common}, id integer, name_faskes varchar(255), phone varchar(50), address varchar(255),
         created_at timestamp, updated_at timestamp, ${pk})`,
      `CREATE TABLE IF NOT EXISTS upstream_import.stg_auth_groups (${common}, id integer, name varchar(255), description varchar(255), ${pk})`,
      `CREATE TABLE IF NOT EXISTS upstream_import.stg_users (${common}, id integer, email varchar(255), username varchar(30), fullname varchar(50), active smallint,
         created_at timestamp, updated_at timestamp, ${pk})`,
      `CREATE TABLE IF NOT EXISTS upstream_import.stg_auth_groups_users (${common}, group_id integer, user_id integer, ${pk})`,
      `CREATE TABLE IF NOT EXISTS upstream_import.stg_mst_alat (${common}, id integer, nama_alat varchar(255), ${pk})`,
      `CREATE TABLE IF NOT EXISTS upstream_import.stg_trx_inventory (${common}, id integer, id_client integer, id_alat integer, id_user integer,
         no_qrcode varchar(255), nama_alat varchar(255), ${pk})`,
      `CREATE TABLE IF NOT EXISTS upstream_import.stg_trx_kalibrasi (${common}, id integer, id_inventory integer, id_user integer, nama_ruangan varchar(255),
         tanggal_kalibrasi date, created_at timestamp, updated_at timestamp, ${pk})`,
    );
    transformDb = g.config.createTransformDb() as unknown as LiveDb;
  });

  afterAll(async () => {
    await transformDb.close();
    await g.db.close();
  });

  it("0140: down / up / up rebuilds the same grants and reasons; no key hash, and an imported record can only be closed", async () => {
    const objects = (): Promise<Row[]> =>
      rows(
        `SELECT table_name || '.' || column_name || ':' || privilege_type AS o FROM information_schema.column_privileges
          WHERE grantee = '${TRANSFORM_ROLE}' AND table_name IN ('calibration_records', 'api_keys')
         UNION ALL SELECT 'c:' || pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'quarantine_reason_vocabulary'
         ORDER BY 1`,
      );
    const before = await objects();
    const list = before.map((r) => String(r["o"]));
    expect(list.filter((o) => o.endsWith(":UPDATE"))).toEqual([
      "calibration_records.superseded_at:UPDATE",
      "calibration_records.superseded_by_id:UPDATE",
      "calibration_records.updated_at:UPDATE",
    ]);
    expect(list.find((o) => o.startsWith("c:"))).toContain("'performer_not_found'");
    await g.m0140.down({ context: g.db.getQueryInterface() });
    await g.m0140.up({ context: g.db.getQueryInterface() });
    await g.m0140.up({ context: g.db.getQueryInterface() });
    expect(await objects()).toEqual(before);
    expect(await errorAs(TRANSFORM_ROLE, "SELECT key_hash FROM api_keys")).toMatch(/^42501/);
    expect(await errorAs(TRANSFORM_ROLE, "UPDATE calibration_records SET notes = 'x' WHERE false")).toMatch(/^42501/);
    expect(await errorAs(TRANSFORM_ROLE, "DELETE FROM calibration_records WHERE false")).toMatch(/^42501/);
  });

  it("without a usable import key the transform fails IMPORT_KEY_MISSING and writes nothing", async () => {
    await stage(RUN_1);
    await expect(transform(RUN_1)).rejects.toMatchObject({ code: "IMPORT_KEY_MISSING" });
    expect(await rows(`SELECT count(*)::int AS n FROM calibration_devices WHERE tenant_id = '${PROVIDER}'`)).toEqual([{ n: 0 }]);
  });

  it("with the key: three external dates — the person, a former user and the import — the rest quarantined, audited", async () => {
    await g.db.query(
      `INSERT INTO api_keys (id, tenant_id, name, key_prefix, key_hash, scopes, is_active, expires_at, is_deleted, created_at, updated_at)
       VALUES ('${KEY}', '${PROVIDER}', 'upstream-import', 'cal_imp', repeat('a', 64), '["calibration:write"]'::jsonb, true, now() + interval '30 days', false, now(), now())`,
    );
    const summary = await transform(RUN_1);
    expect(summary.steps.find((s) => s.step === "calibration_records")?.sources).toEqual([
      { table: "trx_kalibrasi", staged: 5, mapped: 3, unchanged: 0, quarantined: { future_calibration_date: 1, no_device: 1 } },
    ]);
    const records = await rows(
      `SELECT d.qr_code, r.entry_kind::text AS kind, (r.calibration_date AT TIME ZONE 'UTC')::text AS at_utc, r.room_snapshot AS room,
              r.performed_by IS NOT NULL AS person, r.api_key_id::text AS key, r.performer_snapshot AS snapshot,
              r.client_facility_id = d.client_facility_id AS same_facility, r.external_lab_name AS lab, r.results, (r.created_at AT TIME ZONE 'UTC')::text AS created
         FROM calibration_records r JOIN calibration_devices d ON d.id = r.device_id
        WHERE r.tenant_id = '${PROVIDER}' ORDER BY r.calibration_date`,
    );
    expect(records).toEqual([
      {
        qr_code: "QR-F101", kind: "external_date", at_utc: "2025-03-31 17:00:00", room: "ICU", person: true, key: null,
        snapshot: expect.objectContaining({ name: "Teknisi Sintetis", source: "upstream-import" }) as unknown, same_facility: true, lab: null, results: null,
        created: "2025-04-02 03:00:00",
      },
      {
        qr_code: "QR-F101", kind: "external_date", at_utc: "2025-04-30 17:00:00", room: null, person: false, key: KEY,
        snapshot: { name: "Former upstream user #1", role: null, organisation: null, source: "upstream-import" }, same_facility: true, lab: null, results: null,
        created: "2025-04-30 17:00:00",
      },
      {
        qr_code: "QR-F102", kind: "external_date", at_utc: "2025-05-31 17:00:00", room: "IGD", person: false, key: KEY,
        snapshot: { name: "Upstream import", role: "import", organisation: "Penyedia Sintetis F", source: "upstream-import" }, same_facility: true, lab: null,
        results: null, created: "2025-05-31 17:00:00",
      },
    ]);
    expect(await recordAudits()).toEqual([{ action: "CREATE", operation: "UPSTREAM_IMPORT", n: 3, facility: true }]);
  });

  it("the same values again write nothing; a changed date is a correction that closes the record it supersedes", async () => {
    await stage(RUN_2);
    const again = await transform(RUN_2);
    expect(again.steps.find((s) => s.step === "calibration_records")?.sources[0]).toMatchObject({ mapped: 0, unchanged: 3 });
    expect(await recordAudits()).toEqual([{ action: "CREATE", operation: "UPSTREAM_IMPORT", n: 3, facility: true }]);

    await stage(RUN_3, "2025-04-03");
    await transform(RUN_3);
    const chain = await rows(
      `SELECT (r.calibration_date AT TIME ZONE '${ZONE}')::date::text AS day, r.supersedes_id IS NOT NULL AS corrects, r.superseded_by_id IS NOT NULL AS closed,
              r.correction_reason IS NOT NULL AS reason
         FROM calibration_records r JOIN calibration_devices d ON d.id = r.device_id
        WHERE d.qr_code = 'QR-F101' AND r.performed_by IS NOT NULL ORDER BY r.created_at, r.calibration_date`,
    );
    expect(chain).toEqual([
      { day: "2025-04-01", corrects: false, closed: true, reason: false },
      { day: "2025-04-03", corrects: true, closed: false, reason: true },
    ]);
    const [mapping] = await rows(
      `SELECT r.supersedes_id IS NOT NULL AS corrects FROM upstream_import.id_map m JOIN calibration_records r ON r.id = m.target_id
        WHERE m.source_table = 'trx_kalibrasi' AND m.legacy_id = '1'`,
    );
    expect(mapping).toEqual({ corrects: true });
    expect(await recordAudits()).toEqual([
      { action: "CREATE", operation: "UPSTREAM_IMPORT", n: 3, facility: true },
      { action: "CREATE", operation: "UPSTREAM_IMPORT_CORRECTION", n: 1, facility: true },
      { action: "UPDATE", operation: "UPSTREAM_IMPORT_SUPERSEDED", n: 1, facility: true },
    ]);
  });
});

/**
 * P24-02e (ADR-129 Am. 7) — the transform's register steps on a REAL PostgreSQL 18, on the
 * transform role's own connection, after the facilities, users and device-type steps:
 *
 *  - migration 0139: down / up / up rebuilds the same column grants, table and reasons; the transform
 *    role cannot read a device's IoT token hash, and the application role cannot read `former_users`;
 *  - laboratories: one per distinct name, an existing one adopted; rooms: one per (facility, room,
 *    floor), `R-0001…`; both audited CREATE under the provider tenant (rooms with their facility);
 *  - devices: QR normalised with the tenant's prefix, condition / status / accessories / inventory
 *    date by P19-03 § 10, a facility-duplicate serial and a placeholder NULL, the registrant's snapshot
 *    (an imported user, a numbered former user), the upstream creation time in the source zone;
 *    `facility_not_imported`, `qr_case_collision`, `qr_in_use`, `value_out_of_range` quarantined;
 *  - a re-run of the same values writes nothing; a renamed device is updated with one UPDATE row.
 *
 * Synthetic values only; nothing from upstream.
 *
 *   docker run -d --name p2402-pg18 -e POSTGRES_PASSWORD=p2402pass -p 127.0.0.1:56240:5432 pgvector/pgvector:pg18
 *   DB_HOST=127.0.0.1 DB_PORT=56240 DB_USER=postgres DB_PASS=p2402pass npm run test:live -- --only=p2402e
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
const APP_ROLE = "callibrator_app";
const PROVIDER = "a2402000-0000-4000-8000-0000000000a5";
const SELF = "a2402000-0000-4000-8000-0000000000a6";
const OPERATOR_DEVICE = "a2402000-0000-4000-8000-0000000000b7";
const ADOPTED_LAB = "a2402000-0000-4000-8000-0000000000b8";
const RUN_1 = "a2402000-0000-4000-8000-0000000000e7";
const RUN_2 = "a2402000-0000-4000-8000-0000000000e8";
const RUN_3 = "a2402000-0000-4000-8000-0000000000e9";

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
  m0139: require("../../migrations/0139-upstream-transform-register") as Migration,
});
/* eslint-enable @typescript-eslint/no-require-imports */

/** [id, id_client, id_alat, id_user, no_qrcode, nama_alat, merk, type, sn, nama_ruangan, lantai, kondisi_alat, lab_kalibrasi, aksesoris, tgl_inventory, tgl_kalibrasi, created_at] */
type DeviceRow = readonly (string | number | null)[];
const DEVICES: readonly DeviceRow[] = [
  [101, 1, 1, 7, "qr-a001", "Pompa Sintetis Satu", "Merk Sintetis", "T-1", "SN-0001", "ICU", "2", "Baik", "Lab Sintetis", "Ada", "2024-01-05", "2025-04-01", "2024-01-05 08:00:00"],
  [102, 1, 1, 99, "QR-A002", "Pompa Sintetis Dua", null, null, "SN-0001", " icu ", "2", "Laik", "lab  sintetis", "Tidak", "1985-01-01", null, null],
  [103, 2, 2, null, "42", "Monitor Sintetis", null, null, "-", "IGD", null, "Rusak", "Lab Lain", null, "2024-02-01", null, null],
  [104, 1, 1, 7, "QR-a001", "Salinan Kasus", null, null, null, null, null, "Baik", null, null, null, null, null],
  [105, 9, 1, 7, "QR-A005", "Fasilitas Hilang", null, null, null, null, null, "Baik", null, null, null, null, null],
  [106, 1, 1, 7, "QR-OPER", "Stiker Operator", null, null, null, null, null, "Baik", null, null, null, null, null],
  [107, 1, 1, 7, "QR-A007", "   ", null, null, null, null, null, "Baik", null, null, null, null, null],
];

describe("P24-02e — the register steps on live PostgreSQL 18, as the transform role", () => {
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

  /** Stage the synthetic world for `run`; `rename` renames device 101 and moves device 103 to facility 1. */
  const stage = (run: string, rename: string | null = null): Promise<void> =>
    asImport(
      `INSERT INTO upstream_import.stg_mst_faskes (import_run_id, source_row_number, id, name_faskes) VALUES
         ${values(run, [[1, "RS Sintetis Satu"], [2, "Klinik Sintetis Dua"]])}`,
      `INSERT INTO upstream_import.stg_auth_groups (import_run_id, source_row_number, id, name, description) VALUES ${values(run, [[1, "admin", null]])}`,
      `INSERT INTO upstream_import.stg_users (import_run_id, source_row_number, id, email, username, fullname, active, created_at, updated_at) VALUES
         ${values(run, [[7, "teknisi.sintetis@example.test", "teknisi", "Teknisi Sintetis", 1, "2023-06-01 09:00:00", null]])}`,
      `INSERT INTO upstream_import.stg_auth_groups_users (import_run_id, source_row_number, group_id, user_id) VALUES ${values(run, [[1, 7]])}`,
      `INSERT INTO upstream_import.stg_mst_alat (import_run_id, source_row_number, id, nama_alat) VALUES ${values(run, [[1, "Pompa Infus"], [2, "Monitor Pasien"]])}`,
      `INSERT INTO upstream_import.stg_trx_inventory (import_run_id, source_row_number, id, id_client, id_alat, id_user, no_qrcode, nama_alat, merk, type, sn,
         nama_ruangan, lantai, kondisi_alat, lab_kalibrasi, aksesoris, tgl_inventory, tgl_kalibrasi, created_at) VALUES
         ${values(
    run,
    DEVICES.map((d) => (rename === null ? d : d[0] === 101 ? [...d.slice(0, 5), rename, ...d.slice(6)] : d[0] === 103 ? [d[0], 1, ...d.slice(2)] : d)),
  )}`,
    );

  const steps = (): TransformStep[] =>
    ["client_facilities", "users", "device_types", "vendors", "warehouses", "calibration_devices", "audit_logs"].map(
      (id) => g.steps.TRANSFORM_STEPS.find((s) => s.id === id) as TransformStep,
    );

  const transform = (runId: string) =>
    g.runner.runTransform({ runId, db: transformDb, runner: transformDb, role: TRANSFORM_ROLE, tenantId: PROVIDER, sourceZone: "UTC", steps: steps() });

  const registerAudits = (): Promise<Row[]> =>
    rows(
      `SELECT resource_type, action::text AS action, count(*)::int AS n, bool_and(tenant_id = '${PROVIDER}') AS provider
         FROM audit_logs WHERE actor_name = 'system:upstream-transform' AND resource_type IN ('Vendor', 'Warehouse', 'CalibrationDevice')
        GROUP BY 1, 2 ORDER BY 1, 2`,
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
    await g.db.query(`INSERT INTO tenants (id, name, subdomain, email, created_at, updated_at) VALUES ('${PROVIDER}', 'Penyedia Sintetis', 'p2402e', 'p@example.test', now(), now())`);
    await g.db.query(`INSERT INTO client_facilities (id, tenant_id, name, code, is_self, created_at, updated_at) VALUES ('${SELF}', '${PROVIDER}', 'Penyedia Sintetis', 'SELF', true, now(), now())`);
    await g.db.query(
      `INSERT INTO tenant_settings (id, tenant_id, key, value, created_at, updated_at) VALUES (gen_random_uuid(), '${PROVIDER}', 'device_qr_code_prefix', 'TST', now(), now())`,
    );
    // The roles P18-01 assigns (the application's seed makes them; a migrated scratch database has none).
    await g.db.query(
      `INSERT INTO roles (id, name, created_at, updated_at)
       SELECT gen_random_uuid(), n, now(), now()
         FROM unnest(ARRAY['CALIBRATOR ADMIN', 'TECHNICIAN', 'ROOM USER', 'HEALTHCARE TECHNICIAN', 'HEALTHCARE ADMIN']) AS n
        WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.name = n)`,
    );
    // The operator's own device already wears QR-OPER; a laboratory already in the register.
    await g.db.query(
      `INSERT INTO calibration_devices (id, tenant_id, client_facility_id, name, qr_code, status, iot_enabled, is_deleted, created_at, updated_at)
       VALUES ('${OPERATOR_DEVICE}', '${PROVIDER}', '${SELF}', 'Alat Operator', 'QR-OPER', 'active', false, false, now(), now())`,
    );
    await g.db.query(
      `INSERT INTO vendors (id, tenant_id, name, type, approval_status, status, created_at, updated_at) VALUES ('${ADOPTED_LAB}', '${PROVIDER}', 'Lab Lain', 'CalibrationLab', 'APPROVED', 'Active', now(), now())`,
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
         no_qrcode varchar(255), nama_alat varchar(255), merk varchar(255), type varchar(255), sn varchar(255), nama_ruangan varchar(255), lantai varchar(255),
         kondisi_alat varchar(255), lab_kalibrasi varchar(255), aksesoris varchar(5), tgl_inventory date, tgl_kalibrasi date, created_at timestamp, updated_at timestamp, ${pk})`,
    );
    transformDb = g.config.createTransformDb() as unknown as LiveDb;
  });

  afterAll(async () => {
    await transformDb.close();
    await g.db.close();
  });

  it("0139: down / up / up rebuilds the same grants, table and reasons; no token hash for the transform, no former_users for the app", async () => {
    const objects = (): Promise<Row[]> =>
      rows(
        `SELECT table_name || '.' || column_name || ':' || privilege_type AS o FROM information_schema.column_privileges
          WHERE grantee = '${TRANSFORM_ROLE}' AND table_name IN ('vendors', 'warehouses', 'calibration_devices', 'tenant_settings', 'tenants')
         UNION ALL SELECT 't:' || privilege_type FROM information_schema.role_table_grants WHERE grantee = '${TRANSFORM_ROLE}' AND table_name = 'former_users'
         UNION ALL SELECT 'c:' || pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'quarantine_reason_vocabulary'
         ORDER BY 1`,
      );
    const before = await objects();
    const list = before.map((r) => String(r["o"]));
    expect(list).toContain("calibration_devices.qr_code:UPDATE");
    expect(list).toContain("t:INSERT");
    expect(list.filter((o) => o.includes("iot_token"))).toEqual([]);
    expect(list.find((o) => o.startsWith("c:"))).toContain("'qr_in_use'");
    expect(list).not.toContain("calibration_devices.client_facility_id:UPDATE");
    await g.m0139.down({ context: g.db.getQueryInterface() });
    await g.m0139.up({ context: g.db.getQueryInterface() });
    await g.m0139.up({ context: g.db.getQueryInterface() });
    expect(await objects()).toEqual(before);
    expect(await errorAs(TRANSFORM_ROLE, "SELECT iot_token_hash FROM calibration_devices")).toMatch(/^42501/);
    expect(await errorAs(TRANSFORM_ROLE, "DELETE FROM calibration_devices WHERE false")).toMatch(/^42501/);
    expect(await errorAs(APP_ROLE, "SELECT 1 FROM upstream_import.former_users")).toMatch(/^42501/);
  });

  it("the first transform: laboratories, rooms and devices by P19-03 § 10; the rest quarantined; audited", async () => {
    await stage(RUN_1);
    const summary = await transform(RUN_1);
    expect(summary.steps.find((s) => s.step === "calibration_devices")?.sources).toEqual([
      {
        table: "trx_inventory",
        staged: 7,
        mapped: 3,
        unchanged: 0,
        quarantined: { facility_not_imported: 1, qr_case_collision: 1, qr_in_use: 1, value_out_of_range: 1 },
      },
    ]);
    expect(await rows(`SELECT name, approval_status::text AS approval FROM vendors WHERE tenant_id = '${PROVIDER}' ORDER BY name`)).toEqual([
      { name: "Lab Lain", approval: "APPROVED" },
      { name: "Lab Sintetis", approval: "PENDING" },
    ]);
    expect(
      await rows(
        `SELECT w.name, w.floor, w.code, w.kind::text AS kind, f.name AS facility FROM warehouses w JOIN client_facilities f ON f.id = w.client_facility_id
          WHERE w.tenant_id = '${PROVIDER}' ORDER BY w.code`,
      ),
    ).toEqual([
      { name: "ICU", floor: "2", code: "R-0001", kind: "room", facility: "RS Sintetis Satu" },
      { name: "IGD", floor: null, code: "R-0002", kind: "room", facility: "Klinik Sintetis Dua" },
    ]);
    const devices = await rows(
      `SELECT d.qr_code, d.name, d.serial_number AS serial, d.status::text AS status, d."condition"::text AS condition, d.condition_source::text AS source,
              d.accessories_complete AS accessories, d.inventoried_on::text AS inventoried, d.category, w.name AS room, v.name AS lab, f.name AS facility,
              d.created_by IS NOT NULL AS has_creator, d.registrant_snapshot AS registrant, (d.created_at AT TIME ZONE 'UTC')::text AS created
         FROM calibration_devices d JOIN client_facilities f ON f.id = d.client_facility_id
         LEFT JOIN warehouses w ON w.id = d.location_id LEFT JOIN vendors v ON v.id = d.calibration_vendor_id
        WHERE d.tenant_id = '${PROVIDER}' AND d.id <> '${OPERATOR_DEVICE}' ORDER BY d.qr_code`,
    );
    expect(devices).toEqual([
      {
        qr_code: "QR-A001", name: "Pompa Sintetis Satu", serial: "SN-0001", status: "active", condition: "good", source: "import", accessories: true,
        inventoried: "2024-01-05", category: "Pompa Infus", room: "ICU", lab: "Lab Sintetis", facility: "RS Sintetis Satu", has_creator: true,
        registrant: expect.objectContaining({ name: "Teknisi Sintetis", organisation: "Penyedia Sintetis" }) as unknown, created: "2024-01-05 08:00:00",
      },
      {
        qr_code: "QR-A002", name: "Pompa Sintetis Dua", serial: null, status: "active", condition: "good", source: "import", accessories: false,
        inventoried: null, category: "Pompa Infus", room: "ICU", lab: "Lab Sintetis", facility: "RS Sintetis Satu", has_creator: false,
        registrant: { name: "Former upstream user #1", role: null, organisation: null }, created: expect.any(String) as unknown,
      },
      {
        qr_code: "TST000042", name: "Monitor Sintetis", serial: null, status: "inactive", condition: "broken", source: "import", accessories: null,
        inventoried: "2024-02-01", category: "Monitor Pasien", room: "IGD", lab: "Lab Lain", facility: "Klinik Sintetis Dua", has_creator: false,
        registrant: null, created: "2024-02-01 00:00:00",
      },
    ]);
    const [dup] = await rows("SELECT source_values, client_facility_id IS NOT NULL AS facility FROM upstream_import.id_map WHERE source_table = 'trx_inventory' AND legacy_id = '102'");
    expect(dup).toEqual({ source_values: { sn: "SN-0001", kondisi_alat: "Laik", tgl_inventory: "1985-01-01" }, facility: true });
    expect(await rows("SELECT legacy_user_id, number FROM upstream_import.former_users")).toEqual([{ legacy_user_id: "99", number: 1 }]);
    expect(await registerAudits()).toEqual([
      { resource_type: "CalibrationDevice", action: "CREATE", n: 3, provider: true },
      { resource_type: "Vendor", action: "CREATE", n: 1, provider: true },
      { resource_type: "Warehouse", action: "CREATE", n: 2, provider: true },
    ]);
    const [facilityStamp] = await rows(
      `SELECT bool_and(a.client_facility_id = d.client_facility_id) AS same FROM audit_logs a JOIN calibration_devices d ON d.id = a.resource_id::uuid
        WHERE a.resource_type = 'CalibrationDevice' AND a.actor_name = 'system:upstream-transform'`,
    );
    expect(facilityStamp).toEqual({ same: true });
  });

  it("the same values again write nothing; a renamed device is updated and audited once; a device moved upstream is not moved", async () => {
    const before = await registerAudits();
    await stage(RUN_2);
    const again = await transform(RUN_2);
    expect(again.steps.find((s) => s.step === "calibration_devices")?.sources[0]).toMatchObject({ mapped: 0, unchanged: 3 });
    expect(await registerAudits()).toEqual(before);
    await stage(RUN_3, "Pompa Sintetis Satu Baru");
    const third = await transform(RUN_3);
    expect(third.steps.find((s) => s.step === "calibration_devices")?.sources[0]?.quarantined).toMatchObject({ facility_changed: 1 });
    expect(
      await rows("SELECT f.name FROM calibration_devices d JOIN client_facilities f ON f.id = d.client_facility_id WHERE d.qr_code = 'TST000042'"),
    ).toEqual([{ name: "Klinik Sintetis Dua" }]);
    expect(await rows(`SELECT name FROM calibration_devices WHERE qr_code = 'QR-A001' AND tenant_id = '${PROVIDER}'`)).toEqual([{ name: "Pompa Sintetis Satu Baru" }]);
    expect(await registerAudits()).toEqual([
      { resource_type: "CalibrationDevice", action: "CREATE", n: 3, provider: true },
      { resource_type: "CalibrationDevice", action: "UPDATE", n: 1, provider: true },
      { resource_type: "Vendor", action: "CREATE", n: 1, provider: true },
      { resource_type: "Warehouse", action: "CREATE", n: 2, provider: true },
    ]);
  });
});

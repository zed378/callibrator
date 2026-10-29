/**
 * Migration 0148 on live PostgreSQL 18 — the device register's trigram GIN:
 *  - the boot's migrations build it, VALID, with the definition 0148 states (and the boot's sync parses it);
 *  - it SERVES each of the register's three leading-wildcard ILIKEs (asked with the plain index and
 *    sequential scans off: WHICH path the planner takes for a term depends on the data and ANALYZE's
 *    sample, so that is measured on the real dump's volume — the migration's header — not pinned here);
 *  - the register's `find=` answers exactly as before: the matching devices of the caller's tenant only,
 *    by name, serial or manufacturer, case-insensitive — never another tenant's.
 *
 *   docker run -d --name t0148-pg18 -e POSTGRES_PASSWORD=t0148pass -p 127.0.0.1:55432:5432 pgvector/pgvector:pg18
 *   DB_HOST=127.0.0.1 DB_PORT=55432 DB_USER=postgres DB_PASS=t0148pass npm run test:live -- --only=t0148
 *   docker rm -f t0148-pg18
 */
import { env } from "../../config/env";

const TENANT_A = "a0148000-0000-4000-8000-0000000000a1";
const TENANT_B = "a0148000-0000-4000-8000-0000000000b1";
const FACILITY_A = "a0148000-0000-4000-8000-0000000000a2";
const FACILITY_B = "a0148000-0000-4000-8000-0000000000b2";
const DEVICES = 5000;
const INDEX = "calibration_devices_tenant_id_text_trgm";

type Row = Record<string, unknown>;
interface LiveDb {
  options: { logging: unknown };
  query(sql: string, options?: object): Promise<[Row[], unknown]>;
  transaction<T>(fn: (t: unknown) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
interface DevicePage {
  data: { rows: { name: string; serialNumber: string | null }[]; meta: { total: number } } | null;
}

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

/* eslint-disable @typescript-eslint/no-require-imports -- the graph is loaded after the environment is set; typed by the members used */
const load = () => ({
  db: (require("../../config") as { db: LiveDb }).db,
  models: require("../../models") as unknown,
  migrator: (require("../../config/migrator") as { migrator: { pending(): Promise<unknown[]> } }).migrator,
  migrationLock: require("../../utils/migrationLock.util") as { runSchemaSetup(options: object): Promise<unknown> },
  tenantStorage: (require("../../middlewares/tenantContext.middleware") as { tenantStorage: { run<T>(ctx: object, fn: () => T): T } }).tenantStorage,
  devices: require("../../services/calibrationDevices.service") as {
    fetchCalibrationDevices(query: object): Promise<DevicePage>;
  },
});
/* eslint-enable @typescript-eslint/no-require-imports */

describe("0148 — the device register's trigram GIN on live PostgreSQL 18", () => {
  jest.setTimeout(300_000);
  let g: ReturnType<typeof load>;

  const rows = async (sql: string, bind: unknown[] = []): Promise<Row[]> => (await g.db.query(sql, { bind }))[0];
  /** The plan with only bitmap paths left: what an index can serve, whatever the statistics say. */
  const bitmapPlan = (sql: string, bind: unknown[]): Promise<string> =>
    g.db.transaction(async (transaction) => {
      await g.db.query("SET LOCAL enable_indexscan = off", { transaction });
      await g.db.query("SET LOCAL enable_indexonlyscan = off", { transaction });
      await g.db.query("SET LOCAL enable_seqscan = off", { transaction });
      const [result] = await g.db.query(`EXPLAIN (COSTS OFF) ${sql}`, { bind, transaction });
      return result.map((r) => String(r["QUERY PLAN"])).join("\n");
    });
  const find = (tenantId: string, term: string): Promise<DevicePage> =>
    new Promise((resolve, reject) => {
      g.tenantStorage.run({ tenantId, isSuperAdmin: false, isSystemTask: false, userId: null, facilityBound: false, clientFacilityId: null }, () => {
        g.devices.fetchCalibrationDevices({ tenantId, page: 1, limit: 50, find: term }).then(resolve, reject);
      });
    });

  beforeAll(async () => {
    const name = env("DB_NAME") ?? "";
    if (!name.includes("scratch")) {
      throw new Error(`Refusing to build a schema in DB_NAME="${name}": use a scratch database (see the header)`);
    }
    g = load();
    g.db.options.logging = false;
    await g.migrationLock.runSchemaSetup({ sequelize: g.db, migrator: g.migrator, logger });
    expect(await g.migrator.pending()).toEqual([]);
    for (const [tenant, facility, code] of [
      [TENANT_A, FACILITY_A, "A"],
      [TENANT_B, FACILITY_B, "B"],
    ] as const) {
      await rows("INSERT INTO tenants (id, name, subdomain, email, created_at, updated_at) VALUES ($1, $2, $3, $4, now(), now())", [
        tenant,
        `T0148 ${code}`,
        `t0148-${code.toLowerCase()}`,
        `t0148-${code.toLowerCase()}@example.test`,
      ]);
      await rows("INSERT INTO client_facilities (id, tenant_id, code, name, created_at, updated_at) VALUES ($1, $2, $3, $4, now(), now())", [
        facility,
        tenant,
        `F-${code}`,
        `Facility ${code}`,
      ]);
      // A register of DEVICES ordinary devices per tenant, plus the rare rows the search must find.
      await rows(
        `INSERT INTO calibration_devices (id, tenant_id, client_facility_id, name, serial_number, manufacturer, created_at, updated_at)
         SELECT gen_random_uuid(), $1, $2, 'Infusion pump ' || i, 'SN-' || lpad(i::text, 6, '0'), 'Maker ' || (i % 40), now(), now()
           FROM generate_series(1, ${String(DEVICES)}) i`,
        [tenant, facility],
      );
    }
    await rows(
      `INSERT INTO calibration_devices (id, tenant_id, client_facility_id, name, serial_number, manufacturer, created_at, updated_at) VALUES
         (gen_random_uuid(), $1, $3, 'Defibrillator QZX', 'SN-A-1', 'Maker 1', now(), now()),
         (gen_random_uuid(), $1, $3, 'Monitor', 'ZZ-QZX-77', 'Maker 2', now(), now()),
         (gen_random_uuid(), $1, $3, 'Ventilator', 'SN-A-3', 'Qzx Medical', now(), now()),
         (gen_random_uuid(), $2, $4, 'Defibrillator QZX of B', 'SN-B-1', 'Maker 1', now(), now())`,
      [TENANT_A, TENANT_B, FACILITY_A, FACILITY_B],
    );
    await rows("ANALYZE calibration_devices");
  });

  afterAll(async () => {
    await g.db.close();
  });

  it("the boot built it VALID, as 0148 defines it", async () => {
    expect(await rows("SELECT indisvalid AS valid, pg_get_indexdef(indexrelid) AS def FROM pg_index WHERE indexrelid = $1::regclass", [INDEX])).toEqual([
      {
        valid: true,
        def: `CREATE INDEX ${INDEX} ON public.calibration_devices USING gin (tenant_id, name gin_trgm_ops, serial_number gin_trgm_ops, manufacturer gin_trgm_ops)`,
      },
    ]);
  });

  it("it serves each of the register's three leading-wildcard ILIKEs (no other index can)", async () => {
    const text = await bitmapPlan(
      "SELECT count(*) FROM calibration_devices WHERE name ILIKE $1 OR serial_number ILIKE $1 OR manufacturer ILIKE $1",
      ["%qzx%"],
    );
    // A BitmapOr of three scans of this one index, one per column.
    expect(text.split(`Bitmap Index Scan on ${INDEX}`)).toHaveLength(4);
    for (const column of ["name", "serial_number", "manufacturer"]) {
      expect(text).toContain(`Index Cond: ((${column})::text ~~* '%qzx%'::text)`);
    }
  });

  it("find= answers as before: by name, serial or manufacturer, any case, the caller's tenant only", async () => {
    const a = await find(TENANT_A, "qZx");
    expect(a.data?.meta.total).toBe(3);
    expect(a.data?.rows.map((r) => r.name).sort()).toEqual(["Defibrillator QZX", "Monitor", "Ventilator"]);
    const b = await find(TENANT_B, "QZX");
    expect(b.data?.rows.map((r) => r.name)).toEqual(["Defibrillator QZX of B"]);
    // A common term keeps its answer too (the planner may walk the name index for it).
    expect((await find(TENANT_A, "SN-00012")).data?.meta.total).toBe(10);
    // Under three characters there is no trigram: still answered, by the filter.
    expect((await find(TENANT_B, "B-")).data?.rows.map((r) => r.serialNumber)).toEqual(["SN-B-1"]);
  });
});

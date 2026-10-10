/**
 * Q-51 against a REAL PostgreSQL 18 — migration 0105: an API key may be the
 * actor of a calibration record, a stock adjustment or a transfer request.
 *
 * On an EMPTY scratch database: db.sync() and the migrations up to 0104,
 * then 0105's own `down` — which leaves exactly the schema before 0105 (the
 * user columns NOT NULL, no api_key_id): sync() builds from today's models.
 * Then:
 *
 *  - FAIL-BEFORE: what the services wrote for a key (its id in adjusted_by /
 *    performed_by / requested_by) fails the users foreign key (23503);
 *  - 0105 up: the columns, the RESTRICT foreign keys to api_keys, the
 *    indexes, and the three CHECKs VALIDATED (convalidated) over rows written
 *    before it;
 *  - AS callibrator_app (dbRole.enterApplicationRole — never as the owner,
 *    CLAUDE.md Evidence): the REAL services create a stock adjustment, a
 *    stock transfer and a calibration record for a key principal
 *    (api_key_id set, the user column NULL), and a user principal still
 *    writes the user column; the CHECK refuses a row naming both actors or
 *    neither; the app role cannot change a calibration record's api_key_id
 *    (append-only);
 *  - down REFUSES while a key-authored row exists, and changes nothing.
 *
 *   DB_HOST=127.0.0.1 DB_PORT=55951 DB_NAME=q51_scratch \
 *     DB_USER=postgres DB_PASS=... npm run test:live:jest -- src/tests/migrations/apiKeyActor.q51.live
 */
import { env } from "../../config/env";
import { SELF_FACILITIES_SQL } from "../fixtures/selfFacility";

const APP_ROLE = "callibrator_app";
const TENANT = "a5151515-0000-4000-8000-000000000001";
const USER = "a5151515-0000-4000-8000-000000000002";
const KEY = "a5151515-0000-4000-8000-000000000003";
const WAREHOUSE_A = "a5151515-0000-4000-8000-000000000004";
const WAREHOUSE_B = "a5151515-0000-4000-8000-000000000005";
const STOCK = "a5151515-0000-4000-8000-000000000006";
const DEVICE = "a5151515-0000-4000-8000-000000000007";
const OLD_RECORD = "a5151515-0000-4000-8000-000000000008";

type Row = Record<string, unknown>;
interface LiveTx {
  rollback(): Promise<void>;
}
interface LiveDb {
  options: { logging: unknown };
  query(sql: string, options?: object): Promise<[Row[], unknown]>;
  transaction(): Promise<LiveTx>;
  close(): Promise<void>;
  sync(): Promise<unknown>;
  getQueryInterface(): unknown;
}
interface Principal {
  userId: string | null;
  apiKeyId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}
interface Result {
  status: number;
  data: Row | null;
}
interface Graph {
  db: LiveDb;
  migrator: { up(options?: object): Promise<unknown> };
  dbRole: { enterApplicationRole(options: object): Promise<unknown> };
  tenantStorage: { run(context: object, fn: () => void): void };
  stock: {
    createAdjustment(tenantId: string, input: object, userId: string, actor: Principal): Promise<Result>;
    createTransfer(tenantId: string, input: object, userId: string, actor: Principal): Promise<Result>;
  };
  records: {
    createCalibrationRecord(tenantId: string, userId: string, input: object, actor: Principal): Promise<Result>;
  };
  m0105: { up(o: { context: unknown }): Promise<void>; down(o: { context: unknown }): Promise<void> };
}

/* eslint-disable @typescript-eslint/no-require-imports -- the graph is JavaScript modules loaded per "process" with jest.isolateModules; typed by the members used */
const startProcess = (): Graph => {
  let graph: Graph | undefined;
  jest.isolateModules(() => {
    const db = (require("../../config") as { db: LiveDb }).db;
    db.options.logging = false;
    graph = {
      db,
      migrator: (require("../../config/migrator") as { migrator: Graph["migrator"] }).migrator,
      dbRole: require("../../utils/dbRole.util") as Graph["dbRole"],
      tenantStorage: (require("../../middlewares/tenantContext.middleware") as { tenantStorage: Graph["tenantStorage"] })
        .tenantStorage,
      stock: require("../../services/stock.service") as Graph["stock"],
      records: require("../../services/calibrationRecords.service") as Graph["records"],
      m0105: require("../../migrations/0105-api-key-actor-columns") as Graph["m0105"],
    };
    require("../../models");
  });
  if (!graph) {
    throw new Error("the module graph did not load");
  }
  return graph;
};
/* eslint-enable @typescript-eslint/no-require-imports */

const one = async (db: LiveDb, sql: string, replacements: object = {}): Promise<Row> => {
  const [rows] = await db.query(sql, { replacements });
  const row = rows[0];
  if (!row) {
    throw new Error(`no row from: ${sql}`);
  }
  return row;
};

/** The PostgreSQL error code `sql` raises inside a savepoint of `t` (optionally as `role`), or null. */
const codeOf = async (db: LiveDb, t: LiveTx, sql: string, replacements: object = {}, role: string | null = null) => {
  await db.query("SAVEPOINT probe", { transaction: t });
  try {
    if (role) {
      await db.query(`SET LOCAL ROLE ${role}`, { transaction: t });
    }
    await db.query(sql, { transaction: t, replacements });
    await db.query("ROLLBACK TO SAVEPOINT probe", { transaction: t });
    return null;
  } catch (err) {
    await db.query("ROLLBACK TO SAVEPOINT probe", { transaction: t });
    const e = err as { parent?: { code?: string; constraint?: string }; original?: { code?: string } };
    return `${e.parent?.code ?? e.original?.code ?? "?"}${e.parent?.constraint ? ` ${e.parent.constraint}` : ""}`;
  }
};

const inRolledBack = async <T>(db: LiveDb, work: (t: LiveTx) => Promise<T>): Promise<T> => {
  const t = await db.transaction();
  try {
    return await work(t);
  } finally {
    await t.rollback();
  }
};

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
const asKey: Principal = { userId: null, apiKeyId: KEY, ipAddress: "10.51.0.1", userAgent: "q51-live" };
const asUser: Principal = { userId: USER, apiKeyId: null, ipAddress: "10.51.0.2", userAgent: "q51-live" };

jest.setTimeout(900000);

describe("Q-51 — migration 0105 on live PostgreSQL 18", () => {
  let g: Graph;

  beforeAll(async () => {
    const name = env("DB_NAME") ?? "";
    if (!name.includes("scratch")) {
      throw new Error(`Refusing to rebuild DB_NAME="${name}": use a scratch database (see the header)`);
    }
    g = startProcess();
    await g.db.sync();
    await g.migrator.up({ to: "0104-webauthn-credentials.js" });
    // sync() built today's models; 0105's down leaves the schema as it was before 0105.
    await g.m0105.down({ context: g.db.getQueryInterface() });

    await g.db.query(
      `INSERT INTO tenants (id, name, subdomain, email, created_at, updated_at)
       VALUES (:t, 'Q51 Hospital', 'q51', 'q51@live.test', now(), now())`,
      { replacements: { t: TENANT } },
    );
    await g.db.query(
      `INSERT INTO users (id, tenant_id, username, email, password, first_name, last_name, avatar_url,
                          status, must_change_password, is_deleted, created_at, updated_at)
       VALUES (:u, :t, 'q51-tech', 'q51-tech@live.test', 'x', 'Q51', 'Tech', 'default.svg',
               'ACTIVE', false, false, now(), now())`,
      { replacements: { u: USER, t: TENANT } },
    );
    await g.db.query(
      `INSERT INTO api_keys (id, tenant_id, name, key_prefix, key_hash, scopes, is_active, is_deleted, created_at, updated_at)
       VALUES (:k, :t, 'LIMS integration', 'cbk_q51', repeat('a', 64),
               '["warehouse:write","calibration:write"]'::jsonb, true, false, now(), now())`,
      { replacements: { k: KEY, t: TENANT } },
    );
    await g.db.query(
      `INSERT INTO warehouses (id, tenant_id, name, code, status, is_deleted, created_at, updated_at)
       VALUES (:a, :t, 'Main store', 'WH-Q51-A', 'active', false, now(), now()),
              (:b, :t, 'Ward store', 'WH-Q51-B', 'active', false, now(), now())`,
      { replacements: { a: WAREHOUSE_A, b: WAREHOUSE_B, t: TENANT } },
    );
    await g.db.query(
      `INSERT INTO stocks (id, tenant_id, warehouse_id, item_name, quantity, min_quantity, is_deleted, created_at, updated_at)
       VALUES (:s, :t, :w, 'Fuse 5A', 10, 0, false, now(), now())`,
      { replacements: { s: STOCK, t: TENANT, w: WAREHOUSE_A } },
    );
    // P20-07: raw-SQL tenants need their self facility before a device (0118 refuses one without — fixtures/selfFacility).
    await g.db.query(SELF_FACILITIES_SQL);
    await g.db.query(
      `INSERT INTO calibration_devices (id, tenant_id, name, serial_number, created_at, updated_at)
       VALUES (:d, :t, 'Infusion pump', 'SN-Q51', now(), now())`,
      { replacements: { d: DEVICE, t: TENANT } },
    );
    // A row written BEFORE 0105, by a user — VALIDATE must pass over it.
    await g.db.query(
      `INSERT INTO calibration_records (id, tenant_id, device_id, performed_by, calibration_date, is_deleted, created_at, updated_at)
       VALUES (:r, :t, :d, :u, now(), false, now(), now())`,
      { replacements: { r: OLD_RECORD, t: TENANT, d: DEVICE, u: USER } },
    );
  });

  afterAll(async () => {
    await g.db.close();
  });

  it("FAIL-BEFORE: before 0105 a key's id in adjusted_by / performed_by / requested_by fails the users foreign key", async () => {
    const [cols] = await g.db.query(
      // idempotency_keys (P20-04, born with api_key_id; sync() builds it from today's model) is not one of 0105's tables.
      "SELECT table_name FROM information_schema.columns WHERE column_name = 'api_key_id' AND table_name <> 'idempotency_keys' ORDER BY table_name",
    );
    expect(cols).toEqual([]);
    await inRolledBack(g.db, async (t) => {
      expect(
        await codeOf(g.db, t,
          `INSERT INTO stock_adjustments (id, tenant_id, warehouse_id, stock_id, type, quantity, quantity_before, quantity_after,
                                          reason, adjusted_by, created_at, updated_at)
           VALUES (gen_random_uuid(), :t, :w, :s, 'addition', 1, 10, 11, 'Delivery', :k, now(), now())`,
          { t: TENANT, w: WAREHOUSE_A, s: STOCK, k: KEY }, APP_ROLE),
      ).toMatch(/^23503 /);
      expect(
        await codeOf(g.db, t,
          `INSERT INTO calibration_records (id, tenant_id, device_id, performed_by, calibration_date, is_deleted, created_at, updated_at)
           VALUES (gen_random_uuid(), :t, :d, :k, now(), false, now(), now())`,
          { t: TENANT, d: DEVICE, k: KEY }, APP_ROLE),
      ).toMatch(/^23503 /);
      expect(
        await codeOf(g.db, t,
          `INSERT INTO stock_transfers (id, tenant_id, from_warehouse_id, to_warehouse_id, item_name, quantity, status,
                                        requested_by, created_at, updated_at)
           VALUES (gen_random_uuid(), :t, :a, :b, 'Fuse 5A', 1, 'pending', :k, now(), now())`,
          { t: TENANT, a: WAREHOUSE_A, b: WAREHOUSE_B, k: KEY }, APP_ROLE),
      ).toMatch(/^23503 /);
    });
  });

  it("0105 up: nullable user columns, api_key_id → api_keys ON DELETE RESTRICT, indexes, and VALIDATED CHECKs", async () => {
    await g.migrator.up();
    const [cols] = await g.db.query(
      `SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns
        WHERE (table_name, column_name) IN (('calibration_records','performed_by'), ('calibration_records','api_key_id'),
                                            ('stock_adjustments','adjusted_by'), ('stock_adjustments','api_key_id'),
                                            ('stock_transfers','requested_by'), ('stock_transfers','api_key_id'))
        ORDER BY table_name, column_name`,
    );
    expect(cols).toEqual([
      { table_name: "calibration_records", column_name: "api_key_id", data_type: "uuid", is_nullable: "YES" },
      { table_name: "calibration_records", column_name: "performed_by", data_type: "uuid", is_nullable: "YES" },
      { table_name: "stock_adjustments", column_name: "adjusted_by", data_type: "uuid", is_nullable: "YES" },
      { table_name: "stock_adjustments", column_name: "api_key_id", data_type: "uuid", is_nullable: "YES" },
      { table_name: "stock_transfers", column_name: "api_key_id", data_type: "uuid", is_nullable: "YES" },
      { table_name: "stock_transfers", column_name: "requested_by", data_type: "uuid", is_nullable: "YES" },
    ]);
    const [fks] = await g.db.query(
      `SELECT conrelid::regclass::text AS tbl, confrelid::regclass::text AS target, confdeltype
         FROM pg_constraint
        WHERE contype = 'f' AND confrelid = 'api_keys'::regclass
          AND conrelid::regclass::text IN ('calibration_records','stock_adjustments','stock_transfers')
        ORDER BY 1`,
    );
    expect(fks).toEqual([
      { tbl: "calibration_records", target: "api_keys", confdeltype: "r" },
      { tbl: "stock_adjustments", target: "api_keys", confdeltype: "r" },
      { tbl: "stock_transfers", target: "api_keys", confdeltype: "r" },
    ]);
    const [checks] = await g.db.query(
      `SELECT conname, convalidated, pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname IN ('calibration_records_actor_exactly_one','stock_adjustments_actor_exactly_one',
                          'stock_transfers_requester_exactly_one')
        ORDER BY conname`,
    );
    expect(checks).toEqual([
      { conname: "calibration_records_actor_exactly_one", convalidated: true, def: "CHECK ((num_nonnulls(performed_by, api_key_id) = 1))" },
      { conname: "stock_adjustments_actor_exactly_one", convalidated: true, def: "CHECK ((num_nonnulls(adjusted_by, api_key_id) = 1))" },
      { conname: "stock_transfers_requester_exactly_one", convalidated: true, def: "CHECK ((num_nonnulls(requested_by, api_key_id) = 1))" },
    ]);
    const [indexes] = await g.db.query(
      `SELECT indexname FROM pg_indexes WHERE indexname IN
         ('calibration_records_api_key_id','stock_adjustments_api_key_id','stock_transfers_api_key_id') ORDER BY 1`,
    );
    expect(indexes.map((r) => r["indexname"])).toEqual([
      "calibration_records_api_key_id",
      "stock_adjustments_api_key_id",
      "stock_transfers_api_key_id",
    ]);
  });

  it("AS callibrator_app: the real services write a key's rows (api_key_id set, the user column NULL) and a user's as before", async () => {
    const app = startProcess();
    try {
      await app.dbRole.enterApplicationRole({ sequelize: app.db, logger, env: { DB_APP_ROLE: APP_ROLE } });
      expect((await one(app.db, "SELECT current_user AS u"))["u"]).toBe(APP_ROLE);
      const inTenant = <T>(work: () => Promise<T>): Promise<T> =>
        new Promise<T>((resolve, reject) => {
          app.tenantStorage.run({ tenantId: TENANT, isSuperAdmin: false, isSystemTask: false }, () => {
            work().then(resolve, reject);
          });
        });

      const byKey = await inTenant(() =>
        app.stock.createAdjustment(TENANT, { stockId: STOCK, type: "addition", quantity: 2, reason: "Delivery counted in" }, KEY, asKey),
      );
      expect(byKey.status).toBe(201);
      const byUser = await inTenant(() =>
        app.stock.createAdjustment(TENANT, { stockId: STOCK, type: "subtraction", quantity: 1, reason: "Broken on the shelf" }, USER, asUser),
      );
      expect(byUser.status).toBe(201);
      const transfer = await inTenant(() =>
        app.stock.createTransfer(TENANT, { fromWarehouseId: WAREHOUSE_A, toWarehouseId: WAREHOUSE_B, itemName: "Fuse 5A", quantity: 1 }, KEY, asKey),
      );
      expect(transfer.status).toBe(201);
      const record = await inTenant(() =>
        app.records.createCalibrationRecord(TENANT, KEY, { deviceId: DEVICE, calibrationDate: "2026-09-20", isCompliant: true }, asKey),
      );
      expect(record.status).toBe(201);

      expect(await one(app.db, "SELECT adjusted_by, api_key_id FROM stock_adjustments WHERE id = :id", { id: byKey.data?.["id"] }))
        .toEqual({ adjusted_by: null, api_key_id: KEY });
      expect(await one(app.db, "SELECT adjusted_by, api_key_id FROM stock_adjustments WHERE id = :id", { id: byUser.data?.["id"] }))
        .toEqual({ adjusted_by: USER, api_key_id: null });
      expect(await one(app.db, "SELECT requested_by, api_key_id FROM stock_transfers WHERE id = :id", { id: transfer.data?.["id"] }))
        .toEqual({ requested_by: null, api_key_id: KEY });
      expect(await one(app.db, "SELECT performed_by, api_key_id FROM calibration_records WHERE id = :id", { id: record.data?.["id"] }))
        .toEqual({ performed_by: null, api_key_id: KEY });
      // The audit rows are the key's too (ADR-100): system:api-key, no user.
      const audit = await one(app.db,
        `SELECT user_id, actor_type::text AS actor_type, actor_name, changes->>'apiKeyId' AS key FROM audit_logs
          WHERE resource_type = 'StockAdjustment' AND resource_id = :id`,
        { id: byKey.data?.["id"] },
      );
      expect(audit).toEqual({ user_id: null, actor_type: "system", actor_name: "system:api-key", key: KEY });
    } finally {
      await app.db.close();
    }
  });

  it("the CHECK refuses both actors and neither (23514), for the app role and the owner alike", async () => {
    await inRolledBack(g.db, async (t) => {
      const adjustment = (adjustedBy: string | null, apiKeyId: string | null) =>
        codeOf(g.db, t,
          `INSERT INTO stock_adjustments (id, tenant_id, warehouse_id, stock_id, type, quantity, quantity_before, quantity_after,
                                          reason, adjusted_by, api_key_id, created_at, updated_at)
           VALUES (gen_random_uuid(), :t, :w, :s, 'addition', 1, 10, 11, 'Delivery', :u, :k, now(), now())`,
          { t: TENANT, w: WAREHOUSE_A, s: STOCK, u: adjustedBy, k: apiKeyId }, APP_ROLE);
      expect(await adjustment(USER, KEY)).toBe("23514 stock_adjustments_actor_exactly_one");
      expect(await adjustment(null, null)).toBe("23514 stock_adjustments_actor_exactly_one");
      expect(await adjustment(null, KEY)).toBeNull();
      expect(await adjustment(USER, null)).toBeNull();

      const record = (performedBy: string | null, apiKeyId: string | null, role: string | null) =>
        codeOf(g.db, t,
          `INSERT INTO calibration_records (id, tenant_id, device_id, performed_by, api_key_id, calibration_date, is_deleted, created_at, updated_at)
           VALUES (gen_random_uuid(), :t, :d, :u, :k, now(), false, now(), now())`,
          { t: TENANT, d: DEVICE, u: performedBy, k: apiKeyId }, role);
      expect(await record(USER, KEY, APP_ROLE)).toBe("23514 calibration_records_actor_exactly_one");
      expect(await record(null, null, null)).toBe("23514 calibration_records_actor_exactly_one");

      const transfer = (requestedBy: string | null, apiKeyId: string | null) =>
        codeOf(g.db, t,
          `INSERT INTO stock_transfers (id, tenant_id, from_warehouse_id, to_warehouse_id, item_name, quantity, status,
                                        requested_by, api_key_id, created_at, updated_at)
           VALUES (gen_random_uuid(), :t, :a, :b, 'Fuse 5A', 1, 'pending', :u, :k, now(), now())`,
          { t: TENANT, a: WAREHOUSE_A, b: WAREHOUSE_B, u: requestedBy, k: apiKeyId }, APP_ROLE);
      expect(await transfer(USER, KEY)).toBe("23514 stock_transfers_requester_exactly_one");
      expect(await transfer(null, null)).toBe("23514 stock_transfers_requester_exactly_one");
    });
  });

  it("a calibration record's api_key_id is content: the app role may not change it (0057 column grant)", async () => {
    await inRolledBack(g.db, async (t) => {
      expect(
        await codeOf(g.db, t, "UPDATE calibration_records SET api_key_id = :k, performed_by = NULL WHERE id = :r",
          { k: KEY, r: OLD_RECORD }, APP_ROLE),
      ).toMatch(/^42501/);
    });
  });

  it("down REFUSES while key-authored rows exist, and changes nothing", async () => {
    await expect(g.m0105.down({ context: g.db.getQueryInterface() })).rejects.toThrow(
      /0105 down: \d+ row\(s\) of calibration_records were written by an API key/,
    );
    const still = await one(g.db,
      "SELECT count(*)::int AS n FROM pg_constraint WHERE conname LIKE '%actor_exactly_one' OR conname = 'stock_transfers_requester_exactly_one'");
    expect(still["n"]).toBe(3);
  });
});

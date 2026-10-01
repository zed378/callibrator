/**
 * P6-11 against a REAL PostgreSQL 18, AS callibrator_app — an audit row
 * commits with its mutation, and a rolled-back mutation leaves none.
 *
 * The memoryDb suite (tests/routes/auditCoverage.p611.test.ts) proves the
 * services write the row inside the mutation's transaction. Only a real
 * server proves what that is worth: that the application role (never the
 * owner — CLAUDE.md, Evidence) can INSERT the row the service builds (the
 * action ENUM, the actor CHECK of migration 0033, the users foreign key of
 * 0030), and that PostgreSQL's ROLLBACK takes the audit row with the write.
 *
 * Two services, one of each kind: warehouse.service (TypeScript, an unmanaged
 * transaction) and kanban.service (JavaScript, a managed one).
 *
 *   P611_PG_LIVE_TEST=1 DB_HOST=127.0.0.1 DB_PORT=55611 \
 *     DB_NAME=callibrator_scratch_p611 DB_USER=postgres DB_PASS=... \
 *     npm test -- src/tests/services/auditRollback.p611.live --coverage=false
 *
 * The database must be an EMPTY scratch database: the schema is built here
 * (runSchemaSetup — sync and every migration, the boot path).
 */
import { env } from "../../config/env";

const live = env("P611_PG_LIVE_TEST") === "1" ? describe : describe.skip;

const APP_ROLE = "callibrator_app";
const TENANT = "a6a6a6a6-0000-4000-8000-000000000611";
const KEY_ID = "a6a6a6a6-0000-4000-8000-00000000c0de";

type Row = Record<string, unknown>;
interface LiveDb {
  options: { logging: unknown };
  query(sql: string, options?: object): Promise<[Row[], unknown]>;
  close(): Promise<void>;
}
interface Actor {
  userId?: string | null;
  apiKeyId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}
interface Graph {
  db: LiveDb;
  migrator: { up(options?: object): Promise<unknown>; pending(): Promise<unknown[]> };
  migrationLock: { runSchemaSetup(options: object): Promise<unknown> };
  dbRole: { enterApplicationRole(options: object): Promise<unknown> };
  tenantStorage: { run(context: object, fn: () => void): void };
  audit: { logAction(entry: object, options?: object): Promise<unknown> };
  warehouse: {
    createWarehouse(tenantId: string, input: object, actor?: Actor | null): Promise<{ data: { id: string } }>;
  };
  kanban: {
    createProject(user: object, data: object, actor?: Actor | null): Promise<{ id: string }>;
  };
}

/* eslint-disable @typescript-eslint/no-require-imports -- the graph is loaded per "process" with jest.isolateModules; typed by the members used */
const startProcess = (): Graph => {
  let graph: Graph | undefined;
  jest.isolateModules(() => {
    const db = (require("../../config") as { db: LiveDb }).db;
    db.options.logging = false;
    require("../../models");
    graph = {
      db,
      migrator: (require("../../config/migrator") as { migrator: Graph["migrator"] }).migrator,
      migrationLock: require("../../utils/migrationLock.util") as Graph["migrationLock"],
      dbRole: require("../../utils/dbRole.util") as Graph["dbRole"],
      tenantStorage: (require("../../middlewares/tenantContext.middleware") as { tenantStorage: Graph["tenantStorage"] })
        .tenantStorage,
      audit: require("../../services/audit.service") as Graph["audit"],
      warehouse: require("../../services/warehouse.service") as Graph["warehouse"],
      kanban: require("../../services/kanban.service") as Graph["kanban"],
    };
  });
  if (!graph) {
    throw new Error("the module graph did not load");
  }
  return graph;
};
/* eslint-enable @typescript-eslint/no-require-imports */

const one = async (db: LiveDb, sql: string, options: object = {}): Promise<Row> => {
  const [rows] = await db.query(sql, options);
  const row = rows[0];
  if (!row) {
    throw new Error(`no row from: ${sql}`);
  }
  return row;
};

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

live("P6-11 — audit row and mutation commit or roll back together, on live PostgreSQL 18 as callibrator_app", () => {
  let owner: Graph;
  let app: Graph;
  let adminId = "";

  /** Run `work` in the tenant's request context (the tenant hooks read it). */
  const inTenant = <T>(work: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      app.tenantStorage.run({ tenantId: TENANT, isSuperAdmin: false, isSystemTask: false }, () => {
        work().then(resolve, reject);
      });
    });

  const count = async (sql: string, replacements: object): Promise<number> =>
    Number((await one(owner.db, sql, { replacements }))["n"]);

  const auditRowsFor = (resourceType: string, resourceId: string): Promise<number> =>
    count(
      "SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id = :t AND resource_type = :rt AND resource_id = :rid",
      { t: TENANT, rt: resourceType, rid: resourceId },
    );

  /** logAction writes its row, then the transaction fails: the forced rollback. */
  const failAfterAuditRow = (): jest.SpyInstance => {
    const real = app.audit.logAction.bind(app.audit);
    return jest.spyOn(app.audit, "logAction").mockImplementation(async (entry: object, options?: object) => {
      await real(entry, options);
      throw new Error("forced rollback after the audit row was written");
    });
  };

  beforeAll(async () => {
    const name = env("DB_NAME") ?? "";
    if (!name.includes("scratch")) {
      throw new Error(`Refusing to build a schema in DB_NAME="${name}": use a scratch database (see the header)`);
    }
    owner = startProcess();
    await owner.migrationLock.runSchemaSetup({ sequelize: owner.db, migrator: owner.migrator, logger });
    expect(await owner.migrator.pending()).toEqual([]);

    await owner.db.query(
      `INSERT INTO tenants (id, name, subdomain, email, created_at, updated_at)
       VALUES (:t, 'P611 Hospital', 'p611', 'p611@live.test', now(), now())`,
      { replacements: { t: TENANT } },
    );
    const admin = await one(owner.db,
      `INSERT INTO users (id, tenant_id, username, email, password, first_name, last_name, avatar_url,
                          status, must_change_password, is_deleted, created_at, updated_at)
       VALUES (gen_random_uuid(), :t, 'p611-admin', 'p611-admin@live.test', 'x', 'P611', 'Admin', 'default.svg',
               'ACTIVE', false, false, now(), now())
       RETURNING id`,
      { replacements: { t: TENANT } },
    );
    adminId = String(admin["id"]);

    app = startProcess();
    await app.dbRole.enterApplicationRole({ sequelize: app.db, logger, env: { DB_APP_ROLE: APP_ROLE } });
    const who = await one(app.db, "SELECT current_user AS u, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS s");
    expect(who).toEqual({ u: APP_ROLE, s: false });
  }, 240000);

  afterAll(async () => {
    jest.restoreAllMocks();
    await app.db.close();
    await owner.db.close();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("warehouse (TypeScript, unmanaged transaction): the write commits with exactly one audit row", async () => {
    const res = await inTenant(() =>
      app.warehouse.createWarehouse(TENANT, { name: "Live store", code: "LIVE1" }, { userId: adminId, ipAddress: "10.6.1.1" }),
    );
    const id = res.data.id;
    expect(await count("SELECT count(*)::int AS n FROM warehouses WHERE id = :id", { id })).toBe(1);
    expect(await auditRowsFor("Warehouse", id)).toBe(1);
    const row = await one(owner.db,
      `SELECT action::text AS action, actor_type::text AS actor_type, user_id, ip_address, changes->>'operation' AS op
         FROM audit_logs WHERE resource_id = :id`,
      { replacements: { id } },
    );
    expect(row).toEqual({ action: "CREATE", actor_type: "user", user_id: adminId, ip_address: "10.6.1.1", op: "WAREHOUSE_CREATE" });
  });

  it("warehouse: an API key is recorded as system:api-key with no user (the users foreign key and 0033's CHECK accept it)", async () => {
    const res = await inTenant(() =>
      app.warehouse.createWarehouse(TENANT, { name: "Key store", code: "KEY1" }, { userId: null, apiKeyId: KEY_ID }),
    );
    const row = await one(owner.db,
      `SELECT actor_type::text AS actor_type, actor_name, user_id, changes->>'apiKeyId' AS key
         FROM audit_logs WHERE resource_id = :id`,
      { replacements: { id: res.data.id } },
    );
    expect(row).toEqual({ actor_type: "system", actor_name: "system:api-key", user_id: null, key: KEY_ID });
  });

  it("warehouse: a forced rollback after the audit row leaves neither the warehouse nor the row", async () => {
    const spy = failAfterAuditRow();
    await expect(
      inTenant(() => app.warehouse.createWarehouse(TENANT, { name: "Doomed", code: "DOOM1" }, { userId: adminId })),
    ).rejects.toThrow("forced rollback");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await count("SELECT count(*)::int AS n FROM warehouses WHERE code = 'DOOM1'", {})).toBe(0);
    expect(
      await count(
        "SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id = :t AND changes->'after'->>'code' = 'DOOM1'",
        { t: TENANT },
      ),
    ).toBe(0);
  });

  it("kanban (JavaScript, managed transaction): the write commits with one audit row; a forced rollback leaves neither", async () => {
    const user = { id: adminId, tenantId: TENANT, role: { name: "USER" } };
    const project = await inTenant(() => app.kanban.createProject(user, { name: "Live board" }, { userId: adminId }));
    expect(await auditRowsFor("KanbanProject", project.id)).toBe(1);

    const spy = failAfterAuditRow();
    await expect(
      inTenant(() => app.kanban.createProject(user, { name: "Doomed board" }, { userId: adminId })),
    ).rejects.toThrow("forced rollback");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await count("SELECT count(*)::int AS n FROM kanban_projects WHERE name = 'Doomed board'", {})).toBe(0);
    expect(
      await count(
        "SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id = :t AND changes->'after'->>'name' = 'Doomed board'",
        { t: TENANT },
      ),
    ).toBe(0);
  });
});

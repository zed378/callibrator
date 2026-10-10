/**
 * P9-18 — the converted migration.service against a REAL PostgreSQL 18, AS
 * callibrator_app (the role the seed routes run as after boot; never the owner
 * — CLAUDE.md, Evidence), on a schema built by the boot path (runSchemaSetup:
 * sync and every migration).
 *
 * What it proves, through the service itself:
 *  - seedAll on a migrated database creates nothing it should not: the core
 *    roles, the menu tree and both tenants already exist, so a second seedAll
 *    reports nothing created and no error (idempotent), and it never touches
 *    an existing super admin's credential;
 *  - the PLATFORM tenant (A-125) is present, and the Tenant hooks' hidden row
 *    is found by the seed, not duplicated;
 *  - seedDemoData writes every module as the application role (the grants and
 *    the foreign keys accept what the fixtures build) and a re-run creates
 *    nothing (idempotent);
 *  - unseedDemoData then REFUSES (A-259): the demo devices hold calibration
 *    records, which are append-only; nothing is removed;
 *  - the demo seed is refused in production before anything is written.
 *
 * NEEDS — an EMPTY scratch database (the name must contain "scratch"); the
 * demo rows it leaves cannot be removed (that is the point of A-259):
 *
 *   DB_HOST=127.0.0.1 DB_PORT=55918 \
 *     DB_NAME=callibrator_scratch_p918seed DB_USER=postgres DB_PASS=... \
 *     npm run test:live:jest -- src/tests/services/migrationService.p918.live
 */
import fs from "fs";
import path from "path";
import { env, environment } from "../../config/env";

const APP_ROLE = "callibrator_app";
const PLATFORM = "00000000-0000-4000-8000-000000000001";
const BOOTSTRAP_FILE = path.resolve(__dirname, "../../../.bootstrap/superadmin-password");

type Row = Record<string, unknown>;
interface LiveDb {
  options: { logging: unknown };
  query(sql: string, options?: object): Promise<[Row[], unknown]>;
  close(): Promise<void>;
}
interface Seeds {
  seedAll(): Promise<{
    roles: { rolesCreated: number; errors: string[] };
    menuGroups: { permissionsAssigned: number; errors: string[] };
    users: { usersCreated: number; errors: string[] };
  }>;
  seedDemoData(): Promise<{ created: Record<string, number>; errors: string[] }>;
  unseedDemoData(): Promise<{ deleted: Record<string, number>; errors: string[]; refused?: true }>;
}
interface Graph {
  db: LiveDb;
  migrator: { pending(): Promise<unknown[]> };
  migrationLock: { runSchemaSetup(options: object): Promise<unknown> };
  dbRole: { enterApplicationRole(options: object): Promise<unknown> };
  seeds: Seeds;
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
      seeds: require("../../services/migration.service") as Seeds,
    };
  });
  if (!graph) {
    throw new Error("the module graph did not load");
  }
  return graph;
};
/* eslint-enable @typescript-eslint/no-require-imports */

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

describe("P9-18 — migration.service on live PostgreSQL 18 as callibrator_app", () => {
  jest.setTimeout(240000);
  let owner: Graph;
  let app: Graph;
  let bootstrapFileExisted = false;

  const count = async (sql: string): Promise<number> => Number((await owner.db.query(sql))[0][0]?.["n"]);

  beforeAll(async () => {
    const name = env("DB_NAME") ?? "";
    if (!name.includes("scratch")) {
      throw new Error(`Refusing to build a schema in DB_NAME="${name}": use a scratch database (see the header)`);
    }
    bootstrapFileExisted = fs.existsSync(BOOTSTRAP_FILE);
    owner = startProcess();
    await owner.migrationLock.runSchemaSetup({ sequelize: owner.db, migrator: owner.migrator, logger });
    expect(await owner.migrator.pending()).toEqual([]);

    app = startProcess();
    await app.dbRole.enterApplicationRole({ sequelize: app.db, logger, env: { DB_APP_ROLE: APP_ROLE } });
    const [who] = (await app.db.query("SELECT current_user AS u, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS s"))[0];
    expect(who).toEqual({ u: APP_ROLE, s: false });
  });

  afterAll(async () => {
    // A one-time password this run caused to be written (a fresh database has
    // no super admin) is removed; one that existed before is left alone.
    if (!bootstrapFileExisted && fs.existsSync(BOOTSTRAP_FILE)) {
      fs.unlinkSync(BOOTSTRAP_FILE);
    }
    await app.db.close();
    await owner.db.close();
  });

  it("seedAll runs as the application role, and a second run creates nothing", async () => {
    const first = await app.seeds.seedAll();
    expect([...first.roles.errors, ...first.menuGroups.errors, ...first.users.errors]).toEqual([]);

    const usersBefore = await count("SELECT count(*)::int AS n FROM users");
    const passwordBefore = (await owner.db.query("SELECT password FROM users WHERE email = 'sys@mail.com'"))[0][0]?.["password"];
    const second = await app.seeds.seedAll();
    expect(second.roles.rolesCreated).toBe(0);
    expect(second.menuGroups.permissionsAssigned).toBe(0);
    expect(second.users.usersCreated).toBe(0);
    expect([...second.roles.errors, ...second.menuGroups.errors, ...second.users.errors]).toEqual([]);
    expect(await count("SELECT count(*)::int AS n FROM users")).toBe(usersBefore);
    // P10-16: an existing super admin's credential is never re-seeded.
    expect((await owner.db.query("SELECT password FROM users WHERE email = 'sys@mail.com'"))[0][0]?.["password"]).toBe(passwordBefore);
  });

  it("the PLATFORM tenant exists once (A-125), found by the seed through the tenant hooks", async () => {
    expect(await count(`SELECT count(*)::int AS n FROM tenants WHERE id = '${PLATFORM}'`)).toBe(1);
  });

  it("seedDemoData writes every module as the application role, and a re-run creates nothing", async () => {
    const first = await app.seeds.seedDemoData();
    expect(first.errors).toEqual([]);
    for (const key of ["tenants", "users", "warehouses", "calibrationDevices", "calibrationRecords", "certificates", "tickets", "kanbanCards", "posts"]) {
      expect([key, first.created[key]]).toEqual([key, expect.any(Number)]);
      expect(first.created[key]).toBeGreaterThan(0);
    }
    const again = await app.seeds.seedDemoData();
    expect(again.errors).toEqual([]);
    expect(Object.values(again.created).every((n) => n === 0)).toBe(true);
  });

  it("unseedDemoData refuses (A-259): the demo devices hold append-only calibration records; nothing is removed", async () => {
    const warehousesBefore = await count("SELECT count(*)::int AS n FROM warehouses WHERE code LIKE 'DEMO-WH-%'");
    const postsBefore = await count("SELECT count(*)::int AS n FROM posts WHERE slug LIKE 'demo-%'");
    const result = await app.seeds.unseedDemoData();
    expect(result.refused).toBe(true);
    expect(result.deleted).toEqual({});
    expect(await count("SELECT count(*)::int AS n FROM warehouses WHERE code LIKE 'DEMO-WH-%'")).toBe(warehousesBefore);
    expect(await count("SELECT count(*)::int AS n FROM posts WHERE slug LIKE 'demo-%'")).toBe(postsBefore);
  });

  it("the demo seed is refused in production before anything is written", async () => {
    const vars = environment();
    const saved = vars["NODE_ENV"];
    const ticketsBefore = await count("SELECT count(*)::int AS n FROM tickets");
    vars["NODE_ENV"] = "production";
    try {
      await expect(app.seeds.seedDemoData()).rejects.toThrow(/refused in production/);
    } finally {
      vars["NODE_ENV"] = saved;
    }
    expect(await count("SELECT count(*)::int AS n FROM tickets")).toBe(ticketsBefore);
  });
});

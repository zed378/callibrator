/**
 * P17-07 finding F-P1707-01 against a REAL PostgreSQL 18: binding a user to a facility
 * (`PUT /users/:id/client-facility` → services/userFacilityBinding.service.ts#setBinding).
 *
 * The live facility pentest (p1707-facility-pentest.e2e) could not bind its first principal: every
 * binding answered 500, "FOR UPDATE cannot be applied to the nullable side of an outer join" — the
 * user row was locked with a LEFT include of its role. The unit and memoryDb suites passed because
 * they never send SQL. FAIL-BEFORE: with the include back in the locked query, the first case
 * below throws that error.
 *
 * On an EMPTY scratch database (db.sync() and every migration), with FACILITY_BINDING_ENABLED=true
 * in THIS process only (the committed configurations keep it off):
 *  - a provider administrator binds a user to a facility as HEALTHCARE ADMIN, re-binds, unbinds;
 *  - each change commits with its audit row, in the same transaction;
 *  - a user of another tenant is a 404, never a 403.
 *
 *   npm run test:live -- --only=p1707bind      (the runner makes and drops the scratch database)
 *
 * Synthetic values only.
 */
import { Sequelize } from "sequelize";
import { env, environment } from "../../config/env";
import type * as BindingModule from "../../services/userFacilityBinding.service";
import type { TenantId } from "../../types/ids";
import { ROLE_NAMES } from "../../constants/roleConstants";
import { seedSql, type LiveDb } from "../fixtures/ipmLive";

const T = "d1707000-0000-4000-8000-000000000001";
const T2 = "d1707000-0000-4000-8000-000000000011";
const ROLE = "d1707000-0000-4000-8000-000000000002";
const ROLE2 = "d1707000-0000-4000-8000-000000000012";
const BOUND_ROLE = "d1707000-0000-4000-8000-000000000003";
const ADMIN = "d1707000-0000-4000-8000-0000000000a1";
const U1 = "d1707000-0000-4000-8000-0000000000a2";
const U9 = "d1707000-0000-4000-8000-0000000000a9";
const F1 = "d1707000-0000-4000-8000-0000000000f1";
const F2 = "d1707000-0000-4000-8000-0000000000f2";

interface Graph {
  db: LiveDb;
  migrator: { up(options?: object): Promise<{ name: string }[]> };
  binding: typeof BindingModule;
  tenantStorage: { run<R>(ctx: object, fn: () => R): R };
}

/* eslint-disable @typescript-eslint/no-require-imports -- the graph is loaded after the environment is set; typed by the members used */
const load = (): Graph => {
  const db = (require("../../config") as { db: LiveDb }).db;
  db.options.logging = false;
  require("../../models");
  return {
    db,
    migrator: (require("../../config/migrator") as { migrator: Graph["migrator"] }).migrator,
    binding: require("../../services/userFacilityBinding.service") as typeof BindingModule,
    tenantStorage: (require("../../middlewares/tenantContext.middleware") as { tenantStorage: Graph["tenantStorage"] }).tenantStorage,
  };
};
/* eslint-enable @typescript-eslint/no-require-imports */

jest.setTimeout(600000);

describe("P17-07 F-P1707-01 — a facility binding on live PostgreSQL 18", () => {
  let g: Graph;
  let admin: Sequelize;

  const rows = async (sql: string): Promise<Record<string, unknown>[]> => (await g.db.query(sql))[0];
  const asAdmin = <R>(work: () => Promise<R>): Promise<R> =>
    g.tenantStorage.run({ tenantId: T, userId: ADMIN, isSuperAdmin: false, isSystemTask: false, facilityBound: false }, work);
  const bind = (userId: string, clientFacilityId: string | null, roleId?: string) =>
    asAdmin(() =>
      g.binding.setBinding(
        T as TenantId,
        { userId, clientFacilityId, ...(roleId ? { roleId } : {}), reason: "P17-07 live binding" },
        { userId: ADMIN },
      ),
    );

  beforeAll(async () => {
    const name = env("DB_NAME") ?? "";
    if (!name.includes("scratch")) {
      throw new Error(`Refusing to rebuild DB_NAME="${name}": use a scratch database (see the header)`);
    }
    environment()["FACILITY_BINDING_ENABLED"] = "true";
    admin = new Sequelize("postgres", env("DB_USER") ?? "", env("DB_PASS") ?? "", {
      host: env("DB_HOST") ?? "",
      port: Number(env("DB_PORT") ?? "5432"),
      dialect: "postgres",
      logging: false,
    });
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${name}"`);
    g = load();
    await g.db.sync();
    await g.migrator.up();
    for (const statement of [
      ...seedSql({ tenant: T, role: ROLE, users: [ADMIN, U1], facilities: [[F1, "F-0001"], [F2, "F-0002"]], devices: [], tag: "p1707a" }),
      ...seedSql({ tenant: T2, role: ROLE2, users: [U9], facilities: [], devices: [], tag: "p1707b" }),
      `INSERT INTO roles (id, name, created_at, updated_at) VALUES ('${BOUND_ROLE}', '${ROLE_NAMES.HEALTCARE_ADMIN}', now(), now())`,
    ]) {
      await g.db.query(statement);
    }
  });

  afterAll(async () => {
    delete environment()["FACILITY_BINDING_ENABLED"];
    await g.db.close();
    await admin.close();
  });

  it("binds, re-binds and unbinds — no 500; each change commits with its audit row", async () => {
    await bind(U1, F1, BOUND_ROLE);
    expect(await rows(`SELECT client_facility_id AS f, role_id AS r FROM users WHERE id = '${U1}'`)).toEqual([{ f: F1, r: BOUND_ROLE }]);
    await bind(U1, F2);
    expect(await rows(`SELECT client_facility_id AS f FROM users WHERE id = '${U1}'`)).toEqual([{ f: F2 }]);
    await bind(U1, null, ROLE);
    expect(await rows(`SELECT client_facility_id AS f FROM users WHERE id = '${U1}'`)).toEqual([{ f: null }]);
    const [audits] = await rows(`SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id = '${T}' AND resource_id = '${U1}'`);
    expect(audits?.["n"]).toBeGreaterThanOrEqual(3);
  });

  it("a user of another tenant is a 404, never a 403, and nothing changes", async () => {
    await expect(bind(U9, F1, BOUND_ROLE)).rejects.toMatchObject({ status: 404 });
    expect(await rows(`SELECT client_facility_id AS f FROM users WHERE id = '${U9}'`)).toEqual([{ f: null }]);
  });
});

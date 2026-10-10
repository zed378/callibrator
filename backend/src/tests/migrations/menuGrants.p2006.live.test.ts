/**
 * P20-06 against a REAL PostgreSQL 18 — migration 0124 (spec MEMORY/specs/P18-01-02 § 4.2, § 5;
 * ADR-124 Am. 5).
 *
 * On a fresh scratch database: the boot path (db.sync() + every migration; 0124 is a no-op there —
 * nothing is seeded yet), then the real role and menu seeds. The seed's own rows on the three new
 * slugs and the technicians' `calibration` rows are captured, then the database is put back to
 * what a database seeded BEFORE P20-06 holds (the three groups and their grants removed, no
 * technician row on `calibration`), with two twists an upgraded database may carry: HEALTHCARE
 * TECHNICIAN holds an operator-set `calibration: read` row, and one technician user holds a
 * per-user `calibration: read` override. Then:
 *
 *  - "up" creates the three groups inactive under their parents and restores exactly the grants the
 *    seed gives (row by row); raises the `read` row to `write`; leaves the override alone;
 *  - a second "up" changes nothing;
 *  - the rows are read back AS `callibrator_app` (SET LOCAL ROLE — CLAUDE.md: never only as the
 *    owner): the application role sees what its gates will read;
 *  - "down" removes the groups and their role and user grants and leaves the technicians' write;
 *    "up" again restores the groups.
 *
 *   docker run -d --name p2006-pg18 -e POSTGRES_PASSWORD=p2006pass -p 127.0.0.1:55206:5432 pgvector/pgvector:pg18
 *   DB_HOST=127.0.0.1 DB_PORT=55206 DB_NAME=p2006_scratch DB_USER=postgres DB_PASS=p2006pass \
 *     npm run test:live:jest -- src/tests/migrations/menuGrants.p2006.live
 *   docker rm -f p2006-pg18
 * or through the runner: npm run test:live -- --only=p2006
 */
import { SELF_FACILITIES_SQL } from "../fixtures/selfFacility";

type Row = Record<string, unknown>;
interface LiveTx {
  commit(): Promise<void>;
  rollback(): Promise<void>;
}
interface LiveDb {
  query(sql: string, options?: object): Promise<[Row[], unknown]>;
  transaction(): Promise<LiveTx>;
  close(): Promise<void>;
  getQueryInterface(): unknown;
}
interface Migration {
  up(o: { context: unknown }): Promise<void>;
  down(o: { context: unknown }): Promise<void>;
}

const APP_ROLE = "callibrator_app";
const T = "b2006000-0000-4000-8000-000000000001";
const TECH_USER = "b2006000-0000-4000-8000-000000000101";
const SLUGS = "('ipm','ipm-templates','client-facilities')";

jest.setTimeout(900000);

describe("P20-06 migration 0124 on PostgreSQL 18", () => {
  /* eslint-disable @typescript-eslint/no-require-imports -- the boot graph, loaded after the env is set, typed by the members used */
  const { db } = require("../../config") as { db: LiveDb };
  const { migrator } = require("../../config/migrator") as { migrator: { up(): Promise<{ name: string }[]> } };
  const { runSchemaSetup } = require("../../utils/migrationLock.util") as { runSchemaSetup: (o: object) => Promise<unknown> };
  const migrationService = require("../../services/migration.service") as {
    seedAllRoles(): Promise<unknown>;
    seedMenuGroupsAndItems(): Promise<{ errors: string[] }>;
  };
  const m0124 = require("../../migrations/0124-ipm-menus-technician-calibration") as Migration;
  const { logger } = require("../../middlewares/activityLog.middleware") as { logger: object };
  /* eslint-enable @typescript-eslint/no-require-imports */

  const q = async (sql: string, replacements: object = {}): Promise<Row[]> => {
    try {
      return (await db.query(sql, { replacements }))[0];
    } catch (err) {
      const e = err as { message?: string; parent?: { message?: string } };
      throw new Error(`${e.parent?.message ?? e.message ?? "query failed"} :: ${sql.trim().slice(0, 80)}`);
    }
  };
  const ctx = (): { context: unknown } => ({ context: db.getQueryInterface() });

  const GRANTS_SQL = `SELECT r.name AS role, m.slug, p.permission_type AS type
                        FROM role_menu_permissions p
                        JOIN roles r ON r.id = p.role_id
                        JOIN menu_groups m ON m.id = p.menu_group_id
                       WHERE m.slug IN ${SLUGS}
                          OR (m.slug = 'calibration' AND r.name IN ('TECHNICIAN', 'HEALTHCARE TECHNICIAN'))
                       ORDER BY m.slug, r.name`;
  const GROUPS_SQL = `SELECT m.slug, m.is_active AS active, p.slug AS parent
                        FROM menu_groups m LEFT JOIN menu_groups p ON p.id = m.parent_id
                       WHERE m.slug IN ${SLUGS} ORDER BY m.slug`;
  const OVERRIDE_SQL = `SELECT u.permission_type AS type FROM user_menu_permissions u
                          JOIN menu_groups m ON m.id = u.menu_group_id
                         WHERE u.user_id = :TECH_USER AND m.slug = 'calibration'`;

  let seedGrants: Row[] = [];

  beforeAll(async () => {
    await runSchemaSetup({ sequelize: db, migrator, logger });
    await migrationService.seedAllRoles();
    const seeded = await migrationService.seedMenuGroupsAndItems();
    expect(seeded.errors).toEqual([]);
    seedGrants = await q(GRANTS_SQL);

    // A technician user with a per-user override (raw SQL tenants need their self facility first — fixtures/selfFacility).
    await q(`INSERT INTO tenants (id, name, subdomain, email, created_at, updated_at)
             VALUES (:T, 'P20-06 Hospital', 'p2006', 'p2006@live.test', now(), now()) ON CONFLICT (id) DO NOTHING`, { T });
    await q(SELF_FACILITIES_SQL);
    await q(`INSERT INTO users (id, tenant_id, role_id, username, email, password, first_name, last_name, created_at, updated_at)
             SELECT :TECH_USER, :T, r.id, 'tech2006', 'tech2006@live.test', 'x', 'Live', 'Test', now(), now()
               FROM roles r WHERE r.name = 'TECHNICIAN' ON CONFLICT (id) DO NOTHING`, { TECH_USER, T });
    await q(`INSERT INTO user_menu_permissions (id, user_id, menu_group_id, permission_type, created_at, updated_at)
             SELECT gen_random_uuid(), :TECH_USER, m.id, 'read', now(), now() FROM menu_groups m WHERE m.slug = 'calibration'`, { TECH_USER });

    // Back to a database seeded before P20-06.
    await q(`DELETE FROM role_menu_permissions p USING menu_groups m WHERE p.menu_group_id = m.id AND m.slug IN ${SLUGS}`);
    await q(`DELETE FROM menu_groups WHERE slug IN ${SLUGS}`);
    await q(`DELETE FROM role_menu_permissions p USING menu_groups m, roles r
              WHERE p.menu_group_id = m.id AND p.role_id = r.id AND m.slug = 'calibration' AND r.name = 'TECHNICIAN'`);
    await q(`UPDATE role_menu_permissions p SET permission_type = 'read' FROM menu_groups m, roles r
              WHERE p.menu_group_id = m.id AND p.role_id = r.id AND m.slug = 'calibration' AND r.name = 'HEALTHCARE TECHNICIAN'`);
  });

  afterAll(async () => {
    await db.close();
  });

  it("the pre-P20-06 state: no group, no TECHNICIAN row, HEALTHCARE TECHNICIAN at read, the override at read", async () => {
    expect(await q(GROUPS_SQL)).toEqual([]);
    expect(await q(GRANTS_SQL)).toEqual([{ role: "HEALTHCARE TECHNICIAN", slug: "calibration", type: "read" }]);
    expect(await q(OVERRIDE_SQL, { TECH_USER })).toEqual([{ type: "read" }]);
  });

  it("up: the three groups inactive under their parents, exactly the seed's grants, the read row raised, the override untouched", async () => {
    await m0124.up(ctx());
    expect(await q(GROUPS_SQL)).toEqual([
      { slug: "client-facilities", active: false, parent: "mgmt-organization" },
      { slug: "ipm", active: false, parent: "equipment" },
      { slug: "ipm-templates", active: false, parent: "equipment" },
    ]);
    const grants = await q(GRANTS_SQL);
    expect(grants).toEqual(seedGrants);
    expect(grants).toEqual(expect.arrayContaining([
      { role: "TECHNICIAN", slug: "calibration", type: "write" },
      { role: "HEALTHCARE TECHNICIAN", slug: "calibration", type: "write" },
    ]));
    expect(await q(OVERRIDE_SQL, { TECH_USER })).toEqual([{ type: "read" }]);
  });

  it("a second up changes nothing", async () => {
    const before = await q("SELECT count(*)::int AS n FROM role_menu_permissions");
    await m0124.up(ctx());
    expect(await q("SELECT count(*)::int AS n FROM role_menu_permissions")).toEqual(before);
    expect(await q(GRANTS_SQL)).toEqual(seedGrants);
  });

  it("the application role reads the groups and grants its gates decide on", async () => {
    const t = await db.transaction();
    try {
      await db.query(`SET LOCAL ROLE ${APP_ROLE}`, { transaction: t });
      const [[who]] = await db.query("SELECT current_user AS u", { transaction: t });
      expect(who).toEqual({ u: APP_ROLE });
      const [grants] = await db.query(GRANTS_SQL, { transaction: t });
      expect(grants).toEqual(seedGrants);
      const [groups] = await db.query(GROUPS_SQL, { transaction: t });
      expect(groups).toHaveLength(3);
    } finally {
      await t.rollback();
    }
  });

  it("down removes the groups with their grants and leaves the technicians' calibration write; up restores them", async () => {
    await m0124.down(ctx());
    expect(await q(GROUPS_SQL)).toEqual([]);
    expect(await q(GRANTS_SQL)).toEqual([
      { role: "HEALTHCARE TECHNICIAN", slug: "calibration", type: "write" },
      { role: "TECHNICIAN", slug: "calibration", type: "write" },
    ]);
    await m0124.up(ctx());
    expect(await q(GRANTS_SQL)).toEqual(seedGrants);
  });
});

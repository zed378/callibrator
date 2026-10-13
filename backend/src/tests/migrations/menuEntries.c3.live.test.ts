/**
 * UAT C-3 against a REAL PostgreSQL 18 — migration 0142 (the calibration-dates and exports menu entries).
 *
 * On a fresh scratch database: the boot path (every migration; 0142 is a no-op there — nothing is
 * seeded yet), then the real role and menu seeds. The seed's own groups and grants on the two slugs
 * are captured, then removed — a database seeded before 0142 — and an operator-made role holding
 * only `calibration` is added (it reaches both pages through the gate, so it gets the entries too):
 *
 *  - "up" creates both groups ACTIVE under Equipment and restores exactly the seed's grants, plus
 *    the operator role's `read`; a second "up" changes nothing;
 *  - the rows are read back AS `callibrator_app` (CLAUDE.md: never only as the owner);
 *  - "down" removes the groups and every grant on them; "up" again restores them.
 *
 *   docker run -d --name la-g-pg18 -e POSTGRES_PASSWORD=p2402gpass -p 127.0.0.1:56270:5432 pgvector/pgvector:pg18
 *   DB_HOST=127.0.0.1 DB_PORT=56270 DB_USER=postgres DB_PASS=p2402gpass npm run test:live -- --only=c3menu
 */
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
const OPERATOR_ROLE = "C3 CALIBRATION READER";
const SLUGS = "('calibration-dates','exports')";

jest.setTimeout(900000);

describe("UAT C-3 migration 0142 on PostgreSQL 18", () => {
  /* eslint-disable @typescript-eslint/no-require-imports -- the boot graph, loaded after the env is set, typed by the members used */
  const { db } = require("../../config") as { db: LiveDb };
  const { migrator } = require("../../config/migrator") as { migrator: { up(): Promise<{ name: string }[]> } };
  const { runSchemaSetup } = require("../../utils/migrationLock.util") as { runSchemaSetup: (o: object) => Promise<unknown> };
  const migrationService = require("../../services/migration.service") as {
    seedAllRoles(): Promise<unknown>;
    seedMenuGroupsAndItems(): Promise<{ errors: string[] }>;
  };
  const m0142 = require("../../migrations/0142-calibration-dates-exports-menu") as Migration;
  const { logger } = require("../../middlewares/activityLog.middleware") as { logger: object };
  /* eslint-enable @typescript-eslint/no-require-imports */

  const q = async (sql: string, replacements: object = {}): Promise<Row[]> => (await db.query(sql, { replacements }))[0];
  const ctx = (): { context: unknown } => ({ context: db.getQueryInterface() });

  const GRANTS_SQL = `SELECT r.name AS role, m.slug, p.permission_type AS type
                        FROM role_menu_permissions p JOIN roles r ON r.id = p.role_id JOIN menu_groups m ON m.id = p.menu_group_id
                       WHERE m.slug IN ${SLUGS} ORDER BY m.slug, r.name`;
  const GROUPS_SQL = `SELECT m.slug, m.is_active AS active, p.slug AS parent, m.id::text AS id
                        FROM menu_groups m LEFT JOIN menu_groups p ON p.id = m.parent_id
                       WHERE m.slug IN ${SLUGS} ORDER BY m.slug`;

  let seedGrants: Row[] = [];
  let seedGroups: Row[] = [];

  beforeAll(async () => {
    await runSchemaSetup({ sequelize: db, migrator, logger });
    await migrationService.seedAllRoles();
    const seeded = await migrationService.seedMenuGroupsAndItems();
    expect(seeded.errors).toEqual([]);
    seedGrants = await q(GRANTS_SQL);
    seedGroups = await q(GROUPS_SQL);
    // Back to a database seeded before 0142, plus an operator role that reads calibration only.
    await q(`DELETE FROM role_menu_permissions p USING menu_groups m WHERE p.menu_group_id = m.id AND m.slug IN ${SLUGS}`);
    await q(`DELETE FROM menu_groups WHERE slug IN ${SLUGS}`);
    await q("INSERT INTO roles (id, name, created_at, updated_at) VALUES (gen_random_uuid(), :name, now(), now())", { name: OPERATOR_ROLE });
    await q(`INSERT INTO role_menu_permissions (id, role_id, menu_group_id, permission_type, created_at, updated_at)
             SELECT gen_random_uuid(), r.id, m.id, 'read', now(), now() FROM roles r, menu_groups m WHERE r.name = :name AND m.slug = 'calibration'`, { name: OPERATOR_ROLE });
  });

  afterAll(async () => {
    await db.close();
  });

  it("the seed gives both entries ACTIVE under Equipment, read to every seeded role", () => {
    expect(seedGroups).toEqual([
      { slug: "calibration-dates", active: true, parent: "equipment", id: "a0000000-0000-0000-0000-000000000309" },
      { slug: "exports", active: true, parent: "equipment", id: "a0000000-0000-0000-0000-000000000310" },
    ]);
    expect(seedGrants.length).toBeGreaterThan(0);
    expect(seedGrants.every((g) => g["type"] === "read")).toBe(true);
    expect(seedGrants.filter((g) => g["slug"] === "exports").map((g) => g["role"])).toEqual(
      seedGrants.filter((g) => g["slug"] === "calibration-dates").map((g) => g["role"]),
    );
  });

  it("up restores exactly the seed's groups and grants, plus the operator role's read; a second up changes nothing", async () => {
    expect(await q(GROUPS_SQL)).toEqual([]);
    await m0142.up(ctx());
    expect(await q(GROUPS_SQL)).toEqual(seedGroups);
    const expected = [...seedGrants, { role: OPERATOR_ROLE, slug: "calibration-dates", type: "read" }, { role: OPERATOR_ROLE, slug: "exports", type: "read" }].sort(
      (a, b) => String(a["slug"]).localeCompare(String(b["slug"])) || String(a["role"]).localeCompare(String(b["role"])),
    );
    expect(await q(GRANTS_SQL)).toEqual(expected);
    await m0142.up(ctx());
    expect(await q(GRANTS_SQL)).toEqual(expected);
    expect(await q(GROUPS_SQL)).toEqual(seedGroups);
  });

  it("the application role reads the same rows", async () => {
    const t = await db.transaction();
    try {
      await db.query(`SET LOCAL ROLE ${APP_ROLE}`, { transaction: t });
      const [rows] = await db.query(GRANTS_SQL, { transaction: t });
      expect(rows).toEqual(await q(GRANTS_SQL));
    } finally {
      await t.rollback();
    }
  });

  it("down removes the groups and every grant on them; up restores them", async () => {
    await m0142.down(ctx());
    expect(await q(GROUPS_SQL)).toEqual([]);
    expect(await q(GRANTS_SQL)).toEqual([]);
    await m0142.up(ctx());
    expect(await q(GROUPS_SQL)).toEqual(seedGroups);
  });
});

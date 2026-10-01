/**
 * ADR-101 / ADR-102 against a REAL PostgreSQL 18 — migrations 0095 and 0097.
 *
 * On an EMPTY scratch database (drop and recreate it before each run): the
 * boot path (db.sync() + every migration), then the real role and menu seeds
 * (migration.service#seedAllRoles, #seedMenuGroupsAndItems). Then:
 *
 *  0095 — certificates.submitted_by exists (uuid, nullable), has its foreign
 *         key to users and its index; its back-fill takes the submitter from
 *         the latest SUBMIT_FOR_APPROVAL audit row of a submitted certificate
 *         and leaves a draft alone; re-running it is a no-op.
 *  0097 — on a database seeded BEFORE ADR-102 (the Stock and Object Storage
 *         groups and the ADR-102 grants removed, as they were), "up" creates
 *         both groups and restores exactly the grants the new seed gives
 *         (compared row by row with the seed's own), and a second "up"
 *         changes nothing.
 *
 *   UIFIX_PG_LIVE_TEST=1 DB_HOST=127.0.0.1 DB_PORT=55961 DB_NAME=callibrator_uifix \
 *     DB_USER=postgres DB_PASS=... npm test -- src/tests/migrations/uiCorrectness.adr101adr102.live --coverage=false
 */
import { env } from "../../config/env";

const live = env("UIFIX_PG_LIVE_TEST") === "1" ? describe : describe.skip;

type Row = Record<string, unknown>;
interface LiveDb {
  query(sql: string, options?: object): Promise<[Row[], unknown]>;
  close(): Promise<void>;
  getQueryInterface(): unknown;
}
interface Migration {
  up(o: { context: unknown }): Promise<void>;
  down(o: { context: unknown }): Promise<void>;
}

jest.setTimeout(900000);

live("ADR-101 / ADR-102 migrations on PostgreSQL 18", () => {
  /* eslint-disable @typescript-eslint/no-require-imports -- the JavaScript boot graph, typed by the members used */
  const { db } = require("../../config") as { db: LiveDb };
  const { migrator } = require("../../config/migrator") as { migrator: { up(): Promise<{ name: string }[]> } };
  const { runSchemaSetup } = require("../../utils/migrationLock.util") as {
    runSchemaSetup: (o: object) => Promise<unknown>;
  };
  const migrationService = require("../../services/migration.service") as {
    seedAllRoles(): Promise<unknown>;
    seedMenuGroupsAndItems(): Promise<{ errors: string[] }>;
  };
  const m0095 = require("../../migrations/0095-certificate-submitted-by") as Migration & { BACKFILL_SQL: string };
  const m0097 = require("../../migrations/0097-menu-effective-access") as Migration;
  const { logger } = require("../../middlewares/activityLog.middleware") as { logger: object };
  /* eslint-enable @typescript-eslint/no-require-imports */

  /** A raw query; a failure names the database's own message and the statement. */
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
                       WHERE m.slug IN ('stock','storage','tenants','tenant-hierarchy','kanban','api-keys','webhooks','attachments')
                       ORDER BY m.slug, r.name`;

  beforeAll(async () => {
    await runSchemaSetup({ sequelize: db, migrator, logger });
    await migrationService.seedAllRoles();
    const seeded = await migrationService.seedMenuGroupsAndItems();
    expect(seeded.errors).toEqual([]);
  });

  afterAll(async () => {
    await db.close();
  });

  it("0095: submitted_by is a nullable uuid with its foreign key to users and its index", async () => {
    const [col] = await q(
      `SELECT data_type, is_nullable FROM information_schema.columns
        WHERE table_name = 'certificates' AND column_name = 'submitted_by'`,
    );
    expect(col).toEqual({ data_type: "uuid", is_nullable: "YES" });
    const fks = await q(
      `SELECT ccu.table_name AS target FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
         JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
        WHERE tc.table_name = 'certificates' AND tc.constraint_type = 'FOREIGN KEY' AND kcu.column_name = 'submitted_by'`,
    );
    expect(fks).toEqual([{ target: "users" }]);
    const idx = await q("SELECT indexname FROM pg_indexes WHERE tablename = 'certificates' AND indexname = 'certificates_submitted_by'");
    expect(idx).toHaveLength(1);
  });

  it("0095: the back-fill takes the latest submitter from the audit trail, leaves drafts, and re-runs as a no-op", async () => {
    const T = "b1010101-0000-4000-8000-000000000101";
    const U1 = "b1010101-0000-4000-8000-000000000201";
    const U2 = "b1010101-0000-4000-8000-000000000202";
    const DEV = "b1010101-0000-4000-8000-000000000301";
    const PENDING = "b1010101-0000-4000-8000-000000000401";
    const DRAFT = "b1010101-0000-4000-8000-000000000402";
    await q(`INSERT INTO tenants (id, name, subdomain, email, created_at, updated_at)
             VALUES (:T, 'ADR-101 Hospital', 'adr101', 'adr101@live.test', now(), now())
             ON CONFLICT (id) DO NOTHING`, { T });
    const [role] = await q("SELECT id FROM roles WHERE name = 'HEALTHCARE ADMIN' LIMIT 1");
    for (const [id, name] of [[U1, "author101"], [U2, "resubmitter101"]]) {
      await q(
        `INSERT INTO users (id, tenant_id, role_id, username, email, password, first_name, last_name, created_at, updated_at)
         VALUES (:id, :T, :role, :name, :email, 'x', 'Live', 'Test', now(), now())
         ON CONFLICT (id) DO NOTHING`,
        { id, T, role: role?.["id"] ?? null, name, email: `${String(name)}@live.test` },
      );
    }
    await q(`INSERT INTO calibration_devices (id, tenant_id, name, serial_number, created_at, updated_at)
             VALUES (:DEV, :T, 'Pump', 'SN-101', now(), now())
             ON CONFLICT (id) DO NOTHING`, { DEV, T });
    for (const [id, status, num] of [[PENDING, "pending_approval", "C-101-1"], [DRAFT, "draft", "C-101-2"]]) {
      await q(
        `INSERT INTO certificates (id, tenant_id, device_id, certificate_number, status, created_by,
                                   verification_token, created_at, updated_at)
         VALUES (:id, :T, :DEV, :num, :status, :U1, md5(:id::text), now(), now())
         ON CONFLICT (id) DO UPDATE SET submitted_by = NULL`,
        { id, T, DEV, num, status, U1 },
      );
    }
    // Two submissions of the pending one (rejected, then re-submitted by U2); one of the draft.
    const audit = async (resource: string, user: string, at: string): Promise<void> => {
      await q(
        `INSERT INTO audit_logs (id, tenant_id, user_id, actor_type, action, resource_type, resource_id, changes, created_at)
         VALUES (gen_random_uuid(), :T, :user, 'user', 'UPDATE', 'Certificate', :resource,
                 '{"operation":"SUBMIT_FOR_APPROVAL"}'::jsonb, :at)`,
        { T, user, resource, at },
      );
    };
    await audit(PENDING, U1, "2026-09-01T00:00:00Z");
    await audit(PENDING, U2, "2026-09-02T00:00:00Z");
    await audit(DRAFT, U1, "2026-09-01T00:00:00Z");

    await m0095.up(ctx());
    await m0095.up(ctx());

    const rows = await q("SELECT id, submitted_by FROM certificates WHERE tenant_id = :T ORDER BY certificate_number", { T });
    expect(rows).toEqual([
      { id: PENDING, submitted_by: U2 },
      { id: DRAFT, submitted_by: null },
    ]);
  });

  it("0097: on a database seeded before ADR-102, up restores exactly what the new seed gives, and re-runs as a no-op", async () => {
    const seededGrants = await q(GRANTS_SQL);
    // Stock and Object Storage exist, and each non-super-admin grant listed in 0097 is there.
    expect(seededGrants.filter((g) => g["slug"] === "stock").length).toBeGreaterThanOrEqual(10);

    // Back to the database as seeded before ADR-102.
    await q(`DELETE FROM role_menu_permissions p USING menu_groups m
              WHERE p.menu_group_id = m.id AND m.slug IN ('stock','storage')`);
    await q("DELETE FROM menu_groups WHERE slug IN ('stock','storage')");
    await q(`DELETE FROM role_menu_permissions p USING menu_groups m, roles r
              WHERE p.menu_group_id = m.id AND p.role_id = r.id AND r.name <> 'SUPERADMIN'
                AND m.slug IN ('tenants','tenant-hierarchy','kanban','api-keys','webhooks','attachments')
                AND NOT (r.name IN ('CALIBRATOR ADMIN','ENGINEERING MANAGER','SUPERVISOR','TECHNICIAN') AND m.slug = 'kanban')
                AND NOT (r.name = 'HEALTHCARE ADMIN' AND m.slug = 'tenant-hierarchy')`);

    await m0097.up(ctx());
    const groups = await q("SELECT slug, parent_id IS NULL AS top FROM menu_groups WHERE slug IN ('stock','storage') ORDER BY slug");
    expect(groups).toEqual([
      { slug: "stock", top: true },
      { slug: "storage", top: false },
    ]);
    expect(await q(GRANTS_SQL)).toEqual(seededGrants);

    await m0097.up(ctx());
    expect(await q(GRANTS_SQL)).toEqual(seededGrants);
  });
});

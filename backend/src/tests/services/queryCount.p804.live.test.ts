/**
 * P8-04 (ADR-096) against a REAL PostgreSQL 18 — the statements a service call
 * issues, counted by Sequelize's `logging` callback (called once per executed
 * statement), and the connections it holds at once, counted on the connection
 * manager. (`beforeQuery` is not used: in this Sequelize build it fires twice
 * per statement.)
 *
 * The unit guard (queryShape.p804.test.ts) counts model calls. This one counts
 * what reaches the server, through the real models, the real tenant hooks and
 * the tenant context a request builds, so an N+1 that hides behind an
 * association, a scope or a hook still shows here:
 *
 *  - kanban listProjects: the statement count does not grow with the number of
 *    boards (1 board and 30 boards issue the same number; it was 3 per board);
 *  - kanban listSprints: constant in the number of sprints (it was 1 per sprint);
 *  - audit list: two statements (the page and the BOUNDED count), and the count
 *    stops at AUDIT_COUNT_CAP + 1 rows;
 *  - dashboard: all 20 aggregates run, never more than DASHBOARD_CONCURRENCY
 *    of them in flight at once (it was 20 against a 20-connection pool).
 *
 * OPT-IN — needs a SCRATCH database (its name must contain "scratch"). The suite
 * builds it the way the backend boots (fixtures/liveBoot#bootSchema: db.sync()
 * of the current models plus every migration, under the schema lock) before it
 * switches to the application role; on an already-built database that applies
 * nothing. (It used to ASSUME a database someone had built: on an empty one all
 * four cases failed in beforeAll with no message.) It writes one tenant
 * with fixed ids and leaves its audit rows behind: audit_logs is append-only
 * (0091), which is why the database must be a scratch one.
 *
 * A-283 (2026-09-30): it runs as `callibrator_app` (enterApplicationRole, with
 * its boot self-check), as the backend does after boot — the statements are
 * counted on the role that issues them in production, and the writes it
 * seeds are ones that role may make.
 *
 *   P804_PG_LIVE_TEST=1 DB_HOST=127.0.0.1 DB_PORT=... DB_NAME=callibrator_scratch_p804 \
 *     DB_USER=... DB_PASS=... npm test -- src/tests/services/queryCount.p804.live --coverage=false
 */
import { env } from "../../config/env";
import { LIVE_BOOT_TIMEOUT_MS } from "../fixtures/disposableDatabase";
import { bootSchema } from "../fixtures/liveBoot";

const live = env("P804_PG_LIVE_TEST") === "1" ? describe : describe.skip;

const TENANT = "a8040000-0000-4000-8000-000000000001";
const USER = "a8040000-0000-4000-8000-0000000000e1";
const CREATOR = "a8040000-0000-4000-8000-0000000000e2";
const BOARDS = 30;
const SPRINTS = 12;
const AUDIT_ROWS = 12_000;

type Row = Record<string, unknown>;
interface ConnectionManager {
  getConnection(options?: object): Promise<unknown>;
  releaseConnection(connection: unknown): unknown;
}
interface LiveDb {
  options: { logging: unknown };
  connectionManager: ConnectionManager;
  query(sql: string, options?: object): Promise<[Row[], unknown]>;
  close(): Promise<void>;
}
interface Services {
  kanban: {
    listProjects(u: object): Promise<Row[]>;
    listSprints(u: object, projectId: string): Promise<{ sprints: Row[]; backlogCount: number }>;
  };
  audit: {
    fetchAuditLogs(q: object): Promise<{ data: { rows: unknown[]; meta: Row } }>;
    AUDIT_COUNT_CAP: number;
  };
  dashboard: { getDashboardMetrics(t: string): Promise<{ data: Row }>; DASHBOARD_CONCURRENCY: number };
  tenantStorage: { run<T>(context: object, fn: () => Promise<T>): Promise<T> };
  dbRole: { enterApplicationRole(options: object): Promise<unknown> };
}

/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS services, typed by the members used */
const load = (): { db: LiveDb; s: Services; migrator: Parameters<typeof bootSchema>[1] } => {
  const db = (require("../../config") as { db: LiveDb }).db;
  db.options.logging = false;
  require("../../models");
  return {
    db,
    migrator: (require("../../config/migrator") as { migrator: Parameters<typeof bootSchema>[1] }).migrator,
    s: {
      kanban: require("../../services/kanban.service") as Services["kanban"],
      audit: require("../../services/audit.service") as Services["audit"],
      dashboard: require("../../services/dashboard.service") as Services["dashboard"],
      tenantStorage: (require("../../middlewares/tenantContext.middleware") as { tenantStorage: Services["tenantStorage"] })
        .tenantStorage,
      dbRole: require("../../utils/dbRole.util") as Services["dbRole"],
    },
  };
};
/* eslint-enable @typescript-eslint/no-require-imports */

live("P8-04 — statements per service call, on live PostgreSQL 18", () => {
  jest.setTimeout(120_000);
  let db: LiveDb;
  let s: Services;
  let statements = 0;
  let inFlight = 0;
  let peak = 0;
  let original: { get: ConnectionManager["getConnection"]; release: ConnectionManager["releaseConnection"] };

  const user = { id: USER, tenantId: TENANT, role: { id: null, name: "TENANT_ADMIN" } };

  /** Run `fn` in the context tenantContext.middleware builds, counting the statements it issues. */
  const counted = async <T>(fn: () => Promise<T>): Promise<{ result: T; statements: number; peak: number }> => {
    statements = 0;
    inFlight = 0;
    peak = 0;
    const result = await s.tenantStorage.run({ tenantId: TENANT, isSuperAdmin: false, isSystemTask: false }, fn);
    return { result, statements, peak };
  };

  const q = (sql: string, bind: unknown[] = []): Promise<[Row[], unknown]> => db.query(sql, { bind });

  const boards = async (n: number): Promise<string[]> => {
    await q("DELETE FROM kanban_cards WHERE tenant_id = $1", [TENANT]);
    await q("DELETE FROM kanban_project_members WHERE project_id IN (SELECT id FROM kanban_projects WHERE tenant_id = $1)", [TENANT]);
    await q("DELETE FROM kanban_sprints WHERE project_id IN (SELECT id FROM kanban_projects WHERE tenant_id = $1)", [TENANT]);
    await q("DELETE FROM kanban_columns WHERE project_id IN (SELECT id FROM kanban_projects WHERE tenant_id = $1)", [TENANT]);
    await q("DELETE FROM kanban_projects WHERE tenant_id = $1", [TENANT]);
    await q(
      `INSERT INTO kanban_projects (id, tenant_id, name, code, card_seq, created_by, created_at, updated_at)
       SELECT gen_random_uuid(), $1, 'Board ' || g, 'B' || g, 5, $2, now() - g * interval '1 minute', now()
         FROM generate_series(1, $3::int) g`,
      [TENANT, CREATOR, n],
    );
    await q(
      `INSERT INTO kanban_project_members (id, project_id, user_id, access_level, created_at, updated_at)
       SELECT gen_random_uuid(), id, $2, 'editor', now(), now() FROM kanban_projects WHERE tenant_id = $1`,
      [TENANT, USER],
    );
    await q(
      `INSERT INTO kanban_columns (id, project_id, name, position, is_done, created_at, updated_at)
       SELECT gen_random_uuid(), id, 'To Do', 0, false, now(), now() FROM kanban_projects WHERE tenant_id = $1`,
      [TENANT],
    );
    await q(
      `INSERT INTO kanban_sprints (id, project_id, name, status, position, created_at, updated_at)
       SELECT gen_random_uuid(), p.id, 'Sprint ' || g, 'planned', g, now(), now()
         FROM kanban_projects p, generate_series(1, $2::int) g WHERE p.tenant_id = $1`,
      [TENANT, SPRINTS],
    );
    await q(
      `INSERT INTO kanban_cards (id, tenant_id, project_id, column_id, sprint_id, number, card_key, title, position, created_at, updated_at)
       SELECT gen_random_uuid(), p.tenant_id, p.id, c.id,
              CASE WHEN g % 4 = 0 THEN NULL ELSE (SELECT id FROM kanban_sprints s WHERE s.project_id = p.id AND s.position = 1 + g % $2::int) END,
              g, p.code || '-' || g, 'Card ' || g, g, now(), now()
         FROM kanban_projects p JOIN kanban_columns c ON c.project_id = p.id, generate_series(1, 5) g
        WHERE p.tenant_id = $1`,
      [TENANT, SPRINTS],
    );
    const [rows] = await q("SELECT id FROM kanban_projects WHERE tenant_id = $1 ORDER BY name", [TENANT]);
    return rows.map((r) => String(r["id"]));
  };

  beforeAll(async () => {
    expect(env("DB_NAME")).toMatch(/scratch/);
    const loaded = load();
    ({ db, s } = loaded);
    // As the owner, before the role switch: sync + every migration (none pending on a built database).
    await bootSchema(loaded.db as unknown as Parameters<typeof bootSchema>[0], loaded.migrator);
    const quiet = { info: (): void => undefined, warn: (): void => undefined };
    await s.dbRole.enterApplicationRole({ sequelize: db, logger: quiet, env: { DB_APP_ROLE: "callibrator_app" } });
    const [[who]] = await db.query("SELECT current_user AS u");
    expect(who?.["u"]).toBe("callibrator_app");
    db.options.logging = () => {
      statements += 1;
    };
    const cm = db.connectionManager;
    original = { get: cm.getConnection.bind(cm), release: cm.releaseConnection.bind(cm) };
    const { get, release } = original;
    cm.getConnection = async (options?: object): Promise<unknown> => {
      const connection = await get(options);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      return connection;
    };
    cm.releaseConnection = (connection: unknown): unknown => {
      inFlight -= 1;
      return release(connection);
    };

    await q(
      `INSERT INTO tenants (id, name, subdomain, email, code, status, plan, is_deleted, created_at, updated_at)
       VALUES ($1, 'P804', 'p804-scratch', 'p804@scratch.test', 'P804', 'active', 'enterprise', false, now(), now())
       ON CONFLICT (id) DO NOTHING`,
      [TENANT],
    );
    await q(
      `INSERT INTO users (id, username, tenant_id, email, password, first_name, last_name, is_active, status, is_deleted, created_at, updated_at)
       VALUES ($1, 'p804-user', $3, 'p804-user@scratch.test', 'x', 'P', 'User', true, 'ACTIVE', false, now(), now()),
              ($2, 'p804-creator', $3, 'p804-creator@scratch.test', 'x', 'P', 'Creator', true, 'ACTIVE', false, now(), now())
       ON CONFLICT (id) DO NOTHING`,
      [USER, CREATOR, TENANT],
    );
    const [[existing]] = await q("SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id = $1", [TENANT]);
    if (Number(existing?.["n"]) < AUDIT_ROWS) {
      await q(
        `INSERT INTO audit_logs (id, tenant_id, user_id, actor_type, action, resource_type, resource_id, created_at)
         SELECT gen_random_uuid(), $1, $2, 'user', 'UPDATE', 'CalibrationDevice', g::text, now() - g * interval '1 minute'
           FROM generate_series(1, $3::int) g`,
        [TENANT, USER, AUDIT_ROWS],
      );
    }
  }, LIVE_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    db.options.logging = false;
    db.connectionManager.getConnection = original.get;
    db.connectionManager.releaseConnection = original.release;
    await boards(0);
    await db.close();
  });

  it("listProjects issues the same number of statements for 1 board and for 30", async () => {
    await boards(1);
    const one = await counted(() => s.kanban.listProjects(user));
    await boards(BOARDS);
    const many = await counted(() => s.kanban.listProjects(user));

    expect(one.result).toHaveLength(1);
    expect(many.result).toHaveLength(BOARDS);
    expect(many.result.every((p) => p["myAccess"] === "editor" && p["cardCount"] === 5)).toBe(true);
    expect(many.statements).toBe(one.statements);
    expect(many.statements).toBeLessThanOrEqual(3);
  });

  it("listSprints issues a constant number of statements for 12 sprints, with the right counts", async () => {
    const [first] = await boards(1);
    const res = await counted(() => s.kanban.listSprints(user, String(first)));

    expect(res.result.sprints).toHaveLength(SPRINTS);
    expect(res.result.backlogCount).toBe(1); // g = 4 of 1..5
    expect(res.result.sprints.reduce((sum, sp) => sum + Number(sp["cardCount"]), 0)).toBe(4);
    // assertAccess (project + members) + sprints + ONE grouped count
    expect(res.statements).toBeLessThanOrEqual(4);
  });

  it("the audit list issues two statements, and its count stops at the cap", async () => {
    const res = await counted(() => s.audit.fetchAuditLogs({ tenantId: TENANT, limit: 10 }));

    expect(res.statements).toBe(2);
    expect(res.result.data.rows).toHaveLength(10);
    expect(res.result.data.meta["total"]).toBe(s.audit.AUDIT_COUNT_CAP);
    expect(res.result.data.meta["totalIsCapped"]).toBe(true);
    expect((res.result.data.meta["window"] as Row)["defaulted"]).toBe(true);
  });

  it("the dashboard runs every aggregate holding at most DASHBOARD_CONCURRENCY connections", async () => {
    const res = await counted(() => s.dashboard.getDashboardMetrics(TENANT));

    expect(res.statements).toBe(25); // 24 aggregates (P21-07 added the condition and IPM figures) + the tenant row
    expect(res.peak).toBeLessThanOrEqual(s.dashboard.DASHBOARD_CONCURRENCY);
    expect((res.result.data["users"] as Row)["total"]).toBe(2);
  });
});

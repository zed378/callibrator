/**
 * P9-18 — the converted audit.service against a REAL PostgreSQL 18, AS
 * callibrator_app (never the owner — CLAUDE.md, Evidence), over the
 * append-only audit_logs of migration 0091 (ADR-095).
 *
 * auditLogAppendOnly.q34.live proves the table's triggers and grants, and
 * auditRollback.p611.live that logAction's row rolls back with its mutation.
 * This suite covers what neither drives through the service itself:
 *
 *  - recordAccountLock: the lock and its ACCOUNT_LOCKED row commit together,
 *    as `system:auth-lockout`, in the account's tenant — PLATFORM for a
 *    tenant-less account (Q-14) — and when the row cannot be written the lock
 *    is still persisted, on its own (A-126, fail secure);
 *  - logAction with a transaction re-throws a refused insert (A-41) and the
 *    transaction does not commit; without one it answers null;
 *  - the row it wrote is append-only to the application role;
 *  - fetchAuditLogs, in the tenant's request context, lists a system-actor row
 *    (user_id NULL — the LEFT join of `required: false`), and its bounded raw
 *    count, with its enum casts, runs for the application role.
 *
 * OPT-IN — an EMPTY or already-built SCRATCH database (the name must contain
 * "scratch"); the schema is built here (runSchemaSetup, the boot path). It
 * leaves audit rows behind: they are append-only.
 *
 *   P918_PG_LIVE_TEST=1 DB_HOST=127.0.0.1 DB_PORT=55918 \
 *     DB_NAME=callibrator_scratch_p918 DB_USER=postgres DB_PASS=... \
 *     npm test -- src/tests/services/auditService.p918.live --coverage=false
 */
import { env } from "../../config/env";

const live = env("P918_PG_LIVE_TEST") === "1" ? describe : describe.skip;

const APP_ROLE = "callibrator_app";
const TENANT = "a9180000-0000-4000-8000-000000000001";
const PLATFORM = "00000000-0000-4000-8000-000000000001";

type Row = Record<string, unknown>;
interface LiveTx {
  commit(): Promise<void>;
  rollback(): Promise<void>;
  finished?: string;
}
interface LiveDb {
  options: { logging: unknown };
  query(sql: string, options?: object): Promise<[Row[], unknown]>;
  transaction(): Promise<LiveTx>;
  close(): Promise<void>;
}
interface Audit {
  logAction(entry: object, options?: object): Promise<unknown>;
  recordAccountLock(params: object): Promise<boolean>;
  fetchAuditLogs(query: object): Promise<{ data: { rows: Row[]; count: number; meta: Row } }>;
}
interface Graph {
  db: LiveDb;
  migrator: { pending(): Promise<unknown[]> };
  migrationLock: { runSchemaSetup(options: object): Promise<unknown> };
  dbRole: { enterApplicationRole(options: object): Promise<unknown> };
  tenantStorage: { run(context: object, fn: () => void): void };
  audit: Audit;
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
      audit: require("../../services/audit.service") as Audit,
    };
  });
  if (!graph) {
    throw new Error("the module graph did not load");
  }
  return graph;
};
/* eslint-enable @typescript-eslint/no-require-imports */

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

live("P9-18 — audit.service on live PostgreSQL 18 as callibrator_app", () => {
  let owner: Graph;
  let app: Graph;
  let tenantUser = "";
  let platformUser = "";

  const rows = async (sql: string, replacements: object = {}): Promise<Row[]> => (await owner.db.query(sql, { replacements }))[0];

  const inTenant = <T>(work: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      app.tenantStorage.run({ tenantId: TENANT, isSuperAdmin: false, isSystemTask: false }, () => {
        work().then(resolve, reject);
      });
    });

  /** The lock write auth.service hands over: users.locked_until, in `t` when given. */
  const persistLockFor = (userId: string, until: Date) => (t: LiveTx | null): Promise<unknown> =>
    app.db.query("UPDATE users SET locked_until = :until, failed_login_attempts = 5 WHERE id = :id", {
      replacements: { until, id: userId },
      ...(t ? { transaction: t } : {}),
    });

  const lockedUntil = async (userId: string): Promise<string | null> => {
    const [row] = await rows("SELECT locked_until FROM users WHERE id = :id", { id: userId });
    const value = row?.["locked_until"];
    return value instanceof Date ? value.toISOString() : null;
  };

  const lockRows = (userId: string): Promise<Row[]> =>
    rows(
      `SELECT tenant_id, user_id, actor_type::text AS actor_type, actor_name, action::text AS action,
              resource_type, changes->>'endpoint' AS endpoint, changes->>'lockedUntil' AS until
         FROM audit_logs WHERE resource_id = :id AND action = 'ACCOUNT_LOCKED' ORDER BY created_at`,
      { id: userId },
    );

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
       VALUES (:t, 'P918 Hospital', 'p918', 'p918@live.test', now(), now()) ON CONFLICT (id) DO NOTHING`,
      { replacements: { t: TENANT } },
    );
    const insertUser = async (tenantId: string | null, handle: string): Promise<string> => {
      const [made] = await rows(
        `INSERT INTO users (id, tenant_id, username, email, password, first_name, last_name, avatar_url,
                            status, must_change_password, is_deleted, created_at, updated_at)
         VALUES (gen_random_uuid(), :t, :h, :e, 'x', 'P918', 'User', 'default.svg', 'ACTIVE', false, false, now(), now())
         RETURNING id`,
        { t: tenantId, h: `${handle}-${String(Date.now())}`, e: `${handle}-${String(Date.now())}@live.test` },
      );
      return String(made?.["id"]);
    };
    tenantUser = await insertUser(TENANT, "p918-tenant");
    platformUser = await insertUser(null, "p918-platform");

    app = startProcess();
    await app.dbRole.enterApplicationRole({ sequelize: app.db, logger, env: { DB_APP_ROLE: APP_ROLE } });
    const [who] = (await app.db.query("SELECT current_user AS u, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS s"))[0];
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

  it("recordAccountLock: the lock and its ACCOUNT_LOCKED row commit together, as system:auth-lockout, in the account's tenant", async () => {
    const until = new Date("2026-10-01T13:00:00.000Z");
    await expect(
      app.audit.recordAccountLock({
        persistLock: persistLockFor(tenantUser, until),
        user: { id: tenantUser, tenantId: TENANT },
        lockedUntil: until,
        failedAttempts: 5,
        endpoint: "login",
        ipAddress: "203.0.113.18",
        userAgent: "live",
      }),
    ).resolves.toBe(true);
    expect(await lockedUntil(tenantUser)).toBe(until.toISOString());
    expect(await lockRows(tenantUser)).toEqual([
      { tenant_id: TENANT, user_id: null, actor_type: "system", actor_name: "system:auth-lockout", action: "ACCOUNT_LOCKED", resource_type: "User", endpoint: "login", until: until.toISOString() },
    ]);
  });

  it("recordAccountLock: a tenant-less account's row goes to PLATFORM (Q-14)", async () => {
    const until = new Date("2026-10-01T14:00:00.000Z");
    await expect(
      app.audit.recordAccountLock({
        persistLock: persistLockFor(platformUser, until),
        user: { id: platformUser, tenantId: null },
        lockedUntil: until,
        failedAttempts: 5,
        endpoint: "mfaLogin",
        ipAddress: null,
        userAgent: null,
      }),
    ).resolves.toBe(true);
    const [row] = await lockRows(platformUser);
    expect(row?.["tenant_id"]).toBe(PLATFORM);
  });

  it("recordAccountLock fails secure: the row refused, the lock is still persisted on its own (A-126)", async () => {
    const until = new Date("2026-10-01T15:00:00.000Z");
    await owner.db.query("UPDATE users SET locked_until = NULL WHERE id = :id", { replacements: { id: tenantUser } });
    const before = (await lockRows(tenantUser)).length;
    jest.spyOn(app.audit, "logAction").mockRejectedValueOnce(new Error("audit insert refused"));

    await expect(
      app.audit.recordAccountLock({
        persistLock: persistLockFor(tenantUser, until),
        user: { id: tenantUser, tenantId: TENANT },
        lockedUntil: until,
        failedAttempts: 5,
        endpoint: "login",
        ipAddress: null,
        userAgent: null,
      }),
    ).resolves.toBe(false);
    expect(await lockedUntil(tenantUser)).toBe(until.toISOString());
    expect(await lockRows(tenantUser)).toHaveLength(before);
  });

  it("logAction re-throws a refused insert inside a transaction (A-41), and answers null outside one", async () => {
    const t = await app.db.transaction();
    await expect(
      app.audit.logAction(
        { tenantId: TENANT, userId: tenantUser, action: "NOT_AN_ACTION", resourceType: "User", resourceId: tenantUser },
        { transaction: t },
      ),
    ).rejects.toThrow('Invalid audit action "NOT_AN_ACTION"');
    await t.rollback();

    // A row PostgreSQL itself refuses: a user id that does not exist (0030's foreign key).
    const t2 = await app.db.transaction();
    await expect(
      app.audit.logAction(
        { tenantId: TENANT, userId: "a9180000-0000-4000-8000-00000000dead", action: "UPDATE", resourceType: "User", resourceId: "x" },
        { transaction: t2 },
      ),
    ).rejects.toThrow();
    await t2.rollback();
    expect(await rows("SELECT 1 FROM audit_logs WHERE resource_id = 'x' AND tenant_id = :t", { t: TENANT })).toEqual([]);

    await expect(
      app.audit.logAction({ tenantId: TENANT, userId: "a9180000-0000-4000-8000-00000000dead", action: "UPDATE", resourceType: "User", resourceId: "y" }),
    ).resolves.toBeNull();
  });

  it("the row it wrote is append-only to the application role (0091)", async () => {
    const written = (await app.audit.logAction({
      tenantId: TENANT,
      userId: tenantUser,
      action: "UPDATE",
      resourceType: "User",
      resourceId: tenantUser,
      changes: { field: "p918", password: "never-stored" },
    })) as Row;
    expect(written["id"]).toEqual(expect.any(String));
    const [stored] = await rows("SELECT changes->>'password' AS p FROM audit_logs WHERE id = :id", { id: written["id"] });
    expect(stored?.["p"]).not.toBe("never-stored");

    await expect(app.db.query("UPDATE audit_logs SET resource_type = 'Tampered' WHERE id = :id", { replacements: { id: written["id"] } })).rejects.toThrow();
    await expect(app.db.query("DELETE FROM audit_logs WHERE id = :id", { replacements: { id: written["id"] } })).rejects.toThrow();
    const [after] = await rows("SELECT resource_type FROM audit_logs WHERE id = :id", { id: written["id"] });
    expect(after?.["resource_type"]).toBe("User");
  });

  it("fetchAuditLogs in the tenant's context lists the system-actor row (user NULL) and counts with the app role", async () => {
    const result = await inTenant(() => app.audit.fetchAuditLogs({ tenantId: TENANT, resourceId: tenantUser, actorType: "system" }));
    expect(result.data.rows.length).toBeGreaterThanOrEqual(1);
    expect(result.data.rows.every((r) => r["actorType"] === "system" && r["userId"] === null && r["user"] === null)).toBe(true);
    expect(result.data.count).toBe(result.data.rows.length);
    expect(result.data.meta).toMatchObject({ totalIsCapped: false, window: { from: null, to: null, defaulted: false } });

    // Another tenant's id is overridden by the hooks, and the raw count binds the context's tenant too.
    const crossed = await inTenant(() => app.audit.fetchAuditLogs({ tenantId: PLATFORM, resourceId: platformUser }));
    expect(crossed.data.rows).toEqual([]);
    expect(crossed.data.count).toBe(0);
  });
});

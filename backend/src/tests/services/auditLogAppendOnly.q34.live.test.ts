/**
 * Q-34 (ADR-095) against a REAL PostgreSQL 18 — migration 0091 makes
 * audit_logs append-only; the one UPDATE it admits is GDPR masking.
 *
 * The unit suite proves what 0091 issues. Only a real server proves that the
 * trigger fires, for whom, which updates it admits, that the application role
 * really lost UPDATE/DELETE/TRUNCATE (tested AS callibrator_app, never as the
 * owner — CLAUDE.md, Evidence), that the owner — here a SUPERUSER, as in
 * compose — is refused by the trigger too, even under
 * session_replication_role = replica, and that the masking service still
 * works through all of it.
 *
 * Two modes, each on its own EMPTY scratch database:
 *   Q34_MODE=upgrade  db.sync(), migrations up to 0090, audit rows written —
 *                     and the defect shown (the role CAN delete them) — then
 *                     the rest of the migrations (0091) run over those rows.
 *   Q34_MODE=fresh    the boot path: runSchemaSetup (sync + every migration).
 *
 *   Q34_MODE=upgrade DB_HOST=127.0.0.1 DB_PORT=55934 \
 *     DB_NAME=callibrator_scratch_q34u DB_USER=postgres DB_PASS=... \
 *     npm run test:live:jest -- src/tests/services/auditLogAppendOnly.q34.live
 */
import { env } from "../../config/env";

const MODE = env("Q34_MODE") === "fresh" ? "fresh" : "upgrade";

const APP_ROLE = "callibrator_app";
const TENANT = "a3a3a3a3-0000-4000-8000-000000000034";
const MASK = "[REDACTED]";

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
interface Graph {
  db: LiveDb;
  migrator: { up(options?: object): Promise<unknown>; pending(): Promise<unknown[]> };
  migrationLock: { runSchemaSetup(options: object): Promise<unknown> };
  schemaVerify: {
    verifySchema(db: LiveDb): Promise<{ problems: string[]; objects: number }>;
    EXPECTED_OBJECTS: readonly unknown[];
  };
  dbRole: { enterApplicationRole(options: object): Promise<unknown> };
  retention: {
    maskPII(tenantId: string, entityType: string, ids: string[], actor: object): Promise<{ masked: number; fields: string[] }>;
  };
  tenantStorage: { run(context: object, fn: () => void): void };
  m0091: { up(o: { context: unknown }): Promise<void>; down(o: { context: unknown }): Promise<void> };
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
      migrationLock: require("../../utils/migrationLock.util") as Graph["migrationLock"],
      schemaVerify: require("../../utils/schemaVerify.util") as Graph["schemaVerify"],
      dbRole: require("../../utils/dbRole.util") as Graph["dbRole"],
      retention: require("../../services/dataRetention.service") as Graph["retention"],
      tenantStorage: (require("../../middlewares/tenantContext.middleware") as { tenantStorage: Graph["tenantStorage"] })
        .tenantStorage,
      m0091: require("../../migrations/0091-audit-logs-append-only") as Graph["m0091"],
    };
    require("../../models");
  });
  if (!graph) {
    throw new Error("the module graph did not load");
  }
  return graph;
};
/* eslint-enable @typescript-eslint/no-require-imports */

/** The first row `sql` returns; throws when there is none. */
const one = async (db: LiveDb, sql: string, options: object = {}): Promise<Row> => {
  const [rows] = await db.query(sql, options);
  const row = rows[0];
  if (!row) {
    throw new Error(`no row from: ${sql}`);
  }
  return row;
};

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

/** The error `sql` raises inside a savepoint of `t` (optionally as `role`), or null. */
const errorOf = async (db: LiveDb, t: LiveTx, sql: string, replacements: object = {}, role: string | null = null) => {
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
    return err as Error;
  }
};

/** Run `work` in a transaction that is always rolled back. */
const inRolledBack = async <T>(db: LiveDb, work: (t: LiveTx) => Promise<T>): Promise<T> => {
  const t = await db.transaction();
  try {
    return await work(t);
  } finally {
    await t.rollback();
  }
};

describe(`Q-34 — audit_logs append-only on live PostgreSQL 18 (${MODE})`, () => {
  let g: Graph;
  const ids = { subject: "", admin: "", actedBySubject: "", aboutSubject: "", other: "" };

  const auditRow = async (fields: {
    userId?: string | null;
    resourceType: string;
    resourceId?: string | null;
    changes: object;
    ip?: string | null;
    ua?: string | null;
  }): Promise<string> => {
    const row = await one(g.db,
      `INSERT INTO audit_logs (id, tenant_id, user_id, actor_type, action, resource_type, resource_id,
                               changes, ip_address, user_agent, created_at)
       VALUES (gen_random_uuid(), :tenant, :userId, 'user', 'UPDATE', :resourceType, :resourceId,
               CAST(:changes AS jsonb), :ip, :ua, now())
       RETURNING id`,
      {
        replacements: {
          tenant: TENANT,
          userId: fields.userId ?? null,
          resourceType: fields.resourceType,
          resourceId: fields.resourceId ?? null,
          changes: JSON.stringify(fields.changes),
          ip: fields.ip ?? null,
          ua: fields.ua ?? null,
        },
      },
    );
    return String(row["id"]);
  };

  const rowOf = async (id: string) => {
    const row = await one(g.db,
      "SELECT action::text AS action, resource_type, ip_address, user_agent, changes FROM audit_logs WHERE id = :id",
      { replacements: { id } },
    );
    return row;
  };

  beforeAll(async () => {
    const name = env("DB_NAME") ?? "";
    if (!name.includes("scratch")) {
      throw new Error(`Refusing to rebuild DB_NAME="${name}": use a scratch database (see the header)`);
    }
    g = startProcess();
    const who = await one(g.db, "SELECT rolsuper FROM pg_roles WHERE rolname = current_user");
    expect(who["rolsuper"]).toBe(true); // the owner under test is a superuser, as in compose

    if (MODE === "fresh") {
      await g.migrationLock.runSchemaSetup({ sequelize: g.db, migrator: g.migrator, logger });
    } else {
      await g.db.sync();
      await g.migrator.up({ to: "0090-webhook-secret-rotation-overlap.js" });
    }

    await g.db.query(
      `INSERT INTO tenants (id, name, subdomain, email, created_at, updated_at)
       VALUES (:t, 'Q34 Hospital', 'q34', 'q34@live.test', now(), now())`,
      { replacements: { t: TENANT } },
    );
    const subject = await one(g.db,
      `INSERT INTO users (id, tenant_id, username, email, password, first_name, last_name, avatar_url,
                          status, must_change_password, is_deleted, created_at, updated_at)
       VALUES (gen_random_uuid(), :t, 'q34-subject', 'q34-subject@live.test', 'x', 'Siti', 'Rahma', 'default.svg',
               'ACTIVE', false, false, now(), now())
       RETURNING id`,
      { replacements: { t: TENANT } },
    );
    ids.subject = String(subject["id"]);
    const admin = await one(g.db,
      `INSERT INTO users (id, tenant_id, username, email, password, first_name, last_name, avatar_url,
                          status, must_change_password, is_deleted, created_at, updated_at)
       VALUES (gen_random_uuid(), :t, 'q34-admin', 'q34-admin@live.test', 'x', 'Q34', 'Admin', 'default.svg',
               'ACTIVE', false, false, now(), now())
       RETURNING id`,
      { replacements: { t: TENANT } },
    );
    ids.admin = String(admin["id"]);

    // Rows written BEFORE 0091 in upgrade mode (existing trail), after it in fresh mode.
    ids.actedBySubject = await auditRow({
      userId: ids.subject,
      resourceType: "CalibrationDevice",
      resourceId: "11111111-0000-4000-8000-000000000001",
      changes: { before: { status: "active" }, after: { status: "retired" }, meta: { ip: "10.0.0.7", tags: [1, 2] } },
      ip: "10.0.0.7",
      ua: "Mozilla/5.0 (Q34)",
    });
    ids.aboutSubject = await auditRow({
      userId: ids.admin,
      resourceType: "User",
      resourceId: ids.subject,
      changes: { before: { email: "q34-subject@live.test", firstName: "Siti" }, after: { email: "new@live.test" } },
      ip: "10.0.0.9",
      ua: "AdminBrowser/1",
    });
    ids.other = await auditRow({
      userId: ids.admin,
      resourceType: "Tenant",
      resourceId: TENANT,
      changes: { before: { name: "Old" }, after: { name: "New" } },
      ip: "10.0.0.9",
      ua: "AdminBrowser/1",
    });

    if (MODE === "upgrade") {
      // FAIL-BEFORE: without 0091 the application role deletes and rewrites the trail.
      await inRolledBack(g.db, async (t) => {
        expect(await errorOf(g.db, t, "DELETE FROM audit_logs WHERE id = :id", { id: ids.other }, APP_ROLE)).toBeNull();
        expect(
          await errorOf(g.db, t, "UPDATE audit_logs SET action = 'LOGIN' WHERE id = :id", { id: ids.other }, APP_ROLE),
        ).toBeNull();
        expect(await errorOf(g.db, t, "DELETE FROM audit_logs WHERE id = :id", { id: ids.other })).toBeNull();
      });
      await g.migrator.up();
    }
    expect(await g.migrator.pending()).toEqual([]);
  }, 180000);

  afterAll(async () => {
    await g.db.close();
  });

  it("both triggers exist on audit_logs, ENABLED ALWAYS, and the boot schema check passes", async () => {
    const [rows] = await g.db.query(
      `SELECT tgname, tgenabled FROM pg_trigger
        WHERE tgrelid = 'audit_logs'::regclass AND NOT tgisinternal ORDER BY tgname`,
    );
    expect(rows).toEqual([
      { tgname: "audit_logs_append_only", tgenabled: "A" },
      { tgname: "audit_logs_no_truncate", tgenabled: "A" },
    ]);
    const result = await g.schemaVerify.verifySchema(g.db);
    expect(result.problems).toEqual([]);
    expect(result.objects).toBe(g.schemaVerify.EXPECTED_OBJECTS.length);
  });

  it("the application role's privileges, read AS the role: INSERT and SELECT, UPDATE on the three maskable columns only, no DELETE/TRUNCATE", async () => {
    await inRolledBack(g.db, async (t) => {
      await g.db.query(`SET LOCAL ROLE ${APP_ROLE}`, { transaction: t });
      const p = await one(g.db,
        `SELECT current_user AS who,
                has_table_privilege('audit_logs', 'INSERT') AS ins,
                has_table_privilege('audit_logs', 'SELECT') AS sel,
                has_table_privilege('audit_logs', 'UPDATE') AS upd_table,
                has_table_privilege('audit_logs', 'DELETE') AS del,
                has_table_privilege('audit_logs', 'TRUNCATE') AS trunc,
                has_column_privilege('audit_logs', 'ip_address', 'UPDATE') AS upd_ip,
                has_column_privilege('audit_logs', 'user_agent', 'UPDATE') AS upd_ua,
                has_column_privilege('audit_logs', 'changes', 'UPDATE') AS upd_changes,
                has_column_privilege('audit_logs', 'action', 'UPDATE') AS upd_action,
                has_column_privilege('audit_logs', 'user_id', 'UPDATE') AS upd_user`,
        { transaction: t },
      );
      expect(p).toEqual({
        who: APP_ROLE,
        ins: true,
        sel: true,
        upd_table: false,
        del: false,
        trunc: false,
        upd_ip: true,
        upd_ua: true,
        upd_changes: true,
        upd_action: false,
        upd_user: false,
      });
    });
  });

  it("AS callibrator_app: DELETE, TRUNCATE and a content UPDATE are refused by privilege; a non-mask ip/changes UPDATE by the trigger", async () => {
    await inRolledBack(g.db, async (t) => {
      const as = (sql: string) => errorOf(g.db, t, sql, { id: ids.other }, APP_ROLE);
      expect((await as("DELETE FROM audit_logs WHERE id = :id"))?.message).toMatch(/permission denied for table audit_logs/);
      expect((await as("TRUNCATE audit_logs"))?.message).toMatch(/permission denied for table audit_logs/);
      expect((await as("UPDATE audit_logs SET action = 'LOGIN' WHERE id = :id"))?.message).toMatch(
        /permission denied for table audit_logs/,
      );
      expect((await as("UPDATE audit_logs SET ip_address = '1.2.3.4' WHERE id = :id"))?.message).toMatch(
        /can only have personal data masked/,
      );
      expect(
        (await as("UPDATE audit_logs SET changes = '{\"before\":{\"name\":\"Forged\"},\"after\":{\"name\":\"New\"}}' WHERE id = :id"))
          ?.message,
      ).toMatch(/can only have personal data masked/);
      // INSERT still works as the role — the trail keeps growing.
      expect(
        await as(
          `INSERT INTO audit_logs (id, tenant_id, actor_type, actor_name, action, resource_type, created_at)
           VALUES (gen_random_uuid(), '${TENANT}', 'system', 'system:retention-purge', 'UPDATE', 'Probe', now())`,
        ),
      ).toBeNull();
    });
  });

  it("AS THE OWNER (a superuser): DELETE, TRUNCATE and every forging UPDATE are refused by the trigger — even with session_replication_role = replica", async () => {
    await inRolledBack(g.db, async (t) => {
      const owner = (sql: string) => errorOf(g.db, t, sql, { id: ids.other });
      expect((await owner("DELETE FROM audit_logs WHERE id = :id"))?.message).toMatch(/audit row .* cannot be deleted/);
      expect((await owner("DELETE FROM audit_logs"))?.message).toMatch(/cannot be deleted/);
      expect((await owner("TRUNCATE audit_logs"))?.message).toMatch(/TRUNCATE is refused/);
      expect((await owner("TRUNCATE audit_logs CASCADE"))?.message).toMatch(/TRUNCATE is refused/);
      for (const forge of [
        "UPDATE audit_logs SET action = 'LOGIN' WHERE id = :id",
        "UPDATE audit_logs SET resource_id = 'x' WHERE id = :id",
        "UPDATE audit_logs SET created_at = now() - interval '1 year' WHERE id = :id",
        "UPDATE audit_logs SET ip_address = '8.8.8.8' WHERE id = :id",
        "UPDATE audit_logs SET user_agent = NULL WHERE id = :id",
        "UPDATE audit_logs SET changes = '{\"before\":{\"name\":\"Old\"},\"after\":{\"name\":\"Forged\"}}' WHERE id = :id",
        `UPDATE audit_logs SET changes = '{"before":{"name":"Old"},"after":{"name":"New"},"extra":"${MASK}"}' WHERE id = :id`,
        "UPDATE audit_logs SET changes = '{\"before\":{\"name\":\"Old\"}}' WHERE id = :id",
        `UPDATE audit_logs SET changes = to_jsonb('${MASK}'::text) WHERE id = :id`,
        "UPDATE audit_logs SET changes = NULL WHERE id = :id",
      ]) {
        const message = (await owner(forge))?.message ?? "no error";
        expect(`${forge} -> ${message}`).toMatch(/ -> .*can only have personal data masked/);
      }
      await g.db.query("SET LOCAL session_replication_role = replica", { transaction: t });
      expect((await owner("DELETE FROM audit_logs WHERE id = :id"))?.message).toMatch(/cannot be deleted/);
      expect((await owner("UPDATE audit_logs SET action = 'LOGIN' WHERE id = :id"))?.message).toMatch(
        /can only have personal data masked/,
      );
    });
    expect(await rowOf(ids.other)).toEqual({
      action: "UPDATE",
      resource_type: "Tenant",
      ip_address: "10.0.0.9",
      user_agent: "AdminBrowser/1",
      changes: { before: { name: "Old" }, after: { name: "New" } },
    });
  });

  it("the owner may mask (the rule is the same for every role), and a mask is final", async () => {
    await inRolledBack(g.db, async (t) => {
      const owner = (sql: string) => errorOf(g.db, t, sql, { id: ids.other });
      await g.db.query(
        `UPDATE audit_logs SET ip_address = '${MASK}', changes = jsonb_set(changes, '{after,name}', to_jsonb('${MASK}'::text))
          WHERE id = :id`,
        { transaction: t, replacements: { id: ids.other } },
      );
      expect((await owner("UPDATE audit_logs SET ip_address = '10.0.0.9' WHERE id = :id"))?.message).toMatch(
        /can only have personal data masked/,
      );
      expect(
        (await owner("UPDATE audit_logs SET changes = jsonb_set(changes, '{after,name}', '\"New\"') WHERE id = :id"))
          ?.message,
      ).toMatch(/can only have personal data masked/);
    });
  });

  it("GDPR masking still works end to end AS callibrator_app (dataRetention.maskPII), and changes nothing else", async () => {
    const app = startProcess();
    try {
      await app.dbRole.enterApplicationRole({ sequelize: app.db, logger, env: { DB_APP_ROLE: APP_ROLE } });
      const who = await one(app.db, "SELECT current_user AS u");
      expect(who["u"]).toBe(APP_ROLE);

      const result = await new Promise<{ masked: number; fields: string[] }>((resolve, reject) => {
        app.tenantStorage.run({ tenantId: TENANT, isSuperAdmin: false, isSystemTask: false }, () => {
          app.retention
            .maskPII(TENANT, "audit_logs", [ids.subject], { userId: ids.admin, ipAddress: "10.9.9.9" })
            .then(resolve, reject);
        });
      });
      expect(result).toEqual({ masked: 2, fields: ["changes", "ipAddress", "userAgent"] });

      expect(await rowOf(ids.actedBySubject)).toEqual({
        action: "UPDATE",
        resource_type: "CalibrationDevice",
        ip_address: MASK,
        user_agent: MASK,
        changes: { before: { status: "active" }, after: { status: "retired" }, meta: { ip: MASK, tags: [1, 2] } },
      });
      expect(await rowOf(ids.aboutSubject)).toEqual({
        action: "UPDATE",
        resource_type: "User",
        ip_address: "10.0.0.9",
        user_agent: "AdminBrowser/1",
        changes: { before: { email: MASK, firstName: MASK }, after: { email: MASK } },
      });
      expect((await rowOf(ids.other))["changes"]).toEqual({ before: { name: "Old" }, after: { name: "New" } });

      // The masking itself is audited (inserted by the role, in the same transaction).
      const audit = await one(g.db,
        `SELECT count(*)::int AS n FROM audit_logs
          WHERE tenant_id = :t AND resource_type = 'AuditLog' AND changes->>'operation' = 'GDPR_MASK_AUDIT_PII'`,
        { replacements: { t: TENANT } },
      );
      expect(audit["n"]).toBe(1);

      // Idempotent: a second pass finds nothing left to mask.
      const again = await new Promise<{ masked: number }>((resolve, reject) => {
        app.tenantStorage.run({ tenantId: TENANT, isSuperAdmin: false, isSystemTask: false }, () => {
          app.retention
            .maskPII(TENANT, "audit_logs", [ids.subject], { userId: ids.admin })
            .then(resolve, reject);
        });
      });
      expect(again.masked).toBe(0);
    } finally {
      await app.db.close();
    }
  });

  it("down restores the old shape (the role may DELETE again) and a second up restores the control", async () => {
    const qi = g.db.getQueryInterface();
    await g.m0091.down({ context: qi });
    await inRolledBack(g.db, async (t) => {
      expect(await errorOf(g.db, t, "DELETE FROM audit_logs WHERE id = :id", { id: ids.other }, APP_ROLE)).toBeNull();
    });
    const [none] = await g.db.query(
      "SELECT tgname FROM pg_trigger WHERE tgrelid = 'audit_logs'::regclass AND NOT tgisinternal",
    );
    expect(none).toEqual([]);

    await g.m0091.up({ context: qi });
    await g.m0091.up({ context: qi }); // idempotent
    await inRolledBack(g.db, async (t) => {
      expect(
        (await errorOf(g.db, t, "DELETE FROM audit_logs WHERE id = :id", { id: ids.other }, APP_ROLE))?.message,
      ).toMatch(/permission denied/);
      expect((await errorOf(g.db, t, "DELETE FROM audit_logs WHERE id = :id", { id: ids.other }))?.message).toMatch(
        /cannot be deleted/,
      );
    });
    const count = await one(g.db,
      "SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid = 'audit_logs'::regclass AND NOT tgisinternal",
    );
    expect(count["n"]).toBe(2);
  });
});

/**
 * P6-13 / ADR-085 — migration 0090 and the webhook secret rotation against a
 * REAL PostgreSQL.
 *
 * The unit suites mock AuditLog.create. That is how every rotation and every
 * url change shipped broken: the service wrote audit rows with no `actorType`,
 * which audit_logs has required (NOT NULL) since migration 0033, so the real
 * INSERT failed and the rotation rolled back with a 500. Here the rows reach
 * PostgreSQL.
 *
 * Covers, on one scratch database:
 *   1. FRESH BOOT — db.sync() then every migration through the real migrator
 *      (runSchemaSetup, as index.js boots); 0090 is a no-op (sync made the
 *      columns) and the P6-05 schema verification passes.
 *   2. UPGRADE — the columns dropped and 0090 un-recorded (a database as it
 *      was before this change), with a live webhook row; the migrator applies
 *      0090 alone, adds both columns NULL, keeps the row; verification passes.
 *   3. RE-RUN — nothing pending, nothing changes. DOWN — both columns go and
 *      verification fails loudly; UP again restores them.
 *   4. The service on the real schema, AS callibrator_app (A-283; 1–3 are
 *      owner DDL): a rotation stores the previous secret as an envelope, sets
 *      its expiry, and writes a named-actor audit row in the same
 *      transaction; a url change clears the previous secret.
 *
 * OPT-IN — an EMPTY scratch database the connecting role owns (it is rebuilt
 * with db.sync({ force: true })), whose name contains "scratch" or ends "_p6":
 *
 *   DATA_PG_LIVE_TEST=1 DB_HOST=127.0.0.1 DB_PORT=56613 DB_NAME=callibrator_p6 \
 *     DB_USER=cal_owner DB_PASS=owner \
 *     npm test -- src/tests/migrations/0090-webhook-secret-rotation-overlap.p613.live --coverage=false
 */

const live = process.env.DATA_PG_LIVE_TEST === "1" ? describe : describe.skip;

const TENANT = "a6130000-0000-4000-8000-00000000000a";
const HOOK = "a6130000-0000-4000-8000-0000000000f1";
const NAME = "0090-webhook-secret-rotation-overlap.js";
const COLUMNS = ["previous_secret", "previous_secret_expires_at"];
const logger = { info: () => {}, warn: () => {}, error: () => {} };
const { enterAppRole, APP_ROLE } = require("../fixtures/liveBoot");

live("P6-13 — migration 0090 and webhook rotation on live PostgreSQL", () => {
  let db;
  let migrator;
  let runSchemaSetup;
  let verifySchema;
  let webhookService;
  let tenantStorage;
  let kms;
  let userId;

  const columnsOf = async () =>
    (
      await db.query(
        `SELECT column_name, data_type, is_nullable FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = 'webhooks'
            AND column_name IN (:cols) ORDER BY column_name`,
        { type: "SELECT", replacements: { cols: COLUMNS } },
      )
    ).map((c) => `${c.column_name}:${c.data_type}:${c.is_nullable}`);

  const EXPECTED = [
    "previous_secret:text:YES",
    "previous_secret_expires_at:timestamp with time zone:YES",
  ];

  const asTenant = (fn) =>
    tenantStorage.run({ tenantId: TENANT, isSuperAdmin: false, isSystemTask: false }, fn);

  beforeAll(async () => {
    const name = process.env.DB_NAME || "";
    if (!/scratch|_p6$/.test(name)) {
      throw new Error(`Refusing to rebuild DB_NAME="${name}": use a scratch database (see the header)`);
    }
    ({ db } = require("../../config"));
    db.options.logging = false;
    ({ migrator } = require("../../config/migrator"));
    ({ runSchemaSetup } = require("../../utils/migrationLock.util"));
    ({ verifySchema } = require("../../utils/schemaVerify.util"));
    webhookService = require("../../services/webhook.service");
    ({ tenantStorage } = require("../../middlewares/tenantContext.middleware"));
    kms = require("../../services/kms.service");
    require("../../models");
    await db.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await db.query("CREATE EXTENSION IF NOT EXISTS vector");
  }, 120000);

  afterAll(async () => {
    await db.close();
  });

  it("FRESH BOOT: sync + every migration; 0090 is recorded, the columns are there, the schema verifies", async () => {
    await runSchemaSetup({ sequelize: db, migrator, logger });
    const applied = (await migrator.executed()).map((m) => m.name);
    expect(applied).toContain(NAME);
    expect(await columnsOf()).toEqual(EXPECTED);
    const result = await verifySchema(db);
    expect(result.problems).toEqual([]);
  }, 300000);

  it("UPGRADE: a pre-0090 database with a live webhook gains both columns, NULL, and keeps the row", async () => {
    await db.query(
      `INSERT INTO tenants (id, name, subdomain, email, created_at, updated_at)
       VALUES (:t, 'P6-13', 'p6-13', 'p613@live.test', now(), now())`,
      { replacements: { t: TENANT } },
    );
    const [[user]] = await db.query(
      `INSERT INTO users (id, tenant_id, username, email, password, first_name, last_name, avatar_url,
                          status, must_change_password, is_deleted, created_at, updated_at)
       VALUES (gen_random_uuid(), :t, 'p613', 'p613@live.test', 'x', 'P6', '13', 'default.svg',
               'ACTIVE', false, false, now(), now())
       RETURNING id`,
      { replacements: { t: TENANT } },
    );
    userId = user.id;
    const sealed = kms.encryptData(TENANT, "0".repeat(64));
    await db.query(
      `INSERT INTO webhooks (id, tenant_id, url, events, secret, is_active, is_deleted, created_at, updated_at)
       VALUES (:id, :t, 'https://receiver.example.com/hook', '["*"]', :s, true, false, now(), now())`,
      { replacements: { id: HOOK, t: TENANT, s: sealed } },
    );
    // The database as it was before this change.
    await db.query("ALTER TABLE webhooks DROP COLUMN previous_secret, DROP COLUMN previous_secret_expires_at");
    await db.query("DELETE FROM schema_migrations WHERE name = :n", { replacements: { n: NAME } });
    expect(await columnsOf()).toEqual([]);

    const ran = (await migrator.up()).map((m) => m.name);
    expect(ran).toEqual([NAME]);
    expect(await columnsOf()).toEqual(EXPECTED);
    const [[row]] = await db.query(
      "SELECT secret, previous_secret, previous_secret_expires_at FROM webhooks WHERE id = :id",
      { replacements: { id: HOOK } },
    );
    expect(row).toEqual({ secret: sealed, previous_secret: null, previous_secret_expires_at: null });
    expect((await verifySchema(db)).problems).toEqual([]);
  }, 120000);

  it("RE-RUN is a no-op; DOWN drops both columns (and verification says so); UP restores them", async () => {
    expect(await migrator.pending()).toEqual([]);
    expect(await migrator.up()).toEqual([]);
    expect(await columnsOf()).toEqual(EXPECTED);

    const m0090 = require("../../migrations/0090-webhook-secret-rotation-overlap");
    const qi = db.getQueryInterface();
    // up() again on a database that has the columns: a no-op, not an error.
    await m0090.up({ context: qi });
    expect(await columnsOf()).toEqual(EXPECTED);

    // `down({ to: NAME })` reverts every migration from the newest back to
    // 0090 inclusive — 0090 is no longer the last one — and `up` re-applies
    // exactly those (A-283, 2026-09-30: this said [NAME] while 0090 was last).
    const fromNameOn = (await migrator.executed()).map((m) => m.name).filter((n) => n >= NAME);
    expect(fromNameOn[0]).toBe(NAME);
    await migrator.down({ to: NAME });
    expect(await columnsOf()).toEqual([]);
    const afterDown = await verifySchema(db);
    expect(afterDown.problems.join("\n")).toMatch(/previous_secret/);
    // down() twice is a no-op too.
    await m0090.down({ context: qi });

    expect((await migrator.up()).map((m) => m.name)).toEqual(fromNameOn);
    expect(await columnsOf()).toEqual(EXPECTED);
    expect((await verifySchema(db)).problems).toEqual([]);
  }, 120000);

  // A-283: the migration tests above need the owner (DDL). The service tests
  // below are the application's path, so they run as callibrator_app — as the
  // owner they would pass whether the role may UPDATE webhooks or INSERT an
  // audit row or not (CLAUDE.md § Evidence).
  it("from here on, every query runs as callibrator_app, not the owner", async () => {
    await enterAppRole(db);
    const [[who]] = await db.query("SELECT current_user AS u, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS s");
    expect(who).toEqual({ u: APP_ROLE, s: false });
  });

  it("a rotation on the real schema: previous secret kept as an envelope, expiry set, named-actor audit row in the same transaction", async () => {
    const actor = { userId, ipAddress: "127.0.0.1", userAgent: "p613-live" };
    const result = await asTenant(() => webhookService.rotateSecret(TENANT, HOOK, actor, { overlapHours: 24 }));
    expect(result.secret).toMatch(/^[0-9a-f]{64}$/);

    const [[row]] = await db.query(
      "SELECT secret, previous_secret, previous_secret_expires_at FROM webhooks WHERE id = :id",
      { replacements: { id: HOOK } },
    );
    expect(row.previous_secret.startsWith("v2:")).toBe(true);
    expect(kms.decryptData(TENANT, row.previous_secret)).toBe("0".repeat(64));
    expect(kms.decryptData(TENANT, row.secret)).toBe(result.secret);
    expect(new Date(row.previous_secret_expires_at).getTime()).toBeGreaterThan(Date.now() + 23 * 3600e3);

    const audits = await db.query(
      `SELECT user_id, actor_type, action, changes::text AS changes FROM audit_logs
        WHERE resource_type = 'Webhook' AND resource_id = :id ORDER BY created_at`,
      { type: "SELECT", replacements: { id: HOOK } },
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ user_id: userId, action: "UPDATE" });
    expect(audits[0].changes).not.toContain(result.secret);
    expect(audits[0].changes).not.toContain("0".repeat(64));
  }, 60000);

  it("a url change on the real schema clears the previous secret, audited", async () => {
    const actor = { userId, ipAddress: "127.0.0.1", userAgent: "p613-live" };
    await asTenant(() =>
      webhookService.updateWebhook(TENANT, HOOK, { url: "https://new.example.com/hook" }, actor),
    );
    const [[row]] = await db.query(
      "SELECT url, previous_secret, previous_secret_expires_at FROM webhooks WHERE id = :id",
      { replacements: { id: HOOK } },
    );
    expect(row).toEqual({
      url: "https://new.example.com/hook",
      previous_secret: null,
      previous_secret_expires_at: null,
    });
    const [[{ n }]] = await db.query(
      "SELECT count(*)::int AS n FROM audit_logs WHERE resource_type = 'Webhook' AND resource_id = :id",
      { replacements: { id: HOOK } },
    );
    expect(n).toBe(2);
  }, 60000);
});

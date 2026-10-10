/**
 * S-20 (migration 0086) and S-32 (migration 0087) against a REAL PostgreSQL.
 *
 * The mocked suites prove what the code issues; these prove what the database
 * holds and does:
 *  - FRESH boot: db.sync() builds both MFA columns and backup_path as TEXT;
 *    every migration applies; the schema and KMS verifiers pass.
 *  - UPGRADE from the schema before 0086/0087 (VARCHAR(255) columns) with
 *    PLAINTEXT seeds — an operator with no tenant, a soft-deleted user, a
 *    pending enrolment — and completed backups with no expiry: the migrator
 *    applies exactly 0086 and 0087; every seed is a v2 envelope that opens
 *    under its user id; no plaintext seed is left; the expiry is backfilled
 *    by the pruner's rule, and only where it can be.
 *  - RE-RUN changes nothing; DOWN restores the plaintext and the VARCHARs the
 *    earlier code reads; UP again.
 *  - REFUSAL: a value that is not a seed stops 0086 naming the user, and
 *    nothing changes.
 *  - As the APPLICATION ROLE (DB_APP_ROLE): the live MFA path with the REAL
 *    otplib — setupMfa stores an envelope, verifyMfaSetup promotes it, the
 *    next code verifies against the stored envelope, a replay is refused; the
 *    model refuses a plaintext seed; a tenant backup taken over the service's
 *    HTTP path is COMPLETED with its expiry and CREATE audit row, and a
 *    delete (which failed on PostgreSQL while it wrote `deleting`) succeeds
 *    with its DELETE audit row.
 *
 * NEEDS an EMPTY scratch database the connecting role owns (it is
 * rebuilt with db.sync({ force: true })), whose name contains "scratch":
 *
 *   DB_HOST=127.0.0.1 DB_PORT=56020 DB_NAME=callibrator_s20_scratch \
 *     DB_USER=cal_owner DB_PASS=owner DB_APP_ROLE=callibrator_app \
 *     npm run test:live:jest -- src/tests/services/secretsAtRest.s20.live
 *
 * Run on PostgreSQL 18 (pgvector/pgvector:pg18) on 2026-09-27.
 */

const APP_ROLE = process.env.DB_APP_ROLE || "callibrator_app";
const DAY = 24 * 60 * 60 * 1000;
const SEED_A = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const SEED_B = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const SEED_LEGACY = "KRSXG5CTMVRXEZLU"; // a 16-character (80-bit) otplib <= 12 seed
const M0086 = "0086-user-mfa-secrets-kms-envelope.js";
const M0087 = "0087-tenant-backup-path-and-expiry.js";

const logger = { info: () => {}, warn: () => {}, error: () => {} };

const startProcess = () => {
  let graph;
  jest.isolateModules(() => {
    const { db } = require("../../config");
    db.options.logging = false;
    graph = {
      db,
      models: require("../../models"),
      migrator: require("../../config/migrator").migrator,
      schemaVerify: require("../../utils/schemaVerify.util"),
      kmsVerify: require("../../utils/kmsVerify.util"),
      dbRole: require("../../utils/dbRole.util"),
      tenantStorage: require("../../middlewares/tenantContext.middleware").tenantStorage,
      m0086: require("../../migrations/0086-user-mfa-secrets-kms-envelope"),
      m0087: require("../../migrations/0087-tenant-backup-path-and-expiry"),
      mfaService: require("../../services/mfa.service"),
      authService: require("../../services/auth.service"),
      backupService: require("../../services/tenantBackup.service"),
      constants: require("../../constants"),
    };
  });
  return graph;
};

describe("S-20 / S-32 — live PostgreSQL", () => {
  let g;
  const ids = {};

  const q = async (sql, replacements = {}) => g.db.query(sql, { type: "SELECT", replacements });
  const typeOf = async (table, column) => {
    const [row] = await q(
      `SELECT data_type FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = :table AND column_name = :column`,
      { table, column },
    );
    return row ? row.data_type : null;
  };
  const types = async () => ({
    mfa_secret: await typeOf("users", "mfa_secret"),
    mfa_pending_secret: await typeOf("users", "mfa_pending_secret"),
    backup_path: await typeOf("tenant_backups", "backup_path"),
  });
  const seedsOf = async (id) => {
    const [row] = await q("SELECT mfa_secret, mfa_pending_secret FROM users WHERE id = :id", { id });
    return row;
  };
  const plaintextLeft = async () => {
    const [row] = await q(
      `SELECT count(*) FILTER (WHERE mfa_secret IS NOT NULL AND mfa_secret NOT LIKE 'v2:%')::int AS live,
              count(*) FILTER (WHERE mfa_pending_secret IS NOT NULL AND mfa_pending_secret NOT LIKE 'v2:%')::int AS pending
         FROM users`,
    );
    return row;
  };
  const user = async (tag, { tenantId, secret = null, pending = null, deleted = false }) => {
    const [row] = await q(
      `INSERT INTO users (id, tenant_id, username, email, password, first_name, last_name, avatar_url, status,
                          mfa_enabled, mfa_secret, mfa_pending_secret, mfa_pending_created_at,
                          is_deleted, deleted_at, created_at, updated_at)
       VALUES (gen_random_uuid(), :tenantId, :tag, :email, 'x', 'S20', :tag, 'default.svg', 'ACTIVE',
               :enabled, :secret, :pending, CASE WHEN CAST(:pending AS text) IS NULL THEN NULL ELSE now() END,
               :deleted, CASE WHEN :deleted THEN now() ELSE NULL END, now(), now())
       RETURNING id`,
      { tenantId, tag, email: `${tag}@live.test`, enabled: secret !== null, secret, pending, deleted },
    );
    return row.id;
  };
  const backup = async (status, retentionDays) => {
    const [row] = await q(
      `INSERT INTO tenant_backups (id, tenant_id, status, retention_days, backup_path, created_at, updated_at)
       VALUES (gen_random_uuid(), :tenantId, :status, :retentionDays, '/legacy/path.zip',
               now() - interval '3 days', now())
       RETURNING id, created_at`,
      { tenantId: g.constants.DEFAULT_TENANT.id, status, retentionDays },
    );
    return row;
  };
  const expiryOf = async (id) => (await q("SELECT expires_at FROM tenant_backups WHERE id = :id", { id }))[0].expires_at;

  beforeAll(async () => {
    const name = process.env.DB_NAME || "";
    if (!/scratch/.test(name)) {
      throw new Error(`Refusing to rebuild DB_NAME="${name}": use a scratch database (see the header)`);
    }
    g = startProcess();
    await g.db.sync({ force: true });
  }, 300000);

  afterAll(async () => {
    if (g) {
      await g.db.close();
    }
  });

  it("FRESH boot: db.sync() builds TEXT columns; every migration applies; the verifiers pass", async () => {
    expect(await types()).toEqual({ mfa_secret: "text", mfa_pending_secret: "text", backup_path: "text" });

    const ran = (await g.migrator.up()).map((m) => m.name);

    expect(ran).toEqual(expect.arrayContaining([M0086, M0087]));
    expect(await types()).toEqual({ mfa_secret: "text", mfa_pending_secret: "text", backup_path: "text" });
    expect((await g.schemaVerify.verifySchema(g.db)).problems).toEqual([]);
    expect((await g.kmsVerify.verifyKmsKeys(g.db)).problems).toEqual([]);
  }, 300000);

  it("UPGRADE: plaintext seeds and unexpiring backups under the old schema — exactly 0086 and 0087 apply", async () => {
    const tenantId = g.constants.DEFAULT_TENANT.id;
    await g.db.query(
      `INSERT INTO tenants (id, name, subdomain, email, created_at, updated_at)
       VALUES (:id, 'Default', 'default', 'default@tenant.test', now(), now()) ON CONFLICT (id) DO NOTHING`,
      { replacements: { id: tenantId } },
    );
    // The schema as it was before 0086 and 0087.
    await g.db.query("ALTER TABLE users ALTER COLUMN mfa_secret TYPE VARCHAR(255)");
    await g.db.query("ALTER TABLE users ALTER COLUMN mfa_pending_secret TYPE VARCHAR(255)");
    await g.db.query("ALTER TABLE tenant_backups ALTER COLUMN backup_path TYPE VARCHAR(255)");
    await g.db.query("DELETE FROM schema_migrations WHERE name IN (:names)", { replacements: { names: [M0086, M0087] } });

    ids.operator = await user("s20-operator", { tenantId: null, secret: SEED_A });
    ids.member = await user("s20-member", { tenantId, secret: SEED_B, pending: SEED_LEGACY });
    ids.gone = await user("s20-gone", { tenantId, secret: SEED_A, deleted: true });
    ids.none = await user("s20-none", { tenantId });
    ids.completed = await backup("completed", 30);
    ids.noRetention = await backup("completed", null);
    ids.failed = await backup("failed", 30);
    expect(await plaintextLeft()).toEqual({ live: 3, pending: 1 });

    const ran = (await g.migrator.up()).map((m) => m.name);

    expect(ran).toEqual([M0086, M0087]);
    expect(await types()).toEqual({ mfa_secret: "text", mfa_pending_secret: "text", backup_path: "text" });
    expect(await plaintextLeft()).toEqual({ live: 0, pending: 0 });
    const open = (id, v) => g.mfaService.openSecret(id, v);
    const operator = await seedsOf(ids.operator);
    const member = await seedsOf(ids.member);
    const gone = await seedsOf(ids.gone);
    expect(operator.mfa_secret).toMatch(/^v2:/);
    expect(open(ids.operator, operator.mfa_secret)).toBe(SEED_A);
    expect(open(ids.member, member.mfa_secret)).toBe(SEED_B);
    expect(open(ids.member, member.mfa_pending_secret)).toBe(SEED_LEGACY);
    expect(open(ids.gone, gone.mfa_secret)).toBe(SEED_A); // soft-deleted rows too
    expect(await seedsOf(ids.none)).toEqual({ mfa_secret: null, mfa_pending_secret: null });
    // Bound to the account: the operator's envelope does not open as the member's.
    expect(() => open(ids.member, operator.mfa_secret)).toThrow("Failed to decrypt data");

    const expiry = new Date(await expiryOf(ids.completed.id)).getTime();
    expect(expiry).toBe(new Date(ids.completed.created_at).getTime() + 30 * DAY);
    expect(await expiryOf(ids.noRetention.id)).toBeNull(); // not guessed
    expect(await expiryOf(ids.failed.id)).toBeNull(); // not a completed backup
    expect((await g.schemaVerify.verifySchema(g.db)).problems).toEqual([]);
    expect((await g.kmsVerify.verifyKmsKeys(g.db)).problems).toEqual([]);
  }, 60000);

  it("RE-RUN: the migrator applies nothing; a direct up changes no row", async () => {
    const before = await q("SELECT id, mfa_secret, mfa_pending_secret FROM users ORDER BY id");
    const expiries = await q("SELECT id, expires_at FROM tenant_backups ORDER BY id");

    expect(await g.migrator.up()).toEqual([]);
    await g.m0086.up({ context: g.db.getQueryInterface() });
    await g.m0087.up({ context: g.db.getQueryInterface() });

    expect(await q("SELECT id, mfa_secret, mfa_pending_secret FROM users ORDER BY id")).toEqual(before);
    expect(await q("SELECT id, expires_at FROM tenant_backups ORDER BY id")).toEqual(expiries);
  });

  it("DOWN restores the plaintext and the VARCHAR(255)s the earlier code reads; UP seals again", async () => {
    await g.migrator.down({ to: M0087 }); // reverts 0088+ (if any), 0087
    await g.migrator.down(); // 0086
    expect(await types()).toEqual({
      mfa_secret: "character varying",
      mfa_pending_secret: "character varying",
      backup_path: "character varying",
    });
    expect(await seedsOf(ids.member)).toEqual({ mfa_secret: SEED_B, mfa_pending_secret: SEED_LEGACY });
    expect((await seedsOf(ids.operator)).mfa_secret).toBe(SEED_A);

    await g.migrator.up();

    expect(await types()).toEqual({ mfa_secret: "text", mfa_pending_secret: "text", backup_path: "text" });
    expect(await plaintextLeft()).toEqual({ live: 0, pending: 0 });
    expect(g.mfaService.openSecret(ids.member, (await seedsOf(ids.member)).mfa_secret)).toBe(SEED_B);
    expect((await g.schemaVerify.verifySchema(g.db)).problems).toEqual([]);
  }, 60000);

  it("REFUSES a value that is not a seed — naming the user — and changes nothing", async () => {
    await g.migrator.down({ to: M0086 });
    const bad = await user("s20-bad", { tenantId: g.constants.DEFAULT_TENANT.id, secret: "not-a-seed!" });
    const before = await q("SELECT id, mfa_secret FROM users ORDER BY id");

    const error = await g.migrator.up().catch((e) => e);

    expect(String(error && error.message)).toContain(`mfa_secret of user ${bad}: not a base32 TOTP seed`);
    expect(String(error.message)).not.toContain("not-a-seed!");
    expect(await q("SELECT id, mfa_secret FROM users ORDER BY id")).toEqual(before);
    expect(await typeOf("users", "mfa_secret")).toBe("character varying");

    await g.db.query("UPDATE users SET mfa_secret = NULL, mfa_enabled = false WHERE id = :id", { replacements: { id: bad } });
    await g.migrator.up();
    expect(await plaintextLeft()).toEqual({ live: 0, pending: 0 });
  }, 60000);

  describe("as the application role", () => {
    let p;
    beforeAll(async () => {
      p = startProcess();
      await p.dbRole.enterApplicationRole({ sequelize: p.db, logger, env: { DB_APP_ROLE: APP_ROLE } });
    }, 120000);
    afterAll(async () => {
      await p.db.close();
    });

    const asTenant = (fn) =>
      p.tenantStorage.run({ tenantId: p.constants.DEFAULT_TENANT.id, isSuperAdmin: false, isSystemTask: false }, fn);

    it("every query runs as the application role", async () => {
      const [[row]] = await p.db.query("SELECT current_user AS u");
      expect(row.u).toBe(APP_ROLE);
    });

    it("the live MFA path with the REAL otplib: sealed at setup, promoted sealed, verified from the stored envelope", async () => {
      const { generateSync } = require("otplib");
      const userId = await user("s20-enrol", { tenantId: p.constants.DEFAULT_TENANT.id });
      const now = Math.floor(Date.now() / 1000);
      const step = (offset) => generateSync({ secret: setup.secret, epoch: now + offset });

      const setup = await asTenant(() => p.authService.setupMfa(userId));
      const pending = (await seedsOf(userId)).mfa_pending_secret;
      expect(pending).toMatch(/^v2:/);
      expect(pending).not.toContain(setup.secret);

      await asTenant(() => p.authService.verifyMfaSetup(userId, step(0)));
      const stored = await seedsOf(userId);
      expect(stored.mfa_pending_secret).toBeNull();
      expect(stored.mfa_secret).toBe(pending); // promoted as it was: one AAD for both columns
      expect(stored.mfa_secret).not.toContain(setup.secret);

      // The next step's code, against the row as the database holds it.
      const row = await asTenant(() => p.models.Users.findByPk(userId));
      expect(row.mfaSecret).toMatch(/^v2:/);
      expect(await p.mfaService.verifyLogin(row, step(30))).toBe(true);
      expect(await p.mfaService.verifyLogin(row, step(30))).toBe(false); // A-115 replay, still enforced
      const [{ mfa_last_used_step: lastStep }] = await q("SELECT mfa_last_used_step FROM users WHERE id = :id", {
        id: userId,
      });
      expect(Number(lastStep)).toBe(Math.floor((now + 30) / 30));
    });

    it("the model refuses a plaintext seed on the real database, and writes nothing", async () => {
      const err = await asTenant(() =>
        p.models.Users.update({ mfaSecret: SEED_A }, { where: { id: ids.member } }),
      ).catch((e) => e);
      expect(String(err && err.message)).toMatch(/refusing to store mfaSecret in plaintext/);
      expect((await seedsOf(ids.member)).mfa_secret).toMatch(/^v2:/);
    });

    it("S-32: an HTTP-path backup is COMPLETED with its expiry and CREATE audit row; a delete succeeds with its DELETE row", async () => {
      const tenantId = p.constants.DEFAULT_TENANT.id;
      const actor = ids.member;
      const created = await asTenant(() =>
        p.backupService.createBackup({ tenantId, createdById: actor, backupType: "user_only", retentionDays: 7, models: p.models }),
      );
      const backupId = created.data.id;
      const [row] = await q(
        "SELECT status, expires_at, created_at, backup_path, file_path FROM tenant_backups WHERE id = :id",
        { id: backupId },
      );
      expect(row.status).toBe("completed");
      expect(row.backup_path).toBeNull(); // legacy column no longer written
      expect(row.file_path).toMatch(/\.zip$/);
      expect(new Date(row.expires_at).getTime() - Date.now()).toBeGreaterThan(6.9 * DAY);
      const audit = async (action) =>
        q("SELECT count(*)::int AS n FROM audit_logs WHERE resource_type = 'TenantBackup' AND resource_id = :id AND action = :action", {
          id: backupId,
          action,
        });
      expect(await audit("CREATE")).toEqual([{ n: 1 }]);

      await asTenant(() => p.backupService.deleteBackup(backupId, actor, p.models));

      const [gone] = await q("SELECT status, deleted_at, deleted_by FROM tenant_backups WHERE id = :id", { id: backupId });
      expect(gone.status).toBe("deleted");
      expect(gone.deleted_at).not.toBeNull();
      expect(gone.deleted_by).toBe(actor);
      expect(await audit("DELETE")).toEqual([{ n: 1 }]);
    }, 60000);
  });
});

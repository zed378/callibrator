/**
 * Batch-6 data cards against a REAL PostgreSQL — D-06, D-08, D-09, D-10,
 * D-11, D-40 (and migrations 0062, 0063).
 *
 * The mocked suites prove which statements the code issues. These prove what
 * the database then does: that an index is chosen, that a constraint bites,
 * that an erased row holds what the decision says, that a RESTRICT refuses.
 *
 * OPT-IN — needs an EMPTY scratch database the connecting role owns (it is
 * rebuilt with db.sync({ force: true })), whose name contains "scratch" or
 * ends in "_dba", as a guard against pointing it at a real one:
 *
 *   DATA_PG_LIVE_TEST=1 DB_HOST=127.0.0.1 DB_PORT=54337 DB_NAME=callibrator_dba \
 *     DB_USER=postgres DB_PASS=x \
 *     npm test -- src/tests/migrations/dataIdentity.dbA.live --coverage=false
 *
 * Run on PostgreSQL 16.13 in development (no pgvector needed); the deployment
 * target is 18.
 */

const live = process.env.DATA_PG_LIVE_TEST === "1" ? describe : describe.skip;

const TENANT_A = "da0a0a0a-0000-4000-8000-00000000000a";
const TENANT_B = "db0b0b0b-0000-4000-8000-00000000000b";

// jest.config maps `uuid` to a mock returning ONE constant (A-116) — which
// Sequelize's UUIDV4 defaults use too. Rows in a real table need real ids.
const useRealUuids = (uuid) => {
  uuid.v4.mockImplementation(() => require("crypto").randomUUID());
};

const startProcess = () => {
  let graph;
  jest.isolateModules(() => {
    useRealUuids(require("uuid"));
    const { db } = require("../../config");
    db.options.logging = false;
    graph = {
      db,
      models: require("../../models"),
      tenantStorage: require("../../middlewares/tenantContext.middleware").tenantStorage,
      gdpr: require("../../services/gdpr.service"),
      certificates: require("../../services/certificate.service"),
      migrator: require("../../config/migrator").migrator,
      m0011: require("../../migrations/0011-add-esignature-records"),
      m0062: require("../../migrations/0062-audit-log-indexes"),
      m0063: require("../../migrations/0063-user-identity-case-insensitive"),
    };
  });
  return graph;
};

/** The error `sql` raises (inside a savepoint of a rolled-back transaction), or null. */
const errorOf = async (db, sql, replacements = {}) => {
  const t = await db.transaction();
  try {
    await db.query(sql, { transaction: t, replacements });
    return null;
  } catch (err) {
    return err;
  } finally {
    await t.rollback();
  }
};

live("batch-6 data identity and retention — real PostgreSQL", () => {
  let g;
  const ids = {};

  const user = async (tenantId, tag, email = `${tag}@live.test`) => {
    const [[row]] = await g.db.query(
      `INSERT INTO users (id, tenant_id, username, email, password, first_name, last_name, phone, avatar_url,
                          status, must_change_password, is_deleted, last_login_at, failed_login_attempts,
                          created_at, updated_at)
       VALUES (gen_random_uuid(), :tenantId, :tag, :email, '$2b$12$abcdefghijklmnopqrstuuMPbQyNKi4b3Hq0Ud0L2Q1i7bKZ4w3y',
               'Jane', :tag, '+62 811 000', 'default.svg', 'ACTIVE', false, false, now(), 2, now(), now())
       RETURNING id`,
      { replacements: { tenantId, tag, email } },
    );
    return row.id;
  };

  const device = async (tenantId, serial) => {
    const [[row]] = await g.db.query(
      `INSERT INTO calibration_devices (id, tenant_id, name, serial_number, iot_enabled, is_deleted,
                                        calibration_interval_days, created_at, updated_at)
       VALUES (gen_random_uuid(), :tenantId, 'Analyser', :serial, false, false, 365, now(), now())
       RETURNING id`,
      { replacements: { tenantId, serial } },
    );
    return row.id;
  };

  beforeAll(async () => {
    const name = process.env.DB_NAME || "";
    if (!/scratch|_dba$/.test(name)) {
      throw new Error(`Refusing to rebuild DB_NAME="${name}": use a scratch database (see the header)`);
    }
    process.env.GDPR_ENABLED = "true";
    g = startProcess();
    await g.db.sync({ force: true });
    const qi = g.db.getQueryInterface();
    await g.m0062.up({ context: qi });
    await g.m0063.up({ context: qi });

    // Two code-less tenants (tenants.code NULL): the D-40 shape.
    await g.db.query(
      `INSERT INTO tenants (id, name, subdomain, email, created_at, updated_at) VALUES
         (:a, 'dbA A', 'dba-a', 'dbaa@live.test', now(), now()),
         (:b, 'dbA B', 'dba-b', 'dbab@live.test', now(), now())`,
      { replacements: { a: TENANT_A, b: TENANT_B } },
    );
    ids.technician = await user(TENANT_A, "technician");
    ids.dpo = await user(TENANT_A, "dpo");
    ids.userB = await user(TENANT_B, "clinician", "clinician@hospital-b.test");
    ids.deviceA = await device(TENANT_A, "SN-A");
    ids.deviceB = await device(TENANT_B, "SN-B");
    const [[record]] = await g.db.query(
      `INSERT INTO calibration_records (id, tenant_id, device_id, performed_by, calibration_date, is_compliant,
                                        notes, is_deleted, created_at, updated_at)
       VALUES (gen_random_uuid(), :t, :d, :u, now(), true, 'as found', false, now(), now()) RETURNING id`,
      { replacements: { t: TENANT_A, d: ids.deviceA, u: ids.technician } },
    );
    ids.record = record.id;
  });

  afterAll(async () => {
    if (g) {
      await g.db.close();
    }
  });

  // ------------------------------------------------------------------
  describe("D-10 — calibration_records.performed_by is RESTRICT", () => {
    it("hard-deleting the performer fails with a foreign-key violation and the record stays", async () => {
      const err = await errorOf(g.db, "DELETE FROM users WHERE id = :id", { id: ids.technician });

      expect(err).not.toBeNull();
      expect(err.original.code).toBe("23503");
      expect(err.message).toMatch(/calibration_records_performed_by_fkey|violates foreign key constraint/);
      const [[{ n }]] = await g.db.query(
        "SELECT count(*)::int AS n FROM calibration_records WHERE id = :id AND performed_by = :u",
        { replacements: { id: ids.record, u: ids.technician } },
      );
      expect(n).toBe(1);
    });

    it("the constraint in the catalog says ON DELETE RESTRICT", async () => {
      const [[row]] = await g.db.query(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conrelid = 'calibration_records'::regclass AND conname = 'calibration_records_performed_by_fkey'`,
      );
      expect(row.def).toMatch(/REFERENCES users\(id\).*ON DELETE RESTRICT/);
    });
  });

  // ------------------------------------------------------------------
  describe("D-11 — an erasure pseudonymises the account and keeps the attributable record", () => {
    it("after eraseUserData, User.unscoped().findByPk(id) holds no identity or credential, and the calibration record still points at it", async () => {
      const result = await g.tenantStorage.run({ tenantId: TENANT_A }, () =>
        g.gdpr.eraseUserData(TENANT_A, ids.technician, { requestedBy: ids.dpo }),
      );
      expect(result).toMatchObject({ erased: true, method: "anonymized" });

      const row = await g.models.User.unscoped().findByPk(ids.technician, { paranoid: false });
      expect(row).not.toBeNull();
      expect(row.toJSON()).toMatchObject({
        id: ids.technician,
        tenantId: TENANT_A,
        email: `erased_${ids.technician}@erased.local`,
        username: `erased_${ids.technician.substring(0, 8)}`,
        firstName: "[REDACTED]",
        lastName: "[REDACTED]",
        phone: null,
        avatarUrl: "default.svg",
        status: "erased",
        isActive: false,
        password: "!erased",
        lastLoginAt: null,
        failedLoginAttempts: 0,
        mfaEnabled: false,
        mfaSecret: null,
        mfaRecoveryCodes: null,
        webauthnCredentialId: null,
        otpCode: null,
      });
      // The erased hash matches no password.
      const bcrypt = require("bcryptjs");
      expect(await bcrypt.compare("", row.password)).toBe(false);

      const [[rec]] = await g.db.query("SELECT performed_by FROM calibration_records WHERE id = :id", {
        replacements: { id: ids.record },
      });
      expect(rec.performed_by).toBe(ids.technician);

      const [[audit]] = await g.db.query(
        `SELECT user_id, action, changes FROM audit_logs
          WHERE tenant_id = :t AND resource_type = 'User' AND resource_id = :id`,
        { replacements: { t: TENANT_A, id: ids.technician } },
      );
      expect(audit).toMatchObject({ user_id: ids.dpo, action: "DELETE" });
      expect(audit.changes).toMatchObject({ operation: "GDPR_ERASURE", method: "anonymized" });
    });

    it("hardDelete is refused with a 400 and the row is untouched", async () => {
      await expect(
        g.tenantStorage.run({ tenantId: TENANT_A }, () =>
          g.gdpr.eraseUserData(TENANT_A, ids.dpo, { requestedBy: ids.dpo, hardDelete: true, anonymize: false }),
        ),
      ).rejects.toMatchObject({ status: 400 });
      const row = await g.models.User.unscoped().findByPk(ids.dpo, { paranoid: false });
      expect(row.email).toBe("dpo@live.test");
      expect(row.deletedAt).toBeNull();
    });
  });

  // ------------------------------------------------------------------
  describe("D-06 / 0063 — one identity per address, whatever its case", () => {
    it("another tenant cannot hold a case-variant of an existing address or username", async () => {
      const email = await errorOf(
        g.db,
        `INSERT INTO users (id, tenant_id, username, email, password, first_name, last_name, created_at, updated_at)
         VALUES (gen_random_uuid(), :t, 'freshname', 'Clinician@Hospital-B.test', 'x', 'F', 'L', now(), now())`,
        { t: TENANT_A },
      );
      expect(email.original.code).toBe("23505");
      expect(email.original.constraint).toBe("users_email_lower_unique");

      const username = await errorOf(
        g.db,
        `INSERT INTO users (id, tenant_id, username, email, password, first_name, last_name, created_at, updated_at)
         VALUES (gen_random_uuid(), :t, 'CLINICIAN', 'fresh@live.test', 'x', 'F', 'L', now(), now())`,
        { t: TENANT_A },
      );
      expect(username.original.code).toBe("23505");
      expect(username.original.constraint).toBe("users_username_lower_unique");
    });

    it("up refuses — creating nothing — while two accounts differ only by case", async () => {
      const qi = g.db.getQueryInterface();
      await g.m0063.down({ context: qi });
      await g.db.query(
        `INSERT INTO users (id, tenant_id, username, email, password, first_name, last_name, created_at, updated_at)
         VALUES (gen_random_uuid(), :t, 'variant', 'CLINICIAN@hospital-b.test', 'x', 'F', 'L', now(), now())`,
        { replacements: { t: TENANT_A } },
      );

      const err = await g.m0063.up({ context: qi }).catch((e) => e);

      expect(err.message).toMatch(/^Migration 0063 refused: 1 group/);
      expect(err.message).toContain(ids.userB);
      expect(err.message).not.toMatch(/hospital-b\.test/i);
      const [rows] = await g.db.query(
        "SELECT indexname FROM pg_indexes WHERE tablename = 'users' AND indexname LIKE '%lower_unique'",
      );
      expect(rows).toEqual([]);

      await g.db.query("DELETE FROM users WHERE username = 'variant'");
      await g.m0063.up({ context: qi });
      const [after] = await g.db.query(
        "SELECT indexname FROM pg_indexes WHERE tablename = 'users' AND indexname LIKE '%lower_unique' ORDER BY 1",
      );
      expect(after.map((r) => r.indexname)).toEqual(["users_email_lower_unique", "users_username_lower_unique"]);
    });
  });

  // ------------------------------------------------------------------
  describe("D-08 / 0062 — the audit trail is read through its indexes", () => {
    it("the tenant list, the resource lookup and the subject lookup use the new indexes", async () => {
      await g.db.query(
        `INSERT INTO audit_logs (id, tenant_id, user_id, actor_type, action, resource_type, resource_id, created_at)
         SELECT gen_random_uuid(), CASE WHEN g % 2 = 0 THEN :a::uuid ELSE :b::uuid END,
                CASE WHEN g % 2 = 0 THEN :ua::uuid ELSE :ub::uuid END, 'user', 'UPDATE', 'Certificate',
                gen_random_uuid()::text, now() - (g || ' minutes')::interval
           FROM generate_series(1, 20000) g`,
        { replacements: { a: TENANT_A, b: TENANT_B, ua: ids.dpo, ub: ids.userB } },
      );
      await g.db.query("ANALYZE audit_logs");

      const plan = async (sql) =>
        (await g.db.query(`EXPLAIN ${sql}`, { replacements: { t: TENANT_A, u: ids.dpo } }))[0]
          .map((r) => r["QUERY PLAN"])
          .join("\n");

      expect(await plan("SELECT * FROM audit_logs WHERE tenant_id = :t ORDER BY created_at DESC LIMIT 50")).toMatch(
        /Index Scan using audit_logs_tenant_id_created_at/,
      );
      expect(
        await plan("SELECT * FROM audit_logs WHERE tenant_id = :t AND resource_type = 'Certificate' AND resource_id = 'x'"),
      ).toMatch(/audit_logs_tenant_id_resource/);
      expect(await plan("SELECT * FROM audit_logs WHERE user_id = :u")).toMatch(/audit_logs_user_id/);
    });
  });

  // ------------------------------------------------------------------
  describe("D-40 — two code-less tenants issue certificates on the same day", () => {
    it("both succeed with distinct, tenant-specific numbers", async () => {
      const issue = (tenantId, userId, deviceId) =>
        g.tenantStorage.run({ tenantId }, () =>
          g.certificates.createCertificate(tenantId, userId, { deviceId }),
        );

      const a = await issue(TENANT_A, ids.dpo, ids.deviceA);
      const b = await issue(TENANT_B, ids.userB, ids.deviceB);

      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect(a.data.certificateNumber).toMatch(/^CERT-\d{8}-TDA0A0A0A-0001$/);
      expect(b.data.certificateNumber).toMatch(/^CERT-\d{8}-TDB0B0B0B-0001$/);
    });
  });

  // ------------------------------------------------------------------
  describe("D-09 — every migration re-run over a populated database changes no row count", () => {
    // The restore-without-schema_migrations case: the migrator sees every
    // migration as pending on a database that already holds data. Before
    // A-147, 0011 would have dropped e_signature_records here.
    const rowCounts = async () => {
      const [tables] = await g.db.query(
        "SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename <> 'schema_migrations' ORDER BY 1",
      );
      const counts = {};
      for (const { tablename } of tables) {
        const [[{ n }]] = await g.db.query(`SELECT count(*)::int AS n FROM "${tablename}"`);
        counts[tablename] = n;
      }
      return counts;
    };

    it("migrator.up() on the sync-built database, then again with schema_migrations emptied", async () => {
      const [[{ vector }]] = await g.db.query(
        "SELECT count(*)::int AS vector FROM pg_available_extensions WHERE name = 'vector'",
      );
      const preRecord = async () => {
        await g.db.query("CREATE TABLE IF NOT EXISTS schema_migrations (name varchar(255) PRIMARY KEY)");
        if (!vector) {
          // PostgreSQL without pgvector (the PG16 dev cluster): 0018 cannot run.
          await g.db.query("INSERT INTO schema_migrations VALUES ('0018-add-document-chunks.js') ON CONFLICT DO NOTHING");
        }
      };
      await preRecord();
      await g.migrator.up();
      const before = await rowCounts();
      expect(before.users).toBeGreaterThan(0);
      expect(before.calibration_records).toBe(1);

      await g.db.query("DELETE FROM schema_migrations");
      await preRecord();
      const reapplied = await g.migrator.up();

      expect(reapplied.length).toBeGreaterThan(50);
      expect(await rowCounts()).toEqual(before);
    });
  });

  // ------------------------------------------------------------------
  describe("D-09 — 0011 re-run over signature records refuses and destroys nothing", () => {
    it("a populated e_signature_records survives a re-run of 0011", async () => {
      await g.db.query(
        `INSERT INTO e_signature_records (id, tenant_id, entity_type, entity_id, user_id, action, meaning, auth_method, timestamp)
         VALUES (gen_random_uuid(), :t, 'Certificate', gen_random_uuid(), :u, 'sign', 'Approved', 'password', now())`,
        { replacements: { t: TENANT_A, u: ids.dpo } },
      );

      const err = await g.m0011.up({ context: g.db.getQueryInterface() }).catch((e) => e);

      expect(err.message).toMatch(/^Migration 0011 refused: e_signature_records already holds 1 row/);
      const [[{ n }]] = await g.db.query("SELECT count(*)::int AS n FROM e_signature_records");
      expect(n).toBe(1);
    });
  });
});

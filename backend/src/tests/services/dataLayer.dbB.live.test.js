/**
 * Data-layer audit, batch 6 (agent dbB) — against a REAL PostgreSQL.
 *
 * D-18 (migration 0066), D-19 / D-20 (migration 0067 + the iot_readings
 * retention entity), D-21 (DECIMAL getters). The mocked suites prove which
 * statements run; only a real catalog proves that a constraint refuses, an
 * index exists and is used, and that pg hands back NUMERIC as a string that
 * the getter turns into a number.
 *
 * OPT-IN — needs an EMPTY scratch database the connecting role owns (it is
 * rebuilt with db.sync({ force: true })) whose name contains "scratch":
 *
 *   DATA_PG_LIVE_TEST=1 DB_HOST=/tmp DB_PORT=54338 DB_NAME=dbb_scratch \
 *     DB_USER=postgres DB_PASS=x \
 *     npm test -- src/tests/services/dataLayer.dbB.live --coverage=false
 *
 * Run on PostgreSQL 16 in development (no pgvector needed); the deployment
 * target is 18.
 */

const live = process.env.DATA_PG_LIVE_TEST === "1" ? describe : describe.skip;

// sync({ force: true }) drops and recreates ~75 tables: well past the 10 s
// default on a database that already holds them.
jest.setTimeout(180000);

const TENANT_A = "d1d1d1d1-0000-4000-8000-00000000000a";
const TENANT_B = "d2d2d2d2-0000-4000-8000-00000000000b";

const startProcess = () => {
  let graph;
  jest.isolateModules(() => {
    const { db } = require("../../config");
    db.options.logging = false;
    graph = {
      db,
      models: require("../../models"),
      tenantStorage: require("../../middlewares/tenantContext.middleware").tenantStorage,
      retention: require("../../services/dataRetention.service"),
      m0066: require("../../migrations/0066-signature-records-step-restrict"),
      m0067: require("../../migrations/0067-foreign-key-and-tenant-indexes"),
    };
  });
  return graph;
};

live("dbB data layer — live PostgreSQL (D-18, D-19, D-20, D-21)", () => {
  let g;
  let qi;
  const ids = {};

  const one = async (sql, replacements = {}) => {
    try {
      const [[row]] = await g.db.query(sql, { replacements });
      return row;
    } catch (err) {
      throw new Error(`${err.original ? err.original.message : err.message}\n${sql}`);
    }
  };
  const stepFkDef = async () =>
    (
      await one(
        `SELECT string_agg(pg_get_constraintdef(c.oid), ' | ') AS def, count(*)::int AS n
           FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
          WHERE c.conrelid = 'signature_records'::regclass AND c.contype = 'f' AND a.attname = 'workflow_step_id'`,
      )
    );
  const errorOf = async (sql, replacements = {}) => {
    const t = await g.db.transaction();
    try {
      await g.db.query(sql, { replacements, transaction: t });
      return null;
    } catch (err) {
      return err;
    } finally {
      await t.rollback();
    }
  };

  beforeAll(async () => {
    if (!/scratch/.test(process.env.DB_NAME || "")) {
      throw new Error(`Refusing to rebuild DB_NAME="${process.env.DB_NAME}": use a scratch database`);
    }
    g = startProcess();
    await g.db.sync({ force: true });
    await g.db.query("DROP TABLE IF EXISTS migration_0066_previous_foreign_keys, migration_0067_created_indexes");
    qi = g.db.getQueryInterface();

    await g.db.query(
      `INSERT INTO tenants (id, name, subdomain, email, created_at, updated_at) VALUES
         (:a, 'dbB A', 'dbb-a', 'dbba@live.test', now(), now()),
         (:b, 'dbB B', 'dbb-b', 'dbbb@live.test', now(), now())`,
      { replacements: { a: TENANT_A, b: TENANT_B } },
    );
    ids.user = (
      await one(
        `INSERT INTO users (id, tenant_id, username, email, password, first_name, last_name, avatar_url,
                            status, must_change_password, is_deleted, created_at, updated_at)
         VALUES (gen_random_uuid(), :t, 'dbb-signer', 'dbb-signer@live.test', 'x', 'D', 'B', 'default.svg',
                 'ACTIVE', false, false, now(), now()) RETURNING id`,
        { t: TENANT_A },
      )
    ).id;
    ids.workflow = (
      await one(
        `INSERT INTO signature_workflows (id, tenant_id, document_id, created_at, updated_at)
         VALUES (gen_random_uuid(), :t, 'DOC-1', now(), now()) RETURNING id`,
        { t: TENANT_A },
      )
    ).id;
    ids.step = (
      await one(
        `INSERT INTO signature_workflow_steps (id, tenant_id, workflow_id, step_number, signer_email, created_at, updated_at)
         VALUES (gen_random_uuid(), :t, :w, 1, 'dbb-signer@live.test', now(), now()) RETURNING id`,
        { t: TENANT_A, w: ids.workflow },
      )
    ).id;
    ids.signature = (
      await one(
        `INSERT INTO signature_records (id, tenant_id, workflow_id, workflow_step_id, user_id, signature_hash,
                                        signature_algorithm, signed_at, created_at, updated_at)
         VALUES (gen_random_uuid(), :t, :w, :s, :u, 'hash', 'RS256', now(), now(), now()) RETURNING id`,
        { t: TENANT_A, w: ids.workflow, s: ids.step, u: ids.user },
      )
    ).id;
    ids.device = (
      await one(
        `INSERT INTO calibration_devices (id, tenant_id, name, serial_number, iot_enabled, is_deleted,
                                          calibration_interval_days, created_at, updated_at)
         VALUES (gen_random_uuid(), :t, 'Sensor', 'SN-DBB', true, false, 365, now(), now()) RETURNING id`,
        { t: TENANT_A },
      )
    ).id;
    ids.deviceB = (
      await one(
        `INSERT INTO calibration_devices (id, tenant_id, name, serial_number, iot_enabled, is_deleted,
                                          calibration_interval_days, created_at, updated_at)
         VALUES (gen_random_uuid(), :t, 'Sensor', 'SN-DBB', true, false, 365, now(), now()) RETURNING id`,
        { t: TENANT_B },
      )
    ).id;
  });

  afterAll(async () => {
    if (g) {await g.db.close();}
  });

  describe("D-18 — migration 0066", () => {
    it("a fresh sync() of the corrected model already carries RESTRICT; up is a no-op", async () => {
      expect((await stepFkDef()).def).toMatch(/ON UPDATE CASCADE ON DELETE RESTRICT/);
      await g.m0066.up({ context: qi });
      expect(
        (await one("SELECT to_regclass('migration_0066_previous_foreign_keys') IS NULL AS absent")).absent,
      ).toBe(true);
    });

    it("on the pre-change shape (CASCADE) a hard step delete erased the signature; after up it is refused", async () => {
      // The shape every existing database has: the model declared CASCADE.
      await g.db.query("ALTER TABLE signature_records DROP CONSTRAINT signature_records_workflow_step_id_fkey");
      await g.db.query(
        `ALTER TABLE signature_records ADD CONSTRAINT signature_records_workflow_step_id_fkey
           FOREIGN KEY (workflow_step_id) REFERENCES signature_workflow_steps (id) ON DELETE CASCADE ON UPDATE CASCADE`,
      );
      // Fail-before: inside a rolled-back transaction, the delete succeeds and takes the signature.
      const t = await g.db.transaction();
      await g.db.query("DELETE FROM signature_workflow_steps WHERE id = :s", { replacements: { s: ids.step }, transaction: t });
      const [[left]] = await g.db.query("SELECT count(*)::int AS n FROM signature_records WHERE id = :id", {
        replacements: { id: ids.signature },
        transaction: t,
      });
      await t.rollback();
      expect(left.n).toBe(0);

      await g.m0066.up({ context: qi });
      const after = await stepFkDef();
      expect(after.n).toBe(1);
      expect(after.def).toBe(
        "FOREIGN KEY (workflow_step_id) REFERENCES signature_workflow_steps(id) ON UPDATE CASCADE ON DELETE RESTRICT",
      );
      const err = await errorOf("DELETE FROM signature_workflow_steps WHERE id = :s", { s: ids.step });
      // PostgreSQL 18 reports an ON DELETE RESTRICT refusal as 23001
      // restrict_violation; 16 reported 23503 foreign_key_violation. Either is
      // the refusal. NOTE: Sequelize 6 maps only 23503 to
      // ForeignKeyConstraintError — on 18 this surfaces as a plain
      // DatabaseError, so any 409 translation must test both codes.
      expect(["23001", "23503"]).toContain(err && err.original && err.original.code);
    });

    it("a second up changes nothing; down restores exactly the CASCADE it replaced", async () => {
      await g.m0066.up({ context: qi });
      expect((await one("SELECT count(*)::int AS n FROM migration_0066_previous_foreign_keys")).n).toBe(1);
      await g.m0066.down({ context: qi });
      expect((await stepFkDef()).def).toMatch(/ON DELETE CASCADE/);
      expect(
        (await one("SELECT to_regclass('migration_0066_previous_foreign_keys') IS NULL AS absent")).absent,
      ).toBe(true);
      await g.m0066.up({ context: qi });
      expect((await stepFkDef()).def).toMatch(/ON DELETE RESTRICT/);
    });

    it("refuses, changing nothing, when a signature names a step that does not exist", async () => {
      await g.m0066.down({ context: qi }); // back to CASCADE, state table gone
      await g.db.query("ALTER TABLE signature_records DROP CONSTRAINT signature_records_workflow_step_id_fkey");
      const dangling = await one(
        `INSERT INTO signature_records (id, tenant_id, workflow_id, workflow_step_id, user_id, signature_hash,
                                        signature_algorithm, signed_at, created_at, updated_at)
         VALUES (gen_random_uuid(), :t, :w, gen_random_uuid(), :u, 'hash', 'RS256', now(), now(), now()) RETURNING id`,
        { t: TENANT_A, w: ids.workflow, u: ids.user },
      );
      await expect(g.m0066.up({ context: qi })).rejects.toThrow(/Migration 0066 refused: 1 signature record/);
      expect((await stepFkDef()).n).toBe(0); // nothing added
      await g.db.query("DELETE FROM signature_records WHERE id = :id", { replacements: { id: dangling.id } });
      await g.m0066.up({ context: qi });
      expect((await stepFkDef()).def).toMatch(/ON DELETE RESTRICT/);
    });
  });

  describe("D-19 / D-20 — migration 0067", () => {
    const indexNames = async () =>
      new Set(
        (await g.db.query("SELECT indexname FROM pg_indexes WHERE schemaname = current_schema()"))[0].map(
          (r) => r.indexname,
        ),
      );

    it("fail-before: the fresh schema has unindexed tenant columns and foreign keys", async () => {
      const names = await indexNames();
      expect(names.has("capas_tenant_id_status")).toBe(false);
      expect(names.has("workflow_steps_workflow_id")).toBe(false);
      // The model block now declares the iot composites, so sync() made them.
      expect(names.has("iot_readings_tenant_id_device_id_timestamp")).toBe(true);
      expect(names.has("iot_readings_tenant_id_timestamp")).toBe(true);
    });

    it("up covers every entry; model-declared ones are skipped, not duplicated", async () => {
      await g.m0067.up({ context: qi });
      const [indexes] = await g.db.query(
        `SELECT t.relname AS table_name,
                array(SELECT a.attname FROM unnest(x.indkey::int2[]) WITH ORDINALITY k(attnum, ord)
                        LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
                       ORDER BY k.ord)::text[] AS columns
           FROM pg_index x JOIN pg_class t ON t.oid = x.indrelid
          WHERE t.relnamespace = current_schema()::regnamespace AND x.indisvalid AND x.indpred IS NULL`,
      );
      for (const entry of g.m0067.INDEXES) {
        expect(`${entry.name}: ${g.m0067.isCovered(indexes, entry)}`).toBe(`${entry.name}: true`);
      }
      const [created] = await g.db.query("SELECT index_name FROM migration_0067_created_indexes");
      const createdNames = created.map((r) => r.index_name);
      expect(createdNames).not.toContain("iot_readings_tenant_id_timestamp");
      expect(createdNames).toContain("capas_tenant_id_status");
      expect(createdNames.length).toBe(g.m0067.INDEXES.length - 2);
    });

    it("the planner uses the new tenant index (EXPLAIN, seqscan disabled to make intent visible)", async () => {
      const t = await g.db.transaction();
      await g.db.query("SET LOCAL enable_seqscan = off", { transaction: t });
      const [plan] = await g.db.query(
        "EXPLAIN SELECT * FROM capas WHERE tenant_id = :t",
        { replacements: { t: TENANT_A }, transaction: t },
      );
      const [iotPlan] = await g.db.query(
        "EXPLAIN SELECT count(*) FROM iot_readings WHERE tenant_id = :t AND timestamp < now()",
        { replacements: { t: TENANT_A }, transaction: t },
      );
      await t.rollback();
      expect(plan.map((r) => r["QUERY PLAN"]).join("\n")).toMatch(/capas_tenant_id_status/);
      expect(iotPlan.map((r) => r["QUERY PLAN"]).join("\n")).toMatch(/iot_readings_tenant_id_timestamp/);
    });

    it("a second up changes nothing; down drops exactly what up created; up again restores", async () => {
      const before = (await one("SELECT count(*)::int AS n FROM migration_0067_created_indexes")).n;
      await g.m0067.up({ context: qi });
      expect((await one("SELECT count(*)::int AS n FROM migration_0067_created_indexes")).n).toBe(before);

      await g.m0067.down({ context: qi });
      const names = await indexNames();
      expect(names.has("capas_tenant_id_status")).toBe(false);
      expect(names.has("iot_readings_tenant_id_timestamp")).toBe(true); // the model's, untouched
      await g.m0067.up({ context: qi });
      expect((await indexNames()).has("capas_tenant_id_status")).toBe(true);
    });
  });

  describe("D-19 — the iot_readings retention purge", () => {
    it("purges only the opted-in tenant's readings older than its period; the other tenant is untouched", async () => {
      const reading = (t, d, daysAgo) =>
        g.db.query(
          `INSERT INTO iot_readings (id, tenant_id, device_id, timestamp, metrics, is_anomaly, created_at)
           VALUES (gen_random_uuid(), :t, :d, now() - (:days || ' days')::interval, '{}'::jsonb, false, now())`,
          { replacements: { t, d, days: String(daysAgo) } },
        );
      await reading(TENANT_A, ids.device, 1200);
      await reading(TENANT_A, ids.device, 10);
      await reading(TENANT_B, ids.deviceB, 1200);
      await g.db.query(
        `INSERT INTO tenant_settings (id, tenant_id, key, value, created_at, updated_at)
         VALUES (gen_random_uuid(), :t, 'retention_policy_iot_readings', '1000', now(), now())`,
        { replacements: { t: TENANT_A } },
      );

      const result = await g.retention.purgeExpiredRecords(TENANT_A);

      expect(result.purged).toEqual({ iot_readings: 1 });
      const [rows] = await g.db.query(
        "SELECT tenant_id, (timestamp < now() - interval '1000 days') AS old FROM iot_readings ORDER BY tenant_id",
      );
      expect(rows).toEqual([
        { tenant_id: TENANT_A, old: false },
        { tenant_id: TENANT_B, old: true },
      ]);
    });
  });

  describe("D-21 — DECIMAL read back through the model is a number", () => {
    it("invoices.amount_due / amount_paid", async () => {
      const sub = await one(
        `INSERT INTO subscriptions (id, tenant_id, current_period_start, current_period_end, created_at, updated_at)
         VALUES (gen_random_uuid(), :t, now(), now(), now(), now()) RETURNING id`,
        { t: TENANT_A },
      );
      await g.db.query(
        `INSERT INTO invoices (id, tenant_id, subscription_id, amount_due, amount_paid, created_at, updated_at)
         VALUES (gen_random_uuid(), :t, :s, 90.00, 1000.00, now(), now())`,
        { replacements: { t: TENANT_A, s: sub.id } },
      );
      const raw = await one("SELECT amount_due FROM invoices LIMIT 1");
      expect(typeof raw.amount_due).toBe("string"); // what pg itself hands back

      const invoice = await g.tenantStorage.run({ tenantId: TENANT_A }, () => g.models.Invoice.findOne());
      expect(typeof invoice.amountDue).toBe("number");
      expect(invoice.amountDue > invoice.amountPaid).toBe(false);
      expect(invoice.toJSON().amountPaid).toBe(1000);
    });
  });
});

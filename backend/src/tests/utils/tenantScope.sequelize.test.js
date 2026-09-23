/**
 * Contract test for D-01 — tenant isolation on `bulkCreate` and `upsert`.
 *
 * The unit tests in `tenantScope.test.js` prove the hook FUNCTIONS are right.
 * They cannot prove that Sequelize calls them, calls them with the arguments we
 * assume, or that what we mutate still reaches the statement. That is the part
 * that actually matters, and a mock of the ORM would only prove the mock.
 *
 * So this file drives the REAL `sequelize` Model class (6.x) against a real
 * Postgres query generator, with a real model, real global hooks and real
 * instance building. The only thing stubbed is the wire: `sequelize.query` is
 * replaced so nothing is sent anywhere. What we assert on is the SQL Sequelize
 * produced — the INSERT column values and the ON CONFLICT target.
 *
 * What this still does NOT prove: that Postgres executes that SQL the way we
 * read it. That needs a database; see the report.
 */

const { Sequelize, DataTypes } = require("sequelize");
const { tenantStorage } = require("../../middlewares/tenantContext.middleware");
const tenantScope = require("../../utils/tenantScope.util");

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

/** Build an isolated Sequelize instance with the isolation hooks registered. */
const buildDb = () => {
  const db = new Sequelize("postgres://u:p@127.0.0.1:5432/none", {
    dialect: "postgres",
    logging: false,
  });
  tenantScope.register(db);

  // A faithful copy of the TenantSettings shape: the unique index that makes
  // `upsert` resolve its conflict on (tenant_id, key).
  const TenantSettings = db.define(
    "TenantSettings",
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: { type: DataTypes.UUID, allowNull: false },
      key: { type: DataTypes.STRING(255), allowNull: false },
      value: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      tableName: "tenant_settings",
      timestamps: true,
      underscored: true,
      indexes: [{ fields: ["tenant_id", "key"], unique: true }],
    },
  );

  // `roles` has no tenant column at all — the seeding path in
  // migration.service.js must stay untouched by the hooks.
  const Roles = db.define(
    "Roles",
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      name: { type: DataTypes.STRING(64), allowNull: false },
    },
    { tableName: "roles", timestamps: true, underscored: true },
  );

  const statements = [];
  db.query = jest.fn(async (sql) => {
    statements.push(typeof sql === "string" ? sql : sql.query);
    // Shapes the two call sites destructure: bulkInsert reads results[0],
    // upsert reads [record] and assigns to it.
    return [[], 0];
  });

  return { db, TenantSettings, Roles, statements };
};

const asTenant = (tenantId, fn) =>
  tenantStorage.run({ tenantId, isSuperAdmin: false, isSystemTask: false }, fn);

describe("tenant isolation reaches the SQL for bulkCreate and upsert (D-01)", () => {
  describe("bulkCreate", () => {
    it("stamps the caller's tenant into the INSERT for a row that carries none", async () => {
      const { TenantSettings, statements } = buildDb();

      await asTenant(TENANT_A, () =>
        TenantSettings.bulkCreate([{ key: "ip_allowlist", value: "[]" }]),
      );

      expect(statements).toHaveLength(1);
      expect(statements[0]).toContain("INSERT INTO \"tenant_settings\"");
      // The stamp survived all the way into the VALUES list.
      expect(statements[0]).toContain(TENANT_A);
      expect(statements[0]).not.toContain(TENANT_B);
    });

    it("REFUSES to write when a row names another tenant, and emits no SQL", async () => {
      const { TenantSettings, statements } = buildDb();

      await expect(
        asTenant(TENANT_A, () =>
          TenantSettings.bulkCreate([
            { tenantId: TENANT_A, key: "a", value: "1" },
            { tenantId: TENANT_B, key: "b", value: "2" },
          ]),
        ),
      ).rejects.toThrow("Security Violation: Attempted to bulkCreate a cross-tenant record");

      // Nothing at all was sent — not even the row that was legitimate.
      expect(statements).toHaveLength(0);
    });

    it("writes nothing for an authenticated principal with no tenant", async () => {
      const { TenantSettings, statements } = buildDb();

      await expect(
        tenantStorage.run({ tenantId: null, isSuperAdmin: false }, () =>
          TenantSettings.bulkCreate([{ key: "a", value: "1" }]),
        ),
      ).rejects.toThrow("no resolvable tenant");

      expect(statements).toHaveLength(0);
    });

    it("leaves the seeding path (no request context, no tenant column) alone", async () => {
      const { Roles, statements } = buildDb();

      // migration.service.js seeds roles from a CLI script: no CLS store at all,
      // and `roles` has no tenant column either.
      await Roles.bulkCreate([{ name: "SUPER_ADMIN" }, { name: "USER" }], {
        ignoreDuplicates: true,
      });

      expect(statements).toHaveLength(1);
      expect(statements[0]).toContain("INSERT INTO \"roles\"");
      expect(statements[0]).toContain("ON CONFLICT DO NOTHING");
    });

    it("leaves a system task and the explicit escape hatch alone", async () => {
      const { TenantSettings, statements } = buildDb();

      await tenantStorage.run({ isSystemTask: true }, () =>
        TenantSettings.bulkCreate([{ tenantId: TENANT_B, key: "a", value: "1" }]),
      );
      await asTenant(TENANT_A, () =>
        TenantSettings.bulkCreate([{ tenantId: TENANT_B, key: "a", value: "1" }], {
          skipTenantScope: true,
        }),
      );

      expect(statements).toHaveLength(2);
      expect(statements[0]).toContain(TENANT_B);
      expect(statements[1]).toContain(TENANT_B);
    });
  });

  describe("upsert", () => {
    it("resolves its conflict on (tenant_id, key) — so a wrong tenant OVERWRITES, it does not fail", async () => {
      const { TenantSettings, statements } = buildDb();

      await asTenant(TENANT_A, () =>
        TenantSettings.upsert({
          tenantId: TENANT_A,
          key: "storage_credentials",
          value: "{}",
        }),
      );

      expect(statements).toHaveLength(1);
      // This is the answer to "what is the conflict target?" — read off the
      // statement Sequelize actually generated, not assumed.
      expect(statements[0]).toContain('ON CONFLICT ("tenant_id","key") DO UPDATE SET');
    });

    it("REFUSES an upsert naming another tenant, and emits no SQL", async () => {
      const { TenantSettings, statements } = buildDb();

      await expect(
        asTenant(TENANT_A, () =>
          TenantSettings.upsert({
            tenantId: TENANT_B,
            key: "storage_credentials",
            value: '{"secretAccessKey":"stolen"}',
          }),
        ),
      ).rejects.toThrow("Security Violation: Attempted to upsert a cross-tenant record");

      expect(statements).toHaveLength(0);
    });

    it("writes nothing for an authenticated principal with no tenant", async () => {
      const { TenantSettings, statements } = buildDb();

      await expect(
        tenantStorage.run({ tenantId: null, isSuperAdmin: false }, () =>
          TenantSettings.upsert({ tenantId: TENANT_B, key: "k", value: "v" }),
        ),
      ).rejects.toThrow("no resolvable tenant");

      expect(statements).toHaveLength(0);
    });

    it("still works for a super admin, which is every TenantSettings.upsert route", async () => {
      const { TenantSettings, statements } = buildDb();

      await tenantStorage.run({ isSuperAdmin: true }, () =>
        TenantSettings.upsert({
          tenantId: TENANT_B,
          key: "lifecycle_status",
          value: "SUSPENDED",
        }),
      );

      expect(statements).toHaveLength(1);
      expect(statements[0]).toContain(TENANT_B);
    });

    it("a beforeUpsert hook CANNOT stamp — Sequelize snapshots the values first", async () => {
      // This is why assertUpsertTenant refuses instead of stamping. Sequelize
      // 6.x builds insertValues/updateValues from the instance BEFORE running
      // beforeUpsert (lib/model.js: build, snapshot, then runHooks), so a hook
      // that mutates `values` changes nothing that reaches the database.
      const { db, TenantSettings, statements } = buildDb();
      db.addHook("beforeUpsert", (values) => {
        values.value = "MUTATED-BY-HOOK";
      });

      await asTenant(TENANT_A, () =>
        TenantSettings.upsert({ tenantId: TENANT_A, key: "k", value: "ORIGINAL" }),
      );

      expect(statements[0]).toContain("ORIGINAL");
      expect(statements[0]).not.toContain("MUTATED-BY-HOOK");
    });
  });
});

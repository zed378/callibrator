/**
 * W-01 — the tenant-lifecycle processor had never run.
 *
 * The service wrote six properties (`gracePeriodExpiresAt`, `offboardedAt`,
 * `offboardRetentionExpiresAt`, `suspensionReason`, `suspendedAt`,
 * `suspendedBy`) that were not attributes of the Tenant model. Sequelize drops
 * an unknown property without a word, so every grace period and retention
 * deadline was assigned to an object and never stored. The scheduled query
 * compared the lowercase ENUM to `'SUSPENDED'` and filtered on a column that
 * did not exist, so it threw every night into a log nobody reads.
 *
 * The old unit tests could not see any of it: they mocked `Tenant` as a bag of
 * jest.fn()s that accepted any property and any `where`. So this file uses the
 * REAL Tenant model, defined on an unconnected PostgreSQL-dialect Sequelize,
 * and captures the SQL Sequelize actually generates for it. Only the network
 * round-trip is stubbed — the attribute set, the field mapping and the query
 * text are Sequelize's own. What this cannot prove is that the columns exist
 * in a database: that is migration 0023, verified in psql.
 *
 * Writes go through the auditLedger fixture (real audit ENUM, real rollback,
 * `cls: false`), so a write that does not carry `{ transaction }` explicitly
 * survives a rollback and the test sees it.
 */
const fs = require("fs");
const path = require("path");
const { createLedger } = require("../fixtures/auditLedger");

const mockRef = {
  ledger: null,
  Tenant: null,
  /** id -> Tenant instance: what a findByPk "reads". */
  tenants: new Map(),
  /** what the scheduled grace-period SELECT "returns". */
  graceRows: [],
  /** every SQL statement Sequelize generated, in order. */
  sql: [],
  /** the tenant context observed at each tenant-scoped model call. */
  contexts: [],
};

jest.mock("../../models", () => {
  const { Sequelize, DataTypes } = jest.requireActual("sequelize");
  const sequelize = new Sequelize({ dialect: "postgres", logging: false });
  const Tenant = jest.requireActual("../../models/tenant.model")(sequelize, DataTypes);
  const { tenantStorage } = jest.requireActual("../../middlewares/tenantContext.middleware");

  // The only stub on the real path: the network. Everything above it —
  // attribute mapping, WHERE generation, UPDATE column lists — is Sequelize.
  sequelize.query = async (statement, options = {}) => {
    const sql = typeof statement === "string" ? statement : statement.query;
    const bind = typeof statement === "string" ? options.bind : statement.bind;
    mockRef.sql.push(sql);
    if (options.type === "UPDATE") {
      mockRef.ledger.write("tenants:update", { sql, bind }, { transaction: options.transaction });
      return [options.instance, 1];
    }
    if (options.type === "SELECT") {
      const byId = /"Tenant"\."id" = '([^']+)'/.exec(sql);
      const rows = byId
        ? [mockRef.tenants.get(byId[1])].filter(Boolean)
        : mockRef.graceRows;
      return options.plain ? rows[0] || null : rows;
    }
    throw new Error(`unexpected statement: ${sql}`);
  };
  mockRef.Tenant = Tenant;

  const scoped = (name, result) => async (...args) => {
    mockRef.contexts.push({ call: name, store: tenantStorage.getStore() || null });
    return typeof result === "function" ? result(...args) : result;
  };

  return {
    Tenant,
    TenantSettings: {
      findAll: scoped("TenantSettings.findAll", []),
      findOne: scoped("TenantSettings.findOne", null),
      upsert: scoped("TenantSettings.upsert", (values, options) =>
        mockRef.ledger.write("tenant_settings", values, options),
      ),
      destroy: scoped("TenantSettings.destroy", 0),
    },
    User: { findAll: scoped("User.findAll", []), destroy: scoped("User.destroy", 0) },
    Subscription: {
      findAll: scoped("Subscription.findAll", []),
      destroy: scoped("Subscription.destroy", 0),
    },
    Invoice: { findAll: scoped("Invoice.findAll", []), destroy: scoped("Invoice.destroy", 0) },
    AuditLog: {
      create: (...args) => {
        const { tenantStorage: storage } = jest.requireActual(
          "../../middlewares/tenantContext.middleware",
        );
        mockRef.contexts.push({ call: "AuditLog.create", store: storage.getStore() || null });
        return mockRef.ledger.AuditLog.create(...args);
      },
    },
  };
});
jest.mock("../../config", () => ({
  db: { transaction: (...args) => mockRef.ledger.transaction(...args) },
}));

const tenantLifecycle = require("../../services/tenantLifecycle.service");
const { logger } = require("../../middlewares/activityLog.middleware");
const { tenantStorage } = require("../../middlewares/tenantContext.middleware");

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const ADMIN = "99999999-9999-4999-8999-999999999999";
const DAY = 24 * 60 * 60 * 1000;

const SERVICE_SOURCE = fs.readFileSync(
  path.join(__dirname, "../../services/tenantLifecycle.service.ts"),
  "utf8",
);

/** A persisted-looking Tenant instance of the REAL model. */
const persistedTenant = (id, values = {}) => {
  const tenant = mockRef.Tenant.build(
    {
      id,
      name: `Tenant ${id.slice(0, 4)}`,
      subdomain: `t${id.slice(0, 4)}`,
      email: `ops-${id.slice(0, 4)}@example.com`,
      status: "active",
      isDeleted: false,
      ...values,
    },
    { isNewRecord: false },
  );
  // A row read back from the database has no pending changes.
  tenant._changed = new Set();
  tenant._previousDataValues = { ...tenant.dataValues };
  mockRef.tenants.set(id, tenant);
  return tenant;
};

/** Own properties an instance has that Sequelize does not know about. */
const shadowProperties = (instance, baseline) =>
  Object.keys(instance).filter((key) => !baseline.includes(key));

/** Every `"Tenant"."<column>"` a statement references. */
const referencedColumns = (sql) =>
  [...sql.matchAll(/"Tenant"\."([^"]+)"/g)].map((m) => m[1]);

const committedUpdates = () => mockRef.ledger.committed("tenants:update");

describe("W-01 — tenant lifecycle against the real Tenant model", () => {
  beforeEach(() => {
    mockRef.ledger = createLedger({ cls: false });
    mockRef.tenants = new Map();
    mockRef.graceRows = [];
    mockRef.sql = [];
    mockRef.contexts = [];
    jest.spyOn(logger, "info").mockImplementation(() => logger);
    jest.spyOn(logger, "warn").mockImplementation(() => logger);
    jest.spyOn(logger, "error").mockImplementation(() => logger);
  });

  describe("every property the service writes is a Tenant attribute", () => {
    // Data-driven from the service's SOURCE, not from the model: adding a
    // `tenant.foo = ...` without a model attribute (and a migration) fails here.
    const writtenKeys = [
      ...new Set(
        [...SERVICE_SOURCE.matchAll(/\btenant\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)].map((m) => m[1]),
      ),
    ].sort();

    it("finds the writes it is checking (the scan itself works)", () => {
      expect(writtenKeys).toEqual(
        expect.arrayContaining([
          "status",
          "gracePeriodExpiresAt",
          "offboardedAt",
          "offboardRetentionExpiresAt",
          "suspensionReason",
          "suspendedAt",
          "suspendedBy",
        ]),
      );
    });

    it.each(writtenKeys.map((k) => [k]))("Tenant.rawAttributes has %s", (key) => {
      expect(Object.keys(mockRef.Tenant.rawAttributes)).toContain(key);
    });

    it("every lifecycle attribute maps to a snake_case column (underscored: true)", () => {
      const fields = Object.fromEntries(
        [
          "gracePeriodExpiresAt",
          "offboardedAt",
          "offboardRetentionExpiresAt",
          "suspensionReason",
          "suspendedAt",
          "suspendedBy",
        ].map((a) => [a, mockRef.Tenant.rawAttributes[a] && mockRef.Tenant.rawAttributes[a].field]),
      );
      expect(fields).toEqual({
        gracePeriodExpiresAt: "grace_period_expires_at",
        offboardedAt: "offboarded_at",
        offboardRetentionExpiresAt: "offboard_retention_expires_at",
        suspensionReason: "suspension_reason",
        suspendedAt: "suspended_at",
        suspendedBy: "suspended_by",
      });
    });
  });

  describe("no mutation leaves a property Sequelize will silently drop", () => {
    // Behavioural twin of the source scan: run each mutating function on a
    // real instance and look for own properties Sequelize does not track.
    const baselineKeys = () => Object.keys(persistedTenant(T2));

    it.each([
      ["suspendTenant", (id) => tenantLifecycle.suspendTenant(id, "non-payment", ADMIN), {}],
      ["resumeTenant", (id) => tenantLifecycle.resumeTenant(id, ADMIN), { status: "suspended" }],
      ["enterGracePeriod", (id) => tenantLifecycle.enterGracePeriod(id, { userId: ADMIN }), { status: "suspended" }],
      ["offboardTenant", (id) => tenantLifecycle.offboardTenant(id), { status: "suspended" }],
      ["cancelOffboarding", (id) => tenantLifecycle.cancelOffboarding(id, { userId: ADMIN }), { status: "deleted" }],
    ])("%s", async (_name, run, initial) => {
      const baseline = baselineKeys();
      const tenant = persistedTenant(T1, initial);

      await run(T1);

      expect(shadowProperties(tenant, baseline)).toEqual([]);
      // ...and it reached the database: an UPDATE was issued and committed.
      expect(committedUpdates()).toHaveLength(1);
    });

    it("enterGracePeriod writes grace_period_expires_at", async () => {
      persistedTenant(T1, { status: "suspended" });

      await tenantLifecycle.enterGracePeriod(T1, { userId: ADMIN });

      const [update] = committedUpdates();
      expect(update.sql).toMatch(/"grace_period_expires_at"=\$\d+/);
    });

    it("suspendTenant writes the reason, the time and the actor", async () => {
      persistedTenant(T1);

      await tenantLifecycle.suspendTenant(T1, "non-payment", ADMIN);

      const [update] = committedUpdates();
      expect(update.sql).toMatch(/"status"=\$\d+/);
      expect(update.sql).toMatch(/"suspension_reason"=\$\d+/);
      expect(update.sql).toMatch(/"suspended_at"=\$\d+/);
      expect(update.sql).toMatch(/"suspended_by"=\$\d+/);
      expect(update.bind).toEqual(expect.arrayContaining(["suspended", "non-payment", ADMIN]));
    });

    it("resumeTenant clears a pending grace period, so a later suspension does not offboard at once", async () => {
      persistedTenant(T1, {
        status: "suspended",
        gracePeriodExpiresAt: new Date(Date.now() - DAY),
      });

      const tenant = await tenantLifecycle.resumeTenant(T1, ADMIN);

      expect(tenant.gracePeriodExpiresAt).toBeNull();
      expect(committedUpdates()[0].sql).toMatch(/"grace_period_expires_at"=\$\d+/);
    });
  });

  describe("processExpiredGracePeriods — the scheduled query", () => {
    const graceSelect = () =>
      mockRef.sql.find((s) => s.startsWith("SELECT") && /grace_?period_?expires_?at/i.test(s));

    it("compares status only to members of the tenants.status ENUM", async () => {
      await tenantLifecycle.processExpiredGracePeriods();

      const sql = graceSelect();
      expect(sql).toBeDefined();
      const literals = [...sql.matchAll(/"Tenant"\."status" = '([^']*)'/g)].map((m) => m[1]);
      expect(literals.length).toBeGreaterThan(0);
      for (const literal of literals) {
        expect(mockRef.Tenant.rawAttributes.status.values).toContain(literal);
      }
    });

    it("references only columns the Tenant model maps", async () => {
      await tenantLifecycle.processExpiredGracePeriods();

      const fields = Object.values(mockRef.Tenant.rawAttributes).map((a) => a.field);
      // `is_deleted` comes from the model's own defaultScope.
      for (const column of referencedColumns(graceSelect())) {
        expect(fields).toContain(column);
      }
    });

    it("selects suspended tenants whose grace period has passed, in SQL", async () => {
      await tenantLifecycle.processExpiredGracePeriods();

      const sql = graceSelect();
      expect(sql).toContain("\"Tenant\".\"status\" = 'suspended'");
      expect(sql).toMatch(/"Tenant"\."grace_period_expires_at" <= '[^']+'/);
    });
  });

  describe("offboarding a tenant whose grace period expired", () => {
    const expired = () => new Date(Date.now() - DAY);

    it("offboards it, and two audit rows (A-305: PLATFORM and the tenant) record it, in the same transaction", async () => {
      const tenant = persistedTenant(T1, { status: "suspended", gracePeriodExpiresAt: expired() });
      mockRef.graceRows = [tenant];

      const startedAt = Date.now();
      const result = await tenantLifecycle.processExpiredGracePeriods();
      const finishedAt = Date.now();

      expect(result).toEqual([{ tenantId: T1, action: "offboarded" }]);

      const [update] = committedUpdates();
      expect(update.sql).toMatch(/"status"=\$\d+/);
      expect(update.sql).toMatch(/"offboarded_at"=\$\d+/);
      expect(update.sql).toMatch(/"offboard_retention_expires_at"=\$\d+/);
      expect(update.bind).toContain("deleted");

      expect(mockRef.ledger.committed("tenant_settings")).toEqual([
        expect.objectContaining({ tenantId: T1, key: "lifecycle_status", value: "OFFBOARDED" }),
      ]);

      // A-305 (ADR-100): the A-165 rule — the platform's trail (which
      // outlives the offboarded tenant) and the tenant's, one transaction.
      const { PLATFORM_TENANT_ID } = require("../../constants/platformTenant");
      expect(mockRef.ledger.auditRows().map((r) => r.tenantId)).toEqual([PLATFORM_TENANT_ID, T1]);
      // The two rows are written one after the other, each stamped when it is
      // created, so their createdAt may differ by a millisecond (a flake until
      // 2026-10-02). Everything else must be the same row; each createdAt is
      // checked on its own: a real Date, inside this call.
      const [platformRow, tenantRow] = mockRef.ledger.auditRows();
      const { createdAt: platformCreatedAt, ...platformRest } = platformRow;
      const { createdAt: tenantCreatedAt, ...tenantRest } = tenantRow;
      expect(platformRest).toEqual({ ...tenantRest, tenantId: PLATFORM_TENANT_ID });
      for (const createdAt of [platformCreatedAt, tenantCreatedAt]) {
        expect(createdAt).toBeInstanceOf(Date);
        expect(createdAt.getTime()).toBeGreaterThanOrEqual(startedAt);
        expect(createdAt.getTime()).toBeLessThanOrEqual(finishedAt);
      }
      expect(mockRef.ledger.auditRows().slice(1)).toEqual([
        expect.objectContaining({
          tenantId: T1,
          userId: null,
          // A-124: the scheduler is a first-class system actor.
          actorType: "system",
          actorName: "system:tenant-lifecycle",
          action: "DELETE",
          resourceType: "Tenant",
          resourceId: T1,
          changes: expect.objectContaining({
            operation: "TENANT_OFFBOARD",
            actor: "system:tenant-lifecycle",
            before: expect.objectContaining({ status: "suspended" }),
            after: expect.objectContaining({
              status: "deleted",
              lifecycleStatus: "OFFBOARDED",
              offboardedAt: expect.any(String),
              offboardRetentionExpiresAt: expect.any(String),
            }),
          }),
        }),
      ]);
    });

    it("a failing audit insert rolls the offboarding back — nothing changes unrecorded", async () => {
      const tenant = persistedTenant(T1, { status: "suspended", gracePeriodExpiresAt: expired() });
      mockRef.graceRows = [tenant];
      mockRef.ledger.failNext("audit_logs", new Error("audit insert failed"));

      const result = await tenantLifecycle.processExpiredGracePeriods();

      expect(result).toEqual([{ tenantId: T1, action: "failed", error: "audit insert failed" }]);
      expect(committedUpdates()).toEqual([]);
      expect(mockRef.ledger.committed("tenant_settings")).toEqual([]);
      expect(mockRef.ledger.auditRows()).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining(T1),
        expect.objectContaining({ error: "audit insert failed" }),
      );
    });

    it("runs each tenant's offboarding confined to THAT tenant's context", async () => {
      const a = persistedTenant(T1, { status: "suspended", gracePeriodExpiresAt: expired() });
      const b = persistedTenant(T2, { status: "suspended", gracePeriodExpiresAt: expired() });
      mockRef.graceRows = [a, b];

      await tenantLifecycle.processExpiredGracePeriods();

      const scopedCalls = mockRef.contexts;
      expect(scopedCalls.length).toBeGreaterThan(0);
      for (const { store } of scopedCalls) {
        // Never unscoped, never cross-tenant, never super-admin/system-wide.
        expect(store).not.toBeNull();
        expect(store.isSuperAdmin).toBe(false);
        expect(store.isSystemTask).toBe(false);
        expect([T1, T2]).toContain(store.tenantId);
      }
      const { PLATFORM_TENANT_ID } = require("../../constants/platformTenant");
      const audits = mockRef.ledger.auditRows();
      // A-305: each offboarding writes a PLATFORM row and a tenant row.
      expect(audits.map((r) => r.tenantId)).toEqual([PLATFORM_TENANT_ID, T1, PLATFORM_TENANT_ID, T2]);
      // The context during each tenant's audit writes is that tenant.
      const auditContexts = scopedCalls.filter((c) => c.call === "AuditLog.create");
      expect(auditContexts.map((c) => c.store.tenantId)).toEqual([T1, T1, T2, T2]);
    });

    it("one tenant failing does not stop the next", async () => {
      const a = persistedTenant(T1, { status: "suspended", gracePeriodExpiresAt: expired() });
      const b = persistedTenant(T2, { status: "suspended", gracePeriodExpiresAt: expired() });
      mockRef.graceRows = [a, b];
      mockRef.ledger.failNext("audit_logs", new Error("boom"));

      const result = await tenantLifecycle.processExpiredGracePeriods();

      expect(result).toEqual([
        { tenantId: T1, action: "failed", error: "boom" },
        { tenantId: T2, action: "offboarded" },
      ]);
      const { PLATFORM_TENANT_ID } = require("../../constants/platformTenant");
      expect(mockRef.ledger.auditRows().map((r) => r.tenantId)).toEqual([PLATFORM_TENANT_ID, T2]);
    });

    it("an operator's offboarding names the operator, not the system", async () => {
      persistedTenant(T1, { status: "suspended" });

      await tenantLifecycle.offboardTenant(T1, false, {
        userId: ADMIN,
        ipAddress: "10.0.0.7",
        userAgent: "ops-console",
      });

      const { PLATFORM_TENANT_ID } = require("../../constants/platformTenant");
      const operatorRow = (tenantId) =>
        expect.objectContaining({
          tenantId,
          userId: ADMIN,
          action: "DELETE",
          ipAddress: "10.0.0.7",
          userAgent: "ops-console",
        });
      // A-305: PLATFORM and the tenant.
      expect(mockRef.ledger.auditRows()).toEqual([operatorRow(PLATFORM_TENANT_ID), operatorRow(T1)]);
      expect(mockRef.ledger.auditRows()[0].changes.actor).toBeUndefined();
    });

    it("an operator's offboarding inside a request keeps the caller's context", async () => {
      persistedTenant(T1, { status: "suspended" });
      const requestContext = { tenantId: null, isSuperAdmin: true, isSystemTask: false };

      await tenantStorage.run(requestContext, () =>
        tenantLifecycle.offboardTenant(T1, false, { userId: ADMIN }),
      );

      expect(mockRef.contexts.every((c) => c.store === requestContext)).toBe(true);
    });
  });

  it("the Tenant under test is the real model on a PostgreSQL-dialect Sequelize", () => {
    expect(mockRef.Tenant.sequelize.getDialect()).toBe("postgres");
    expect(mockRef.Tenant.getTableName()).toBe("tenants");
  });
});

// ---------------------------------------------------------------------------
// A-278 / A-279 (ADR-094) — the four operator transitions that wrote no audit
// row now write two (PLATFORM and the tenant, the A-165 rule) inside the
// transaction of the change; a failed row leaves the tenant as it was. An
// offboarded tenant cannot be suspended or resumed (409), and a cancellation
// of something that is not offboarded is 409, not 400.
// ---------------------------------------------------------------------------
describe("A-278 / A-279 — operator lifecycle transitions are audited, and conflicts are 409", () => {
  const { PLATFORM_TENANT_ID } = require("../../constants/platformTenant");
  const OPERATOR = { userId: ADMIN, ipAddress: "10.0.0.5", userAgent: "ops-console" };

  beforeEach(() => {
    mockRef.ledger = createLedger({ cls: false });
    mockRef.tenants = new Map();
    mockRef.sql = [];
    mockRef.contexts = [];
    jest.spyOn(logger, "info").mockImplementation(() => logger);
    jest.spyOn(logger, "warn").mockImplementation(() => logger);
    jest.spyOn(logger, "error").mockImplementation(() => logger);
  });

  afterEach(() => jest.restoreAllMocks());

  it.each([
    ["suspendTenant", "TENANT_SUSPEND", {}, (id) => tenantLifecycle.suspendTenant(id, "contract ended", ADMIN, OPERATOR)],
    ["resumeTenant", "TENANT_RESUME", { status: "suspended" }, (id) => tenantLifecycle.resumeTenant(id, ADMIN, OPERATOR)],
    ["enterGracePeriod", "TENANT_GRACE_PERIOD", { status: "suspended" }, (id) => tenantLifecycle.enterGracePeriod(id, OPERATOR)],
    ["cancelOffboarding", "TENANT_CANCEL_OFFBOARDING", { status: "deleted" }, (id) => tenantLifecycle.cancelOffboarding(id, OPERATOR)],
  ])("%s writes one row under PLATFORM and one under the tenant, committed with the change", async (_n, operation, initial, run) => {
    const before = persistedTenant(T1, initial).status;

    await run(T1);

    expect(committedUpdates()).toHaveLength(1);
    const rows = mockRef.ledger.auditRows();
    expect(rows.map((r) => r.tenantId)).toEqual([PLATFORM_TENANT_ID, T1]);
    for (const row of rows) {
      expect(row).toMatchObject({
        userId: ADMIN,
        action: "UPDATE",
        resourceType: "Tenant",
        resourceId: T1,
        ipAddress: "10.0.0.5",
        userAgent: "ops-console",
        changes: expect.objectContaining({ operation, before: expect.objectContaining({ status: before }) }),
      });
    }
  });

  it("A-305: offboardTenant by the operator writes one row under PLATFORM and one under the tenant, committed with it", async () => {
    persistedTenant(T1, { status: "suspended" });

    await tenantLifecycle.offboardTenant(T1, false, OPERATOR);

    expect(committedUpdates()).toHaveLength(1);
    const rows = mockRef.ledger.auditRows();
    expect(rows.map((r) => r.tenantId)).toEqual([PLATFORM_TENANT_ID, T1]);
    for (const row of rows) {
      expect(row).toMatchObject({
        userId: ADMIN,
        actorType: "user",
        action: "DELETE",
        resourceType: "Tenant",
        resourceId: T1,
        ipAddress: "10.0.0.5",
        userAgent: "ops-console",
        changes: expect.objectContaining({ operation: "TENANT_OFFBOARD", before: expect.objectContaining({ status: "suspended" }) }),
      });
      expect(row.changes).not.toHaveProperty("actor");
    }
  });

  it("A-305: a failed second row rolls the offboarding and the first row back", async () => {
    persistedTenant(T1, { status: "suspended" });
    const auditService = require("../../services/audit.service");
    const realLogAction = auditService.logAction;
    jest
      .spyOn(auditService, "logAction")
      .mockImplementationOnce((...args) => realLogAction(...args))
      .mockRejectedValueOnce(new Error("audit insert failed"));

    await expect(tenantLifecycle.offboardTenant(T1, false, OPERATOR)).rejects.toThrow("audit insert failed");

    expect(committedUpdates()).toEqual([]);
    expect(mockRef.ledger.committed("tenant_settings")).toEqual([]);
    expect(mockRef.ledger.auditRows()).toEqual([]);
  });

  it("a row that cannot be written rolls the change back (no actor: the insert fails closed)", async () => {
    persistedTenant(T1, { status: "suspended" });

    await expect(tenantLifecycle.enterGracePeriod(T1, {})).rejects.toThrow();

    expect(committedUpdates()).toEqual([]);
    expect(mockRef.ledger.auditRows()).toEqual([]);
  });

  it("cancelOffboarding returns the lifecycle setting to ACTIVE with the tenant", async () => {
    persistedTenant(T1, { status: "deleted", offboardedAt: new Date() });

    await tenantLifecycle.cancelOffboarding(T1, OPERATOR);

    expect(mockRef.ledger.committed("tenant_settings")).toEqual([
      expect.objectContaining({ tenantId: T1, key: "lifecycle_status", value: "ACTIVE" }),
    ]);
  });

  it.each([
    ["suspendTenant", (id) => tenantLifecycle.suspendTenant(id, "x", ADMIN, OPERATOR), "suspended"],
    ["resumeTenant", (id) => tenantLifecycle.resumeTenant(id, ADMIN, OPERATOR), "resumed"],
  ])("%s of an offboarded tenant is 409, and nothing is written", async (_n, run, verb) => {
    persistedTenant(T1, { status: "deleted", offboardedAt: new Date() });

    const err = await run(T1).catch((e) => e);

    expect(err.status).toBe(409);
    expect(err.message).toContain(`This tenant is offboarded: it cannot be ${verb}`);
    expect(committedUpdates()).toEqual([]);
    expect(mockRef.ledger.auditRows()).toEqual([]);
  });

  it("cancelOffboarding of a tenant that is not offboarded is 409, naming its state", async () => {
    persistedTenant(T1, { status: "suspended" });

    const err = await tenantLifecycle.cancelOffboarding(T1, OPERATOR).catch((e) => e);

    expect(err.status).toBe(409);
    expect(err.message).toContain('This tenant is "suspended", not offboarded');
    expect(committedUpdates()).toEqual([]);
  });

  it("an operator suspension already in place is a no-op, with no row", async () => {
    persistedTenant(T1, { status: "suspended", suspendedBy: ADMIN, suspensionReason: "contract ended" });

    await tenantLifecycle.suspendTenant(T1, "again", ADMIN, OPERATOR);

    expect(committedUpdates()).toEqual([]);
    expect(mockRef.ledger.auditRows()).toEqual([]);
  });

  it("A-276: the operator's suspension REPLACES a dunning one, so a payment cannot lift it", async () => {
    persistedTenant(T1, {
      status: "suspended",
      suspendedBy: null,
      suspensionReason: tenantLifecycle.DUNNING_SUSPENSION_REASON,
    });

    const tenant = await tenantLifecycle.suspendTenant(T1, "fraud review", ADMIN, OPERATOR);

    expect(tenant.suspendedBy).toBe(ADMIN);
    expect(tenant.suspensionReason).toBe("fraud review");
    expect(tenantLifecycle.isDunningSuspension(tenant)).toBe(false);
    expect(mockRef.ledger.auditRows()).toHaveLength(2);
  });

  it("the default actor of suspend and resume is the operator id they are given", async () => {
    persistedTenant(T1);
    await tenantLifecycle.suspendTenant(T1, "x", ADMIN);
    await tenantLifecycle.resumeTenant(T1, ADMIN);
    expect(mockRef.ledger.auditRows().map((r) => r.userId)).toEqual([ADMIN, ADMIN, ADMIN, ADMIN]);
  });
});

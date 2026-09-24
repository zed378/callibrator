/**
 * A-187 — tenantHierarchy#createSubOrganization on the REAL models.
 *
 * It never worked: `tenants.subdomain` and `tenants.email` are NOT NULL and it
 * set neither, so Sequelize's validation refused every create and the catch
 * answered 500. The depth check ran after both rows were inserted (and undid
 * them with two more autocommits), and nothing was audited.
 *
 * These run the real models barrel — real attributes and validators, real
 * global tenant hooks, the real audit.service and AuditLog model — on an
 * UNCONNECTED PostgreSQL-dialect Sequelize whose `query` records each
 * statement against the transaction it was issued in (the technique of
 * tenantHierarchy.cascade.a134 / userRoles.a110). `db.transaction` commits a
 * transaction's statements only when its callback resolves, so "committed"
 * below means what PostgreSQL would have kept.
 */

process.env.HIERARCHY_ENABLED = "true";

const PARENT = "11111111-1111-4111-8111-111111111111";

const mockDb = { statements: [], committed: [], parent: null, hierarchy: null, failOn: null };

jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual("sequelize");
  const db = new Sequelize({ dialect: "postgres", logging: false });
  db.query = async (sql, options = {}) => {
    const text = typeof sql === "string" ? sql : sql.query;
    // The transaction's id, not the object: Sequelize clones query options.
    const entry = {
      text,
      tx: options.transaction ? options.transaction.id : null,
      // The row as validated and about to be inserted.
      row: options.instance ? options.instance.get({ plain: true }) : null,
    };
    mockDb.statements.push(entry);
    if (mockDb.failOn && mockDb.failOn.test(text)) {
      const { UniqueConstraintError } = jest.requireActual("sequelize");
      throw mockDb.failWith || new UniqueConstraintError({ message: "duplicate key" });
    }
    if (!entry.tx && /^INSERT /i.test(text)) {
      mockDb.committed.push(entry); // an autocommitted write
    }
    if (/^SELECT count\(/i.test(text)) {return { count: 2 };}
    if (/^INSERT /i.test(text)) {return [options.instance, 1];}
    if (/FROM "tenant_hierarchies"/.test(text) && options.plain) {return mockDb.hierarchy;}
    if (/FROM "tenants"/.test(text) && options.plain) {return mockDb.parent;}
    return options.plain ? null : [];
  };
  let seq = 0;
  db.transaction = async (callback) => {
    seq += 1;
    const tx = { id: `tx-${seq}`, options: {} };
    const result = await callback(tx);
    mockDb.committed.push(...mockDb.statements.filter((s) => s.tx === tx.id));
    return result;
  };
  return { db };
});

const svc = require("../../services/tenantHierarchy.service");
const { tenantStorage } = require("../../middlewares/tenantContext.middleware");
const { logger } = require("../../middlewares/activityLog.middleware");
const { PLATFORM_TENANT_ID } = require("../../constants/platformTenant");

const actor = { userId: "22222222-2222-4222-8222-222222222222", tenantId: PARENT, ipAddress: "10.0.0.9", userAgent: "UA" };

// The request context of a SUPERADMIN (the route is platformOnly).
const asSuperAdmin = (fn) => tenantStorage.run({ tenantId: PARENT, isSuperAdmin: true }, fn);

const inserts = (rows, table) => rows.filter((s) => new RegExp(`^INSERT INTO "${table}"`).test(s.text));

beforeEach(() => {
  mockDb.statements = [];
  mockDb.committed = [];
  mockDb.failOn = null;
  mockDb.failWith = null;
  mockDb.hierarchy = null;
  mockDb.parent = {
    id: PARENT,
    name: "Hospital A",
    code: "HOSP_A",
    subdomain: "hosp-a",
    email: "admin@hospital-a.example",
    status: "active",
    plan: "business",
  };
  jest.spyOn(logger, "error").mockImplementation(() => logger);
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  delete process.env.HIERARCHY_ENABLED;
});

describe("A-187 — createSubOrganization creates a valid tenant, its hierarchy row and one audit row, together", () => {
  it("passes the real model's validation: subdomain derived from the code, email from the parent", async () => {
    const result = await asSuperAdmin(() => svc.createSubOrganization(PARENT, { name: "Branch A" }, actor));

    expect(result).toMatchObject({ code: "HOSP_A_003", path: "/hosp_a/hosp_a_003", depth: 1 });
    const [tenantInsert] = inserts(mockDb.committed, "tenants");
    expect(tenantInsert.row).toMatchObject({
      name: "Branch A",
      subdomain: "hosp-a-003",
      email: "admin@hospital-a.example",
      code: "HOSP_A_003",
      parentId: PARENT,
      plan: "business",
      status: "active",
    });
  });

  it("commits the tenant, the hierarchy row and the audit row in ONE transaction, nothing autocommitted", async () => {
    await asSuperAdmin(() => svc.createSubOrganization(PARENT, { name: "Branch A" }, actor));

    const tenant = inserts(mockDb.committed, "tenants");
    const hierarchy = inserts(mockDb.committed, "tenant_hierarchies");
    const audit = inserts(mockDb.committed, "audit_logs");
    expect([tenant.length, hierarchy.length, audit.length]).toEqual([1, 1, 1]);
    expect(tenant[0].tx).not.toBeNull();
    expect(hierarchy[0].tx).toBe(tenant[0].tx);
    expect(audit[0].tx).toBe(tenant[0].tx);
  });

  it("the audit row is a PLATFORM row naming the acting super admin and the new tenant", async () => {
    const result = await asSuperAdmin(() => svc.createSubOrganization(PARENT, { name: "Branch A" }, actor));

    const [audit] = inserts(mockDb.committed, "audit_logs");
    expect(audit.row).toMatchObject({
      tenantId: PLATFORM_TENANT_ID,
      userId: actor.userId,
      actorType: "user",
      action: "CREATE",
      resourceType: "Tenant",
      resourceId: result.tenantId,
      ipAddress: "10.0.0.9",
      userAgent: "UA",
    });
    expect(audit.row.changes).toEqual({
      operation: "CREATE_SUB_ORGANIZATION",
      before: {},
      after: { name: "Branch A", code: "HOSP_A_003", subdomain: "hosp-a-003", parentId: PARENT, path: "/hosp_a/hosp_a_003", depth: 1 },
    });
  });

  it("an explicit code is used, and its subdomain follows it", async () => {
    const result = await asSuperAdmin(() =>
      svc.createSubOrganization(PARENT, { name: "Branch B", code: "HOSP_A_EAST" }, actor),
    );

    expect(result.code).toBe("HOSP_A_EAST");
    expect(inserts(mockDb.committed, "tenants")[0].row.subdomain).toBe("hosp-a-east");
  });

  it("builds on the parent's own hierarchy row when it has one", async () => {
    mockDb.hierarchy = { id: "h-1", tenantId: PARENT, tenantCode: "HOSP_A", path: "/group/hosp_a", depth: 1 };

    const result = await asSuperAdmin(() => svc.createSubOrganization(PARENT, { name: "Branch A" }, actor));

    expect(result).toMatchObject({ path: "/group/hosp_a/hosp_a_003", depth: 2 });
  });

  it("a failed audit insert commits nothing (the change cannot be unattributed)", async () => {
    mockDb.failOn = /^INSERT INTO "audit_logs"/;
    mockDb.failWith = new Error("audit insert failed");

    await expect(asSuperAdmin(() => svc.createSubOrganization(PARENT, { name: "Branch A" }, actor))).rejects.toMatchObject({
      status: 500,
    });
    expect(mockDb.committed).toEqual([]);
  });

  it("with no actor it is refused, and nothing is committed (A-124)", async () => {
    await expect(asSuperAdmin(() => svc.createSubOrganization(PARENT, { name: "Branch A" }))).rejects.toMatchObject({
      status: 500,
    });
    expect(mockDb.committed).toEqual([]);
  });

  it("a code or subdomain already taken is 409, not 500", async () => {
    mockDb.failOn = /^INSERT INTO "tenants"/;

    await expect(asSuperAdmin(() => svc.createSubOrganization(PARENT, { name: "Branch A" }, actor))).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('"HOSP_A_003"'),
    });
    expect(mockDb.committed).toEqual([]);
  });
});

describe("A-187 — refusals happen before any write", () => {
  const writes = () => mockDb.statements.filter((s) => /^(INSERT|UPDATE|DELETE)/i.test(s.text));

  it("a parent that does not exist is 404", async () => {
    mockDb.parent = null;
    await expect(asSuperAdmin(() => svc.createSubOrganization(PARENT, { name: "X1" }, actor))).rejects.toMatchObject({ status: 404 });
    expect(writes()).toEqual([]);
  });

  it("a parent that is not active is 409, with its state", async () => {
    mockDb.parent.status = "suspended";
    await expect(asSuperAdmin(() => svc.createSubOrganization(PARENT, { name: "X1" }, actor))).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("suspended"),
    });
    expect(writes()).toEqual([]);
  });

  it("a parent with no code is 409", async () => {
    mockDb.parent.code = null;
    await expect(asSuperAdmin(() => svc.createSubOrganization(PARENT, { name: "X1" }, actor))).rejects.toMatchObject({ status: 409 });
    expect(writes()).toEqual([]);
  });

  it("the depth limit is 409 and is checked BEFORE the rows are written (they used to be inserted, then deleted)", async () => {
    mockDb.hierarchy = { id: "h-1", tenantId: PARENT, tenantCode: "HOSP_A", path: "/a/b/c/d/e", depth: 5 };
    await expect(asSuperAdmin(() => svc.createSubOrganization(PARENT, { name: "X1" }, actor))).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("Maximum hierarchy depth (5)"),
    });
    expect(writes()).toEqual([]);
  });
});

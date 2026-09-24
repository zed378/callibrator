/**
 * A-125 (ADR-051 Q-14, F-7) and A-124 — who can read the PLATFORM tenant's
 * audit trail, and what a reader sees of the actor.
 *
 * Real chain: audit.route -> dynamicAccess -> audit.controller ->
 * audit.service, over the two-tenant fixture. The request runs inside the
 * REAL tenant context (tenantContext.middleware), and the AuditLog double
 * applies the REAL tenant predicate (utils/tenantScope.util.js
 * applyTenantWhere — what the global beforeFind hook runs) before filtering
 * in-memory rows. Stubbed: `auth` (sets req.user as auth.middleware does), the
 * permission matrix.
 *
 * What this does not prove is the SQL: the tenant hooks' SQL is covered by
 * their own suites, and the PLATFORM row and CHECK were verified on
 * PostgreSQL 18.
 */
const mockFx = { current: null };
const mockRows = [];
let currentUser = null;

jest.mock("../../middlewares/auth.middleware", () => {
  const actual = jest.requireActual("../../middlewares/auth.middleware");
  const { tenantContextMiddleware } = jest.requireActual("../../middlewares/tenantContext.middleware");
  return {
    ...actual,
    auth: (req, res, next) => {
      req.user = currentUser;
      req.tenantId = currentUser.tenantId;
      tenantContextMiddleware(req, res, next);
    },
  };
});

jest.mock("../../models", () => {
  const { applyTenantWhere } = jest.requireActual("../../utils/tenantScope.util");
  const matches = (row, where) =>
    Object.entries(where).every(([key, value]) => value === undefined || row[key] === value);
  return {
    Tenants: { findByPk: (...args) => mockFx.current.Tenants.findByPk(...args) },
    User: {},
    Users: {},
    AuditLog: {
      findAndCountAll: jest.fn(async (options) => {
        // What the global beforeFind hook does to this query.
        applyTenantWhere(options, { rawAttributes: { tenantId: {} } });
        const rows = mockRows.filter((r) => matches(r, options.where));
        return {
          count: rows.length,
          rows: rows.map((r) => ({ toJSON: () => ({ ...r }) })),
        };
      }),
    },
  };
});

jest.mock("../../services/roles.service", () => ({ getRolePermissionsMatrix: jest.fn() }));
jest.mock("../../services/userPermission.service", () => ({
  getUserOverrideMatrix: jest.fn().mockResolvedValue({}),
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { createTwoTenants } = require("../fixtures/twoTenants");
const RolesService = require("../../services/roles.service");
const { AuditLog } = require("../../models");
const { ROLE_NAMES } = require("../../constants");
const { PLATFORM_TENANT_ID } = require("../../constants/platformTenant");
const router = require("../../routes/api/audit.route");
const { errorHandler } = require("../../middlewares/errorHandlers.middleware");

const http = (query = {}) =>
  new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headersSent: false,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.headersSent = true;
        resolve({ status: this.statusCode, body: payload });
        return this;
      },
      send(payload) {
        return this.json(payload);
      },
      setHeader() {
        return this;
      },
      end() {
        resolve({ status: this.statusCode, body: null });
        return this;
      },
    };
    const search = new URLSearchParams(query).toString();
    const req = {
      method: "GET",
      url: search ? `/?${search}` : "/",
      originalUrl: "/api/v1/audit",
      body: {},
      query,
      params: {},
      headers: {},
      ip: "127.0.0.1",
      get: () => undefined,
    };
    router.handle(req, res, (err) => {
      if (err && typeof errorHandler === "function") {
        return errorHandler(err, req, res, () => {});
      }
      return resolve({
        status: err ? err.status || err.statusCode || 500 : 404,
        body: { message: err ? err.message : "no route" },
      });
    });
  });

let fx;
let hospitalAdmin;

beforeEach(() => {
  jest.clearAllMocks();
  fx = createTwoTenants();
  mockFx.current = fx;
  hospitalAdmin = fx.principal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);
  RolesService.getRolePermissionsMatrix.mockResolvedValue({
    "Audit Logs": ["read"],
    audit: ["read"],
    AuditLogs: ["read"],
  });
  mockRows.length = 0;
  mockRows.push(
    {
      id: "a-1",
      tenantId: fx.tenantA.id,
      userId: hospitalAdmin.id,
      actorType: "user",
      actorName: null,
      action: "UPDATE",
      resourceType: "CalibrationDevice",
    },
    {
      id: "a-2",
      tenantId: fx.tenantA.id,
      userId: null,
      actorType: "system",
      actorName: "system:retention-purge",
      action: "DELETE",
      resourceType: "DataRetention",
    },
    {
      id: "b-1",
      tenantId: fx.tenantB.id,
      userId: "someone-in-b",
      actorType: "user",
      actorName: null,
      action: "UPDATE",
      resourceType: "User",
    },
    {
      id: "p-1",
      tenantId: PLATFORM_TENANT_ID,
      userId: fx.superAdmin.id,
      actorType: "user",
      actorName: null,
      action: "CREATE",
      resourceType: "Tenant",
      resourceId: fx.tenantB.id,
      changes: { after: { name: "Hospital B" } },
    },
  );
});

const ids = (res) => res.body.data.map((r) => r.id).sort();

describe("A-125 — the platform audit trail", () => {
  it("a hospital admin cannot read platform audit rows", async () => {
    currentUser = hospitalAdmin;

    const asked = await http({ scope: "platform" });
    const own = await http();

    expect(asked.status).toBe(403);
    expect(asked.body.message).toBe("Only a platform administrator can read the platform audit trail");
    // Their own trail has no platform row in it — not even the creation of a
    // tenant their super admin's home happens to be.
    expect(own.status).toBe(200);
    expect(ids(own)).toEqual(["a-1", "a-2"]);
    // The refused request never reached the table.
    expect(AuditLog.findAndCountAll).toHaveBeenCalledTimes(1);
  });

  it("naming the PLATFORM tenant in the query is a 404 at the gate, like any foreign tenant", async () => {
    currentUser = hospitalAdmin;

    const res = await http({ tenantId: PLATFORM_TENANT_ID });

    expect(res.status).toBe(404);
    expect(AuditLog.findAndCountAll).not.toHaveBeenCalled();
  });

  it("even if asked for PLATFORM's rows, the tenant hooks give a hospital principal only its own", async () => {
    currentUser = hospitalAdmin;
    const auditService = require("../../services/audit.service");
    const { tenantStorage } = require("../../middlewares/tenantContext.middleware");

    const result = await tenantStorage.run(
      { tenantId: fx.tenantA.id, isSuperAdmin: false, isSystemTask: false },
      () => auditService.fetchAuditLogs({ tenantId: PLATFORM_TENANT_ID }),
    );

    expect(result.data.rows.map((r) => r.id).sort()).toEqual(["a-1", "a-2"]);
  });

  it("a super admin reads the platform trail with scope=platform — and only it", async () => {
    currentUser = fx.superAdmin;

    const res = await http({ scope: "platform" });

    expect(res.status).toBe(200);
    expect(ids(res)).toEqual(["p-1"]);
    expect(res.body.meta).toMatchObject({ total: 1 });
  });

  it("a super admin's default trail is their home tenant, which holds no platform rows", async () => {
    currentUser = fx.superAdmin;

    const res = await http();

    expect(ids(res)).toEqual(["a-1", "a-2"]);
  });

  it("an unknown scope is a 400", async () => {
    currentUser = fx.superAdmin;

    const res = await http({ scope: "everything" });

    expect(res.status).toBe(400);
  });
});

describe("A-124 — the audit API returns the actor", () => {
  it("each row carries actorType and actorName, and a system row names its job", async () => {
    currentUser = hospitalAdmin;

    const res = await http();

    const system = res.body.data.find((r) => r.id === "a-2");
    expect(system).toMatchObject({ userId: null, actorType: "system", actorName: "system:retention-purge" });
    expect(res.body.data.find((r) => r.id === "a-1")).toMatchObject({ actorType: "user", actorName: null });
  });

  it("actorType=system lists only the actions no person took", async () => {
    currentUser = hospitalAdmin;

    const res = await http({ actorType: "system" });

    expect(ids(res)).toEqual(["a-2"]);
  });

  it("an actorType outside the ENUM is a 400, not a database error", async () => {
    currentUser = hospitalAdmin;

    const res = await http({ actorType: "robot" });

    expect(res.status).toBe(400);
    expect(AuditLog.findAndCountAll).not.toHaveBeenCalled();
  });
});

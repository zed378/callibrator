/**
 * A-187 — POST /tenant-hierarchy/:parentId/children, through the real chain:
 * tenantHierarchy.route (real `superAdminOnly`, `denyApiKey`, `validateUuid`)
 * → controller → service, over the two-tenant fixture. Only `auth` (to set the
 * principal), the models and the audit insert are doubled.
 *
 * The route is a platform operation (SUPERADMIN, A-01). Two tenants:
 *  - a tenant administrator of A gets the SAME answer for tenant B's id, for
 *    an id that does not exist, and for its own tenant's id — the route says
 *    nothing about which tenants exist — and nothing is created;
 *  - the super admin gets 404 for a parent that does not exist (never 403),
 *    and creates a child under tenant B with one audit row.
 */

const mockFx = { current: null, created: [], hierarchy: [] };
let currentUser = null;

jest.mock("../../middlewares/auth.middleware", () => {
  const actual = jest.requireActual("../../middlewares/auth.middleware");
  return {
    ...actual,
    auth: (req, res, next) => {
      req.user = currentUser;
      next();
    },
  };
});

jest.mock("../../models", () => ({
  Tenant: {
    findByPk: (...args) => mockFx.current.Tenants.findByPk(...args),
    create: async (values) => {
      const row = { id: "cccccccc-0000-4000-8000-000000000001", ...values };
      mockFx.created.push(row);
      return row;
    },
  },
  TenantHierarchy: {
    findOne: async () => null,
    count: async () => 0,
    create: async (values) => {
      mockFx.hierarchy.push(values);
      return values;
    },
  },
}));

jest.mock("../../config", () => ({
  db: { transaction: async (cb) => cb("TX") },
}));
jest.mock("../../services/audit.service", () => ({
  logAction: jest.fn().mockResolvedValue({}),
}));

process.env.HIERARCHY_ENABLED = "true";

const { createTwoTenants } = require("../fixtures/twoTenants");
const auditService = require("../../services/audit.service");
const { ROLE_NAMES } = require("../../constants");
const { PLATFORM_TENANT_ID } = require("../../constants/platformTenant");
const router = require("../../routes/api/tenantHierarchy.route");

const MISSING = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

// Express's own router.handle with a minimal req/res pair (the harness of
// tenant.edit.a63.test.js — supertest is not a dependency here).
const http = (method, url, body = {}) =>
  new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ status: this.statusCode, body: payload });
        return this;
      },
      setHeader() {
        return this;
      },
    };
    const req = {
      method: method.toUpperCase(),
      url,
      originalUrl: "/api/v1/tenant-hierarchy" + url,
      body,
      query: {},
      params: {},
      headers: { "user-agent": "jest" },
      ip: "127.0.0.1",
      get: () => undefined,
    };
    router.handle(req, res, (err) =>
      resolve({ status: err ? err.status || 500 : 404, body: { message: err ? err.message : "no route" } }),
    );
  });

let fx;

beforeEach(() => {
  jest.clearAllMocks();
  fx = createTwoTenants();
  // The model's status ENUM is lower-case; the fixture's rows are not.
  fx.tenantA.status = "active";
  fx.tenantB.status = "active";
  mockFx.current = fx;
  mockFx.created = [];
  mockFx.hierarchy = [];
  currentUser = null;
});

afterAll(() => {
  delete process.env.HIERARCHY_ENABLED;
});

describe("A-187 — POST /:parentId/children across two tenants", () => {
  it("a tenant admin of A gets the same answer for B's id, a missing id and its own — and nothing is created", async () => {
    currentUser = fx.principal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);

    const other = await http("post", `/${fx.tenantB.id}/children`, { name: "Branch" });
    const missing = await http("post", `/${MISSING}/children`, { name: "Branch" });
    const own = await http("post", `/${fx.tenantA.id}/children`, { name: "Branch" });

    expect(other.status).toBe(403);
    expect(missing).toEqual(other);
    expect(own).toEqual(other);
    expect(mockFx.created).toEqual([]);
    expect(auditService.logAction).not.toHaveBeenCalled();
  });

  it("the super admin gets 404 for a parent that does not exist — never 403", async () => {
    currentUser = fx.superAdmin;

    const res = await http("post", `/${MISSING}/children`, { name: "Branch" });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, message: "Parent tenant not found" });
    expect(mockFx.created).toEqual([]);
  });

  it("a malformed parent id is 400 before the service runs", async () => {
    currentUser = fx.superAdmin;

    const res = await http("post", "/not-a-uuid/children", { name: "Branch" });

    expect(res.status).toBe(400);
    expect(mockFx.created).toEqual([]);
  });

  it("the super admin creates a child under tenant B, valid for the model, with one PLATFORM audit row", async () => {
    currentUser = fx.superAdmin;

    const res = await http("post", `/${fx.tenantB.id}/children`, { name: "Branch B-1" });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ code: "HOSP-B_001", depth: 1, path: "/hosp-b/hosp-b_001" });
    expect(mockFx.created).toEqual([
      expect.objectContaining({
        name: "Branch B-1",
        parentId: fx.tenantB.id,
        subdomain: "hosp-b-001",
        email: "admin@hospital-b.test",
      }),
    ]);
    expect(auditService.logAction).toHaveBeenCalledTimes(1);
    expect(auditService.logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: PLATFORM_TENANT_ID,
        userId: fx.superAdmin.id,
        action: "CREATE",
        resourceType: "Tenant",
      }),
      { transaction: "TX" },
    );
  });
});

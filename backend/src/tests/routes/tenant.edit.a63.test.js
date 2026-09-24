/**
 * A-63 — any authenticated user could edit, or suspend, any tenant.
 *
 * PATCH /api/v1/tenants/edit was gated by
 * `dynamicAccess("Management", "update", { checkSelf: true, checkTenant: true })`.
 * The self bypass ran FIRST, took the owner id from `req.body.userId`, and on a
 * match called next() — so the tenant check never ran — and
 * tenantService.updateTenant loaded the tenant with an unscoped findByPk. A
 * body `{ userId: <self>, tenantId: <any>, status: "SUSPENDED" }` suspended
 * another hospital.
 *
 * These are behaviour tests through the REAL chain: tenant.route →
 * dynamicAccess → tenant.controller → tenant.service, over the two-tenant
 * fixture (fixtures/twoTenants.js). Only `auth` (to set the principal), the
 * permission matrix, the rate limiter, the storage quota, the upload
 * middleware, redis and the audit insert are stubbed. The matrix follows the
 * seed: the admin roles hold Management write, USER holds no Management grant.
 */

const mockFx = { current: null };
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

// Modules destructure the models barrel at load time, so the doubles are
// stable objects that delegate to the fixture of the current test.
jest.mock("../../models", () => {
  const users = { findByPk: (...args) => mockFx.current.Users.findByPk(...args) };
  return {
    Tenants: {
      findByPk: (...args) => mockFx.current.Tenants.findByPk(...args),
      findOne: (...args) => mockFx.current.Tenants.findOne(...args),
    },
    User: users,
    Users: users,
    TenantSettings: {},
  };
});

jest.mock("../../config", () => ({
  db: {
    transaction: (...args) => mockFx.current.transaction(...args),
  },
}));

jest.mock("../../services/roles.service", () => ({
  getRolePermissionsMatrix: jest.fn(),
}));
jest.mock("../../services/userPermission.service", () => ({
  getUserOverrideMatrix: jest.fn().mockResolvedValue({}),
}));
jest.mock("../../services/rateLimiter.redis.service", () => ({
  endpointRateLimiter: () => (req, res, next) => next(),
}));
jest.mock("../../middlewares/enforceQuota.middleware", () => ({
  enforceStorageQuota: () => (req, res, next) => next(),
}));
jest.mock("../../utils/upload.util", () => ({
  upload: () => (req, res, next) => next(),
  deleteUpload: jest.fn(),
}));
jest.mock("../../services/redis.service", () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  delPattern: jest.fn().mockResolvedValue(undefined),
  cacheKeys: {
    tenant: (id) => `tenant:${id}`,
    tenantByCode: (code) => `tenant:code:${code}`,
  },
}));
jest.mock("../../services/audit.service", () => ({
  logAction: jest.fn().mockResolvedValue({}),
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { createTwoTenants } = require("../fixtures/twoTenants");
const RolesService = require("../../services/roles.service");
const auditService = require("../../services/audit.service");
const { ROLE_NAMES } = require("../../constants");
const router = require("../../routes/api/tenant.route");

// Express's own router.handle with a minimal req/res pair (the harness of
// workflows.access.a58.test.js — supertest is not a dependency here).
const http = (method, url, body = {}) =>
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
        this.headersSent = true;
        resolve({ status: this.statusCode, body: null });
        return this;
      },
    };
    const req = {
      method: method.toUpperCase(),
      url,
      originalUrl: "/api/v1/tenants" + url,
      body,
      query: {},
      params: {},
      headers: {},
      ip: "127.0.0.1",
      get: () => undefined,
    };
    router.handle(req, res, (err) =>
      resolve({
        status: err ? err.status || 500 : 404,
        body: { message: err ? err.message : "no route" },
      }),
    );
  });

// The seeded grants that matter here (seedMenuGroups.util.js): the admin
// roles hold `management`; USER holds none. The matrix is keyed by menu name
// AND slug, as RolesService.getRolePermissionsMatrix builds it.
const MATRIX = {
  [ROLE_NAMES.HEALTCARE_ADMIN]: { Management: ["write"], management: ["write"] },
  [ROLE_NAMES.CALIBRATOR_ADMIN]: { Management: ["write"], management: ["write"] },
  [ROLE_NAMES.USER]: { Home: ["read"], home: ["read"], Account: ["read"], account: ["read"] },
};

let fx;

beforeEach(() => {
  jest.clearAllMocks();
  fx = createTwoTenants();
  mockFx.current = fx;
  currentUser = null;
  const byRoleId = new Map();
  for (const role of Object.keys(MATRIX)) {
    byRoleId.set(fx.principal(fx.tenantA, role).role.id, MATRIX[role]);
    byRoleId.set(fx.principal(fx.tenantB, role).role.id, MATRIX[role]);
  }
  RolesService.getRolePermissionsMatrix.mockImplementation(
    async (roleId) => byRoleId.get(roleId) || {},
  );
});

describe("A-63 — PATCH /tenants/edit cannot reach another tenant", () => {
  it("a user of tenant A sending tenant B's id with their own userId gets 404, and tenant B is unchanged", async () => {
    const attacker = fx.principal(fx.tenantA, ROLE_NAMES.USER);
    currentUser = attacker;
    const before = fx.snapshot(fx.tenantB);

    const res = await http("patch", "/edit", {
      userId: attacker.id,
      tenantId: fx.tenantB.id,
      status: "suspended",
      maxUsers: 1,
      name: "Pwned",
    });

    expect(res.status).toBe(404);
    expect(fx.snapshot(fx.tenantB)).toEqual(before);
    expect(auditService.logAction).not.toHaveBeenCalled();
  });

  it("a tenant admin of A sending tenant B's id gets 404 — the same body as a tenant that does not exist — and B is unchanged", async () => {
    currentUser = fx.principal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);
    const before = fx.snapshot(fx.tenantB);

    const foreign = await http("patch", "/edit", {
      tenantId: fx.tenantB.id,
      name: "Renamed by A",
    });
    const missing = await http("patch", "/edit", {
      tenantId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      name: "Renamed by A",
    });

    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
    expect(fx.snapshot(fx.tenantB)).toEqual(before);
  });

  it("the service refuses another tenant even when the gate never saw the tenantId (multipart bodies are parsed after the gate)", async () => {
    // A multipart body is parsed by upload() — AFTER dynamicAccess — so its
    // checkTenant sees no tenantId. Model that: the gate sees an empty body,
    // the controller the parsed one.
    currentUser = fx.principal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);
    const before = fx.snapshot(fx.tenantB);
    const parsed = { tenantId: fx.tenantB.id, name: "Via multipart" };
    const layer = router.stack.find(
      (l) => l.route && l.route.path === "/edit" && l.route.methods.patch,
    );
    // upload() is the layer just before the controller.
    const uploadLayer = layer.route.stack[layer.route.stack.length - 2];
    const originalUpload = uploadLayer.handle;
    uploadLayer.handle = (req, res, next) => {
      Object.assign(req.body, parsed);
      next();
    };
    try {
      const res = await http("patch", "/edit", {});
      expect(res.status).toBe(404);
    } finally {
      uploadLayer.handle = originalUpload;
    }
    expect(fx.snapshot(fx.tenantB)).toEqual(before);
  });

  it("an ordinary user cannot change their own tenant's status or maxUsers", async () => {
    const user = fx.principal(fx.tenantA, ROLE_NAMES.USER);
    currentUser = user;
    const before = fx.snapshot(fx.tenantA);

    for (const body of [
      { userId: user.id, tenantId: fx.tenantA.id, status: "suspended" },
      { userId: user.id, tenantId: fx.tenantA.id, maxUsers: 500 },
    ]) {
      const res = await http("patch", "/edit", body);
      expect(res.status).toBe(403);
    }
    expect(fx.snapshot(fx.tenantA)).toEqual(before);
  });

  it("a tenant admin cannot change their own tenant's status or maxUsers either (403), and nothing is written", async () => {
    currentUser = fx.principal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);
    const before = fx.snapshot(fx.tenantA);

    const status = await http("patch", "/edit", { tenantId: fx.tenantA.id, status: "suspended" });
    const seats = await http("patch", "/edit", { tenantId: fx.tenantA.id, maxUsers: 500 });

    expect(status.status).toBe(403);
    expect(status.body.message).toMatch(/status/);
    expect(seats.status).toBe(403);
    expect(seats.body.message).toMatch(/maxUsers/);
    expect(fx.snapshot(fx.tenantA)).toEqual(before);
    expect(auditService.logAction).not.toHaveBeenCalled();
  });

  it("a tenant admin can update their own tenant's profile fields, resubmitting the unchanged status and maxUsers, and the change is audited in the transaction", async () => {
    const admin = fx.principal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);
    currentUser = admin;

    const res = await http("patch", "/edit", {
      tenantId: fx.tenantA.id,
      name: "Hospital A (North)",
      status: "active",
      maxUsers: fx.tenantA.maxUsers,
    });

    expect(res.status).toBe(200);
    expect(fx.tenantA.name).toBe("Hospital A (North)");
    expect(fx.tenantA.status).toBe("ACTIVE");
    expect(auditService.logAction).toHaveBeenCalledTimes(1);
    const [row, options] = auditService.logAction.mock.calls[0];
    expect(row).toMatchObject({
      tenantId: fx.tenantA.id,
      userId: admin.id,
      action: "UPDATE",
      resourceType: "Tenant",
      resourceId: fx.tenantA.id,
      changes: { name: { before: "Hospital A", after: "Hospital A (North)" } },
    });
    expect(options.transaction).toBeDefined();
  });

  it("a super admin can change another tenant's status and maxUsers", async () => {
    currentUser = fx.superAdmin;

    const res = await http("patch", "/edit", {
      tenantId: fx.tenantB.id,
      status: "suspended",
      maxUsers: 50,
    });

    expect(res.status).toBe(200);
    expect(fx.tenantB.status).toBe("SUSPENDED");
    expect(fx.tenantB.maxUsers).toBe(50);
  });

  it("the route no longer carries a self bypass: an ordinary user naming themselves is refused by the gate (403)", async () => {
    const user = fx.principal(fx.tenantA, ROLE_NAMES.USER);
    currentUser = user;
    const before = fx.snapshot(fx.tenantA);

    const res = await http("patch", "/edit", {
      userId: user.id,
      tenantId: fx.tenantA.id,
      name: "Renamed by a user",
    });

    expect(res.status).toBe(403);
    expect(fx.snapshot(fx.tenantA)).toEqual(before);
  });
});

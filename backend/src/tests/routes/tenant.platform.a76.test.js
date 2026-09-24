/**
 * A-76 — tenant administrators held platform operations.
 *
 * `POST /tenants/create`, `GET /tenants/all` and `DELETE /tenants/delete` were
 * gated on `dynamicAccess("Management", …)`. The seed gives `management` WRITE
 * to HEALTHCARE ADMIN and CALIBRATOR ADMIN, and READ to ENGINEERING MANAGER;
 * the `tenants` table is not tenant-scoped. So a hospital's own admin could
 * create tenants, anyone with Management read could list every hospital on the
 * platform, and a tenant admin could delete their own tenant (checkTenant only
 * checks that the target is the caller's own).
 *
 * These are platform operations. They are now `superAdminOnly`, like
 * `PATCH /admin/tenants/:id/status` already was.
 *
 * The permission matrix here is NOT hand-written. It is what the REAL seed
 * (migrationService.seedMenuGroupsAndItems over ROLE_MENU_ASSIGNMENTS and
 * seedMenuGroups' menuData) writes, read back through the REAL
 * RolesService.getRolePermissionsMatrix, and enforced by the REAL
 * dynamicAccess — see fixtures/seededAuthorization.js. Only `auth` (to set the
 * principal), the rate limiter, the storage quota, the upload middleware,
 * redis and the audit insert are stubbed.
 */

const mockFx = { current: null };
const mockSeed = { current: null };
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

jest.mock("../../models", () => {
  const users = {
    findByPk: (...args) => mockFx.current.Users.findByPk(...args),
    findAll: jest.fn(async () => []),
    count: jest.fn(async () => 0),
  };
  const roles = {
    findOne: (...args) => mockSeed.current.Roles.findOne(...args),
    findByPk: (...args) => mockSeed.current.Roles.findByPk(...args),
  };
  return {
    Tenants: {
      findByPk: (...args) => mockFx.current.Tenants.findByPk(...args),
      findOne: (...args) => mockFx.current.Tenants.findOne(...args),
      findAll: jest.fn(async () => [mockFx.current.tenantA, mockFx.current.tenantB]),
      count: jest.fn(async () => 2),
      create: jest.fn(async (values) => ({ id: "ffffffff-ffff-4fff-8fff-ffffffffffff", ...values })),
    },
    User: users,
    Users: users,
    TenantSettings: {},
    Role: roles,
    Roles: roles,
    MenuGroup: {
      findAll: (...args) => mockSeed.current.MenuGroup.findAll(...args),
      findOne: (...args) => mockSeed.current.MenuGroup.findOne(...args),
      create: (...args) => mockSeed.current.MenuGroup.create(...args),
    },
    RoleMenuPermission: {
      findAll: (...args) => mockSeed.current.RoleMenuPermission.findAll(...args),
      findOne: (...args) => mockSeed.current.RoleMenuPermission.findOne(...args),
      create: (...args) => mockSeed.current.RoleMenuPermission.create(...args),
      destroy: (...args) => mockSeed.current.RoleMenuPermission.destroy(...args),
    },
  };
});

jest.mock("../../config", () => ({
  db: {
    transaction: (...args) => mockFx.current.transaction(...args),
    sequelize: { fn: () => ({}) },
  },
}));

// Pulled in by migration.service (the real seed); not exercised here.
jest.mock("../../services/featureFlag.service", () => ({}));
jest.mock("../../utils/password.util", () => ({ hashPassword: jest.fn() }));

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
    permissions: (id) => `permissions:${id}`,
  },
}));
jest.mock("../../services/audit.service", () => ({
  logAction: jest.fn().mockResolvedValue({}),
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { createTwoTenants } = require("../fixtures/twoTenants");
const { createSeededAuthorization } = require("../fixtures/seededAuthorization");
const { ROLE_NAMES } = require("../../constants");
const { Tenants } = require("../../models");
const router = require("../../routes/api/tenant.route");

// Express's own router.handle with a minimal req/res pair (the harness of
// tenant.edit.a63.test.js), with a query string.
const http = (method, url, { body = {}, query = {} } = {}) =>
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
    const search = new URLSearchParams(query).toString();
    const req = {
      method: method.toUpperCase(),
      url: search ? `${url}?${search}` : url,
      originalUrl: "/api/v1/tenants" + url,
      body,
      query,
      params: {},
      headers: {},
      ip: "127.0.0.1",
      get: () => undefined,
    };
    router.handle(req, res, (err) =>
      resolve({
        status: err ? err.status || err.statusCode || 500 : 404,
        body: { message: err ? err.message : "no route" },
      }),
    );
  });

/** A principal whose role id is the SEEDED id for its role name. */
const seededPrincipal = (tenant, role) => {
  const p = fx.principal(tenant, role);
  p.role.id = mockSeed.current.roleId(p.role.name);
  return p;
};

let fx;

beforeEach(async () => {
  jest.clearAllMocks();
  fx = createTwoTenants();
  fx.tenantA.destroy = jest.fn(async () => undefined);
  fx.tenantB.destroy = jest.fn(async () => undefined);
  mockFx.current = fx;
  mockSeed.current = createSeededAuthorization();
  await mockSeed.current.seed();
  currentUser = null;
});

const TENANT_ADMINS = [ROLE_NAMES.HEALTCARE_ADMIN, ROLE_NAMES.CALIBRATOR_ADMIN];

describe("A-76 — the premise, from the real seed", () => {
  it.each(TENANT_ADMINS)(
    "the seed grants %s `management` — so a Management gate alone admits them",
    (role) => {
      expect(mockSeed.current.grantedSlugs(role)).toContain("management");
    },
  );

  it("the seed grants ENGINEERING MANAGER `management` (read)", () => {
    expect(mockSeed.current.grantedSlugs(ROLE_NAMES.ENGINEERING_MANAGER)).toContain(
      "management",
    );
  });
});

describe("A-76 — a tenant admin gets 403 on create, list-all and delete", () => {
  it.each(TENANT_ADMINS)("%s: POST /tenants/create is 403 and creates nothing", async (role) => {
    currentUser = seededPrincipal(fx.tenantA, role);

    const res = await http("post", "/create", {
      body: { name: "Rogue Hospital", code: "ROGUE" },
    });

    expect(res.status).toBe(403);
    expect(Tenants.create).not.toHaveBeenCalled();
  });

  it.each(TENANT_ADMINS)("%s: GET /tenants/all is 403 and lists nothing", async (role) => {
    currentUser = seededPrincipal(fx.tenantA, role);

    const res = await http("get", "/all");

    expect(res.status).toBe(403);
    expect(res.body.data ?? null).toBeNull();
    expect(Tenants.findAll).not.toHaveBeenCalled();
  });

  it.each(TENANT_ADMINS)(
    "%s: DELETE /tenants/delete of their OWN tenant is 403 and deletes nothing",
    async (role) => {
      currentUser = seededPrincipal(fx.tenantA, role);

      const res = await http("delete", "/delete", { query: { tenantId: fx.tenantA.id } });

      expect(res.status).toBe(403);
      expect(fx.tenantA.destroy).not.toHaveBeenCalled();
    },
  );

  it("ENGINEERING MANAGER (Management read): GET /tenants/all is 403", async () => {
    currentUser = seededPrincipal(fx.tenantA, ROLE_NAMES.ENGINEERING_MANAGER);

    const res = await http("get", "/all");

    expect(res.status).toBe(403);
    expect(Tenants.findAll).not.toHaveBeenCalled();
  });
});

describe("A-76 — what a tenant admin keeps, and what the super admin keeps", () => {
  it("a tenant admin can still read their own tenant's detail", async () => {
    currentUser = seededPrincipal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);

    const res = await http("post", "/detail", { body: { tenantId: fx.tenantA.id } });

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(fx.tenantA.id);
  });

  it("a tenant admin can still edit their own tenant", async () => {
    currentUser = seededPrincipal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);

    const res = await http("patch", "/edit", {
      body: { tenantId: fx.tenantA.id, name: "Hospital A Renamed" },
    });

    expect(res.status).toBe(200);
    expect(fx.tenantA.name).toBe("Hospital A Renamed");
  });

  it("the super admin lists every tenant", async () => {
    currentUser = fx.superAdmin;

    const res = await http("get", "/all");

    expect(res.status).toBe(200);
    expect(res.body.data.map((t) => t.id)).toEqual([fx.tenantA.id, fx.tenantB.id]);
  });

  it("the super admin creates a tenant", async () => {
    currentUser = fx.superAdmin;

    const res = await http("post", "/create", { body: { name: "New Hospital", code: "NEW-H" } });

    expect(res.status).toBe(201);
    expect(Tenants.create).toHaveBeenCalledTimes(1);
  });

  it("the super admin deletes a tenant", async () => {
    currentUser = fx.superAdmin;

    const res = await http("delete", "/delete", { query: { tenantId: fx.tenantB.id } });

    expect(res.status).toBe(200);
    expect(fx.tenantB.destroy).toHaveBeenCalledTimes(1);
  });
});

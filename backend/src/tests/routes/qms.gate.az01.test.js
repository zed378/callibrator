/**
 * AZ-01 / G-03 — the QMS read paths, proven against the real seeded grants.
 *
 * The authorization matrix (TASKS/AUDIT-2026-09-AUTHZ-MATRIX.md, G-03) found
 * `GET /qms/nc` and `GET /qms/capa` on `auth` alone while their writes were
 * gated (A-28): any role could read the tenant's non-conformances and CAPA
 * records — ISO 13485 evidence. Both now carry `dynamicAccess("qms", "read")`.
 *
 * Until this file the only test of those gates was `routeGuards.a66.test.js`,
 * which MOCKS dynamicAccess and so proves the chain's shape, not who gets in
 * (the V-08 shape). Here `auth` is the only stub: `dynamicAccess` is the real
 * middleware and the matrix is the REAL seed read back through the REAL
 * getRolePermissionsMatrix (fixtures/seededAuthorization). The allowed roles
 * are written out by hand from ROLE_MENU_ASSIGNMENTS — they are the claim:
 *
 *   qms: write  SUPERADMIN, HEALTHCARE ADMIN, CALIBRATOR ADMIN
 *   qms: read   ENGINEERING MANAGER
 *   (none)      every other seeded role
 *
 * Restoring `router.get("/nc", getNCs)` fails the "refused" cases below.
 */

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
  const roles = {
    findOne: (...args) => mockSeed.current.Roles.findOne(...args),
    findByPk: (...args) => mockSeed.current.Roles.findByPk(...args),
  };
  return {
    Tenants: { findByPk: jest.fn() },
    User: { findByPk: jest.fn() },
    Users: { findByPk: jest.fn() },
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

// Pulled in by migration.service (the real seed); not exercised here.
jest.mock("../../services/featureFlag.service", () => ({}));
jest.mock("../../utils/password.util", () => ({ hashPassword: jest.fn() }));
jest.mock("../../services/userPermission.service", () => ({
  getUserOverrideMatrix: jest.fn().mockResolvedValue({}),
}));
jest.mock("../../services/redis.service", () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  delPattern: jest.fn().mockResolvedValue(undefined),
  cacheKeys: { permissions: (id) => `permissions:${id}` },
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// Body validation runs AFTER the gate and is not what is under test.
jest.mock("../../middlewares/validation.middleware", () => ({
  validate: () => (req, res, next) => next(),
}));

const reached = (name) =>
  jest.fn((req, res) => res.status(200).json({ success: true, handler: name }));
jest.mock("../../controllers/qms.controller", () => ({
  createNC: reached("createNC"),
  getNCs: reached("getNCs"),
  updateNC: reached("updateNC"),
  createCapa: reached("createCapa"),
  getCapas: reached("getCapas"),
  updateCapa: reached("updateCapa"),
}));

const { createTwoTenants } = require("../fixtures/twoTenants");
const { createSeededAuthorization } = require("../fixtures/seededAuthorization");
const { ROLE_NAMES, ROLE_IDS } = require("../../constants/roleConstants");
const qmsController = require("../../controllers/qms.controller");
const router = require("../../routes/api/qms.route");

const http = (method, url) =>
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
      originalUrl: "/api/v1/qms" + url,
      body: {},
      query: {},
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

const R = ROLE_NAMES;
// Hand-written from ROLE_MENU_ASSIGNMENTS. The claim under test.
const QMS_READ = [R.HEALTCARE_ADMIN, R.CALIBRATOR_ADMIN, R.ENGINEERING_MANAGER];
const QMS_WRITE = [R.HEALTCARE_ADMIN, R.CALIBRATOR_ADMIN];
const TENANT_ROLES = Object.keys(ROLE_IDS)
  .filter((key) => key !== "SUPER_ADMIN")
  .map((key) => ROLE_NAMES[key]);

const ID = "0a000000-0000-4000-8000-0000000000a1";
const READS = [
  ["get", "/nc", "getNCs"],
  ["get", "/capa", "getCapas"],
];
const WRITES = [
  ["post", "/nc", "createNC"],
  ["patch", `/nc/${ID}`, "updateNC"],
  ["post", "/capa", "createCapa"],
  ["patch", `/capa/${ID}`, "updateCapa"],
];

let fx;

beforeEach(async () => {
  jest.clearAllMocks();
  fx = createTwoTenants();
  mockSeed.current = createSeededAuthorization();
  await mockSeed.current.seed();
  currentUser = null;
});

const seededPrincipal = (role) => {
  const p = fx.principal(fx.tenantA, role);
  p.role.id = mockSeed.current.roleId(p.role.name);
  return p;
};

describe("AZ-01 / G-03 — QMS reads need `qms: read`", () => {
  it("the fixture is the seed: the hand-written lists cover every seeded tenant role", () => {
    // Guards the claim lists — a role missing from TENANT_ROLES would never be asserted.
    expect(TENANT_ROLES.length).toBeGreaterThanOrEqual(9);
    for (const role of [...QMS_READ, ...QMS_WRITE]) {
      expect(TENANT_ROLES).toContain(role);
    }
  });

  describe.each(READS)("%s %s", (method, url, handler) => {
    it.each(TENANT_ROLES)("%s", async (role) => {
      currentUser = seededPrincipal(role);

      const res = await http(method, url);

      if (QMS_READ.includes(role)) {
        expect(res.status).toBe(200);
        expect(qmsController[handler]).toHaveBeenCalledTimes(1);
      } else {
        expect(res.status).toBe(403);
        expect(qmsController[handler]).not.toHaveBeenCalled();
      }
    });

    it("the super admin keeps it", async () => {
      currentUser = fx.superAdmin;

      const res = await http(method, url);

      expect(res.status).toBe(200);
    });
  });
});

describe("AZ-01 / G-03 — QMS writes need `qms: write`", () => {
  describe.each(WRITES)("%s %s", (method, url, handler) => {
    it.each(TENANT_ROLES)("%s", async (role) => {
      currentUser = seededPrincipal(role);

      const res = await http(method, url);

      if (QMS_WRITE.includes(role)) {
        expect(res.status).toBe(200);
        expect(qmsController[handler]).toHaveBeenCalledTimes(1);
      } else {
        expect(res.status).toBe(403);
        expect(qmsController[handler]).not.toHaveBeenCalled();
      }
    });
  });
});

describe("AZ-01 / G-03 — API keys", () => {
  const key = (scopes) => ({
    ...fx.principal(fx.tenantA, ROLE_NAMES.USER),
    isApiKey: true,
    apiKeyScopes: scopes,
  });

  it("a key scoped `qms:read` reads non-conformances and CAPA", async () => {
    currentUser = key(["qms:read"]);

    for (const [method, url, handler] of READS) {
      const res = await http(method, url);
      expect(res.status).toBe(200);
      expect(qmsController[handler]).toHaveBeenCalledTimes(1);
    }
  });

  it("a key with no `qms` scope is refused the reads", async () => {
    currentUser = key(["equipment:read"]);

    for (const [method, url, handler] of READS) {
      const res = await http(method, url);
      expect(res.status).toBe(403);
      expect(qmsController[handler]).not.toHaveBeenCalled();
    }
  });

  it("every write refuses an API key outright (denyApiKey), whatever its scopes", async () => {
    currentUser = key(["qms:*"]);

    for (const [method, url, handler] of WRITES) {
      const res = await http(method, url);
      expect(res.status).toBe(403);
      expect(qmsController[handler]).not.toHaveBeenCalled();
    }
  });
});

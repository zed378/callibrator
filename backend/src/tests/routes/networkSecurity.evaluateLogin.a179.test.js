/**
 * A-179 (b) — POST /network-security/evaluate-login had no permission gate.
 *
 * Not a login-time call: no sign-in path calls evaluateLoginSecurity, and the
 * route sits behind `auth`, so a principal that has not signed in cannot reach
 * it. It is the network-security screen's dry run ("would this IP / location
 * be allowed?"). Its answer — the IP verdict, the distance to the geofence
 * centre and the radius — is the policy the two A-155-gated reads return, and
 * a handful of calls triangulate the geofence centre. Every role could ask.
 *
 * It now takes the same gate as those reads: `network-security: read`, with
 * `checkTenant`. The matrix is the REAL seed read back through the REAL
 * permission-matrix service and enforced by the REAL dynamicAccess
 * (fixtures/seededAuthorization, as in readGates.a155.test.js). The allowed
 * roles are written out by hand from seedMenuGroups.util.js: they are the claim.
 */

const mockSeed = { current: null };
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

jest.mock("../../models", () => {
  const roles = {
    findOne: (...args) => mockSeed.current.Roles.findOne(...args),
    findByPk: (...args) => mockSeed.current.Roles.findByPk(...args),
  };
  return {
    Tenants: { findByPk: (...args) => mockFx.current.Tenants.findByPk(...args) },
    User: { findByPk: (...args) => mockFx.current.Users.findByPk(...args) },
    Users: { findByPk: (...args) => mockFx.current.Users.findByPk(...args) },
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

jest.mock("../../services/networkSecurity.service", () => ({
  evaluateLoginSecurity: jest.fn(async () => ({
    allowed: false,
    ip: { allowed: true },
    geofence: { allowed: false, distanceKm: 12.5, radiusKm: 5 },
    requiresStepUp: true,
  })),
}));
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

const { createTwoTenants } = require("../fixtures/twoTenants");
const { createSeededAuthorization } = require("../fixtures/seededAuthorization");
const { ROLE_NAMES, ROLE_IDS } = require("../../constants/roleConstants");
const networkSecurityService = require("../../services/networkSecurity.service");
const router = require("../../routes/api/networkSecurity.route");

const BODY = { ip: "203.0.113.9", latitude: -6.2, longitude: 106.8 };

const post = (body = BODY, query = {}) =>
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
      send(payload) {
        return this.json(payload);
      },
      setHeader() {
        return this;
      },
    };
    const req = {
      method: "POST",
      url: "/evaluate-login",
      originalUrl: "/evaluate-login",
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

// Hand-written claim (seedMenuGroups.util.js): the tenant roles seeded with
// `network-security`.
const NETWORK_SECURITY = [ROLE_NAMES.HEALTCARE_ADMIN];
const TENANT_ROLES = Object.keys(ROLE_IDS)
  .filter((key) => key !== "SUPER_ADMIN")
  .map((key) => ROLE_NAMES[key]);
const NO_SUCH_TENANT = "99999999-9999-4999-8999-999999999999";

let fx;

beforeEach(async () => {
  jest.clearAllMocks();
  fx = createTwoTenants();
  mockFx.current = fx;
  mockSeed.current = createSeededAuthorization();
  await mockSeed.current.seed();
  currentUser = null;
});

const seededPrincipal = (tenant, role) => {
  const p = fx.principal(tenant, role);
  p.role.id = mockSeed.current.roleId(p.role.name);
  return p;
};

describe("A-179 — POST /network-security/evaluate-login needs network-security: read", () => {
  it("the route carries a permission gate (it was auth alone)", () => {
    const layer = router.stack.find((l) => l.route && l.route.path === "/evaluate-login");
    // auth is router-level; the route's own stack is the gate + the handler.
    expect(layer.route.stack.length).toBe(2);
  });

  it.each(TENANT_ROLES)("in its own tenant: %s", async (role) => {
    currentUser = seededPrincipal(fx.tenantA, role);

    const res = await post();

    if (NETWORK_SECURITY.includes(role)) {
      expect(res.status).toBe(200);
      expect(networkSecurityService.evaluateLoginSecurity).toHaveBeenCalledWith(
        fx.tenantA.id,
        BODY.ip,
        BODY.latitude,
        BODY.longitude,
      );
    } else {
      expect(res.status).toBe(403);
      expect(networkSecurityService.evaluateLoginSecurity).not.toHaveBeenCalled();
    }
  });

  it("naming another tenant's id is 404, like one that does not exist — the policy is never evaluated", async () => {
    currentUser = seededPrincipal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);

    const foreign = await post({ ...BODY, tenantId: fx.tenantB.id });
    const missing = await post({ ...BODY, tenantId: NO_SUCH_TENANT });

    expect(foreign.status).toBe(404);
    expect(foreign).toEqual(missing);
    expect(networkSecurityService.evaluateLoginSecurity).not.toHaveBeenCalled();
  });
});

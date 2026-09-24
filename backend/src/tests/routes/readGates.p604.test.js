/**
 * P6-04 / AZ-01 — the routes the whole-tree guard found on `auth` alone, now
 * gated. Proven through the REAL dynamicAccess over the REAL seeded matrix
 * (fixtures/seededAuthorization), with the real routers and controllers; the
 * allowed roles below are written out by hand from seedMenuGroups.util.js and
 * ROLE_MENU_ASSIGNMENTS — they are the claim.
 *
 *   GET  /reports/*                          reports: read         (G-02)
 *   GET  /supplier-scorecard, /:id           supplier-scorecard: read  (G-03)
 *   POST/PUT/DELETE /supplier-scorecard      supplier-scorecard: write (G-03)
 *   GET  /jobs, /jobs/:id                    batch-jobs: read      (G-05)
 *   POST /jobs/test                          batch-jobs: write     (G-05)
 *   GET  /feature-flags/definitions          feature-flags: read
 *   GET  /oidc/clients                       oidc: read            (G-01)
 *   POST /users/username-check               users: create
 *   GET  /menu-groups/menu-groups, POST /filter, /get-assignments — own role only (G-06)
 *   POST /notifications/test {scope:"tenant"} notifications: write (A-251)
 *
 * And, for the two `:id` routes touched: another tenant's id is 404, identical
 * to an id that does not exist (CLAUDE.md, two-tenant rule).
 */

const mockSeed = { current: null };
const mockFx = { current: null };
const mockRows = { scorecards: [], jobs: [] };
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
  const byIdAndTenant = (rows) => ({
    findOne: async ({ where }) =>
      rows().find((r) => r.id === where.id && r.tenantId === where.tenantId) || null,
    findAndCountAll: async ({ where }) => {
      const found = rows().filter((r) => r.tenantId === where.tenantId);
      return { count: found.length, rows: found };
    },
  });
  return {
    Tenants: { findByPk: (...args) => mockFx.current.Tenants.findByPk(...args) },
    User: { findByPk: (...args) => mockFx.current.Users.findByPk(...args) },
    Users: { findByPk: (...args) => mockFx.current.Users.findByPk(...args) },
    Vendor: {},
    SupplierScorecard: byIdAndTenant(() => mockRows.scorecards),
    BatchJob: {
      ...byIdAndTenant(() => mockRows.jobs),
      create: async (values) => ({ id: "0b000000-0000-4000-8000-0000000000cc", ...values }),
    },
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

jest.mock("../../services/reporting.service", () => ({
  getSummary: jest.fn(async () => ({ devices: 1 })),
  getCompliance: jest.fn(async () => ({})),
  getCalibrationWorkload: jest.fn(async () => ({})),
  getOverdueDevices: jest.fn(async () => []),
  getInventory: jest.fn(async () => ({})),
}));
jest.mock("../../services/featureFlag.service", () => ({ DEFAULT_FLAGS: { enable_iot: false } }));
jest.mock("../../services/oidcProvider.service", () => ({ getClients: jest.fn(async () => []) }));
jest.mock("../../services/notification.service", () => ({
  emitNotification: jest.fn(async (n) => n),
}));
jest.mock("../../services/menuGroup.service", () => ({
  listMenuGroups: jest.fn(async () => []),
  getRoleMenuAssignments: jest.fn(async () => []),
}));
jest.mock("../../services/user.service", () => ({
  checkUsernameAvailability: jest.fn(async () => ({ data: { available: true }, message: "ok" })),
}));
jest.mock("../../services/rabbitmq.service", () => ({
  assertQueue: jest.fn(async () => undefined),
  publish: jest.fn(async () => true),
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
const notificationService = require("../../services/notification.service");
const menuGroupService = require("../../services/menuGroup.service");

const routers = {
  reports: require("../../routes/api/reports.route"),
  scorecard: require("../../routes/api/supplierScorecard.route"),
  jobs: require("../../routes/api/batchJobs.route"),
  flags: require("../../routes/api/featureFlags.route"),
  oidc: require("../../routes/api/oidc.route"),
  users: require("../../routes/api/user.route"),
  menus: require("../../routes/api/menuGroups.route"),
  notifications: require("../../routes/api/notifications.route"),
};

const http = (router, method, url, { query = {}, body = {} } = {}) =>
  new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headers: {},
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
      set() {
        return this;
      },
    };
    const req = {
      method,
      url,
      originalUrl: url,
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

const R = ROLE_NAMES;
const TENANT_ROLES = Object.keys(ROLE_IDS)
  .filter((key) => key !== "SUPER_ADMIN")
  .map((key) => ROLE_NAMES[key]);
const EVERY_TENANT_ROLE = TENANT_ROLES;

// Hand-written from the seed (ROLE_MENU_ASSIGNMENTS). The claim under test.
const SCORECARD_READ = [R.HEALTCARE_ADMIN, R.CALIBRATOR_ADMIN, R.ENGINEERING_MANAGER];
const SCORECARD_WRITE = [R.HEALTCARE_ADMIN];
const JOBS_READ = [R.HEALTCARE_ADMIN, R.CALIBRATOR_ADMIN];
const FLAGS_READ = [R.HEALTCARE_ADMIN, R.CALIBRATOR_ADMIN];
const OIDC_READ = [R.HEALTCARE_ADMIN];
const NOTIFY_WRITE = [R.HEALTCARE_ADMIN, R.CALIBRATOR_ADMIN];

let fx;

beforeEach(async () => {
  jest.clearAllMocks();
  fx = createTwoTenants();
  mockFx.current = fx;
  mockSeed.current = createSeededAuthorization();
  await mockSeed.current.seed();
  currentUser = null;
  const row = (id, tenantId) => ({
    id,
    tenantId,
    async update(values) {
      Object.assign(this, values);
      return this;
    },
    async destroy() {},
  });
  mockRows.scorecards = [
    row("5c000000-0000-4000-8000-00000000000a", fx.tenantA.id),
    row("5c000000-0000-4000-8000-00000000000b", fx.tenantB.id),
  ];
  mockRows.jobs = [
    row("0b000000-0000-4000-8000-00000000000a", fx.tenantA.id),
    row("0b000000-0000-4000-8000-00000000000b", fx.tenantB.id),
  ];
});

const seededPrincipal = (tenant, role) => {
  const p = fx.principal(tenant, role);
  p.role.id = mockSeed.current.roleId(p.role.name);
  p.roleId = p.role.id;
  return p;
};

const CASES = {
  "GET /reports/summary": { call: () => http(routers.reports, "GET", "/summary"), allowed: EVERY_TENANT_ROLE },
  "GET /reports/compliance": { call: () => http(routers.reports, "GET", "/compliance"), allowed: EVERY_TENANT_ROLE },
  "GET /reports/inventory": { call: () => http(routers.reports, "GET", "/inventory"), allowed: EVERY_TENANT_ROLE },
  "GET /supplier-scorecard": { call: () => http(routers.scorecard, "GET", "/"), allowed: SCORECARD_READ },
  "GET /supplier-scorecard/:id": {
    call: () => http(routers.scorecard, "GET", `/${mockRows.scorecards[0].id}`),
    allowed: SCORECARD_READ,
  },
  "PUT /supplier-scorecard/:id": {
    call: () => http(routers.scorecard, "PUT", `/${mockRows.scorecards[0].id}`, { body: { score: 3 } }),
    allowed: SCORECARD_WRITE,
  },
  "DELETE /supplier-scorecard/:id": {
    call: () => http(routers.scorecard, "DELETE", `/${mockRows.scorecards[0].id}`),
    allowed: SCORECARD_WRITE,
  },
  "GET /jobs": { call: () => http(routers.jobs, "GET", "/"), allowed: JOBS_READ },
  "GET /jobs/:id": { call: () => http(routers.jobs, "GET", `/${mockRows.jobs[0].id}`), allowed: JOBS_READ },
  "POST /jobs/test": { call: () => http(routers.jobs, "POST", "/test"), allowed: [] },
  "GET /feature-flags/definitions": { call: () => http(routers.flags, "GET", "/definitions"), allowed: FLAGS_READ },
  "GET /oidc/clients": { call: () => http(routers.oidc, "GET", "/clients"), allowed: OIDC_READ },
  // The probe needs exactly what /users/create needs. Q-20 (ADR-056)
  // granted `users` write to the two admin roles by slug — before, it sat two
  // levels under `management` and no seeded tenant role reached it.
  "POST /users/username-check": {
    call: () => http(routers.users, "POST", "/username-check", { body: { username: "someone" } }),
    allowed: [R.HEALTCARE_ADMIN, R.CALIBRATOR_ADMIN],
  },
  'POST /notifications/test {scope:"tenant"}': {
    call: () => http(routers.notifications, "POST", "/test", { body: { scope: "tenant" } }),
    allowed: NOTIFY_WRITE,
  },
};

describe.each(Object.keys(CASES))("P6-04 — %s", (name) => {
  const { call, allowed } = CASES[name];

  it.each(TENANT_ROLES)("as %s", async (role) => {
    currentUser = seededPrincipal(fx.tenantA, role);

    const res = await call();

    if (allowed.includes(role)) {
      expect(res.status).toBeLessThan(300);
    } else {
      expect(res.status).toBe(403);
    }
  });

  it("SUPERADMIN passes", async () => {
    currentUser = fx.superAdmin;
    const res = await call();
    expect(res.status).toBeLessThan(300);
  });

  it("an API key without the scope is refused (403), not waved through", async () => {
    currentUser = {
      id: "api-key-1",
      isApiKey: true,
      apiKeyScopes: ["stock:read"],
      tenantId: fx.tenantA.id,
      role: { id: null, name: "API_KEY" },
    };
    const res = await call();
    expect(res.status).toBe(403);
  });
});

describe("P6-04 — two-tenant 404 on the gated :id routes", () => {
  const ADMIN = () => seededPrincipal(fx.tenantA, R.HEALTCARE_ADMIN);
  const NO_SUCH = "99999999-9999-4999-8999-999999999999";

  it.each([
    ["GET", "scorecard", () => mockRows.scorecards[1].id],
    ["PUT", "scorecard", () => mockRows.scorecards[1].id],
    ["DELETE", "scorecard", () => mockRows.scorecards[1].id],
    ["GET", "jobs", () => mockRows.jobs[1].id],
  ])("%s %s/:id — tenant B's id is 404, identical to a nonexistent id", async (method, router, foreignId) => {
    currentUser = ADMIN();
    const foreign = await http(routers[router], method, `/${foreignId()}`, { body: { score: 1 } });
    const missing = await http(routers[router], method, `/${NO_SUCH}`, { body: { score: 1 } });

    expect(foreign.status).toBe(404);
    const shown = ({ details: _details, ...rest }) => rest;
    expect(shown(foreign.body)).toEqual(shown(missing.body));
    // tenant B's row is untouched
    expect(mockRows.scorecards[1].score).toBeUndefined();
  });
});

describe("AZ-01 G-06 — the sidebar menu reads answer for the caller's own role only", () => {
  const cases = [
    ["GET /menu-groups", (roleId) => http(routers.menus, "GET", "/menu-groups", { query: roleId ? { roleId } : {} }), "listMenuGroups"],
    ["POST /filter", (roleId) => http(routers.menus, "POST", "/filter", { body: roleId ? { roleId } : {} }), "listMenuGroups"],
    ["POST /get-assignments", (roleId) => http(routers.menus, "POST", "/get-assignments", { body: { roleId } }), "getRoleMenuAssignments"],
  ];

  it.each(cases)("%s — own role: 200", async (name, call, service) => {
    currentUser = seededPrincipal(fx.tenantA, R.TECHNICIAN);
    const res = await call(currentUser.roleId);
    expect(res.status).toBe(200);
    expect(menuGroupService[service]).toHaveBeenCalledWith(currentUser.roleId);
  });

  it.each(cases)("%s — another role's id: 403, the service never runs", async (name, call, service) => {
    currentUser = seededPrincipal(fx.tenantA, R.TECHNICIAN);
    const res = await call(mockSeed.current.roleId(R.HEALTCARE_ADMIN));
    expect(res.status).toBe(403);
    expect(menuGroupService[service]).not.toHaveBeenCalled();
  });

  it.each(cases)("%s — SUPERADMIN may ask for any role", async (name, call) => {
    currentUser = fx.superAdmin;
    const res = await call(mockSeed.current.roleId(R.TECHNICIAN));
    expect(res.status).toBe(200);
  });

  it("GET /menu-groups with no roleId (the unassigned catalogue) stays open", async () => {
    currentUser = seededPrincipal(fx.tenantA, R.ROOM_USER);
    const res = await http(routers.menus, "GET", "/menu-groups");
    expect(res.status).toBe(200);
  });

  it("a principal whose role id is unknown cannot name any role", async () => {
    currentUser = { id: "u", tenantId: fx.tenantA.id, role: { name: R.USER } };
    const res = await http(routers.menus, "GET", "/menu-groups", { query: { roleId: "x" } });
    expect(res.status).toBe(403);
  });

  it("no user on the request at all is refused, not crashed", async () => {
    currentUser = undefined;
    const res = await http(routers.menus, "POST", "/filter", { body: { roleId: "x" } });
    expect(res.status).toBe(403);
  });
});

describe("A-251 — the caller-only test notification stays open to every role", () => {
  it.each(TENANT_ROLES)("as %s, scope user: 201, addressed to the caller only", async (role) => {
    currentUser = seededPrincipal(fx.tenantA, role);
    const res = await http(routers.notifications, "POST", "/test", { body: { scope: "user" } });
    expect(res.status).toBe(201);
    expect(notificationService.emitNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: currentUser.id }),
    );
  });

  it("a body-less request is the caller-only form", async () => {
    currentUser = seededPrincipal(fx.tenantA, R.ROOM_USER);
    const res = await http(routers.notifications, "POST", "/test", { body: undefined });
    expect(res.status).toBe(201);
  });
});

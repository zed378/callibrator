/**
 * A-66 — QMS had no permission gate.
 *
 * Until 2026-09-24 `qms.route.js` mounted `auth` (and `denyApiKey` on the
 * mutations) and nothing else: any authenticated user in a tenant could raise,
 * edit and approve NCs and CAPAs. Every route is now gated on the seeded `qms`
 * menu group.
 *
 * Two kinds of evidence, deliberately:
 *
 *  1. WIRING — every route layer in the real router carries a `dynamicAccess`
 *     gate, its name is a seeded menu (the vocabulary the A-58 boot assertion
 *     reads), and the boot assertion's own source scan finds no fatal gate in
 *     the file. `dynamicAccess` is wrapped only to TAG the middleware it
 *     returns with its arguments; the returned middleware is the real one.
 *
 *  2. BEHAVIOUR — the real router, the real `dynamicAccess`, the real
 *     controllers, driven off the real role/menu matrix in roleConstants (the
 *     seed's source of truth). A refusal asserts the service was never reached.
 */

// ---- principal injection -------------------------------------------------
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

// Tag each gate with what it was built from; behaviour is the real middleware.
jest.mock("../../middlewares/dynamicAccess.middleware", () => {
  const actual = jest.requireActual("../../middlewares/dynamicAccess.middleware");
  return {
    ...actual,
    dynamicAccess: (menuGroup, permissionType, options) => {
      const middleware = actual.dynamicAccess(menuGroup, permissionType, options);
      middleware.gate = { menuGroup, permissionType };
      return middleware;
    },
  };
});

jest.mock("../../services/roles.service", () => ({
  getRolePermissionsMatrix: jest.fn(),
}));
jest.mock("../../services/userPermission.service", () => ({
  getUserOverrideMatrix: jest.fn().mockResolvedValue({}),
}));
jest.mock("../../models", () => ({
  User: { findByPk: jest.fn() },
  Tenants: { findByPk: jest.fn() },
}));
jest.mock("../../services/qms.service", () => ({
  createNC: jest.fn(),
  getNCs: jest.fn(),
  updateNC: jest.fn(),
  createCapa: jest.fn(),
  getCapas: jest.fn(),
  updateCapa: jest.fn(),
}));

const fs = require("fs");
const path = require("path");
const RolesService = require("../../services/roles.service");
const qmsService = require("../../services/qms.service");
const router = require("../../routes/api/qms.route");
const { ROLE_NAMES, ROLE_MENU_ASSIGNMENTS, MENU_SLUGS } = require("../../constants");
const {
  seededMenuVocabulary,
  parseGates,
  checkRouteGates,
} = require("../../utils/authorizationWiring.util");

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
      originalUrl: "/api/v1/qms" + url,
      body,
      query: {},
      params: {},
      headers: { "user-agent": "jest-UA" },
      ip: "10.0.0.7",
      get: () => undefined,
    };
    router.handle(req, res, (err) =>
      resolve({
        status: err ? err.status || 500 : 404,
        body: { message: err ? err.message : "no route" },
      }),
    );
  });

const ID = "11111111-1111-4111-8111-111111111111";
const TENANT = "33333333-3333-4333-8333-333333333333";

const matrixFor = (roleName) => {
  const entry = ROLE_MENU_ASSIGNMENTS.find((a) => a.roleName === roleName);
  const matrix = {};
  for (const [slug, permission] of Object.entries(entry.menus)) {
    matrix[slug] = [permission];
  }
  return matrix;
};

const asRole = (roleName) => {
  currentUser = { id: ID, tenantId: TENANT, role: { id: roleName, name: roleName } };
};

const asApiKey = (scopes) => {
  currentUser = {
    id: ID,
    tenantId: TENANT,
    isApiKey: true,
    apiKeyScopes: scopes,
    role: { id: "API_KEY", name: "API_KEY" },
  };
};

const MUTATIONS = [
  ["post", "/nc", { title: "Drift", description: "d" }, "createNC"],
  ["patch", "/nc/" + ID, { status: "CLOSED" }, "updateNC"],
  ["post", "/capa", { ncId: ID, title: "t", actionPlan: "p" }, "createCapa"],
  ["patch", "/capa/" + ID, { status: "IN_PROGRESS" }, "updateCapa"],
];
const READS = [
  ["get", "/nc", {}, "getNCs"],
  ["get", "/capa", {}, "getCapas"],
];

beforeEach(() => {
  jest.clearAllMocks();
  currentUser = null;
  RolesService.getRolePermissionsMatrix.mockImplementation(async (roleId) => matrixFor(roleId));
  qmsService.createNC.mockResolvedValue({ id: ID });
  qmsService.updateNC.mockResolvedValue({ id: ID });
  qmsService.createCapa.mockResolvedValue({ id: ID });
  qmsService.updateCapa.mockResolvedValue({ id: ID });
  qmsService.getNCs.mockResolvedValue({ nonConformances: [], total: 0, page: 1, limit: 10, totalPages: 0 });
  qmsService.getCapas.mockResolvedValue({ capas: [], total: 0, page: 1, limit: 10, totalPages: 0 });
});

// =========================================================================
describe("A-66 — QMS route wiring", () => {
  const routeLayers = router.stack.filter((layer) => layer.route);

  it("every QMS route has a dynamicAccess gate whose slug is seeded", () => {
    const vocabulary = seededMenuVocabulary();
    expect(routeLayers).toHaveLength(MUTATIONS.length + READS.length);

    for (const layer of routeLayers) {
      const method = Object.keys(layer.route.methods)[0];
      const gates = layer.route.stack.map((s) => s.handle.gate).filter(Boolean);
      const where = `${method.toUpperCase()} ${layer.route.path}`;

      expect({ where, gates: gates.length }).toEqual({ where, gates: 1 });
      const [{ menuGroup, permissionType }] = gates;
      expect({ where, menuGroup }).toEqual({ where, menuGroup: MENU_SLUGS.QMS });
      expect(vocabulary.has(menuGroup)).toBe(true);
      // A read route asks for read; every mutation asks for a verb that
      // dynamicAccess normalizes to write.
      expect({ where, reads: permissionType === "read" }).toEqual({
        where,
        reads: method === "get",
      });
    }
  });

  it("the slug the gates name is granted by the seed to both tenant-admin roles (no lockout)", () => {
    const grant = (role) => matrixFor(role)[MENU_SLUGS.QMS];
    expect(grant(ROLE_NAMES.HEALTCARE_ADMIN)).toEqual(["write"]);
    expect(grant(ROLE_NAMES.CALIBRATOR_ADMIN)).toEqual(["write"]);
    expect(grant(ROLE_NAMES.ENGINEERING_MANAGER)).toEqual(["read"]);
  });

  it("the A-58 boot assertion's source scan finds a resolvable gate on every QMS route", () => {
    const file = path.join(__dirname, "..", "..", "routes", "api", "qms.route.js");
    const gates = parseGates(fs.readFileSync(file, "utf8"), "src/routes/api/qms.route.js");

    expect(gates).toHaveLength(MUTATIONS.length + READS.length);
    expect(gates.every((g) => Array.isArray(g.names) && g.names.includes("qms"))).toBe(true);
    expect(checkRouteGates(gates, seededMenuVocabulary())).toEqual({ errors: [], warnings: [] });
  });
});

// =========================================================================
describe("A-66 — QMS permission behaviour", () => {
  describe.each([ROLE_NAMES.USER, ROLE_NAMES.TECHNICIAN, ROLE_NAMES.SUPERVISOR])(
    "%s (no qms grant)",
    (role) => {
      it.each([...MUTATIONS, ...READS])(
        "a user without QMS permission gets 403 in their own tenant — %s %s",
        async (method, url, body, fn) => {
          asRole(role);

          const res = await http(method, url, body);

          expect(res.status).toBe(403);
          expect(res.body.message).toMatch(/Forbidden: Insufficient permissions/);
          expect(qmsService[fn]).not.toHaveBeenCalled();
        },
      );
    },
  );

  it.each(MUTATIONS)(
    "ENGINEERING MANAGER (read-only) is refused %s %s with 403",
    async (method, url, body, fn) => {
      asRole(ROLE_NAMES.ENGINEERING_MANAGER);

      const res = await http(method, url, body);

      expect(res.status).toBe(403);
      expect(qmsService[fn]).not.toHaveBeenCalled();
    },
  );

  it.each(READS)("ENGINEERING MANAGER can still %s %s", async (method, url, body, fn) => {
    asRole(ROLE_NAMES.ENGINEERING_MANAGER);

    const res = await http(method, url, body);

    expect(res.status).toBe(200);
    expect(qmsService[fn]).toHaveBeenCalled();
  });

  describe.each([ROLE_NAMES.HEALTCARE_ADMIN, ROLE_NAMES.CALIBRATOR_ADMIN])("%s", (role) => {
    it.each([...MUTATIONS, ...READS])("keeps access: %s %s", async (method, url, body, fn) => {
      asRole(role);

      const res = await http(method, url, body);

      expect(res.status).toBeLessThan(300);
      expect(qmsService[fn]).toHaveBeenCalled();
    });
  });

  it("a CAPA update carries the caller as the audit actor, never a body id", async () => {
    asRole(ROLE_NAMES.CALIBRATOR_ADMIN);

    await http("patch", "/capa/" + ID, { approvedBy: TENANT });

    expect(qmsService.updateCapa).toHaveBeenCalledWith(
      TENANT,
      ID,
      { approvedBy: TENANT },
      { userId: ID, tenantId: TENANT, ipAddress: "10.0.0.7", userAgent: "jest-UA" },
    );
  });

  it.each(MUTATIONS)(
    "an API key, even one scoped for qms, is refused %s %s",
    async (method, url, body, fn) => {
      asApiKey(["qms:write", "qms:read"]);

      const res = await http(method, url, body);

      expect(res.status).toBe(403);
      expect(qmsService[fn]).not.toHaveBeenCalled();
    },
  );
});

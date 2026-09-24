/**
 * A-58 — five workflow routes gated on a menu slug that does not exist.
 *
 * `workflows.route.js` gated GET /, POST /, GET /:id, PUT /:id and DELETE /:id
 * on `dynamicAccess("workflow", …)` — singular. The seeded menu group and
 * `MENU_SLUGS.WORKFLOWS` are `workflows`. A name that matches no menu group is
 * in nobody's permission matrix, so the five routes answered 403 to every role
 * except SUPERADMIN (which bypasses the matrix) while `ROLE_MENU_ASSIGNMENTS`
 * granted them to the admin roles.
 *
 * These are behaviour tests, not stack-shape tests. Only `auth` is stubbed (to
 * set the principal). `dynamicAccess` is the real middleware, and the matrix is
 * built from `ROLE_MENU_ASSIGNMENTS` exactly as the seed builds
 * `role_menu_permissions` from it, so a fixture friendlier than production
 * cannot make a test pass. Reverting any one gate to `"workflow"` fails the
 * admin tests below with 403.
 */

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

// Body validation runs AFTER the gate and is not what is under test; letting it
// through keeps a 200 unambiguous ("the gate admitted it") instead of a 400
// that could come from either side of the gate.
jest.mock("../../middlewares/validation.middleware", () => ({
  validate: () => (req, res, next) => next(),
}));

// The controller is where "reached" is observed.
const reached = (name) =>
  jest.fn((req, res) => res.status(200).json({ success: true, handler: name }));
jest.mock("../../controllers/workflow.controller", () => ({
  getWorkflows: reached("getWorkflows"),
  createWorkflow: reached("createWorkflow"),
  getWorkflowById: reached("getWorkflowById"),
  updateWorkflow: reached("updateWorkflow"),
  deleteWorkflow: reached("deleteWorkflow"),
  getPendingTasks: reached("getPendingTasks"),
  submitAction: reached("submitAction"),
}));

const RolesService = require("../../services/roles.service");
const workflowController = require("../../controllers/workflow.controller");
const { ROLE_NAMES, ROLE_MENU_ASSIGNMENTS, MENU_SLUGS } = require("../../constants");
const router = require("../../routes/api/workflows.route");

// Express's own router.handle with a minimal req/res pair — supertest is not a
// dependency of this workspace (same harness as routeGuards.a28.test.js).
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
      originalUrl: "/api/v1/workflows" + url,
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

const ID = "11111111-1111-4111-8111-111111111111";
const TENANT = "33333333-3333-4333-8333-333333333333";

const matrixFor = (roleName) => {
  const entry = ROLE_MENU_ASSIGNMENTS.find((a) => a.roleName === roleName);
  const matrix = {};
  for (const [slug, permission] of Object.entries(entry ? entry.menus : {})) {
    matrix[slug] = [permission];
  }
  return matrix;
};

const asRole = (roleName) => {
  currentUser = { id: ID, tenantId: TENANT, role: { id: roleName, name: roleName } };
};

// The five routes A-58 names, with the handler each must reach.
const GATED = [
  ["get", "/", "getWorkflows", "read"],
  ["post", "/", "createWorkflow", "write"],
  ["get", "/" + ID, "getWorkflowById", "read"],
  ["put", "/" + ID, "updateWorkflow", "write"],
  ["delete", "/" + ID, "deleteWorkflow", "write"],
];

beforeEach(() => {
  jest.clearAllMocks();
  currentUser = null;
  RolesService.getRolePermissionsMatrix.mockImplementation(async (roleId) =>
    matrixFor(roleId),
  );
});

describe("A-58 — workflow routes gate on the seeded slug", () => {
  it("the grant the admin roles hold is keyed `workflows`", () => {
    // Guards the fixture: if the grant moved to another key, the tests below
    // would be proving nothing about the slug.
    expect(MENU_SLUGS.WORKFLOWS).toBe("workflows");
    expect(matrixFor(ROLE_NAMES.HEALTCARE_ADMIN).workflows).toEqual(["write"]);
    expect(matrixFor(ROLE_NAMES.HEALTCARE_ADMIN).workflow).toBeUndefined();
  });

  describe.each([ROLE_NAMES.HEALTCARE_ADMIN, ROLE_NAMES.CALIBRATOR_ADMIN])(
    "an admin role (%s) holding `workflows: write`",
    (roleName) => {
      it.each(GATED)("reaches %s %s (%s)", async (method, url, handler) => {
        asRole(roleName);

        const res = await http(method, url, { name: "x" });

        expect(res.status).toBe(200);
        expect(res.body.handler).toBe(handler);
        expect(workflowController[handler]).toHaveBeenCalledTimes(1);
      });
    },
  );

  describe(`a read-only role (${ROLE_NAMES.ENGINEERING_MANAGER})`, () => {
    it.each(GATED)("%s %s -> %s is allowed only for read", async (method, url, handler, need) => {
      asRole(ROLE_NAMES.ENGINEERING_MANAGER);

      const res = await http(method, url, { name: "x" });

      if (need === "read") {
        expect(res.status).toBe(200);
        expect(workflowController[handler]).toHaveBeenCalledTimes(1);
      } else {
        // The gate is live, not bypassed: write is refused and never reached.
        expect(res.status).toBe(403);
        expect(workflowController[handler]).not.toHaveBeenCalled();
      }
    });
  });

  it("a role with no workflows grant is refused on every gated route", async () => {
    const without = ROLE_MENU_ASSIGNMENTS.find(
      (a) => !Object.prototype.hasOwnProperty.call(a.menus, MENU_SLUGS.WORKFLOWS),
    );
    expect(without).toBeDefined();
    asRole(without.roleName);

    for (const [method, url, handler] of GATED) {
      const res = await http(method, url, { name: "x" });
      expect(res.status).toBe(403);
      expect(workflowController[handler]).not.toHaveBeenCalled();
    }
  });
});

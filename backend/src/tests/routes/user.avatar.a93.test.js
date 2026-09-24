/**
 * A-93 / A-96 — the avatar routes through the real gate and controller.
 *
 * A-93: `dynamicAccess(..., { checkTenant: true })` ran the tenant check OR the
 * owner check. A request carrying any `tenantId` (body or query) equal to the
 * caller's own took the tenant branch, and the path `:userId` — the user the
 * route acts on — was never checked. `DELETE /users/<tenant B user>/avatar
 * ?tenantId=<tenant A>` from a tenant-A admin passed the gate and reached the
 * service, leaving the global hooks as the only isolation.
 *
 * A-96 (controller half): an upload the service refuses must not stay on disk.
 *
 * Real chain: user.route → validateUuid → dynamicAccess → user.controller.
 * Stubbed: `auth` (sets the principal), the permission matrix, the quota
 * middleware, `upload()` (it sets req.file / req.uploadFilename as multer
 * would) and userService (what the controller hands it is what is observed).
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

jest.mock("../../models", () => {
  const users = { findByPk: (...args) => mockFx.current.Users.findByPk(...args) };
  return {
    Tenants: { findByPk: (...args) => mockFx.current.Tenants.findByPk(...args) },
    User: users,
    Users: users,
  };
});

jest.mock("../../services/roles.service", () => ({
  getRolePermissionsMatrix: jest.fn(),
}));
jest.mock("../../services/userPermission.service", () => ({
  getUserOverrideMatrix: jest.fn().mockResolvedValue({}),
}));
jest.mock("../../middlewares/enforceQuota.middleware", () => ({
  enforceSeatQuota: () => (req, res, next) => next(),
  enforceStorageQuota: () => (req, res, next) => next(),
}));
jest.mock("../../utils/upload.util", () => ({
  upload: () => (req, res, next) => {
    if (req.body && req.body.__file) {
      req.file = { originalname: "me.png" };
      req.uploadFilename = "uploaded-avatar.png";
    }
    next();
  },
  deleteUpload: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../middlewares/auditLog.middleware", () => ({
  recordAudit: () => (req, res, next) => next(),
}));
jest.mock("../../services/user.service", () => ({
  updateUserAvatar: jest.fn(async (userId, filename) => ({
    status: 200,
    data: { avatar: filename },
  })),
  removeUserAvatar: jest.fn(async () => ({ status: 200, data: { avatar: "default.svg" } })),
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { createTwoTenants } = require("../fixtures/twoTenants");
const RolesService = require("../../services/roles.service");
const userService = require("../../services/user.service");
const { deleteUpload } = require("../../utils/upload.util");
const { ROLE_NAMES } = require("../../constants");
const router = require("../../routes/api/user.route");

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
      originalUrl: "/api/v1/users" + url,
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

// Seed-shaped grants: the admin roles hold `users` write; USER holds none.
const MATRIX = {
  [ROLE_NAMES.HEALTCARE_ADMIN]: { Users: ["write"], users: ["write"] },
  [ROLE_NAMES.USER]: { Home: ["read"], home: ["read"] },
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

describe("A-93 — an own tenantId does not switch the owner check off", () => {
  it.each([
    ["query", (id) => ({ query: { tenantId: id } })],
    ["body", (id) => ({ body: { tenantId: id } })],
  ])(
    "DELETE /users/<tenant B user>/avatar with the caller's tenantId in the %s is 404, byte-identical to a missing user",
    async (_where, carry) => {
      currentUser = fx.principal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);
      const victim = fx.principal(fx.tenantB, ROLE_NAMES.USER);

      const foreign = await http("delete", `/${victim.id}/avatar`, carry(fx.tenantA.id));
      const missing = await http(
        "delete",
        "/ffffffff-ffff-4fff-8fff-ffffffffffff/avatar",
        carry(fx.tenantA.id),
      );

      expect(foreign.status).toBe(404);
      expect(foreign.body).toEqual(missing.body);
      expect(userService.removeUserAvatar).not.toHaveBeenCalled();
    },
  );

  it("POST /users/<tenant B user>/avatar with ?tenantId=<own> is 404 and nothing is uploaded or stored", async () => {
    currentUser = fx.principal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);
    const victim = fx.principal(fx.tenantB, ROLE_NAMES.USER);

    const res = await http("post", `/${victim.id}/avatar`, {
      body: { __file: true },
      query: { tenantId: fx.tenantA.id },
    });

    expect(res.status).toBe(404);
    expect(userService.updateUserAvatar).not.toHaveBeenCalled();
  });

  it("the admin still manages an avatar in their own tenant with ?tenantId=<own>", async () => {
    currentUser = fx.principal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);
    const colleague = fx.principal(fx.tenantA, ROLE_NAMES.USER);

    const res = await http("delete", `/${colleague.id}/avatar`, {
      query: { tenantId: fx.tenantA.id },
    });

    expect(res.status).toBe(200);
    expect(userService.removeUserAvatar).toHaveBeenCalledWith(
      colleague.id,
      currentUser.id,
      expect.objectContaining({ actorTenantId: fx.tenantA.id, actorIsSuperAdmin: false }),
    );
  });

  it("an ordinary user removes their own avatar (self bypass, owner confirmed in-tenant)", async () => {
    const user = fx.principal(fx.tenantA, ROLE_NAMES.USER);
    currentUser = user;

    const res = await http("delete", `/${user.id}/avatar`);

    expect(res.status).toBe(200);
    expect(userService.removeUserAvatar).toHaveBeenCalledTimes(1);
  });
});

describe("A-96 — avatar upload: the controller hands over the actor and cleans up a refusal", () => {
  it("passes the authenticated actor (never a body field) to the service", async () => {
    const user = fx.principal(fx.tenantA, ROLE_NAMES.USER);
    const colleague = fx.principal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);
    currentUser = user;

    // A body userId naming someone else changes neither the gate's decision
    // (the path names the caller) nor the target (the path wins).
    const res = await http("post", `/${user.id}/avatar`, {
      body: { __file: true, userId: colleague.id },
    });

    expect(res.status).toBe(200);
    expect(userService.updateUserAvatar).toHaveBeenCalledWith(
      user.id,
      "uploaded-avatar.png",
      user.id,
      expect.objectContaining({ actorTenantId: fx.tenantA.id, ipAddress: "127.0.0.1" }),
    );
    expect(deleteUpload).not.toHaveBeenCalled();
  });

  it("deletes the uploaded file when the service refuses, and returns the service's error", async () => {
    const user = fx.principal(fx.tenantA, ROLE_NAMES.USER);
    currentUser = user;
    userService.updateUserAvatar.mockRejectedValueOnce({ status: 404, message: "User not found" });

    const res = await http("post", `/${user.id}/avatar`, { body: { __file: true } });

    expect(res.status).toBe(404);
    expect(deleteUpload).toHaveBeenCalledWith("uploaded-avatar.png", "uploads/public/profile");
  });

  it("a failed clean-up does not mask the refusal", async () => {
    const user = fx.principal(fx.tenantA, ROLE_NAMES.USER);
    currentUser = user;
    userService.updateUserAvatar.mockRejectedValueOnce({ status: 500, message: "audit failed" });
    deleteUpload.mockRejectedValueOnce(new Error("EPERM"));

    const res = await http("post", `/${user.id}/avatar`, { body: { __file: true } });

    expect(res.status).toBe(500);
    expect(deleteUpload).toHaveBeenCalledWith("uploaded-avatar.png", "uploads/public/profile");
  });

  it("no file: 400 and nothing to clean up", async () => {
    const user = fx.principal(fx.tenantA, ROLE_NAMES.USER);
    currentUser = user;

    const res = await http("post", `/${user.id}/avatar`);

    expect(res.status).toBe(400);
    expect(deleteUpload).not.toHaveBeenCalled();
    expect(userService.updateUserAvatar).not.toHaveBeenCalled();
  });
});

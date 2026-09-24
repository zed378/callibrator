/**
 * A-63 — the user routes that used `checkSelf`, after the self bypass stopped
 * reading `req.body.userId` / `req.query.userId`.
 *
 *  - PATCH /users/edit targets a BODY userId, so it no longer has a self
 *    bypass: it needs `users` update access.
 *  - PATCH /users/:userId/profile is the self-service path: the PATH names the
 *    target, the path wins over any body userId, and only username / first
 *    and last name reach the service.
 *  - Another tenant's user answers 404 on the new `:userId` route (CLAUDE.md:
 *    every new `:id` route gets a two-tenant 404 test).
 *
 * Real chain: user.route → validateUuid → dynamicAccess → user.controller.
 * Stubbed: `auth` (sets the principal), the permission matrix, the upload /
 * quota / audit middlewares, and userService (the controller's call to it is
 * what is observed). Principals come from fixtures/twoTenants.js.
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
  upload: () => (req, res, next) => next(),
  deleteUpload: jest.fn(),
}));
jest.mock("../../middlewares/auditLog.middleware", () => ({
  recordAudit: () => (req, res, next) => next(),
}));
jest.mock("../../services/user.service", () => ({
  editUser: jest.fn(async (input) => ({
    status: 200,
    data: { id: input.userId },
  })),
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { createTwoTenants } = require("../fixtures/twoTenants");
const RolesService = require("../../services/roles.service");
const userService = require("../../services/user.service");
const { ROLE_NAMES } = require("../../constants");
const router = require("../../routes/api/user.route");

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
      originalUrl: "/api/v1/users" + url,
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

describe("A-63 — PATCH /users/edit has no self bypass", () => {
  it("an ordinary user naming themselves in the body is refused (403) and nothing is edited", async () => {
    const user = fx.principal(fx.tenantA, ROLE_NAMES.USER);
    currentUser = user;

    const res = await http("patch", "/edit", {
      userId: user.id,
      status: "ACTIVE",
      firstName: "Self",
    });

    expect(res.status).toBe(403);
    expect(userService.editUser).not.toHaveBeenCalled();
  });

  it("a user holding users:update still edits through it", async () => {
    const admin = fx.principal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);
    const target = fx.principal(fx.tenantA, ROLE_NAMES.USER);
    currentUser = admin;

    const res = await http("patch", "/edit", { userId: target.id, firstName: "Edited" });

    expect(res.status).toBe(200);
    expect(userService.editUser).toHaveBeenCalledWith(
      expect.objectContaining({ userId: target.id, firstName: "Edited" }),
    );
  });
});

describe("A-63 — PATCH /users/:userId/profile", () => {
  it("an ordinary user edits their own profile; only profile fields reach the service", async () => {
    const user = fx.principal(fx.tenantA, ROLE_NAMES.USER);
    currentUser = user;

    const res = await http("patch", `/${user.id}/profile`, {
      firstName: "Ada",
      lastName: "Lovelace",
      username: "AdaL",
      status: "ACTIVE",
      email: "new@evil.test",
      roleId: "99999999-9999-4999-8999-999999999999",
    });

    expect(res.status).toBe(200);
    expect(userService.editUser).toHaveBeenCalledTimes(1);
    const input = userService.editUser.mock.calls[0][0];
    expect(input).toMatchObject({
      userId: user.id,
      firstName: "Ada",
      lastName: "Lovelace",
      username: "adal",
      updatedBy: user.id,
      actorIsSuperAdmin: false,
      actorTenantId: fx.tenantA.id,
    });
    expect(input).not.toHaveProperty("status");
    expect(input).not.toHaveProperty("email");
    expect(input).not.toHaveProperty("roleId");
  });

  it("the path wins: a body userId naming another user does not change the target", async () => {
    const user = fx.principal(fx.tenantA, ROLE_NAMES.USER);
    const other = fx.principal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);
    currentUser = user;

    const res = await http("patch", `/${user.id}/profile`, {
      userId: other.id,
      firstName: "Ada",
    });

    expect(res.status).toBe(200);
    expect(userService.editUser.mock.calls[0][0].userId).toBe(user.id);
  });

  it("an ordinary user naming another user of their tenant in the path is refused (403)", async () => {
    const user = fx.principal(fx.tenantA, ROLE_NAMES.USER);
    const other = fx.principal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);
    currentUser = user;

    const res = await http("patch", `/${other.id}/profile`, { firstName: "Mallory" });

    expect(res.status).toBe(403);
    expect(userService.editUser).not.toHaveBeenCalled();
  });

  it.each([ROLE_NAMES.USER, ROLE_NAMES.HEALTCARE_ADMIN])(
    "a %s of tenant A naming a user of tenant B gets 404 — the same body as a user that does not exist",
    async (role) => {
      currentUser = fx.principal(fx.tenantA, role);
      const victim = fx.principal(fx.tenantB, ROLE_NAMES.USER);

      const foreign = await http("patch", `/${victim.id}/profile`, { firstName: "Mallory" });
      const missing = await http(
        "patch",
        "/ffffffff-ffff-4fff-8fff-ffffffffffff/profile",
        { firstName: "Mallory" },
      );

      expect(foreign.status).toBe(404);
      expect(foreign.body).toEqual(missing.body);
      expect(userService.editUser).not.toHaveBeenCalled();
    },
  );

  it("rejects a non-UUID path id (400) before the gate", async () => {
    currentUser = fx.principal(fx.tenantA, ROLE_NAMES.USER);

    const res = await http("patch", "/not-a-uuid/profile", { firstName: "Ada" });

    expect(res.status).toBe(400);
    expect(userService.editUser).not.toHaveBeenCalled();
  });

  it("rejects an invalid profile field (400)", async () => {
    const user = fx.principal(fx.tenantA, ROLE_NAMES.USER);
    currentUser = user;

    const res = await http("patch", `/${user.id}/profile`, { firstName: "A" });

    expect(res.status).toBe(400);
    expect(userService.editUser).not.toHaveBeenCalled();
  });

  it("falls back to its default message when the service returns none", async () => {
    const user = fx.principal(fx.tenantA, ROLE_NAMES.USER);
    currentUser = user;
    userService.editUser.mockResolvedValueOnce({ data: { id: user.id } });

    const res = await http("patch", `/${user.id}/profile`, { lastName: "Byron" });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Profile updated successfully");
  });
});

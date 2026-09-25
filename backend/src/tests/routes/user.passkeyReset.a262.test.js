/**
 * A-262 — DELETE /users/:userId/webauthn: a tenant administrator removes
 * another user's passkey.
 *
 * Before: there was no way to. A lost or compromised passkey device could be
 * removed only by its owner (with the password, A-213), and an SSO-only user,
 * who has no password, could not remove it at all (ADR-068). An administrator
 * needed database access.
 *
 * Rules asserted (the A-141 / A-162 guards, loadAdminResetTarget):
 *  - another tenant's user is a 404, indistinguishable from a missing one,
 *    and is left untouched (CLAUDE.md two-tenant rule);
 *  - only a tenant administrator holding users update access may remove it;
 *    a technician is 403, a user without users access is 403;
 *  - never oneself (400); never a user whose role outranks the caller's
 *    (403); nothing enrolled is a 409;
 *  - on success: every passkey column is cleared, the password and MFA are
 *    untouched, EVERY session is revoked, and the audit row
 *    (WEBAUTHN_ADMIN_RESET, actor = the administrator) is written inside the
 *    transaction without the credential; a failed audit insert rolls the
 *    removal back.
 *
 * Real chain: user.route → validateUuid → dynamicAccess → rbac →
 * user.controller → user.service. Stubbed as in user.passwordReset.a162.
 */

const mockFx = { current: null, rows: new Map() };
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

// A transaction double with an undo log: row updates made in it are reverted
// by rollback(), so "rolled back" is observable on the row.
jest.mock("../../config", () => ({
  db: {
    transaction: jest.fn(async () => {
      const tx = {
        finished: undefined,
        undo: [],
        async commit() {
          tx.finished = "commit";
        },
        async rollback() {
          for (const [row, prior] of tx.undo.reverse()) {
            Object.assign(row, prior);
          }
          tx.finished = "rollback";
        },
      };
      return tx;
    }),
  },
}));

jest.mock("../../models", () => {
  // Not tenant-scoped, like the fixture: the service's own
  // assertSameTenantOrNotFound is what is under test for the foreign row.
  const users = {
    findByPk: jest.fn(async (id) => mockFx.rows.get(id) || null),
  };
  return {
    Tenants: { findByPk: (...args) => mockFx.current.Tenants.findByPk(...args) },
    User: users,
    Users: users,
    Roles: { name: "Roles" },
    Role: { name: "Roles" },
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
  getUploadUrl: jest.fn(),
}));
jest.mock("../../middlewares/auditLog.middleware", () => ({
  recordAudit: () => (req, res, next) => next(),
}));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn() }));
jest.mock("../../services/session.service", () => ({
  revokeOtherSessions: jest.fn(),
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { createTwoTenants } = require("../fixtures/twoTenants");
const RolesService = require("../../services/roles.service");
const auditService = require("../../services/audit.service");
const { revokeOtherSessions } = require("../../services/session.service");
const { ROLE_NAMES } = require("../../constants");
const router = require("../../routes/api/user.route");
const userService = require("../../services/user.service");

const http = (url, method = "DELETE") =>
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
      method,
      url,
      originalUrl: "/api/v1/users" + url,
      body: {},
      query: {},
      params: {},
      headers: { "user-agent": "jest" },
      ip: "203.0.113.9",
      get: () => undefined,
    };
    router.handle(req, res, (err) =>
      resolve({
        status: err ? err.status || 500 : 404,
        body: { message: err ? err.message : "no route" },
      }),
    );
  });

// Seed-shaped grants: the admin roles and the technician hold `users` write.
const MATRIX = {
  [ROLE_NAMES.HEALTCARE_ADMIN]: { Users: ["write"], users: ["write"] },
  [ROLE_NAMES.TECHNICIAN]: { Users: ["write"], users: ["write"] },
  [ROLE_NAMES.USER]: { Home: ["read"], home: ["read"] },
};

const PASSKEY_ON = Object.freeze({
  webauthnEnabled: true,
  webauthnCredentialId: "cred-abc",
  webauthnPublicKey: "public-key-bytes",
  webauthnSignCount: 7,
});

/** A users-table row for a fixture principal. */
let fx;
const rowFor = (principal, overrides = {}) => {
  const row = {
    id: principal.id,
    tenantId: principal.tenantId,
    role: principal.role,
    ...PASSKEY_ON,
    password: "old-hash",
    mfaEnabled: true,
    mfaSecret: "JBSWY3DPEHPK3PXP",
    ...overrides,
  };
  row.update = jest.fn(async (values, options = {}) => {
    if (options.transaction) {
      const prior = {};
      for (const key of Object.keys(values)) {
        prior[key] = row[key];
      }
      options.transaction.undo.push([row, prior]);
    }
    return Object.assign(row, values);
  });
  mockFx.rows.set(row.id, row);
  return row;
};

const expectPasskeyKept = (row) => expect(row).toMatchObject({ ...PASSKEY_ON });

beforeEach(() => {
  jest.clearAllMocks();
  fx = createTwoTenants();
  mockFx.current = fx;
  mockFx.rows = new Map();
  currentUser = null;
  const byRoleId = new Map();
  for (const role of Object.keys(MATRIX)) {
    byRoleId.set(fx.principal(fx.tenantA, role).role.id, MATRIX[role]);
    byRoleId.set(fx.principal(fx.tenantB, role).role.id, MATRIX[role]);
  }
  RolesService.getRolePermissionsMatrix.mockImplementation(
    async (roleId) => byRoleId.get(roleId) || {},
  );
  revokeOtherSessions.mockResolvedValue(3);
  auditService.logAction.mockResolvedValue({ id: "audit-1" });
});

describe("A-262 — DELETE /users/:userId/webauthn", () => {
  it("a tenant admin removes a same-tenant user's passkey: columns cleared, password and MFA untouched, every session revoked, audited in the transaction", async () => {
    const admin = fx.principal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);
    const target = rowFor(fx.principal(fx.tenantA, ROLE_NAMES.TECHNICIAN));
    currentUser = admin;

    const res = await http(`/${target.id}/webauthn`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: target.id, webauthnEnabled: false, sessionsRevoked: 3 });
    expect(target).toMatchObject({
      webauthnEnabled: false,
      webauthnCredentialId: null,
      webauthnPublicKey: null,
      webauthnSignCount: 0,
      password: "old-hash",
      mfaEnabled: true,
      mfaSecret: "JBSWY3DPEHPK3PXP",
    });
    expect(revokeOtherSessions).toHaveBeenCalledWith(target.id, null, "WEBAUTHN_ADMIN_RESET", {
      transaction: expect.any(Object),
    });
    const [entry, options] = auditService.logAction.mock.calls[0];
    expect(entry).toEqual({
      tenantId: fx.tenantA.id,
      userId: admin.id,
      action: "UPDATE",
      resourceType: "User",
      resourceId: target.id,
      changes: { operation: "WEBAUTHN_ADMIN_RESET", sessionsRevoked: 3 },
      ipAddress: "203.0.113.9",
      userAgent: "jest",
    });
    expect(options.transaction.finished).toBe("commit");
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain(PASSKEY_ON.webauthnCredentialId);
    expect(serialized).not.toContain(PASSKEY_ON.webauthnPublicKey);
  });

  it("another tenant's user is a 404 — the same answer as no such user — and is left untouched", async () => {
    currentUser = fx.principal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);
    const foreign = rowFor(fx.principal(fx.tenantB, ROLE_NAMES.TECHNICIAN));

    const cross = await http(`/${foreign.id}/webauthn`);
    const missing = await http("/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/webauthn");

    expect(cross.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(cross.body.message).toBe(missing.body.message);
    expectPasskeyKept(foreign);
    expect(revokeOtherSessions).not.toHaveBeenCalled();
    expect(auditService.logAction).not.toHaveBeenCalled();
  });

  it("a technician (users write, but below tenant admin) is refused 403", async () => {
    currentUser = fx.principal(fx.tenantA, ROLE_NAMES.TECHNICIAN);
    const target = rowFor(fx.principal(fx.tenantA, ROLE_NAMES.USER));

    const res = await http(`/${target.id}/webauthn`);

    expect(res.status).toBe(403);
    expectPasskeyKept(target);
  });

  it("a user without users access is refused 403 by the permission gate", async () => {
    currentUser = fx.principal(fx.tenantA, ROLE_NAMES.USER);
    const target = rowFor(fx.principal(fx.tenantA, ROLE_NAMES.TECHNICIAN));

    const res = await http(`/${target.id}/webauthn`);

    expect(res.status).toBe(403);
    expectPasskeyKept(target);
  });

  it("an administrator cannot remove their own passkey here (400)", async () => {
    const admin = fx.principal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);
    const own = rowFor(admin);
    currentUser = admin;

    const res = await http(`/${admin.id}/webauthn`);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Passkeys page with your password/);
    expectPasskeyKept(own);
  });

  it("a tenant admin cannot remove a super admin's passkey (403); a super admin can remove anyone's", async () => {
    const superRow = rowFor(fx.superAdmin);
    currentUser = fx.principal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);

    const refused = await http(`/${superRow.id}/webauthn`);
    expect(refused.status).toBe(403);
    expect(refused.body.message).toMatch(/reset the passkey of a user whose role is above yours/);
    expectPasskeyKept(superRow);

    currentUser = fx.superAdmin;
    const target = rowFor(fx.principal(fx.tenantB, ROLE_NAMES.HEALTCARE_ADMIN));
    const done = await http(`/${target.id}/webauthn`);
    expect(done.status).toBe(200);
    expect(target.webauthnEnabled).toBe(false);
  });

  it("a user with no passkey is a 409 that says so, and nothing is revoked", async () => {
    currentUser = fx.principal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);
    const target = rowFor(fx.principal(fx.tenantA, ROLE_NAMES.TECHNICIAN), { webauthnEnabled: false });

    const res = await http(`/${target.id}/webauthn`);

    expect(res.status).toBe(409);
    expect(res.body.message).toBe("This user has no passkey to remove");
    expect(revokeOtherSessions).not.toHaveBeenCalled();
    expect(auditService.logAction).not.toHaveBeenCalled();
  });

  it("a failed audit insert rolls the removal back — the passkey still stands", async () => {
    currentUser = fx.principal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);
    const target = rowFor(fx.principal(fx.tenantA, ROLE_NAMES.TECHNICIAN));
    auditService.logAction.mockRejectedValueOnce(new Error("audit insert failed"));

    const res = await http(`/${target.id}/webauthn`);

    expect(res.status).toBe(500);
    expectPasskeyKept(target);
  });

  it("a malformed id is a 400 before anything is looked up", async () => {
    currentUser = fx.principal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);

    const res = await http("/not-a-uuid/webauthn");

    expect(res.status).toBe(400);
  });

  it("the route answers DELETE only", async () => {
    currentUser = fx.principal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);
    const target = rowFor(fx.principal(fx.tenantA, ROLE_NAMES.TECHNICIAN));

    const res = await http(`/${target.id}/webauthn`, "POST");

    expect(res.status).toBe(404);
    expectPasskeyKept(target);
  });
});

describe("A-262 — userService.resetUserPasskey refuses on its own (defence in depth)", () => {
  it("a missing user and a foreign user are the same 404", async () => {
    const admin = fx.principal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);
    const foreign = rowFor(fx.principal(fx.tenantB, ROLE_NAMES.TECHNICIAN));
    const actor = {
      resetBy: admin.id,
      actorIsSuperAdmin: false,
      actorTenantId: fx.tenantA.id,
      actorRoleLevel: admin.role.roleLevel,
    };

    const missing = userService
      .resetUserPasskey({ ...actor, userId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" })
      .catch((e) => e);
    const cross = userService.resetUserPasskey({ ...actor, userId: foreign.id }).catch((e) => e);

    expect(await missing).toEqual({ status: 404, message: "User not found" });
    expect(await cross).toEqual({ status: 404, message: "User not found" });
    expectPasskeyKept(foreign);
  });

  it("a transaction that cannot even start is a 500, and nothing is rolled back", async () => {
    const { db } = require("../../config");
    db.transaction.mockRejectedValueOnce(new Error("pool exhausted"));

    await expect(
      userService.resetUserPasskey({ userId: "x", resetBy: "y", actorIsSuperAdmin: true }),
    ).rejects.toEqual({ status: 500, message: "pool exhausted" });
  });

  it("an unexpected fault is a 500 with no detail beyond its message", async () => {
    const { Users } = require("../../models");
    Users.findByPk.mockRejectedValueOnce(Object.create(Error.prototype));

    await expect(
      userService.resetUserPasskey({ userId: "x", resetBy: "y", actorIsSuperAdmin: true }),
    ).rejects.toEqual({ status: 500, message: "Internal server error" });
  });
});

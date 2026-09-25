/**
 * A-162 — POST /users/:userId/password/reset: a tenant administrator replaces
 * another user's password with a random temporary one, shown once.
 *
 * Fail-before (baseline 2a157f1): the route did not exist — every case below
 * answered 404 "no route" (the success, 400, 403 and rollback cases fail; the
 * two-tenant 404 case passes vacuously and is kept for the contract).
 *
 * Rules asserted:
 *  - another tenant's user is a 404, indistinguishable from a missing one,
 *    and is left untouched (CLAUDE.md two-tenant rule);
 *  - only a tenant administrator holding users update access may reset; a
 *    technician is 403, a user without users access is 403;
 *  - never oneself (400); never a user whose role outranks the caller's (403);
 *  - on success: the stored hash verifies against the returned temporary
 *    password (and not the old one), mustChangePassword is set, a lockout is
 *    lifted, MFA is untouched, EVERY session is revoked, the response is
 *    no-store, and the audit row (PASSWORD_ADMIN_RESET, actor = the
 *    administrator) is written inside the transaction without the password
 *    or its hash; a failed audit insert rolls the reset back.
 *
 * Real chain: user.route → validateUuid → dynamicAccess → rbac →
 * user.controller → user.service, and the real bcrypt hashing. Stubbed as in
 * user.mfaReset.a141.test.js.
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

const http = (url) =>
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
        resolve({ status: this.statusCode, body: payload, headers: this.headers });
        return this;
      },
      send(payload) {
        return this.json(payload);
      },
      headers: {},
      setHeader(name, value) {
        this.headers[name.toLowerCase()] = value;
        return this;
      },
      end() {
        this.headersSent = true;
        resolve({ status: this.statusCode, body: null });
        return this;
      },
    };
    const req = {
      method: "POST",
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

const { comparePassword, hashPassword } = require("../../utils/password.util");
const userService = require("../../services/user.service");

const MFA_ON = Object.freeze({
  mfaEnabled: true,
  mfaSecret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
  mfaPendingSecret: null,
  mfaPendingCreatedAt: null,
  mfaLastUsedStep: 59674800,
  mfaRecoveryCodes: ["h1", "h2"],
});

let OLD_HASH;
beforeAll(async () => {
  OLD_HASH = await hashPassword("the-old-password");
});

/** A users-table row for a fixture principal. */
let fx;
const rowFor = (principal, overrides = {}) => {
  const row = {
    id: principal.id,
    tenantId: principal.tenantId,
    role: principal.role,
    ...MFA_ON,
    password: OLD_HASH,
    mustChangePassword: false,
    failedLoginAttempts: 4,
    lockedUntil: new Date("2099-01-01T00:00:00Z"),
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
  revokeOtherSessions.mockResolvedValue(2);
  auditService.logAction.mockResolvedValue({ id: "audit-1" });
});

describe("A-162 — POST /users/:userId/password/reset", () => {
  it("a tenant admin resets a same-tenant user: temporary password returned once, flag set, lockout lifted, MFA untouched, every session revoked, audited in the transaction", async () => {
    const admin = fx.principal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);
    const target = rowFor(fx.principal(fx.tenantA, ROLE_NAMES.TECHNICIAN));
    currentUser = admin;

    const res = await http(`/${target.id}/password/reset`);

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const { temporaryPassword } = res.body.data;
    expect(res.body.data).toEqual({
      id: target.id,
      temporaryPassword: expect.stringMatching(/^[A-HJ-NP-Za-km-z2-9]{16}$/),
      mustChangePassword: true,
      // A-215: it stops signing in after 72 hours.
      temporaryPasswordExpiresAt: expect.any(Date),
      sessionsRevoked: 2,
    });
    // Only the hash is stored, and it is the hash of what was shown.
    expect(target.password).not.toBe(temporaryPassword);
    expect(await comparePassword(temporaryPassword, target.password)).toBe(true);
    expect(await comparePassword("the-old-password", target.password)).toBe(false);
    expect(target).toMatchObject({
      mustChangePassword: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
      // The second factor stays: the temporary password alone does not sign in.
      mfaEnabled: true,
      mfaSecret: MFA_ON.mfaSecret,
    });
    expect(revokeOtherSessions).toHaveBeenCalledWith(target.id, null, "PASSWORD_ADMIN_RESET", {
      transaction: expect.any(Object),
    });
    const [entry, options] = auditService.logAction.mock.calls[0];
    expect(entry).toEqual({
      tenantId: fx.tenantA.id,
      userId: admin.id,
      action: "UPDATE",
      resourceType: "User",
      resourceId: target.id,
      changes: {
        operation: "PASSWORD_ADMIN_RESET",
        sessionsRevoked: 2,
        firstLoginChangeRequired: true,
        // A-215: when the temporary password stops signing in.
        firstLoginChangeDeadline: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
      },
      ipAddress: "203.0.113.9",
      userAgent: "jest",
    });
    expect(options.transaction.finished).toBe("commit");
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain(temporaryPassword);
    expect(serialized).not.toContain(target.password);
  });

  it("two resets give two different temporary passwords", async () => {
    currentUser = fx.principal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);
    const target = rowFor(fx.principal(fx.tenantA, ROLE_NAMES.TECHNICIAN));

    const first = await http(`/${target.id}/password/reset`);
    const second = await http(`/${target.id}/password/reset`);

    expect(first.body.data.temporaryPassword).not.toBe(second.body.data.temporaryPassword);
  });

  it("another tenant's user is a 404 — the same answer as no such user — and is left untouched", async () => {
    currentUser = fx.principal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);
    const foreign = rowFor(fx.principal(fx.tenantB, ROLE_NAMES.TECHNICIAN));

    const cross = await http(`/${foreign.id}/password/reset`);
    const missing = await http("/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/password/reset");

    expect(cross.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(cross.body.message).toBe(missing.body.message);
    expect(foreign.password).toBe(OLD_HASH);
    expect(foreign.mustChangePassword).toBe(false);
    expect(revokeOtherSessions).not.toHaveBeenCalled();
    expect(auditService.logAction).not.toHaveBeenCalled();
  });

  it("a technician (users write, but below tenant admin) is refused 403", async () => {
    currentUser = fx.principal(fx.tenantA, ROLE_NAMES.TECHNICIAN);
    const target = rowFor(fx.principal(fx.tenantA, ROLE_NAMES.USER));

    const res = await http(`/${target.id}/password/reset`);

    expect(res.status).toBe(403);
    expect(target.password).toBe(OLD_HASH);
  });

  it("a user without users access is refused 403 by the permission gate", async () => {
    currentUser = fx.principal(fx.tenantA, ROLE_NAMES.USER);
    const target = rowFor(fx.principal(fx.tenantA, ROLE_NAMES.TECHNICIAN));

    const res = await http(`/${target.id}/password/reset`);

    expect(res.status).toBe(403);
    expect(target.password).toBe(OLD_HASH);
  });

  it("an administrator cannot reset their own password here (400)", async () => {
    const admin = fx.principal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);
    rowFor(admin);
    currentUser = admin;

    const res = await http(`/${admin.id}/password/reset`);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/change-password page/);
    expect(mockFx.rows.get(admin.id).password).toBe(OLD_HASH);
  });

  it("a tenant admin cannot reset a super admin's password (403); a super admin can reset anyone", async () => {
    const superRow = rowFor(fx.superAdmin);
    currentUser = fx.principal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);

    const refused = await http(`/${superRow.id}/password/reset`);
    expect(refused.status).toBe(403);
    expect(refused.body.message).toMatch(/reset the password of a user whose role is above yours/);
    expect(superRow.password).toBe(OLD_HASH);

    currentUser = fx.superAdmin;
    const target = rowFor(fx.principal(fx.tenantB, ROLE_NAMES.HEALTCARE_ADMIN));
    const done = await http(`/${target.id}/password/reset`);
    expect(done.status).toBe(200);
    expect(target.mustChangePassword).toBe(true);
  });

  it("a caller admitted by role NAME whose level is unknown is refused (fails closed)", async () => {
    const named = fx.principal(fx.tenantA, ROLE_NAMES.TENANT_ADMIN);
    currentUser = { ...named, role: { ...named.role, roleLevel: undefined } };
    RolesService.getRolePermissionsMatrix.mockImplementation(async () => ({
      Users: ["write"],
      users: ["write"],
    }));
    const target = rowFor(fx.principal(fx.tenantA, ROLE_NAMES.USER));

    const res = await http(`/${target.id}/password/reset`);

    expect(res.status).toBe(403);
    expect(target.password).toBe(OLD_HASH);
  });

  it("a failed audit insert rolls the reset back — the old password still stands", async () => {
    currentUser = fx.principal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);
    const target = rowFor(fx.principal(fx.tenantA, ROLE_NAMES.TECHNICIAN));
    auditService.logAction.mockRejectedValueOnce(new Error("audit insert failed"));

    const res = await http(`/${target.id}/password/reset`);

    expect(res.status).toBe(500);
    expect(res.body.data).toBeFalsy();
    expect(target.password).toBe(OLD_HASH);
    expect(target.mustChangePassword).toBe(false);
    expect(target.failedLoginAttempts).toBe(4);
  });

  it("a malformed id is a 400 before anything is looked up", async () => {
    currentUser = fx.principal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);

    const res = await http("/not-a-uuid/password/reset");

    expect(res.status).toBe(400);
  });
});

describe("A-162 — userService.resetUserPassword refuses on its own (defence in depth)", () => {
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
      .resetUserPassword({ ...actor, userId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" })
      .catch((e) => e);
    const cross = userService.resetUserPassword({ ...actor, userId: foreign.id }).catch((e) => e);

    expect(await missing).toEqual({ status: 404, message: "User not found" });
    expect(await cross).toEqual({ status: 404, message: "User not found" });
    expect(foreign.password).toBe(OLD_HASH);
  });

  it("a transaction that cannot even start is a 500, and nothing is rolled back", async () => {
    const { db } = require("../../config");
    db.transaction.mockRejectedValueOnce(new Error("pool exhausted"));

    await expect(
      userService.resetUserPassword({ userId: "x", resetBy: "y", actorIsSuperAdmin: true }),
    ).rejects.toEqual({ status: 500, message: "pool exhausted" });
  });

  it("an unexpected fault is a 500 with no detail beyond its message", async () => {
    const { Users } = require("../../models");
    Users.findByPk.mockRejectedValueOnce(Object.create(Error.prototype));

    await expect(
      userService.resetUserPassword({ userId: "x", resetBy: "y", actorIsSuperAdmin: true }),
    ).rejects.toEqual({ status: 500, message: "Internal server error" });
  });

  it("the temporary password is 16 characters of the unambiguous alphabet", () => {
    const seen = new Set();
    for (let i = 0; i < 50; i += 1) {
      const p = userService.generateTemporaryPassword();
      expect(p).toMatch(/^[A-HJ-NP-Za-km-z2-9]{16}$/);
      seen.add(p);
    }
    expect(seen.size).toBe(50);
    expect(userService.TEMPORARY_PASSWORD_LENGTH).toBe(16);
  });
});

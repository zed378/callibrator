/**
 * A-141 — POST /users/:userId/mfa/reset: a tenant administrator clears the
 * second factor of a user who lost their authenticator AND their recovery
 * codes.
 *
 * Fail-before: the route did not exist (404 "no route" for every case).
 *
 * Rules asserted:
 *  - another tenant's user is a 404, indistinguishable from a missing one
 *    (CLAUDE.md: every new `:id` route gets a two-tenant 404 test), and is
 *    left untouched;
 *  - only a tenant administrator (role level >= TENANT_ADMIN) holding users
 *    update access may reset; a technician is 403;
 *  - never oneself (400) — that is POST /auth/mfa/disable;
 *  - never a user whose role outranks the caller's (403);
 *  - a user without MFA is a 409;
 *  - on success every MFA column is cleared, EVERY session of the target is
 *    revoked, and the audit row (MFA_ADMIN_RESET, actor = the administrator)
 *    is written inside the transaction, before the commit; a failed audit
 *    insert rolls the reset back.
 *
 * Real chain: user.route → validateUuid → dynamicAccess → rbac →
 * user.controller → user.service. Stubbed: `auth` (sets the principal), the
 * permission matrix, the session revocation and the audit insert. The two
 * tenants and their principals come from fixtures/twoTenants.js; the user
 * rows are built over them here, with a transaction double that can roll
 * their updates back.
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

const MFA_ON = Object.freeze({
  mfaEnabled: true,
  mfaSecret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
  mfaPendingSecret: null,
  mfaPendingCreatedAt: null,
  mfaLastUsedStep: 59674800,
  mfaRecoveryCodes: ["h1", "h2"],
});

/** A users-table row for a fixture principal. */
let fx;
const rowFor = (principal, overrides = {}) => {
  const row = {
    id: principal.id,
    tenantId: principal.tenantId,
    role: principal.role,
    ...MFA_ON,
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

describe("A-141 — POST /users/:userId/mfa/reset", () => {
  it("a tenant admin resets a user of the same tenant: MFA cleared, every session revoked, audited in the transaction", async () => {
    const admin = fx.principal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);
    const target = rowFor(fx.principal(fx.tenantA, ROLE_NAMES.TECHNICIAN));
    currentUser = admin;

    const res = await http(`/${target.id}/mfa/reset`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: target.id, mfaEnabled: false, sessionsRevoked: 2 });
    expect(target).toMatchObject({
      mfaEnabled: false,
      mfaSecret: null,
      mfaPendingSecret: null,
      mfaPendingCreatedAt: null,
      mfaLastUsedStep: null,
      mfaRecoveryCodes: null,
    });
    // ALL of the target's sessions (no session is kept).
    expect(revokeOtherSessions).toHaveBeenCalledWith(target.id, null, "MFA_ADMIN_RESET", {
      transaction: expect.any(Object),
    });
    const [entry, options] = auditService.logAction.mock.calls[0];
    expect(entry).toEqual({
      tenantId: fx.tenantA.id,
      userId: admin.id,
      action: "UPDATE",
      resourceType: "User",
      resourceId: target.id,
      changes: { operation: "MFA_ADMIN_RESET", sessionsRevoked: 2 },
      ipAddress: "203.0.113.9",
      userAgent: "jest",
    });
    // Written before the commit, in the reset's own transaction.
    expect(options.transaction.finished).toBe("commit");
    expect(JSON.stringify(entry)).not.toContain(MFA_ON.mfaSecret);
  });

  it("another tenant's user is a 404 — the same answer as no such user — and is left untouched", async () => {
    currentUser = fx.principal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);
    const foreign = rowFor(fx.principal(fx.tenantB, ROLE_NAMES.TECHNICIAN));

    const cross = await http(`/${foreign.id}/mfa/reset`);
    const missing = await http("/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/mfa/reset");

    expect(cross.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(cross.body.message).toBe(missing.body.message);
    expect(foreign.mfaEnabled).toBe(true);
    expect(foreign.mfaSecret).toBe(MFA_ON.mfaSecret);
    expect(revokeOtherSessions).not.toHaveBeenCalled();
    expect(auditService.logAction).not.toHaveBeenCalled();
  });

  it("a technician (users write, but below tenant admin) is refused 403", async () => {
    currentUser = fx.principal(fx.tenantA, ROLE_NAMES.TECHNICIAN);
    const target = rowFor(fx.principal(fx.tenantA, ROLE_NAMES.USER));

    const res = await http(`/${target.id}/mfa/reset`);

    expect(res.status).toBe(403);
    expect(target.mfaEnabled).toBe(true);
  });

  it("a user without users access is refused 403 by the permission gate", async () => {
    currentUser = fx.principal(fx.tenantA, ROLE_NAMES.USER);
    const target = rowFor(fx.principal(fx.tenantA, ROLE_NAMES.TECHNICIAN));

    const res = await http(`/${target.id}/mfa/reset`);

    expect(res.status).toBe(403);
    expect(target.mfaEnabled).toBe(true);
  });

  it("an administrator cannot reset their own MFA here (400)", async () => {
    const admin = fx.principal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);
    rowFor(admin);
    currentUser = admin;

    const res = await http(`/${admin.id}/mfa/reset`);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/MFA page/);
    expect(mockFx.rows.get(admin.id).mfaEnabled).toBe(true);
  });

  it("a tenant admin cannot reset a super admin's MFA (403); a super admin can reset anyone", async () => {
    const superRow = rowFor(fx.superAdmin);
    currentUser = fx.principal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);

    const refused = await http(`/${superRow.id}/mfa/reset`);
    expect(refused.status).toBe(403);
    expect(superRow.mfaEnabled).toBe(true);

    currentUser = fx.superAdmin;
    const target = rowFor(fx.principal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN));
    const done = await http(`/${target.id}/mfa/reset`);
    expect(done.status).toBe(200);
    expect(target.mfaEnabled).toBe(false);
  });

  it("a caller admitted by role NAME whose level is unknown is refused (fails closed)", async () => {
    // rbac() admits a role literally named TENANT_ADMIN whatever its level.
    const named = fx.principal(fx.tenantA, ROLE_NAMES.TENANT_ADMIN);
    currentUser = { ...named, role: { ...named.role, roleLevel: undefined } };
    RolesService.getRolePermissionsMatrix.mockImplementation(async () => ({
      Users: ["write"],
      users: ["write"],
    }));
    const target = rowFor(fx.principal(fx.tenantA, ROLE_NAMES.USER));

    const res = await http(`/${target.id}/mfa/reset`);

    expect(res.status).toBe(403);
    expect(target.mfaEnabled).toBe(true);
  });

  it("a target whose role is gone counts as the lowest level", async () => {
    currentUser = fx.principal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);
    const target = rowFor(fx.principal(fx.tenantA, ROLE_NAMES.USER), { role: null });

    const res = await http(`/${target.id}/mfa/reset`);

    expect(res.status).toBe(200);
  });

  it("a user without MFA is a 409", async () => {
    currentUser = fx.principal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);
    const target = rowFor(fx.principal(fx.tenantA, ROLE_NAMES.TECHNICIAN), {
      mfaEnabled: false,
      mfaSecret: null,
    });

    const res = await http(`/${target.id}/mfa/reset`);

    expect(res.status).toBe(409);
    expect(res.body.message).toBe("MFA is not enabled for this user");
  });

  it("a failed audit insert rolls the reset back", async () => {
    currentUser = fx.principal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);
    const target = rowFor(fx.principal(fx.tenantA, ROLE_NAMES.TECHNICIAN));
    auditService.logAction.mockRejectedValueOnce(new Error("audit insert failed"));

    const res = await http(`/${target.id}/mfa/reset`);

    expect(res.status).toBe(500);
    expect(target.mfaEnabled).toBe(true);
    expect(target.mfaSecret).toBe(MFA_ON.mfaSecret);
    expect(target.mfaRecoveryCodes).toEqual(["h1", "h2"]);
  });

  it("a malformed id is a 400 before anything is looked up", async () => {
    currentUser = fx.principal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);

    const res = await http("/not-a-uuid/mfa/reset");

    expect(res.status).toBe(400);
  });
});

// The route's permission gate (dynamicAccess checkTenant) already answers 404
// for a missing or foreign user, so the service's own refusal is
// defence-in-depth — the branch that goes live the moment a lookup gains
// `.unscoped()` or the gate changes. Driven directly here.
describe("A-141 — userService.resetUserMfa refuses on its own (defence in depth)", () => {
  const userService = require("../../services/user.service");

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
      .resetUserMfa({ ...actor, userId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" })
      .catch((e) => e);
    const cross = userService.resetUserMfa({ ...actor, userId: foreign.id }).catch((e) => e);

    expect(await missing).toEqual({ status: 404, message: "User not found" });
    expect(await cross).toEqual({ status: 404, message: "User not found" });
    expect(foreign.mfaEnabled).toBe(true);
  });

  it("a transaction that cannot even start is a 500, and nothing is rolled back", async () => {
    const { db } = require("../../config");
    db.transaction.mockRejectedValueOnce(new Error("pool exhausted"));

    await expect(
      userService.resetUserMfa({ userId: "x", resetBy: "y", actorIsSuperAdmin: true }),
    ).rejects.toEqual({ status: 500, message: "pool exhausted" });
  });

  it("an unexpected fault is a 500 with no detail beyond its message", async () => {
    const { Users } = require("../../models");
    Users.findByPk.mockRejectedValueOnce(Object.create(Error.prototype));

    await expect(
      userService.resetUserMfa({ userId: "x", resetBy: "y", actorIsSuperAdmin: true }),
    ).rejects.toEqual({ status: 500, message: "Internal server error" });
  });
});

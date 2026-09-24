/**
 * A-82 — impersonation writes an audit row, inside the transaction that
 * creates the impersonation session.
 *
 * impersonateUser created a session as another user and called only
 * logger.info: a super admin acting as a hospital user left nothing in
 * audit_logs.
 *
 * What is real: auth.service.impersonateUser and audit.service.logAction —
 * including its closed AUDIT_ACTIONS check. What is faked: the models
 * (AuditLog.create is the row the database would get), the transaction (a
 * stand-in that records which writes ran inside it) and createSession.
 *
 * What it does not prove: that PostgreSQL commits both rows or neither. The
 * wiring is the one openLoginSession (A-72) and issueSsoTokens (A-60) use.
 */

const mockTx = { id: "tx-a82", open: false };

jest.mock("../../config", () => ({
  db: {
    transaction: jest.fn(async (fn) => {
      mockTx.open = true;
      try {
        return await fn(mockTx);
      } finally {
        mockTx.open = false;
      }
    }),
  },
}));

jest.mock("../../models", () => ({
  Users: { findOne: jest.fn(), findByPk: jest.fn() },
  Role: {},
  Tenants: {},
  AuditLog: { create: jest.fn() },
}));

jest.mock("../../services/session.service", () => ({
  createSession: jest.fn(),
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { db } = require("../../config");
const { Users, AuditLog } = require("../../models");
const { createSession } = require("../../services/session.service");
const authService = require("../../services/auth.service");

const SUPER_ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TARGET_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_TENANT = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";

const superAdmin = (roleName = "SUPER_ADMIN") => ({
  id: SUPER_ADMIN_ID,
  email: "root@platform.example.com",
  role: { name: roleName },
});

const target = () => ({
  id: TARGET_ID,
  tenantId: TARGET_TENANT,
  username: "nurse",
  email: "nurse@hospital.example.com",
  role: { id: "r1", name: "TECHNICIAN" },
});

let writes;

beforeEach(() => {
  jest.clearAllMocks();
  writes = [];
  createSession.mockImplementation(async (params) => {
    writes.push({ what: "session", inTx: mockTx.open, params });
    return { id: SESSION_ID };
  });
  AuditLog.create.mockImplementation(async (row, options) => {
    writes.push({ what: "audit", inTx: mockTx.open, row, options });
    return { toJSON: () => ({ id: "audit-1", ...row }) };
  });
  Users.findByPk.mockResolvedValue(superAdmin());
  Users.findOne.mockResolvedValue(target());
});

describe("A-82: impersonation is audited", () => {
  it("impersonation writes an audit row naming the super admin, inside the session's transaction", async () => {
    const result = await authService.impersonateUser(
      SUPER_ADMIN_ID,
      TARGET_TENANT,
      TARGET_ID,
      "203.0.113.20",
      "admin-browser",
    );

    expect(result.status).toBe(200);
    expect(result.session).toEqual({ id: SESSION_ID });

    const audits = writes.filter((w) => w.what === "audit");
    expect(audits).toHaveLength(1);
    expect(audits[0].row).toEqual({
      // In the TARGET's tenant, where the access happened ...
      tenantId: TARGET_TENANT,
      // ... attributed to the ACTOR, the super admin, not the impersonated user.
      userId: SUPER_ADMIN_ID,
      action: "LOGIN",
      resourceType: "Session",
      resourceId: SESSION_ID,
      changes: {
        operation: "impersonate",
        method: "impersonation",
        impersonatorId: SUPER_ADMIN_ID,
        targetUserId: TARGET_ID,
        targetTenantId: TARGET_TENANT,
      },
      ipAddress: "203.0.113.20",
      userAgent: "admin-browser",
    });

    // One transaction; the session first, the audit row after it, both inside.
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(audits[0].options).toEqual({ transaction: mockTx });
    expect(writes.map((w) => [w.what, w.inTx])).toEqual([
      ["session", true],
      ["audit", true],
    ]);
    // The session is still the target's.
    expect(writes[0].params).toMatchObject({ userId: TARGET_ID, tenantId: TARGET_TENANT });
  });

  it("records a missing ip and user agent as null in the audit row", async () => {
    await authService.impersonateUser(SUPER_ADMIN_ID, TARGET_TENANT, TARGET_ID);

    const [audit] = writes.filter((w) => w.what === "audit");
    expect(audit.row).toMatchObject({ ipAddress: null, userAgent: null });
  });

  it("a failed audit insert fails the impersonation instead of proceeding unrecorded", async () => {
    AuditLog.create.mockRejectedValue(new Error("audit insert failed"));

    await expect(
      authService.impersonateUser(SUPER_ADMIN_ID, TARGET_TENANT, TARGET_ID, "203.0.113.20"),
    ).rejects.toThrow("audit insert failed");
  });

  it("a refused impersonation writes nothing", async () => {
    Users.findByPk.mockResolvedValue(superAdmin("TENANT_ADMIN"));

    await expect(
      authService.impersonateUser(SUPER_ADMIN_ID, TARGET_TENANT, TARGET_ID),
    ).rejects.toMatchObject({ status: 403 });
    expect(writes).toEqual([]);
  });
});

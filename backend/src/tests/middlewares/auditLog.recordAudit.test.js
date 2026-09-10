/**
 * Tests for recordAudit — the DB-backed audit-trail middleware.
 */
jest.mock("../../models", () => ({
  Tenants: {},
  Users: {},
  Roles: {},
  MenuGroups: {},
  RoleMenuPermissions: {},
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../../services/audit.service", () => ({
  logAction: jest.fn().mockResolvedValue({ id: "log-1" }),
}));

const { recordAudit } = require("../../middlewares/auditLog.middleware");
const auditService = require("../../services/audit.service");

const makeRes = () => {
  const handlers = {};
  return {
    statusCode: 200,
    on: jest.fn((evt, cb) => {
      handlers[evt] = cb;
    }),
    _finish() {
      if (handlers.finish) handlers.finish();
    },
  };
};

describe("recordAudit", () => {
  beforeEach(() => jest.clearAllMocks());

  it("throws for an invalid audit action", () => {
    expect(() => recordAudit("FROBNICATE", "User")).toThrow();
  });

  it("writes an audit row on a successful (2xx) response", async () => {
    const req = {
      user: { id: "user-1", tenantId: "tenant-1" },
      tenantId: "tenant-1",
      body: { userId: "target-9" },
      ip: "203.0.114.5",
      get: () => "jest-agent",
    };
    const res = makeRes();
    const next = jest.fn();

    recordAudit("UPDATE", "User", {
      resolveResourceId: (r) => r.body.userId,
    })(req, res, next);

    expect(next).toHaveBeenCalled();
    res.statusCode = 200;
    res._finish();
    await Promise.resolve();

    expect(auditService.logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        userId: "user-1",
        action: "UPDATE",
        resourceType: "User",
        resourceId: "target-9",
        ipAddress: "203.0.114.5",
        userAgent: "jest-agent",
      }),
    );
  });

  it("does NOT write an audit row on an error (>=400) response", async () => {
    const req = { user: { id: "u" }, tenantId: "t", params: {}, get: () => "a" };
    const res = makeRes();
    recordAudit("DELETE", "User")(req, res, jest.fn());
    res.statusCode = 403;
    res._finish();
    await Promise.resolve();
    expect(auditService.logAction).not.toHaveBeenCalled();
  });

  it("falls back to req.params.id when no resolver is given", async () => {
    const req = {
      user: { id: "u", tenantId: "t" },
      tenantId: "t",
      params: { id: "res-42" },
      get: () => "a",
    };
    const res = makeRes();
    recordAudit("CREATE", "Role")(req, res, jest.fn());
    res._finish();
    await Promise.resolve();
    expect(auditService.logAction).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: "res-42", action: "CREATE" }),
    );
  });

  it("uses opts.idParam when provided", async () => {
    const req = {
      user: { id: "u", tenantId: "t" },
      tenantId: "t",
      params: { customId: "custom-value" },
      get: () => "a",
    };
    const res = makeRes();
    recordAudit("CREATE", "Role", { idParam: "customId" })(req, res, jest.fn());
    res._finish();
    await Promise.resolve();
    expect(auditService.logAction).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: "custom-value", action: "CREATE" }),
    );
  });

  it("records a null resourceId when opts.idParam is absent from req.params", async () => {
    const req = {
      user: { id: "u", tenantId: "t" },
      tenantId: "t",
      params: { somethingElse: "x" },
      get: () => "a",
    };
    const res = makeRes();
    recordAudit("UPDATE", "Role", { idParam: "missingId" })(req, res, jest.fn());
    res._finish();
    await Promise.resolve();
    expect(auditService.logAction).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: null, action: "UPDATE" }),
    );
  });

  it("records a null resourceId when req.params has no id", async () => {
    const req = {
      user: { id: "u", tenantId: "t" },
      tenantId: "t",
      params: {},
      get: () => "a",
    };
    const res = makeRes();
    recordAudit("DELETE", "Role")(req, res, jest.fn());
    res._finish();
    await Promise.resolve();
    expect(auditService.logAction).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: null, action: "DELETE" }),
    );
  });

  it("records nulls when the request carries no tenant, user or agent", async () => {
    // An unauthenticated LOGIN attempt: no req.tenantId, no req.user, and
    // req.get returns nothing.
    const req = { params: {}, get: () => undefined };
    const res = makeRes();
    recordAudit("LOGIN", "Session")(req, res, jest.fn());
    res._finish();
    await Promise.resolve();
    expect(auditService.logAction).toHaveBeenCalledWith({
      tenantId: null,
      userId: null,
      action: "LOGIN",
      resourceType: "Session",
      resourceId: null,
      ipAddress: null,
      userAgent: null,
    });
  });

  it("falls back to req.user.tenantId when req.tenantId is absent", async () => {
    const req = {
      user: { id: "u-2", tenantId: "tenant-from-user" },
      params: {},
      get: () => "a",
    };
    const res = makeRes();
    recordAudit("EXPORT", "Report")(req, res, jest.fn());
    res._finish();
    await Promise.resolve();
    expect(auditService.logAction).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-from-user", userId: "u-2" }),
    );
  });

  it("records a null userId when the user object has no id", async () => {
    const req = { user: {}, tenantId: "t", params: {}, get: () => "a" };
    const res = makeRes();
    recordAudit("APPROVE", "Certificate")(req, res, jest.fn());
    res._finish();
    await Promise.resolve();
    expect(auditService.logAction).toHaveBeenCalledWith(
      expect.objectContaining({ userId: null, action: "APPROVE" }),
    );
  });

  it("swallows a logAction rejection without affecting the response", async () => {
    const unhandled = jest.fn();
    process.on("unhandledRejection", unhandled);
    auditService.logAction.mockRejectedValueOnce(new Error("db down"));

    const req = {
      user: { id: "u", tenantId: "t" },
      tenantId: "t",
      params: { id: "r-1" },
      get: () => "a",
    };
    const res = makeRes();
    const next = jest.fn();
    recordAudit("CREATE", "Role")(req, res, next);
    expect(next).toHaveBeenCalled();

    // Must not throw out of the 'finish' handler.
    expect(() => res._finish()).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();

    expect(auditService.logAction).toHaveBeenCalledTimes(1);
    expect(unhandled).not.toHaveBeenCalled();
    process.off("unhandledRejection", unhandled);
  });

  it("sets resourceId to null if resolver throws an error", async () => {
    const req = {
      user: { id: "u", tenantId: "t" },
      tenantId: "t",
      get: () => "a",
    };
    const res = makeRes();
    const badResolver = () => {
      throw new Error("Resolver failed");
    };
    recordAudit("CREATE", "Role", { resolveResourceId: badResolver })(req, res, jest.fn());
    res._finish();
    await Promise.resolve();
    expect(auditService.logAction).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: null, action: "CREATE" }),
    );
  });
});

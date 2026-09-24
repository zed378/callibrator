/**
 * Tests for abac middleware
 */
const { abac } = require("../../middlewares/abac.middleware");
const tenantService = require("../../services/tenant.service");
const RolesService = require("../../services/roles.service");

describe("abac middleware", () => {
  let req, res, next;
  let spyGetTenant, spyMatrix;

  beforeEach(() => {
    spyGetTenant = jest.spyOn(tenantService, "getTenantByIdForMiddleware").mockImplementation(() => {});
    spyMatrix = jest.spyOn(RolesService, "getRolePermissionsMatrix").mockImplementation(() => {});

    req = {
      user: {
        id: "user-123",
        tenantId: "tenant-123",
        role: { id: "role-123", name: "TENANT_ADMIN" },
      },
      params: {},
      body: {},
      query: {},
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should return 401 if user or role is missing", async () => {
    req.user = null;
    const middleware = abac(["tenant:read"]);
    await middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("should bypass check for super admins", async () => {
    req.user.role.name = "SUPER_ADMIN";
    const middleware = abac(["tenant:read"]);
    await middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.abacContext.allowed).toBe(true);
  });

  it("should handle checkTenant and match tenant ID", async () => {
    req.params.tenantId = "tenant-123";
    spyGetTenant.mockResolvedValue({ id: "tenant-123" });
    spyMatrix.mockResolvedValue({
      management: ["read"],
    });

    const middleware = abac(["tenant:read"], { checkTenant: true });
    await middleware(req, res, next);

    expect(spyGetTenant).toHaveBeenCalledWith("tenant-123");
    expect(next).toHaveBeenCalled();
  });

  // AZ-04. This test used to read "should return 403 if tenant ID does not
  // match" and asserted `expect(res.status).toHaveBeenCalledWith(403)` — it
  // encoded the tenant-membership oracle as the specification. A tenant that
  // exists but is not the caller's must be indistinguishable from one that
  // does not exist.
  it("should return 404 (not 403) if tenant ID belongs to another tenant", async () => {
    req.params.tenantId = "tenant-999";
    spyGetTenant.mockResolvedValue({ id: "tenant-999" });

    const middleware = abac(["tenant:read"], { checkTenant: true });
    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      status: 404,
      message: "Tenant not found",
      data: null,
    });
    expect(next).not.toHaveBeenCalled();
    // The permission matrix is never consulted for a foreign tenant.
    expect(spyMatrix).not.toHaveBeenCalled();
  });

  it("should return 404 if tenant not found", async () => {
    req.params.tenantId = "tenant-999";
    spyGetTenant.mockResolvedValue(null);

    const middleware = abac(["tenant:read"], { checkTenant: true });
    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("should handle checkSelf when user id matches resource owner id", async () => {
    req.params.userId = "user-123";
    const middleware = abac(["user:update"], { checkSelf: true });
    await middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.abacContext.reason).toBe("self");
  });

  it("should enforce matrix permissions and return 403 on failure", async () => {
    spyMatrix.mockResolvedValue({
      management: [],
    });

    const middleware = abac(["tenant:write"]);
    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  // A-13 / AZ-04 DoD. This test used to assert a hand-rolled 500 whose body
  // carried the raw `error.message` ("Database connection failed") to the
  // client. The error now goes to the global error handler, which sanitizes it.
  it("should hand a thrown error to next() instead of leaking its message", async () => {
    const err = new Error("Database connection failed");
    spyMatrix.mockRejectedValue(err);

    const middleware = abac(["tenant:read"]);
    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(err);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it("should handle checkSelf with non-self userId from body", async () => {
    req.params.userId = undefined;
    req.body.userId = "other-user-999";
    const middleware = abac(["user:update"], { checkSelf: true });
    spyMatrix.mockResolvedValue({
      management: ["write"],
    });

    await middleware(req, res, next);

    // Should NOT short-circuit as self (user.id !== body.userId)
    // Should fall through to permission enforcement
    expect(next).toHaveBeenCalled();
    expect(req.abacContext.allowed).toBe(true);
    expect(req.abacContext.reason).toBeUndefined();
  });

  it("should fall through permission check when checkSelf is true but resourceOwnerId does not match user.id", async () => {
    req.params.userId = "other-user-999";
    const middleware = abac(["user:update"], { checkSelf: true });
    spyMatrix.mockResolvedValue({
      management: ["write"],
    });

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.abacContext.allowed).toBe(true);
  });

  it("should handle checkTenant with no resourceTenantId provided", async () => {
    req.params.tenantId = undefined;
    spyGetTenant.mockClear();
    spyMatrix.mockResolvedValue({
      management: ["read"],
    });

    const middleware = abac(["tenant:read"], { checkTenant: true });
    await middleware(req, res, next);

    // Should skip tenant lookup since no resourceTenantId
    expect(spyGetTenant).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
    expect(req.abacContext.allowed).toBe(true);
  });

  it("should handle checkSelf via req.params.id", async () => {
    req.params.userId = undefined;
    req.params.id = "user-123";
    const middleware = abac(["user:update"], { checkSelf: true });
    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.abacContext.reason).toBe("self");
  });

  it("should hand a message-less rejection to next() unchanged", async () => {
    const rejection = {};
    spyMatrix.mockRejectedValue(rejection);

    const middleware = abac(["tenant:read"]);
    await middleware(req, res, next);

    expect(next).toHaveBeenCalledWith(rejection);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("should return 401 when user exists but role is missing", async () => {
    req.user.role = undefined;
    const middleware = abac(["tenant:read"]);
    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("should bypass check for SUPERADMIN role", async () => {
    req.user.role.name = "SUPERADMIN";
    const middleware = abac(["tenant:read"]);
    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.abacContext.allowed).toBe(true);
    expect(req.abacContext.reason).toBe("SUPER_ADMIN bypass");
  });

  it("should handle permissions when passed as a string", async () => {
    spyMatrix.mockResolvedValue({
      management: ["read"],
    });
    const middleware = abac("tenant:read");
    await middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  // A-63: this test used to assert that a QUERY `userId` naming the caller
  // earned the self bypass. Ownership now comes from the path only — a query
  // or body value is caller-chosen and need not be the row the handler edits.
  it("does not treat a query or body userId naming the caller as self (A-63)", async () => {
    req.params = {};
    req.query.userId = "user-123";
    req.body.userId = "user-123";
    spyMatrix.mockResolvedValue({ management: [] });
    const middleware = abac(["user:update"], { checkSelf: true });
    await middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
    expect(req.abacContext).toBeUndefined();
  });

  it("should fall back to Management matrix key if management is missing", async () => {
    spyMatrix.mockResolvedValue({
      Management: ["read"],
    });
    const middleware = abac(["tenant:read"]);
    await middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("should allow read action if only write permission is present in matrix", async () => {
    spyMatrix.mockResolvedValue({
      management: ["write"],
    });
    const middleware = abac(["tenant:read"]);
    await middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("should deny with 403 when the matrix has neither management key", async () => {
    // Fail-closed: a role whose matrix carries no management menu at all has
    // no tenant-admin capability.
    spyMatrix.mockResolvedValue({ Home: ["read", "write"] });
    const middleware = abac(["tenant:read"]);
    await middleware(req, res, next);

    // In-tenant permission failure: 403 is CORRECT and stays 403. Only the
    // body changed — the ad-hoc `required` key moved to the log and the body
    // is the house envelope.
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      status: 403,
      message: "Forbidden: Insufficient permissions",
      data: null,
    });
    expect(next).not.toHaveBeenCalled();
  });

  describe("AZ-04 — tenant isolation refusals are indistinguishable", () => {
    const { logger } = require("../../middlewares/activityLog.middleware");

    const refuse = async (tenantLookupResult) => {
      const r = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };
      const n = jest.fn();
      spyGetTenant.mockResolvedValue(tenantLookupResult);
      const rq = {
        user: {
          id: "user-123",
          tenantId: "tenant-123",
          role: { id: "role-123", name: "TENANT_ADMIN" },
        },
        params: { tenantId: "tenant-999" },
        body: {},
        query: {},
      };
      await abac(["tenant:read"], { checkTenant: true })(rq, r, n);
      expect(n).not.toHaveBeenCalled();
      return {
        status: r.status.mock.calls[0][0],
        body: JSON.stringify(r.json.mock.calls[0][0]),
      };
    };

    it("a foreign tenant id and a non-existent tenant id produce byte-identical responses", async () => {
      const foreign = await refuse({ id: "tenant-999" });
      const missing = await refuse(null);

      expect(foreign.status).toBe(404);
      expect(missing.status).toBe(404);
      expect(foreign.body).toBe(missing.body);
      expect(foreign.body).toBe(
        '{"success":false,"status":404,"message":"Tenant not found","data":null}',
      );
    });

    it("logs the reason against the request id, not in the response", async () => {
      const warn = jest.spyOn(logger, "warn").mockImplementation(() => {});
      req.requestId = "req-abc";
      req.params.tenantId = "tenant-999";
      spyGetTenant.mockResolvedValue({ id: "tenant-999" });

      await abac(["tenant:read"], { checkTenant: true })(req, res, next);

      expect(warn).toHaveBeenCalledWith(
        "abac: tenant isolation refusal",
        expect.objectContaining({
          requestId: "req-abc",
          reason: "cross-tenant",
          resourceTenantId: "tenant-999",
          callerTenantId: "tenant-123",
          userId: "user-123",
        }),
      );
      const body = JSON.stringify(res.json.mock.calls[0][0]);
      expect(body).not.toMatch(/cross-tenant|different tenant/);
    });

    it("logs 'unknown' when the request carries no id, and 'no-such-tenant' for a missing tenant", async () => {
      const warn = jest.spyOn(logger, "warn").mockImplementation(() => {});
      req.params.tenantId = "tenant-404";
      spyGetTenant.mockResolvedValue(null);

      await abac(["tenant:read"], { checkTenant: true })(req, res, next);

      expect(warn).toHaveBeenCalledWith(
        "abac: tenant isolation refusal",
        expect.objectContaining({
          requestId: "unknown",
          reason: "no-such-tenant",
        }),
      );
    });

    it("an in-tenant permission failure is 403, not 404, and logs what was required", async () => {
      const warn = jest.spyOn(logger, "warn").mockImplementation(() => {});
      req.requestId = "req-perm";
      req.params.tenantId = "tenant-123";
      spyGetTenant.mockResolvedValue({ id: "tenant-123" });
      spyMatrix.mockResolvedValue({ management: [] });

      // A single string permission exercises the non-array normalization.
      await abac("tenant:update", { checkTenant: true })(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.status).not.toHaveBeenCalledWith(404);
      expect(warn).toHaveBeenCalledWith(
        "abac: permission refusal",
        expect.objectContaining({
          requestId: "req-perm",
          required: ["tenant:update"],
          requiredAction: "write",
        }),
      );
      expect(next).not.toHaveBeenCalled();
    });
  });
});

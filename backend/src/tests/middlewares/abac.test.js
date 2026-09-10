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

  it("should return 403 if tenant ID does not match", async () => {
    req.params.tenantId = "tenant-999";
    spyGetTenant.mockResolvedValue({ id: "tenant-999" });

    const middleware = abac(["tenant:read"], { checkTenant: true });
    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
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

  it("should return 500 when an error is thrown in the middleware", async () => {
    spyMatrix.mockRejectedValue(new Error("Database connection failed"));

    const middleware = abac(["tenant:read"]);
    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: "Database connection failed",
      })
    );
    expect(next).not.toHaveBeenCalled();
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

  it("should return 500 with fallback message when error has no message property", async () => {
    spyMatrix.mockRejectedValue({});

    const middleware = abac(["tenant:read"]);
    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: "Internal Server Error",
      })
    );
    expect(next).not.toHaveBeenCalled();
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

  it("should handle checkSelf when userId is in query params", async () => {
    req.query.userId = "user-123";
    const middleware = abac(["user:update"], { checkSelf: true });
    await middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.abacContext.reason).toBe("self");
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

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "Forbidden: Insufficient permissions",
      required: ["tenant:read"],
    });
    expect(next).not.toHaveBeenCalled();
  });
});

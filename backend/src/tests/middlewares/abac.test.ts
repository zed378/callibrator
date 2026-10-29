/**
 * Tests for abac middleware
 */
import type { Request, Response } from "express";
import { abac } from "../../middlewares/abac.middleware";
import tenantService from "../../services/tenant.service";
import RolesService from "../../services/roles.service";

interface MockUser {
  id: string;
  tenantId: string;
  role?: { id?: string; name?: string } | undefined;
}

interface MockReq {
  user?: MockUser | null | undefined;
  params: Record<string, string | undefined>;
  body: Record<string, unknown>;
  query: Record<string, unknown>;
  abacContext?: { allowed?: boolean; reason?: string } | undefined;
  requestId?: string | undefined;
}

interface MockRes {
  status: jest.Mock<MockRes, [number?]>;
  json: jest.Mock<MockRes, [unknown?]>;
}

describe("abac middleware", () => {
  let req: MockReq;
  let res: MockRes;
  let next: jest.Mock;
  let spyGetTenant: jest.SpyInstance;
  let spyMatrix: jest.SpyInstance;

  beforeEach(() => {
    spyGetTenant = jest.spyOn(tenantService, "getTenantByIdForMiddleware").mockImplementation(() => Promise.resolve(null));
    spyMatrix = jest.spyOn(RolesService, "getRolePermissionsMatrix").mockImplementation(() => Promise.resolve(undefined as unknown as Record<string, (string | undefined)[]>));

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
      status: jest.fn<MockRes, [number?]>(),
      json: jest.fn<MockRes, [unknown?]>(),
    };
    res.status.mockReturnValue(res);
    res.json.mockReturnValue(res);
    next = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should return 401 if user or role is missing", async () => {
    req.user = null;
    const middleware = abac(["tenant:read"]);
    await middleware(req as unknown as Request, res as unknown as Response, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("should bypass check for super admins", async () => {
    if (req.user?.role) {
      req.user.role.name = "SUPER_ADMIN";
    }
    const middleware = abac(["tenant:read"]);
    await middleware(req as unknown as Request, res as unknown as Response, next);
    expect(next).toHaveBeenCalled();
    expect(req.abacContext?.allowed).toBe(true);
  });

  it("should handle checkTenant and match tenant ID", async () => {
    req.params["tenantId"] = "tenant-123";
    spyGetTenant.mockResolvedValue({ id: "tenant-123" });
    spyMatrix.mockResolvedValue({
      management: ["read"],
    });

    const middleware = abac(["tenant:read"], { checkTenant: true });
    await middleware(req as unknown as Request, res as unknown as Response, next);

    expect(spyGetTenant).toHaveBeenCalledWith("tenant-123");
    expect(next).toHaveBeenCalled();
  });

  // AZ-04. This test used to read "should return 403 if tenant ID does not
  // match" and asserted `expect(res.status).toHaveBeenCalledWith(403)` — it
  // encoded the tenant-membership oracle as the specification. A tenant that
  // exists but is not the caller's must be indistinguishable from one that
  // does not exist.
  it("should return 404 (not 403) if tenant ID belongs to another tenant", async () => {
    req.params["tenantId"] = "tenant-999";
    spyGetTenant.mockResolvedValue({ id: "tenant-999" });

    const middleware = abac(["tenant:read"], { checkTenant: true });
    await middleware(req as unknown as Request, res as unknown as Response, next);

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
    req.params["tenantId"] = "tenant-999";
    spyGetTenant.mockResolvedValue(null);

    const middleware = abac(["tenant:read"], { checkTenant: true });
    await middleware(req as unknown as Request, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("should handle checkSelf when user id matches resource owner id", async () => {
    req.params["userId"] = "user-123";
    const middleware = abac(["user:update"], { checkSelf: true });
    await middleware(req as unknown as Request, res as unknown as Response, next);
    expect(next).toHaveBeenCalled();
    expect(req.abacContext?.reason).toBe("self");
  });

  it("should enforce matrix permissions and return 403 on failure", async () => {
    spyMatrix.mockResolvedValue({
      management: [],
    });

    const middleware = abac(["tenant:write"]);
    await middleware(req as unknown as Request, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  // A-13 / AZ-04 DoD. This test used to assert a hand-rolled 500 whose body
  // carried the raw `error.message` ("Database connection failed") to the
  // client. The error now goes to the global error handler, which sanitizes it.
  it("should hand a thrown error to next() instead of leaking its message", async () => {
    const err = new Error("Database connection failed");
    spyMatrix.mockRejectedValue(err);

    const middleware = abac(["tenant:read"]);
    await middleware(req as unknown as Request, res as unknown as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(err);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it("should handle checkSelf with non-self userId from body", async () => {
    req.params["userId"] = undefined;
    req.body["userId"] = "other-user-999";
    const middleware = abac(["user:update"], { checkSelf: true });
    spyMatrix.mockResolvedValue({
      management: ["write"],
    });

    await middleware(req as unknown as Request, res as unknown as Response, next);

    // Should NOT short-circuit as self (user.id !== body.userId)
    // Should fall through to permission enforcement
    expect(next).toHaveBeenCalled();
    expect(req.abacContext?.allowed).toBe(true);
    expect(req.abacContext?.reason).toBeUndefined();
  });

  it("should fall through permission check when checkSelf is true but resourceOwnerId does not match user.id", async () => {
    req.params["userId"] = "other-user-999";
    const middleware = abac(["user:update"], { checkSelf: true });
    spyMatrix.mockResolvedValue({
      management: ["write"],
    });

    await middleware(req as unknown as Request, res as unknown as Response, next);

    expect(next).toHaveBeenCalled();
    expect(req.abacContext?.allowed).toBe(true);
  });

  it("should handle checkTenant with no resourceTenantId provided", async () => {
    req.params["tenantId"] = undefined;
    spyGetTenant.mockClear();
    spyMatrix.mockResolvedValue({
      management: ["read"],
    });

    const middleware = abac(["tenant:read"], { checkTenant: true });
    await middleware(req as unknown as Request, res as unknown as Response, next);

    // Should skip tenant lookup since no resourceTenantId
    expect(spyGetTenant).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
    expect(req.abacContext?.allowed).toBe(true);
  });

  it("should handle checkSelf via req.params.id", async () => {
    req.params["userId"] = undefined;
    req.params["id"] = "user-123";
    const middleware = abac(["user:update"], { checkSelf: true });
    await middleware(req as unknown as Request, res as unknown as Response, next);

    expect(next).toHaveBeenCalled();
    expect(req.abacContext?.reason).toBe("self");
  });

  it("should hand a message-less rejection to next() unchanged", async () => {
    const rejection = new Error("unknown rejection");
    spyMatrix.mockRejectedValue(rejection);

    const middleware = abac(["tenant:read"]);
    await middleware(req as unknown as Request, res as unknown as Response, next);

    expect(next).toHaveBeenCalledWith(rejection);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("should return 401 when user exists but role is missing", async () => {
    if (req.user) {
      req.user.role = undefined;
    }
    const middleware = abac(["tenant:read"]);
    await middleware(req as unknown as Request, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("should bypass check for SUPERADMIN role", async () => {
    if (req.user?.role) {
      req.user.role.name = "SUPERADMIN";
    }
    const middleware = abac(["tenant:read"]);
    await middleware(req as unknown as Request, res as unknown as Response, next);

    expect(next).toHaveBeenCalled();
    expect(req.abacContext?.allowed).toBe(true);
    expect(req.abacContext?.reason).toBe("SUPER_ADMIN bypass");
  });

  it("should handle permissions when passed as a string", async () => {
    spyMatrix.mockResolvedValue({
      management: ["read"],
    });
    const middleware = abac("tenant:read");
    await middleware(req as unknown as Request, res as unknown as Response, next);
    expect(next).toHaveBeenCalled();
  });

  // A-63: this test used to assert that a QUERY `userId` naming the caller
  // earned the self bypass. Ownership now comes from the path only — a query
  // or body value is caller-chosen and need not be the row the handler edits.
  it("does not treat a query or body userId naming the caller as self (A-63)", async () => {
    req.params = {};
    req.query["userId"] = "user-123";
    req.body["userId"] = "user-123";
    spyMatrix.mockResolvedValue({ management: [] });
    const middleware = abac(["user:update"], { checkSelf: true });
    await middleware(req as unknown as Request, res as unknown as Response, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
    expect(req.abacContext).toBeUndefined();
  });

  it("should fall back to Management matrix key if management is missing", async () => {
    spyMatrix.mockResolvedValue({
      Management: ["read"],
    });
    const middleware = abac(["tenant:read"]);
    await middleware(req as unknown as Request, res as unknown as Response, next);
    expect(next).toHaveBeenCalled();
  });

  it("should allow read action if only write permission is present in matrix", async () => {
    spyMatrix.mockResolvedValue({
      management: ["write"],
    });
    const middleware = abac(["tenant:read"]);
    await middleware(req as unknown as Request, res as unknown as Response, next);
    expect(next).toHaveBeenCalled();
  });

  it("should deny with 403 when the matrix has neither management key", async () => {
    // Fail-closed: a role whose matrix carries no management menu at all has
    // no tenant-admin capability.
    spyMatrix.mockResolvedValue({ Home: ["read", "write"] });
    const middleware = abac(["tenant:read"]);
    await middleware(req as unknown as Request, res as unknown as Response, next);

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
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- test module loaded in describe
    const { logger } = require("../../middlewares/activityLog.middleware") as { logger: { warn: jest.Mock } };

    const refuse = async (tenantLookupResult: unknown) => {
      const r: MockRes = {
        status: jest.fn<MockRes, [number?]>(),
        json: jest.fn<MockRes, [unknown?]>(),
      };
      r.status.mockReturnValue(r);
      r.json.mockReturnValue(r);
      const n = jest.fn();
      spyGetTenant.mockResolvedValue(tenantLookupResult);
      const rq: MockReq = {
        user: {
          id: "user-123",
          tenantId: "tenant-123",
          role: { id: "role-123", name: "TENANT_ADMIN" },
        },
        params: { tenantId: "tenant-999" },
        body: {},
        query: {},
      };
      await abac(["tenant:read"], { checkTenant: true })(rq as unknown as Request, r as unknown as Response, n);
      expect(n).not.toHaveBeenCalled();
      const statusCall = r.status.mock.calls[0] as [number] | undefined;
      const jsonCall = r.json.mock.calls[0] as [unknown] | undefined;
      return {
        status: statusCall?.[0],
        body: JSON.stringify(jsonCall?.[0]),
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
      const warn = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
      req.requestId = "req-abc";
      req.params["tenantId"] = "tenant-999";
      spyGetTenant.mockResolvedValue({ id: "tenant-999" });

      await abac(["tenant:read"], { checkTenant: true })(req as unknown as Request, res as unknown as Response, next);

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
      const jsonCall = res.json.mock.calls[0] as [unknown] | undefined;
      const body = JSON.stringify(jsonCall?.[0]);
      expect(body).not.toMatch(/cross-tenant|different tenant/);
    });

    it("logs 'unknown' when the request carries no id, and 'no-such-tenant' for a missing tenant", async () => {
      const warn = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
      req.params["tenantId"] = "tenant-404";
      spyGetTenant.mockResolvedValue(null);

      await abac(["tenant:read"], { checkTenant: true })(req as unknown as Request, res as unknown as Response, next);

      expect(warn).toHaveBeenCalledWith(
        "abac: tenant isolation refusal",
        expect.objectContaining({
          requestId: "unknown",
          reason: "no-such-tenant",
        }),
      );
    });

    it("an in-tenant permission failure is 403, not 404, and logs what was required", async () => {
      const warn = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
      req.requestId = "req-perm";
      req.params["tenantId"] = "tenant-123";
      spyGetTenant.mockResolvedValue({ id: "tenant-123" });
      spyMatrix.mockResolvedValue({ management: [] });

      // A single string permission exercises the non-array normalization.
      await abac("tenant:update", { checkTenant: true })(req as unknown as Request, res as unknown as Response, next);

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

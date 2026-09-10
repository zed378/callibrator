/**
 * Tests for auth middleware
 */

jest.mock("../../utils/jwt.util", () => ({
  verifyAccessToken: jest.fn(),
}));

jest.mock("../../utils/response.util", () => ({
  unauthorized: jest.fn(),
  forbidden: jest.fn(),
}));

jest.mock("../../services/auth.service", () => ({
  getAuthUserWithTenant: jest.fn(),
}));

jest.mock("../../services/tenant.service", () => ({
  getTenantByCodeForMiddleware: jest.fn(),
  getTenantByIdForMiddleware: jest.fn(),
}));

jest.mock("../../services/apiKey.service", () => ({
  verifyApiKey: jest.fn(),
}));

jest.mock("../../constants", () => ({
  ROLE_NAMES: { SUPER_ADMIN: "SUPER_ADMIN" },
}));

jest.mock("../../middlewares/tenantContext.middleware", () => ({
  tenantContextMiddleware: jest.fn((req, res, next) => next()),
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: {
    error: jest.fn(),
  },
}));

const { verifyAccessToken } = require("../../utils/jwt.util");
const { unauthorized, forbidden } = require("../../utils/response.util");
const authService = require("../../services/auth.service");
const tenantService = require("../../services/tenant.service");
const apiKeyService = require("../../services/apiKey.service");
const {
  auth,
  optionalAuth,
  denyApiKey,
  superAdminOnly,
} = require("../../middlewares/auth.middleware");

describe("auth middleware", () => {
  let req;
  let res;
  let next;

  beforeEach(() => {
    jest.clearAllMocks();

    next = jest.fn();

    req = {
      headers: {},
      user: null,
      tenantId: null,
      tenant: null,
      token: null,
    };

    res = {
      locals: {},
    };

    unauthorized.mockReturnValue(undefined);
    forbidden.mockReturnValue(undefined);
  });

  describe("auth", () => {
    it("should reject request without authorization header", async () => {
      await auth(req, res, next);

      expect(unauthorized).toHaveBeenCalled();
    });

    it("should reject request with invalid token", async () => {
      req.headers.authorization = "Bearer invalid-token";
      verifyAccessToken.mockImplementation(() => {
        throw new Error("Invalid token");
      });

      await auth(req, res, next);

      expect(unauthorized).toHaveBeenCalled();
    });

    it("should reject when user not found", async () => {
      req.headers.authorization = "Bearer valid-token";
      verifyAccessToken.mockReturnValue({ id: "user-123" });
      authService.getAuthUserWithTenant.mockResolvedValue(null);

      await auth(req, res, next);

      expect(unauthorized).toHaveBeenCalled();
    });

    it("should reject an MFA-pending token (mfaRequired) as an access token", async () => {
      req.headers.authorization = "Bearer mfa-pending-token";
      verifyAccessToken.mockReturnValue({ id: "user-123", mfaRequired: true });

      await auth(req, res, next);

      expect(unauthorized).toHaveBeenCalledWith(res, "MFA verification required");
      // Must short-circuit before loading the user / granting access.
      expect(authService.getAuthUserWithTenant).not.toHaveBeenCalled();
    });

    it("should reject banned user", async () => {
      req.headers.authorization = "Bearer valid-token";
      verifyAccessToken.mockReturnValue({ id: "user-123" });
      authService.getAuthUserWithTenant.mockResolvedValue({
        id: "user-123",
        isActive: false,
      });

      await auth(req, res, next);

      expect(forbidden).toHaveBeenCalled();
    });

    it("should reject suspended user", async () => {
      req.headers.authorization = "Bearer valid-token";
      verifyAccessToken.mockReturnValue({ id: "user-123" });
      authService.getAuthUserWithTenant.mockResolvedValue({
        id: "user-123",
        isActive: true,
        status: "SUSPENDED",
      });

      await auth(req, res, next);

      expect(forbidden).toHaveBeenCalled();
    });

    it("should attach user to request on success", async () => {
      const mockUser = {
        id: "user-123",
        tenantId: "tenant-123",
        isActive: true,
        status: "ACTIVE",
        role: { name: "TENANT_ADMIN" },
        tenant: { id: "tenant-123", status: "ACTIVE" },
      };

      req.headers.authorization = "Bearer valid-token";
      verifyAccessToken.mockReturnValue({ id: "user-123" });
      authService.getAuthUserWithTenant.mockResolvedValue(mockUser);

      await auth(req, res, next);

      expect(req.user).toEqual(mockUser);
      expect(req.tenantId).toBe("tenant-123");
      expect(req.tenant).toEqual(mockUser.tenant);
    });

    it("should allow super admin to override tenant via x-tenant-code", async () => {
      const mockUser = {
        id: "user-123",
        tenantId: "tenant-123",
        isActive: true,
        status: "ACTIVE",
        role: { name: "SUPER_ADMIN" },
        tenant: { id: "tenant-123", status: "ACTIVE" },
      };

      req.headers.authorization = "Bearer valid-token";
      req.headers["x-tenant-code"] = "override-tenant";
      verifyAccessToken.mockReturnValue({ id: "user-123" });
      authService.getAuthUserWithTenant.mockResolvedValue(mockUser);
      tenantService.getTenantByCodeForMiddleware.mockResolvedValue({
        id: "override-tenant-id",
        status: "ACTIVE",
      });

      await auth(req, res, next);

      expect(req.tenantId).toBe("override-tenant-id");
    });

    it("should handle API key authentication", async () => {
      const mockKey = {
        id: "api-key-123",
        tenantId: "tenant-123",
        tenant: { id: "tenant-123", status: "ACTIVE" },
        scopes: ["read", "write"],
      };

      req.headers.authorization = "ApiKey test-api-key";
      apiKeyService.verifyApiKey.mockResolvedValue(mockKey);

      await auth(req, res, next);

      expect(req.user.isApiKey).toBe(true);
      expect(req.user.apiKeyScopes).toEqual(["read", "write"]);
    });

    it("should reject invalid API key", async () => {
      req.headers.authorization = "ApiKey invalid-key";
      apiKeyService.verifyApiKey.mockResolvedValue(null);

      await auth(req, res, next);

      expect(unauthorized).toHaveBeenCalled();
    });

    it("should reject API key with suspended tenant", async () => {
      const mockKey = {
        id: "api-key-123",
        tenantId: "tenant-123",
        tenant: { id: "tenant-123", status: "suspended" },
        scopes: ["read"],
      };

      req.headers.authorization = "ApiKey test-api-key";
      apiKeyService.verifyApiKey.mockResolvedValue(mockKey);

      await auth(req, res, next);

      expect(forbidden).toHaveBeenCalled();
      expect(forbidden).toHaveBeenCalledWith(
        expect.anything(),
        "Tenant account is suspended",
      );
    });

    it("should reject API key with deleted tenant", async () => {
      const mockKey = {
        id: "api-key-123",
        tenantId: "tenant-123",
        tenant: { id: "tenant-123", status: "deleted" },
        scopes: ["read"],
      };

      req.headers.authorization = "ApiKey test-api-key";
      apiKeyService.verifyApiKey.mockResolvedValue(mockKey);

      await auth(req, res, next);

      expect(forbidden).toHaveBeenCalled();
    });

    it("should handle API key without tenant object", async () => {
      const mockKey = {
        id: "api-key-123",
        tenantId: "tenant-123",
        scopes: ["read", "write"],
      };

      req.headers.authorization = "ApiKey test-api-key";
      apiKeyService.verifyApiKey.mockResolvedValue(mockKey);

      await auth(req, res, next);

      expect(req.user.isApiKey).toBe(true);
      expect(req.tenantId).toBe("tenant-123");
    });

    it("should handle API key with null tenant", async () => {
      const mockKey = {
        id: "api-key-123",
        tenantId: "tenant-123",
        tenant: null,
        scopes: [],
      };

      req.headers.authorization = "ApiKey test-api-key";
      apiKeyService.verifyApiKey.mockResolvedValue(mockKey);

      await auth(req, res, next);

      expect(req.user.isApiKey).toBe(true);
    });

    it("should accept an API key whose tenant has no status field", async () => {
      const mockKey = {
        id: "api-key-123",
        tenantId: "tenant-123",
        tenant: { id: "tenant-123" },
        scopes: ["read"],
      };

      req.headers.authorization = "ApiKey test-api-key";
      apiKeyService.verifyApiKey.mockResolvedValue(mockKey);

      await auth(req, res, next);

      // A missing status normalizes to "" — neither suspended nor deleted.
      expect(forbidden).not.toHaveBeenCalled();
      expect(req.user.isApiKey).toBe(true);
      expect(req.user.role).toEqual({ id: null, name: "API_KEY" });
      expect(next).toHaveBeenCalled();
    });

    it("should handle API key with undefined scopes", async () => {
      const mockKey = {
        id: "api-key-123",
        tenantId: "tenant-123",
        tenant: { id: "tenant-123", status: "ACTIVE" },
        scopes: undefined,
      };

      req.headers.authorization = "ApiKey test-api-key";
      apiKeyService.verifyApiKey.mockResolvedValue(mockKey);

      await auth(req, res, next);

      expect(req.user.apiKeyScopes).toEqual([]);
    });

    it("should attach tenant context when user has no tenant", async () => {
      const mockUser = {
        id: "user-123",
        tenantId: null,
        isActive: true,
        status: "ACTIVE",
        role: { name: "TENANT_ADMIN" },
        tenant: null,
      };

      req.headers.authorization = "Bearer valid-token";
      verifyAccessToken.mockReturnValue({ id: "user-123" });
      authService.getAuthUserWithTenant.mockResolvedValue(mockUser);

      await auth(req, res, next);

      expect(req.user).toEqual(mockUser);
      expect(req.tenantId).toBeNull();
    });

    it("should reject user with suspended tenant", async () => {
      const mockUser = {
        id: "user-123",
        tenantId: "tenant-123",
        isActive: true,
        status: "ACTIVE",
        role: { name: "TENANT_ADMIN" },
        tenant: { id: "tenant-123", status: "suspended" },
      };

      req.headers.authorization = "Bearer valid-token";
      verifyAccessToken.mockReturnValue({ id: "user-123" });
      authService.getAuthUserWithTenant.mockResolvedValue(mockUser);

      await auth(req, res, next);

      expect(forbidden).toHaveBeenCalled();
    });

    it("should reject user with deleted tenant", async () => {
      const mockUser = {
        id: "user-123",
        tenantId: "tenant-123",
        isActive: true,
        status: "ACTIVE",
        role: { name: "TENANT_ADMIN" },
        tenant: { id: "tenant-123", status: "deleted" },
      };

      req.headers.authorization = "Bearer valid-token";
      verifyAccessToken.mockReturnValue({ id: "user-123" });
      authService.getAuthUserWithTenant.mockResolvedValue(mockUser);

      await auth(req, res, next);

      expect(forbidden).toHaveBeenCalled();
    });

    it("should reject user with SUSPENDED tenant status (uppercase)", async () => {
      const mockUser = {
        id: "user-123",
        tenantId: "tenant-123",
        isActive: true,
        status: "ACTIVE",
        role: { name: "TENANT_ADMIN" },
        tenant: { id: "tenant-123", status: "SUSPENDED" },
      };

      req.headers.authorization = "Bearer valid-token";
      verifyAccessToken.mockReturnValue({ id: "user-123" });
      authService.getAuthUserWithTenant.mockResolvedValue(mockUser);

      await auth(req, res, next);

      expect(forbidden).toHaveBeenCalled();
    });

    it("should reject user with DELETED tenant status (uppercase)", async () => {
      const mockUser = {
        id: "user-123",
        tenantId: "tenant-123",
        isActive: true,
        status: "ACTIVE",
        role: { name: "TENANT_ADMIN" },
        tenant: { id: "tenant-123", status: "DELETED" },
      };

      req.headers.authorization = "Bearer valid-token";
      verifyAccessToken.mockReturnValue({ id: "user-123" });
      authService.getAuthUserWithTenant.mockResolvedValue(mockUser);

      await auth(req, res, next);

      expect(forbidden).toHaveBeenCalled();
    });

    it("should allow super admin to override tenant via x-tenant-id", async () => {
      const mockUser = {
        id: "user-123",
        tenantId: "tenant-123",
        isActive: true,
        status: "ACTIVE",
        role: { name: "SUPER_ADMIN" },
        tenant: { id: "tenant-123", status: "ACTIVE" },
      };

      req.headers.authorization = "Bearer valid-token";
      req.headers["x-tenant-id"] = "override-tenant-id-header";
      verifyAccessToken.mockReturnValue({ id: "user-123" });
      authService.getAuthUserWithTenant.mockResolvedValue(mockUser);
      tenantService.getTenantByIdForMiddleware.mockResolvedValue({
        id: "override-tenant-id-header",
        status: "ACTIVE",
      });

      await auth(req, res, next);

      expect(req.tenantId).toBe("override-tenant-id-header");
    });

    it("should ignore invalid tenant code override for super admin", async () => {
      const mockUser = {
        id: "user-123",
        tenantId: "tenant-123",
        isActive: true,
        status: "ACTIVE",
        role: { name: "SUPER_ADMIN" },
        tenant: { id: "tenant-123", status: "ACTIVE" },
      };

      req.headers.authorization = "Bearer valid-token";
      req.headers["x-tenant-code"] = "nonexistent-tenant";
      verifyAccessToken.mockReturnValue({ id: "user-123" });
      authService.getAuthUserWithTenant.mockResolvedValue(mockUser);
      tenantService.getTenantByCodeForMiddleware.mockResolvedValue(null);

      await auth(req, res, next);

      expect(req.tenantId).toBe("tenant-123");
    });

    it("should ignore inactive tenant id override for super admin", async () => {
      const mockUser = {
        id: "user-123",
        tenantId: "tenant-123",
        isActive: true,
        status: "ACTIVE",
        role: { name: "SUPER_ADMIN" },
        tenant: { id: "tenant-123", status: "ACTIVE" },
      };

      req.headers.authorization = "Bearer valid-token";
      req.headers["x-tenant-id"] = "inactive-tenant-id";
      verifyAccessToken.mockReturnValue({ id: "user-123" });
      authService.getAuthUserWithTenant.mockResolvedValue(mockUser);
      tenantService.getTenantByIdForMiddleware.mockResolvedValue({
        id: "inactive-tenant-id",
        status: "INACTIVE",
      });

      await auth(req, res, next);

      expect(req.tenantId).toBe("tenant-123");
    });

    it("should handle INACTIVE user status", async () => {
      const mockUser = {
        id: "user-123",
        tenantId: "tenant-123",
        isActive: true,
        status: "INACTIVE",
        role: { name: "TENANT_ADMIN" },
        tenant: { id: "tenant-123", status: "ACTIVE" },
      };

      req.headers.authorization = "Bearer valid-token";
      verifyAccessToken.mockReturnValue({ id: "user-123" });
      authService.getAuthUserWithTenant.mockResolvedValue(mockUser);

      await auth(req, res, next);

      expect(forbidden).toHaveBeenCalled();
    });

    it("should handle error in try-catch block", async () => {
      req.headers.authorization = "Bearer valid-token";
      verifyAccessToken.mockImplementation(() => {
        throw new Error("Token verification failed");
      });

      await auth(req, res, next);

      expect(unauthorized).toHaveBeenCalled();
    });

    it("should handle non-string role name", async () => {
      const mockUser = {
        id: "user-123",
        tenantId: "tenant-123",
        isActive: true,
        status: "ACTIVE",
        role: { name: null },
        tenant: { id: "tenant-123", status: "ACTIVE" },
      };

      req.headers.authorization = "Bearer valid-token";
      verifyAccessToken.mockReturnValue({ id: "user-123" });
      authService.getAuthUserWithTenant.mockResolvedValue(mockUser);

      await auth(req, res, next);

      expect(req.user).toEqual(mockUser);
      expect(next).toHaveBeenCalled();
    });

    it("should handle SUPERADMIN role name variant", async () => {
      const mockUser = {
        id: "user-123",
        tenantId: "tenant-123",
        isActive: true,
        status: "ACTIVE",
        role: { name: "SUPERADMIN" },
        tenant: { id: "tenant-123", status: "ACTIVE" },
      };

      req.headers.authorization = "Bearer valid-token";
      verifyAccessToken.mockReturnValue({ id: "user-123" });
      authService.getAuthUserWithTenant.mockResolvedValue(mockUser);

      await auth(req, res, next);

      expect(req.user).toEqual(mockUser);
    });

    it("should handle SUPER_ADMIN role name variant (with underscore)", async () => {
      const mockUser = {
        id: "user-123",
        tenantId: "tenant-123",
        isActive: true,
        status: "ACTIVE",
        role: { name: "SUPER_ADMIN" },
        tenant: { id: "tenant-123", status: "ACTIVE" },
      };

      req.headers.authorization = "Bearer valid-token";
      verifyAccessToken.mockReturnValue({ id: "user-123" });
      authService.getAuthUserWithTenant.mockResolvedValue(mockUser);

      await auth(req, res, next);

      expect(req.user).toEqual(mockUser);
    });
  });

  describe("optionalAuth", () => {
    it("should continue without auth when no token", async () => {
      await optionalAuth(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user).toBeNull();
    });

    it("should attach user when valid token", async () => {
      req.headers.authorization = "Bearer valid-token";
      verifyAccessToken.mockReturnValue({ id: "user-123" });
      authService.getAuthUserWithTenant.mockResolvedValue({
        id: "user-123",
        tenantId: "tenant-123",
        isActive: true,
        status: "ACTIVE",
      });

      await optionalAuth(req, res, next);

      expect(req.user).toBeDefined();
    });

    it("should continue without user when token is invalid", async () => {
      req.headers.authorization = "Bearer invalid-token";
      verifyAccessToken.mockImplementation(() => {
        throw new Error("Invalid");
      });

      await optionalAuth(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user).toBeNull();
    });

    it("should not attach a user whose status is neither ACTIVE nor INACTIVE", async () => {
      req.headers.authorization = "Bearer valid-token";
      verifyAccessToken.mockReturnValue({ id: "user-123" });
      authService.getAuthUserWithTenant.mockResolvedValue({
        id: "user-123",
        tenantId: "tenant-123",
        isActive: true,
        status: "SUSPENDED",
      });

      await optionalAuth(req, res, next);

      // optionalAuth never rejects — it just proceeds anonymously.
      expect(req.user).toBeNull();
      expect(req.tenantId).toBeNull();
      expect(next).toHaveBeenCalled();
    });

    it("should not attach an inactive user", async () => {
      req.headers.authorization = "Bearer valid-token";
      verifyAccessToken.mockReturnValue({ id: "user-123" });
      authService.getAuthUserWithTenant.mockResolvedValue({
        id: "user-123",
        tenantId: "tenant-123",
        isActive: false,
        status: "ACTIVE",
      });

      await optionalAuth(req, res, next);

      expect(req.user).toBeNull();
      expect(next).toHaveBeenCalled();
    });

    it("should not attach a user when the lookup returns nothing", async () => {
      req.headers.authorization = "Bearer valid-token";
      verifyAccessToken.mockReturnValue({ id: "user-123" });
      authService.getAuthUserWithTenant.mockResolvedValue(null);

      await optionalAuth(req, res, next);

      expect(req.user).toBeNull();
      expect(next).toHaveBeenCalled();
    });

    it("should attach a tenant-less user without setting req.tenantId", async () => {
      req.headers.authorization = "Bearer valid-token";
      verifyAccessToken.mockReturnValue({ id: "user-123" });
      authService.getAuthUserWithTenant.mockResolvedValue({
        id: "user-123",
        tenantId: null,
        isActive: true,
        status: "ACTIVE",
      });

      await optionalAuth(req, res, next);

      expect(req.user).toEqual(expect.objectContaining({ id: "user-123" }));
      expect(req.tenantId).toBeNull();
      expect(next).toHaveBeenCalled();
    });
  });

  describe("denyApiKey", () => {
    it("should deny request from API key", async () => {
      req.user = { isApiKey: true };

      denyApiKey(req, res, next);

      expect(forbidden).toHaveBeenCalled();
    });

    it("should allow normal user request", async () => {
      req.user = { isApiKey: false };

      denyApiKey(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe("superAdminOnly", () => {
    it("should deny non-super-admin", async () => {
      req.user = { role: { name: "TENANT_ADMIN" } };

      superAdminOnly(req, res, next);

      expect(forbidden).toHaveBeenCalled();
    });

    it("should allow super admin", async () => {
      req.user = { role: { name: "SUPER_ADMIN" } };

      superAdminOnly(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it("should deny when user has no role", async () => {
      req.user = {};

      superAdminOnly(req, res, next);

      expect(forbidden).toHaveBeenCalled();
    });

    it("should deny when user is null", async () => {
      req.user = null;

      superAdminOnly(req, res, next);

      expect(forbidden).toHaveBeenCalled();
    });
  });
});

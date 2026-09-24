/**
 * Tests for sso.controller.js
 */

jest.mock("../../services/sso.service", () => ({
  generateAuthnRequest: jest.fn(),
  parseAndVerifyResponse: jest.fn(),
  provisionUser: jest.fn(),
  generateOidcAuthRequest: jest.fn(),
  verifyOidcCallback: jest.fn(),
}));

jest.mock("../../services/tenant.service", () => ({
  getTenantSettings: jest.fn(),
}));

jest.mock("../../models", () => ({
  Tenants: {
    findOne: jest.fn(),
  },
  // A-60: the exchange writes the session and its audit row in one
  // transaction; the fake hands the callback a recognisable transaction.
  sequelize: {
    transaction: jest.fn(async (fn) => fn("mock-transaction")),
  },
}));

// A-60: the hand-off store. An in-memory Redis with the helper API the
// controller uses; `mockRedisUp` switches it to "unavailable", which is how
// redis.service answers when the client is not ready (set → false, getDel → null).
let mockRedisUp = true;
jest.mock("../../services/redis.service", () => {
  const mockHandoffStore = new Map();
  return {
    mockHandoffStore,
    set: jest.fn(async (key, value) => {
      if (!mockRedisUp) {
        return false;
      }
      mockHandoffStore.set(key, JSON.stringify(value));
      return true;
    }),
    getDel: jest.fn(async (key) => {
      if (!mockRedisUp || !mockHandoffStore.has(key)) {
        return null;
      }
      const raw = mockHandoffStore.get(key);
      mockHandoffStore.delete(key);
      return JSON.parse(raw);
    }),
  };
});

jest.mock("../../services/audit.service", () => ({
  logAction: jest.fn().mockResolvedValue({ id: "audit-1" }),
}));

jest.mock("../../services/rateLimiter.redis.service", () => ({
  recordAuthFailure: jest.fn().mockResolvedValue({ allowed: true }),
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

jest.mock("../../utils/jwt.util", () => ({
  generateAccessToken: jest.fn().mockReturnValue("mock-access-token"),
  generateOpaqueRefreshToken: jest.fn().mockReturnValue("mock-refresh-token"),
}));

jest.mock("../../services/session.service", () => ({
  createSession: jest.fn().mockResolvedValue({ id: "session-123" }),
}));

jest.mock("../../utils/response.util", () => ({
  success: jest.fn(),
  error: jest.fn(),
  login: jest.fn(),
}));

jest.mock("../../utils/appError.util", () => {
  class AppError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }
  return { AppError };
});

const { Tenants } = require("../../models");
const tenantService = require("../../services/tenant.service");
const ssoService = require("../../services/sso.service");
const ssoController = require("../../controllers/sso.controller");
const { success, error, login } = require("../../utils/response.util");
const redis = require("../../services/redis.service");
const auditService = require("../../services/audit.service");
const { recordAuthFailure } = require("../../services/rateLimiter.redis.service");
const { logger } = require("../../middlewares/activityLog.middleware");
const { createSession } = require("../../services/session.service");
const { generateAccessToken } = require("../../utils/jwt.util");

const CODE_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** The one-time code in a callback's redirect, or null. */
const codeFrom = (response) =>
  new URL(response.redirect.mock.calls[0][0]).searchParams.get("code");

/** Post `code` to the exchange handler; return the response mock. */
const exchange = async (code, rateLimitContext = { ip: "10.9.9.9" }) => {
  const exRes = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  await ssoController.ssoExchange(
    { body: { code }, headers: {}, rateLimitContext },
    exRes,
    jest.fn(),
  );
  return exRes;
};

describe("sso.controller", () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisUp = true;
    redis.mockHandoffStore.clear();
    req = {
      body: {},
      query: {},
      params: {},
      ip: "127.0.0.1",
      headers: { "user-agent": "mock-agent" },
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      set: jest.fn(),
      send: jest.fn(),
      redirect: jest.fn(),
    };
    next = jest.fn();

    Tenants.findOne.mockResolvedValue({ id: "tenant-1", code: "acme" });
    tenantService.getTenantSettings.mockResolvedValue({
      data: { settings: { sso_enabled: "true", sso_idp_entry_point: "https://idp.com" } },
    });
    ssoService.generateAuthnRequest.mockReturnValue("https://idp.com/redirect");
    ssoService.parseAndVerifyResponse.mockResolvedValue({ email: "user@test.com", firstName: "User", lastName: "Test" });
    ssoService.provisionUser.mockResolvedValue({ id: "user-1", email: "user@test.com" });
    ssoService.generateOidcAuthRequest.mockReturnValue("https://oidc.com/redirect");
    ssoService.verifyOidcCallback.mockResolvedValue({ email: "user@test.com", firstName: "User", lastName: "Test" });

    success.mockImplementation((response, data, meta, message, status) => {
      response.status(status || 200).json({ success: true, data, meta, message });
    });
    error.mockImplementation((response, message, status) => {
      response.status(status || 500).json({ success: false, message });
    });
  });

  describe("ssoLogin", () => {
    it("should generate redirect URL if sso is enabled and valid tenant code is provided", async () => {
      req.body = { tenantCode: "acme" };
      Tenants.findOne.mockResolvedValueOnce({ id: "tenant-1", code: "acme" });
      tenantService.getTenantSettings.mockResolvedValueOnce({
        data: { settings: { sso_enabled: "true", sso_idp_entry_point: "https://idp.com" } },
      });
      ssoService.generateAuthnRequest.mockReturnValueOnce("https://idp.com/redirect");

      await ssoController.ssoLogin(req, res, next);

      expect(success).toHaveBeenCalledWith(res, { redirectUrl: "https://idp.com/redirect" }, null, "SAML redirect URL generated", 200);
    });

    it("should call error response with 404 if tenant is not found", async () => {
      req.body = { tenantCode: "nonexistent" };
      Tenants.findOne.mockResolvedValueOnce(null);

      await ssoController.ssoLogin(req, res, next);

      expect(error).toHaveBeenCalledWith(res, "Tenant not found", 404, expect.any(String));
    });

    it("should call error response with 400 if SSO is not enabled", async () => {
      req.body = { tenantCode: "acme" };
      Tenants.findOne.mockResolvedValueOnce({ id: "tenant-1", code: "acme" });
      tenantService.getTenantSettings.mockResolvedValueOnce({
        data: { settings: { sso_enabled: "false" } },
      });

      await ssoController.ssoLogin(req, res, next);

      expect(error).toHaveBeenCalledWith(res, "SSO is not enabled for this tenant", 400, expect.any(String));
    });

    it("should call error response with 400 if SSO entry point is not configured", async () => {
      req.body = { tenantCode: "acme" };
      Tenants.findOne.mockResolvedValueOnce({ id: "tenant-1", code: "acme" });
      tenantService.getTenantSettings.mockResolvedValueOnce({
        data: { settings: { sso_enabled: "true" } },
      });

      await ssoController.ssoLogin(req, res, next);

      expect(error).toHaveBeenCalledWith(res, "SSO entry point is not configured for this tenant", 400, expect.any(String));
    });

    it("should generate redirect URL when sso_enabled is boolean true", async () => {
      req.body = { tenantCode: "acme" };
      Tenants.findOne.mockResolvedValueOnce({ id: "tenant-1", code: "acme" });
      tenantService.getTenantSettings.mockResolvedValueOnce({
        data: { settings: { sso_enabled: true, sso_idp_entry_point: "https://idp.com" } },
      });
      ssoService.generateAuthnRequest.mockReturnValueOnce("https://idp.com/redirect");

      await ssoController.ssoLogin(req, res, next);

      expect(success).toHaveBeenCalledWith(res, { redirectUrl: "https://idp.com/redirect" }, null, "SAML redirect URL generated", 200);
    });
  });

  describe("ssoCallback", () => {
    it("should process assertion and redirect to frontend with tokens", async () => {
      req.body = { SAMLResponse: "base64-resp", RelayState: "acme" };
      Tenants.findOne.mockResolvedValueOnce({ id: "tenant-1", code: "acme" });
      tenantService.getTenantSettings.mockResolvedValueOnce({
        data: { settings: { sso_enabled: "true" } },
      });
      ssoService.parseAndVerifyResponse.mockResolvedValueOnce({
        email: "user@acme.com",
        firstName: "User",
        lastName: "A",
      });
      ssoService.provisionUser.mockResolvedValueOnce({
        id: "user-1",
        email: "user@acme.com",
      });

      await ssoController.ssoCallback(req, res, next);

      // A-60: the redirect carries a one-time code; the session and its token
      // are created when the code is exchanged.
      expect(codeFrom(res)).toMatch(CODE_SHAPE);
      expect(createSession).not.toHaveBeenCalled();

      await exchange(codeFrom(res));

      // A-59: the access token names the session created for it, so it can be
      // revoked (A-48). It used to be signed {id, email} with no sid.
      expect(generateAccessToken).toHaveBeenCalledWith({
        id: "user-1",
        email: "user@acme.com",
        sid: "session-123",
      });
    });

    it("should call error response with 400 if tenantCode is not provided", async () => {
      req.body = { SAMLResponse: "base64" };

      await ssoController.ssoCallback(req, res, next);

      expect(error).toHaveBeenCalledWith(res, "Tenant identifier (RelayState or URL parameter) is required", 400, expect.any(String));
    });

    it("should call error response with 404 if tenant is not found", async () => {
      req.body = { SAMLResponse: "base64-resp", RelayState: "acme" };
      Tenants.findOne.mockResolvedValueOnce(null);

      await ssoController.ssoCallback(req, res, next);

      expect(error).toHaveBeenCalledWith(res, "Tenant not found", 404, expect.any(String));
    });

    it("should call error response with 400 if SSO is not enabled", async () => {
      req.body = { SAMLResponse: "base64-resp", RelayState: "acme" };
      Tenants.findOne.mockResolvedValueOnce({ id: "tenant-1", code: "acme" });
      tenantService.getTenantSettings.mockResolvedValueOnce({
        data: { settings: { sso_enabled: "false" } },
      });

      await ssoController.ssoCallback(req, res, next);

      expect(error).toHaveBeenCalledWith(res, "SSO is not enabled for this tenant", 400, expect.any(String));
    });

    it("should extract tenantCode from params when both params and RelayState are present", async () => {
      req.body = { SAMLResponse: "base64-resp", RelayState: "wrong" };
      req.params = { tenantCode: "acme" };
      Tenants.findOne.mockResolvedValueOnce({ id: "tenant-1", code: "acme" });
      tenantService.getTenantSettings.mockResolvedValueOnce({
        data: { settings: { sso_enabled: "true" } },
      });
      ssoService.parseAndVerifyResponse.mockResolvedValueOnce({ email: "user@acme.com" });
      ssoService.provisionUser.mockResolvedValueOnce({ id: "user-1", email: "user@acme.com" });

      await ssoController.ssoCallback(req, res, next);

      expect(Tenants.findOne).toHaveBeenCalledWith({ where: { code: "acme" } });
      expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining("sso-callback"));
    });
  });

  describe("ssoMetadata", () => {
    it("should return XML metadata", async () => {
      req.params = { tenantCode: "acme" };
      Tenants.findOne.mockResolvedValueOnce({ id: "tenant-1", code: "acme" });
      tenantService.getTenantSettings.mockResolvedValueOnce({
        data: { settings: { sso_enabled: "true" } },
      });

      await ssoController.ssoMetadata(req, res, next);

      expect(res.set).toHaveBeenCalledWith("Content-Type", "application/xml");
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith(expect.stringContaining("<EntityDescriptor"));
    });

    it("should call error response with 400 if tenant code is missing", async () => {
      await ssoController.ssoMetadata(req, res, next);

      expect(error).toHaveBeenCalledWith(res, "Tenant code is required", 400, expect.any(String));
    });

    it("should call error response with 404 if tenant is not found", async () => {
      req.params = { tenantCode: "nonexistent" };
      Tenants.findOne.mockResolvedValueOnce(null);

      await ssoController.ssoMetadata(req, res, next);

      expect(error).toHaveBeenCalledWith(res, "Tenant not found", 404, expect.any(String));
    });

    it("should return XML metadata when tenantCode is provided via query", async () => {
      req.query = { tenantCode: "acme" };
      Tenants.findOne.mockResolvedValueOnce({ id: "tenant-1", code: "acme" });
      tenantService.getTenantSettings.mockResolvedValueOnce({
        data: { settings: { sso_enabled: "true" } },
      });

      await ssoController.ssoMetadata(req, res, next);

      expect(res.set).toHaveBeenCalledWith("Content-Type", "application/xml");
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith(expect.stringContaining("<EntityDescriptor"));
    });
  });

  describe("oidcLogin", () => {
    it("should generate OIDC redirect URL if configured and valid tenant", async () => {
      req.body = { tenantCode: "acme" };
      Tenants.findOne.mockResolvedValueOnce({ id: "tenant-1", code: "acme" });
      tenantService.getTenantSettings.mockResolvedValueOnce({
        data: { settings: { sso_enabled: "true", oidc_client_id: "client-123" } },
      });
      ssoService.generateOidcAuthRequest.mockReturnValueOnce("https://oidc.com/auth");

      await ssoController.oidcLogin(req, res, next);

      expect(success).toHaveBeenCalledWith(res, { redirectUrl: "https://oidc.com/auth" }, null, "OIDC redirect URL generated", 200);
    });

    it("should call error with 404 if tenant is not found", async () => {
      req.body = { tenantCode: "nonexistent" };
      Tenants.findOne.mockResolvedValueOnce(null);

      await ssoController.oidcLogin(req, res, next);

      expect(error).toHaveBeenCalledWith(res, "Tenant not found", 404, expect.any(String));
    });

    it("should call error with 400 if SSO is not enabled", async () => {
      req.body = { tenantCode: "acme" };
      Tenants.findOne.mockResolvedValueOnce({ id: "tenant-1", code: "acme" });
      tenantService.getTenantSettings.mockResolvedValueOnce({
        data: { settings: { sso_enabled: "false" } },
      });

      await ssoController.oidcLogin(req, res, next);

      expect(error).toHaveBeenCalledWith(res, "SSO is not enabled for this tenant", 400, expect.any(String));
    });

    it("should call error with 400 if OIDC client ID is not configured", async () => {
      req.body = { tenantCode: "acme" };
      Tenants.findOne.mockResolvedValueOnce({ id: "tenant-1", code: "acme" });
      tenantService.getTenantSettings.mockResolvedValueOnce({
        data: { settings: { sso_enabled: "true" } },
      });

      await ssoController.oidcLogin(req, res, next);

      expect(error).toHaveBeenCalledWith(res, "OIDC is not configured for this tenant", 400, expect.any(String));
    });
  });

  describe("oidcCallback", () => {
    it("should verify callback and redirect to frontend with tokens", async () => {
      req.body = { code: "auth-code", state: "tenant_acme" };
      req.params = { tenantCode: "acme" };
      Tenants.findOne.mockResolvedValueOnce({ id: "tenant-1", code: "acme" });
      tenantService.getTenantSettings.mockResolvedValueOnce({
        data: { settings: { sso_enabled: "true", oidc_redirect_uri: "https://app.com/callback" } },
      });
      ssoService.verifyOidcCallback.mockResolvedValueOnce({
        email: "user@acme.com",
        firstName: "User",
        lastName: "A",
      });
      ssoService.provisionUser.mockResolvedValueOnce({
        id: "user-1",
        email: "user@acme.com",
      });

      await ssoController.oidcCallback(req, res, next);

      expect(codeFrom(res)).toMatch(CODE_SHAPE);
      expect(createSession).not.toHaveBeenCalled();

      await exchange(codeFrom(res));

      // A-59: the access token names the session created for it, so it can be
      // revoked (A-48). It used to be signed {id, email} with no sid.
      expect(generateAccessToken).toHaveBeenCalledWith({
        id: "user-1",
        email: "user@acme.com",
        sid: "session-123",
      });
    });

    it("should call error with 400 if tenantCode and code are not provided", async () => {
      req.body = {};

      await ssoController.oidcCallback(req, res, next);

      expect(error).toHaveBeenCalledWith(res, "Tenant identifier and authorization code are required", 400, expect.any(String));
    });

    it("should call error with 404 if tenant is not found", async () => {
      req.body = { code: "auth-code", state: "tenant_acme" };
      Tenants.findOne.mockResolvedValueOnce(null);

      await ssoController.oidcCallback(req, res, next);

      expect(error).toHaveBeenCalledWith(res, "Tenant not found", 404, expect.any(String));
    });

    it("should call error with 400 if SSO is not enabled", async () => {
      req.body = { code: "auth-code", state: "tenant_acme" };
      Tenants.findOne.mockResolvedValueOnce({ id: "tenant-1", code: "acme" });
      tenantService.getTenantSettings.mockResolvedValueOnce({
        data: { settings: { sso_enabled: "false" } },
      });

      await ssoController.oidcCallback(req, res, next);

      expect(error).toHaveBeenCalledWith(res, "SSO is not enabled for this tenant", 400, expect.any(String));
    });

    it("should extract tenantCode from state when params is not provided", async () => {
      req.body = { code: "auth-code", state: "tenant_acme" };
      Tenants.findOne.mockResolvedValueOnce({ id: "tenant-1", code: "acme" });
      tenantService.getTenantSettings.mockResolvedValueOnce({
        data: { settings: { sso_enabled: "true", oidc_redirect_uri: "https://app.com/callback" } },
      });
      ssoService.verifyOidcCallback.mockResolvedValueOnce({ email: "user@acme.com" });
      ssoService.provisionUser.mockResolvedValueOnce({ id: "user-1", email: "user@acme.com" });

      await ssoController.oidcCallback(req, res, next);

      expect(Tenants.findOne).toHaveBeenCalledWith({ where: { code: "acme" } });
      expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining("sso-callback"));
    });
  });

  // Every handler reads settings as `settingsResult.data?.settings || {}`, so a
  // tenant with no settings row must be treated as "SSO not enabled" rather
  // than throwing a TypeError.
  describe("missing tenant settings", () => {
    it.each([
      ["ssoLogin", () => ssoController.ssoLogin, { tenantCode: "acme" }, {}],
      ["ssoCallback", () => ssoController.ssoCallback, { SAMLResponse: "b64", RelayState: "acme" }, {}],
      ["oidcLogin", () => ssoController.oidcLogin, { tenantCode: "acme" }, {}],
      ["oidcCallback", () => ssoController.oidcCallback, { code: "auth-code", state: "tenant_acme" }, {}],
    ])("%s returns 400 when getTenantSettings resolves with no data", async (_name, getHandler, body) => {
      req.body = body;
      tenantService.getTenantSettings.mockResolvedValue({});

      await getHandler()(req, res, next);

      expect(error).toHaveBeenCalledWith(
        res,
        "SSO is not enabled for this tenant",
        400,
        expect.any(String),
      );
    });

    it("ssoMetadata still emits metadata when the tenant has no settings", async () => {
      req.params = { tenantCode: "acme" };
      tenantService.getTenantSettings.mockResolvedValue({ data: {} });

      await ssoController.ssoMetadata(req, res, next);

      // With no sso_sp_entity_id/sso_sp_callback_url configured, both fall back
      // to HOST_URL-derived defaults.
      expect(res.status).toHaveBeenCalledWith(200);
      const xml = res.send.mock.calls[0][0];
      expect(xml).toContain('entityID="http://localhost:5000/api/v1/auth/sso/metadata/acme"');
      expect(xml).toContain('Location="http://localhost:5000/api/v1/auth/sso/callback/acme"');
    });
  });

  describe("configured SP URL overrides", () => {
    it("uses sso_sp_entity_id and sso_sp_callback_url when configured", async () => {
      req.params = { tenantCode: "acme" };
      tenantService.getTenantSettings.mockResolvedValue({
        data: {
          settings: {
            sso_enabled: "true",
            sso_sp_entity_id: "https://sp.acme.com/entity",
            sso_sp_callback_url: "https://sp.acme.com/acs",
          },
        },
      });

      await ssoController.ssoMetadata(req, res, next);

      const xml = res.send.mock.calls[0][0];
      expect(xml).toContain('entityID="https://sp.acme.com/entity"');
      expect(xml).toContain('Location="https://sp.acme.com/acs"');
    });

    it("falls back to the built-in host URL when HOST_URL is unset", async () => {
      const prev = process.env.HOST_URL;
      delete process.env.HOST_URL;
      try {
        req.params = { tenantCode: "acme" };
        tenantService.getTenantSettings.mockResolvedValue({
          data: { settings: { sso_enabled: "true" } },
        });

        await ssoController.ssoMetadata(req, res, next);

        const xml = res.send.mock.calls[0][0];
        expect(xml).toContain('entityID="http://localhost:5000/api/v1/auth/sso/metadata/acme"');
      } finally {
        process.env.HOST_URL = prev;
      }
    });

    it("derives the OIDC redirect_uri from HOST_URL when oidc_redirect_uri is unset", async () => {
      req.body = { code: "auth-code", state: "tenant_acme" };
      req.params = { tenantCode: "acme" };
      tenantService.getTenantSettings.mockResolvedValue({
        data: { settings: { sso_enabled: "true" } },
      });

      await ssoController.oidcCallback(req, res, next);

      expect(ssoService.verifyOidcCallback).toHaveBeenCalledWith(
        "auth-code",
        expect.any(Object),
        "http://localhost:5000/api/v1/auth/sso/oidc/callback/acme",
      );
    });

    it("falls back to the built-in host URL for the OIDC redirect_uri when HOST_URL is unset", async () => {
      const prev = process.env.HOST_URL;
      delete process.env.HOST_URL;
      try {
        req.body = { code: "auth-code", state: "tenant_acme" };
        req.params = { tenantCode: "acme" };
        tenantService.getTenantSettings.mockResolvedValue({
          data: { settings: { sso_enabled: "true" } },
        });

        await ssoController.oidcCallback(req, res, next);

        expect(ssoService.verifyOidcCallback).toHaveBeenCalledWith(
          "auth-code",
          expect.any(Object),
          "http://localhost:5000/api/v1/auth/sso/oidc/callback/acme",
        );
      } finally {
        process.env.HOST_URL = prev;
      }
    });
  });

  // Sessions record the BROWSER's IP/user-agent — the callback request's, not
  // the exchange's (which comes from the frontend server) — defaulting to ""
  // when Express did not populate them; the redirect honours FRONTEND_URL.
  describe("session recording and frontend redirect", () => {
    it("defaults ipAddress and userAgent to empty strings on ssoCallback", async () => {
      req.body = { SAMLResponse: "b64", RelayState: "acme" };
      req.ip = undefined;
      req.headers = {};
      tenantService.getTenantSettings.mockResolvedValue({
        data: { settings: { sso_enabled: "true" } },
      });

      await ssoController.ssoCallback(req, res, next);
      await exchange(codeFrom(res));

      expect(createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "tenant-1",
          userId: "user-1",
          refreshToken: "mock-refresh-token",
          ipAddress: "",
          userAgent: "",
        }),
      );
    });

    it("defaults ipAddress and userAgent to empty strings on oidcCallback", async () => {
      req.body = { code: "auth-code", state: "tenant_acme" };
      req.ip = undefined;
      req.headers = {};
      tenantService.getTenantSettings.mockResolvedValue({
        data: { settings: { sso_enabled: "true" } },
      });

      await ssoController.oidcCallback(req, res, next);
      await exchange(codeFrom(res));

      expect(createSession).toHaveBeenCalledWith(
        expect.objectContaining({ ipAddress: "", userAgent: "" }),
      );
    });

    it("records the real ip/user-agent and redirects to FRONTEND_URL when set", async () => {
      const prev = process.env.FRONTEND_URL;
      process.env.FRONTEND_URL = "https://app.acme.com";
      try {
        req.body = { SAMLResponse: "b64", RelayState: "acme" };
        tenantService.getTenantSettings.mockResolvedValue({
          data: { settings: { sso_enabled: "true" } },
        });

        await ssoController.ssoCallback(req, res, next);

        expect(res.redirect.mock.calls[0][0]).toMatch(
          /^https:\/\/app\.acme\.com\/sso-callback\?code=[A-Za-z0-9_-]{43}$/,
        );
        await exchange(codeFrom(res));
        expect(createSession).toHaveBeenCalledWith(
          expect.objectContaining({ ipAddress: "127.0.0.1", userAgent: "mock-agent" }),
        );
      } finally {
        if (prev === undefined) {delete process.env.FRONTEND_URL;}
        else {process.env.FRONTEND_URL = prev;}
      }
    });

    it("redirects to FRONTEND_URL from oidcCallback when set", async () => {
      const prev = process.env.FRONTEND_URL;
      process.env.FRONTEND_URL = "https://app.acme.com";
      try {
        req.body = { code: "auth-code", state: "tenant_acme" };
        tenantService.getTenantSettings.mockResolvedValue({
          data: { settings: { sso_enabled: "true" } },
        });

        await ssoController.oidcCallback(req, res, next);

        expect(res.redirect.mock.calls[0][0]).toMatch(
          /^https:\/\/app\.acme\.com\/sso-callback\?code=[A-Za-z0-9_-]{43}$/,
        );
      } finally {
        if (prev === undefined) {delete process.env.FRONTEND_URL;}
        else {process.env.FRONTEND_URL = prev;}
      }
    });
  });

  describe("oidcCallback tenant identifier", () => {
    it("returns 400 when state has no tenant segment and no params.tenantCode", async () => {
      req.body = { code: "auth-code", state: "nostatesegment" };

      await ssoController.oidcCallback(req, res, next);

      // "nostatesegment".split("_")[1] is undefined -> no tenant identifier
      expect(error).toHaveBeenCalledWith(
        res,
        "Tenant identifier and authorization code are required",
        400,
        expect.any(String),
      );
    });

    it("returns 400 when the tenant is known but the authorization code is missing", async () => {
      req.body = { state: "tenant_acme" };
      req.params = { tenantCode: "acme" };

      await ssoController.oidcCallback(req, res, next);

      expect(error).toHaveBeenCalledWith(
        res,
        "Tenant identifier and authorization code are required",
        400,
        expect.any(String),
      );
    });
  });

  // -------------------------------------------------------------------------
  // A-60 — the callbacks used to redirect to
  // `/sso-callback?token=<access>&refreshToken=<refresh>`. They now redirect
  // with a one-time code the frontend server exchanges for the session.
  // -------------------------------------------------------------------------
  describe("A-60: the SSO hand-off", () => {
    const callback = async (kind) => {
      const response = { redirect: jest.fn() };
      const request =
        kind === "saml"
          ? {
            params: { tenantCode: "acme" },
            body: { SAMLResponse: "b64" },
            headers: { "user-agent": "browser-agent" },
            ip: "203.0.113.7",
          }
          : {
            params: { tenantCode: "acme" },
            body: { code: "idp-code" },
            headers: { "user-agent": "browser-agent" },
            ip: "203.0.113.7",
          };
      const handler = kind === "saml" ? ssoController.ssoCallback : ssoController.oidcCallback;
      await handler(request, response, jest.fn());
      expect(response.redirect).toHaveBeenCalledTimes(1);
      return response;
    };

    const refused = (exRes) => {
      expect(error).toHaveBeenCalledWith(exRes, "Invalid or expired SSO code", 401, expect.any(String));
      expect(login).not.toHaveBeenCalled();
    };

    it.each(["saml", "oidc"])("no token appears in the SSO redirect URL (%s)", async (kind) => {
      const response = await callback(kind);
      const url = new URL(response.redirect.mock.calls[0][0]);

      expect(url.pathname).toBe("/sso-callback");
      expect([...url.searchParams.keys()]).toEqual(["code"]);
      expect(url.searchParams.get("code")).toMatch(CODE_SHAPE);
      expect(url.toString()).not.toMatch(/token/i);
      expect(url.toString()).not.toContain("mock-access-token");
      expect(url.toString()).not.toContain("mock-refresh-token");

      // No token exists yet: neither was minted, and no session was created.
      expect(generateAccessToken).not.toHaveBeenCalled();
      const { generateOpaqueRefreshToken } = require("../../utils/jwt.util");
      expect(generateOpaqueRefreshToken).not.toHaveBeenCalled();
      expect(createSession).not.toHaveBeenCalled();

      // The store holds the verified identity under the code's HASH, for 60s.
      expect(redis.set).toHaveBeenCalledWith(
        expect.stringMatching(/^sso:handoff:[0-9a-f]{64}$/),
        {
          userId: "user-1",
          email: "user@test.com",
          tenantId: "tenant-1",
          ipAddress: "203.0.113.7",
          userAgent: "browser-agent",
          method: kind,
        },
        ssoController.HANDOFF_TTL_SECONDS,
      );
      expect(ssoController.HANDOFF_TTL_SECONDS).toBe(60);
      const [storedKey] = redis.set.mock.calls[0];
      expect(storedKey).not.toContain(url.searchParams.get("code"));
    });

    it("a one-time code can be exchanged once only", async () => {
      const code = codeFrom(await callback("oidc"));

      const first = await exchange(code);
      expect(login).toHaveBeenCalledWith(
        first,
        { id: "user-1", email: "user@test.com", tenantId: "tenant-1" },
        "mock-access-token",
        { id: "session-123" },
      );
      expect(createSession).toHaveBeenCalledTimes(1);
      expect(redis.getDel).toHaveBeenCalledWith(expect.stringMatching(/^sso:handoff:[0-9a-f]{64}$/));

      login.mockClear();
      const second = await exchange(code);
      refused(second);
      expect(createSession).toHaveBeenCalledTimes(1);
    });

    it("an expired or unknown code is refused", async () => {
      // Unknown: well-formed, never issued.
      const unknown = await exchange("A".repeat(43), { ip: "10.9.9.9" });
      refused(unknown);
      expect(recordAuthFailure).toHaveBeenCalledWith({ ip: "10.9.9.9", endpoint: "ssoExchange" });
      expect(createSession).not.toHaveBeenCalled();

      // Expired: Redis drops the key at its TTL (asserted above as 60s); the
      // memory fallback enforces the same TTL itself.
      mockRedisUp = false;
      const now = Date.now();
      const clock = jest.spyOn(Date, "now").mockReturnValue(now);
      try {
        const code = codeFrom(await callback("saml"));
        clock.mockReturnValue(now + 60 * 1000 + 1);
        refused(await exchange(code));
        expect(createSession).not.toHaveBeenCalled();
      } finally {
        clock.mockRestore();
      }
    });

    it("writes the session and its LOGIN audit row in one transaction", async () => {
      const { sequelize } = require("../../models");
      await exchange(codeFrom(await callback("saml")));

      expect(sequelize.transaction).toHaveBeenCalledTimes(1);
      expect(auditService.logAction).toHaveBeenCalledWith(
        {
          tenantId: "tenant-1",
          userId: "user-1",
          action: "LOGIN",
          resourceType: "Session",
          resourceId: "session-123",
          changes: { method: "saml" },
          ipAddress: "203.0.113.7",
          userAgent: "browser-agent",
        },
        { transaction: "mock-transaction" },
      );
    });

    it("records a missing ip/user-agent as null in the audit row", async () => {
      const response = { redirect: jest.fn() };
      await ssoController.oidcCallback(
        { params: { tenantCode: "acme" }, body: { code: "c" }, headers: {} },
        response,
        jest.fn(),
      );
      await exchange(codeFrom(response));
      expect(auditService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({ ipAddress: null, userAgent: null }),
        { transaction: "mock-transaction" },
      );
    });

    it("keeps the code in process memory when Redis is unavailable — still single-use", async () => {
      mockRedisUp = false;
      const code = codeFrom(await callback("saml"));
      expect(logger.warn).toHaveBeenCalledWith(
        "SSO hand-off code held in process memory: Redis unavailable",
      );
      expect(redis.mockHandoffStore.size).toBe(0);

      await exchange(code);
      expect(login).toHaveBeenCalledTimes(1);

      login.mockClear();
      refused(await exchange(code));
    });

    it("prunes expired memory entries when a new one is stored", async () => {
      mockRedisUp = false;
      const now = Date.now();
      const clock = jest.spyOn(Date, "now").mockReturnValue(now);
      try {
        const stale = codeFrom(await callback("saml"));
        clock.mockReturnValue(now + 61 * 1000);
        const fresh = codeFrom(await callback("saml")); // prunes `stale`
        const newest = codeFrom(await callback("saml")); // `fresh` is kept

        refused(await exchange(stale));
        login.mockClear();
        error.mockClear();
        await exchange(fresh);
        await exchange(newest);
        expect(login).toHaveBeenCalledTimes(2);
      } finally {
        clock.mockRestore();
      }
    });

    it("treats a store value that is not an entry as unknown", async () => {
      redis.getDel.mockResolvedValueOnce("not-an-entry");
      refused(await exchange("B".repeat(43)));
    });

    it("still refuses, and logs, when the failure cannot be recorded", async () => {
      recordAuthFailure.mockRejectedValueOnce(new Error("limiter down"));
      refused(await exchange("C".repeat(43)));
      expect(logger.error).toHaveBeenCalledWith(
        "SSO exchange failure recording error: limiter down",
      );
    });
  });
});

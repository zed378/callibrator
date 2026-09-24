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

// A-188: the IdP's endpoints come from its discovery document.
jest.mock("../../services/oidcJwks", () => ({
  discover: jest.fn().mockResolvedValue({
    issuer: "https://idp.example.com/v2.0",
    authorizationEndpoint: "https://idp.example.com/oauth2/v2.0/authorize",
    tokenEndpoint: "https://idp.example.com/oauth2/v2.0/token",
    jwksUri: "https://idp.example.com/discovery/v2.0/keys",
    discovered: true,
  }),
}));

jest.mock("../../services/tenant.service", () => ({
  getTenantSettings: jest.fn(),
}));

jest.mock("../../models", () => ({
  Tenants: {
    findOne: jest.fn(),
  },
  // A-83: the exchange re-reads the user (and its tenant) before any session.
  Users: {
    findByPk: jest.fn(),
    // A-188: the exchange stamps last_login_at in the session's transaction.
    update: jest.fn().mockResolvedValue([1]),
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

// A-100: ssoExchange counts a failure through noteAuthFailure, which applies
// AUTH_RATE_LIMIT_BY_IP and never throws (rateLimiter.service.coverage.test.js;
// auth.ssoExchange.a60.test.js drives the real limiter through the route).
jest.mock("../../services/rateLimiter.redis.service", () => ({
  noteAuthFailure: jest.fn().mockResolvedValue(undefined),
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

const { Tenants, Users } = require("../../models");
const tenantService = require("../../services/tenant.service");
const ssoService = require("../../services/sso.service");
const ssoController = require("../../controllers/sso.controller");
const { success, error, login } = require("../../utils/response.util");
const redis = require("../../services/redis.service");
const auditService = require("../../services/audit.service");
const { noteAuthFailure } = require("../../services/rateLimiter.redis.service");
const { logger } = require("../../middlewares/activityLog.middleware");
const { createSession } = require("../../services/session.service");
const { generateAccessToken } = require("../../utils/jwt.util");

const CODE_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/**
 * A-188: a refused browser callback is a redirect to the login page with a
 * fixed code — never the JSON error envelope.
 */
const expectLoginRefusal = (response, code) => {
  expect(error).not.toHaveBeenCalled();
  expect(response.redirect).toHaveBeenCalledTimes(1);
  const target = new URL(response.redirect.mock.calls[0][0]);
  expect(target.pathname).toBe("/login");
  expect([...target.searchParams.keys()]).toEqual(["error"]);
  expect(target.searchParams.get("error")).toBe(code);
};

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

/**
 * A-68: start a real OIDC sign-in (the controller's own beginOidcFlow, against
 * the fake Redis above) and put its state and the browser's binding cookie on
 * `request` — what the IdP's redirect and the browser bring to the callback.
 * The flow's own store write is cleared from redis.set's history, so the
 * hand-off assertions still see the callback's write as the first.
 */
const startedOidc = async (request, tenantCode = "acme", redirectUri = "https://app.com/callback") => {
  const flow = await ssoController.beginOidcFlow(tenantCode, redirectUri);
  request.body = { ...request.body, state: flow.state };
  request.headers = {
    ...request.headers,
    cookie: `other=1; ${ssoController.OIDC_BINDING_COOKIE}=${flow.binding}`,
  };
  redis.set.mockClear();
  return flow;
};

describe("sso.controller", () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisUp = true;
    redis.mockHandoffStore.clear();
    // A-83: an active user in an active tenant unless a case says otherwise.
    Users.findByPk.mockResolvedValue({
      id: "user-1",
      tenantId: "tenant-1",
      isActive: true,
      status: "ACTIVE",
      tenant: { id: "tenant-1", status: "active" },
    });
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
      cookie: jest.fn(),
      clearCookie: jest.fn(),
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

      // A-150: settings are masked by default; the SAML flow needs the real
      // IdP certificate, so it asks for secrets (and never returns them).
      expect(tenantService.getTenantSettings).toHaveBeenCalledWith("tenant-1", {
        includeSecrets: true,
      });

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
        // A-160: the federated method, read by the tenant MFA policy.
        amr: "saml",
      });
    });

    it("should call error response with 400 if tenantCode is not provided", async () => {
      req.body = { SAMLResponse: "base64" };

      await ssoController.ssoCallback(req, res, next);

      expectLoginRefusal(res, "sso_unavailable");
    });

    it("should call error response with 404 if tenant is not found", async () => {
      req.body = { SAMLResponse: "base64-resp", RelayState: "acme" };
      Tenants.findOne.mockResolvedValueOnce(null);

      await ssoController.ssoCallback(req, res, next);

      expectLoginRefusal(res, "sso_unavailable");
    });

    it("should call error response with 400 if SSO is not enabled", async () => {
      req.body = { SAMLResponse: "base64-resp", RelayState: "acme" };
      Tenants.findOne.mockResolvedValueOnce({ id: "tenant-1", code: "acme" });
      tenantService.getTenantSettings.mockResolvedValueOnce({
        data: { settings: { sso_enabled: "false" } },
      });

      await ssoController.ssoCallback(req, res, next);

      expectLoginRefusal(res, "sso_unavailable");
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
      req.body = { code: "auth-code" };
      req.params = { tenantCode: "acme" };
      await startedOidc(req);
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

      // A-150: the token exchange needs the real OIDC client secret.
      expect(tenantService.getTenantSettings).toHaveBeenCalledWith("tenant-1", {
        includeSecrets: true,
      });
      expect(codeFrom(res)).toMatch(CODE_SHAPE);
      expect(createSession).not.toHaveBeenCalled();

      await exchange(codeFrom(res));

      // A-59: the access token names the session created for it, so it can be
      // revoked (A-48). It used to be signed {id, email} with no sid.
      expect(generateAccessToken).toHaveBeenCalledWith({
        id: "user-1",
        email: "user@acme.com",
        sid: "session-123",
        amr: "oidc",
      });
    });

    it("should call error with 400 if code and state are not provided", async () => {
      req.body = {};

      await ssoController.oidcCallback(req, res, next);

      expectLoginRefusal(res, "sso_state");
    });

    it("should call error with 404 if tenant is not found", async () => {
      req.body = { code: "auth-code" };
      await startedOidc(req);
      Tenants.findOne.mockResolvedValueOnce(null);

      await ssoController.oidcCallback(req, res, next);

      expectLoginRefusal(res, "sso_unavailable");
    });

    it("should call error with 400 if SSO is not enabled", async () => {
      req.body = { code: "auth-code" };
      await startedOidc(req);
      Tenants.findOne.mockResolvedValueOnce({ id: "tenant-1", code: "acme" });
      tenantService.getTenantSettings.mockResolvedValueOnce({
        data: { settings: { sso_enabled: "false" } },
      });

      await ssoController.oidcCallback(req, res, next);

      expectLoginRefusal(res, "sso_unavailable");
    });

    it("takes the tenant from the stored sign-in when the URL names none", async () => {
      req.body = { code: "auth-code" };
      await startedOidc(req);
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
      ["oidcCallback", () => ssoController.oidcCallback, { code: "auth-code" }, {}],
    ])("%s returns 400 when getTenantSettings resolves with no data", async (name, getHandler, body) => {
      req.body = body;
      if (name === "oidcCallback") {
        await startedOidc(req);
      }
      tenantService.getTenantSettings.mockResolvedValue({});

      await getHandler()(req, res, next);

      if (name.endsWith("Callback")) {
        // A-188: a browser callback redirects to the login page instead.
        expectLoginRefusal(res, "sso_unavailable");
        return;
      }
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

    // A-68: the redirect_uri is fixed when the sign-in STARTS and stored with
    // its state; the callback sends the stored value to the token endpoint.
    it("derives the OIDC redirect_uri from HOST_URL when oidc_redirect_uri is unset", async () => {
      const prev = process.env.HOST_URL;
      process.env.HOST_URL = "https://kalibrasi.example.com";
      try {
        req.body = { tenantCode: "acme" };
        tenantService.getTenantSettings.mockResolvedValue({
          data: { settings: { sso_enabled: "true", oidc_client_id: "client-123" } },
        });

        await ssoController.oidcLogin(req, res, next);

        expect(ssoService.generateOidcAuthRequest).toHaveBeenCalledWith(
          "acme",
          expect.any(Object),
          expect.objectContaining({
            redirectUri: "https://kalibrasi.example.com/api/v1/auth/sso/oidc/callback/acme",
          }),
        );
      } finally {
        if (prev === undefined) {delete process.env.HOST_URL;}
        else {process.env.HOST_URL = prev;}
      }
    });

    it("falls back to the built-in host URL for the OIDC redirect_uri when HOST_URL is unset", async () => {
      const prev = process.env.HOST_URL;
      delete process.env.HOST_URL;
      try {
        req.body = { tenantCode: "acme" };
        tenantService.getTenantSettings.mockResolvedValue({
          data: { settings: { sso_enabled: "true", oidc_client_id: "client-123" } },
        });

        await ssoController.oidcLogin(req, res, next);

        expect(ssoService.generateOidcAuthRequest).toHaveBeenCalledWith(
          "acme",
          expect.any(Object),
          expect.objectContaining({
            redirectUri: "http://localhost:5000/api/v1/auth/sso/oidc/callback/acme",
          }),
        );
      } finally {
        if (prev !== undefined) {process.env.HOST_URL = prev;}
      }
    });

    it("the callback sends the redirect_uri stored at the start, not one derived again", async () => {
      req.body = { code: "auth-code" };
      await startedOidc(req, "acme", "https://stored.example.com/cb");
      tenantService.getTenantSettings.mockResolvedValue({
        data: { settings: { sso_enabled: "true", oidc_redirect_uri: "https://changed.example.com/cb" } },
      });

      await ssoController.oidcCallback(req, res, next);

      expect(ssoService.verifyOidcCallback).toHaveBeenCalledWith(
        "auth-code",
        expect.any(Object),
        "https://stored.example.com/cb",
        { nonce: expect.any(String), codeVerifier: expect.any(String) },
      );
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
      req.body = { code: "auth-code" };
      req.ip = undefined;
      req.headers = {};
      await startedOidc(req);
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
        req.body = { code: "auth-code" };
        await startedOidc(req);
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
    it("sends the browser to the login page when the authorization code is missing (A-188)", async () => {
      req.params = { tenantCode: "acme" };
      await startedOidc(req);

      await ssoController.oidcCallback(req, res, next);

      expectLoginRefusal(res, "sso_state");
    });

    it("reads code and state from the query string — the IdP's GET return (response_mode=query)", async () => {
      const flow = await startedOidc(req);
      req.body = undefined;
      req.query = { code: "auth-code", state: flow.state };
      req.params = { tenantCode: "acme" };

      await ssoController.oidcCallback(req, res, next);

      expect(ssoService.verifyOidcCallback).toHaveBeenCalledWith(
        "auth-code",
        expect.any(Object),
        "https://app.com/callback",
        expect.objectContaining({ nonce: flow.nonce }),
      );
      expect(codeFrom(res)).toMatch(CODE_SHAPE);
    });
  });

  // -------------------------------------------------------------------------
  // A-68 — the callback accepted any code with any `state`: the state was
  // generated and stored nowhere, and there was no nonce and no PKCE.
  // -------------------------------------------------------------------------
  describe("A-68: OIDC state, nonce and PKCE", () => {
    // Found in passing: validate() returns Joi's { value, error }, and both
    // start handlers destructured `tenantCode` from it — always undefined, so
    // Sequelize threw on `where: { code: undefined }` and every start was a 500.
    it.each([
      ["ssoLogin", () => ssoController.ssoLogin],
      ["oidcLogin", () => ssoController.oidcLogin],
    ])("%s answers 400 without a tenant code, and looks the tenant up by the code it was sent", async (_n, handler) => {
      req.body = {};
      await handler()(req, res, next);
      expect(error).toHaveBeenCalledWith(res, "Tenant code is required", 400, expect.any(String));
      expect(Tenants.findOne).not.toHaveBeenCalled();

      req.body = { tenantCode: "acme" };
      await handler()(req, res, next);
      expect(Tenants.findOne).toHaveBeenCalledWith({ where: { code: "acme" } });
    });

    // A-188: refused to the login page (?error=sso_state), never to /sso-callback.
    const refusedState = () => {
      expectLoginRefusal(res, "sso_state");
      expect(ssoService.verifyOidcCallback).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith("SSO callback refused", {
        protocol: "oidc",
        code: "sso_state",
        status: 401,
        reason: "Invalid or expired SSO sign-in state",
      });
    };

    it("oidcLogin stores the state, sends an S256 challenge of a verifier it keeps, and sets the binding cookie", async () => {
      req.body = { tenantCode: "acme" };
      tenantService.getTenantSettings.mockResolvedValue({
        data: { settings: { sso_enabled: "true", oidc_client_id: "client-123" } },
      });

      await ssoController.oidcLogin(req, res, next);

      const [, , sent] = ssoService.generateOidcAuthRequest.mock.calls[0];
      expect(sent.state).toMatch(CODE_SHAPE);
      expect(sent.nonce).toMatch(CODE_SHAPE);
      expect(sent).not.toHaveProperty("codeVerifier");

      const [key, entry, ttl] = redis.set.mock.calls[0];
      expect(key).toMatch(/^sso:oidc:state:[0-9a-f]{64}$/);
      expect(key).not.toContain(sent.state);
      expect(ttl).toBe(ssoController.OIDC_FLOW_TTL_SECONDS);
      expect(entry).toMatchObject({ tenantCode: "acme", nonce: sent.nonce });
      const crypto = require("crypto");
      expect(sent.codeChallenge).toBe(
        crypto.createHash("sha256").update(entry.codeVerifier).digest("base64url"),
      );

      const [name, binding, options] = res.cookie.mock.calls[0];
      expect(name).toBe("sso_oidc_binding");
      expect(entry.bindingHash).toBe(crypto.createHash("sha256").update(binding).digest("hex"));
      expect(options).toEqual({
        httpOnly: true,
        secure: false,
        sameSite: "lax",
        path: "/api/v1/auth/sso/oidc",
        maxAge: ssoController.OIDC_FLOW_TTL_SECONDS * 1000,
      });
    });

    it("marks the binding cookie Secure in production", async () => {
      const prev = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      try {
        req.body = { tenantCode: "acme" };
        tenantService.getTenantSettings.mockResolvedValue({
          data: { settings: { sso_enabled: "true", oidc_client_id: "client-123" } },
        });

        await ssoController.oidcLogin(req, res, next);

        expect(res.cookie.mock.calls[0][2]).toMatchObject({ secure: true });
      } finally {
        process.env.NODE_ENV = prev;
      }
    });

    it("a callback with a forged state is refused", async () => {
      req.body = { code: "attacker-code" };
      await startedOidc(req);
      req.body.state = "forged-state";

      await ssoController.oidcCallback(req, res, next);

      refusedState();
    });

    it("a replayed state is refused — it is consumed on first use", async () => {
      req.body = { code: "auth-code" };
      req.params = { tenantCode: "acme" };
      await startedOidc(req);

      await ssoController.oidcCallback(req, res, next);
      expect(res.redirect).toHaveBeenCalledTimes(1);

      jest.clearAllMocks();
      await ssoController.oidcCallback(req, res, next);

      refusedState();
    });

    it("a state presented by a browser that did not start the sign-in is refused (login CSRF)", async () => {
      req.body = { code: "attacker-code" };
      await startedOidc(req);
      // The victim's browser: the attacker's state and code, but not the
      // attacker's binding cookie.
      req.headers = { cookie: `${ssoController.OIDC_BINDING_COOKIE}=${"x".repeat(43)}` };

      await ssoController.oidcCallback(req, res, next);

      refusedState();
    });

    it("a state with no binding cookie at all is refused", async () => {
      req.body = { code: "attacker-code" };
      await startedOidc(req);
      req.headers = {};

      await ssoController.oidcCallback(req, res, next);

      refusedState();
    });

    it("a state started for one tenant is refused at another tenant's callback URL", async () => {
      req.body = { code: "auth-code" };
      await startedOidc(req, "acme");
      req.params = { tenantCode: "globex" };

      await ssoController.oidcCallback(req, res, next);

      refusedState();
    });

    it("clears the binding cookie on every callback, refused or not", async () => {
      req.body = { code: "c", state: "unknown" };

      await ssoController.oidcCallback(req, res, next);

      expect(res.clearCookie).toHaveBeenCalledWith("sso_oidc_binding", {
        httpOnly: true,
        secure: false,
        sameSite: "lax",
        path: "/api/v1/auth/sso/oidc",
      });
    });

    it("passes the stored nonce and verifier to the verifier of the ID token", async () => {
      req.body = { code: "auth-code" };
      await startedOidc(req);
      const [, entry] = [null, [...redis.mockHandoffStore.values()].map((v) => JSON.parse(v))[0]];

      await ssoController.oidcCallback(req, res, next);

      expect(ssoService.verifyOidcCallback).toHaveBeenCalledWith(
        "auth-code",
        expect.any(Object),
        "https://app.com/callback",
        { nonce: entry.nonce, codeVerifier: entry.codeVerifier },
      );
    });

    it("with Redis down the state is held in memory — still single-use, still bound", async () => {
      mockRedisUp = false;
      req.body = { code: "auth-code" };
      await startedOidc(req);
      expect(logger.warn).toHaveBeenCalledWith(
        "OIDC sign-in state held in process memory: Redis unavailable",
      );

      await ssoController.oidcCallback(req, res, next);
      expect(res.redirect).toHaveBeenCalledTimes(1);

      jest.clearAllMocks();
      await ssoController.oidcCallback(req, res, next);
      refusedState();
    });

    it("with Redis down an expired state is refused, and expired entries are pruned", async () => {
      mockRedisUp = false;
      const realNow = Date.now;
      try {
        req.body = { code: "auth-code" };
        await startedOidc(req);
        const other = {};
        await startedOidc(other);
        Date.now = () => realNow() + (ssoController.OIDC_FLOW_TTL_SECONDS + 1) * 1000;
        // A new sign-in prunes both expired entries.
        await startedOidc({});

        await ssoController.oidcCallback(req, res, next);
        refusedState();
      } finally {
        Date.now = realNow;
      }
    });

    it("treats a store value that is not an entry as unknown", async () => {
      req.body = { code: "auth-code" };
      await startedOidc(req);
      redis.getDel.mockResolvedValueOnce("not-an-entry");

      await ssoController.oidcCallback(req, res, next);

      refusedState();
    });

    it("ignores a Cookie header entry with no name", async () => {
      req.body = { code: "auth-code" };
      await startedOidc(req);
      req.headers.cookie = `=junk; ${req.headers.cookie}`;

      await ssoController.oidcCallback(req, res, next);

      expect(res.redirect).toHaveBeenCalledTimes(1);
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
      if (kind === "oidc") {
        response.clearCookie = jest.fn();
        await startedOidc(request);
      }
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
      expect(noteAuthFailure).toHaveBeenCalledWith(
        expect.objectContaining({ rateLimitContext: { ip: "10.9.9.9" } }),
        "ssoExchange",
      );
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
      const response = { redirect: jest.fn(), clearCookie: jest.fn() };
      const request = { params: { tenantCode: "acme" }, body: { code: "c" }, headers: {} };
      await startedOidc(request);
      delete request.headers["user-agent"];
      await ssoController.oidcCallback(request, response, jest.fn());
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

    it("counts a failure only for a refused code, never for a redeemed one", async () => {
      const code = codeFrom(await callback("oidc"));
      noteAuthFailure.mockClear();
      await exchange(code);
      expect(noteAuthFailure).not.toHaveBeenCalled();

      login.mockClear();
      refused(await exchange("C".repeat(43)));
      expect(noteAuthFailure).toHaveBeenCalledTimes(1);
    });
  });
});

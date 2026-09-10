/**
 * Tests for oidcProvider controller
 */

jest.mock("../../services/oidcProvider.service", () => ({
  discover: jest.fn(),
  jwks: jest.fn(),
  registerClient: jest.fn(),
  getClients: jest.fn(),
  rotateSecret: jest.fn(),
  deleteClient: jest.fn(),
  beginAuthorization: jest.fn(),
  getAuthRequest: jest.fn(),
  decideAuthorization: jest.fn(),
  exchangeAuthorizationCode: jest.fn(),
  refreshAccessToken: jest.fn(),
  getUserInfo: jest.fn(),
}));

jest.mock("../../validators/oidc.validator", () => ({
  validate: jest.fn((data, schema) => { return { ...data }; }),
  oidcClientSchema: {},
}));

jest.mock("../../utils/response.util", () => ({
  success: jest.fn(),
  error: jest.fn(),
}));

const oidcProviderService = require("../../services/oidcProvider.service");
const oidcProviderController = require("../../controllers/oidcProvider.controller");
const { validate, oidcClientSchema } = require("../../validators/oidc.validator");
const { success } = require("../../utils/response.util");

const VALID_TENANT_ID = "550e8400-e29b-41d4-a716-446655440002";

describe("oidcProvider Controller", () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    success.mockImplementation((res, data, meta, message, status) => {
      res.status(status || 200).json({ success: true, data, message });
    });
    validate.mockImplementation((data, schema) => { return { ...data }; });
    req = {
      body: {},
      params: {},
      query: {},
      headers: {},
      user: { id: "user-1", tenantId: VALID_TENANT_ID },
      ip: "127.0.0.1",
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      redirect: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  // OIDC metadata/token/userinfo must be RAW JSON (spec shape), never the
  // app's {success,data} envelope — conformant RP libraries parse them directly.
  describe("discover", () => {
    it("should return the discovery document as raw JSON", async () => {
      const discoveryConfig = {
        issuer: "http://localhost:5000",
        authorization_endpoint: "http://localhost:5000/oidc/authorize",
      };
      oidcProviderService.discover.mockReturnValue(discoveryConfig);

      await oidcProviderController.discover(req, res, next);

      expect(oidcProviderService.discover).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(discoveryConfig);
      expect(success).not.toHaveBeenCalled();
    });
  });

  describe("jwks", () => {
    it("should return the JWKS as raw JSON", async () => {
      const jwksPayload = { keys: [{ kid: "key-1" }] };
      oidcProviderService.jwks.mockReturnValue(jwksPayload);

      await oidcProviderController.jwks(req, res, next);

      expect(oidcProviderService.jwks).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(jwksPayload);
      expect(success).not.toHaveBeenCalled();
    });
  });

  describe("authorize", () => {
    it("should redirect the browser to the consent URL", async () => {
      req.query = { client_id: "c1", redirect_uri: "https://rp/cb" };
      oidcProviderService.beginAuthorization.mockResolvedValue({
        requestId: "req-1",
        consentUrl: "http://localhost:3000/oauth/consent?request=req-1",
      });

      await oidcProviderController.authorize(req, res, next);

      expect(oidcProviderService.beginAuthorization).toHaveBeenCalledWith(req.query);
      expect(res.redirect).toHaveBeenCalledWith(
        "http://localhost:3000/oauth/consent?request=req-1",
      );
    });
  });

  describe("getAuthRequest", () => {
    it("should return the staged request when found", async () => {
      req.params.requestId = "req-1";
      const data = { clientName: "Acme", scope: ["openid"], redirectUri: "https://rp/cb" };
      oidcProviderService.getAuthRequest.mockResolvedValue(data);

      await oidcProviderController.getAuthRequest(req, res, next);

      expect(success).toHaveBeenCalledWith(
        expect.anything(), data, null, "Authorization request",
      );
    });

    it("should 404 when the request is missing or expired", async () => {
      req.params.requestId = "gone";
      oidcProviderService.getAuthRequest.mockResolvedValue(null);

      await oidcProviderController.getAuthRequest(req, res, next);

      expect(success).toHaveBeenCalledWith(
        expect.anything(), null, null, "Authorization request not found", 404,
      );
    });
  });

  describe("decision", () => {
    it("should approve on boolean true", async () => {
      req.body = { request: "req-1", approve: true };
      oidcProviderService.decideAuthorization.mockResolvedValue({
        redirectTo: "https://rp/cb?code=abc",
      });

      await oidcProviderController.decision(req, res, next);

      expect(oidcProviderService.decideAuthorization).toHaveBeenCalledWith(
        "req-1", req.user, true,
      );
    });

    it("should approve on the string 'true' (form posts)", async () => {
      req.body = { request: "req-1", approve: "true" };
      oidcProviderService.decideAuthorization.mockResolvedValue({ redirectTo: "x" });

      await oidcProviderController.decision(req, res, next);

      expect(oidcProviderService.decideAuthorization).toHaveBeenCalledWith(
        "req-1", req.user, true,
      );
    });

    it("should deny for anything else", async () => {
      req.body = { request: "req-1", approve: false };
      oidcProviderService.decideAuthorization.mockResolvedValue({ redirectTo: "x" });

      await oidcProviderController.decision(req, res, next);

      expect(oidcProviderService.decideAuthorization).toHaveBeenCalledWith(
        "req-1", req.user, false,
      );
    });
  });

  describe("token", () => {
    it("should exchange an authorization code", async () => {
      req.body = {
        grant_type: "authorization_code",
        code: "the-code",
        client_id: "c1",
        client_secret: "s1",
        redirect_uri: "https://rp/cb",
        code_verifier: "v1",
      };
      const tokens = { access_token: "at", id_token: "it" };
      oidcProviderService.exchangeAuthorizationCode.mockResolvedValue(tokens);

      await oidcProviderController.token(req, res, next);

      expect(oidcProviderService.exchangeAuthorizationCode).toHaveBeenCalledWith({
        code: "the-code",
        clientId: "c1",
        clientSecret: "s1",
        redirectUri: "https://rp/cb",
        codeVerifier: "v1",
      });
      expect(res.json).toHaveBeenCalledWith(tokens);
    });

    it("should handle the refresh_token grant", async () => {
      req.body = {
        grant_type: "refresh_token",
        refresh_token: "rt",
        client_id: "c1",
        client_secret: "s1",
      };
      const tokens = { access_token: "at2" };
      oidcProviderService.refreshAccessToken.mockResolvedValue(tokens);

      await oidcProviderController.token(req, res, next);

      expect(oidcProviderService.refreshAccessToken).toHaveBeenCalledWith({
        refreshToken: "rt",
        clientId: "c1",
        clientSecret: "s1",
      });
      expect(res.json).toHaveBeenCalledWith(tokens);
    });

    it("should reject an unsupported grant_type", async () => {
      req.body = { grant_type: "password" };

      await oidcProviderController.token(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: "unsupported_grant_type" });
    });

    it("should default a missing body to an unsupported grant", async () => {
      req.body = undefined;

      await oidcProviderController.token(req, res, next);

      expect(res.json).toHaveBeenCalledWith({ error: "unsupported_grant_type" });
    });

    it("should map a 'code: description' service error to an OAuth error body", async () => {
      req.body = { grant_type: "authorization_code" };
      const err = new Error("invalid_grant: code is invalid or expired");
      err.status = 400;
      oidcProviderService.exchangeAuthorizationCode.mockRejectedValue(err);

      await oidcProviderController.token(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "invalid_grant",
        error_description: "code is invalid or expired",
      });
    });

    it("should fall back to invalid_request for an unformatted error", async () => {
      req.body = { grant_type: "authorization_code" };
      const err = new Error("boom");
      oidcProviderService.exchangeAuthorizationCode.mockRejectedValue(err);

      await oidcProviderController.token(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "invalid_request",
        error_description: "boom",
      });
    });

    it("should default status/error for an error carrying no message", async () => {
      req.body = { grant_type: "authorization_code" };
      const err = new Error("");
      oidcProviderService.exchangeAuthorizationCode.mockRejectedValue(err);

      await oidcProviderController.token(req, res, next);

      // no err.status -> 400; no message -> "invalid_request"
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "invalid_request" }),
      );
    });
  });

  describe("userinfo", () => {
    it("should return claims for a valid Bearer token", async () => {
      req.headers.authorization = "Bearer the-access-token";
      const claims = { sub: "user-1", email: "a@b.c" };
      oidcProviderService.getUserInfo.mockResolvedValue(claims);

      await oidcProviderController.userinfo(req, res, next);

      expect(oidcProviderService.getUserInfo).toHaveBeenCalledWith("the-access-token");
      expect(res.json).toHaveBeenCalledWith(claims);
    });

    it("should 401 when the Authorization header is absent", async () => {
      await oidcProviderController.userinfo(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: "invalid_token" });
    });

    it("should 401 when the scheme is not Bearer", async () => {
      req.headers.authorization = "Basic abc";

      await oidcProviderController.userinfo(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: "invalid_token" });
    });

    it("should surface a verification failure as an OAuth error", async () => {
      req.headers.authorization = "Bearer bad";
      const err = new Error("invalid_token");
      err.status = 401;
      oidcProviderService.getUserInfo.mockRejectedValue(err);

      await oidcProviderController.userinfo(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "invalid_request" }),
      );
    });
  });

  describe("registerClient", () => {
    it("should register a new OIDC client", async () => {
      req.body = { name: "Test App", redirectUris: ["https://app.example.com/callback"] };
      const registered = {
        clientId: "client-123",
        clientSecret: "secret-abc",
        name: "Test App",
        redirectUris: ["https://app.example.com/callback"],
      };
      oidcProviderService.registerClient.mockResolvedValue(registered);

      await oidcProviderController.registerClient(req, res, next);

      expect(validate).toHaveBeenCalledWith(req.body, oidcClientSchema);
      expect(oidcProviderService.registerClient).toHaveBeenCalledWith(VALID_TENANT_ID, { name: "Test App", redirectUris: ["https://app.example.com/callback"] });
      expect(success).toHaveBeenCalled();
    });

    it("should use default scopes and grantTypes", async () => {
      req.body = { name: "Minimal App", redirectUris: ["https://minimal.app/callback"] };
      validate.mockImplementation((data) => {
        return {
          ...data,
          scopes: ["openid", "profile", "email"],
          grantTypes: ["authorization_code"],
        };
      });
      oidcProviderService.registerClient.mockResolvedValue({ clientId: "c1" });

      await oidcProviderController.registerClient(req, res, next);

      expect(oidcProviderService.registerClient).toHaveBeenCalled();
      expect(success).toHaveBeenCalled();
    });

    it("should return 400 on validation failure", async () => {
      validate.mockImplementation((data, schema) => {
        throw { status: 400, message: "Validation failed", errors: { name: "Required" } };
      });
      req.body = { redirectUris: ["https://app.example.com/callback"] };

      await oidcProviderController.registerClient(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(next.mock.calls[0][0].status).toBe(400);
    });
  });

  describe("getClients", () => {
    it("should return all OIDC clients for the tenant", async () => {
      const clients = [{ clientId: "c1", name: "App 1" }, { clientId: "c2", name: "App 2" }];
      oidcProviderService.getClients.mockResolvedValue(clients);

      await oidcProviderController.getClients(req, res, next);

      expect(oidcProviderService.getClients).toHaveBeenCalledWith(VALID_TENANT_ID);
      expect(success).toHaveBeenCalled();
    });

    it("should return empty array when no clients exist", async () => {
      oidcProviderService.getClients.mockResolvedValue([]);

      await oidcProviderController.getClients(req, res, next);

      expect(success).toHaveBeenCalled();
    });
  });

  describe("rotateSecret", () => {
    it("should rotate client secret", async () => {
      req.params = { clientId: "client-123" };
      const rotated = { clientId: "client-123", clientSecret: "new-secret-xyz" };
      oidcProviderService.rotateSecret.mockResolvedValue(rotated);

      await oidcProviderController.rotateSecret(req, res, next);

      expect(oidcProviderService.rotateSecret).toHaveBeenCalledWith(VALID_TENANT_ID, "client-123");
      expect(success).toHaveBeenCalled();
    });
  });

  describe("deleteClient", () => {
    it("should delete an OIDC client", async () => {
      req.params = { clientId: "client-123" };
      oidcProviderService.deleteClient.mockResolvedValue({ deleted: true });

      await oidcProviderController.deleteClient(req, res, next);

      expect(oidcProviderService.deleteClient).toHaveBeenCalledWith(VALID_TENANT_ID, "client-123");
      expect(success).toHaveBeenCalled();
    });

    it("should return deleted false when client not found", async () => {
      req.params = { clientId: "nonexistent" };
      oidcProviderService.deleteClient.mockResolvedValue({ deleted: false });

      await oidcProviderController.deleteClient(req, res, next);

      expect(success).toHaveBeenCalled();
    });
  });
});

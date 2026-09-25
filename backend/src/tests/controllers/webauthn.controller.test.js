/**
 * Tests for webauthn controller
 */

jest.mock("../../services/webauthn.service", () => ({
  getStatus: jest.fn(),
  getRegistrationOptions: jest.fn(),
  verifyRegistration: jest.fn(),
  getLoginOptions: jest.fn(),
  verifyLogin: jest.fn(),
  disable: jest.fn(),
}));

jest.mock("../../utils/response.util", () => ({
  success: jest.fn(),
  error: jest.fn(),
}));

const webauthnController = require("../../controllers/webauthn.controller");
const webauthnService = require("../../services/webauthn.service");
const { success } = require("../../utils/response.util");

const USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const TENANT_ID = "550e8400-e29b-41d4-a716-446655440001";

describe("webauthn Controller", () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    success.mockImplementation((res, data, meta, message, status) => {
      res.status(status || 200).json({ success: true, data, message });
    });
    req = {
      params: {},
      body: {},
      user: { id: USER_ID, tenantId: TENANT_ID, email: "john@example.com" },
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  describe("getStatus", () => {
    it("should return webauthn status for the authenticated user", async () => {
      const status = {
        enabled: true,
        signCount: 3,
        lastUpdatedAt: "2026-07-17T00:00:00.000Z",
      };
      webauthnService.getStatus.mockResolvedValue(status);

      await webauthnController.getStatus(req, res, next);

      // Service signature is getStatus(tenantId, userId) — in that order.
      expect(webauthnService.getStatus).toHaveBeenCalledWith(TENANT_ID, USER_ID);
      expect(success).toHaveBeenCalledWith(res, status, null, "WebAuthn status");
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: status,
        message: "WebAuthn status",
      });
    });

    it("should pass undefined ids when there is no authenticated user", async () => {
      req.user = undefined;
      webauthnService.getStatus.mockResolvedValue({ enabled: false });

      await webauthnController.getStatus(req, res, next);

      expect(webauthnService.getStatus).toHaveBeenCalledWith(undefined, undefined);
      expect(success).toHaveBeenCalled();
    });
  });

  describe("getRegistrationOptions", () => {
    it("should return registration options", async () => {
      webauthnService.getRegistrationOptions.mockResolvedValue({
        challenge: "abc123",
        rp: { name: "Callibrator" },
        user: { id: "user-handle", name: "john@example.com", displayName: "John" },
      });

      await webauthnController.getRegistrationOptions(req, res, next);

      expect(webauthnService.getRegistrationOptions).toHaveBeenCalledWith(req.user);
      expect(success).toHaveBeenCalled();
    });
  });

  describe("verifyRegistration", () => {
    it("should verify registration", async () => {
      req.body = {
        rawId: "abc",
        response: { clientDataJSON: "{}" },
      };
      webauthnService.verifyRegistration.mockResolvedValue({ success: true });

      await webauthnController.verifyRegistration(req, res, next);

      expect(webauthnService.verifyRegistration).toHaveBeenCalledWith(
        TENANT_ID,
        USER_ID,
        req.body,
      );
      expect(success).toHaveBeenCalled();
    });

    it("should handle missing tenantId from user", async () => {
      req.user = { id: "user-2" };
      req.body = { rawId: "abc", response: { clientDataJSON: "{}" } };
      webauthnService.verifyRegistration.mockResolvedValue({ success: true });

      await webauthnController.verifyRegistration(req, res, next);

      expect(webauthnService.verifyRegistration).toHaveBeenCalledWith(
        undefined,
        "user-2",
        req.body,
      );
    });
  });

  describe("getLoginOptions", () => {
    it("should return login options", async () => {
      webauthnService.getLoginOptions.mockResolvedValue({
        challenge: "xyz789",
        rpId: "localhost",
        allowCredentials: [],
      });

      await webauthnController.getLoginOptions(req, res, next);

      expect(webauthnService.getLoginOptions).toHaveBeenCalledWith(USER_ID);
      expect(success).toHaveBeenCalled();
    });
  });

  describe("verifyLogin", () => {
    it("should verify login", async () => {
      req.body = { rawId: "abc", response: { clientDataJSON: "{}" } };
      webauthnService.verifyLogin.mockResolvedValue({ success: true });

      await webauthnController.verifyLogin(req, res, next);

      expect(webauthnService.verifyLogin).toHaveBeenCalledWith(
        TENANT_ID,
        USER_ID,
        req.body,
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("disable", () => {
    it("should disable webauthn", async () => {
      webauthnService.disable.mockResolvedValue({ success: true });

      await webauthnController.disable(req, res, next);

      // A-213: the re-authentication from the body, and the request context
      // for the audit row.
      expect(webauthnService.disable).toHaveBeenCalledWith(
        TENANT_ID,
        USER_ID,
        { currentPassword: undefined, code: undefined, recoveryCode: undefined },
        { ipAddress: null, userAgent: null },
      );
      expect(success).toHaveBeenCalled();
    });

    it("passes the body's re-authentication and the caller's address through (A-213)", async () => {
      webauthnService.disable.mockResolvedValue({ success: true });
      req.body = { currentPassword: "pw", code: "123456", recoveryCode: "R", extra: "ignored" };
      req.ip = "198.51.100.1";
      req.headers = { "user-agent": "ua" };

      await webauthnController.disable(req, res, next);

      expect(webauthnService.disable).toHaveBeenCalledWith(
        TENANT_ID,
        USER_ID,
        { currentPassword: "pw", code: "123456", recoveryCode: "R" },
        { ipAddress: "198.51.100.1", userAgent: "ua" },
      );
    });

    it("tolerates a request with no body (Express 5)", async () => {
      webauthnService.disable.mockResolvedValue({ success: true });
      req.body = undefined;

      await webauthnController.disable(req, res, next);

      expect(webauthnService.disable).toHaveBeenCalledWith(
        TENANT_ID,
        USER_ID,
        { currentPassword: undefined, code: undefined, recoveryCode: undefined },
        expect.any(Object),
      );
    });
  });
});

/**
 * Tests for Auth Controller
 */

// Mock services FIRST (required for --experimental-vm-modules hoisting)
jest.mock("../../services/auth.service", () => ({
  registerUser: jest.fn(),
  activateAccount: jest.fn(),
  loginUser: jest.fn(),
  logoutSession: jest.fn(),
  logoutAllUserSessions: jest.fn(),
  requestOTP: jest.fn(),
  processResetPassword: jest.fn(),
  verifyOtp: jest.fn(),
  verifyEmail: jest.fn(),
  passIsValid: jest.fn(),
  refreshUserToken: jest.fn(),
  verifyUserSession: jest.fn(),
  justUpdatePassword: jest.fn(),
  setupMfa: jest.fn(),
  verifyMfaSetup: jest.fn(),
  loginMfa: jest.fn(),
  impersonateUser: jest.fn(),
}));

// Mock mfa service
jest.mock("../../services/mfa.service", () => ({
  generateSecret: jest.fn(),
  verifyAndEnable: jest.fn(),
}));

// Mock JWT utils for loginMfa
jest.mock("../../utils/jwt.util", () => ({
  verifyAccessToken: jest.fn(),
}));

// Mock response helper FIRST
jest.mock("../../utils/response.util", () => ({
  success: jest.fn(),
  error: jest.fn(),
  login: jest.fn(),
  badRequest: jest.fn(),
}));

const authController = require("../../controllers/auth.controller");
const { authMiddleware } = require("../../middlewares/auth.middleware");
const authService = require("../../services/auth.service");
const {
  success,
  error,
  login,
  badRequest,
} = require("../../utils/response.util");

describe("authController", () => {
  let req;
  let res;

  beforeEach(() => {
    jest.clearAllMocks();

    req = {
      body: {},
      query: {},
      headers: {},
      ip: "127.0.0.1",
      user: { id: "user-1", tenantId: "tenant-1" },
    };

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      locals: {},
    };

    success.mockImplementation((response, data, message) => {
      response.json({ success: true, data, message });
    });
    error.mockImplementation((response, message, status) => {
      response.status(status).json({ success: false, message });
    });
  });

  describe("register", () => {
    it("should register a new user successfully", async () => {
      const mockUserData = {
        username: "testuser",
        email: "test@example.com",
        password: "TestPass123",
      };

      req.body = mockUserData;

      authService.registerUser.mockResolvedValue({
        success: true,
        status: 201,
        message:
          "Registration successful. Please check your email to activate your account.",
        data: { email: "test@example.com" },
      });

      req.headers.origin = "http://localhost:3000";

      await authController.register(req, res);

      expect(authService.registerUser).toHaveBeenCalledWith(
        mockUserData,
        "http://localhost:3000",
      );
      expect(success).toHaveBeenCalled();
    });

    it("should return 400 when registration fails", async () => {
      req.body = {
        email: "existing@example.com",
        password: "TestPass123",
      };

      authService.registerUser.mockRejectedValue(
        new Error("Email already registered"),
      );

      await authController.register(req, res);

      expect(error).toHaveBeenCalled();
    });
  });

  describe("activation", () => {
    it("should activate user account successfully", async () => {
      req.query = { token: "activation-token-123" };

      authService.activateAccount.mockResolvedValue({
        success: true,
        status: 200,
        message: "Account activated successfully",
      });

      await authController.activation(req, res);

      expect(authService.activateAccount).toHaveBeenCalledWith(
        "activation-token-123",
      );
      expect(success).toHaveBeenCalled();
    });

    it("should return 400 when activation token is missing", async () => {
      req.query = {};

      await authController.activation(req, res);

      expect(error).toHaveBeenCalled();
    });

    it("should return 400 when activation token is invalid", async () => {
      req.query = { token: "invalid-token" };

      authService.activateAccount.mockRejectedValue(
        new Error("Invalid or expired activation token"),
      );

      await authController.activation(req, res);

      expect(error).toHaveBeenCalled();
    });
  });

  describe("login", () => {
    it("should login successfully with valid credentials", async () => {
      const mockCredentials = {
        email: "test@example.com",
        password: "TestPass123",
      };

      req.body = mockCredentials;

      authService.loginUser.mockResolvedValue({
        success: true,
        status: 200,
        message: "Login successful",
        data: {
          user: { id: "user-1", email: "test@example.com" },
          token: "access-token",
          session: { id: "session-1" },
        },
      });

      req.headers["user-agent"] = "jest-agent";

      await authController.login(req, res);

      expect(authService.loginUser).toHaveBeenCalledWith({
        ...mockCredentials,
        ip: "127.0.0.1",
        userAgent: "jest-agent",
      });
      expect(login).toHaveBeenCalled();
    });

    it("should return 401 with invalid credentials", async () => {
      req.body = {
        email: "wrong@example.com",
        password: "wrongpassword",
      };

      authService.loginUser.mockRejectedValue(new Error("Invalid credentials"));

      await authController.login(req, res);

      expect(error).toHaveBeenCalled();
    });
  });

  describe("logout", () => {
    it("should logout successfully", async () => {
      authService.logoutSession.mockResolvedValue({
        success: true,
        status: 200,
        message: "Logout successful",
      });

      await authController.logout(req, res);

      expect(authService.logoutSession).toHaveBeenCalled();
      expect(success).toHaveBeenCalled();
    });
  });

  describe("logoutAll", () => {
    it("should logout all sessions successfully", async () => {
      req.user = { id: "user-1" };

      authService.logoutAllUserSessions.mockResolvedValue({
        success: true,
        status: 200,
        message: "All sessions revoked successfully",
      });

      await authController.logoutAll(req, res);

      expect(authService.logoutAllUserSessions).toHaveBeenCalledWith("user-1");
      expect(success).toHaveBeenCalled();
    });
  });

  describe("sendOTP", () => {
    it("should send OTP successfully", async () => {
      req.body = { email: "test@example.com" };

      authService.requestOTP.mockResolvedValue({
        success: true,
        status: 200,
        message: "If the account exists, OTP has been sent",
      });

      await authController.sendOTP(req, res);

      expect(authService.requestOTP).toHaveBeenCalledWith(req.body);
      expect(success).toHaveBeenCalled();
    });
  });

  describe("resetPassword", () => {
    it("should reset password successfully", async () => {
      req.body = {
        email: "test@example.com",
        otp: "123456",
        newPassword: "NewPass123",
      };

      authService.processResetPassword.mockResolvedValue({
        success: true,
        status: 200,
        message: "Password reset successful",
      });

      await authController.resetPassword(req, res);

      expect(authService.processResetPassword).toHaveBeenCalledWith(req.body);
      expect(success).toHaveBeenCalled();
    });
  });

  describe("verify", () => {
    it("should verify token successfully", async () => {
      req.user = { id: "user-1", email: "test@example.com" };
      req.session = { id: "session-1" };

      authService.verifyUserSession.mockResolvedValue({
        success: true,
        status: 200,
        data: { user: { id: "user-1" } },
      });

      await authController.verify(req, res);

      expect(success).toHaveBeenCalled();
    });
  });

  describe("justUpdatePassword", () => {
    it("should update password successfully", async () => {
      req.user = { id: "user-1" };
      req.body = { newPassword: "NewPass123", currentPassword: "OldPass123" };

      authService.justUpdatePassword.mockResolvedValue({
        success: true,
        status: 200,
        message: "Password updated successfully",
      });

      await authController.justUpdatePassword(req, res);

      // The current password must be forwarded so the service can re-authenticate.
      expect(authService.justUpdatePassword).toHaveBeenCalledWith(
        "user-1",
        "NewPass123",
        "OldPass123",
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("passIsValid", () => {
    it("should validate password successfully", async () => {
      req.user = { id: "user-1" };
      req.body = { password: "TestPass123" };

      authService.passIsValid.mockResolvedValue({
        success: true,
        status: 200,
        data: { isValid: true },
        message: "Password is valid",
      });

      await authController.passIsValid(req, res);

      expect(authService.passIsValid).toHaveBeenCalledWith(
        "user-1",
        "TestPass123",
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("refresh", () => {
    it("should refresh token successfully", async () => {
      req.body = { refreshToken: "refresh-token-123", sessionId: "session-1" };
      req.ip = "127.0.0.1";
      req.headers["user-agent"] = "jest-agent";

      authService.refreshUserToken.mockResolvedValue({
        success: true,
        status: 200,
        data: { token: "new-access-token" },
        message: "Token refreshed successfully",
      });

      await authController.refresh(req, res);

      expect(authService.refreshUserToken).toHaveBeenCalledWith(
        "refresh-token-123",
        "session-1",
        "127.0.0.1",
        "jest-agent",
      );
      expect(success).toHaveBeenCalled();
    });

    it("should refresh token successfully without sessionId", async () => {
      req.body = { refreshToken: "refresh-token-123" };
      req.ip = "127.0.0.1";
      req.headers["user-agent"] = "jest-agent";

      authService.refreshUserToken.mockResolvedValue({
        success: true,
        status: 200,
        data: { token: "new-access-token" },
        message: "Token refreshed successfully",
      });

      await authController.refresh(req, res);

      expect(authService.refreshUserToken).toHaveBeenCalledWith(
        "refresh-token-123",
        null,
        "127.0.0.1",
        "jest-agent",
      );
      expect(success).toHaveBeenCalled();
    });

    it("should return 400 when refresh token is missing", async () => {
      req.body = {};

      await authController.refresh(req, res);

      expect(error).toHaveBeenCalled();
    });
  });

  describe("socketToken", () => {
    it("should return socket JWT token successfully", async () => {
      req.user = { id: "user-1" };
      process.env.JWT_ACCESS_SECRET = "test-secret-key-for-jwt-signing";

      await authController.socketToken(req, res);

      expect(success).toHaveBeenCalled();
      const callArgs = success.mock.calls[0];
      expect(callArgs[1]).toHaveProperty("token");
      expect(callArgs[1]).toHaveProperty("expiresIn", 300);
    });

    it("should return socket JWT token without sessionId", async () => {
      req.user = { id: "user-2" };
      process.env.JWT_ACCESS_SECRET = "test-secret-key-for-jwt-signing";

      await authController.socketToken(req, res);

      expect(success).toHaveBeenCalled();
      const callArgs = success.mock.calls[0];
      expect(callArgs[1].token).toBeDefined();
      expect(callArgs[1].expiresIn).toBe(300);
    });
  });

  // These handlers used to be DEFINED TWICE in auth.controller.js. The second
  // (mfaService-backed) block silently shadowed the authService-backed ones,
  // and its loginMfa was a stub that always threw 501 — so MFA login could
  // never work. The duplicates are gone; these tests target the live,
  // authService-backed handlers.
  describe("setupMfa", () => {
    it("should generate the MFA secret via authService", async () => {
      authService.setupMfa.mockResolvedValue({
        secret: "JBSWY3DPEHPK3PXP",
        qrCodeDataUrl: "data:image/png;base64,iVBOR...",
      });

      await authController.setupMfa(req, res);

      expect(authService.setupMfa).toHaveBeenCalledWith(req.user.id);
      expect(success).toHaveBeenCalledWith(
        res,
        expect.objectContaining({ secret: "JBSWY3DPEHPK3PXP" }),
        null,
        "MFA secret generated",
        200,
      );
    });
  });

  describe("verifyMfaSetup", () => {
    it("should verify the setup code via authService", async () => {
      req.body = { code: "123456" };
      authService.verifyMfaSetup.mockResolvedValue({ message: "MFA enabled" });

      await authController.verifyMfaSetup(req, res);

      expect(authService.verifyMfaSetup).toHaveBeenCalledWith(
        req.user.id,
        "123456",
      );
      expect(success).toHaveBeenCalledWith(res, null, null, "MFA enabled", 200);
    });

    it("should return 400 when the code is missing", async () => {
      req.body = {};

      await authController.verifyMfaSetup(req, res);

      expect(authService.verifyMfaSetup).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(res, "MFA code is required", 400);
    });

    it("should map an invalid code to 400", async () => {
      req.body = { code: "000000" };
      authService.verifyMfaSetup.mockRejectedValue(new Error("Invalid MFA code"));

      await authController.verifyMfaSetup(req, res);

      expect(error).toHaveBeenCalledWith(res, "Invalid MFA code", 400);
    });
  });

  describe("loginMfa", () => {
    const { verifyAccessToken } = require("../../utils/jwt.util");

    it("should complete the MFA login and issue a session", async () => {
      req.body = { code: "123456", token: "temp-mfa-token" };
      verifyAccessToken.mockReturnValue({ id: "user-1", mfaRequired: true });
      authService.loginMfa.mockResolvedValue({
        data: { id: "user-1" },
        token: "jwt",
        session: { id: "sess-1" },
      });

      await authController.loginMfa(req, res);

      expect(verifyAccessToken).toHaveBeenCalledWith("temp-mfa-token");
      expect(authService.loginMfa).toHaveBeenCalledWith(
        "user-1",
        "123456",
        req.ip,
        req.headers["user-agent"],
      );
      expect(login).toHaveBeenCalledWith(
        res,
        { id: "user-1" },
        "jwt",
        { id: "sess-1" },
      );
    });

    it("should return 400 when both code and token are missing", async () => {
      req.body = {};

      await authController.loginMfa(req, res);

      expect(error).toHaveBeenCalledWith(
        res,
        "MFA code and temporary token are required",
        400,
      );
      expect(authService.loginMfa).not.toHaveBeenCalled();
    });

    it("should return 400 when only the code is supplied", async () => {
      req.body = { code: "123456" };

      await authController.loginMfa(req, res);

      expect(error).toHaveBeenCalledWith(
        res,
        "MFA code and temporary token are required",
        400,
      );
    });

    it("should return 401 for an unverifiable temporary token", async () => {
      req.body = { code: "123456", token: "bad" };
      verifyAccessToken.mockImplementation(() => {
        throw new Error("jwt malformed");
      });

      await authController.loginMfa(req, res);

      expect(error).toHaveBeenCalledWith(
        res,
        "Invalid or expired login token",
        401,
      );
      expect(authService.loginMfa).not.toHaveBeenCalled();
    });

    it("should return 401 when the token is not an MFA-stage token", async () => {
      req.body = { code: "123456", token: "full-token" };
      // A normal access token has no mfaRequired flag.
      verifyAccessToken.mockReturnValue({ id: "user-1" });

      await authController.loginMfa(req, res);

      expect(error).toHaveBeenCalledWith(res, "Invalid token payload", 401);
      expect(authService.loginMfa).not.toHaveBeenCalled();
    });

    it("should return 401 when the token carries no user id", async () => {
      req.body = { code: "123456", token: "t" };
      verifyAccessToken.mockReturnValue({ mfaRequired: true });

      await authController.loginMfa(req, res);

      expect(error).toHaveBeenCalledWith(res, "Invalid token payload", 401);
    });

    it("should map an invalid MFA code to 401", async () => {
      req.body = { code: "000000", token: "temp-mfa-token" };
      verifyAccessToken.mockReturnValue({ id: "user-1", mfaRequired: true });
      authService.loginMfa.mockRejectedValue(new Error("Invalid MFA code"));

      await authController.loginMfa(req, res);

      expect(error).toHaveBeenCalledWith(res, "Invalid MFA code", 401);
      expect(login).not.toHaveBeenCalled();
    });
  });

  describe("impersonateUser", () => {
    it("should impersonate user successfully", async () => {
      req.body = { tenantId: "tenant-1", userId: "target-user-1" };
      req.ip = "127.0.0.1";
      req.headers["user-agent"] = "test-agent";

      authService.impersonateUser.mockResolvedValue({
        data: { user: { id: "target-user-1" } },
        token: "access-token",
        session: { id: "session-1" },
      });

      await authController.impersonateUser(req, res);

      expect(authService.impersonateUser).toHaveBeenCalledWith(
        "user-1",
        "tenant-1",
        "target-user-1",
        "127.0.0.1",
        "test-agent",
      );
      expect(login).toHaveBeenCalled();
    });

    it("should return 400 when tenantId is missing", async () => {
      req.body = { userId: "target-user-1" };

      await authController.impersonateUser(req, res);

      expect(error).toHaveBeenCalled();
    });

    it("should return 400 when userId is missing", async () => {
      req.body = { tenantId: "tenant-1" };

      await authController.impersonateUser(req, res);

      expect(error).toHaveBeenCalled();
    });

    it("should return 400 when both tenantId and userId are missing", async () => {
      req.body = {};

      await authController.impersonateUser(req, res);

      expect(error).toHaveBeenCalled();
    });
  });
});

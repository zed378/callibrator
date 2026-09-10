// eslint-disable-next-line no-undef
// Math and crypto are global objects used in jest.spyOn()
jest.mock("../../config");
jest.mock("../../models", () => ({
  Users: {
    findOne: jest.fn(),
    findByPk: jest.fn(),
    create: jest.fn(),
  },
  Roles: { findOne: jest.fn() },
}));
jest.mock("../../utils/password.util");
jest.mock("../../utils/jwt.util");
jest.mock("../../services/session.service");
jest.mock("../../services/emailQueue.service");
jest.mock("../../services/redis.service", () => ({
  acquireLock: jest.fn(),
  releaseLock: jest.fn().mockResolvedValue(true),
  get: jest.fn(),
  set: jest.fn().mockResolvedValue(true),
  del: jest.fn().mockResolvedValue(true),
  cacheKeys: {
    userByEmail: jest.fn((e) => `user:email:${e}`),
    userByUsername: jest.fn((u) => `user:username:${u}`),
    userSession: jest.fn((id) => `user:session:${id}`),
    userSessions: jest.fn((id) => `user:sessions:${id}`),
  },
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../../utils/appError.util", () => {
  const { AppError: RealAppError } = jest.requireActual(
    "../../utils/appError.util",
  );
  return { AppError: RealAppError };
});
jest.mock("../../validators/auth.validator", () => ({
  validate: jest.fn((data, schema) => ({
    value: { user: data.user || data.username, ...data },
    error: null,
  })),
  formatErrors: jest.fn((d) => d),
  registerSchema: {
    safeParse: jest.fn((data) => {
      const errors = [];
      if (!data.email) {
        errors.push({ path: ["email"], message: "Required" });
      }
      if (!data.password) {
        errors.push({ path: ["password"], message: "Required" });
      }
      if (!data.firstName) {
        errors.push({ path: ["firstName"], message: "Required" });
      }
      if (data.password && data.password.length < 8) {
        errors.push({ path: ["password"], message: "Too short" });
      }
      return {
        success: errors.length === 0,
        data: { ...data },
        error: errors.length > 0 ? { errors } : null,
      };
    }),
  },
  loginSchema: {
    safeParse: jest.fn((data) => {
      const errors = [];
      if (!data.email && !data.username) {
        errors.push({ path: ["email"], message: "Required" });
      }
      if (!data.password) {
        errors.push({ path: ["password"], message: "Required" });
      }
      return {
        success: errors.length === 0,
        data: { ...data },
        error: errors.length > 0 ? { errors } : null,
      };
    }),
  },
  forgotPasswordSchema: {
    safeParse: jest.fn((data) => {
      const errors = [];
      if (!data.email) {
        errors.push({ path: ["email"], message: "Required" });
      }
      return {
        success: errors.length === 0,
        data: { ...data },
        error: errors.length > 0 ? { errors } : null,
      };
    }),
  },
  resetPasswordSchema: {
    safeParse: jest.fn((data) => {
      const errors = [];
      if (!data.token) {
        errors.push({ path: ["token"], message: "Required" });
      }
      if (!data.otp) {
        errors.push({ path: ["otp"], message: "Required" });
      }
      if (!data.password) {
        errors.push({ path: ["password"], message: "Required" });
      }
      return {
        success: errors.length === 0,
        data: { ...data },
        error: errors.length > 0 ? { errors } : null,
      };
    }),
  },
}));

const { db } = require("../../config");
const { Users, Roles } = require("../../models");
const { hashPassword, comparePassword } = require("../../utils/password.util");
const {
  generateAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  generateOpaqueRefreshToken,
} = require("../../utils/jwt.util");
const {
  createSession,
  validateSession,
  revokeSession,
  revokeAllSessions,
} = require("../../services/session.service");
const {
  queueActivationEmail,
  queueOtpEmail,
} = require("../../services/emailQueue.service");
const {
  acquireLock,
  releaseLock,
  get,
  set,
  del,
  cacheKeys,
} = require("../../services/redis.service");
const { logger } = require("../../middlewares/activityLog.middleware");
const {
  PASSWORD_MIN_LENGTH,
  ROLE_IDS,
  DEFAULT_SESSION_EXPIRY_HOURS,
} = require("../../constants");

const {
  registerUser,
  loginUser,
  activateAccount,
  requestOTP,
  processResetPassword,
  verifyUserSession,
  getAuthUserWithTenant,
  justUpdatePassword,
  passIsValid,
  logoutSession,
  logoutAllUserSessions,
  refreshUserToken,
  loginMfa,
  setupMfa,
  verifyMfaSetup,
  impersonateUser,
} = require("../../services/auth.service");

describe("auth.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_SECRET = "test-secret";
    process.env.JWT_ACCESS_SECRET = "test-access-secret";
    process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
    process.env.JWT_ACCESS_EXPIRED = "15m";
    process.env.JWT_REFRESH_EXPIRED = "7d";
  });

  // ========================
  // REGISTER
  // ========================
  describe("registerUser", () => {
    it("should register a new user", async () => {
      Users.findOne.mockResolvedValue(null);
      hashPassword.mockResolvedValue("hashed-password");
      Users.create.mockResolvedValue({
        id: "user-1",
        email: "test@example.com",
        firstName: "Test",
        lastName: "User",
        isActive: true,
        role: { id: "role-1", name: "USER", role_level: 1 },
      });

      const { acquireLock } = require("../../services/redis.service");
      acquireLock.mockResolvedValue("mock-lock-id");

      db.transaction.mockResolvedValue({
        commit: jest.fn(),
        rollback: jest.fn(),
        LOCK: { UPDATE: "UPDATE" },
      });

      const result = await registerUser(
        {
          email: "test@example.com",
          password: "password123",
          firstName: "Test",
          lastName: "User",
          username: "testuser",
        },
        "http://localhost",
      );

      expect(result.status).toBe(201);
      expect(result.message).toBe("Registration successful");
      expect(Users.create).toHaveBeenCalled();
      expect(queueActivationEmail).toHaveBeenCalled();
    });
  });

  // ========================
  // LOGIN
  // ========================
  describe("loginUser", () => {
    it("should login with username and return opaque refresh token", async () => {
      const mockUser = {
        id: "user-1",
        username: "testuser",
        email: "test@example.com",
        password: "hashed-password",
        isActive: true,
        tenantId: "tenant-1",
        failedLoginAttempts: 0,
        lockedUntil: null,
        update: jest.fn().mockResolvedValue({}),
      };
      Users.findOne.mockResolvedValue(mockUser);
      comparePassword.mockResolvedValue(true);
      generateAccessToken.mockReturnValue("access-token");
      generateOpaqueRefreshToken.mockReturnValue("opaque-refresh-token");
      createSession.mockResolvedValue({
        sessionId: "session-1",
        id: "session-1",
      });

      const result = await loginUser({
        username: "testuser",
        password: "password123",
        ip: "127.0.0.1",
        userAgent: "test-agent",
      });

      expect(result.status).toBe(200);
      expect(result.message).toBe("Login successful");
      expect(result.refreshToken).toBe("opaque-refresh-token");
      expect(generateOpaqueRefreshToken).toHaveBeenCalled();
      expect(generateRefreshToken).not.toHaveBeenCalled(); // should NOT use JWT refresh
    });

    it("should reject inactive user", async () => {
      Users.findOne.mockResolvedValue({
        id: "user-1",
        username: "testuser",
        password: "hashed-password",
        isActive: false,
      });

      await expect(
        loginUser({ username: "testuser", password: "password123" }),
      ).rejects.toThrow("Account is suspended");
    });

    it("should reject wrong password", async () => {
      Users.findOne.mockResolvedValue({
        id: "user-1",
        username: "testuser",
        password: "hashed-password",
        isActive: true,
        failedLoginAttempts: 0,
        lockedUntil: null,
        update: jest.fn().mockResolvedValue({}),
      });
      comparePassword.mockResolvedValue(false);

      await expect(
        loginUser({ username: "testuser", password: "wrong" }),
      ).rejects.toThrow("Invalid credentials");
    });
  });

  // ========================
  // LOGOUT
  // ========================
  describe("logoutSession", () => {
    it("should revoke the current session token", async () => {
      const mockReq = {
        token: "some-refresh-token",
      };
      const result = await logoutSession(mockReq);

      expect(result.status).toBe(200);
      expect(result.message).toBe("Logout successful");
      expect(revokeSession).toHaveBeenCalledWith(
        "some-refresh-token",
        "LOGOUT",
      );
    });

    it("should not fail if no token present", async () => {
      const mockReq = { token: null };
      const result = await logoutSession(mockReq);

      expect(result.status).toBe(200);
      expect(revokeSession).not.toHaveBeenCalled();
    });
  });

  // ========================
  // REFRESH USER TOKEN
  // ========================
  describe("refreshUserToken", () => {
    it("should refresh token successfully with rotation", async () => {
      const mockSession = {
        id: "session-1",
        userId: "user-1",
        user_id: "user-1",
        tenantId: "tenant-1",
        tenant_id: "tenant-1",
        ipAddress: "127.0.0.1",
        ip_address: "127.0.0.1",
        userAgent: "test-agent",
        user_agent: "test-agent",
        device: "desktop",
      };
      const mockUser = {
        id: "user-1",
        email: "test@example.com",
      };

      validateSession.mockResolvedValue(mockSession);
      Users.findByPk.mockResolvedValue(mockUser);
      generateAccessToken.mockReturnValue("new-access-token");
      generateOpaqueRefreshToken.mockReturnValue("new-opaque-token");
      revokeSession.mockResolvedValue(1);
      createSession.mockResolvedValue({
        sessionId: "session-2",
        id: "session-2",
      });

      const result = await refreshUserToken(
        "old-token",
        "session-1",
        "127.0.0.1",
        "test-agent",
      );

      expect(result.status).toBe(200);
      expect(result.data.token).toBe("new-access-token");
      expect(result.data.refreshToken).toBe("new-opaque-token");
      expect(result.message).toBe("Token refreshed successfully");
      expect(revokeSession).toHaveBeenCalledWith("old-token", "TOKEN_ROTATION");
      expect(createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          refreshToken: "new-opaque-token",
          userId: "user-1",
        }),
      );
    });

    it("should reject invalid refresh token", async () => {
      validateSession.mockResolvedValue(null);

      await expect(refreshUserToken("bad-token")).rejects.toThrow(
        "Invalid or expired refresh token",
      );
    });

    it("should reject session mismatch and revoke all sessions", async () => {
      const mockSession = {
        id: "session-1",
        userId: "user-1",
        user_id: "user-1",
        tenantId: "tenant-1",
        tenant_id: "tenant-1",
        ipAddress: "127.0.0.1",
        ip_address: "127.0.0.1",
        userAgent: "test-agent",
        user_agent: "test-agent",
        device: "desktop",
      };

      validateSession.mockResolvedValue(mockSession);
      Users.findByPk.mockResolvedValue({ id: "user-1" });
      generateOpaqueRefreshToken.mockReturnValue("new-token");
      generateAccessToken.mockReturnValue("new-access");
      revokeSession.mockResolvedValue(1);
      createSession.mockResolvedValue({
        sessionId: "session-2",
        id: "session-2",
      });

      // Pass a different sessionId — should trigger mismatch
      await expect(
        refreshUserToken("old-token", "wrong-session-id"),
      ).rejects.toThrow("Session mismatch");

      expect(revokeAllSessions).toHaveBeenCalledWith(
        "user-1",
        "TOKEN_MISMATCH",
      );
    });

    it("should reject when user not found", async () => {
      validateSession.mockResolvedValue({
        id: "session-1",
        userId: "user-1",
        user_id: "user-1",
        tenantId: "tenant-1",
        tenant_id: "tenant-1",
        ipAddress: "127.0.0.1",
        ip_address: "127.0.0.1",
        userAgent: "test-agent",
        user_agent: "test-agent",
        device: "desktop",
      });
      Users.findByPk.mockResolvedValue(null);

      await expect(refreshUserToken("old-token")).rejects.toThrow(
        "User not found",
      );
    });

    it("should use session IP when ipAddress not provided", async () => {
      const mockSession = {
        id: "session-1",
        userId: "user-1",
        user_id: "user-1",
        tenantId: "tenant-1",
        tenant_id: "tenant-1",
        ipAddress: "192.168.1.1",
        ip_address: "192.168.1.1",
        userAgent: "test-agent",
        user_agent: "test-agent",
        device: "desktop",
      };

      validateSession.mockResolvedValue(mockSession);
      Users.findByPk.mockResolvedValue({ id: "user-1" });
      generateOpaqueRefreshToken.mockReturnValue("new-token");
      generateAccessToken.mockReturnValue("new-access");
      revokeSession.mockResolvedValue(1);
      createSession.mockResolvedValue({
        sessionId: "session-2",
        id: "session-2",
      });

      await refreshUserToken("old-token", "session-1");

      expect(createSession).toHaveBeenCalledWith(
        expect.objectContaining({ ipAddress: "192.168.1.1" }),
      );
    });
  });

  // ========================
  // LOGOUT ALL
  // ========================
  describe("logoutAllUserSessions", () => {
    it("should revoke all sessions", async () => {
      const result = await logoutAllUserSessions("user-1");

      expect(result.status).toBe(200);
      expect(result.message).toBe("All sessions revoked successfully");
      expect(revokeAllSessions).toHaveBeenCalledWith(
        "user-1",
        "USER_REQUESTED",
      );
    });
  });

  // ========================
  // ACTIVATE ACCOUNT
  // ========================
  describe("activateAccount", () => {
    it("should activate an unverified user account", async () => {
      const decodedToken = { id: "user-1" };
      verifyAccessToken.mockReturnValue(decodedToken);

      const mockUser = {
        id: "user-1",
        email: "test@example.com",
        username: "testuser",
        isEmailVerified: false,
        update: jest.fn().mockResolvedValue({}),
      };
      Users.findByPk.mockResolvedValue(mockUser);

      const result = await activateAccount("valid-token");

      expect(result.status).toBe(200);
      expect(result.message).toBe("Account activated successfully");
      expect(mockUser.update).toHaveBeenCalledWith({ isEmailVerified: true });
      expect(del).toHaveBeenCalledWith(
        cacheKeys.userByEmail("test@example.com"),
      );
      expect(del).toHaveBeenCalledWith(cacheKeys.userByUsername("testuser"));
    });

    it("should return success for already activated account", async () => {
      verifyAccessToken.mockReturnValue({ id: "user-1" });

      const mockUser = {
        id: "user-1",
        isEmailVerified: true,
      };
      Users.findByPk.mockResolvedValue(mockUser);

      const result = await activateAccount("valid-token");

      expect(result.status).toBe(200);
      expect(result.message).toBe("Account already activated");
    });

    it("should reject when user not found", async () => {
      verifyAccessToken.mockReturnValue({ id: "nonexistent" });
      Users.findByPk.mockResolvedValue(null);

      await expect(activateAccount("valid-token")).rejects.toThrow(
        "User not found",
      );
    });
  });

  // ========================
  // REQUEST OTP
  // ========================
  describe("requestOTP", () => {
    const crypto = require("crypto");

    beforeEach(() => {
      jest.spyOn(Math, "random").mockReturnValue(0.5);
      jest.spyOn(crypto, "createHash").mockImplementation(() => ({
        update: jest.fn().mockReturnThis(),
        digest: jest.fn().mockReturnValue("mock-hash"),
      }));
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("should return success when user exists and send OTP", async () => {
      const mockUser = {
        id: "user-1",
        email: "test@example.com",
        firstName: "Test",
        lastName: "User",
        otpRequestCount: 0,
        otpLastRequestedAt: null,
        update: jest.fn().mockResolvedValue({}),
      };
      Users.findOne.mockResolvedValue(mockUser);

      const result = await requestOTP({ email: "test@example.com" });

      expect(result.status).toBe(200);
      expect(result.message).toBe("OTP sent");
      expect(mockUser.update).toHaveBeenCalled();
      // queueOtpEmail takes ONE destructured object. This used to assert the
      // broken (email, {...}) call — which pinned a bug that sent OTP mail
      // with no recipient and no code, because every field was destructured
      // off the email string.
      expect(queueOtpEmail).toHaveBeenCalledWith({
        email: "test@example.com",
        firstName: "Test",
        lastName: "User",
        otp: expect.any(String),
      });
    });

    it("should return generic success when user does not exist", async () => {
      Users.findOne.mockResolvedValue(null);

      const result = await requestOTP({ email: "nonexistent@example.com" });

      expect(result.status).toBe(200);
      expect(result.message).toBe("If the account exists, OTP has been sent");
      expect(queueOtpEmail).not.toHaveBeenCalled();
    });
  });

  // ========================
  // PROCESS RESET PASSWORD
  // ========================
  describe("processResetPassword", () => {
    const crypto = require("crypto");

    beforeEach(() => {
      jest.spyOn(crypto, "createHash").mockImplementation(() => ({
        update: jest.fn().mockReturnThis(),
        digest: jest.fn().mockReturnValue("matching-hash"),
      }));
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("should reset password with valid OTP", async () => {
      hashPassword.mockResolvedValue("new-hashed-password");

      const mockUser = {
        id: "user-1",
        email: "test@example.com",
        otpCode: "matching-hash",
        otpExpiredAt: new Date(Date.now() + 60000), // 1 minute in future
        update: jest.fn().mockResolvedValue({}),
      };
      Users.findOne.mockResolvedValue(mockUser);

      const result = await processResetPassword({
        email: "test@example.com",
        otp: "test-otp",
        newPassword: "newpassword123",
      });

      expect(result.status).toBe(200);
      expect(result.message).toBe("Password reset successful");
      expect(mockUser.update).toHaveBeenCalledWith(
        expect.objectContaining({
          password: "new-hashed-password",
          otpCode: null,
          otpExpiredAt: null,
        }),
      );
      expect(revokeAllSessions).toHaveBeenCalledWith(
        "user-1",
        "PASSWORD_RESET",
      );
    });

    it("should reject an unknown account with the same generic error as a bad OTP (no enumeration)", async () => {
      Users.findOne.mockResolvedValue(null);

      await expect(
        processResetPassword({
          email: "nonexistent@example.com",
          otp: "123456",
          newPassword: "newpassword123",
        }),
      ).rejects.toThrow("Invalid OTP");
    });

    it("should reject invalid OTP", async () => {
      const mockUser = {
        id: "user-1",
        otpCode: "different-hash",
        otpExpiredAt: new Date(Date.now() + 60000),
      };
      Users.findOne.mockResolvedValue(mockUser);

      await expect(
        processResetPassword({
          email: "test@example.com",
          otp: "wrong-otp",
          newPassword: "newpassword123",
        }),
      ).rejects.toThrow("Invalid OTP");
    });

    it("should reject expired OTP", async () => {
      const mockUser = {
        id: "user-1",
        otpCode: "matching-hash",
        otpExpiredAt: new Date(Date.now() - 60000), // expired
      };
      Users.findOne.mockResolvedValue(mockUser);

      await expect(
        processResetPassword({
          email: "test@example.com",
          otp: "123456",
          newPassword: "newpassword123",
        }),
      ).rejects.toThrow("OTP expired");
    });
  });

  // ========================
  // VERIFY USER SESSION
  // ========================
  describe("verifyUserSession", () => {
    it("should return user data for valid session", async () => {
      const mockUser = {
        id: "user-1",
        username: "testuser",
        email: "test@example.com",
        firstName: "Test",
        lastName: "User",
        first_name: "Test",
        last_name: "User",
        picture: "pic.jpg",
        roleId: "role-1",
        tenantId: "tenant-1",
        isActive: true,
        role: { id: "role-1", name: "USER" },
      };
      Users.findByPk.mockResolvedValue(mockUser);

      const result = await verifyUserSession("user-1", null);

      expect(result.status).toBe(200);
      expect(result.message).toBe("Token valid");
      expect(result.data.id).toBe("user-1");
      expect(result.data.role).toEqual({ id: "role-1", name: "USER" });
    });

    it("should reject when user not found", async () => {
      Users.findByPk.mockResolvedValue(null);

      await expect(verifyUserSession("nonexistent", null)).rejects.toThrow(
        "Invalid session",
      );
    });

    it("should reject suspended user", async () => {
      const mockUser = {
        id: "user-1",
        isActive: false,
      };
      Users.findByPk.mockResolvedValue(mockUser);

      await expect(verifyUserSession("user-1", null)).rejects.toThrow(
        "Account is suspended",
      );
    });
  });

  // ========================
  // GET AUTH USER WITH TENANT
  // ========================
  describe("getAuthUserWithTenant", () => {
    it("should return user with role and tenant", async () => {
      const mockUser = {
        id: "user-1",
        role: { id: "role-1", name: "USER", description: "Regular user" },
        tenant: { id: "tenant-1", name: "My Tenant", status: "active" },
      };
      Users.findByPk.mockResolvedValue(mockUser);

      const result = await getAuthUserWithTenant("user-1");

      expect(result).toEqual(mockUser);
      expect(Users.findByPk).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({ include: expect.any(Array) }),
      );
    });
  });

  // ========================
  // JUST UPDATE PASSWORD
  // ========================
  describe("justUpdatePassword", () => {
    it("should update password and revoke sessions", async () => {
      hashPassword.mockResolvedValue("new-hashed-password");
      comparePassword.mockResolvedValue(true);

      const mockUser = {
        id: "user-1",
        password: "old-hashed-password",
        update: jest.fn().mockResolvedValue({}),
      };
      Users.findByPk.mockResolvedValue(mockUser);

      const result = await justUpdatePassword(
        "user-1",
        "newpassword123",
        "current-password",
      );

      expect(result.status).toBe(200);
      expect(result.message).toBe("Password updated successfully");
      expect(mockUser.update).toHaveBeenCalledWith(
        expect.objectContaining({
          password: "new-hashed-password",
          passwordChangedAt: expect.any(Date),
        }),
      );
      expect(revokeAllSessions).toHaveBeenCalledWith(
        "user-1",
        "PASSWORD_CHANGED",
      );
    });

    it("should reject when user not found", async () => {
      Users.findByPk.mockResolvedValue(null);

      await expect(
        justUpdatePassword("nonexistent", "newpassword123"),
      ).rejects.toThrow("User not found");
    });

    it("should reject password below minimum length", async () => {
      await expect(justUpdatePassword("user-1", "short")).rejects.toThrow(
        `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
      );
    });

    it("should reject empty password", async () => {
      await expect(justUpdatePassword("user-1", "")).rejects.toThrow(
        `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
      );
    });

    it("should reject when the current password is missing", async () => {
      const mockUser = {
        id: "user-1",
        password: "old-hashed-password",
        update: jest.fn(),
      };
      Users.findByPk.mockResolvedValue(mockUser);

      await expect(
        justUpdatePassword("user-1", "newpassword123"),
      ).rejects.toThrow("Current password is required");
      expect(mockUser.update).not.toHaveBeenCalled();
    });

    it("should reject when the current password is wrong (no takeover)", async () => {
      comparePassword.mockResolvedValue(false);
      const mockUser = {
        id: "user-1",
        password: "old-hashed-password",
        update: jest.fn(),
      };
      Users.findByPk.mockResolvedValue(mockUser);

      await expect(
        justUpdatePassword("user-1", "newpassword123", "wrong-password"),
      ).rejects.toThrow("Current password is incorrect");
      expect(mockUser.update).not.toHaveBeenCalled();
      expect(revokeAllSessions).not.toHaveBeenCalled();
    });
  });

  // ========================
  // CHECK PASSWORD VALIDITY
  // ========================
  describe("passIsValid", () => {
    it("should return valid=true when password matches", async () => {
      const mockUser = {
        id: "user-1",
        password: "hashed-password",
      };
      Users.findByPk.mockResolvedValue(mockUser);
      comparePassword.mockResolvedValue(true);

      const result = await passIsValid("user-1", "correct-password");

      expect(result.status).toBe(200);
      expect(result.data.valid).toBe(true);
      expect(result.message).toBe("Password is valid");
      expect(comparePassword).toHaveBeenCalledWith(
        "correct-password",
        "hashed-password",
      );
    });

    it("should return valid=false when password does not match", async () => {
      const mockUser = {
        id: "user-1",
        password: "hashed-password",
      };
      Users.findByPk.mockResolvedValue(mockUser);
      comparePassword.mockResolvedValue(false);

      const result = await passIsValid("user-1", "wrong-password");

      expect(result.status).toBe(200);
      expect(result.data.valid).toBe(false);
      // The message must not claim validity — clients read it.
      expect(result.message).toBe("Password is incorrect");
    });

    it("should reject when user not found", async () => {
      Users.findByPk.mockResolvedValue(null);

      await expect(passIsValid("nonexistent", "any-password")).rejects.toThrow(
        "User not found",
      );
    });
  });

  // ========================
  // LOGIN MFA
  // ========================
  describe("loginMfa", () => {
    beforeEach(() => {
      jest.resetModules();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("should complete MFA login with valid code", async () => {
      jest.resetModules();

      const mockAuthenticator = { check: jest.fn().mockReturnValue(true) };
      jest.doMock("otplib", () => ({ authenticator: mockAuthenticator }));
      jest.doMock("../../models", () => ({
        Users: {
          findOne: jest.fn(),
          findByPk: jest.fn(),
          create: jest.fn(),
        },
        Roles: { findOne: jest.fn() },
      }));
      jest.doMock("../../config", () => ({
        db: { transaction: jest.fn() },
      }));
      jest.doMock("../../utils/jwt.util", () => ({
        generateAccessToken: jest.fn().mockReturnValue("access-token"),
        generateOpaqueRefreshToken: jest.fn().mockReturnValue("refresh-token"),
        generateRefreshToken: jest.fn(),
        verifyAccessToken: jest.fn(),
      }));
      jest.doMock("../../services/session.service", () => ({
        createSession: jest.fn().mockResolvedValue({ sessionId: "session-1" }),
        validateSession: jest.fn(),
        revokeSession: jest.fn(),
        revokeAllSessions: jest.fn(),
      }));

      const { Users: ImportedUsers } = require("../../models");
      const mockUser = {
        id: "user-1",
        username: "testuser",
        email: "test@example.com",
        firstName: "Test",
        lastName: "User",
        tenantId: "tenant-1",
        roleId: "role-1",
        mfaEnabled: true,
        mfaSecret: "secret",
        lastLoginAt: null,
        update: jest.fn().mockResolvedValue({}),
        role: { id: "role-1", name: "USER" },
      };
      ImportedUsers.findByPk.mockResolvedValue(mockUser);

      const { loginMfa } = require("../../services/auth.service");
      const result = await loginMfa(
        "user-1",
        "123456",
        "127.0.0.1",
        "test-agent",
      );

      expect(result.status).toBe(200);
      expect(result.message).toBe("Login successful");
      expect(result.token).toBe("access-token");
      expect(result.refreshToken).toBe("refresh-token");
      expect(mockUser.update).toHaveBeenCalledWith({
        lastLoginAt: expect.any(Date),
      });
      expect(mockAuthenticator.check).toHaveBeenCalledWith("123456", "secret");
    });

    it("should reject invalid MFA code", async () => {
      jest.resetModules();

      const mockAuthenticator = { check: jest.fn().mockReturnValue(false) };
      jest.doMock("otplib", () => ({ authenticator: mockAuthenticator }));
      jest.doMock("../../models", () => ({
        Users: {
          findOne: jest.fn(),
          findByPk: jest.fn(),
          create: jest.fn(),
        },
        Roles: { findOne: jest.fn() },
      }));
      jest.doMock("../../config", () => ({
        db: { transaction: jest.fn() },
      }));

      const { Users: ImportedUsers } = require("../../models");
      const mockUser = {
        id: "user-1",
        mfaEnabled: true,
        mfaSecret: "secret",
        update: jest.fn().mockResolvedValue({}),
      };
      ImportedUsers.findByPk.mockResolvedValue(mockUser);

      const { loginMfa } = require("../../services/auth.service");
      await expect(
        loginMfa("user-1", "wrong-code", null, null),
      ).rejects.toThrow("Invalid MFA code");
    });

    it("should reject when MFA not enabled", async () => {
      jest.resetModules();

      const mockAuthenticator = { check: jest.fn().mockReturnValue(true) };
      jest.doMock("otplib", () => ({ authenticator: mockAuthenticator }));
      jest.doMock("../../models", () => ({
        Users: {
          findOne: jest.fn(),
          findByPk: jest.fn(),
          create: jest.fn(),
        },
        Roles: { findOne: jest.fn() },
      }));
      jest.doMock("../../config", () => ({
        db: { transaction: jest.fn() },
      }));

      const { Users: ImportedUsers } = require("../../models");
      ImportedUsers.findByPk.mockResolvedValue(null);

      const { loginMfa } = require("../../services/auth.service");
      await expect(loginMfa("user-1", "123456", null, null)).rejects.toThrow(
        "MFA is not enabled for this account",
      );
    });
  });

  // ========================
  // SETUP MFA
  // ========================
  describe("setupMfa", () => {
    beforeEach(() => {
      jest.resetModules();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("should generate MFA setup data", async () => {
      const mockAuthenticator = {
        generateSecret: jest.fn().mockReturnValue("test-secret"),
        keyuri: jest
          .fn()
          .mockReturnValue(
            "otpauth://totp/Callibrator:test@example.com?secret=test-secret",
          ),
      };
      jest.doMock("otplib", () => ({ authenticator: mockAuthenticator }));

      const jestMockQrcode = {
        toDataURL: jest.fn().mockResolvedValue("qr-data-url"),
      };
      jest.doMock("qrcode", () => jestMockQrcode);

      const mockUser = {
        id: "user-1",
        email: "test@example.com",
        update: jest.fn().mockResolvedValue({}),
      };

      // Re-import models after resetting modules
      const { Users: ImportedUsers } = require("../../models");
      ImportedUsers.findByPk.mockResolvedValue(mockUser);

      const { setupMfa } = require("../../services/auth.service");
      const result = await setupMfa("user-1");

      expect(result.secret).toBe("test-secret");
      expect(result.qrCodeUrl).toBe("qr-data-url");
      expect(mockUser.update).toHaveBeenCalledWith({
        mfaSecret: "test-secret",
      });
    });

    it("should reject when user not found", async () => {
      jest.doMock("otplib", () => ({
        authenticator: {
          generateSecret: jest.fn().mockReturnValue("secret"),
          keyuri: jest.fn().mockReturnValue("otpauth://"),
        },
      }));
      jest.doMock("qrcode", () => ({
        toDataURL: jest.fn().mockResolvedValue("qr"),
      }));

      const { Users: ImportedUsers } = require("../../models");
      ImportedUsers.findByPk.mockResolvedValue(null);

      const { setupMfa } = require("../../services/auth.service");
      await expect(setupMfa("nonexistent")).rejects.toThrow("User not found");
    });
  });

  // ========================
  // VERIFY MFA SETUP
  // ========================
  describe("verifyMfaSetup", () => {
    beforeEach(() => {
      jest.resetModules();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("should enable MFA with valid code", async () => {
      const mockAuthenticator = { check: jest.fn().mockReturnValue(true) };
      jest.doMock("otplib", () => ({ authenticator: mockAuthenticator }));

      const mockUser = {
        id: "user-1",
        mfaSecret: "test-secret",
        update: jest.fn().mockResolvedValue({}),
      };

      const { Users: ImportedUsers } = require("../../models");
      ImportedUsers.findByPk.mockResolvedValue(mockUser);

      const { verifyMfaSetup } = require("../../services/auth.service");
      const result = await verifyMfaSetup("user-1", "123456");

      expect(result.success).toBe(true);
      expect(result.message).toBe("MFA enabled successfully");
      expect(mockUser.update).toHaveBeenCalledWith({ mfaEnabled: true });
      expect(mockAuthenticator.check).toHaveBeenCalledWith(
        "123456",
        "test-secret",
      );
    });

    it("should reject invalid MFA code", async () => {
      const mockAuthenticator = { check: jest.fn().mockReturnValue(false) };
      jest.doMock("otplib", () => ({ authenticator: mockAuthenticator }));

      const mockUser = {
        id: "user-1",
        mfaSecret: "test-secret",
        update: jest.fn().mockResolvedValue({}),
      };

      const { Users: ImportedUsers } = require("../../models");
      ImportedUsers.findByPk.mockResolvedValue(mockUser);

      const { verifyMfaSetup } = require("../../services/auth.service");
      await expect(verifyMfaSetup("user-1", "wrong-code")).rejects.toThrow(
        "Invalid MFA code",
      );
    });

    it("should reject when MFA setup not initiated", async () => {
      const mockAuthenticator = { check: jest.fn().mockReturnValue(true) };
      jest.doMock("otplib", () => ({ authenticator: mockAuthenticator }));

      const mockUser = {
        id: "user-1",
        mfaSecret: null,
      };

      const { Users: ImportedUsers } = require("../../models");
      ImportedUsers.findByPk.mockResolvedValue(mockUser);

      const { verifyMfaSetup } = require("../../services/auth.service");
      await expect(verifyMfaSetup("user-1", "123456")).rejects.toThrow(
        "MFA setup has not been initiated",
      );
    });

    it("should reject when user not found", async () => {
      jest.doMock("otplib", () => ({
        authenticator: { check: jest.fn().mockReturnValue(true) },
      }));

      const { Users: ImportedUsers } = require("../../models");
      ImportedUsers.findByPk.mockResolvedValue(null);

      const { verifyMfaSetup } = require("../../services/auth.service");
      await expect(verifyMfaSetup("nonexistent", "123456")).rejects.toThrow(
        "User not found",
      );
    });
  });

  // ========================
  // IMPERSONATE USER
  // ========================
  describe("impersonateUser", () => {
    it("should create tokens for target user when caller is super admin", async () => {
      const superAdmin = {
        id: "admin-1",
        email: "admin@example.com",
        role: { id: "role-admin", name: "SUPER_ADMIN" },
      };
      const targetUser = {
        id: "user-1",
        email: "user@example.com",
        username: "testuser",
        firstName: "Test",
        lastName: "User",
        first_name: "Test",
        last_name: "User",
        picture: "pic.jpg",
        roleId: "role-1",
        tenantId: "tenant-1",
        role: { id: "role-1", name: "USER" },
      };

      Users.findByPk.mockResolvedValueOnce(superAdmin);
      Users.findOne.mockResolvedValueOnce(targetUser);
      generateAccessToken.mockReturnValue("impersonated-token");
      generateOpaqueRefreshToken.mockReturnValue("refresh-token");
      createSession.mockResolvedValue({ sessionId: "session-1" });

      const result = await impersonateUser(
        "admin-1",
        "tenant-1",
        "user-1",
        "127.0.0.1",
        "admin-agent",
      );

      expect(result.status).toBe(200);
      expect(result.message).toBe(
        "Successfully impersonating user@example.com",
      );
      expect(result.data.isImpersonating).toBe(true);
      expect(result.data.id).toBe("user-1");
      expect(generateAccessToken).toHaveBeenCalledWith(
        expect.objectContaining({ impersonatorId: "admin-1" }),
      );
    });

    it("should reject when caller is not super admin", async () => {
      const regularUser = {
        id: "user-1",
        email: "user@example.com",
        role: { id: "role-1", name: "USER" },
      };
      Users.findByPk.mockResolvedValueOnce(regularUser);

      await expect(
        impersonateUser("user-1", "tenant-1", "user-2", null, null),
      ).rejects.toThrow("Only Super Admins can impersonate users");
    });

    it("should reject when target user not found", async () => {
      const superAdmin = {
        id: "admin-1",
        email: "admin@example.com",
        role: { id: "role-admin", name: "SUPER_ADMIN" },
      };
      Users.findByPk.mockResolvedValueOnce(superAdmin);
      Users.findOne.mockResolvedValueOnce(null);

      await expect(
        impersonateUser("admin-1", "tenant-1", "nonexistent", null, null),
      ).rejects.toThrow("Target user not found in the specified tenant");
    });

    it("should reject self-impersonation", async () => {
      const superAdmin = {
        id: "admin-1",
        email: "admin@example.com",
        role: { id: "role-admin", name: "SUPER_ADMIN" },
      };
      const selfTarget = {
        id: "admin-1",
        email: "admin@example.com",
        role: { id: "role-admin", name: "SUPER_ADMIN" },
      };
      Users.findByPk.mockResolvedValueOnce(superAdmin);
      Users.findOne.mockResolvedValueOnce(selfTarget);

      await expect(
        impersonateUser("admin-1", "tenant-1", "admin-1", null, null),
      ).rejects.toThrow("Cannot impersonate yourself");
    });

    it("should accept SUPERADMIN role name", async () => {
      const superAdmin = {
        id: "admin-1",
        email: "admin@example.com",
        role: { id: "role-admin", name: "SUPERADMIN" },
      };
      const targetUser = {
        id: "user-1",
        email: "user@example.com",
        username: "testuser",
        firstName: "Test",
        lastName: "User",
        first_name: "Test",
        last_name: "User",
        picture: null,
        roleId: "role-1",
        tenantId: "tenant-1",
        role: { id: "role-1", name: "USER" },
      };
      Users.findByPk.mockResolvedValueOnce(superAdmin);
      Users.findOne.mockResolvedValueOnce(targetUser);
      generateAccessToken.mockReturnValue("token");
      generateOpaqueRefreshToken.mockReturnValue("refresh");
      createSession.mockResolvedValue({ sessionId: "s1" });

      const result = await impersonateUser(
        "admin-1",
        "tenant-1",
        "user-1",
        null,
        null,
      );

      expect(result.success).toBe(true);
    });
  });
});

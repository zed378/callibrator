// eslint-disable-next-line no-undef
jest.mock("../../models", () => {
  const mockSessions = {
    create: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn(),
  };
  return {
    Sessions: mockSessions,
  };
});

const { Sessions } = require("../../models");
const {
  hashToken,
  createSession,
  validateSession,
  revokeSession,
  revokeAllSessions,
  rotateRefreshToken,
  cleanupExpiredSessions,
} = require("../../services/session.service");

describe("session.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("hashToken", () => {
    it("should hash token and return hash", () => {
      const hash = hashToken("test-token");

      expect(hash).toBeDefined();
      expect(typeof hash).toBe("string");
      expect(hash).not.toBe("test-token");
    });

    it("should produce consistent hash for same input", () => {
      const hash1 = hashToken("same-token");
      const hash2 = hashToken("same-token");

      expect(hash1).toBe(hash2);
    });
  });

  describe("createSession", () => {
    it("should create session with all fields", async () => {
      const mockSession = {
        id: "session-1",
        tenant_id: "tenant-1",
        user_id: "user-1",
        token_hash: "hash-1",
        ip_address: "127.0.0.1",
        user_agent: "test-agent",
        device: "desktop",
        expired_at: new Date(),
        last_activity_at: new Date(),
      };
      Sessions.create.mockResolvedValue(mockSession);

      const result = await createSession({
        tenantId: "tenant-1",
        userId: "user-1",
        refreshToken: "refresh-token",
        ipAddress: "127.0.0.1",
        userAgent: "test-agent",
        device: "desktop",
        expiredAt: new Date(),
      });

      expect(Sessions.create).toHaveBeenCalled();
      expect(result).toBe(mockSession);
    });

    it("should use default expiredAt when not provided", async () => {
      Sessions.create.mockResolvedValue({ id: "session-2" });

      await createSession({
        userId: "user-1",
        refreshToken: "refresh-token",
      });

      expect(Sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenant_id: null,
          user_id: "user-1",
          ip_address: undefined,
          user_agent: undefined,
          device: undefined,
        }),
      );
    });
  });

  describe("validateSession", () => {
    it("should return session when valid", async () => {
      const futureDate = new Date(Date.now() + 86400000);
      const mockSession = {
        id: "session-1",
        token_hash: "hash-1",
        expired_at: futureDate,
        is_revoked: false,
        is_active: true,
        update: jest.fn().mockResolvedValue(true),
      };
      Sessions.findOne.mockResolvedValue(mockSession);

      const result = await validateSession("refresh-token");

      expect(result).toBe(mockSession);
      expect(mockSession.update).toHaveBeenCalledWith({
        last_activity_at: expect.any(Date),
      });
    });

    it("should return null when session not found", async () => {
      Sessions.findOne.mockResolvedValue(null);

      const result = await validateSession("invalid-token");

      expect(result).toBe(null);
    });

    it("should revoke and return null when session expired", async () => {
      const pastDate = new Date(Date.now() - 86400000);
      const mockSession = {
        id: "session-1",
        expired_at: pastDate,
        update: jest.fn().mockResolvedValue(true),
      };
      Sessions.findOne.mockResolvedValue(mockSession);

      const result = await validateSession("expired-token");

      expect(result).toBe(null);
      expect(mockSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          is_revoked: true,
          revoked_reason: "SESSION_EXPIRED",
        }),
      );
    });
  });

  describe("revokeSession", () => {
    it("should revoke session by token hash", async () => {
      Sessions.update.mockResolvedValue(1);

      const result = await revokeSession("refresh-token", "LOGOUT");

      expect(Sessions.update).toHaveBeenCalledWith(
        expect.objectContaining({
          is_revoked: true,
          revoked_reason: "LOGOUT",
        }),
        expect.objectContaining({
          where: expect.any(Object),
        }),
      );
      expect(result).toBe(1);
    });

    it("should use default reason LOGOUT", async () => {
      Sessions.update.mockResolvedValue(1);

      await revokeSession("refresh-token");

      expect(Sessions.update).toHaveBeenCalledWith(
        expect.objectContaining({
          revoked_reason: "LOGOUT",
        }),
        expect.any(Object),
      );
    });
  });

  describe("revokeAllSessions", () => {
    it("should revoke all sessions for a user", async () => {
      Sessions.update.mockResolvedValue(5);

      const result = await revokeAllSessions("user-1", "PASSWORD_CHANGE");

      expect(Sessions.update).toHaveBeenCalledWith(
        expect.objectContaining({
          revoked_reason: "PASSWORD_CHANGE",
        }),
        expect.objectContaining({
          where: {
            user_id: "user-1",
            is_revoked: false,
          },
        }),
      );
      expect(result).toBe(5);
    });

    it("should use default reason LOGOUT_ALL", async () => {
      Sessions.update.mockResolvedValue(3);

      await revokeAllSessions("user-1");

      expect(Sessions.update).toHaveBeenCalledWith(
        expect.objectContaining({
          revoked_reason: "LOGOUT_ALL",
        }),
        expect.any(Object),
      );
    });
  });

  describe("rotateRefreshToken", () => {
    it("should rotate token and return new session", async () => {
      const futureDate = new Date(Date.now() + 86400000);
      const mockSession = {
        id: "session-1",
        tenant_id: "tenant-1",
        user_id: "user-1",
        ip_address: "127.0.0.1",
        user_agent: "test-agent",
        device: "desktop",
        expired_at: futureDate,
        update: jest.fn().mockResolvedValue(true),
      };

      Sessions.findOne.mockResolvedValue(mockSession);
      Sessions.update.mockResolvedValue(1);
      Sessions.create.mockResolvedValue({ id: "new-session" });

      const result = await rotateRefreshToken({
        oldRefreshToken: "old-token",
        newRefreshToken: "new-token",
        expiredAt: futureDate,
      });

      expect(result).toEqual({ id: "new-session" });
    });

    it("should return null when old session is invalid", async () => {
      Sessions.findOne.mockResolvedValue(null);

      const result = await rotateRefreshToken({
        oldRefreshToken: "invalid-token",
        newRefreshToken: "new-token",
      });

      expect(result).toBe(null);
    });
  });

  describe("cleanupExpiredSessions", () => {
    it("should destroy expired sessions", async () => {
      Sessions.destroy.mockResolvedValue(10);

      const result = await cleanupExpiredSessions();

      expect(Sessions.destroy).toHaveBeenCalledWith({
        where: {
          expired_at: expect.any(Object),
        },
      });
      expect(result).toBe(10);
    });
  });
});

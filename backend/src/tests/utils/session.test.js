/**
 * Tests for session utility
 */

jest.mock("../../models", () => ({
  Sessions: {
    create: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
  },
}));

const {
  hashToken,
  createSession,
  findSession,
  revokeSession,
  revokeAllUserSessions,
} = require("../../utils/session.util");
const { Sessions } = require("../../models");

describe("session utility", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("hashToken", () => {
    it("should hash a token consistently", () => {
      const token = "test-token-123";
      const hash1 = hashToken(token);
      const hash2 = hashToken(token);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
      expect(hash1).toMatch(/^[a-f0-9]+$/);
    });

    it("should produce different hashes for different tokens", () => {
      const hash1 = hashToken("token-1");
      const hash2 = hashToken("token-2");

      expect(hash1).not.toBe(hash2);
    });
  });

  describe("createSession", () => {
    it("should create a session with all fields", async () => {
      const sessionData = {
        userId: "user-123",
        token: "test-token",
        ipAddress: "127.0.0.1",
        userAgent: "TestBrowser/1.0",
        expiredAt: new Date("2025-12-31"),
      };

      Sessions.create.mockResolvedValue({ ...sessionData, is_revoked: false });

      const result = await createSession(sessionData);

      expect(Sessions.create).toHaveBeenCalled();
      expect(result.is_revoked).toBe(false);
    });

    it("should create session with null optional fields", async () => {
      const sessionData = {
        userId: "user-123",
        token: "test-token",
        expiredAt: new Date("2025-12-31"),
      };

      Sessions.create.mockResolvedValue({
        ...sessionData,
        ip_address: null,
        user_agent: null,
        is_revoked: false,
      });

      const result = await createSession(sessionData);

      expect(result.is_revoked).toBe(false);
    });
  });

  describe("findSession", () => {
    it("should find session by sessionId", async () => {
      const mockSession = {
        id: "session-123",
        user_id: "user-123",
        is_revoked: false,
      };

      Sessions.findOne.mockResolvedValue(mockSession);

      const result = await findSession({
        token: "test-token",
        userId: "user-123",
        sessionId: "session-123",
      });

      expect(Sessions.findOne).toHaveBeenCalled();
      expect(result).toEqual(mockSession);
    });

    it("should find session by token and userId when no sessionId", async () => {
      const mockSession = {
        id: "session-123",
        user_id: "user-123",
        is_revoked: false,
      };

      Sessions.findOne.mockResolvedValue(mockSession);

      const result = await findSession({
        token: "test-token",
        userId: "user-123",
      });

      expect(Sessions.findOne).toHaveBeenCalled();
    });

    it("should return null when session not found", async () => {
      Sessions.findOne.mockResolvedValue(null);

      const result = await findSession({
        token: "invalid-token",
        userId: "user-123",
      });

      expect(result).toBeNull();
    });
  });

  describe("revokeSession", () => {
    it("should revoke a session", async () => {
      Sessions.update.mockResolvedValue([1]);

      const result = await revokeSession({
        token: "test-token",
        userId: "user-123",
      });

      expect(Sessions.update).toHaveBeenCalled();
      expect(result[0]).toBe(1);
    });
  });

  describe("revokeAllUserSessions", () => {
    it("should revoke all sessions for a user", async () => {
      Sessions.update.mockResolvedValue([5]);

      const result = await revokeAllUserSessions("user-123");

      expect(Sessions.update).toHaveBeenCalled();
      expect(result[0]).toBe(5);
    });
  });
});

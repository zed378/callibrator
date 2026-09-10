/**
 * Tests for sessionCleanup middleware
 */

// Mock node-cron before importing
const mockSchedule = jest.fn();
jest.mock("node-cron", () => ({
  schedule: mockSchedule,
}));

// Mock session service - revokeAllSessions returns [affectedCount] like Sequelize
jest.mock("../../services/session.service", () => ({
  cleanupExpiredSessions: jest.fn(),
  revokeAllSessions: jest.fn(),
}));

// Mock activityLog
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    http: jest.fn(),
  },
}));

const {
  cleanupExpiredSessions,
  revokeAllSessions,
} = require("../../services/session.service");
const { logger } = require("../../middlewares/activityLog.middleware");

// Clear module cache before each test that needs fresh env
const loadSessionCleanup = () => {
  jest.resetModules();
  // Re-apply mocks after reset
  jest.mock("node-cron", () => ({
    schedule: mockSchedule,
  }));
  jest.mock("../../services/session.service", () => ({
    cleanupExpiredSessions: cleanupExpiredSessions,
    revokeAllSessions: revokeAllSessions,
  }));
  jest.mock("../../middlewares/activityLog.middleware", () => ({
    logger: logger,
  }));
  return require("../../middlewares/sessionCleanup.middleware");
};

describe("sessionCleanup middleware", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    process.env = { ...originalEnv };
    mockSchedule.mockReset();
    // Set default mock return values
    cleanupExpiredSessions.mockResolvedValue(0);
    revokeAllSessions.mockResolvedValue([0]);
  });

  afterAll(() => {
    process.env = originalEnv;
    jest.useRealTimers();
  });

  describe("cleanupExpiredSessionsJob", () => {
    it("should delete expired sessions successfully", async () => {
      cleanupExpiredSessions.mockResolvedValue(5);
      const { cleanupExpiredSessionsJob } = loadSessionCleanup();

      const result = await cleanupExpiredSessionsJob();

      expect(cleanupExpiredSessions).toHaveBeenCalled();
      expect(result).toBe(5);
      expect(logger.info).toHaveBeenCalledWith(
        "Session cleanup completed: 5 expired sessions deleted",
      );
    });

    it("should log error when cleanup fails", async () => {
      cleanupExpiredSessions.mockRejectedValue(
        new Error("DB connection failed"),
      );
      const { cleanupExpiredSessionsJob } = loadSessionCleanup();

      await expect(cleanupExpiredSessionsJob()).rejects.toThrow(
        "DB connection failed",
      );

      expect(logger.error).toHaveBeenCalledWith(
        "Error during session cleanup: DB connection failed",
      );
    });
  });

  describe("revokeUserSessions", () => {
    it("should revoke all sessions for a user", async () => {
      revokeAllSessions.mockResolvedValue([3]);
      const { revokeUserSessions } = loadSessionCleanup();

      const result = await revokeUserSessions("user-123", "PASSWORD_CHANGE");

      expect(revokeAllSessions).toHaveBeenCalledWith(
        "user-123",
        "PASSWORD_CHANGE",
      );
      expect(result).toBe(3);
      expect(logger.info).toHaveBeenCalledWith(
        "Revoked 3 sessions for user user-123: PASSWORD_CHANGE",
      );
    });

    it("should use default reason when not provided", async () => {
      revokeAllSessions.mockResolvedValue([2]);
      const { revokeUserSessions } = loadSessionCleanup();

      await revokeUserSessions("user-456");

      expect(revokeAllSessions).toHaveBeenCalledWith(
        "user-456",
        "ACCOUNT_SECURITY",
      );
    });

    it("should log error when revocation fails", async () => {
      revokeAllSessions.mockRejectedValue(new Error("DB connection failed"));
      const { revokeUserSessions } = loadSessionCleanup();

      await expect(revokeUserSessions("user-123")).rejects.toThrow(
        "DB connection failed",
      );

      expect(logger.error).toHaveBeenCalledWith(
        "Error revoking sessions for user user-123:",
        "DB connection failed",
      );
    });
  });

  describe("initSessionCleanup", () => {
    it("should use default schedule when SESSION_CLEANUP_SCHEDULER is not set", () => {
      delete process.env.SESSION_CLEANUP_SCHEDULER;
      const { initSessionCleanup } = loadSessionCleanup();
      const result = initSessionCleanup();

      expect(mockSchedule).toHaveBeenCalledWith(
        "0 2 * * *",
        expect.any(Function),
      );
      expect(result).toEqual(
        expect.objectContaining({
          cleanupExpiredSessions: expect.any(Function),
          revokeUserSessions: expect.any(Function),
        }),
      );
    });

    it("should use custom schedule from environment variable", () => {
      process.env.SESSION_CLEANUP_SCHEDULER = "0 3 * * *";
      const { initSessionCleanup } = loadSessionCleanup();
      initSessionCleanup();

      expect(mockSchedule).toHaveBeenCalledWith(
        "0 3 * * *",
        expect.any(Function),
      );
    });

    it("should log message about custom schedule", () => {
      process.env.SESSION_CLEANUP_SCHEDULER = "0 4 * * *";
      const { initSessionCleanup } = loadSessionCleanup();
      initSessionCleanup();

      expect(logger.info).toHaveBeenCalledWith(
        "Session cleanup scheduled with: 0 4 * * *",
      );
    });

    it("should log default message when using default schedule", () => {
      delete process.env.SESSION_CLEANUP_SCHEDULER;
      const { initSessionCleanup } = loadSessionCleanup();
      initSessionCleanup();

      expect(logger.info).toHaveBeenCalledWith(
        "Session cleanup scheduled at 2:00 AM daily",
      );
    });
  });
});

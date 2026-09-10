// eslint-disable-next-line no-undef
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));
jest.mock("../../services/session.service", () => ({
  cleanupExpiredSessions: jest.fn(),
  revokeAllSessions: jest.fn(),
}));
jest.mock("node-cron", () => ({
  schedule: jest.fn(),
}));

const {
  initSessionCleanup,
  cleanupExpiredSessionsJob,
  revokeUserSessions,
} = require("../../middlewares/sessionCleanup.middleware");

describe("sessionCleanup.middleware", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.SESSION_CLEANUP_SCHEDULER;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("cleanupExpiredSessionsJob", () => {
    it("should call cleanupExpiredSessions and return count", async () => {
      const {
        cleanupExpiredSessions,
      } = require("../../services/session.service");
      cleanupExpiredSessions.mockResolvedValue(42);

      const result = await cleanupExpiredSessionsJob();

      expect(cleanupExpiredSessions).toHaveBeenCalled();
      expect(result).toBe(42);
    });

    it("should throw error when cleanup fails", async () => {
      const {
        cleanupExpiredSessions,
      } = require("../../services/session.service");
      cleanupExpiredSessions.mockRejectedValue(new Error("DB error"));

      await expect(cleanupExpiredSessionsJob()).rejects.toThrow("DB error");
    });
  });

  describe("revokeUserSessions", () => {
    it("should revoke all sessions for a user", async () => {
      const { revokeAllSessions } = require("../../services/session.service");
      revokeAllSessions.mockResolvedValue([5]);

      const result = await revokeUserSessions("user-1", "PASSWORD_CHANGE");

      expect(revokeAllSessions).toHaveBeenCalledWith(
        "user-1",
        "PASSWORD_CHANGE",
      );
      expect(result).toBe(5);
    });

    it("should use default reason ACCOUNT_SECURITY", async () => {
      const { revokeAllSessions } = require("../../services/session.service");
      revokeAllSessions.mockResolvedValue([3]);

      const result = await revokeUserSessions("user-2");

      expect(revokeAllSessions).toHaveBeenCalledWith(
        "user-2",
        "ACCOUNT_SECURITY",
      );
      expect(result).toBe(3);
    });

    it("should throw error when revoke fails", async () => {
      const { revokeAllSessions } = require("../../services/session.service");
      revokeAllSessions.mockRejectedValue(new Error("Revocation failed"));

      await expect(revokeUserSessions("user-1")).rejects.toThrow(
        "Revocation failed",
      );
    });
  });

  describe("initSessionCleanup", () => {
    it("should schedule cron job with default schedule", () => {
      const cron = require("node-cron");
      const result = initSessionCleanup();

      expect(cron.schedule).toHaveBeenCalledWith(
        "0 2 * * *",
        expect.any(Function),
      );
      expect(result.cleanupExpiredSessions).toBeDefined();
      expect(result.revokeUserSessions).toBeDefined();
    });

    it("should schedule cron job with custom schedule from env", () => {
      process.env.SESSION_CLEANUP_SCHEDULER = "0 */6 * * *";
      const cron = require("node-cron");
      const result = initSessionCleanup();

      expect(cron.schedule).toHaveBeenCalledWith(
        "0 */6 * * *",
        expect.any(Function),
      );
    });

    it("should return cleanup and revoke functions", () => {
      const cron = require("node-cron");
      const result = initSessionCleanup();

      expect(typeof result.cleanupExpiredSessions).toBe("function");
      expect(typeof result.revokeUserSessions).toBe("function");
    });

    it("should log default message for default schedule", () => {
      const { logger } = require("../../middlewares/activityLog.middleware");
      initSessionCleanup();

      expect(logger.info).toHaveBeenCalledWith(
        "Session cleanup scheduled at 2:00 AM daily",
      );
    });

    it("should log custom message when schedule differs from default", () => {
      process.env.SESSION_CLEANUP_SCHEDULER = "30 3 * * *";
      const { logger } = require("../../middlewares/activityLog.middleware");
      initSessionCleanup();

      expect(logger.info).toHaveBeenCalledWith(
        "Session cleanup scheduled with: 30 3 * * *",
      );
    });

    it("should call cleanupExpiredSessionsJob and log success when cron fires", async () => {
      const { logger } = require("../../middlewares/activityLog.middleware");
      const {
        cleanupExpiredSessions,
      } = require("../../services/session.service");
      cleanupExpiredSessions.mockResolvedValue(10);

      const cron = require("node-cron");
      initSessionCleanup();
      const scheduleCallback = cron.schedule.mock.calls[0][1];
      await scheduleCallback();

      expect(logger.info).toHaveBeenCalledWith("Running session cleanup...");
      expect(logger.info).toHaveBeenCalledWith(
        "Session cleanup completed successfully",
      );
    });

    it("should log error and not rethrow when cron callback catches failure", async () => {
      const { logger } = require("../../middlewares/activityLog.middleware");
      const {
        cleanupExpiredSessions,
      } = require("../../services/session.service");
      cleanupExpiredSessions.mockRejectedValue(
        new Error("Connection refused"),
      );

      const cron = require("node-cron");
      initSessionCleanup();
      const scheduleCallback = cron.schedule.mock.calls[0][1];

      await expect(scheduleCallback()).resolves.not.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        "Error during scheduled session cleanup: Connection refused",
      );
    });
  });
});

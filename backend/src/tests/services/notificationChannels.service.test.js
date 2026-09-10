/**
 * Tests for Notification Channels Service
 */

jest.mock("../../services/emailQueue.service", () => ({
  queueNotificationEmail: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Import modules AFTER mocks are defined
const { queueNotificationEmail } = require("../../services/emailQueue.service");
const { logger } = require("../../middlewares/activityLog.middleware");
const notificationChannels = require("../../services/notificationChannels.service");

describe("notificationChannels.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("dispatch", () => {
    it("should return empty results when no channels specified (default realtime only)", async () => {
      const result = await notificationChannels.dispatch(
        { title: "Test", message: "Test message" },
        {},
      );

      expect(result).toEqual({});
    });

    it("should default the options object entirely when it is omitted", async () => {
      const result = await notificationChannels.dispatch({
        title: "Test",
        message: "Test message",
      });

      expect(result).toEqual({});
      expect(queueNotificationEmail).not.toHaveBeenCalled();
    });

    it("should dispatch to email when email channel is specified", async () => {
      const notification = {
        title: "Test Notification",
        message: "Test message",
        actionUrl: "http://example.com/action",
      };

      const result = await notificationChannels.dispatch(notification, {
        channels: ["email"],
        recipientEmail: "user@example.com",
        recipientName: "John",
      });

      expect(result.email).toBe("queued");
      expect(queueNotificationEmail).toHaveBeenCalledWith({
        email: "user@example.com",
        firstName: "John",
        title: "Test Notification",
        message: "Test message",
        actionUrl: "http://example.com/action",
      });
    });

    it("should handle email dispatch failure gracefully", async () => {
      queueNotificationEmail.mockRejectedValueOnce(
        new Error("Email service unavailable"),
      );

      const notification = {
        title: "Test Notification",
        message: "Test message",
      };

      const result = await notificationChannels.dispatch(notification, {
        channels: ["email"],
        recipientEmail: "user@example.com",
      });

      expect(result.email).toBe("error: Email service unavailable");
      expect(logger.error).toHaveBeenCalled();
    });

    it("should not dispatch email without recipientEmail", async () => {
      const notification = {
        title: "Test",
        message: "Test",
      };

      const result = await notificationChannels.dispatch(notification, {
        channels: ["email"],
      });

      expect(result).toEqual({});
      expect(queueNotificationEmail).not.toHaveBeenCalled();
    });

    it("should use DEFAULT_CHANNELS constant", () => {
      expect(notificationChannels.DEFAULT_CHANNELS).toEqual(["realtime"]);
    });
  });
});

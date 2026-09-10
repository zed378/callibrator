// Mock the dependencies before requiring the service
const mockLogger = {
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
};

jest.mock("../src/middlewares/activityLog.middleware", () => ({
  logger: mockLogger,
}));

// Mock emailQueue.service
jest.mock("../src/services/emailQueue.service", () => ({
  queueNotificationEmail: jest.fn().mockResolvedValue(true),
}));

const {
  dispatch,
  DEFAULT_CHANNELS,
} = require("../src/services/notificationChannels.service");

const {
  queueNotificationEmail,
} = require("../src/services/emailQueue.service");

describe("notificationChannels.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("DEFAULT_CHANNELS", () => {
    it("should default to realtime only", () => {
      expect(DEFAULT_CHANNELS).toEqual(["realtime"]);
    });
  });

  describe("dispatch", () => {
    const notification = {
      title: "Test Notification",
      message: "Test message",
      actionUrl: "https://example.com/action",
    };

    it("should return empty results when no channels specified", async () => {
      const result = await dispatch(notification, {});
      expect(result).toEqual({});
    });

    it("should return empty results when channels is empty array", async () => {
      const result = await dispatch(notification, { channels: [] });
      expect(result).toEqual({});
    });

    it("should queue email when email channel is specified with recipient", async () => {
      const result = await dispatch(notification, {
        channels: ["email"],
        recipientEmail: "test@example.com",
        recipientName: "Test User",
      });

      expect(result).toHaveProperty("email", "queued");
      expect(queueNotificationEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "test@example.com",
          firstName: "Test User",
          title: "Test Notification",
          message: "Test message",
          actionUrl: "https://example.com/action",
        }),
      );
    });

    it("should skip email when recipientEmail is missing", async () => {
      const result = await dispatch(notification, {
        channels: ["email"],
      });

      expect(result).not.toHaveProperty("email");
      expect(queueNotificationEmail).not.toHaveBeenCalled();
    });

    it("should return error result when email dispatch fails", async () => {
      queueNotificationEmail.mockRejectedValue(new Error("Email service down"));

      const result = await dispatch(notification, {
        channels: ["email"],
        recipientEmail: "test@example.com",
      });

      expect(result.email).toMatch(/^error:/);
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it("should handle realtime channel without error", async () => {
      const result = await dispatch(notification, {
        channels: ["realtime"],
      });

      // realtime is not handled by this dispatcher, so no results
      expect(result).toEqual({});
    });
  });
});

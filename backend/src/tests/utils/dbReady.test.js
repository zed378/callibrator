/**
 * dbReady utility tests
 */
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const { waitForDbReady } = require("../../utils/dbReady.util");
const { logger } = require("../../middlewares/activityLog.middleware");

describe("waitForDbReady", () => {
  let mockAuthenticate;
  let mockQuery;
  let mockSequelize;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthenticate = jest.fn();
    mockQuery = jest.fn();

    mockSequelize = {
      authenticate: mockAuthenticate,
      query: mockQuery,
    };
  });

  describe("successful connection", () => {
    it("should use all defaults when called without options", async () => {
      mockAuthenticate.mockResolvedValue(undefined);
      mockQuery.mockResolvedValue([1]);

      const result = await waitForDbReady(mockSequelize);

      expect(mockAuthenticate).toHaveBeenCalledTimes(1);
      expect(result).toBeDefined();
      expect(result).toContain("attempt 1");
    });

    it("should resolve on first attempt when DB is immediately ready", async () => {
      mockAuthenticate.mockResolvedValue(undefined);
      mockQuery.mockResolvedValue([1]);

      const result = await waitForDbReady(mockSequelize, {
        maxAttempts: 5,
        delayMs: 1,
      });

      expect(mockAuthenticate).toHaveBeenCalledTimes(1);
      expect(mockQuery).toHaveBeenCalledWith("SELECT 1");
      expect(result).toMatch(/Database connection established/);
    });

    it("should use default maxAttempts and delayMs", async () => {
      mockAuthenticate.mockResolvedValue(undefined);
      mockQuery.mockResolvedValue([1]);

      const result = await waitForDbReady(mockSequelize, { delayMs: 1 });

      expect(mockAuthenticate).toHaveBeenCalledTimes(1);
      expect(result).toBeDefined();
    });

    it("should use defaults when called with empty options object", async () => {
      mockAuthenticate.mockResolvedValue(undefined);
      mockQuery.mockResolvedValue([1]);

      const result = await waitForDbReady(mockSequelize, {});

      expect(result).toBeDefined();
      expect(result).toContain("attempt 1");
    });

    it("should include attempt count in message", async () => {
      mockAuthenticate.mockResolvedValue(undefined);
      mockQuery.mockResolvedValue([1]);

      const result = await waitForDbReady(mockSequelize, {
        maxAttempts: 3,
        delayMs: 1,
      });

      expect(result).toContain("attempt 1");
    });
  });

  describe("failed connection with retry", () => {
    it("should retry when authenticate fails then succeed on second attempt", async () => {
      const retryError = new Error("Connection refused");
      mockAuthenticate
        .mockRejectedValueOnce(retryError)
        .mockResolvedValue(undefined);
      mockQuery.mockResolvedValue([1]);

      const result = await waitForDbReady(mockSequelize, {
        maxAttempts: 3,
        delayMs: 1,
      });

      expect(mockAuthenticate).toHaveBeenCalledTimes(2);
      expect(result).toContain("Database connection established");
      expect(result).toContain("attempt 2");
    });

    it("should retry up to maxAttempts before rejecting", async () => {
      const maxAttempts = 3;
      const retryError = new Error("Connection refused");
      mockAuthenticate.mockRejectedValue(retryError);
      mockQuery.mockRejectedValue(retryError);

      await expect(
        waitForDbReady(mockSequelize, {
          maxAttempts,
          delayMs: 1,
        }),
      ).rejects.toThrow(`Database not ready after ${maxAttempts} attempts`);

      expect(mockAuthenticate).toHaveBeenCalledTimes(maxAttempts);
    });

    it("should fail immediately when maxAttempts is 0", async () => {
      mockAuthenticate.mockRejectedValue(new Error("Connection refused"));

      await expect(
        waitForDbReady(mockSequelize, {
          maxAttempts: 0,
          delayMs: 1,
        }),
      ).rejects.toThrow("Database not ready after 0 attempts");
    });

    it("should log warn on each failed attempt", async () => {
      const retryError = new Error("Connection refused");
      mockAuthenticate
        .mockRejectedValueOnce(retryError)
        .mockRejectedValueOnce(retryError)
        .mockResolvedValue(undefined);
      mockQuery.mockResolvedValue([1]);

      const result = await waitForDbReady(mockSequelize, {
        maxAttempts: 5,
        delayMs: 1,
      });

      expect(result).toContain("Database connection established");
      expect(logger.warn).toHaveBeenCalled();
    });

    it("should log error when all attempts exhausted", async () => {
      mockAuthenticate.mockRejectedValue(new Error("Connection refused"));

      await expect(
        waitForDbReady(mockSequelize, {
          maxAttempts: 2,
          delayMs: 1,
        }),
      ).rejects.toThrow();

      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("query fails but authenticate succeeds", () => {
    it("should retry when authenticate succeeds but query fails", async () => {
      const queryError = new Error("Query failed");
      mockQuery.mockRejectedValueOnce(queryError).mockResolvedValue([1]);

      const result = await waitForDbReady(mockSequelize, {
        maxAttempts: 3,
        delayMs: 1,
      });

      // authenticate is called once; query fails once then succeeds
      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(result).toContain("Database connection established");
    });
  });

  describe("custom configuration", () => {
    it("should use custom maxAttempts", async () => {
      mockAuthenticate.mockResolvedValue(undefined);
      mockQuery.mockResolvedValue([1]);

      const result = await waitForDbReady(mockSequelize, {
        maxAttempts: 20,
        delayMs: 1,
      });

      expect(result).toBeDefined();
    });

    it("should pass through attempt number in recursive calls", async () => {
      const errors = [
        new Error("Attempt 1 failed"),
        new Error("Attempt 2 failed"),
      ];

      mockAuthenticate
        .mockRejectedValueOnce(errors[0])
        .mockRejectedValueOnce(errors[1])
        .mockResolvedValue(undefined);
      mockQuery.mockResolvedValue([1]);

      const result = await waitForDbReady(mockSequelize, {
        maxAttempts: 5,
        delayMs: 1,
      });

      expect(result).toContain("attempt 3");
    });
  });
});

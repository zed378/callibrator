/**
 * Tests for validateSessionBinding with IP-change detection disabled.
 *
 * sessionSecurity.middleware.js reads
 *   SUSPICIOUS_IP_CHANGE_DETECTED = process.env.SUSPICIOUS_IP_CHANGE_DETECTED !== "false"
 * once, at module load. sessionSecurity.test.js exercises the enabled default;
 * this file opts out so the disabled path is covered. It needs its own file
 * because the flag is fixed at require time.
 */

const ORIGINAL_IP_CHECK_ENV = process.env.SUSPICIOUS_IP_CHANGE_DETECTED;
process.env.SUSPICIOUS_IP_CHANGE_DETECTED = "false";

jest.mock("../../utils/appError.util", () => {
  class AppError extends Error {
    constructor(statusCode, message) {
      super(message);
      this.statusCode = statusCode;
      this.name = "AppError";
    }
  }
  return { AppError };
});

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("../../config", () => ({
  db: {
    getDialect: jest.fn().mockReturnValue("postgres"),
    query: jest.fn(),
    QueryTypes: { SELECT: "SELECT" },
    Sequelize: { Op: { gt: Symbol.for("gt") } },
  },
}));

jest.mock("../../models", () => ({
  Sessions: { findByPk: jest.fn() },
}));

const {
  validateSessionBinding,
} = require("../../middlewares/sessionSecurity.middleware");
const { db } = require("../../config");
const { logger } = require("../../middlewares/activityLog.middleware");

// The flag has now been captured by the module under test, so restore the
// environment immediately: process.env is shared by every test file that runs
// in this worker, and leaving it set would silently disable IP-change
// detection for any suite loaded after this one.
if (ORIGINAL_IP_CHECK_ENV === undefined) {
  delete process.env.SUSPICIOUS_IP_CHANGE_DETECTED;
} else {
  process.env.SUSPICIOUS_IP_CHANGE_DETECTED = ORIGINAL_IP_CHECK_ENV;
}

describe("validateSessionBinding with IP change detection disabled", () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    db.getDialect.mockReturnValue("postgres");
    next = jest.fn();
    req = {
      session: { id: "session-1" },
      sessionId: "session-1",
      ip: "203.0.113.9",
      connection: { remoteAddress: "203.0.113.9" },
      headers: { "user-agent": "jest-agent" },
    };
    res = {};
  });

  it("should not warn about a changed IP when detection is turned off", async () => {
    // Session was created from a different IP than this request.
    db.query.mockResolvedValueOnce([
      {
        ipAddress: "198.51.100.4",
        userAgent: "jest-agent",
        lastActivity: new Date(),
      },
    ]);
    db.query.mockResolvedValueOnce(undefined); // lastActivity UPDATE

    await validateSessionBinding(req, res, next);

    expect(logger.warn).not.toHaveBeenCalled();
    // The request still proceeds and last activity is still refreshed.
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(db.query.mock.calls[1][0]).toContain('UPDATE "Sessions"');
    expect(next).toHaveBeenCalledWith();
  });
});

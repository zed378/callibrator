/**
 * Tests for accessLog middleware
 */

const mockTokens = {};
const mockMorganInstances = [];
const mockRfsNameCb = jest.fn();
const mockRfsStream = { write: jest.fn() };

jest.mock("rotating-file-stream", () => ({
  createStream: jest.fn((nameFn) => {
    mockRfsNameCb.mockImplementation(nameFn);
    return mockRfsStream;
  }),
}));

jest.mock("morgan", () => {
  const fn = jest.fn((format, options) => {
    const mw = (req, res, next) => next();
    mw._format = format;
    mw._options = options;
    mockMorganInstances.push(mw);
    return mw;
  });
  fn.token = (name, cb) => {
    mockTokens[name] = cb;
  };
  return fn;
});

jest.mock("moment-timezone", () => {
  const m = (time) => ({ tz: () => ({ format: () => "2026-01-01" }) });
  return m;
});

jest.mock("fs", () => ({
  existsSync: jest.fn(() => true),
  mkdirSync: jest.fn(),
}));

jest.mock("../../utils/storagePath.util", () => jest.fn(() => "/tmp/log/access"));

const { accessLog, errorLog } = require("../../middlewares/accessLog.middleware");

describe("accessLog middleware", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should export accessLog and errorLog middleware functions", () => {
    expect(typeof accessLog).toBe("function");
    expect(typeof errorLog).toBe("function");
  });

  it("should create two morgan instances with a custom format", () => {
    expect(mockMorganInstances.length).toBe(2);
    expect(mockMorganInstances[0]._format).toContain(":request-id");
    expect(mockMorganInstances[0]._format).toContain(":user-id");
    expect(mockMorganInstances[0]._format).toContain(":real-ip");
  });

  describe("skip predicates", () => {
    const accessSkip = () => mockMorganInstances[0]._options.skip;
    const errorSkip = () => mockMorganInstances[1]._options.skip;

    const skipPaths = [
      "/health",
      "/live",
      "/ready",
      "/favicon.ico",
      "/docs",
      "/",
      "/documentation",
      "/standards",
      "/tab-permissions",
      "/api/v1/permissions/tables",
    ];

    skipPaths.forEach((path) => {
      it(`should skip access logging for ${path}`, () => {
        const req = { originalUrl: path };
        expect(accessSkip()(req)).toBe(true);
      });
    });

    it("should not skip access logging for non-excluded paths", () => {
      expect(accessSkip()({ originalUrl: "/api/v1/users" })).toBe(false);
    });

    it("should skip error logging when status code is below 400", () => {
      const req = { originalUrl: "/api/v1/users" };
      const res = { statusCode: 200 };
      expect(errorSkip()(req, res)).toBe(true);
    });

    it("should not skip error logging when status code is >= 400", () => {
      const req = { originalUrl: "/api/v1/users" };
      const res = { statusCode: 500 };
      expect(errorSkip()(req, res)).toBe(false);
    });
  });

  describe("custom tokens", () => {
    it("custom-date token should format the current date", () => {
      expect(mockTokens["custom-date"]({})).toBe("2026-01-01");
    });

    it("request-id token should fall back to dash when absent", () => {
      expect(mockTokens["request-id"]({})).toBe("-");
    });

    it("request-id token should return the request id", () => {
      expect(mockTokens["request-id"]({ requestId: "req-1" })).toBe("req-1");
    });

    it("user-id token should fall back to dash when absent", () => {
      expect(mockTokens["user-id"]({})).toBe("-");
    });

    it("user-id token should return the user id", () => {
      expect(mockTokens["user-id"]({ user: { id: "u-1" } })).toBe("u-1");
    });

    it("real-ip token should prefer cf-connecting-ip", () => {
      const req = { headers: { "cf-connecting-ip": "1.1.1.1" } };
      expect(mockTokens["real-ip"](req)).toBe("1.1.1.1");
    });

    it("real-ip token should fall back to x-forwarded-for", () => {
      const req = {
        headers: { "x-forwarded-for": "2.2.2.2" },
        ip: "3.3.3.3",
      };
      expect(mockTokens["real-ip"](req)).toBe("2.2.2.2");
    });

    it("real-ip token should fall back to req.ip", () => {
      const req = { headers: {}, ip: "3.3.3.3" };
      expect(mockTokens["real-ip"](req)).toBe("3.3.3.3");
    });
  });

  describe("rotating stream naming", () => {
    it("should default the log file name when no time is provided", () => {
      expect(mockRfsNameCb()).toBe("access.log");
    });

    it("should include the date in the log file name when time is provided", () => {
      expect(mockRfsNameCb("2026-01-01T00:00:00Z")).toBe(
        "2026-01-01-access.log",
      );
    });
  });
});

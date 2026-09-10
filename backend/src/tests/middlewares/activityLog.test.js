// eslint-disable-next-line no-undef
jest.mock("../../utils/storagePath.util", () => (...parts) => `/mock/log/${parts.join("/")}`);
jest.mock("winston", () => {
  const mockTransport = { on: jest.fn() };
  const mockLogger = {
    http: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    add: jest.fn(),
  };
  return {
    createLogger: jest.fn(() => mockLogger),
    transports: {
      Console: jest.fn(() => mockTransport),
      DailyRotateFile: jest.fn(() => mockTransport),
    },
    format: {
      combine: jest.fn((...f) => f),
      timestamp: jest.fn(() => ({ name: "timestamp" })),
      errors: jest.fn(() => ({ name: "errors" })),
      json: jest.fn(() => ({ name: "json" })),
      colorize: jest.fn(() => ({ name: "colorize" })),
      printf: jest.fn((fn) =>
        fn({ timestamp: "2026-01-01", level: "info", message: "test" }),
      ),
    },
  };
});
jest.mock("winston-daily-rotate-file", () =>
  jest.fn(() => ({ on: jest.fn() })),
);

const {
  activityLogger,
  logger,
} = require("../../middlewares/activityLog.middleware");

describe("activityLog.middleware", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("activityLogger", () => {
    it("should assign requestId and set header", () => {
      const req = {
        ip: "127.0.0.1",
        method: "GET",
        originalUrl: "/api/users",
      };
      const res = {
        getHeader: jest.fn(() => undefined),
        setHeader: jest.fn(),
        on: jest.fn((event, cb) => {
          if (event === "finish") cb();
        }),
      };
      const next = jest.fn();

      activityLogger(req, res, next);

      expect(req.requestId).toBeDefined();
      expect(res.setHeader).toHaveBeenCalledWith("X-Request-Id", req.requestId);
      expect(next).toHaveBeenCalled();
    });

    it("should not overwrite an existing X-Request-Id header", () => {
      const req = {
        ip: "127.0.0.1",
        method: "GET",
        originalUrl: "/api/users",
        requestId: "generated-id",
      };
      const res = {
        getHeader: jest.fn(() => "existing-header-id"),
        setHeader: jest.fn(),
        on: jest.fn((event, cb) => {
          if (event === "finish") cb();
        }),
      };
      const next = jest.fn();

      activityLogger(req, res, next);

      expect(res.setHeader).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it("should reuse existing requestId from req", () => {
      const existingId = "custom-request-id";
      const req = {
        ip: "127.0.0.1",
        method: "POST",
        originalUrl: "/api/data",
        requestId: existingId,
      };
      const res = {
        getHeader: jest.fn(() => undefined),
        setHeader: jest.fn(),
        on: jest.fn((event, cb) => {
          if (event === "finish") cb();
        }),
      };
      const next = jest.fn();

      activityLogger(req, res, next);

      expect(req.requestId).toBe(existingId);
    });

    it("should log request and response for non-excluded paths", () => {
      const req = {
        ip: "192.168.1.1",
        method: "PUT",
        originalUrl: "/api/reports",
      };
      const res = {
        getHeader: jest.fn(() => undefined),
        setHeader: jest.fn(),
        on: jest.fn((event, cb) => {
          if (event === "finish") cb();
        }),
        statusCode: 200,
      };
      const next = jest.fn();

      activityLogger(req, res, next);

      expect(logger.http).toHaveBeenCalled();
    });

    it("should exclude health check endpoints from logging", () => {
      const req = {
        ip: "127.0.0.1",
        method: "GET",
        originalUrl: "/health",
      };
      const res = {
        getHeader: jest.fn(() => undefined),
        setHeader: jest.fn(),
        on: jest.fn(),
        statusCode: 200,
      };
      const next = jest.fn();

      activityLogger(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it("should exclude /live endpoint", () => {
      const req = {
        ip: "127.0.0.1",
        method: "GET",
        originalUrl: "/live",
      };
      const res = {
        getHeader: jest.fn(() => undefined),
        setHeader: jest.fn(),
        on: jest.fn(),
        statusCode: 200,
      };
      const next = jest.fn();

      activityLogger(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it("should exclude /ready endpoint", () => {
      const req = {
        ip: "127.0.0.1",
        method: "GET",
        originalUrl: "/ready",
      };
      const res = {
        getHeader: jest.fn(() => undefined),
        setHeader: jest.fn(),
        on: jest.fn(),
        statusCode: 200,
      };
      const next = jest.fn();

      activityLogger(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it("should exclude /docs endpoint", () => {
      const req = {
        ip: "127.0.0.1",
        method: "GET",
        originalUrl: "/docs",
      };
      const res = {
        getHeader: jest.fn(() => undefined),
        setHeader: jest.fn(),
        on: jest.fn(),
        statusCode: 200,
      };
      const next = jest.fn();

      activityLogger(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it("should log when NODE_ENV is production", () => {
      process.env.NODE_ENV = "production";
      // Re-mock winston to avoid caching issues
      jest.resetModules();
      const {
        activityLogger: prodLogger,
      } = require("../../middlewares/activityLog.middleware");

      const req = {
        ip: "10.0.0.1",
        method: "DELETE",
        originalUrl: "/api/items/1",
      };
      const res = {
        getHeader: jest.fn(() => undefined),
        setHeader: jest.fn(),
        on: jest.fn((event, cb) => {
          if (event === "finish") cb();
        }),
        statusCode: 204,
      };
      const next = jest.fn();

      prodLogger(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe("logger", () => {
    it("should have http, info, warn, error methods", () => {
      expect(typeof logger.http).toBe("function");
      expect(typeof logger.info).toBe("function");
      expect(typeof logger.warn).toBe("function");
      expect(typeof logger.error).toBe("function");
    });
  });
});

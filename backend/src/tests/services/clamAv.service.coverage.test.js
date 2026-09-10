/**
 * Additional coverage for clamAv.service.js
 *
 * Targets the branches the main suite cannot reach with its shared socket mock:
 *  - ScanCache TTL expiry
 *  - the CLAMAV_TIMEOUT scan-timeout path (socket that never connects back)
 *  - CLAMAV_DISABLE_ON_ERROR fail-open behaviour
 *  - HTTP mode without an API key / non-response transport errors
 *
 * Env consts are read at module load, so every test re-requires the service
 * after setting process.env (jest.resetModules in beforeEach).
 */

const EventEmitter = require("events");

let mockSocketInstance;

// A socket that connects but never answers — lets the scan timeout fire.
class SilentSocket extends EventEmitter {
  constructor() {
    super();
    mockSocketInstance = this;
    this.write = jest.fn();
    this.connect = jest.fn((...args) => {
      const cb = args[args.length - 1];
      if (typeof cb === "function") {
        setImmediate(cb);
      }
      return this;
    });
    this.destroy = jest.fn();
  }
}

jest.mock("net", () => ({
  Socket: jest.fn().mockImplementation(() => new SilentSocket()),
}));

jest.mock("../../config", () => ({
  Sequelize: { useCLS: jest.fn() },
  db: { getDialect: jest.fn() },
}));

jest.mock("../../utils/appError.util", () => {
  class AppError extends Error {
    constructor(status, message) {
      super(message);
      this.name = "AppError";
      this.status = status;
    }
  }
  return { AppError };
});

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("../../utils/circuitBreaker.util", () => ({
  withCircuitBreaker: jest.fn((key, fn) => fn()),
}));

jest.mock("axios", () => ({ post: jest.fn() }), { virtual: true });

const fs = require("fs");

describe("clamAv.service (coverage)", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...origEnv, CLAMAV_ENABLED: "false" };
  });

  afterEach(() => {
    process.env = origEnv;
  });

  // ================================================================
  describe("ScanCache TTL expiry", () => {
    it("returns null and evicts the entry once its TTL has passed", () => {
      const clamAvService = require("../../services/clamAv.service");
      const { scanCache } = clamAvService;
      scanCache.clear();

      const realNow = Date.now;
      try {
        const t0 = realNow.call(Date);
        Date.now = jest.fn(() => t0);
        scanCache.set("hash-1", true);
        expect(scanCache.get("hash-1")).toBe(true);
        expect(scanCache.size()).toBe(1);

        // Step just past the 24h TTL.
        Date.now = jest.fn(() => t0 + scanCache._ttl + 1);
        expect(scanCache.get("hash-1")).toBeNull();
        // The expired entry is dropped, not merely hidden.
        expect(scanCache.size()).toBe(0);
      } finally {
        Date.now = realNow;
        scanCache.clear();
      }
    });

    it("returns null for a hash that was never cached", () => {
      const clamAvService = require("../../services/clamAv.service");
      clamAvService.clearCache();

      expect(clamAvService.scanCache.get("never-seen")).toBeNull();
    });

    it("caches a FOUND verdict as not-clean", () => {
      const clamAvService = require("../../services/clamAv.service");
      const { scanCache } = clamAvService;
      scanCache.clear();

      scanCache.set("virus-hash", false);

      // false must be distinguishable from "absent" (null).
      expect(scanCache.get("virus-hash")).toBe(false);
    });
  });

  // ================================================================
  describe("socket scan timeout", () => {
    it("destroys the socket and fails the scan when ClamAV never replies", async () => {
      process.env.CLAMAV_ENABLED = "true";
      process.env.CLAMAV_TIMEOUT = "20"; // fire quickly
      delete process.env.CLAMAV_HTTP_MODE;

      jest.spyOn(fs.promises, "stat").mockResolvedValue({ size: 10, mtimeMs: 1 });
      jest.spyOn(fs, "readFileSync").mockReturnValue(Buffer.from("test"));

      const clamAvService = require("../../services/clamAv.service");
      clamAvService.clearCache();

      await expect(clamAvService.scanFile("/path/to/file.pdf")).rejects.toMatchObject({
        status: 500,
        message: "File scan service unavailable. Please try again later.",
      });

      expect(mockSocketInstance.destroy).toHaveBeenCalled();

      const { logger } = require("../../middlewares/activityLog.middleware");
      expect(logger.error).toHaveBeenCalledWith(
        "ClamAV scan error",
        expect.objectContaining({ error: "ClamAV scan timeout" }),
      );
    });
  });

  // ================================================================
  describe("CLAMAV_DISABLE_ON_ERROR fail-open", () => {
    it("allows the file when the HTTP scan fails and fail-open is enabled", async () => {
      process.env.CLAMAV_ENABLED = "true";
      process.env.CLAMAV_HTTP_MODE = "true";
      process.env.CLAMAV_HTTP_URL = "http://clamav.local:9000";
      process.env.CLAMAV_DISABLE_ON_ERROR = "true";

      jest.spyOn(fs.promises, "stat").mockResolvedValue({ size: 10, mtimeMs: 1 });
      jest.spyOn(fs, "readFileSync").mockReturnValue(Buffer.from("test"));
      const { post } = require("axios");
      const axiosError = new Error("Request failed");
      axiosError.response = { status: 503 };
      post.mockRejectedValue(axiosError);

      const clamAvService = require("../../services/clamAv.service");
      clamAvService.clearCache();

      const result = await clamAvService.scanFile("/path/to/file.pdf");

      expect(result).toEqual({
        isClean: true,
        result: "Allowed (scan error: ClamAV HTTP error: 503)",
        code: "ALLOWED",
      });

      const { logger } = require("../../middlewares/activityLog.middleware");
      expect(logger.warn).toHaveBeenCalledWith(
        "ClamAV scan failed, allowing file (CLAMAV_DISABLE_ON_ERROR=true)",
        expect.objectContaining({ filePath: "/path/to/file.pdf" }),
      );
    });

    it("does not cache the fail-open verdict as a clean result", async () => {
      process.env.CLAMAV_ENABLED = "true";
      process.env.CLAMAV_HTTP_MODE = "true";
      process.env.CLAMAV_HTTP_URL = "http://clamav.local:9000";
      process.env.CLAMAV_DISABLE_ON_ERROR = "true";

      jest.spyOn(fs.promises, "stat").mockResolvedValue({ size: 11, mtimeMs: 2 });
      jest.spyOn(fs, "readFileSync").mockReturnValue(Buffer.from("test"));
      const { post } = require("axios");
      post.mockRejectedValue(new Error("Network down"));

      const clamAvService = require("../../services/clamAv.service");
      clamAvService.clearCache();

      await clamAvService.scanFile("/path/to/file.pdf");

      // A scan that never ran must not poison the cache with "clean".
      expect(clamAvService.getCacheStats().size).toBe(0);
    });

    it("still throws when fail-open is not enabled", async () => {
      process.env.CLAMAV_ENABLED = "true";
      process.env.CLAMAV_HTTP_MODE = "true";
      process.env.CLAMAV_HTTP_URL = "http://clamav.local:9000";
      process.env.CLAMAV_DISABLE_ON_ERROR = "false";

      jest.spyOn(fs.promises, "stat").mockResolvedValue({ size: 12, mtimeMs: 3 });
      jest.spyOn(fs, "readFileSync").mockReturnValue(Buffer.from("test"));
      const { post } = require("axios");
      post.mockRejectedValue(new Error("Network down"));

      const clamAvService = require("../../services/clamAv.service");
      clamAvService.clearCache();

      await expect(clamAvService.scanFile("/path/to/file.pdf")).rejects.toMatchObject({
        status: 500,
      });
    });
  });

  // ================================================================
  describe("HTTP mode header/error branches", () => {
    it("omits the X-HTTP-Key header when no key is configured", async () => {
      process.env.CLAMAV_ENABLED = "true";
      process.env.CLAMAV_HTTP_MODE = "true";
      process.env.CLAMAV_HTTP_URL = "http://clamav.local:9000";
      delete process.env.CLAMAV_HTTP_KEY;

      jest.spyOn(fs.promises, "stat").mockResolvedValue({ size: 13, mtimeMs: 4 });
      jest.spyOn(fs, "readFileSync").mockReturnValue(Buffer.from("test"));
      const { post } = require("axios");
      post.mockResolvedValue({ data: "stream: OK\n" });

      const clamAvService = require("../../services/clamAv.service");
      clamAvService.clearCache();

      await clamAvService.scanFile("/path/to/file.pdf");

      const headers = post.mock.calls[0][2].headers;
      expect(headers).toEqual({ "Content-Type": "application/octet-stream" });
    });

    it("maps a transport error with no response to a generic HTTP scan failure", async () => {
      process.env.CLAMAV_ENABLED = "true";
      process.env.CLAMAV_HTTP_MODE = "true";
      process.env.CLAMAV_HTTP_URL = "http://clamav.local:9000";
      process.env.CLAMAV_DISABLE_ON_ERROR = "true";

      jest.spyOn(fs.promises, "stat").mockResolvedValue({ size: 14, mtimeMs: 5 });
      jest.spyOn(fs, "readFileSync").mockReturnValue(Buffer.from("test"));
      const { post } = require("axios");
      post.mockRejectedValue(new Error("ECONNREFUSED"));

      const clamAvService = require("../../services/clamAv.service");
      clamAvService.clearCache();

      const result = await clamAvService.scanFile("/path/to/file.pdf");

      expect(result.result).toBe("Allowed (scan error: ClamAV HTTP scan failed)");
    });

    it("falls back to socket mode when HTTP mode is on but no URL is configured", async () => {
      process.env.CLAMAV_ENABLED = "true";
      process.env.CLAMAV_HTTP_MODE = "true";
      delete process.env.CLAMAV_HTTP_URL;
      process.env.CLAMAV_TIMEOUT = "20";

      jest.spyOn(fs.promises, "stat").mockResolvedValue({ size: 15, mtimeMs: 6 });
      jest.spyOn(fs, "readFileSync").mockReturnValue(Buffer.from("test"));
      const { post } = require("axios");

      const clamAvService = require("../../services/clamAv.service");
      clamAvService.clearCache();

      // The silent socket times out — proving the socket path, not HTTP, was used.
      await expect(clamAvService.scanFile("/path/to/file.pdf")).rejects.toMatchObject({
        status: 500,
      });
      expect(post).not.toHaveBeenCalled();
      expect(mockSocketInstance.connect).toHaveBeenCalled();
    });
  });

  // ================================================================
  describe("scanFile useCache=false", () => {
    it("skips both the cache lookup and the cache write", async () => {
      process.env.CLAMAV_ENABLED = "true";
      process.env.CLAMAV_HTTP_MODE = "true";
      process.env.CLAMAV_HTTP_URL = "http://clamav.local:9000";

      const statSpy = jest.spyOn(fs.promises, "stat");
      jest.spyOn(fs, "readFileSync").mockReturnValue(Buffer.from("test"));
      const { post } = require("axios");
      post.mockResolvedValue({ data: "stream: OK\n" });

      const clamAvService = require("../../services/clamAv.service");
      clamAvService.clearCache();

      const result = await clamAvService.scanFile("/path/to/file.pdf", false);

      expect(result.isClean).toBe(true);
      expect(statSpy).not.toHaveBeenCalled();
      expect(clamAvService.getCacheStats().size).toBe(0);
    });
  });

  // ================================================================
  describe("isConfigured", () => {
    it("is truthy when enabled with only a unix socket path configured", () => {
      process.env.CLAMAV_ENABLED = "true";
      process.env.CLAMAV_SOCKET_PATH = "/var/run/clamav/clamd.ctl";

      const clamAvService = require("../../services/clamAv.service");

      expect(clamAvService.isConfigured()).toBeTruthy();
    });
  });

  // ================================================================
  describe("test-only scanCache export", () => {
    it("exposes scanCache under NODE_ENV=test", () => {
      process.env.NODE_ENV = "test";

      const clamAvService = require("../../services/clamAv.service");

      expect(clamAvService.scanCache).toBeDefined();
    });

    it("does not expose scanCache outside NODE_ENV=test", () => {
      process.env.NODE_ENV = "production";

      const clamAvService = require("../../services/clamAv.service");

      // The internal cache must not leak into the production surface.
      expect(clamAvService.scanCache).toBeUndefined();
      expect(typeof clamAvService.getCacheStats).toBe("function");
    });
  });
});

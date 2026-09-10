/**
 * Tests for clamAv.service.js
 */

const EventEmitter = require("events");

let mockSocketInstance;

class MockSocket extends EventEmitter {
  constructor() {
    super();
    mockSocketInstance = this;
    this.standbyResponse = "OK\r\n";
    this.scanResponse = "stream: OK";
    this.instreamWritten = false;
    this.write = jest.fn((data) => {
      if (data === "STANDBY\r\n") {
        if (this.standbyTimeout) {
          // Trigger timeout instead of responding
          return;
        }
        setImmediate(() => this.emit("data", Buffer.from(this.standbyResponse)));
      }
      if (data === "INSTREAM\r\n") {
        this.instreamWritten = true;
      }
      if (data === "\r\n" && this.instreamWritten) {
        setImmediate(() => this.emit("data", Buffer.from(this.scanResponse)));
      }
    });
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
  Socket: jest.fn().mockImplementation(() => new MockSocket()),
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

describe("clamAv.service", () => {
  const origEnv = { ...process.env };
  let originalSetTimeout = global.setTimeout;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...origEnv, CLAMAV_ENABLED: "false" };
  });

  afterEach(() => {
    process.env = origEnv;
    global.setTimeout = originalSetTimeout;
  });

  describe("scanFile", () => {
    it("should skip scanning when ClamAV is disabled", async () => {
      const clamAvService = require("../../services/clamAv.service");
      const result = await clamAvService.scanFile("/path/to/file.pdf");
      expect(result.isClean).toBe(true);
      expect(result.code).toBe("SKIPPED");
      expect(result.result).toBe("Skipped (disabled)");
    });

    it("should throw when filePath is null", async () => {
      process.env.CLAMAV_ENABLED = "true";
      const clamAvService = require("../../services/clamAv.service");
      await expect(clamAvService.scanFile(null)).rejects.toThrow(
        "File path is required for scanning"
      );
    });

    it("should throw when filePath is empty string", async () => {
      process.env.CLAMAV_ENABLED = "true";
      const clamAvService = require("../../services/clamAv.service");
      await expect(clamAvService.scanFile("")).rejects.toThrow(
        "File path is required for scanning"
      );
    });

    describe("HTTP mode", () => {
      it("should return OK when HTTP scan succeeds", async () => {
        process.env.CLAMAV_ENABLED = "true";
        process.env.CLAMAV_HTTP_MODE = "true";
        process.env.CLAMAV_HTTP_URL = "http://clamav.local:9000";
        process.env.CLAMAV_HTTP_KEY = "test-key";

        jest.spyOn(fs.promises, "stat").mockResolvedValue({ size: 100, mtimeMs: 999 });
        jest.spyOn(fs, "readFileSync").mockReturnValue(Buffer.from("test"));
        const { post } = require("axios");
        post.mockResolvedValueOnce({ data: "OK" });

        const clamAvService = require("../../services/clamAv.service");
        const result = await clamAvService.scanFile("/path/to/safe.pdf");

        expect(result.isClean).toBe(true);
        expect(result.code).toBe("OK");
        expect(post).toHaveBeenCalledWith(
          "http://clamav.local:9000",
          expect.any(Buffer),
          expect.objectContaining({
            headers: expect.objectContaining({ "X-HTTP-Key": "test-key" }),
          })
        );
      });

      it("should detect virus and return FOUND", async () => {
        process.env.CLAMAV_ENABLED = "true";
        process.env.CLAMAV_HTTP_MODE = "true";
        process.env.CLAMAV_HTTP_URL = "http://clamav.local:9000";

        jest.spyOn(fs.promises, "stat").mockResolvedValue({ size: 200, mtimeMs: 777 });
        jest.spyOn(fs, "readFileSync").mockReturnValue(Buffer.from("test"));
        const { post } = require("axios");
        post.mockResolvedValueOnce({ data: "FOUND: Trojan.Win32.Generic" });

        const clamAvService = require("../../services/clamAv.service");
        const result = await clamAvService.scanFile("/path/to/virus.exe");

        expect(result.isClean).toBe(false);
        expect(result.code).toBe("FOUND");
      });

      it("should throw 500 when scan fails with Axios response error", async () => {
        process.env.CLAMAV_ENABLED = "true";
        process.env.CLAMAV_HTTP_MODE = "true";
        process.env.CLAMAV_HTTP_URL = "http://clamav.local:9000";

        jest.spyOn(fs.promises, "stat").mockResolvedValue({ size: 100, mtimeMs: 999 });
        jest.spyOn(fs, "readFileSync").mockReturnValue(Buffer.from("test"));
        const { post } = require("axios");
        
        const axiosError = new Error("Request failed");
        axiosError.response = { status: 502 };
        post.mockRejectedValueOnce(axiosError);

        const clamAvService = require("../../services/clamAv.service");
        await expect(clamAvService.scanFile("/path/to/file.pdf")).rejects.toThrow(
          "File scan service unavailable"
        );
      });
    });

    describe("Socket mode", () => {
      it("should scan file successfully via socket port", async () => {
        process.env.CLAMAV_ENABLED = "true";
        process.env.CLAMAV_PORT = "3310";
        process.env.CLAMAV_HOST = "127.0.0.1";

        jest.spyOn(fs.promises, "stat").mockResolvedValue({ size: 100, mtimeMs: 999 });
        jest.spyOn(fs, "readFileSync").mockReturnValue(Buffer.from("test"));

        const clamAvService = require("../../services/clamAv.service");
        const result = await clamAvService.scanFile("/path/to/file.pdf");
        expect(result.isClean).toBe(true);
        expect(result.code).toBe("OK");
      });

      it("should report FOUND when the socket scan reports an infection", async () => {
        process.env.CLAMAV_ENABLED = "true";

        jest.spyOn(fs.promises, "stat").mockResolvedValue({ size: 400, mtimeMs: 555 });
        jest.spyOn(fs, "readFileSync").mockReturnValue(Buffer.from("virus"));

        const clamAvService = require("../../services/clamAv.service");
        clamAvService.clearCache();

        const checkPromise = clamAvService.scanFile("/path/to/eicar.com");
        setImmediate(() => {
          mockSocketInstance.scanResponse = "stream: Eicar-Test-Signature FOUND";
        });

        const result = await checkPromise;

        expect(result.isClean).toBe(false);
        expect(result.code).toBe("FOUND");
        expect(result.result).toBe("stream: Eicar-Test-Signature FOUND");

        const { logger } = require("../../middlewares/activityLog.middleware");
        expect(logger.warn).toHaveBeenCalledWith(
          "Virus detected in uploaded file",
          expect.objectContaining({ filePath: "/path/to/eicar.com" })
        );
      });

      it("should scan file via socket path CNAME instruction", async () => {
        process.env.CLAMAV_ENABLED = "true";
        process.env.CLAMAV_SOCKET_PATH = "/var/run/clamav/clamd.ctl";

        jest.spyOn(fs.promises, "stat").mockResolvedValue({ size: 100, mtimeMs: 999 });
        jest.spyOn(fs, "readFileSync").mockReturnValue(Buffer.from("test"));

        const clamAvService = require("../../services/clamAv.service");
        const result = await clamAvService.scanFile("/path/to/file.pdf");
        expect(result.isClean).toBe(true);
      });

      it("should throw error if STANDBY fails", async () => {
        process.env.CLAMAV_ENABLED = "true";

        jest.spyOn(fs.promises, "stat").mockResolvedValue({ size: 100, mtimeMs: 999 });
        jest.spyOn(fs, "readFileSync").mockReturnValue(Buffer.from("test"));

        const clamAvService = require("../../services/clamAv.service");

        // Force next socket instance to respond with FAIL on STANDBY
        const checkPromise = clamAvService.scanFile("/path/to/file.pdf");
        setImmediate(() => {
          mockSocketInstance.standbyResponse = "FAIL";
        });

        await expect(checkPromise).rejects.toThrow("File scan service unavailable");
      });

      it("should handle socket connection error", async () => {
        process.env.CLAMAV_ENABLED = "true";

        jest.spyOn(fs.promises, "stat").mockResolvedValue({ size: 100, mtimeMs: 999 });
        jest.spyOn(fs, "readFileSync").mockReturnValue(Buffer.from("test"));

        const clamAvService = require("../../services/clamAv.service");
        const checkPromise = clamAvService.scanFile("/path/to/file.pdf");

        setImmediate(() => {
          mockSocketInstance.emit("error", new Error("Connection refused"));
        });

        await expect(checkPromise).rejects.toThrow("File scan service unavailable");
      });

      it("should timeout standby command", async () => {
        global.setTimeout = jest.fn((cb, ms) => {
          if (ms === 5000) {
            return originalSetTimeout(cb, 10);
          }
          return originalSetTimeout(cb, ms);
        });

        process.env.CLAMAV_ENABLED = "true";

        jest.spyOn(fs.promises, "stat").mockResolvedValue({ size: 100, mtimeMs: 999 });
        jest.spyOn(fs, "readFileSync").mockReturnValue(Buffer.from("test"));

        const clamAvService = require("../../services/clamAv.service");
        const checkPromise = clamAvService.scanFile("/path/to/file.pdf");

        setImmediate(() => {
          mockSocketInstance.standbyTimeout = true;
        });

        await expect(checkPromise).rejects.toThrow("File scan service unavailable");
      });
    });

    describe("Cache functionality", () => {
      it("should store result in cache and retrieve it on second scan", async () => {
        process.env.CLAMAV_ENABLED = "true";
        process.env.CLAMAV_HTTP_MODE = "true";
        process.env.CLAMAV_HTTP_URL = "http://clamav.local:9000";

        jest.spyOn(fs.promises, "stat").mockResolvedValue({ size: 300, mtimeMs: 888 });
        jest.spyOn(fs, "readFileSync").mockReturnValue(Buffer.from("test"));
        const { post } = require("axios");
        post.mockResolvedValueOnce({ data: "OK" });

        const clamAvService = require("../../services/clamAv.service");

        // First scan (Cache miss)
        const res1 = await clamAvService.scanFile("/path/to/cache-test.pdf");
        expect(res1.code).toBe("OK");

        // Second scan (Cache hit)
        const res2 = await clamAvService.scanFile("/path/to/cache-test.pdf");
        expect(res2.code).toBe("CACHE");
        expect(res2.isClean).toBe(true);
      });

      it("should evict oldest cached records when cache capacity is reached", async () => {
        const clamAvService = require("../../services/clamAv.service");
        clamAvService.clearCache();

        // Adjust maxSize to 2 for testing
        clamAvService.scanCache._maxSize = 2;

        // Add 2 entries
        clamAvService.scanCache.set("key1", true);
        clamAvService.scanCache.set("key2", true);

        // Add 3rd entry - should evict oldest ("key1")
        clamAvService.scanCache.set("key3", true);

        expect(clamAvService.scanCache.get("key1")).toBeNull();
        expect(clamAvService.scanCache.get("key2")).toBe(true);
        expect(clamAvService.scanCache.get("key3")).toBe(true);
      });
    });
  });

  describe("scanFiles", () => {
    it("should scan multiple files and return results", async () => {
      const clamAvService = require("../../services/clamAv.service");
      const files = [
        { path: "/file1.pdf", mimetype: "application/pdf" },
        { path: "/file2.exe", mimetype: "application/exe" },
      ];
      const results = await clamAvService.scanFiles(files);
      expect(results).toHaveLength(2);
      expect(results[0].isClean).toBe(true);
      expect(results[1].isClean).toBe(true);
    });

    it("should record failed scans in files list gracefully", async () => {
      process.env.CLAMAV_ENABLED = "true";
      process.env.CLAMAV_HTTP_MODE = "true";
      process.env.CLAMAV_HTTP_URL = "http://clamav.local:9000";

      jest.spyOn(fs.promises, "stat").mockResolvedValue({ size: 100, mtimeMs: 999 });
      jest.spyOn(fs, "readFileSync").mockReturnValue(Buffer.from("test"));
      const { post } = require("axios");
      post.mockRejectedValue(new Error("Network Down"));

      const clamAvService = require("../../services/clamAv.service");
      const files = [{ path: "/file1.pdf", mimetype: "application/pdf" }];
      const results = await clamAvService.scanFiles(files);

      expect(results[0].isClean).toBe(false);
      expect(results[0].result).toContain("Scan error: File scan service unavailable");
    });
  });

  describe("clearCache", () => {
    it("should clear the scan cache", () => {
      const clamAvService = require("../../services/clamAv.service");
      clamAvService.clearCache();
      const stats = clamAvService.getCacheStats();
      expect(stats.size).toBe(0);
    });
  });

  describe("getCacheStats", () => {
    it("should return cache stats with defaults", () => {
      const clamAvService = require("../../services/clamAv.service");
      const stats = clamAvService.getCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.maxSize).toBe(10000);
      expect(stats.ttl).toBe(24 * 60 * 60 * 1000);
    });
  });

  describe("isConfigured", () => {
    it("should return false when ClamAV is disabled", () => {
      const clamAvService = require("../../services/clamAv.service");
      expect(clamAvService.isConfigured()).toBe(false);
    });

    it("should return truthy when ClamAV is enabled", () => {
      process.env.CLAMAV_ENABLED = "true";
      const clamAvService = require("../../services/clamAv.service");
      expect(clamAvService.isConfigured()).toBeTruthy();
    });

    it("should return true when ClamAV is enabled with HTTP mode", () => {
      process.env.CLAMAV_ENABLED = "true";
      process.env.CLAMAV_HTTP_MODE = "true";
      process.env.CLAMAV_HTTP_URL = "http://clamav.local:9000";
      const clamAvService = require("../../services/clamAv.service");
      expect(clamAvService.isConfigured()).toBe(true);
    });
  });

  describe("getStatus", () => {
    it("should return service status with disabled ClamAV", () => {
      const clamAvService = require("../../services/clamAv.service");
      const status = clamAvService.getStatus();
      expect(status.enabled).toBe(false);
      expect(status.mode).toBe("socket");
    });

    it("should return HTTP mode status when enabled", () => {
      process.env.CLAMAV_ENABLED = "true";
      process.env.CLAMAV_HTTP_MODE = "true";
      process.env.CLAMAV_HTTP_URL = "http://clamav.local:8080";
      const clamAvService = require("../../services/clamAv.service");
      const status = clamAvService.getStatus();
      expect(status.enabled).toBe(true);
      expect(status.mode).toBe("http");
      expect(status.host).toBe("http://clamav.local:8080");
    });
  });
});

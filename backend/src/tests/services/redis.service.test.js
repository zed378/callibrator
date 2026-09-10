/**
 * Tests for redis.service.js
 */

let mockConnected = true;
let mockStatus = "ready";
let mockOnErrorCallback = null;

const mockConnect = jest.fn().mockResolvedValue(undefined);
const mockGet = jest.fn().mockResolvedValue(null);
const mockSet = jest.fn().mockResolvedValue("OK");
const mockSetex = jest.fn().mockResolvedValue("OK");
const mockDel = jest.fn().mockResolvedValue(1);
const mockScan = jest.fn().mockResolvedValue(["0", []]);
const mockEval = jest.fn().mockResolvedValue(1);
const mockQuit = jest.fn().mockResolvedValue(undefined);
const mockOn = jest.fn().mockImplementation((event, callback) => {
  if (event === "error") {
    mockOnErrorCallback = callback;
  }
});
const mockOnce = jest.fn();

jest.mock("ioredis", () => {
  return jest.fn().mockImplementation(() => ({
    connect: mockConnect,
    get: mockGet,
    set: mockSet,
    setex: mockSetex,
    del: mockDel,
    scan: mockScan,
    eval: mockEval,
    quit: mockQuit,
    on: mockOn,
    once: mockOnce,
    get connected() {
      return mockConnected;
    },
    get status() {
      return mockStatus;
    },
  }));
});

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

describe("redis.service", () => {
  let redisService;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockConnected = true;
    mockStatus = "ready";
    mockOnErrorCallback = null;
    mockGet.mockResolvedValue(null);
    mockSet.mockResolvedValue("OK");
    mockSetex.mockResolvedValue("OK");
    mockDel.mockResolvedValue(1);
    mockScan.mockResolvedValue(["0", []]);
    mockEval.mockResolvedValue(1);
    mockQuit.mockResolvedValue(undefined);

    redisService = require("../../services/redis.service");
  });

  describe("initRedis", () => {
    it("should initialize Redis connection successfully when not already connected", async () => {
      mockConnected = false;
      const client = await redisService.initRedis();
      expect(client).toBeDefined();
      expect(mockConnect).toHaveBeenCalled();
    });

    it("should return client immediately if already connected", async () => {
      mockConnected = true;
      const client = await redisService.initRedis();
      expect(client).toBeDefined();
      expect(mockConnect).not.toHaveBeenCalled();
    });

    it("should resolve when client status is connecting and triggers ready event", async () => {
      mockConnected = false;
      mockStatus = "connecting";
      
      let readyCallback;
      mockOnce.mockImplementation((event, callback) => {
        if (event === "ready") {
          readyCallback = callback;
        }
      });

      const initPromise = redisService.initRedis();
      
      // Yield control to the event loop to let initRedis advance past connect()
      await new Promise(resolve => setImmediate(resolve));
      
      expect(readyCallback).toBeDefined();
      readyCallback();

      const client = await initPromise;
      expect(client).toBeDefined();
    });

    it("should log error and return null when connect throws", async () => {
      mockConnected = false;
      mockConnect.mockRejectedValue(new Error("Connect failed"));

      const client = await redisService.initRedis();
      expect(client).toBeNull();
      const { logger } = require("../../middlewares/activityLog.middleware");
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "Redis Initialization Failed",
          message: "Connect failed",
        })
      );
    });
  });

  describe("getRedisConnection and configurations", () => {
    it("should return the cached connection if already initialized", () => {
      const conn1 = redisService.getRedisConnection();
      const conn2 = redisService.getRedisConnection();
      expect(conn1).toBe(conn2);
    });

    it("should configure retryStrategy properly", () => {
      redisService.getRedisConnection();
      const mockRedisConstructor = require("ioredis");
      const options = mockRedisConstructor.mock.calls[0][1];
      expect(options.retryStrategy).toBeDefined();
      expect(options.retryStrategy(2)).toBe(400);
      expect(options.retryStrategy(5)).toBeNull();
    });
  });

  describe("getRedisConnection error listener", () => {
    it("should trigger error callback and log redis connection errors", () => {
      // Trigger connection initialization to register the error listener
      redisService.getRedisConnection();
      
      expect(mockOnErrorCallback).toBeDefined();
      expect(typeof mockOnErrorCallback).toBe("function");
      
      mockOnErrorCallback(new Error("Some Redis Error"));

      const { logger } = require("../../middlewares/activityLog.middleware");
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "Redis Connection Error",
          message: "Some Redis Error",
        })
      );
    });
  });

  describe("get", () => {
    it("should return null if client is not connected", async () => {
      mockConnected = false;
      const result = await redisService.get("key");
      expect(result).toBeNull();
    });

    it("should return parsed JSON object if JSON string is cached", async () => {
      mockGet.mockResolvedValue(JSON.stringify({ a: 1 }));
      const result = await redisService.get("key");
      expect(result).toEqual({ a: 1 });
    });

    it("should return raw string if not JSON string", async () => {
      mockGet.mockResolvedValue("raw_value");
      const result = await redisService.get("key");
      expect(result).toBe("raw_value");
    });

    it("should return null and log error if client.get throws", async () => {
      mockGet.mockRejectedValue(new Error("GET failed"));
      const result = await redisService.get("key");
      expect(result).toBeNull();
      const { logger } = require("../../middlewares/activityLog.middleware");
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "Redis GET Error",
          message: "GET failed",
        })
      );
    });
  });

  describe("set", () => {
    it("should return false if client is not connected", async () => {
      mockConnected = false;
      const result = await redisService.set("key", "value");
      expect(result).toBe(false);
    });

    it("should set string values directly", async () => {
      const result = await redisService.set("key", "value", 100);
      expect(result).toBe(true);
      expect(mockSetex).toHaveBeenCalledWith("key", 100, "value");
    });

    it("should serialize objects to JSON strings before setting", async () => {
      const result = await redisService.set("key", { a: 1 });
      expect(result).toBe(true);
      expect(mockSetex).toHaveBeenCalledWith("key", 300, JSON.stringify({ a: 1 }));
    });

    it("should return false and log error if setex throws", async () => {
      mockSetex.mockRejectedValue(new Error("SET failed"));
      const result = await redisService.set("key", "value");
      expect(result).toBe(false);
      const { logger } = require("../../middlewares/activityLog.middleware");
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "Redis SET Error",
          message: "SET failed",
        })
      );
    });
  });

  describe("del", () => {
    it("should return false if client is not connected", async () => {
      mockConnected = false;
      const result = await redisService.del("key");
      expect(result).toBe(false);
    });

    it("should delete key and return true", async () => {
      const result = await redisService.del("key");
      expect(result).toBe(true);
      expect(mockDel).toHaveBeenCalledWith("key");
    });

    it("should return false and log error if client.del throws", async () => {
      mockDel.mockRejectedValue(new Error("DEL failed"));
      const result = await redisService.del("key");
      expect(result).toBe(false);
      const { logger } = require("../../middlewares/activityLog.middleware");
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "Redis DEL Error",
          message: "DEL failed",
        })
      );
    });
  });

  describe("delPattern", () => {
    it("should return 0 if client is not connected", async () => {
      mockConnected = false;
      const result = await redisService.delPattern("pattern:*");
      expect(result).toBe(0);
    });

    it("should scan and delete matching keys sequentially", async () => {
      mockScan
        .mockResolvedValueOnce(["123", ["k1", "k2"]])
        .mockResolvedValueOnce(["0", ["k3"]]);

      const result = await redisService.delPattern("pattern:*");
      expect(result).toBe(3);
      expect(mockDel).toHaveBeenCalledTimes(2);
      expect(mockDel).toHaveBeenNthCalledWith(1, "k1", "k2");
      expect(mockDel).toHaveBeenNthCalledWith(2, "k3");
    });

    it("should return 0 and log error if scan throws", async () => {
      mockScan.mockRejectedValue(new Error("SCAN failed"));
      const result = await redisService.delPattern("pattern:*");
      expect(result).toBe(0);
      const { logger } = require("../../middlewares/activityLog.middleware");
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "Redis DEL Pattern Error",
          message: "SCAN failed",
        })
      );
    });
  });

  describe("acquireLock", () => {
    it("should return null if client is not connected", async () => {
      mockConnected = false;
      const result = await redisService.acquireLock("lockKey");
      expect(result).toBeNull();
    });

    it("should return lockId if lock is successfully acquired (returns OK)", async () => {
      mockSet.mockResolvedValue("OK");
      const result = await redisService.acquireLock("lockKey", 5000);
      expect(result).toBeDefined();
      expect(typeof result).toBe("string");
      expect(mockSet).toHaveBeenCalledWith(
        "lock:lockKey",
        result,
        "EX",
        5,
        "NX"
      );
    });

    it("should return null if lock acquisition fails (does not return OK)", async () => {
      mockSet.mockResolvedValue(null);
      const result = await redisService.acquireLock("lockKey");
      expect(result).toBeNull();
    });

    it("should return null and log error if set throws", async () => {
      mockSet.mockRejectedValue(new Error("Lock SET failed"));
      const result = await redisService.acquireLock("lockKey");
      expect(result).toBeNull();
      const { logger } = require("../../middlewares/activityLog.middleware");
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "Redis Lock Error",
          message: "Lock SET failed",
        })
      );
    });
  });

  describe("releaseLock", () => {
    it("should return false if client is not connected", async () => {
      mockConnected = false;
      const result = await redisService.releaseLock("lockKey", "id-123");
      expect(result).toBe(false);
    });

    it("should return true if eval script successfully releases the lock", async () => {
      mockEval.mockResolvedValue(1);
      const result = await redisService.releaseLock("lockKey", "id-123");
      expect(result).toBe(true);
      expect(mockEval).toHaveBeenCalled();
    });

    it("should return false if eval script returns 0 (lock not owned by this ID)", async () => {
      mockEval.mockResolvedValue(0);
      const result = await redisService.releaseLock("lockKey", "id-123");
      expect(result).toBe(false);
    });

    it("should return false and log error if eval throws", async () => {
      mockEval.mockRejectedValue(new Error("EVAL failed"));
      const result = await redisService.releaseLock("lockKey", "id-123");
      expect(result).toBe(false);
      const { logger } = require("../../middlewares/activityLog.middleware");
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "Redis Unlock Error",
          message: "EVAL failed",
        })
      );
    });
  });

  describe("cacheKeys", () => {
    it("should generate correct key strings for various resource types", () => {
      expect(redisService.cacheKeys.user("user-123")).toBe("user:user-123");
      expect(redisService.cacheKeys.userByEmail("test@example.com")).toBe("user:email:test@example.com");
      expect(redisService.cacheKeys.userByUsername("testuser")).toBe("user:username:testuser");
      expect(redisService.cacheKeys.tenant("tenant-456")).toBe("tenant:tenant-456");
      expect(redisService.cacheKeys.tenantByCode("TNT")).toBe("tenant:code:TNT");
      expect(redisService.cacheKeys.tenantSettings("tenant-456")).toBe("tenant:settings:tenant-456");
      expect(redisService.cacheKeys.role("role-789")).toBe("role:role-789");
      expect(redisService.cacheKeys.permissions("role-789")).toBe("permissions:role:role-789");
      expect(redisService.cacheKeys.userPermissions("user-123")).toBe("permissions:user:user-123");
      expect(redisService.cacheKeys.session("sessionHash")).toBe("session:sessionHash");
      expect(redisService.cacheKeys.rateLimit("192.168.1.1")).toBe("ratelimit:192.168.1.1");
      expect(redisService.cacheKeys.lock("resourceName")).toBe("lock:resourceName");
    });
  });

  describe("closeRedis", () => {
    it("should quit and close Redis connection", async () => {
      // Initialize internal connection
      await redisService.initRedis();
      
      await redisService.closeRedis();
      expect(mockQuit).toHaveBeenCalled();
      const { logger } = require("../../middlewares/activityLog.middleware");
      expect(logger.info).toHaveBeenCalledWith("Redis connection closed");
    });

    it("should log error if quit fails", async () => {
      await redisService.initRedis();
      mockQuit.mockRejectedValue(new Error("Quit failed"));

      await redisService.closeRedis();
      const { logger } = require("../../middlewares/activityLog.middleware");
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "Redis Close Error",
          message: "Quit failed",
        })
      );
    });

    it("is a no-op when no connection was ever created", async () => {
      // Fresh module: `redis` is still null, so quit must not be attempted.
      jest.resetModules();
      const fresh = require("../../services/redis.service");

      await expect(fresh.closeRedis()).resolves.toBeUndefined();
      expect(mockQuit).not.toHaveBeenCalled();
    });
  });

  // ================================================================
  // Coverage: connection URL construction + remaining branches
  // ================================================================
  describe("getRedisConnection URL construction", () => {
    const origEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...origEnv };
    });

    it("uses REDIS_URL verbatim when it is set", () => {
      jest.resetModules();
      process.env.REDIS_URL = "redis://cache.internal:6380";
      const Redis = require("ioredis");
      const fresh = require("../../services/redis.service");

      fresh.getRedisConnection();

      expect(Redis).toHaveBeenCalledWith(
        "redis://cache.internal:6380",
        expect.objectContaining({ lazyConnect: true, maxRetriesPerRequest: 3 })
      );
    });

    it("builds the URL from REDIS_HOST and REDIS_PORT when REDIS_URL is unset", () => {
      jest.resetModules();
      delete process.env.REDIS_URL;
      process.env.REDIS_HOST = "redis-host";
      process.env.REDIS_PORT = "6399";
      const Redis = require("ioredis");
      const fresh = require("../../services/redis.service");

      fresh.getRedisConnection();

      expect(Redis).toHaveBeenCalledWith(
        "redis://redis-host:6399",
        expect.any(Object)
      );
    });

    it("falls back to localhost:6379 when no Redis env vars are set", () => {
      jest.resetModules();
      delete process.env.REDIS_URL;
      delete process.env.REDIS_HOST;
      delete process.env.REDIS_PORT;
      const Redis = require("ioredis");
      const fresh = require("../../services/redis.service");

      fresh.getRedisConnection();

      expect(Redis).toHaveBeenCalledWith(
        "redis://localhost:6379",
        expect.any(Object)
      );
    });

    it("returns the memoized client on a second call", () => {
      jest.resetModules();
      const Redis = require("ioredis");
      const fresh = require("../../services/redis.service");

      const a = fresh.getRedisConnection();
      const b = fresh.getRedisConnection();

      expect(a).toBe(b);
      expect(Redis).toHaveBeenCalledTimes(1);
    });

    it("registers an error handler that logs the connection error", () => {
      jest.resetModules();
      const fresh = require("../../services/redis.service");
      fresh.getRedisConnection();

      expect(mockOnErrorCallback).toBeInstanceOf(Function);
      mockOnErrorCallback(new Error("ECONNREFUSED"));

      const { logger } = require("../../middlewares/activityLog.middleware");
      expect(logger.error).toHaveBeenCalledWith({
        status: "Redis Connection Error",
        message: "ECONNREFUSED",
      });
    });

    it("retries up to 3 times then gives up", () => {
      jest.resetModules();
      const Redis = require("ioredis");
      const fresh = require("../../services/redis.service");
      fresh.getRedisConnection();

      const { retryStrategy } = Redis.mock.calls[0][1];

      expect(retryStrategy(1)).toBe(200);
      expect(retryStrategy(3)).toBe(600);
      // Capped at 1000ms, and null after 3 attempts = stop retrying.
      expect(retryStrategy(4)).toBeNull();
    });
  });

  describe("get value branches", () => {
    it("returns a parsed object for JSON payloads", async () => {
      mockGet.mockResolvedValue('{"id":"u1","active":true}');

      await expect(redisService.get("user:u1")).resolves.toEqual({
        id: "u1",
        active: true,
      });
    });

    it("returns the raw string when the payload is not JSON", async () => {
      mockGet.mockResolvedValue("not-json-at-all");

      await expect(redisService.get("k")).resolves.toBe("not-json-at-all");
    });

    it("returns null for an empty-string payload", async () => {
      mockGet.mockResolvedValue("");

      await expect(redisService.get("k")).resolves.toBeNull();
    });
  });

  describe("delPattern batch branches", () => {
    it("returns 0 and issues no DEL when the scan finds no keys", async () => {
      mockScan.mockResolvedValue(["0", []]);

      await expect(redisService.delPattern("user:*")).resolves.toBe(0);
      expect(mockDel).not.toHaveBeenCalled();
    });

    it("walks every cursor page and sums the deletions", async () => {
      mockScan
        .mockResolvedValueOnce(["17", ["user:1", "user:2"]])
        .mockResolvedValueOnce(["42", []]) // an empty middle page must not stop the walk
        .mockResolvedValueOnce(["0", ["user:3"]]);

      await expect(redisService.delPattern("user:*")).resolves.toBe(3);
      expect(mockScan).toHaveBeenCalledTimes(3);
      expect(mockDel).toHaveBeenCalledWith("user:1", "user:2");
      expect(mockDel).toHaveBeenCalledWith("user:3");
    });
  });

  describe("acquireLock result branches", () => {
    it("returns null when the lock is already held (SET NX returns null)", async () => {
      mockSet.mockResolvedValue(null);

      await expect(redisService.acquireLock("resource")).resolves.toBeNull();
    });

    it("passes the TTL through as whole seconds, rounded up", async () => {
      mockSet.mockResolvedValue("OK");

      const lockId = await redisService.acquireLock("resource", 2500);

      expect(lockId).toEqual(expect.any(String));
      expect(mockSet).toHaveBeenCalledWith(
        "lock:resource",
        lockId,
        "EX",
        3,
        "NX"
      );
    });
  });

  describe("releaseLock result branches", () => {
    it("returns false when the lock is owned by someone else (eval returns 0)", async () => {
      mockEval.mockResolvedValue(0);

      await expect(redisService.releaseLock("resource", "lock-1")).resolves.toBe(
        false
      );
    });
  });

  describe("cacheKeys", () => {
    it("builds every documented key shape", () => {
      const { cacheKeys } = redisService;
      expect(cacheKeys.user("u1")).toBe("user:u1");
      expect(cacheKeys.userByEmail("a@b.com")).toBe("user:email:a@b.com");
      expect(cacheKeys.userByUsername("bob")).toBe("user:username:bob");
      expect(cacheKeys.tenant("t1")).toBe("tenant:t1");
      expect(cacheKeys.tenantByCode("T1")).toBe("tenant:code:T1");
      expect(cacheKeys.tenantSettings("t1")).toBe("tenant:settings:t1");
      expect(cacheKeys.role("r1")).toBe("role:r1");
      expect(cacheKeys.permissions("r1")).toBe("permissions:role:r1");
      expect(cacheKeys.userPermissions("u1")).toBe("permissions:user:u1");
      expect(cacheKeys.session("abc")).toBe("session:abc");
      expect(cacheKeys.rateLimit("ip")).toBe("ratelimit:ip");
      expect(cacheKeys.lock("res")).toBe("lock:res");
    });
  });
});

/**
 * Tests for circuitBreaker utility
 */

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const {
  CircuitBreaker,
  CircuitBreakerPool,
  STATES,
  getBreaker,
  withCircuitBreaker,
  getPoolStats,
  resetAll,
} = require("../../utils/circuitBreaker.util");

describe("circuitBreaker", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("STATES", () => {
    it("should define states", () => {
      expect(STATES.CLOSED).toBe("closed");
      expect(STATES.OPEN).toBe("open");
      expect(STATES.HALF_OPEN).toBe("half_open");
    });
  });

  describe("CircuitBreaker class", () => {
    it("should start in closed state", () => {
      const cb = new CircuitBreaker({ threshold: 5 });

      expect(cb.getState().state).toBe("closed");
    });

    it("should execute function successfully in closed state", async () => {
      const cb = new CircuitBreaker({ threshold: 5 });
      const result = await cb.execute(async () => "success");

      expect(result).toBe("success");
    });

    it("should throw when circuit is open", async () => {
      const cb = new CircuitBreaker({ threshold: 2, timeout: 30000 });

      cb._failureCount = 2;
      cb._lastFailureTime = Date.now();
      cb._state = STATES.OPEN;

      await expect(cb.execute(async () => "test")).rejects.toThrow(
        "Circuit breaker 'default' is open",
      );
    });

    it("should transition to half-open after timeout", async () => {
      const cb = new CircuitBreaker({ threshold: 2, timeout: 100 });

      cb._failureCount = 2;
      cb._lastFailureTime = Date.now() - 200;
      cb._state = STATES.OPEN;

      await cb.execute(async () => "test");

      expect(cb.getState().state).toBe("half_open");
    });

    it("should close after enough successes in half-open", async () => {
      const cb = new CircuitBreaker({
        threshold: 2,
        timeout: 100,
        successThreshold: 1,
      });

      cb._failureCount = 2;
      cb._lastFailureTime = Date.now() - 200;
      cb._state = STATES.OPEN;

      await cb.execute(async () => "success");

      expect(cb.getState().state).toBe("closed");
    });

    it("should open after reaching failure threshold", async () => {
      const cb = new CircuitBreaker({ threshold: 3 });

      for (let i = 0; i < 3; i++) {
        try {
          await cb.execute(async () => {
            throw new Error("Error");
          });
        } catch {
          // ignore
        }
      }

      expect(cb.getState().state).toBe("open");
    });

    it("should reset on successful execution in closed state", async () => {
      const cb = new CircuitBreaker({ threshold: 5 });

      cb._failureCount = 3;
      await cb.execute(async () => "success");

      expect(cb.getState().failureCount).toBe(0);
    });

    it("should reset when manually reset", () => {
      const cb = new CircuitBreaker({ threshold: 5 });

      cb._failureCount = 3;
      cb._state = STATES.OPEN;
      cb.reset();

      expect(cb.getState().state).toBe("closed");
      expect(cb.getState().failureCount).toBe(0);
    });

    it("should allow manual open", () => {
      const cb = new CircuitBreaker({ threshold: 5 });

      cb.open();

      expect(cb.getState().state).toBe("open");
    });

    it("should emit events", async () => {
      const cb = new CircuitBreaker({ threshold: 2 });
      const events = [];

      cb.on("open", () => events.push("open"));
      cb.on("failure", () => events.push("failure"));

      for (let i = 0; i < 2; i++) {
        try {
          await cb.execute(async () => {
            throw new Error("Error");
          });
        } catch {
          // ignore
        }
      }

      expect(events).toContain("open");
      expect(events).toContain("failure");
    });

    it("should transition to open on failure in half-open state", async () => {
      const cb = new CircuitBreaker({ threshold: 2 });
      cb._state = STATES.HALF_OPEN;

      try {
        await cb.execute(async () => {
          throw new Error("Failure");
        });
      } catch {
        // ignore
      }

      expect(cb.getState().state).toBe("open");
    });

    it("should log error when event listener throws", () => {
      const cb = new CircuitBreaker({ name: "listener_test" });
      const { logger } = require("../../middlewares/activityLog.middleware");
      
      cb.on("open", () => {
        throw new Error("Listener crash");
      });

      cb._state = STATES.CLOSED;
      cb.open();

      expect(logger.error).toHaveBeenCalledWith("Circuit breaker listener error", {
        name: "listener_test",
        event: "open",
        error: "Listener crash",
      });
    });
  });

  describe("CircuitBreakerPool", () => {
    it("should create new breaker if not exists", () => {
      const pool = new CircuitBreakerPool();
      const breaker = pool.get("test-service", { threshold: 3 });

      expect(breaker).toBeInstanceOf(CircuitBreaker);
    });

    it("should return existing breaker", () => {
      const pool = new CircuitBreakerPool();
      const breaker1 = pool.get("test-service");
      const breaker2 = pool.get("test-service");

      expect(breaker1).toBe(breaker2);
    });

    it("should return all states", () => {
      const pool = new CircuitBreakerPool();
      pool.get("service-1");
      pool.get("service-2");

      const states = pool.getAllStates();

      expect(states["service-1"]).toBeDefined();
      expect(states["service-2"]).toBeDefined();
    });

    it("should reset all breakers", () => {
      const pool = new CircuitBreakerPool();
      const b1 = pool.get("service-1");
      const b2 = pool.get("service-2");

      b1.open();
      b2.open();

      pool.resetAll();

      expect(b1.getState().state).toBe("closed");
      expect(b2.getState().state).toBe("closed");
    });

    it("should return pool stats", () => {
      const pool = new CircuitBreakerPool();
      pool.get("service-1");
      pool.get("service-2");

      const stats = pool.stats();

      expect(stats.count).toBe(2);
      expect(stats.breakers).toBeDefined();
    });
  });

  describe("getBreaker", () => {
    it("should return pre-configured breaker for email", () => {
      const breaker = getBreaker("email");

      expect(breaker).toBeInstanceOf(CircuitBreaker);
      expect(breaker.getState().name).toBe("email_service");
    });

    it("should return default breaker for unknown service", () => {
      const breaker = getBreaker("unknown");

      expect(breaker).toBeInstanceOf(CircuitBreaker);
    });
  });

  describe("withCircuitBreaker", () => {
    it("should execute function with circuit breaker", async () => {
      const result = await withCircuitBreaker("default", async () => "ok");

      expect(result).toBe("ok");
    });

    it("should throw when circuit is open", async () => {
      const breaker = getBreaker("default");
      breaker._failureCount = 5;
      breaker._lastFailureTime = Date.now();
      breaker._state = STATES.OPEN;

      await expect(
        withCircuitBreaker("default", async () => "ok"),
      ).rejects.toThrow();
    });
  });

  describe("getPoolStats", () => {
    it("should return pool stats", () => {
      const stats = getPoolStats();

      expect(stats).toHaveProperty("count");
      expect(stats).toHaveProperty("breakers");
    });
  });

  describe("resetAll", () => {
    it("should reset all breakers", () => {
      resetAll();

      expect(getPoolStats().breakers).toBeDefined();
    });
  });

  describe("extra branch edge cases", () => {
    it("should handle default options when constructor is called without args", () => {
      const cb = new CircuitBreaker();
      const stats = cb.getState();
      expect(stats.name).toBe("default");
      expect(cb._threshold).toBe(5);
      expect(cb._timeout).toBe(30000);
      expect(cb._halfOpenMax).toBe(1);
      expect(cb._successThreshold).toBe(3);
    });

    it("should handle registering invalid events and emitting invalid events", () => {
      const cb = new CircuitBreaker();
      cb.on("invalid_event", () => {});
      expect(cb._listeners["invalid_event"]).toBeUndefined();

      // Ensure emitting invalid event doesn't throw
      expect(() => cb._emit("invalid_event")).not.toThrow();
    });

    it("should handle _transitionTo with invalid state", () => {
      const cb = new CircuitBreaker();
      cb._transitionTo("UNKNOWN_STATE");
      expect(cb.getState().state).toBe("UNKNOWN_STATE");
    });

    it("should skip success processing when state is OPEN", async () => {
      const cb = new CircuitBreaker();
      cb._state = STATES.OPEN;
      await cb._onSuccess();
      expect(cb._failureCount).toBe(0); // should not hit closed state reset
    });
  });
});

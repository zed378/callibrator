/**
 * Circuit Breaker Pattern Implementation
 *
 * Prevents cascading failures when external services are unavailable.
 * States: CLOSED (normal) → OPEN (failing) → HALF_OPEN (testing)
 *
 * Usage:
 *   const breaker = new CircuitBreaker({ threshold: 5, timeout: 30000 });
 *   const result = await breaker.execute(() => externalApi.call());
 *
 * P9-09 (ADR-087 Amendment 2): converted from circuitBreaker.util.js with no
 * behaviour change. `withCircuitBreaker` still looks `getBreaker` up on the
 * module's exports at call time, as `exports.getBreaker(...)` did, so replacing
 * the export still reaches it.
 */
import { logger } from "../middlewares/activityLog.middleware";
// A named self-import compiles to a property read on this module's exports at
// call time (no interop helper), which is what `exports.getBreaker(...)` was.
import { getBreaker as exportedGetBreaker } from "./circuitBreaker.util";

// ==========================================
// CIRCUIT BREAKER STATES
// ==========================================

const STATES = {
  CLOSED: "closed",
  OPEN: "open",
  HALF_OPEN: "half_open",
} as const;

/** One breaker state. */
export type BreakerState = (typeof STATES)[keyof typeof STATES];

/** Construction options; each falls back to its default when falsy (as built). */
export interface CircuitBreakerOptions {
  threshold?: number;
  timeout?: number;
  halfOpenMax?: number;
  successThreshold?: number;
  name?: string;
}

/** What `getState()` reports. */
export interface BreakerSnapshot {
  name: string;
  state: BreakerState;
  failureCount: number;
  successCount: number;
  lastFailureTime: number | null;
}

type Listener = (data?: unknown) => void;

// ==========================================
// CIRCUIT BREAKER
// ==========================================

class CircuitBreaker {
  // `declare`: typed only, emitted as nothing — the constructor creates each
  // property, in this order, as the .js did (no class-field initialisers).
  declare _threshold: number;
  declare _timeout: number;
  declare _halfOpenMax: number;
  declare _successThreshold: number;
  declare _name: string;
  declare _state: BreakerState;
  declare _failureCount: number;
  declare _successCount: number;
  declare _lastFailureTime: number | null;
  declare _halfOpenCalls: number;
  declare _listeners: Record<string, Listener[] | undefined>;

  /**
   * Create a circuit breaker
   * @param options - Configuration
   * @param options.threshold - Number of failures before opening (default: 5)
   * @param options.timeout - Time in ms before half-open (default: 30000)
   * @param options.halfOpenMax - Max calls in half-open state (default: 1)
   * @param options.successThreshold - Successes needed to close (default: 3)
   * @param options.name - Breaker name for logging
   */
  constructor(options: CircuitBreakerOptions = {}) {
    /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built: 0 and "" fall back to the default */
    this._threshold = options.threshold || 5;
    this._timeout = options.timeout || 30000;
    this._halfOpenMax = options.halfOpenMax || 1;
    this._successThreshold = options.successThreshold || 3;
    this._name = options.name || "default";
    /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */

    this._state = STATES.CLOSED;
    this._failureCount = 0;
    this._successCount = 0;
    this._lastFailureTime = null;
    this._halfOpenCalls = 0;

    this._listeners = {
      open: [],
      halfOpen: [],
      closed: [],
      failure: [],
      success: [],
    };
  }

  /**
   * Execute a function through the circuit breaker
   * @param fn - Async function to execute
   * @returns Result of the function
   */
  async execute<T>(fn: () => T | Promise<T>): Promise<T> {
    if (this._state === STATES.OPEN) {
      // Check if timeout has passed. Number(null) is 0, exactly what `- null` did.
      if (Date.now() - Number(this._lastFailureTime) < this._timeout) {
        logger.debug("Circuit breaker is OPEN, short-circuiting", {
          name: this._name,
          failureCount: this._failureCount,
        });
        throw new Error(
          `Circuit breaker '${this._name}' is open. Service may be unavailable.`,
        );
      }

      // Transition to half-open
      this._transitionTo(STATES.HALF_OPEN);
    }

    try {
      const result = await fn();
      await this._onSuccess();
      return result;
    } catch (err: unknown) {
      await this._onFailure(err);
      throw err;
    }
  }

  /**
   * Handle successful execution
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- as built: async, so callers can await it
  async _onSuccess(): Promise<void> {
    if (this._state === STATES.HALF_OPEN) {
      this._successCount++;
      this._halfOpenCalls--;

      if (this._successCount >= this._successThreshold) {
        this._transitionTo(STATES.CLOSED);
      }
    } else if (this._state === STATES.CLOSED) {
      this._failureCount = 0;
    }

    this._emit("success");
  }

  /**
   * Handle failed execution
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- as built: async, so callers can await it
  async _onFailure(err: unknown): Promise<void> {
    this._failureCount++;
    this._lastFailureTime = Date.now();

    this._emit("failure", err);

    if (this._state === STATES.HALF_OPEN) {
      this._transitionTo(STATES.OPEN);
      return;
    }

    if (this._failureCount >= this._threshold) {
      this._transitionTo(STATES.OPEN);
    }
  }

  /**
   * Transition between states
   */
  _transitionTo(newState: BreakerState): void {
    const oldState = this._state;
    this._state = newState;

    if (newState === STATES.OPEN) {
      this._successCount = 0;
      this._halfOpenCalls = 0;
      logger.warn("Circuit breaker OPEN", {
        name: this._name,
        failureCount: this._failureCount,
        timeout: this._timeout,
      });
      this._emit("open");
    } else if (newState === STATES.HALF_OPEN) {
      this._successCount = 0;
      this._halfOpenCalls = this._halfOpenMax;
      logger.info("Circuit breaker HALF_OPEN", { name: this._name });
      this._emit("halfOpen");
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: JavaScript callers may pass any state, and an unknown one changes nothing here
    } else if (newState === STATES.CLOSED) {
      this._failureCount = 0;
      this._successCount = 0;
      this._halfOpenCalls = 0;
      logger.info("Circuit breaker CLOSED", { name: this._name });
      this._emit("closed");
    }

    logger.debug("Circuit breaker state change", {
      name: this._name,
      from: oldState,
      to: newState,
    });
  }

  /**
   * Register event listener
   */
  on(event: string, fn: Listener): void {
    const handlers = this._listeners[event];
    if (handlers) {
      handlers.push(fn);
    }
  }

  /**
   * Emit event
   */
  _emit(event: string, data?: unknown): void {
    const handlers = this._listeners[event] ?? [];
    handlers.forEach((fn) => {
      try {
        fn(data);
      } catch (err: unknown) {
        logger.error("Circuit breaker listener error", {
          name: this._name,
          event,
          // as built: `.message` of whatever the listener threw
          error: (err as { message?: unknown }).message,
        });
      }
    });
  }

  /**
   * Get current state
   */
  getState(): BreakerSnapshot {
    return {
      name: this._name,
      state: this._state,
      failureCount: this._failureCount,
      successCount: this._successCount,
      lastFailureTime: this._lastFailureTime,
    };
  }

  /**
   * Reset the circuit breaker
   */
  reset(): void {
    this._state = STATES.CLOSED;
    this._failureCount = 0;
    this._successCount = 0;
    this._lastFailureTime = null;
    this._halfOpenCalls = 0;
    logger.info("Circuit breaker reset", { name: this._name });
  }

  /**
   * Manually open the circuit breaker
   */
  open(): void {
    this._lastFailureTime = Date.now();
    this._transitionTo(STATES.OPEN);
  }
}

// ==========================================
// CIRCUIT BREAKER POOL
// ==========================================

class CircuitBreakerPool {
  declare _breakers: Map<string, CircuitBreaker>;

  constructor() {
    this._breakers = new Map();
  }

  /**
   * Get or create a circuit breaker
   */
  get(name: string, options: CircuitBreakerOptions = {}): CircuitBreaker {
    if (!this._breakers.has(name)) {
      this._breakers.set(name, new CircuitBreaker({ ...options, name }));
    }
    // Set just above when it was missing. `!` is banned (no-non-null-assertion);
    // the assertion states the same fact without a branch the tests cannot reach.
    return this._breakers.get(name) as CircuitBreaker;
  }

  getAllStates(): Record<string, BreakerSnapshot> {
    const states: Record<string, BreakerSnapshot> = {};
    this._breakers.forEach((breaker, name) => {
      states[name] = breaker.getState();
    });
    return states;
  }

  resetAll(): void {
    this._breakers.forEach((breaker) => {
      breaker.reset();
    });
  }

  stats(): { count: number; breakers: Record<string, BreakerSnapshot> } {
    return {
      count: this._breakers.size,
      breakers: this.getAllStates(),
    };
  }
}

// ==========================================
// PRE-CONFIGURED BREAKERS
// ==========================================

const pool = new CircuitBreakerPool();

interface ServiceConfig {
  threshold: number;
  timeout: number;
  name: string;
}

const getBreaker = (service: string): CircuitBreaker => {
  const configs: Record<string, ServiceConfig | undefined> & { default: ServiceConfig } = {
    email: { threshold: 3, timeout: 60000, name: "email_service" },
    storage: { threshold: 5, timeout: 30000, name: "storage_service" },
    sso: { threshold: 3, timeout: 60000, name: "sso_service" },
    default: { threshold: 5, timeout: 30000, name: "default" },
  };

  return pool.get(
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built
    configs[service]?.name || service,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built
    configs[service] || configs.default,
  );
};

const withCircuitBreaker = async <T>(service: string, fn: () => T | Promise<T>): Promise<T> => {
  const breaker = exportedGetBreaker(service);
  return breaker.execute(fn);
};

const getPoolStats = (): ReturnType<CircuitBreakerPool["stats"]> => pool.stats();

const resetAll = (): void => {
  pool.resetAll();
};

// ==========================================
// EXPORTS
// ==========================================

export { getBreaker, withCircuitBreaker, getPoolStats, resetAll, CircuitBreaker, CircuitBreakerPool, STATES };

/**
 * Circuit Breaker Pattern Implementation
 *
 * Prevents cascading failures when external services are unavailable.
 * States: CLOSED (normal) → OPEN (failing) → HALF_OPEN (testing)
 *
 * Usage:
 *   const breaker = new CircuitBreaker({ threshold: 5, timeout: 30000 });
 *   const result = await breaker.execute(() => externalApi.call());
 */

const { logger } = require("../middlewares/activityLog.middleware");

// ==========================================
// CIRCUIT BREAKER STATES
// ==========================================

const STATES = {
  CLOSED: "closed",
  OPEN: "open",
  HALF_OPEN: "half_open",
};

// ==========================================
// CIRCUIT BREAKER
// ==========================================

class CircuitBreaker {
  /**
   * Create a circuit breaker
   * @param {Object} options - Configuration
   * @param {number} options.threshold - Number of failures before opening (default: 5)
   * @param {number} options.timeout - Time in ms before half-open (default: 30000)
   * @param {number} options.halfOpenMax - Max calls in half-open state (default: 1)
   * @param {Function} options.successThreshold - Successes needed to close (default: 3)
   * @param {string} options.name - Breaker name for logging
   */
  constructor(options = {}) {
    this._threshold = options.threshold || 5;
    this._timeout = options.timeout || 30000;
    this._halfOpenMax = options.halfOpenMax || 1;
    this._successThreshold = options.successThreshold || 3;
    this._name = options.name || "default";

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
   * @param {Function} fn - Async function to execute
   * @returns {Promise<any>} Result of the function
   */
  async execute(fn) {
    if (this._state === STATES.OPEN) {
      // Check if timeout has passed
      if (Date.now() - this._lastFailureTime < this._timeout) {
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
    } catch (err) {
      await this._onFailure(err);
      throw err;
    }
  }

  /**
   * Handle successful execution
   */
  async _onSuccess() {
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
  async _onFailure(err) {
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
  _transitionTo(newState) {
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
  on(event, fn) {
    if (this._listeners[event]) {
      this._listeners[event].push(fn);
    }
  }

  /**
   * Emit event
   */
  _emit(event, data) {
    const handlers = this._listeners[event] || [];
    handlers.forEach((fn) => {
      try {
        fn(data);
      } catch (err) {
        logger.error("Circuit breaker listener error", {
          name: this._name,
          event,
          error: err.message,
        });
      }
    });
  }

  /**
   * Get current state
   */
  getState() {
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
  reset() {
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
  open() {
    this._lastFailureTime = Date.now();
    this._transitionTo(STATES.OPEN);
  }
}

// ==========================================
// CIRCUIT BREAKER POOL
// ==========================================

/**
 * Manage multiple circuit breakers for different services
 */
class CircuitBreakerPool {
  constructor() {
    this._breakers = new Map();
  }

  /**
   * Get or create a circuit breaker
   */
  get(name, options = {}) {
    if (!this._breakers.has(name)) {
      this._breakers.set(name, new CircuitBreaker({ ...options, name }));
    }
    return this._breakers.get(name);
  }

  /**
   * Get all breaker states
   */
  getAllStates() {
    const states = {};
    this._breakers.forEach((breaker, name) => {
      states[name] = breaker.getState();
    });
    return states;
  }

  /**
   * Reset all breakers
   */
  resetAll() {
    this._breakers.forEach((breaker) => breaker.reset());
  }

  /**
   * Get pool stats
   */
  stats() {
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

/**
 * Get a pre-configured circuit breaker for a service
 * @param {string} service - Service name
 * @returns {CircuitBreaker}
 */
exports.getBreaker = (service) => {
  const configs = {
    email: { threshold: 3, timeout: 60000, name: "email_service" },
    storage: { threshold: 5, timeout: 30000, name: "storage_service" },
    sso: { threshold: 3, timeout: 60000, name: "sso_service" },
    default: { threshold: 5, timeout: 30000, name: "default" },
  };

  return pool.get(
    configs[service]?.name || service,
    configs[service] || configs.default,
  );
};

/**
 * Execute a function with circuit breaker protection
 * @param {string} service - Service name
 * @param {Function} fn - Async function
 * @returns {Promise<any>}
 */
exports.withCircuitBreaker = async (service, fn) => {
  const breaker = exports.getBreaker(service);
  return breaker.execute(fn);
};

/**
 * Get pool stats
 */
exports.getPoolStats = () => pool.stats();

/**
 * Reset all breakers
 */
exports.resetAll = () => pool.resetAll();

// ==========================================
// EXPORTS
// ==========================================

exports.CircuitBreaker = CircuitBreaker;
exports.CircuitBreakerPool = CircuitBreakerPool;
exports.STATES = STATES;

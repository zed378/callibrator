/**
 * Tests for health.service.js (A-06 / A-15).
 *
 * These assert BEHAVIOUR an operator depends on:
 *   - a dependency that is switched off by configuration reports
 *     "not configured", never "healthy";
 *   - Redis down makes the deployment NOT ready (it used to answer 200);
 *   - an optional dependency that is down does NOT make it not ready;
 *   - a probe that hangs fails on a deadline instead of hanging the request.
 */

// ================================================================
// MOCKS
// ================================================================

jest.mock("../../config", () => ({
  db: { authenticate: jest.fn() },
}));

jest.mock("../../services/redis.service", () => ({
  getRedisConnection: jest.fn(),
}));

jest.mock("amqplib", () => ({
  connect: jest.fn(),
}));

jest.mock("../../services/iot.service", () => ({
  connected: false,
}));

jest.mock("../../services/clamAv.service", () => ({
  isConfigured: jest.fn(() => false),
}));

const amqplib = require("amqplib");
const { db } = require("../../config");
const { getRedisConnection } = require("../../services/redis.service");
const iotService = require("../../services/iot.service");
const clamAv = require("../../services/clamAv.service");
const healthService = require("../../services/health.service");

const ENV_KEYS = [
  "HEALTH_PROBE_TIMEOUT_MS",
  "HEALTH_CACHE_TTL_MS",
  "RABBITMQ_URL",
  "RABBITMQ_HOST",
  "RABBITMQ_PORT",
  "MQTT_HOST",
  "MQTT_PORT",
];

const originalEnv = {};

/** Everything up: used as the baseline so a single failure is unambiguous. */
const allDependenciesUp = () => {
  db.authenticate.mockResolvedValue(undefined);
  getRedisConnection.mockReturnValue({
    ping: jest.fn().mockResolvedValue("PONG"),
  });
  amqplib.connect.mockResolvedValue({
    close: jest.fn().mockResolvedValue(undefined),
  });
};

const dependency = (report, name) =>
  report.dependencies.find((entry) => entry.name === name);

beforeAll(() => {
  ENV_KEYS.forEach((key) => {
    originalEnv[key] = process.env[key];
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  ENV_KEYS.forEach((key) => delete process.env[key]);
  iotService.connected = false;
  clamAv.isConfigured.mockReturnValue(false);
  healthService.resetCache();
  allDependenciesUp();
});

afterAll(() => {
  ENV_KEYS.forEach((key) => {
    if (originalEnv[key] === undefined) {
      delete process.env[key];
      return;
    }
    process.env[key] = originalEnv[key];
  });
});

// ================================================================
// POSTGRES
// ================================================================

describe("health.service — PostgreSQL probe", () => {
  it("reports postgres healthy when authenticate resolves", async () => {
    const result = await healthService.checkDatabase();

    expect(db.authenticate).toHaveBeenCalledTimes(1);
    expect(result.name).toBe("postgres");
    expect(result.required).toBe(true);
    expect(result.status).toBe(healthService.STATUS.HEALTHY);
    expect(typeof result.latencyMs).toBe("number");
  });

  it("reports postgres unhealthy with the driver message when authenticate rejects", async () => {
    db.authenticate.mockRejectedValue(new Error("ECONNREFUSED 5432"));

    const result = await healthService.checkDatabase();

    expect(result.status).toBe(healthService.STATUS.UNHEALTHY);
    expect(result.error).toBe("ECONNREFUSED 5432");
  });

  it("fails a hanging probe on the deadline instead of hanging the request", async () => {
    process.env.HEALTH_PROBE_TIMEOUT_MS = "15";
    db.authenticate.mockImplementation(() => new Promise(() => {}));

    const result = await healthService.checkDatabase();

    expect(result.status).toBe(healthService.STATUS.UNHEALTHY);
    expect(result.error).toBe("PostgreSQL probe timed out after 15ms");
  });
});

// ================================================================
// REDIS
// ================================================================

describe("health.service — Redis probe", () => {
  it("reports redis healthy on a PONG reply", async () => {
    const result = await healthService.checkRedis();

    expect(result.name).toBe("redis");
    expect(result.required).toBe(true);
    expect(result.status).toBe(healthService.STATUS.HEALTHY);
  });

  it("reports redis unhealthy when PING answers something other than PONG", async () => {
    getRedisConnection.mockReturnValue({
      ping: jest.fn().mockResolvedValue("LOADING"),
    });

    const result = await healthService.checkRedis();

    expect(result.status).toBe(healthService.STATUS.UNHEALTHY);
    expect(result.error).toBe("unexpected PING reply: LOADING");
  });

  it("reports redis unhealthy when PING throws", async () => {
    getRedisConnection.mockReturnValue({
      ping: jest.fn().mockRejectedValue(new Error("Connection is closed.")),
    });

    const result = await healthService.checkRedis();

    expect(result.status).toBe(healthService.STATUS.UNHEALTHY);
    expect(result.error).toBe("Connection is closed.");
  });
});

// ================================================================
// RABBITMQ
// ================================================================

describe("health.service — RabbitMQ probe", () => {
  it("reports rabbitmq healthy and closes the connection it opened", async () => {
    const close = jest.fn().mockResolvedValue(undefined);
    amqplib.connect.mockResolvedValue({ close });

    const result = await healthService.checkRabbitMq();

    expect(result.name).toBe("rabbitmq");
    expect(result.status).toBe(healthService.STATUS.HEALTHY);
    // A probe that leaked a connection per hit would exhaust the broker.
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("stays healthy when the probe connected but hanging up failed", async () => {
    amqplib.connect.mockResolvedValue({
      close: jest.fn().mockRejectedValue(new Error("connection already closed")),
    });

    const result = await healthService.checkRabbitMq();

    expect(result.status).toBe(healthService.STATUS.HEALTHY);
  });

  it("reports rabbitmq unhealthy when the broker refuses the connection", async () => {
    amqplib.connect.mockRejectedValue(new Error("ECONNREFUSED 5672"));

    const result = await healthService.checkRabbitMq();

    expect(result.status).toBe(healthService.STATUS.UNHEALTHY);
    expect(result.error).toBe("ECONNREFUSED 5672");
  });

  it("uses RABBITMQ_URL when it is set", async () => {
    process.env.RABBITMQ_URL = "amqp://user:pass@broker:5673";

    await healthService.checkRabbitMq();

    expect(amqplib.connect).toHaveBeenCalledWith("amqp://user:pass@broker:5673");
  });

  it("builds the URL from RABBITMQ_HOST and RABBITMQ_PORT when there is no URL", async () => {
    process.env.RABBITMQ_HOST = "rabbit";
    process.env.RABBITMQ_PORT = "5680";

    await healthService.checkRabbitMq();

    expect(amqplib.connect).toHaveBeenCalledWith("amqp://rabbit:5680");
  });

  it("falls back to localhost:5672 when nothing is configured", async () => {
    await healthService.checkRabbitMq();

    expect(amqplib.connect).toHaveBeenCalledWith("amqp://localhost:5672");
  });
});

// ================================================================
// MQTT — OPTIONAL
// ================================================================

describe("health.service — MQTT probe", () => {
  it("reports 'not configured' when MQTT_HOST is missing", () => {
    process.env.MQTT_PORT = "1883";

    const result = healthService.checkMqtt();

    expect(result.status).toBe(healthService.STATUS.NOT_CONFIGURED);
    expect(result.status).not.toBe(healthService.STATUS.HEALTHY);
    expect(result.required).toBe(false);
  });

  it("reports 'not configured' when MQTT_PORT is missing", () => {
    process.env.MQTT_HOST = "broker.local";

    const result = healthService.checkMqtt();

    expect(result.status).toBe(healthService.STATUS.NOT_CONFIGURED);
  });

  it("reports mqtt unhealthy when configured but the client is not connected", () => {
    process.env.MQTT_HOST = "broker.local";
    process.env.MQTT_PORT = "1883";
    iotService.connected = false;

    const result = healthService.checkMqtt();

    expect(result.status).toBe(healthService.STATUS.UNHEALTHY);
    expect(result.error).toMatch(/not connected/);
  });

  it("reports mqtt healthy when configured and connected", () => {
    process.env.MQTT_HOST = "broker.local";
    process.env.MQTT_PORT = "1883";
    iotService.connected = true;

    expect(healthService.checkMqtt().status).toBe(
      healthService.STATUS.HEALTHY,
    );
  });
});

// ================================================================
// CLAMAV — OPTIONAL
// ================================================================

describe("health.service — ClamAV probe", () => {
  it("reports 'not configured' when ClamAV is disabled", () => {
    clamAv.isConfigured.mockReturnValue(false);

    const result = healthService.checkClamAv();

    expect(result.status).toBe(healthService.STATUS.NOT_CONFIGURED);
    expect(result.status).not.toBe(healthService.STATUS.HEALTHY);
  });

  it("reports 'unknown' — never healthy — when enabled, because nothing probes it", () => {
    clamAv.isConfigured.mockReturnValue(true);

    const result = healthService.checkClamAv();

    expect(result.status).toBe(healthService.STATUS.UNKNOWN);
    expect(result.status).not.toBe(healthService.STATUS.HEALTHY);
  });
});

// ================================================================
// AGGREGATE
// ================================================================

describe("health.service — aggregate readiness", () => {
  it("is healthy with every required dependency up, and lists them all", async () => {
    const result = await healthService.getReadiness();

    expect(result.status).toBe(healthService.STATUS.HEALTHY);
    expect(result.dependencies.map((entry) => entry.name)).toEqual([
      "postgres",
      "redis",
      "rabbitmq",
      "mqtt",
      "clamav",
    ]);
    expect(typeof result.checkedAt).toBe("string");
  });

  it("is NOT ready when Redis is down — the defect A-15 describes", async () => {
    getRedisConnection.mockReturnValue({
      ping: jest.fn().mockRejectedValue(new Error("Connection is closed.")),
    });

    const result = await healthService.getReadiness();

    expect(result.status).toBe(healthService.STATUS.UNHEALTHY);
    expect(dependency(result, "redis").status).toBe(
      healthService.STATUS.UNHEALTHY,
    );
    expect(dependency(result, "postgres").status).toBe(
      healthService.STATUS.HEALTHY,
    );
    expect(await healthService.isReady({ fresh: true })).toBe(false);
  });

  it("is NOT ready when RabbitMQ is down", async () => {
    amqplib.connect.mockRejectedValue(new Error("ECONNREFUSED 5672"));

    const result = await healthService.getReadiness();

    expect(result.status).toBe(healthService.STATUS.UNHEALTHY);
  });

  it("is NOT ready when PostgreSQL is down", async () => {
    db.authenticate.mockRejectedValue(new Error("ECONNREFUSED 5432"));

    expect(await healthService.isReady()).toBe(false);
  });

  it("stays ready when only an OPTIONAL dependency is down", async () => {
    process.env.MQTT_HOST = "broker.local";
    process.env.MQTT_PORT = "1883";
    iotService.connected = false;

    const result = await healthService.getReadiness();

    expect(dependency(result, "mqtt").status).toBe(
      healthService.STATUS.UNHEALTHY,
    );
    expect(result.status).toBe(healthService.STATUS.HEALTHY);
    expect(await healthService.isReady({ fresh: true })).toBe(true);
  });

  it("serves a cached aggregate so a load balancer does not re-probe every hit", async () => {
    await healthService.getReadiness();
    await healthService.getReadiness();
    await healthService.isReady();

    expect(db.authenticate).toHaveBeenCalledTimes(1);
    expect(amqplib.connect).toHaveBeenCalledTimes(1);
  });

  it("re-probes when the caller asks for a fresh report", async () => {
    await healthService.getReadiness();
    await healthService.getReadiness({ fresh: true });

    expect(db.authenticate).toHaveBeenCalledTimes(2);
  });

  it("re-probes once the cache TTL has expired", async () => {
    process.env.HEALTH_CACHE_TTL_MS = "1";

    await healthService.getReadiness();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await healthService.getReadiness();

    expect(db.authenticate).toHaveBeenCalledTimes(2);
  });

  it("re-probes after resetCache()", async () => {
    await healthService.getReadiness();
    healthService.resetCache();
    await healthService.getReadiness();

    expect(db.authenticate).toHaveBeenCalledTimes(2);
  });
});

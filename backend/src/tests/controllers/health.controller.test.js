/**
 * Tests for health.controller.js (A-06 / A-15).
 *
 * The disclosure assertions are written against the RESPONSE BODY, not against
 * the implementation: whatever the handler is built from, a public probe must
 * not publish the Node version, the pid, memory figures, uptime, a hostname or
 * the dependency breakdown.
 */

jest.mock("../../services/health.service", () => ({
  STATUS: {
    HEALTHY: "healthy",
    UNHEALTHY: "unhealthy",
    NOT_CONFIGURED: "not configured",
    UNKNOWN: "unknown",
  },
  isReady: jest.fn(),
  getReadiness: jest.fn(),
}));

const healthService = require("../../services/health.service");
const healthController = require("../../controllers/health.controller");

const DISCLOSURE_KEYS = [
  "node",
  "nodeVersion",
  "version",
  "pid",
  "memory",
  "memoryUsage",
  "uptime",
  "hostname",
  "host",
  "dependencies",
  "database",
];

const HEALTHY_REPORT = {
  status: "healthy",
  checkedAt: "2026-09-23T00:00:00.000Z",
  dependencies: [
    { name: "postgres", required: true, status: "healthy" },
    { name: "redis", required: true, status: "healthy" },
    { name: "rabbitmq", required: true, status: "healthy" },
    { name: "mqtt", required: false, status: "not configured" },
    { name: "clamav", required: false, status: "not configured" },
  ],
};

let req;
let res;

beforeEach(() => {
  jest.clearAllMocks();
  req = {};
  res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  };
});

describe("health.controller — GET /live", () => {
  it("answers 200 OK without consulting any dependency", () => {
    healthController.liveness(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith("OK");
    expect(healthService.isReady).not.toHaveBeenCalled();
    expect(healthService.getReadiness).not.toHaveBeenCalled();
  });
});

describe("health.controller — GET /health (public)", () => {
  it("answers 200 with a verdict and nothing else when ready", async () => {
    healthService.isReady.mockResolvedValue(true);

    await healthController.health(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ status: "ok" });
  });

  it("publishes no runtime or dependency detail — A-06", async () => {
    healthService.isReady.mockResolvedValue(true);

    await healthController.health(req, res);

    const body = res.json.mock.calls[0][0];
    expect(Object.keys(body)).toEqual(["status"]);
    DISCLOSURE_KEYS.forEach((key) => {
      expect(body).not.toHaveProperty(key);
    });
    expect(JSON.stringify(body)).not.toContain(process.version);
    expect(JSON.stringify(body)).not.toContain(String(process.pid));
  });

  it("answers 503 when a required dependency is down, still with no detail", async () => {
    healthService.isReady.mockResolvedValue(false);

    await healthController.health(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ status: "unavailable" });
  });
});

describe("health.controller — GET /ready (public)", () => {
  it("answers 200 READY when every required dependency is healthy", async () => {
    healthService.isReady.mockResolvedValue(true);

    await healthController.readiness(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith("READY");
  });

  it("answers 503 NOT READY when one is not", async () => {
    healthService.isReady.mockResolvedValue(false);

    await healthController.readiness(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.send).toHaveBeenCalledWith("NOT READY");
  });
});

describe("health.controller — GET /api/v1/health (gated detail)", () => {
  it("answers 200 with the per-dependency breakdown in data", async () => {
    healthService.getReadiness.mockResolvedValue(HEALTHY_REPORT);

    await healthController.readinessDetail(req, res);

    expect(healthService.getReadiness).toHaveBeenCalledWith({ fresh: true });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      status: 200,
      message: "All required dependencies are healthy",
      data: HEALTHY_REPORT,
    });
  });

  it("answers 503 and KEEPS the breakdown when a required dependency is down", async () => {
    const degraded = {
      ...HEALTHY_REPORT,
      status: "unhealthy",
      dependencies: [
        { name: "postgres", required: true, status: "healthy" },
        {
          name: "redis",
          required: true,
          status: "unhealthy",
          error: "Connection is closed.",
        },
      ],
    };
    healthService.getReadiness.mockResolvedValue(degraded);

    await healthController.readinessDetail(req, res);

    expect(res.status).toHaveBeenCalledWith(503);

    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(body.status).toBe(503);
    expect(body.message).toMatch(/unhealthy/);
    // response.util#error would have nulled this — the breakdown is the point.
    expect(body.data.dependencies[1]).toMatchObject({
      name: "redis",
      status: "unhealthy",
    });
  });
});

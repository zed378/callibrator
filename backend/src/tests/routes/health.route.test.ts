/**
 * Tests for routes/internal/health.route.ts (A-06 / A-15).
 *
 * Driven over real HTTP against a real Express app rather than by inspecting
 * the router stack: what matters is what an anonymous caller can actually read
 * from the public paths, and that the per-dependency breakdown is unreachable
 * without a super-admin session.
 */
import http from "http";
import express from "express";
import type * as AuthMiddleware from "../../middlewares/auth.middleware";
import type * as HealthRoute from "../../routes/internal/health.route";

interface HealthServiceDouble {
    isReady: jest.Mock;
    getReadiness: jest.Mock;
}

jest.mock("../../middlewares/auth.middleware", () => ({
  auth: jest.fn(),
  denyApiKey: jest.fn(),
  superAdminOnly: jest.fn(),
}));

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

/* eslint-disable @typescript-eslint/no-require-imports -- loaded after the mocks above, as every memoryDb test */
const { auth, denyApiKey, superAdminOnly } = require("../../middlewares/auth.middleware") as typeof AuthMiddleware;
const healthService = require("../../services/health.service") as HealthServiceDouble;
const { publicHealthRoutes, internalHealthRoutes } = require("../../routes/internal/health.route") as typeof HealthRoute;
/* eslint-enable @typescript-eslint/no-require-imports */

const REPORT = {
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

let server: http.Server;
let baseUrl: string;

const pass = (_req: unknown, _res: unknown, next: () => void): void => {
  next();
};

const get = async (path: string): Promise<{ status: number; text: string }> => {
  const response = await fetch(`${baseUrl}${path}`);
  const text = await response.text();
  return { status: response.status, text };
};

beforeAll(() => {
  const app = express();
  app.use(publicHealthRoutes);
  app.use("/api/v1/health", internalHealthRoutes);

  server = http.createServer(app);
  return new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  }).then(() => {
    const address = server.address();
    const port = typeof address === "object" && address !== null ? String(address.port) : "0";
    baseUrl = `http://127.0.0.1:${port}`;
  });
});

afterAll(() => {
  return new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  (auth as jest.Mock).mockImplementation(pass);
  (denyApiKey as jest.Mock).mockImplementation(pass);
  (superAdminOnly as jest.Mock).mockImplementation(pass);
  (healthService.isReady).mockResolvedValue(true);
  (healthService.getReadiness).mockResolvedValue(REPORT);
});

describe("public health routes", () => {
  it("GET /live is 200 OK and never touches a dependency", async () => {
    const response = await get("/live");

    expect(response.status).toBe(200);
    expect(response.text).toBe("OK");
    expect(healthService.isReady).not.toHaveBeenCalled();
  });

  it("GET /health needs no authentication and leaks no runtime detail", async () => {
    const response = await get("/health");

    expect(auth).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(JSON.parse(response.text)).toEqual({ status: "ok" });
    expect(response.text).not.toContain(process.version);
    expect(response.text).not.toContain(String(process.pid));
    expect(response.text.toLowerCase()).not.toContain("memory");
    expect(response.text.toLowerCase()).not.toContain("redis");
  });

  it("GET /health is 503 when a required dependency is down", async () => {
    (healthService.isReady).mockResolvedValue(false);

    const response = await get("/health");

    expect(response.status).toBe(503);
    expect(JSON.parse(response.text)).toEqual({ status: "unavailable" });
  });

  it("GET /ready is 200 READY / 503 NOT READY", async () => {
    expect(await get("/ready")).toEqual({ status: 200, text: "READY" });

    (healthService.isReady).mockResolvedValue(false);
    expect(await get("/ready")).toEqual({ status: 503, text: "NOT READY" });
  });
});

describe("gated readiness detail", () => {
  it("GET /api/v1/health returns the breakdown to a super admin", async () => {
    const response = await get("/api/v1/health");

    expect(auth).toHaveBeenCalled();
    expect(denyApiKey).toHaveBeenCalled();
    expect(superAdminOnly).toHaveBeenCalled();

    const body = JSON.parse(response.text) as { data: { dependencies: unknown[] } };
    expect(response.status).toBe(200);
    expect(body.data.dependencies).toHaveLength(5);
  });

  it("is refused for an unauthenticated caller — the breakdown never runs", async () => {
    (auth as jest.Mock).mockImplementation((_req: unknown, res: { status: (c: number) => { json: (b: unknown) => void } }) => { res.status(401).json({ message: "Unauthorized" }); },
    );

    const response = await get("/api/v1/health");

    expect(response.status).toBe(401);
    expect(superAdminOnly).not.toHaveBeenCalled();
    expect(healthService.getReadiness).not.toHaveBeenCalled();
  });

  it("is refused for an API key", async () => {
    (denyApiKey as jest.Mock).mockImplementation((_req: unknown, res: { status: (c: number) => { json: (b: unknown) => void } }) => { res.status(403).json({ message: "API keys cannot access this endpoint" }); },
    );

    const response = await get("/api/v1/health");

    expect(response.status).toBe(403);
    expect(superAdminOnly).not.toHaveBeenCalled();
    expect(healthService.getReadiness).not.toHaveBeenCalled();
  });

  it("is refused for an authenticated non-super-admin", async () => {
    (superAdminOnly as jest.Mock).mockImplementation((_req: unknown, res: { status: (c: number) => { json: (b: unknown) => void } }) => { res.status(403).json({ message: "Super admin access required" }); },
    );

    const response = await get("/api/v1/health");

    expect(response.status).toBe(403);
    expect(healthService.getReadiness).not.toHaveBeenCalled();
  });
});

/* eslint-disable no-restricted-properties -- the monitor reads JOB_STATUS_DIR and the metrics route reads METRICS_TOKEN per call; the test switches them */
/**
 * P7-02 — GET /api/v1/health/jobs (super admin) and /api/v1/health/metrics
 * (METRICS_TOKEN), over real HTTP against the real router and controller.
 * The job monitor is real too; its state is produced by real runMonitored
 * calls writing to a temporary status directory.
 */
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import express from "express";
import type * as AuthMiddleware from "../../middlewares/auth.middleware";
import type JobMonitorService from "../../services/jobMonitor.service";
import type * as HealthRoute from "../../routes/internal/health.route";

jest.mock("../../middlewares/auth.middleware", () => ({
  auth: jest.fn(),
  denyApiKey: jest.fn(),
  superAdminOnly: jest.fn(),
}));
jest.mock("../../services/health.service", () => ({ STATUS: {}, isReady: jest.fn(), getReadiness: jest.fn() }));
jest.mock("../../services/alert.service", () => ({
  SEVERITY: { CRITICAL: "critical", WARNING: "warning", RESOLVED: "resolved" },
  raiseAlert: jest.fn(() => Promise.resolve({})),
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

/* eslint-disable @typescript-eslint/no-require-imports -- loaded after the mocks above, as every memoryDb test */
const { auth, denyApiKey, superAdminOnly } = require("../../middlewares/auth.middleware") as typeof AuthMiddleware;
const monitor = require("../../services/jobMonitor.service") as typeof JobMonitorService;
const { internalHealthRoutes } = require("../../routes/internal/health.route") as typeof HealthRoute;
/* eslint-enable @typescript-eslint/no-require-imports */

const TOKEN = "t".repeat(40);
let server: http.Server;
let baseUrl: string;

const get = async (
  p: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; type: string | null; text: string }> => {
  const response = await fetch(`${baseUrl}${p}`, { headers });
  return { status: response.status, type: response.headers.get("content-type"), text: await response.text() };
};

beforeAll(() => {
  process.env["JOB_STATUS_DIR"] = fs.mkdtempSync(path.join(os.tmpdir(), "p702-route-"));
  const app = express();
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
  delete process.env["JOB_STATUS_DIR"];
  delete process.env["METRICS_TOKEN"];
  monitor.reset();
  return new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

beforeEach(() => {
  monitor.reset();
  const pass = (_req: unknown, _res: unknown, next: () => void): void => {
    next();
  };
  (auth as jest.Mock).mockImplementation(pass);
  (denyApiKey as jest.Mock).mockImplementation(pass);
  (superAdminOnly as jest.Mock).mockImplementation(pass);
});

describe("GET /api/v1/health/jobs", () => {
  it("is behind auth + denyApiKey + superAdminOnly", async () => {
    (superAdminOnly as jest.Mock).mockImplementation(
      (_req: unknown, res: { status: (code: number) => { json: (body: unknown) => unknown } }) =>
        res.status(403).json({ message: "Forbidden" }),
    );
    const response = await get("/api/v1/health/jobs");
    expect(response.status).toBe(403);
    expect(auth).toHaveBeenCalled();
    expect(denyApiKey).toHaveBeenCalled();
  });

  it("200 with every job's state in the envelope when nothing is failing", async () => {
    await monitor.runMonitored("webhook-dispatch", () => Promise.resolve({}));
    const response = await get("/api/v1/health/jobs");
    const body = JSON.parse(response.text) as { success: boolean; status: number; message: string; data: unknown };

    expect(response.status).toBe(200);
    expect(body).toEqual(
      expect.objectContaining({ success: true, status: 200, message: "No scheduled job is failing or overdue" }),
    );
    expect(body.data).toEqual([expect.objectContaining({ job: "webhook-dispatch", lastOutcome: "success" })]);
  });

  it("503 naming the failing and overdue jobs", async () => {
    await monitor.runMonitored(
      "retention-sweep",
      () => {
        throw new Error("x");
      },
      { singleton: false },
    );
    monitor.registerJob("calibration-scan", { getNextRun: () => new Date(Date.now() - 5 * 3600 * 1000) }, "0 1 * * *");
    await monitor.checkOverdue();

    const response = await get("/api/v1/health/jobs");
    const body = JSON.parse(response.text) as { success: boolean; message: string };
    expect(response.status).toBe(503);
    expect(body.success).toBe(false);
    expect(body.message).toBe("Failing or overdue: calibration-scan, retention-sweep");
  });
});

describe("GET /api/v1/health/metrics", () => {
  it("does not exist (404) until METRICS_TOKEN is set, and needs no user session", async () => {
    delete process.env["METRICS_TOKEN"];
    expect((await get("/api/v1/health/metrics")).status).toBe(404);
    expect(auth).not.toHaveBeenCalled();
  });

  it("401 without the token; Prometheus text with it", async () => {
    process.env["METRICS_TOKEN"] = TOKEN;
    await monitor.runMonitored("webhook-dispatch", () => Promise.resolve({}));

    expect((await get("/api/v1/health/metrics")).status).toBe(401);
    const response = await get("/api/v1/health/metrics", { authorization: `Bearer ${TOKEN}` });
    expect(response.status).toBe(200);
    expect(response.type).toMatch(/^text\/plain;.*version=0\.0\.4/);
    expect(response.text).toContain('callibrator_job_last_run_failed{job="webhook-dispatch"} 0');
  });
});

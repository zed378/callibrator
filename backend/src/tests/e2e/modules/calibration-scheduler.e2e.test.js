/**
 * E2E Tests: Calibration Scheduler module (LIVE HTTP)
 *
 * Mount: /api/v1/calibration-scheduler  (see index.js)
 * Endpoints:
 *   GET  /calibration-scheduler/due  — read-only preview of due devices
 *   POST /calibration-scheduler/run  — idempotent scan creating work orders
 *
 * Both are gated by dynamicAccess("Maintenance", ...). Data lands directly in
 * `data` (no pagination meta on these preview/action endpoints).
 */
const { httpGet, httpPost, authHeader, extractToken } = require("../setup");

describe("E2E Calibration Scheduler (HTTP)", () => {
  let token;

  async function login() {
    const { body } = await httpPost("/auth/login", {
      user: "sys@mail.com",
      password: "123123",
    });
    return extractToken(body);
  }

  beforeAll(async () => {
    token = await login();
    expect(token).toBeTruthy();
  });

  test("GET /calibration-scheduler/due — 200 returns due list", async () => {
    const { status, body } = await httpGet(
      "/calibration-scheduler/due?leadDays=30",
      authHeader(token),
    );
    expect(status).toBe(200);
    expect(body).toHaveProperty("data");
  });

  test("GET /calibration-scheduler/due — 401 without auth", async () => {
    const { status } = await httpGet("/calibration-scheduler/due");
    expect(status).toBe(401);
  });

  test("POST /calibration-scheduler/run — 200 scan completes", async () => {
    const { status, body } = await httpPost(
      "/calibration-scheduler/run",
      { leadDays: 30 },
      authHeader(token),
    );
    expect(status).toBe(200);
    expect(body).toHaveProperty("data");
  });

  test("POST /calibration-scheduler/run — 401 without auth", async () => {
    const { status } = await httpPost("/calibration-scheduler/run", {
      leadDays: 30,
    });
    expect(status).toBe(401);
  });
});

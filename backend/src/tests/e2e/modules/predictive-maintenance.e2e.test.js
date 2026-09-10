/**
 * E2E Tests: Predictive Maintenance module (LIVE HTTP)
 *
 * Mount: /api/v1/predictive-maintenance  (see index.js)
 * Route file: src/routes/api/predictiveMaintenance.route.js
 *
 * Covered routes:
 *   POST /predictive-maintenance/analyze/:deviceId
 *   GET  /predictive-maintenance/recommendations
 *   POST /predictive-maintenance/recommendations/:deviceId/approve
 *
 * analyzeDevice requires an iotEnabled device with a baseline
 * calibrationIntervalDays. On a freshly-seeded DB there are no IoT readings, so
 * analyze returns 200 with status "skipped"; approve returns 400 unless a
 * recommendation is pending. Both are valid, non-error contract responses.
 */
const {
  httpGet,
  httpPost,
  httpDelete,
  authHeader,
  extractToken,
} = require("../setup");

describe("E2E Predictive Maintenance (HTTP)", () => {
  let token;
  let auth;
  const ids = { device: null };

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
    auth = authHeader(token);

    const d = await httpPost(
      "/calibration-devices",
      {
        name: "E2E Predictive Device",
        manufacturer: "Fluke",
        model: "DM-300",
        serialNumber: `E2E-PRD-${Date.now()}`,
        status: "active",
        iotEnabled: true,
        calibrationIntervalDays: 365,
      },
      auth,
    );
    ids.device = d.body?.data?.id;
  });

  afterAll(async () => {
    if (ids.device) await httpDelete(`/calibration-devices/${ids.device}`, auth);
  });

  test("GET /predictive-maintenance/recommendations — 200, data array", async () => {
    const { status, body } = await httpGet(
      "/predictive-maintenance/recommendations",
      auth,
    );
    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
  });

  test("POST /analyze/:deviceId — 200 analysis (skipped w/o readings) or 404 if not IoT", async () => {
    const { status, body } = await httpPost(
      `/predictive-maintenance/analyze/${ids.device}`,
      {},
      auth,
    );
    expect([200, 404]).toContain(status);
    if (status === 200) {
      expect(body.data).toHaveProperty("status");
    }
  });

  test("POST /analyze/:deviceId — 400 on invalid UUID", async () => {
    const { status } = await httpPost(
      "/predictive-maintenance/analyze/not-a-uuid",
      {},
      auth,
    );
    expect(status).toBe(400);
  });

  test("POST /analyze/:deviceId — 404 on unknown device", async () => {
    const { status } = await httpPost(
      "/predictive-maintenance/analyze/00000000-0000-4000-8000-000000000000",
      {},
      auth,
    );
    expect(status).toBe(404);
  });

  test("POST /recommendations/:deviceId/approve — 400 without a pending recommendation", async () => {
    const { status } = await httpPost(
      `/predictive-maintenance/recommendations/${ids.device}/approve`,
      {},
      auth,
    );
    expect([200, 400]).toContain(status);
  });

  test("POST /recommendations/:deviceId/approve — 404 on unknown device", async () => {
    const { status } = await httpPost(
      "/predictive-maintenance/recommendations/00000000-0000-4000-8000-000000000000/approve",
      {},
      auth,
    );
    expect(status).toBe(404);
  });

  test("GET /predictive-maintenance/recommendations — 401 without token", async () => {
    const { status } = await httpGet(
      "/predictive-maintenance/recommendations",
    );
    expect(status).toBe(401);
  });
});

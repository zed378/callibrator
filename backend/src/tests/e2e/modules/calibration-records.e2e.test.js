/**
 * E2E Tests: Calibration Records module (LIVE HTTP)
 *
 * Mount: /api/v1/calibration-records  (see index.js)
 * A record requires a deviceId FK, so a parent calibration-device is created
 * in beforeAll and torn down in afterAll.
 */
const {
  httpGet,
  httpPost,
  httpPut,
  httpDelete,
  authHeader,
  extractToken,
} = require("../setup");

describe("E2E Calibration Records (HTTP)", () => {
  let token;
  let deviceId;
  let recordId;

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
    const { body } = await httpPost(
      "/calibration-devices",
      { name: "E2E Record Device", serialNumber: `E2E-REC-${Date.now()}` },
      authHeader(token),
    );
    deviceId = body.data.id;
  });

  afterAll(async () => {
    if (recordId) {
      await httpDelete(`/calibration-records/${recordId}`, authHeader(token));
    }
    if (deviceId) {
      await httpDelete(`/calibration-devices/${deviceId}`, authHeader(token));
    }
  });

  test("GET /calibration-records — 200, data array, meta top-level", async () => {
    const { status, body } = await httpGet(
      "/calibration-records",
      authHeader(token),
    );
    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toBeDefined();
  });

  test("POST /calibration-records — 201 creates record", async () => {
    const { status, body } = await httpPost(
      "/calibration-records",
      {
        deviceId,
        calibrationDate: "2026-06-15",
        dueDate: "2026-12-15",
        isCompliant: true,
        notes: "e2e",
      },
      authHeader(token),
    );
    expect(status).toBe(201);
    expect(body.data).toHaveProperty("id");
    recordId = body.data.id;
  });

  test("GET /calibration-records/:id — 200 returns the record", async () => {
    const { status, body } = await httpGet(
      `/calibration-records/${recordId}`,
      authHeader(token),
    );
    expect(status).toBe(200);
    expect(body.data.id).toBe(recordId);
  });

  test("PUT /calibration-records/:id — 200 updates notes", async () => {
    const { status } = await httpPut(
      `/calibration-records/${recordId}`,
      { notes: "e2e updated" },
      authHeader(token),
    );
    expect(status).toBe(200);
  });

  test("POST /calibration-records — 400 when deviceId missing", async () => {
    const { status } = await httpPost(
      "/calibration-records",
      { notes: "no device" },
      authHeader(token),
    );
    expect(status).toBe(400);
  });

  test("DELETE /calibration-records/:id — 200 removes the record", async () => {
    const { status } = await httpDelete(
      `/calibration-records/${recordId}`,
      authHeader(token),
    );
    expect(status).toBe(200);
    recordId = null;
  });
});

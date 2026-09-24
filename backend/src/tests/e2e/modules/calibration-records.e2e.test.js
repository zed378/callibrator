/**
 * E2E Tests: Calibration Records module (LIVE HTTP)
 *
 * Mount: /api/v1/calibration-records  (see index.js)
 * A record requires a deviceId FK, so a parent calibration-device is created
 * in beforeAll and torn down in afterAll.
 *
 * P6-03: a calibration record is append-only. There is no PUT and no DELETE;
 * a correction is a new superseding record and a void is final. Records this
 * suite writes are VOIDED in afterAll — they cannot be deleted (the database
 * refuses it for every role).
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
      await httpPost(`/calibration-records/${recordId}/void`, { reason: "e2e teardown" }, authHeader(token));
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

  test("PUT /calibration-records/:id — 404: the route no longer exists (P6-03)", async () => {
    const { status } = await httpPut(
      `/calibration-records/${recordId}`,
      { notes: "e2e updated" },
      authHeader(token),
    );
    expect(status).toBe(404);
  });

  test("POST /calibration-records/:id/corrections — 400 without a reason", async () => {
    const { status } = await httpPost(
      `/calibration-records/${recordId}/corrections`,
      { notes: "e2e corrected", reason: "   " },
      authHeader(token),
    );
    expect(status).toBe(400);
  });

  test("POST /calibration-records/:id/corrections — 201, a NEW record supersedes the original", async () => {
    const { status, body } = await httpPost(
      `/calibration-records/${recordId}/corrections`,
      { notes: "e2e corrected", reason: "e2e: the first reading was misrecorded" },
      authHeader(token),
    );
    expect(status).toBe(201);
    expect(body.data.id).not.toBe(recordId);
    expect(body.data.supersedesId).toBe(recordId);
    const original = await httpGet(`/calibration-records/${recordId}`, authHeader(token));
    expect(original.body.data.supersededById).toBe(body.data.id);
    expect(original.body.data.notes).toBe("e2e"); // the original is unchanged
    const again = await httpPost(
      `/calibration-records/${recordId}/corrections`,
      { notes: "twice", reason: "e2e: correcting the original twice" },
      authHeader(token),
    );
    expect(again.status).toBe(409);
    recordId = body.data.id; // the record in force
  });
  test("POST /calibration-records — 400 when deviceId missing", async () => {
    const { status } = await httpPost(
      "/calibration-records",
      { notes: "no device" },
      authHeader(token),
    );
    expect(status).toBe(400);
  });

  test("DELETE /calibration-records/:id — 404: the route no longer exists (P6-03)", async () => {
    const { status } = await httpDelete(
      `/calibration-records/${recordId}`,
      authHeader(token),
    );
    expect(status).toBe(404);
  });

  test("POST /calibration-records/:id/void — 200 with a reason, then 409: a void is final", async () => {
    const { status } = await httpPost(
      `/calibration-records/${recordId}/void`,
      { reason: "e2e: entered against the wrong device" },
      authHeader(token),
    );
    expect(status).toBe(200);
    const again = await httpPost(
      `/calibration-records/${recordId}/void`,
      { reason: "e2e: twice" },
      authHeader(token),
    );
    expect(again.status).toBe(409);
    recordId = null;
  });
});

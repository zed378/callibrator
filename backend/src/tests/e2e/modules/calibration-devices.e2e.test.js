/**
 * E2E Tests: Calibration Devices module (LIVE HTTP)
 *
 * Mount: /api/v1/calibration-devices  (see index.js)
 * Verifies full CRUD against the running server, reusing a single login token.
 *
 * Envelope: { success, status, message, data } — list endpoints put rows in
 * `data` (array) and pagination `meta` as a TOP-LEVEL sibling (not data.meta).
 */
const {
  httpGet,
  httpPost,
  httpPut,
  httpDelete,
  authHeader,
  extractToken,
} = require("../setup");

describe("E2E Calibration Devices (HTTP)", () => {
  let token;
  let createdId;

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

  afterAll(async () => {
    if (createdId) {
      await httpDelete(`/calibration-devices/${createdId}`, authHeader(token));
    }
  });

  test("GET /calibration-devices — 200, data array, meta top-level", async () => {
    const { status, body } = await httpGet(
      "/calibration-devices",
      authHeader(token),
    );
    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toBeDefined();
  });

  test("POST /calibration-devices — 201 creates device", async () => {
    const { status, body } = await httpPost(
      "/calibration-devices",
      {
        name: "E2E Multimeter",
        manufacturer: "Fluke",
        model: "DM-100",
        serialNumber: `E2E-${Date.now()}`,
        status: "active",
      },
      authHeader(token),
    );
    expect(status).toBe(201);
    expect(body.data).toHaveProperty("id");
    createdId = body.data.id;
  });

  test("GET /calibration-devices/:id — 200 returns the device", async () => {
    const { status, body } = await httpGet(
      `/calibration-devices/${createdId}`,
      authHeader(token),
    );
    expect(status).toBe(200);
    expect(body.data.id).toBe(createdId);
  });

  test("PUT /calibration-devices/:id — 200 updates status", async () => {
    const { status, body } = await httpPut(
      `/calibration-devices/${createdId}`,
      { status: "maintenance" },
      authHeader(token),
    );
    expect(status).toBe(200);
    expect(body.data.id).toBe(createdId);
  });

  test("GET /calibration-devices/:id — 400 on invalid UUID", async () => {
    const { status } = await httpGet(
      "/calibration-devices/not-a-uuid",
      authHeader(token),
    );
    expect(status).toBe(400);
  });

  test("POST /calibration-devices — 400 when name missing", async () => {
    const { status } = await httpPost(
      "/calibration-devices",
      { manufacturer: "NoName" },
      authHeader(token),
    );
    expect(status).toBe(400);
  });

  test("DELETE /calibration-devices/:id — 200 removes the device", async () => {
    const { status } = await httpDelete(
      `/calibration-devices/${createdId}`,
      authHeader(token),
    );
    expect(status).toBe(200);
    createdId = null;
  });
});

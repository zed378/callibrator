/**
 * E2E Tests: Workflows module (/api/v1/workflows)
 *
 * Custom approval workflow engine. Verified live against the running server.
 *
 * KNOWN DEFECT (as of this audit): POST /workflows, PUT /workflows/:id and
 * POST /workflows/instances/:id/action 500 because workflow.service.js
 * destructures `db` from ../models — but the models barrel never exports a
 * `db` key, so `db.sequelize.transaction()` throws
 * "Cannot read properties of undefined (reading 'sequelize')".
 * Fix: destructure `sequelize` (it IS exported) instead of `db`.
 * The create test below asserts the INTENDED 201 so it stays red until fixed.
 */
const { httpGet, httpPost, httpDelete, authHeader } = require("../setup");

describe("E2E Workflows (HTTP)", () => {
  let token;
  let roleId;

  beforeAll(async () => {
    const { body } = await httpPost("/auth/login", { user: "sys@mail.com", password: "123123" });
    token = body.token || (body.data && body.data.token);
    const roles = await httpGet("/roles?limit=1", authHeader(token));
    const rows = roles.body && roles.body.data;
    roleId = Array.isArray(rows) ? rows[0] && rows[0].id : rows && rows.rows && rows.rows[0] && rows.rows[0].id;
  });

  test("GET /workflows/instances/pending -> 200 envelope, data array", async () => {
    const { status, body } = await httpGet("/workflows/instances/pending", authHeader(token));
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  test("GET /workflows -> 200 list", async () => {
    const { status, body } = await httpGet("/workflows", authHeader(token));
    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
  });

  test("POST /workflows -> 201 (INTENDED; currently 500 db.sequelize bug)", async () => {
    const payload = {
      name: "E2E WF " + Date.now(),
      resourceType: "Certificate",
      steps: [{ stepOrder: 1, roleId, requiredApprovals: 1 }],
    };
    const { status, body } = await httpPost("/workflows", payload, authHeader(token));
    expect(status).toBe(201);
    expect(body.data && body.data.id).toBeTruthy();
    // cleanup
    if (body.data && body.data.id) {
      await httpDelete("/workflows/" + body.data.id, authHeader(token));
    }
  });

  test("POST /workflows/instances/:id/action -> 400 on non-uuid instanceId", async () => {
    const { status } = await httpPost(
      "/workflows/instances/not-a-uuid/action",
      { action: "APPROVED" },
      authHeader(token),
    );
    expect(status).toBe(400);
  });

  test("POST /workflows -> 400 when steps missing (validator)", async () => {
    const { status, body } = await httpPost(
      "/workflows",
      { name: "no steps", resourceType: "Certificate" },
      authHeader(token),
    );
    expect(status).toBe(400);
    expect(body.success).toBe(false);
  });
});

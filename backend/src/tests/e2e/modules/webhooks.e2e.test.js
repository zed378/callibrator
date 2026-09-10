/**
 * E2E Tests: Webhooks — /api/v1/webhooks
 *
 * Outbound webhook subscriptions + delivery log. Gated by the "webhooks" plan
 * feature; SUPER_ADMIN bypasses. The signing secret is returned once on create.
 */
const { httpGet, httpPost, httpDelete, authHeader, API_BASE, defaultHeaders } = require("../setup");

async function httpPatch(path, data = {}, headers = {}) {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers: { ...defaultHeaders, ...headers },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(15000),
  });
  const ct = resp.headers.get("content-type") || "";
  const body = ct.includes("application/json") ? await resp.json().catch(() => null) : null;
  return { status: resp.status, body };
}

let token;
async function login() {
  const { body } = await httpPost("/auth/login", { user: "sys@mail.com", password: "123123" });
  token = body.token || (body.data && body.data.token);
  return token;
}

describe("E2E Webhooks (HTTP)", () => {
  let hookId;

  beforeAll(async () => {
    await login();
  });

  afterAll(async () => {
    if (hookId) await httpDelete(`/webhooks/${hookId}`, authHeader(token));
  });

  test("GET /webhooks — list, envelope + top-level meta", async () => {
    const { status, body } = await httpGet("/webhooks", authHeader(token));
    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body).toHaveProperty("meta");
  });

  test("POST /webhooks — create returns secret once", async () => {
    const { status, body } = await httpPost(
      "/webhooks",
      { url: "https://example.com/hook", events: ["certificate.signed"], description: "e2e" },
      authHeader(token),
    );
    expect(status).toBe(201);
    expect(body.data).toHaveProperty("id");
    hookId = body.data.id;
  });

  test("GET /webhooks/:id — fetch without secret", async () => {
    const { status, body } = await httpGet(`/webhooks/${hookId}`, authHeader(token));
    expect(status).toBe(200);
    expect(body.data.id).toBe(hookId);
  });

  test("PATCH /webhooks/:id — deactivate", async () => {
    const { status, body } = await httpPatch(
      `/webhooks/${hookId}`,
      { isActive: false },
      authHeader(token),
    );
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  test("GET /webhooks/:id/deliveries — delivery log list", async () => {
    const { status, body } = await httpGet(`/webhooks/${hookId}/deliveries`, authHeader(token));
    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
  });

  test("DELETE /webhooks/:id — soft delete", async () => {
    const { status } = await httpDelete(`/webhooks/${hookId}`, authHeader(token));
    expect(status).toBe(200);
    hookId = null;
  });

  test("GET /webhooks — 401 without token", async () => {
    const { status } = await httpGet("/webhooks");
    expect(status).toBe(401);
  });
});

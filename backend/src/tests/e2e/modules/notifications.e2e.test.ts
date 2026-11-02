/**
 * E2E Tests: Notifications module (/api/v1/notifications)
 *
 * User + tenant-wide notifications with realtime (socket.io) delivery.
 * Verified live against the running server — list, test-emit, mark-read,
 * mark-all-read and delete all returned healthy 2xx during the audit.
 *
 * setup.js ships no PATCH helper, so a local one is defined below.
 */
const { API_BASE, httpGet, httpPost, httpDelete, authHeader, defaultHeaders } = require("../setup") as any;
// P10-16 (ADR-099): no default operator password — set E2E_OPERATOR_PASSWORD (see setup.js).
const { OPERATOR_PASSWORD } = require("../setup") as any;

async function httpPatch(path: any,  data: any = {},  headers: any = {}) {
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

describe("E2E Notifications (HTTP)", () => {
  let token: any = undefined;
  let notificationId: any = undefined;

  beforeAll(async () => {
    const { body } = await httpPost("/auth/login", { user: "sys@mail.com", password: OPERATOR_PASSWORD });
    token = (body as any).token || ((body as any).data && (body as any).data.token);
  });

  test("GET /notifications -> 200, data array + top-level meta", async () => {
    const { status, body } = await httpGet("/notifications", authHeader(token));
    expect(status).toBe(200);
    expect(Array.isArray((body as any).data)).toBe(true);
    expect((body as any).meta).toBeDefined();
    expect((body as any).meta).toHaveProperty("unread");
  });

  test("POST /notifications/test -> 201, emits a notification", async () => {
    const { status, body } = await httpPost(
      "/notifications/test",
      { scope: "user", title: "E2E", message: "hi", type: "SYSTEM" },
      authHeader(token),
    );
    expect(status).toBe(201);
    expect((body as any).data.id).toBeTruthy();
    expect((body as any).data.isRead).toBe(false);
    notificationId = (body as any).data.id;
  });

  test("PATCH /notifications/:id/read -> 200, flips isRead", async () => {
    const { status, body } = await httpPatch(
      "/notifications/" + notificationId + "/read",
      {},
      authHeader(token),
    );
    expect(status).toBe(200);
    expect((body as any).data.isRead).toBe(true);
  });

  test("PATCH /notifications/read-all -> 200", async () => {
    const { status, body } = await httpPatch("/notifications/read-all", {}, authHeader(token));
    expect(status).toBe(200);
    expect((body as any).success).toBe(true);
  });

  test("PATCH /notifications/:id/read -> 400 on non-uuid id", async () => {
    const { status } = await httpPatch("/notifications/not-a-uuid/read", {}, authHeader(token));
    expect(status).toBe(400);
  });

  test("DELETE /notifications/:id -> 200 removes the test notification", async () => {
    const { status, body } = await httpDelete(
      "/notifications/" + notificationId,
      authHeader(token),
    );
    expect(status).toBe(200);
    expect((body as any).success).toBe(true);
  });
});

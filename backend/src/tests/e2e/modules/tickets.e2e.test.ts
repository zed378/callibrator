/**
 * E2E Tests: Tickets module (/api/v1/tickets)
 *
 * Support / help-desk tickets. Verified live against the running server.
 *
 * NOTE (by design, not a defect): a SUPER ADMIN answers tickets and cannot
 * raise them, so POST /tickets returns 403 for the seeded sys@mail.com account
 * (ticket.service.js createTicket -> isSuperAdmin guard). Downstream ticket
 * CRUD/assign/comment therefore cannot be exercised from a super-admin token;
 * they require a tenant (non-super-admin) user.
 */
const { httpGet, httpPost, authHeader } = require("../setup") as any;
// P10-16 (ADR-099): no default operator password — set E2E_OPERATOR_PASSWORD (see setup.js).
const { OPERATOR_PASSWORD } = require("../setup") as any;

describe("E2E Tickets (HTTP)", () => {
  let token: any = undefined;

  beforeAll(async () => {
    const { body } = await httpPost("/auth/login", { user: "sys@mail.com", password: OPERATOR_PASSWORD });
    token = (body as any).token || ((body as any).data && (body as any).data.token);
  });

  test("GET /tickets -> 200, data array + top-level meta", async () => {
    const { status, body } = await httpGet("/tickets", authHeader(token));
    expect(status).toBe(200);
    expect(Array.isArray((body as any).data)).toBe(true);
    expect((body as any).meta).toBeDefined();
    expect((body as any).meta).toHaveProperty("page");
  });

  test("GET /tickets/metrics -> 200 with aggregate buckets", async () => {
    const { status, body } = await httpGet("/tickets/metrics", authHeader(token));
    expect(status).toBe(200);
    expect((body as any).data).toHaveProperty("byStatus");
    expect((body as any).data).toHaveProperty("byPriority");
  });

  test("POST /tickets as super admin -> 403 (super admins cannot raise)", async () => {
    const { status, body } = await httpPost(
      "/tickets",
      { subject: "E2E ticket", description: "<p>x</p>", priority: "high", category: "bug" },
      authHeader(token),
    );
    expect(status).toBe(403);
    expect((body as any).success).toBe(false);
  });

  test("POST /tickets -> 400 on missing subject (validator)", async () => {
    const { status, body } = await httpPost(
      "/tickets",
      { description: "no subject" },
      authHeader(token),
    );
    expect(status).toBe(400);
    expect((body as any).success).toBe(false);
  });

  test("GET /tickets/:id -> 400 on non-uuid id", async () => {
    const { status } = await httpGet("/tickets/not-a-uuid", authHeader(token));
    expect(status).toBe(400);
  });
});

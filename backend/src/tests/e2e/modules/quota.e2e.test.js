/**
 * E2E Tests: Quota module (/api/v1/quota)
 *
 * Live smoke coverage:
 *  - GET /quota — current tenant plan, seat/storage usage, and features.
 */
const { httpGet, httpPost, extractToken, authHeader } = require("../setup");

describe("E2E Quota (HTTP)", () => {
  let token;

  beforeAll(async () => {
    const { body } = await httpPost("/auth/login", {
      user: "sys@mail.com",
      password: "123123",
    });
    token = extractToken(body);
    expect(token).toBeTruthy();
  });

  test("GET /quota — 401 without auth", async () => {
    const { status } = await httpGet("/quota");
    expect(status).toBe(401);
  });

  test("GET /quota — 200 with usage summary object", async () => {
    const { status, body } = await httpGet("/quota", authHeader(token));
    expect(status).toBe(200);
    expect(body).toHaveProperty("success", true);
    expect(body).toHaveProperty("data");
    expect(typeof body.data).toBe("object");
  });
});

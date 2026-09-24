/**
 * A-174 — `PATCH /admin/tenants/:id/flags` had no validator.
 *
 * `flags` went straight to admin.service#updateTenantFlags, which spreads it
 * into `tenants.settings`: a string became one key per character, and a
 * secret-named key (`smtp_password`, `oidc_client_secret`, `oidc_rp_*`) was
 * written into the JSONB column in plaintext — re-planting what A-150 and
 * migration 0035 take out.
 *
 * Drives the REAL route (routes/api/admin.route.js) with the real
 * validation middleware and the real updateTenantFlagsSchema. Stubbed: `auth`
 * and `rbac` (a super admin is assumed — the gate is not under test) and the
 * service, so what reaches it is observable.
 */
const TENANT = "7c0e2d4a-1111-4a2b-9c3d-000000000a74";

jest.mock("../../middlewares/auth.middleware", () => ({
  auth: (req, res, next) => {
    req.user = { id: "super-1", tenantId: "platform" };
    next();
  },
}));
jest.mock("../../middlewares/rbac.middleware", () => ({
  rbac: () => (req, res, next) => next(),
}));
jest.mock("../../services/admin.service", () => ({
  getAllTenants: jest.fn(),
  updateTenantStatus: jest.fn(),
  updateTenantFlags: jest.fn(async (id, flags) => ({ id, settings: flags })),
}));

const adminService = require("../../services/admin.service");
const router = require("../../routes/api/admin.route");

// Express's own router.handle with a minimal req/res pair — supertest is not a
// dependency of this workspace (same harness as certificates.approve.a62).
const patchFlags = (body) =>
  new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headersSent: false,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.headersSent = true;
        resolve({ status: this.statusCode, body: payload });
        return this;
      },
      send(payload) {
        return this.json(payload);
      },
      setHeader() {
        return this;
      },
      end() {
        this.headersSent = true;
        resolve({ status: this.statusCode, body: null });
        return this;
      },
    };
    const req = {
      method: "PATCH",
      url: `/tenants/${TENANT}/flags`,
      originalUrl: `/api/v1/admin/tenants/${TENANT}/flags`,
      body,
      query: {},
      params: {},
      headers: { "user-agent": "jest-agent" },
      ip: "10.0.0.7",
      get: () => undefined,
    };
    router.handle(req, res, (err) =>
      resolve({
        status: err ? err.status || err.statusCode || 500 : 404,
        body: { message: err ? err.message : "no route" },
      }),
    );
  });

const messages = (res) => JSON.stringify(res.body);

describe("A-174 — PATCH /admin/tenants/:id/flags validates flags", () => {
  it.each([
    ["missing", {}],
    ["a string (spread one key per character)", { flags: "ab" }],
    ["an array", { flags: ["a"] }],
    ["null", { flags: null }],
    ["a number", { flags: 7 }],
  ])("refuses flags that are %s with a 400", async (_name, body) => {
    const res = await patchFlags(body);

    expect(res.status).toBe(400);
    expect(adminService.updateTenantFlags).not.toHaveBeenCalled();
  });

  it.each([
    "smtp_password",
    "smtpPassword",
    "oidc_client_secret",
    "stripe_secret_key",
    "webhook_signing_secret",
    "storage_credentials",
    "ai_api_key",
    "apiKey",
    "access_token",
    "oidc_rp_33333333-3333-4333-8333-333333333333",
  ])("refuses the secret-named key %s, naming it", async (key) => {
    const res = await patchFlags({ flags: { featureA: true, [key]: "plain" } });

    expect(res.status).toBe(400);
    expect(messages(res)).toContain(key);
    expect(adminService.updateTenantFlags).not.toHaveBeenCalled();
  });

  it.each([
    ["an object", { nested: { a: 1 } }],
    ["an array", { list: [1] }],
    ["a non-finite number", { big: Number.POSITIVE_INFINITY }],
    ["an over-long string", { note: "x".repeat(1001) }],
  ])("refuses a flag whose value is %s", async (_name, flags) => {
    const res = await patchFlags({ flags });

    expect(res.status).toBe(400);
    expect(adminService.updateTenantFlags).not.toHaveBeenCalled();
  });

  it.each([["0"], ["has space"], ["_leading"], ["x".repeat(65)]])(
    "refuses the malformed flag key %j",
    async (key) => {
      const res = await patchFlags({ flags: { [key]: true } });

      expect(res.status).toBe(400);
      expect(adminService.updateTenantFlags).not.toHaveBeenCalled();
    },
  );

  it("refuses more than 50 flags at once", async () => {
    const flags = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`f${i}`, true]));

    const res = await patchFlags({ flags });

    expect(res.status).toBe(400);
  });

  it("passes a plain object of scalar flags through unchanged", async () => {
    const flags = { featureA: true, beta: false, max_devices: 250, tier: "gold", sunset: null };

    const res = await patchFlags({ flags });

    expect(res.status).toBe(200);
    expect(adminService.updateTenantFlags).toHaveBeenCalledWith(TENANT, flags, expect.any(Object));
  });
});

/**
 * A-174 — `PATCH /admin/tenants/:id/flags` had no validator.
 *
 * `flags` went straight to admin.service#updateTenantFlags, which spreads it
 * into `tenants.settings`: a string became one key per character, and a
 * secret-named key (`smtp_password`, `oidc_client_secret`, `oidc_rp_*`) was
 * written into the JSONB column in plaintext — re-planting what A-150 and
 * migration 0035 take out.
 *
 * Drives the REAL route (routes/api/admin.route.ts) with the real
 * validation middleware and the real updateTenantFlagsSchema. Stubbed: `auth`
 * and `rbac` (a super admin is assumed — the gate is not under test) and the
 * service, so what reaches it is observable.
 */

interface AdminService {
  updateTenantFlags: jest.Mock;
}

const TENANT = "7c0e2d4a-1111-4a2b-9c3d-000000000a74";

jest.mock("../../middlewares/auth.middleware", () => ({
  auth: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { id: "super-1", tenantId: "platform" };
    next();
  },
  // P24-06: the SQL-dump import's routes carry superAdminOnly beside the router's rbac.
  superAdminOnly: (_req: unknown, _res: unknown, next: () => void) => {
    next();
  },
  // P21-01: the catalogue-proposal decisions carry denyApiKey.
  denyApiKey: (_req: unknown, _res: unknown, next: () => void) => {
    next();
  },
}));
jest.mock("../../middlewares/rbac.middleware", () => ({
  rbac: () => (_req: unknown, _res: unknown, next: () => void) => {
    next();
  },
}));
jest.mock("../../services/admin.service", () => ({
  getAllTenants: jest.fn(),
  updateTenantStatus: jest.fn(),
  updateTenantFlags: jest.fn((id: string, flags: unknown) => Promise.resolve({ id, settings: flags })),
}));

/* eslint-disable @typescript-eslint/no-require-imports -- loaded after the mocks above, as every memoryDb test */
const adminService = require("../../services/admin.service") as AdminService;
/* eslint-enable @typescript-eslint/no-require-imports */

interface AdminRouter {
  handle: (
    req: object,
    res: object,
    done: (err?: { status?: number; statusCode?: number; message?: string }) => void,
  ) => void;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports -- the router is `export =` (CommonJS), loaded after the mocks
const router = require("../../routes/api/admin.route") as AdminRouter;

interface FlagsAnswer {
  status: number;
  body: unknown;
}

// Express's own router.handle with a minimal req/res pair — supertest is not a
// dependency of this workspace (same harness as certificates.approve.a62).
const patchFlags = (body: unknown): Promise<FlagsAnswer> =>
  new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headersSent: false,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.headersSent = true;
        resolve({ status: this.statusCode, body: payload });
        return this;
      },
      send(payload: unknown) {
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
    router.handle(req, res, (err?: { status?: number; statusCode?: number; message?: string }) => {
      resolve({
        status: err ? (err.status ?? err.statusCode ?? 500) : 404,
        body: { message: err ? err.message : "no route" },
      });
    });
  });

const messages = (res: FlagsAnswer): string => JSON.stringify(res.body);

describe("A-174 — PATCH /admin/tenants/:id/flags validates flags", () => {
  it.each([
    ["missing", {}],
    ["a string (spread one key per character)", { flags: "ab" }],
    ["an array", { flags: ["a"] }],
    ["null", { flags: null }],
    ["a number", { flags: 7 }],
  ])("refuses flags that are %s with a 400", async (_name: string, body: unknown) => {
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
  ])("refuses the secret-named key %s, naming it", async (key: string) => {
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
  ])("refuses a flag whose value is %s", async (_name: string, flags: Record<string, unknown>) => {
    const res = await patchFlags({ flags });

    expect(res.status).toBe(400);
    expect(adminService.updateTenantFlags).not.toHaveBeenCalled();
  });

  it.each([["0"], ["has space"], ["_leading"], ["x".repeat(65)]])(
    "refuses the malformed flag key %j",
    async (key: string) => {
      const res = await patchFlags({ flags: { [key]: true } });

      expect(res.status).toBe(400);
      expect(adminService.updateTenantFlags).not.toHaveBeenCalled();
    },
  );

  it("refuses more than 50 flags at once", async () => {
    const flags = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`f${String(i)}`, true]));

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

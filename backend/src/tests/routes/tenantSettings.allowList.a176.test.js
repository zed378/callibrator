/**
 * A-176 — `PATCH /tenants/settings` accepted ANY key.
 *
 * Management write could set, directly in `tenant_settings`, the keys that
 * belong to super-admin-only or separately gated endpoints: lift a legal hold,
 * put a retention period below its minimum, change the lifecycle status,
 * switch a feature flag, clear the IP allow-list or geofence, register an
 * OIDC client (`oidc_rp_*`), repoint storage. The endpoint now takes only the
 * keys in constants/tenantAdminSettings.js and refuses anything else with a
 * 400 that names the key — writing nothing.
 *
 * Drives the REAL route (routes/api/tenant.route.js), the real controller and
 * the real tenant.service. Stubbed: `auth` (a fixed principal), the
 * permission gate and rate limiter (not under test), and the models — an
 * in-memory `tenant_settings` that records every write.
 *
 * The refused and accepted keys are written out by hand: they are the claim,
 * not a copy of the allow-list.
 */
const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const mockStore = { rows: new Map(), writes: [], transactions: 0 };

jest.mock("../../middlewares/auth.middleware", () => {
  const actual = jest.requireActual("../../middlewares/auth.middleware");
  return {
    ...actual,
    auth: (req, res, next) => {
      req.user = { id: "u-admin", tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
      next();
    },
  };
});
jest.mock("../../middlewares/dynamicAccess.middleware", () => ({
  dynamicAccess: () => (req, res, next) => next(),
}));
jest.mock("../../services/rateLimiter.redis.service", () => ({
  endpointRateLimiter: () => (req, res, next) => next(),
}));
jest.mock("../../middlewares/enforceQuota.middleware", () => ({
  enforceStorageQuota: () => (req, res, next) => next(),
}));
jest.mock("../../utils/upload.util", () => ({
  upload: () => (req, res, next) => next(),
  deleteUpload: jest.fn(),
}));
jest.mock("../../services/redis.service", () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  delPattern: jest.fn().mockResolvedValue(undefined),
  cacheKeys: {
    tenant: (id) => `tenant:${id}`,
    tenantByCode: (code) => `tenant:code:${code}`,
    tenantSettings: (id) => `tenant:settings:${id}`,
  },
}));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn() }));
jest.mock("../../config", () => ({
  db: {
    transaction: jest.fn(async () => {
      mockStore.transactions += 1;
      return {
        finished: undefined,
        async commit() {
          this.finished = "commit";
        },
        async rollback() {
          this.finished = "rollback";
        },
      };
    }),
    sequelize: { fn: jest.fn() },
  },
}));
jest.mock("../../models", () => ({
  Tenants: {
    findByPk: jest.fn(async () => ({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", settings: {} })),
  },
  Users: {},
  TenantSettings: {
    findAll: jest.fn(async () => [...mockStore.rows].map(([key, value]) => ({ key, value }))),
    findOrCreate: jest.fn(async ({ where, defaults }) => {
      mockStore.writes.push(where.key);
      mockStore.rows.set(where.key, defaults.value);
      return [{ key: where.key, value: defaults.value }, true];
    }),
  },
}));

const tenantRouter = require("../../routes/api/tenant.route");

// Express's own router.handle with a minimal req/res pair — supertest is not a
// dependency of this workspace (same harness as certificates.approve.a62).
const patch = (body) =>
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
      url: "/settings",
      originalUrl: "/api/v1/tenants/settings",
      body,
      query: {},
      params: {},
      headers: { "user-agent": "jest-agent" },
      ip: "10.0.0.7",
      get: () => undefined,
    };
    tenantRouter.handle(req, res, (err) =>
      resolve({
        status: err ? err.status || err.statusCode || 500 : 404,
        body: { message: err ? err.message : "no route" },
      }),
    );
  });

beforeEach(() => {
  mockStore.rows = new Map();
  mockStore.writes = [];
  mockStore.transactions = 0;
});

// Keys owned by a gated endpoint or a super admin — or by nothing at all.
const REFUSED = [
  "legal_hold_enabled",
  "legal_hold_reason",
  "legal_hold_enabled_by",
  "retention_policy_notifications",
  "retention_policy_sessions",
  "lifecycle_status",
  "feature_flag_enable_mfa",
  "ip_allowlist",
  "geofence",
  "oidc_rp_33333333-3333-4333-8333-333333333333",
  "storage_config",
  "storage_credentials",
  "stripe_secret_key",
  "webhook_signing_secret",
  "smtp_password",
  "theme",
  "__proto__x",
];

// What the SSO form writes, and what the SSO/MFA/AI code reads with no other writer.
const ACCEPTED = {
  sso_enabled: true,
  sso_idp_entry_point: "https://idp.example/sso",
  sso_idp_entity_id: "https://idp.example",
  sso_idp_cert: "-----BEGIN CERTIFICATE-----MIIC",
  sso_sp_entity_id: "https://sp.example",
  sso_sp_callback_url: "https://sp.example/cb",
  oidc_client_id: "client",
  oidc_client_secret: "secret",
  oidc_redirect_uri: "https://sp.example/oidc",
  oidc_authority: "https://idp.example/oidc",
  mfa_required: "true",
  mfa_required_min_role_level: 3,
  ai_vendor: "openai",
  ai_base_url: "https://ai.example/v1",
  ai_api_key: "sk-ai",
};

describe("A-176 — PATCH /tenants/settings takes only tenant-admin keys", () => {
  it.each(REFUSED)("refuses %s with a 400 naming it, and writes nothing", async (key) => {
    const res = await patch({ tenantId: TENANT, settings: { [key]: "x" } });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain(`"${key}"`);
    expect(mockStore.writes).toEqual([]);
    expect(mockStore.transactions).toBe(0);
  });

  it("refuses a gated key sent top-level as well as nested", async () => {
    const res = await patch({ tenantId: TENANT, legal_hold_enabled: "false" });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('"legal_hold_enabled"');
    expect(mockStore.writes).toEqual([]);
  });

  it("one refused key refuses the whole request — no partial save", async () => {
    const res = await patch({
      tenantId: TENANT,
      settings: { sso_enabled: true, retention_policy_notifications: "1" },
    });

    expect(res.status).toBe(400);
    expect(mockStore.writes).toEqual([]);
  });

  it.each([
    ["an object", { a: 1 }],
    ["an array", ["a"]],
  ])("refuses an allowed key whose value is %s", async (_name, value) => {
    const res = await patch({ tenantId: TENANT, settings: { sso_idp_entry_point: value } });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('"sso_idp_entry_point"');
    expect(mockStore.writes).toEqual([]);
  });

  it("accepts every key the SSO form, MFA policy and AI config use", async () => {
    const res = await patch({ tenantId: TENANT, settings: ACCEPTED });

    expect(res.status).toBe(200);
    expect(mockStore.writes.sort()).toEqual(Object.keys(ACCEPTED).sort());
    // Secrets are masked in the response; the public certificate is not (A-178).
    expect(res.body.data.oidc_client_secret).toBe("[REDACTED]");
    expect(res.body.data.ai_api_key).toBe("[REDACTED]");
    expect(res.body.data.sso_idp_cert).toBe("-----BEGIN CERTIFICATE-----MIIC");
  });

  it.each([
    ["required, with a minimum level", "true", "3"],
    ["not required, no level", "false", ""],
    // A-160: a level that is not a whole number makes the policy apply to everyone.
    ["a non-integer level", "true", "abc"],
  ])("the exact body the MFA policy panel (A-160) sends is accepted — %s", async (_n, required, level) => {
    // frontend/src/app/dashboard/tenants/components/MfaPolicyPanel.tsx#save
    const res = await patch({
      tenantId: TENANT,
      settings: { mfa_required: required, mfa_required_min_role_level: level },
    });

    expect(res.status).toBe(200);
    expect(mockStore.rows.get("mfa_required")).toBe(required);
    expect(mockStore.rows.get("mfa_required_min_role_level")).toBe(level);
  });

  it("the exact body the SSO form sends is accepted", async () => {
    const res = await patch({
      tenantId: TENANT,
      settings: {
        sso_enabled: false,
        sso_idp_entry_point: "",
        sso_idp_entity_id: "",
        sso_idp_cert: "",
        sso_sp_entity_id: "",
        sso_sp_callback_url: "",
      },
    });

    expect(res.status).toBe(200);
    expect(mockStore.writes).toHaveLength(6);
  });
});

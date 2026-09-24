/**
 * A-150 — tenant secrets were copied into `tenants.settings` in plaintext.
 *
 * `updateTenantSettings` re-read every `tenant_settings` row — which the
 * model's afterFind hook DECRYPTS — and wrote the whole map into the
 * `tenants.settings` JSONB column, which every tenant API returns. Each save
 * undid the KMS envelope. `POST /tenants/settings` returned the decrypted
 * values as well, and `ai_api_key` was not encrypted at all.
 *
 * The credential keys below are WRITTEN OUT BY HAND. They are the claim, not a
 * copy of constants/tenantSecretSettings.js: a test that iterated the
 * redactor's own list could not catch a key being dropped from it.
 *
 * `tenant_settings` is played by an in-memory double that returns values
 * DECRYPTED, as the real model's afterFind does — the exact condition under
 * which the old code leaked.
 */

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
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));
jest.mock("../../utils/upload.util", () => ({ deleteUpload: jest.fn() }));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn() }));
jest.mock("../../config", () => ({
  db: {
    transaction: jest.fn(),
    sequelize: { fn: jest.fn((name, col) => `${name}(${col})`) },
  },
}));

const mockStore = { rows: new Map(), tenant: null };

jest.mock("../../models", () => ({
  Tenants: {
    findAll: jest.fn(async () => [mockStore.tenant]),
    findByPk: jest.fn(async () => mockStore.tenant),
    count: jest.fn(async () => 1),
  },
  Users: { findAll: jest.fn(async () => []), count: jest.fn(async () => 0) },
  TenantSettings: {
    // Values come back decrypted, as the real afterFind hook returns them.
    findAll: jest.fn(async () =>
      [...mockStore.rows].map(([key, value]) => ({ key, value })),
    ),
    findOrCreate: jest.fn(async ({ where, defaults }) => {
      if (mockStore.rows.has(where.key)) {
        const row = {
          key: where.key,
          value: mockStore.rows.get(where.key),
          update: jest.fn(async ({ value }) => {
            mockStore.rows.set(where.key, value);
          }),
        };
        return [row, false];
      }
      mockStore.rows.set(where.key, defaults.value);
      return [{ key: where.key, value: defaults.value }, true];
    }),
  },
}));

const { db } = require("../../config");
const { Tenants } = require("../../models");
const { set } = require("../../services/redis.service");
const tenantService = require("../../services/tenant.service");

const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

// Hand-written: every credential shape a tenant can store.
const SECRETS = {
  oidc_client_secret: "oidc-client-secret-value",
  stripe_secret_key: "sk_live_stripe_value",
  webhook_signing_secret: "whsec_value",
  storage_credentials: '{"accessKeyId":"AKIAVALUE","secretAccessKey":"s3-secret-value"}',
  ai_api_key: "sk-ai-vendor-key-value",
  smtp_password: "smtp-password-value",
  smtpPassword: "smtp-camel-password-value",
  apiKey: "camel-api-key-value",
  x_api_key: "x-api-key-value",
  access_token: "access-token-value",
  private_key: "private-key-value",
  aws_access_key_id: "aws-access-key-id-value",
  ldap_bind_credentials: "ldap-bind-credentials-value",
  "oidc_rp_11111111-1111-4111-8111-111111111111": '{"clientSecretHash":"rp-hash-value"}',
};
const PLAIN = {
  theme: "dark",
  // A-178: the IdP's public certificate is not a secret.
  sso_idp_cert: "MIIC-idp-certificate-body",
  sso_enabled: "true",
  oidc_client_id: "client-id-value",
  ai_base_url: "https://ai.example",
  ai_vendor: "openai",
  storage_config: '{"provider":"s3"}',
};

const makeTenant = (settings) => {
  const row = {
    id: TENANT_ID,
    name: "Hospital A",
    code: "HOSPA",
    logo: null,
    settings,
    update: jest.fn(async (values) => Object.assign(row, values)),
  };
  row.toJSON = () => ({
    id: row.id,
    name: row.name,
    code: row.code,
    logo: row.logo,
    settings: row.settings,
  });
  return row;
};

const tx = () => ({
  finished: undefined,
  commit: jest.fn(async function commit() {
    this.finished = "commit";
  }),
  rollback: jest.fn(async function rollback() {
    this.finished = "rollback";
  }),
});

/** Every secret VALUE that appears anywhere in `payload`. */
const leakedValues = (payload) => {
  const text = JSON.stringify(payload);
  return Object.entries(SECRETS)
    .filter(([, value]) => text.includes(value) || text.includes(JSON.stringify(value).slice(1, -1)))
    .map(([key]) => key);
};

/** Every secret KEY that appears as a property of a tenant row's settings. */
const leakedKeys = (settings) =>
  Object.keys(settings || {}).filter((k) => Object.prototype.hasOwnProperty.call(SECRETS, k));

beforeEach(() => {
  jest.clearAllMocks();
  db.transaction.mockImplementation(async () => tx());
  mockStore.rows = new Map([...Object.entries(PLAIN), ...Object.entries(SECRETS)]);
  // The legacy state: an earlier save copied every decrypted value here.
  mockStore.tenant = makeTenant({ ...PLAIN, ...SECRETS, flag_from_admin: true });
});

describe("A-150 — updateTenantSettings never copies settings into tenants.settings", () => {
  it("a save leaves the tenant row's settings column untouched", async () => {
    mockStore.tenant = makeTenant({ flag_from_admin: true });

    await tenantService.updateTenantSettings(
      TENANT_ID,
      { tenantId: TENANT_ID, settings: { ai_api_key: "sk-new", ai_vendor: "anthropic" } },
      "u-admin",
      { userId: "u-admin" },
    );

    expect(mockStore.tenant.update).not.toHaveBeenCalled();
    expect(mockStore.tenant.settings).toEqual({ flag_from_admin: true });
    // The value itself reached tenant_settings (the model encrypts it there).
    expect(mockStore.rows.get("ai_api_key")).toBe("sk-new");
  });

  it("a secret sent back as the mask a read returned is left unchanged", async () => {
    await tenantService.updateTenantSettings(
      TENANT_ID,
      { settings: { oidc_client_secret: "[REDACTED]", ai_vendor: "anthropic" } },
      "u-admin",
      { userId: "u-admin" },
    );

    expect(mockStore.rows.get("oidc_client_secret")).toBe(SECRETS.oidc_client_secret);
    expect(mockStore.rows.get("ai_vendor")).toBe("anthropic");
  });

  it("a non-secret key whose value happens to be the mask is written as given", async () => {
    await tenantService.updateTenantSettings(
      TENANT_ID,
      { ai_vendor: "[REDACTED]" },
      "u-admin",
      { userId: "u-admin" },
    );

    expect(mockStore.rows.get("ai_vendor")).toBe("[REDACTED]");
  });
});

describe("A-150 — no tenant or settings response carries a secret", () => {
  const responses = {
    "fetchTenants (GET /tenants)": () => tenantService.fetchTenants({ page: 2 }),
    "fetchSpecificTenant (GET /tenants/:id)": () => tenantService.fetchSpecificTenant(TENANT_ID),
    "getTenantSettings (POST /tenants/settings)": () => tenantService.getTenantSettings(TENANT_ID),
    "updateTenantSettings (PATCH /tenants/settings)": () =>
      tenantService.updateTenantSettings(TENANT_ID, { ai_vendor: "anthropic" }, "u-admin", {
        userId: "u-admin",
      }),
  };

  it.each(Object.keys(responses))("%s", async (name) => {
    const result = await responses[name]();

    expect(leakedValues(result)).toEqual([]);
  });

  it("a tenant row keeps its non-secret settings and loses every secret key", async () => {
    const result = await tenantService.fetchSpecificTenant(TENANT_ID);

    expect(leakedKeys(result.data.settings)).toEqual([]);
    expect(result.data.settings).toEqual({ ...PLAIN, flag_from_admin: true });
    // Nothing secret was put in the tenant cache either.
    expect(leakedValues(set.mock.calls)).toEqual([]);
  });

  it("a list row loses every secret key", async () => {
    const result = await tenantService.fetchTenants({ page: 2 });

    expect(leakedKeys(result.data.rows[0].settings)).toEqual([]);
  });

  it("the settings response lists each secret as configured, value masked", async () => {
    const result = await tenantService.getTenantSettings(TENANT_ID);

    for (const key of Object.keys(SECRETS)) {
      expect(result.data.settings[key]).toBe("[REDACTED]");
    }
    for (const [key, value] of Object.entries(PLAIN)) {
      expect(result.data.settings[key]).toBe(value);
    }
    expect(leakedKeys(result.data.tenant.settings)).toEqual([]);
  });

  it("an empty secret is shown as empty, not as configured", async () => {
    mockStore.rows.set("ai_api_key", "");
    mockStore.rows.set("smtp_password", null);

    const result = await tenantService.getTenantSettings(TENANT_ID);

    expect(result.data.settings.ai_api_key).toBe("");
    expect(result.data.settings.smtp_password).toBeNull();
  });

  it("a secret is never taken from the legacy JSONB copy", async () => {
    mockStore.rows = new Map(Object.entries(PLAIN));

    const internal = await tenantService.getTenantSettings(TENANT_ID, { includeSecrets: true });

    expect(leakedValues(internal.data.settings)).toEqual([]);
    expect(internal.data.settings.flag_from_admin).toBe(true);
  });

  it("only an in-process caller that asks gets the real values (the SSO flows)", async () => {
    const internal = await tenantService.getTenantSettings(TENANT_ID, { includeSecrets: true });

    expect(internal.data.settings.oidc_client_secret).toBe(SECRETS.oidc_client_secret);
    expect(internal.data.settings.ai_api_key).toBe(SECRETS.ai_api_key);
    expect(Tenants.findByPk).toHaveBeenCalledWith(TENANT_ID);
  });
});

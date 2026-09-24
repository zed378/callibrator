/**
 * Migration 0035 — scrub secrets out of `tenants.settings`, encrypt plaintext
 * secrets in `tenant_settings` (A-150).
 *
 * Runs against a fake QueryInterface holding both tables in memory. It proves
 * the migration's LOGIC — which rows and keys it touches, under which tenant,
 * that it verifies itself and is idempotent. It does NOT prove the SQL runs on
 * PostgreSQL (the JSONB casts, the `settings = previous` guard): that needs
 * `make migrate` and the SELECT in the migration's header.
 *
 * The secret keys are written out by hand.
 */
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const fs = require("fs");
const path = require("path");
const migration = require("../../migrations/0035-tenant-settings-secrets");
const kms = require("../../services/kms.service");

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";

const norm = (sql) => sql.replace(/\s+/g, " ").trim();

const fakeQueryInterface = ({ tenants, settings, tables = ["tenants", "tenant_settings"], interfere }) => {
  const state = {
    tenants: tenants.map((t) => ({ ...t })),
    settings: settings.map((s) => ({ ...s })),
  };
  const tx = { id: "tx" };
  const plaintext = () =>
    state.settings.filter((x) => x.value !== null && x.value !== "" && !/^v[12]:/.test(x.value));
  return {
    state,
    showAllTables: jest.fn(async () => tables),
    sequelize: {
      transaction: jest.fn(async (cb) => cb(tx)),
      query: jest.fn(async (sql, opts = {}) => {
        const s = norm(sql);
        const r = opts.replacements || {};
        if (s === "SELECT id, settings FROM tenants WHERE settings IS NOT NULL") {
          // The driver may hand JSONB back parsed or as text.
          return state.tenants
            .filter((t) => t.settings !== null)
            .map((t) => ({ id: t.id, settings: t.asText ? JSON.stringify(t.settings) : t.settings }));
        }
        if (s.startsWith("UPDATE tenants SET settings = CAST(:settings AS JSONB) WHERE id = :id AND settings = CAST(:previous AS JSONB)")) {
          expect(opts.transaction).toBe(tx);
          if (interfere) {
            interfere(state, r);
          }
          const hit = state.tenants.find(
            (t) => t.id === r.id && JSON.stringify(t.settings) === r.previous,
          );
          if (hit) {
            hit.settings = JSON.parse(r.settings);
          }
          return [[], { rowCount: hit ? 1 : 0 }];
        }
        if (s.startsWith("SELECT id, tenant_id, key, value FROM tenant_settings WHERE value IS NOT NULL AND value <> '' AND value NOT LIKE 'v1:%' AND value NOT LIKE 'v2:%'")) {
          return plaintext();
        }
        if (s.startsWith("SELECT key FROM tenant_settings WHERE value IS NOT NULL AND value <> '' AND value NOT LIKE 'v1:%' AND value NOT LIKE 'v2:%'")) {
          return plaintext().map((x) => ({ key: x.key }));
        }
        if (s.startsWith("UPDATE tenant_settings SET value = :value WHERE id = :id AND tenant_id = :tenantId AND value = :previous")) {
          expect(opts.transaction).toBe(tx);
          const hit = state.settings.find(
            (x) => x.id === r.id && x.tenant_id === r.tenantId && x.value === r.previous,
          );
          if (hit) {
            hit.value = r.value;
          }
          return [[], { rowCount: hit ? 1 : 0 }];
        }
        throw new Error(`unexpected query: ${s}`);
      }),
    },
  };
};

const seedTenants = () => [
  {
    id: T1,
    settings: {
      theme: "dark",
      oidc_client_secret: "oidc-secret",
      ai_api_key: "sk-ai",
      smtpPassword: "smtp",
      "oidc_rp_33333333-3333-4333-8333-333333333333": '{"clientSecretHash":"h"}',
      enable_iot: true,
    },
  },
  // returned as text by the driver
  // A-178: sso_idp_cert is the IdP's PUBLIC certificate — kept, not scrubbed.
  { id: T2, settings: { sso_idp_cert: "cert", locale: "id", ai_api_key: "sk-2" }, asText: true },
  // nothing to scrub
  { id: "t3", settings: { theme: "light" } },
  { id: "t4", settings: null },
  // a non-object JSON value is left alone
  { id: "t5", settings: ["legacy"] },
];

const seedSettings = () => [
  { id: "s1", tenant_id: T1, key: "ai_api_key", value: "sk-ai" },
  { id: "s2", tenant_id: T2, key: "smtp_password", value: "smtp-2" },
  { id: "s3", tenant_id: T1, key: "theme", value: "dark" },
  { id: "s4", tenant_id: T2, key: "oidc_client_secret", value: kms.encryptData(T2, "already") },
  { id: "s5", tenant_id: T1, key: "stripe_secret_key", value: "" },
  // A-178: a public certificate is left in plaintext.
  { id: "s6", tenant_id: T2, key: "sso_idp_cert", value: "-----BEGIN CERTIFICATE-----MIIC" },
];

describe("migration 0035-tenant-settings-secrets", () => {
  it("is registered in migrator.js with the .js suffix", () => {
    const manifest = fs.readFileSync(path.join(__dirname, "../../config/migrator.js"), "utf8");
    expect(manifest).toContain(
      '["0035-tenant-settings-secrets.js", require("../migrations/0035-tenant-settings-secrets")]',
    );
  });

  it("removes every secret key from tenants.settings and keeps every other key", async () => {
    const qi = fakeQueryInterface({ tenants: seedTenants(), settings: seedSettings() });

    await migration.up({ context: qi });

    const [t1, t2, t3, t4, t5] = qi.state.tenants;
    expect(t1.settings).toEqual({ theme: "dark", enable_iot: true });
    expect(t2.settings).toEqual({ sso_idp_cert: "cert", locale: "id" });
    expect(t3.settings).toEqual({ theme: "light" });
    expect(t4.settings).toBeNull();
    expect(t5.settings).toEqual(["legacy"]);
  });

  it("encrypts plaintext secrets in tenant_settings under their own tenant, and nothing else", async () => {
    const qi = fakeQueryInterface({ tenants: seedTenants(), settings: seedSettings() });
    const s4Before = qi.state.settings[3].value;

    await migration.up({ context: qi });

    const [s1, s2, s3, s4, s5, s6] = qi.state.settings;
    expect(kms.decryptData(T1, s1.value)).toBe("sk-ai");
    expect(kms.decryptData(T2, s2.value)).toBe("smtp-2");
    expect(() => kms.decryptData(T2, s1.value)).toThrow();
    expect(s3.value).toBe("dark");
    expect(s4.value).toBe(s4Before);
    expect(s5.value).toBe("");
    expect(s6.value).toBe("-----BEGIN CERTIFICATE-----MIIC");
  });

  it("is idempotent — a second run changes nothing", async () => {
    const qi = fakeQueryInterface({ tenants: seedTenants(), settings: seedSettings() });
    await migration.up({ context: qi });
    const after = JSON.stringify(qi.state);

    await migration.up({ context: qi });

    expect(JSON.stringify(qi.state)).toBe(after);
  });

  it("does nothing on a database without either table", async () => {
    const qi = fakeQueryInterface({ tenants: [], settings: [], tables: [{ tableName: "users" }] });

    await migration.up({ context: qi });

    expect(qi.sequelize.query).not.toHaveBeenCalled();
  });

  it("accepts the context wrapped as { queryInterface }", async () => {
    const qi = fakeQueryInterface({ tenants: seedTenants(), settings: [], tables: ["tenants"] });

    await migration.up({ context: { queryInterface: qi } });

    expect(qi.state.tenants[0].settings).toEqual({ theme: "dark", enable_iot: true });
  });

  it("fails loudly — not recorded as applied — when a tenant row changed underneath it", async () => {
    const qi = fakeQueryInterface({
      tenants: seedTenants(),
      settings: [],
      interfere: (state, r) => {
        if (r.id === T1) {
          state.tenants[0].settings = { ...state.tenants[0].settings, added: 1 };
        }
      },
    });

    await expect(migration.up({ context: qi })).rejects.toThrow(/tenant row\(s\) not scrubbed: 1111/);
  });

  it("fails loudly when a secret setting could not be encrypted", async () => {
    const qi = fakeQueryInterface({ tenants: [], settings: seedSettings() });
    const realQuery = qi.sequelize.query;
    qi.sequelize.query = jest.fn(async (sql, opts) => {
      if (norm(sql).startsWith("UPDATE tenant_settings")) {
        return [[], { rowCount: 0 }];
      }
      return realQuery(sql, opts);
    });

    await expect(migration.up({ context: qi })).rejects.toThrow(/secret setting\(s\) not encrypted: s1, s2/);
  });

  it("the verification refuses a tenants row that still holds a secret", async () => {
    const qi = fakeQueryInterface({ tenants: seedTenants(), settings: [] });
    const realQuery = qi.sequelize.query;
    qi.sequelize.query = jest.fn(async (sql, opts) => {
      // An UPDATE that reports success but writes nothing.
      if (norm(sql).startsWith("UPDATE tenants")) {
        return [[], { rowCount: 1 }];
      }
      return realQuery(sql, opts);
    });

    await expect(migration.up({ context: qi })).rejects.toThrow(
      /2 tenant row\(s\) still hold a secret in settings/,
    );
  });

  it("the verification refuses a plaintext secret left in tenant_settings", async () => {
    const qi = fakeQueryInterface({ tenants: [], settings: seedSettings() });
    const realQuery = qi.sequelize.query;
    qi.sequelize.query = jest.fn(async (sql, opts) => {
      if (norm(sql).startsWith("UPDATE tenant_settings")) {
        return [[], { rowCount: 1 }];
      }
      return realQuery(sql, opts);
    });

    await expect(migration.up({ context: qi })).rejects.toThrow(
      /2 secret setting\(s\) remain in plaintext/,
    );
  });

  it("an UPDATE with no result metadata counts as a failure", async () => {
    const qi = fakeQueryInterface({ tenants: seedTenants(), settings: seedSettings() });
    const realQuery = qi.sequelize.query;
    qi.sequelize.query = jest.fn(async (sql, opts) =>
      norm(sql).startsWith("UPDATE") ? [[], undefined] : realQuery(sql, opts),
    );

    await expect(migration.up({ context: qi })).rejects.toThrow(/not scrubbed/);
  });

  it("down never puts a secret back", async () => {
    await expect(migration.down({ context: {} })).resolves.toBeUndefined();
  });
});

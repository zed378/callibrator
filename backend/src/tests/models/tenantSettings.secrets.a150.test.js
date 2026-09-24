/**
 * A-150 — which tenant settings are encrypted at rest.
 *
 * Drives the REAL TenantSettings model definition (its beforeSave / afterFind
 * hooks) on a Sequelize instance with no connection; only the hooks run.
 * `ai_api_key` was not on the model's list, so the tenant's AI vendor key sat
 * in `tenant_settings` in plaintext.
 *
 * The keys are written out by hand — they are the claim, not a copy of
 * constants/tenantSecretSettings.js.
 */
const { Sequelize, DataTypes } = require("sequelize");
const defineTenantSettings = require("../../models/tenantSettings.model");
const kms = require("../../services/kms.service");
const {
  isSecretSettingKey,
  isRedactedSettingKey,
} = require("../../constants/tenantSecretSettings");

const TENANT = "11111111-1111-4111-8111-111111111111";

const db = new Sequelize("postgres://u:p@127.0.0.1:5432/none", {
  dialect: "postgres",
  logging: false,
});
const TenantSettings = defineTenantSettings(db, DataTypes);

const saveHooks = async (key, value) => {
  const row = TenantSettings.build({ tenantId: TENANT, key, value });
  await TenantSettings.runHooks("beforeSave", row, {});
  return row;
};

const ENCRYPTED = [
  "oidc_client_secret",
  "stripe_secret_key",
  "webhook_signing_secret",
  "storage_credentials",
  "ai_api_key",
  "smtp_password",
  "smtpPassword",
  "apiKey",
  "x_api_key",
  "access_token",
  "refreshToken",
  "private_key",
  "aws_access_key_id",
  "ldap_bind_credentials",
  "db_passwd",
  "tls_passphrase",
];
const PLAINTEXT = [
  "theme",
  // A-178: the IdP's public certificate.
  "sso_idp_cert",
  "sso_enabled",
  "sso_idp_entry_point",
  "oidc_client_id",
  "ai_base_url",
  "ai_vendor",
  "storage_config",
  "legal_hold_enabled",
  "retention_policy_notifications",
  "feature_flag_enable_mfa",
  "lifecycle_status",
  "ip_allowlist",
  "geofence",
];

describe("A-150 — the tenant settings encrypted at rest", () => {
  it.each(ENCRYPTED)("%s is envelope-encrypted on save and decrypted on read", async (key) => {
    const row = await saveHooks(key, "plain-secret");

    expect(row.value.startsWith("v2:")).toBe(true); // P6-10: v2 names its master key
    expect(kms.decryptData(TENANT, row.value)).toBe("plain-secret");

    await TenantSettings.runHooks("afterFind", [row], {});
    expect(row.value).toBe("plain-secret");
  });

  it.each(PLAINTEXT)("%s is stored as given", async (key) => {
    const row = await saveHooks(key, "value");

    expect(row.value).toBe("value");
    expect(isRedactedSettingKey(key)).toBe(false);
  });

  it("an OIDC relying-party record is redacted but not encrypted", () => {
    const key = "oidc_rp_22222222-2222-4222-8222-222222222222";

    expect(isSecretSettingKey(key)).toBe(false);
    expect(isRedactedSettingKey(key)).toBe(true);
  });

  it("a non-string key is neither secret nor redacted", () => {
    expect(isSecretSettingKey(undefined)).toBe(false);
    expect(isRedactedSettingKey(42)).toBe(false);
  });

  it("an existing envelope is not encrypted twice", async () => {
    const envelope = kms.encryptData(TENANT, "x");
    const row = await saveHooks("ai_api_key", envelope);

    expect(row.value).toBe(envelope);
  });
});

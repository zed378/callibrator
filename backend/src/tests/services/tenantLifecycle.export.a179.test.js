/**
 * A-179 (a) — the tenant-lifecycle export returned credentials.
 *
 * `exportTenantData` (GET /tenant-lifecycle/:tenantId/export, and the body of
 * every offboarding response) was `User.findAll({ where: { tenantId } })`
 * whole, then `toJSON()`: every account's password hash, TOTP secret (live and
 * pending), recovery-code hashes, WebAuthn credential id and public key, OTP
 * hash and lockout state. The TenantSettings rows went out as the model's
 * `afterFind` hook left them — DECRYPTED (`storage_credentials`, `ai_api_key`,
 * `oidc_client_secret`, ...) — and the tenant row carried its `settings`
 * JSONB, which can mirror the same plaintext.
 *
 * Measured, not assumed — the A-139 harness: the REAL models barrel on an
 * UNCONNECTED PostgreSQL-dialect Sequelize, whose `query` plays the database.
 * It answers a SELECT with ONLY the columns that SELECT names, from a stored
 * row in which EVERY users column (enumerated from the real model) holds a
 * value. Selecting a secret column therefore puts the secret in the export,
 * exactly as PostgreSQL would. The KMS is faked so a stored `v1:` value
 * "decrypts" to a known plaintext the export must not carry.
 *
 * The forbidden attributes are written out by hand: they are the claim, not
 * something derived from the service's own allow-list (CLAUDE.md § Evidence).
 */

const mockDb = { rows: {}, statements: [] };

jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual("sequelize");
  const db = new Sequelize({ dialect: "postgres", logging: false });
  db.query = async (sql, options = {}) => {
    const text = typeof sql === "string" ? sql : sql.query;
    mockDb.statements.push(text);
    const table = (text.match(/FROM "([a-z_]+)"/) || [])[1];
    const stored = mockDb.rows[table];
    if (!/^SELECT /i.test(text) || !stored || !options.model) {
      return options.plain ? null : [];
    }
    const selectList = text.slice("SELECT ".length, text.indexOf(" FROM "));
    const picked = stored.map((row) => {
      if (selectList.trim() === "*") {
        return { ...row };
      }
      const out = {};
      const re = /"([a-z_]+)"(?: AS "([A-Za-z_]+)")?/g;
      let m;
      while ((m = re.exec(selectList)) !== null) {
        const column = m[1];
        const attribute = m[2] || m[1];
        if (Object.prototype.hasOwnProperty.call(row, column)) {
          out[attribute] = row[column];
        }
      }
      return out;
    });
    const built = options.model.bulkBuild(picked, { raw: true, isNewRecord: false });
    // Model.findAll runs the afterFind hooks itself — the TenantSettings
    // decryption hook included — on what this returns.
    return options.plain ? built[0] || null : built;
  };
  return { db };
});
jest.mock("../../services/kms.service", () => ({
  encryptData: jest.fn((_tenantId, value) => `v1:${value}`),
  decryptData: jest.fn((_tenantId, value) => value.replace(/^v1:ENC-/, "")),
  isEnvelope: (value) => typeof value === "string" && /^v[12]:/.test(value),
}));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn() }));

const models = require("../../models");
const { tenantStorage } = require("../../middlewares/tenantContext.middleware");
const tenantLifecycle = require("../../services/tenantLifecycle.service");

const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "33333333-3333-4333-8333-333333333333";

const asSuperAdmin = (fn) => tenantStorage.run({ tenantId: TENANT, isSuperAdmin: true }, fn);

/**
 * Attributes no tenant export may ever carry: credentials, second factors,
 * one-time codes and lockout state. Hand-written (see the header).
 */
const FORBIDDEN_USER_ATTRIBUTES = [
  "password",
  "mfaSecret",
  "mfaPendingSecret",
  "mfaPendingCreatedAt",
  "mfaLastUsedStep",
  "mfaRecoveryCodes",
  "webauthnCredentialId",
  "webauthnPublicKey",
  "webauthnSignCount",
  "otpCode",
  "otpExpiredAt",
  "otpRequestCount",
  "otpLastRequestedAt",
  "failedLoginAttempts",
  "lockedUntil",
  "passwordChangedAt",
];

/** A name that says "this is a secret or authentication state". */
const SECRET_SHAPED = /secret|password|passwd|otp|mfa|webauthn|token|credential|recovery|hash|locked|failed/i;

/** Plaintext values a leak would carry. Each must be absent from the export. */
const SECRETS = {
  password: "$2a$12$HASH-OF-THE-REAL-PASSWORD",
  mfaSecret: "TOTP-SEED-JBSWY3DPEHPK3PXP",
  mfaPendingSecret: "PENDING-TOTP-SEED-KRSXG5CTMVRXEZLU",
  webauthnCredentialId: "WEBAUTHN-CREDENTIAL-ID-abc123",
  webauthnPublicKey: "WEBAUTHN-PUBLIC-KEY-pQECAyYgASFYIA",
  otpCode: "OTP-HASH-918273",
  recoveryCode: "RECOVERY-CODE-HASH-5e884898da2804",
  s3Secret: "S3-SECRET-ACCESS-KEY-wJalrXUtnFEMI",
  aiKey: "sk-live-AI-API-KEY-0000",
  smtpPassword: "SMTP-PASSWORD-hunter2",
  oidcRp: "OIDC-RP-SECRET-SHA256-deadbeef",
  mirroredAiKey: "sk-live-MIRRORED-IN-TENANTS-SETTINGS",
};

/** A users row with EVERY column of the REAL model holding a value. */
const fullUserRow = () => {
  const row = {};
  for (const attribute of Object.values(models.User.rawAttributes)) {
    const key = attribute.type.key;
    row[attribute.field] =
      key === "BOOLEAN" ? true
        : key === "INTEGER" ? 7
          : key === "DATE" ? new Date("2026-09-01T00:00:00Z")
            : key === "UUID" ? USER
              : `value-of-${attribute.fieldName}`;
  }
  Object.assign(row, {
    id: USER,
    tenant_id: TENANT,
    role_id: null,
    username: "nurse.jane",
    email: "jane@hospital.test",
    password: SECRETS.password,
    mfa_secret: SECRETS.mfaSecret,
    mfa_pending_secret: SECRETS.mfaPendingSecret,
    webauthn_credential_id: SECRETS.webauthnCredentialId,
    webauthn_public_key: SECRETS.webauthnPublicKey,
    otp_code: SECRETS.otpCode,
    mfa_recovery_codes: [SECRETS.recoveryCode],
    is_deleted: false,
    deleted_at: null,
  });
  return row;
};

const settingRow = (key, value) => ({
  id: `${key}-id`,
  tenant_id: TENANT,
  key,
  value,
  created_at: new Date("2026-09-01T00:00:00Z"),
  updated_at: new Date("2026-09-01T00:00:00Z"),
});

const tenantRow = () => ({
  id: TENANT,
  name: "Hospital A",
  subdomain: "hospital-a",
  email: "it@hospital-a.test",
  plan: "enterprise",
  status: "active",
  is_deleted: false,
  deleted_at: null,
  settings: { ai_api_key: SECRETS.mirroredAiKey, theme: "dark" },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.statements = [];
  mockDb.rows = {
    users: [fullUserRow()],
    tenants: [tenantRow()],
    tenant_settings: [
      // Encrypted at rest; the afterFind hook decrypts them.
      settingRow("storage_credentials", `v1:ENC-${SECRETS.s3Secret}`),
      settingRow("ai_api_key", `v1:ENC-${SECRETS.aiKey}`),
      // Secret by NAME (SECRET_KEY_PATTERN), stored in plaintext.
      settingRow("smtp_password", SECRETS.smtpPassword),
      // Redacted, not encrypted: an OIDC relying party's secret hash.
      settingRow("oidc_rp_portal", SECRETS.oidcRp),
      settingRow("lifecycle_status", "ACTIVE"),
      settingRow("webhook_signing_secret", ""),
    ],
  };
});

const exportIt = () => asSuperAdmin(() => tenantLifecycle.exportTenantData(TENANT));

describe("A-179 — the tenant-lifecycle export carries no credential", () => {
  it("no secret VALUE appears anywhere in the export, under any key", async () => {
    const result = await exportIt();
    const all = JSON.stringify(result);

    for (const [name, value] of Object.entries(SECRETS)) {
      expect({ name, leaked: all.includes(value) }).toEqual({ name, leaked: false });
    }
  });

  it("no forbidden attribute is a key of an exported user; the account is still identified", async () => {
    const { users } = await exportIt();

    expect(users).toHaveLength(1);
    const keys = Object.keys(users[0]);
    for (const attribute of FORBIDDEN_USER_ATTRIBUTES) {
      expect({ attribute, exported: keys.includes(attribute) }).toEqual({ attribute, exported: false });
    }
    expect(users[0]).toEqual(
      expect.objectContaining({ id: USER, username: "nurse.jane", email: "jane@hospital.test" }),
    );
  });

  it("the users SELECT names no credential column — the database is never asked for one", async () => {
    await exportIt();

    const usersSelect = mockDb.statements.find((s) => /^SELECT .* FROM "users"/.test(s));
    const selectList = usersSelect.slice(0, usersSelect.indexOf(" FROM "));
    for (const attribute of FORBIDDEN_USER_ATTRIBUTES) {
      const column = models.User.rawAttributes[attribute].field;
      expect({ column, selected: selectList.includes(`"${column}"`) }).toEqual({
        column,
        selected: false,
      });
    }
  });

  it("a secret setting keeps its key and reads [REDACTED]; an ordinary one and an empty secret are unchanged", async () => {
    const { settings } = await exportIt();
    const byKey = Object.fromEntries(settings.map((s) => [s.key, s.value]));

    expect(byKey).toEqual({
      storage_credentials: "[REDACTED]",
      ai_api_key: "[REDACTED]",
      smtp_password: "[REDACTED]",
      oidc_rp_portal: "[REDACTED]",
      lifecycle_status: "ACTIVE",
      webhook_signing_secret: "",
    });
  });

  it("the tenant row's settings JSONB loses its credential keys and keeps the rest", async () => {
    const { tenant } = await exportIt();

    expect(tenant.id).toBe(TENANT);
    expect(tenant.settings).toEqual({ theme: "dark" });
  });

  it("the offboarding response carries the same redacted export", async () => {
    const saved = jest.spyOn(models.Tenant.prototype, "save").mockResolvedValue(undefined);
    jest.spyOn(models.TenantSettings, "upsert").mockResolvedValue(undefined);
    const { db } = require("../../config");
    jest.spyOn(db, "transaction").mockImplementation(async (cb) => cb({ id: "tx" }));

    const { exportData } = await asSuperAdmin(() => tenantLifecycle.offboardTenant(TENANT));

    const all = JSON.stringify(exportData);
    for (const [name, value] of Object.entries(SECRETS)) {
      expect({ name, leaked: all.includes(value) }).toEqual({ name, leaked: false });
    }
    expect(saved).toHaveBeenCalled();
  });
});

describe("A-179 — the allow-list is checked against the REAL User model", () => {
  it("every forbidden attribute is a real users attribute, so the list above cannot silently go stale", () => {
    for (const attribute of FORBIDDEN_USER_ATTRIBUTES) {
      expect({ attribute, isAttribute: attribute in models.User.rawAttributes }).toEqual({
        attribute,
        isAttribute: true,
      });
    }
  });

  it("no users attribute whose name says secret or authentication state is on the allow-list", () => {
    const allowed = tenantLifecycle.EXPORTED_USER_ATTRIBUTES;
    // Driven by the MODEL, not by the allow-list: a column added tomorrow is
    // checked the day it appears.
    const secretShaped = Object.keys(models.User.rawAttributes).filter((a) => SECRET_SHAPED.test(a));
    expect(secretShaped).toEqual(
      expect.arrayContaining(["password", "mfaSecret", "mfaRecoveryCodes", "otpCode", "webauthnPublicKey"]),
    );
    for (const attribute of secretShaped) {
      expect({ attribute, allowed: allowed.includes(attribute) }).toEqual({ attribute, allowed: false });
    }
    // Every allowed name is a real attribute — a typo would silently export nothing.
    for (const attribute of allowed) {
      expect({ attribute, isAttribute: attribute in models.User.rawAttributes }).toEqual({
        attribute,
        isAttribute: true,
      });
    }
  });
});

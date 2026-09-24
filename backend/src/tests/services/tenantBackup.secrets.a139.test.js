/**
 * A-139 — tenant backup archives carried second-factor secrets.
 *
 * `exportTenantData` selected the users with `attributes: { exclude:
 * ["password", ...] }` — a DENY-list. Every other column went into the archive:
 * `mfaSecret` (the TOTP seed), `mfaPendingSecret`, `otpCode`,
 * `webauthnPublicKey` / `webauthnCredentialId`, and the lockout counters. And
 * the tenant row went in whole, `settings` included — a JSONB column that
 * `tenant.service#updateTenantSettings` fills from `TenantSettings.findAll`,
 * whose `afterFind` hook has already DECRYPTED the KMS-protected keys
 * (`storage_credentials`, `oidc_client_secret`, ...). A backup is a file an
 * administrator downloads; the archive was a portable copy of every account's
 * second factor and the tenant's cloud credentials.
 *
 * The export is now built from explicit ALLOW-lists. A column added to the
 * model tomorrow is excluded until someone decides it belongs in a backup.
 *
 * Measured, not assumed. The REAL models barrel on an UNCONNECTED
 * PostgreSQL-dialect Sequelize (the technique of includes.a90.test.js), whose
 * `query` plays the database: it answers a SELECT with ONLY the columns that
 * SELECT names, from a stored row in which every column holds a value. So:
 *   - selecting a secret column puts the secret in the archive, exactly as
 *     PostgreSQL would;
 *   - the archive is the real JSZip file createBackup writes, read back.
 *
 * The forbidden columns below are written out by hand. They are the claim, not
 * something derived from the service's own list (CLAUDE.md § Evidence).
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
    // Answer with the SELECTed columns only, keyed by attribute, as the
    // database driver would: `"first_name" AS "firstName"` -> firstName.
    const selectList = text.slice("SELECT ".length, text.indexOf(" FROM "));
    const picked = stored.map((row) => {
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
    return options.plain ? built[0] || null : built;
  };
  return { db };
});
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn() }));

const fs = require("fs");
const { Readable } = require("stream");
const JSZip = require("jszip");
const models = require("../../models");
const { tenantStorage } = require("../../middlewares/tenantContext.middleware");
const tenantBackupService = require("../../services/tenantBackup.service");

const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "33333333-3333-4333-8333-333333333333";
const BACKUP = "22222222-2222-4222-8222-222222222222";

const asTenant = (fn) => tenantStorage.run({ tenantId: TENANT }, fn);

/**
 * Columns no backup may ever carry: credentials, second factors, one-time
 * codes and lockout state. Hand-written (see the header).
 */
const FORBIDDEN_USER_ATTRIBUTES = [
  "password",
  "mfaSecret",
  "mfaPendingSecret",
  "mfaPendingCreatedAt",
  "mfaLastUsedStep",
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

/** Plaintext values a leak would carry. Each must be absent from the archive. */
const SECRETS = {
  password: "$2a$12$HASH-OF-THE-REAL-PASSWORD",
  mfaSecret: "TOTP-SEED-JBSWY3DPEHPK3PXP",
  mfaPendingSecret: "PENDING-TOTP-SEED-KRSXG5CTMVRXEZLU",
  webauthnCredentialId: "WEBAUTHN-CREDENTIAL-ID-abc123",
  webauthnPublicKey: "WEBAUTHN-PUBLIC-KEY-pQECAyYgASFYIA",
  otpCode: "OTP-HASH-918273",
  s3Secret: "S3-SECRET-ACCESS-KEY-wJalrXUtnFEMI",
  aiKey: "sk-live-AI-API-KEY-0000",
};

/** A users row with EVERY column holding a value — the worst case the export must survive. */
const fullUserRow = () => {
  const row = {};
  for (const attribute of Object.values(models.Users.rawAttributes)) {
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
    is_deleted: false,
    deleted_at: null,
  });
  return row;
};

const tenantRow = () => ({
  id: TENANT,
  name: "Hospital A",
  subdomain: "hospital-a",
  email: "it@hospital-a.test",
  plan: "enterprise",
  status: "active",
  is_deleted: false,
  deleted_at: null,
  // What updateTenantSettings mirrors into the column: values read through
  // TenantSettings' decrypting afterFind hook.
  settings: {
    storage_credentials: JSON.stringify({ accessKeyId: "AKIA", secretAccessKey: SECRETS.s3Secret }),
    ai_api_key: SECRETS.aiKey,
    theme: "dark",
  },
});

/** Run createBackup for real and return the parsed archive the service wrote. */
const takeBackup = async () => {
  let written = null;
  jest.spyOn(models.TenantBackup, "createBackup").mockResolvedValue({ id: BACKUP });
  jest.spyOn(models.TenantBackup, "updateStatus").mockResolvedValue(undefined);
  jest.spyOn(models.TenantBackup, "findByPk").mockResolvedValue({ id: BACKUP });
  jest.spyOn(fs, "existsSync").mockReturnValue(true);
  jest.spyOn(fs, "writeFileSync").mockImplementation((_path, buffer) => {
    written = buffer;
  });
  jest
    .spyOn(fs, "createReadStream")
    .mockImplementation(() => Readable.from([Buffer.from("zip")]));

  const result = await asTenant(() =>
    tenantBackupService.createBackup({
      tenantId: TENANT,
      createdById: USER,
      name: "nightly",
      backupType: models.TenantBackup.BACKUP_TYPES.FULL,
      models,
    }),
  );
  expect(result.status).toBe(201);

  const zip = await JSZip.loadAsync(written);
  const texts = {};
  for (const name of Object.keys(zip.files)) {
    texts[name] = await zip.files[name].async("string");
  }
  return texts;
};

beforeEach(() => {
  jest.restoreAllMocks();
  mockDb.statements = [];
  mockDb.rows = { users: [fullUserRow()], tenants: [tenantRow()] };
});

describe("A-139 — the tenant backup export is an allow-list", () => {
  it("a tenant backup archive contains no second-factor or credential field", async () => {
    const texts = await takeBackup();
    const all = Object.values(texts).join("\n");

    // No secret VALUE anywhere in the archive, under any key.
    for (const [name, value] of Object.entries(SECRETS)) {
      expect({ name, leaked: all.includes(value) }).toEqual({ name, leaked: false });
    }

    const data = JSON.parse(texts["tenant_data_full.json"]);
    expect(data.users).toHaveLength(1);
    const exportedKeys = Object.keys(data.users[0]);
    for (const attribute of FORBIDDEN_USER_ATTRIBUTES) {
      expect({ attribute, exported: exportedKeys.includes(attribute) }).toEqual({
        attribute,
        exported: false,
      });
    }
    // The archive still identifies the account, which is what a restore
    // matches on.
    expect(data.users[0]).toEqual(
      expect.objectContaining({ id: USER, username: "nurse.jane", email: "jane@hospital.test" }),
    );

    // The tenant section carries no settings: neither the mirrored plaintext
    // nor a KMS blob. A restore reads only `tenant.id`.
    expect(data.tenant).not.toHaveProperty("settings");
    expect(data.tenant.id).toBe(TENANT);
  });

  it("the users SELECT names no credential column (the database is never asked for one)", async () => {
    await takeBackup();

    const usersSelect = mockDb.statements.find((s) => /^SELECT .* FROM "users"/.test(s));
    const selectList = usersSelect.slice(0, usersSelect.indexOf(" FROM "));
    for (const attribute of FORBIDDEN_USER_ATTRIBUTES) {
      const column = models.Users.rawAttributes[attribute].field;
      expect({ column, selected: selectList.includes(`"${column}"`) }).toEqual({
        column,
        selected: false,
      });
    }
  });

  it("every forbidden attribute is a real users column, so the list above cannot silently go stale", () => {
    // A renamed column would otherwise leave this test asserting the absence
    // of something that no longer exists.
    for (const attribute of FORBIDDEN_USER_ATTRIBUTES) {
      expect({ attribute, isColumn: attribute in models.Users.rawAttributes }).toEqual({
        attribute,
        isColumn: true,
      });
    }
  });

  it("no users column whose name says secret or authentication state is on the export allow-list", () => {
    const allowed = tenantBackupService.USER_EXPORT_ATTRIBUTES;
    // Driven by the MODEL, not by the allow-list: a column added tomorrow
    // (`recoveryCodes`, `apiTokenHash`) is checked the day it appears.
    const secretShaped = Object.keys(models.Users.rawAttributes).filter((a) => SECRET_SHAPED.test(a));
    expect(secretShaped).toEqual(expect.arrayContaining(["mfaSecret", "otpCode", "webauthnPublicKey"]));
    for (const attribute of secretShaped) {
      expect({ attribute, allowed: allowed.includes(attribute) }).toEqual({ attribute, allowed: false });
    }
    // And every allowed name is a column — a typo would silently export nothing.
    for (const attribute of allowed) {
      expect({ attribute, isColumn: attribute in models.Users.rawAttributes }).toEqual({
        attribute,
        isColumn: true,
      });
    }
  });

  it("the tenant export allow-list excludes settings and names only real tenant columns", () => {
    const allowed = tenantBackupService.TENANT_EXPORT_ATTRIBUTES;
    expect(allowed).not.toContain("settings");
    for (const attribute of allowed) {
      expect({ attribute, isColumn: attribute in models.Tenant.rawAttributes }).toEqual({
        attribute,
        isColumn: true,
      });
    }
  });
});

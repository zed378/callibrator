/**
 * A-177 — the TenantSettings encryption ran only on INSTANCE saves.
 *
 * `beforeSave` does not fire for the static paths, so `TenantSettings.upsert`,
 * `TenantSettings.bulkCreate` and `TenantSettings.update` each wrote a secret
 * key's value to `tenant_settings` in plaintext.
 *
 * These drive the REAL model definition through REAL Sequelize static methods
 * — build, validate, hooks, value snapshot — on an instance with no
 * connection. Only the last step, the QueryInterface call that would send SQL,
 * is replaced by a spy that records exactly what would have been written.
 * (Migration evidence against PostgreSQL 18 is in the A-177 card.)
 *
 * A-178 — `sso_idp_cert` is the IdP's public certificate: stored as given,
 * and an envelope written before the reclassification still reads back.
 *
 * The secret keys are written out by hand.
 */
import { DataTypes, Op, Sequelize } from "sequelize";
import defineTenantSettings from "../../models/tenantSettings.model";
import type KmsService from "../../services/kms.service";
import type { TenantId } from "../../types/ids";

// eslint-disable-next-line @typescript-eslint/no-require-imports -- the real envelope code
const kms = require("../../services/kms.service") as typeof KmsService;

const T1 = "11111111-1111-4111-8111-111111111111" as TenantId;
const T2 = "22222222-2222-4222-8222-222222222222" as TenantId;

const db = new Sequelize("postgres://u:p@127.0.0.1:5432/none", {
  dialect: "postgres",
  logging: false,
});
const TenantSettings = defineTenantSettings(db, DataTypes);
const qi = db.getQueryInterface();

const isEnvelopeOf = (tenantId: string, value: unknown, plain: string): boolean =>
  typeof value === "string" && value.startsWith("v2:") && kms.decryptData(tenantId, value) === plain;

interface ModelWithRunHooks {
  runHooks(hook: string, target: unknown, options: object): Promise<void>;
}

const runModelHooks = (target: unknown, hook: string, options: object = {}): Promise<void> =>
  (TenantSettings as unknown as ModelWithRunHooks).runHooks(hook, target, options);

let upsertSpy: jest.SpyInstance;
let bulkInsertSpy: jest.SpyInstance;
let bulkUpdateSpy: jest.SpyInstance;

beforeEach(() => {
  upsertSpy = jest.spyOn(qi, "upsert").mockResolvedValue([{}, true] as never);
  bulkInsertSpy = jest.spyOn(qi, "bulkInsert").mockResolvedValue([] as never);
  bulkUpdateSpy = jest.spyOn(qi, "bulkUpdate").mockResolvedValue(1 as never);
});

describe("A-177 — TenantSettings.upsert", () => {
  it("encrypts a secret key in both the INSERT and the ON CONFLICT UPDATE values", async () => {
    await TenantSettings.upsert({ tenantId: T1, key: "ai_api_key", value: "sk-plain" });

    expect(upsertSpy).toHaveBeenCalledTimes(1);
    const call0 = upsertSpy.mock.calls[0] as [unknown, { value: string }, { value: string }];
    const [, insertValues, updateValues] = call0;
    expect(isEnvelopeOf(T1, insertValues.value, "sk-plain")).toBe(true);
    expect(updateValues.value).toBe(insertValues.value);
    expect(JSON.stringify(upsertSpy.mock.calls)).not.toContain("sk-plain");
  });

  it("encrypts a key that is secret only by name (smtpPassword)", async () => {
    await TenantSettings.upsert({ tenantId: T2, key: "smtpPassword", value: "pw" });

    const call0 = upsertSpy.mock.calls[0] as [unknown, { value: string }];
    expect(isEnvelopeOf(T2, call0[1].value, "pw")).toBe(true);
  });

  it("writes a non-secret key as given (legal hold, storage config)", async () => {
    await TenantSettings.upsert({ tenantId: T1, key: "legal_hold_enabled", value: "true" });
    await TenantSettings.upsert({ tenantId: T1, key: "storage_config", value: '{"provider":"s3"}' });

    const call0 = upsertSpy.mock.calls[0] as [unknown, { value: string }];
    const call1 = upsertSpy.mock.calls[1] as [unknown, { value: string }];
    expect(call0[1].value).toBe("true");
    expect(call1[1].value).toBe('{"provider":"s3"}');
  });

  it("does not encrypt an existing envelope twice", async () => {
    const envelope = kms.encryptData(T1, "sk");

    await TenantSettings.upsert({ tenantId: T1, key: "ai_api_key", value: envelope });

    const call0 = upsertSpy.mock.calls[0] as [unknown, { value: string }];
    expect(call0[1].value).toBe(envelope);
  });

  it("with validate:false (the encrypting hook skipped) refuses rather than write plaintext", async () => {
    await expect(
      TenantSettings.upsert({ tenantId: T1, key: "oidc_client_secret", value: "s" }, { validate: false }),
    ).rejects.toThrow(/refusing to upsert "oidc_client_secret" in plaintext/);

    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it("with validate:false a non-secret key, or an empty secret, still upserts", async () => {
    await TenantSettings.upsert({ tenantId: T1, key: "geofence", value: "{}" }, { validate: false });
    await TenantSettings.upsert({ tenantId: T1, key: "ai_api_key", value: "" }, { validate: false });

    expect(upsertSpy).toHaveBeenCalledTimes(2);
  });

  it("a secret with no tenant id is refused (the envelope binds the tenant)", async () => {
    const invalidRow: unknown = { key: "ai_api_key", value: "sk" };
    await expect(TenantSettings.upsert(invalidRow as never)).rejects.toThrow(
      /needs its tenantId/,
    );

    expect(upsertSpy).not.toHaveBeenCalled();
  });
});

describe("A-177 — TenantSettings.bulkCreate", () => {
  it("encrypts each secret row under its own tenant and leaves the rest as given", async () => {
    await TenantSettings.bulkCreate([
      { tenantId: T1, key: "stripe_secret_key", value: "sk_live" },
      { tenantId: T2, key: "ai_api_key", value: "sk-ai" },
      { tenantId: T1, key: "feature_flag_enable_mfa", value: "true" },
    ]);

    expect(bulkInsertSpy).toHaveBeenCalledTimes(1);
    const call0 = bulkInsertSpy.mock.calls[0] as [unknown, { value: string }[]];
    const rows = call0[1];
    expect(isEnvelopeOf(T1, rows[0]?.value, "sk_live")).toBe(true);
    expect(isEnvelopeOf(T2, rows[1]?.value, "sk-ai")).toBe(true);
    expect(rows[2]?.value).toBe("true");
  });

  it("a secret row with no tenant id refuses the whole batch", async () => {
    const invalidBatch: unknown = [{ key: "ai_api_key", value: "sk" }];
    await expect(
      TenantSettings.bulkCreate(invalidBatch as never),
    ).rejects.toThrow(/needs its tenantId/);

    expect(bulkInsertSpy).not.toHaveBeenCalled();
  });
});

describe("A-177 — TenantSettings.update (static, bulk)", () => {
  it("encrypts a secret value under the tenant the where names", async () => {
    const where: unknown = { tenantId: T1, key: "oidc_client_secret" };
    await TenantSettings.update(
      { value: "new-secret" },
      { where: where as never },
    );

    expect(bulkUpdateSpy).toHaveBeenCalledTimes(1);
    const call0 = bulkUpdateSpy.mock.calls[0] as [unknown, { value: string }];
    const values = call0[1];
    expect(isEnvelopeOf(T1, values.value, "new-secret")).toBe(true);
  });

  it("encrypts when the where names several secret keys of one tenant", async () => {
    const where: unknown = { tenantId: T2, key: ["smtp_password", "ai_api_key"] };
    await TenantSettings.update(
      { value: "same" },
      { where: where as never },
    );

    const call0 = bulkUpdateSpy.mock.calls[0] as [unknown, { value: string }];
    expect(isEnvelopeOf(T2, call0[1].value, "same")).toBe(true);
  });

  it("encrypts when the update itself renames the row to a secret key", async () => {
    const where: unknown = { tenantId: T1, key: "ai_vendor" };
    await TenantSettings.update(
      { key: "ai_api_key", value: "sk" },
      { where: where as never },
    );

    const call0 = bulkUpdateSpy.mock.calls[0] as [unknown, { value: string }];
    expect(isEnvelopeOf(T1, call0[1].value, "sk")).toBe(true);
  });

  it("leaves a non-secret key as given (oidcProvider rewrites an oidc_rp_* record this way)", async () => {
    const record = '{"clientSecretHash":"h"}';
    const where: unknown = { tenantId: T1, key: "oidc_rp_33333333-3333-4333-8333-333333333333" };

    await TenantSettings.update(
      { value: record },
      { where: where as never },
    );

    const call0 = bulkUpdateSpy.mock.calls[0] as [unknown, { value: string }];
    expect(call0[1].value).toBe(record);
  });

  it("leaves an empty, null or already-enveloped value alone", async () => {
    const envelope = kms.encryptData(T1, "x");
    const where: unknown = { tenantId: T1, key: "ai_api_key" };

    await TenantSettings.update({ value: "" }, { where: where as never });
    const nullPayload: { value: string | null } = { value: null };
    await TenantSettings.update(nullPayload, { where: where as never });
    await TenantSettings.update({ value: envelope }, { where: where as never });

    const mappedValues = (bulkUpdateSpy.mock.calls as [unknown, { value: string | null }][]).map(
      (c) => c[1].value,
    );
    expect(mappedValues).toEqual(["", null, envelope]);
  });

  it.each([
    ["no key in the where", { tenantId: T1, id: "x" }],
    ["an operator on the key", { tenantId: T1, key: { [Op.like]: "ai_%" } }],
    ["an empty key list", { tenantId: T1, key: [] }],
    ["no single tenant", { key: "ai_api_key" }],
    ["an operator on the tenant", { tenantId: { [Op.in]: [T1, T2] }, key: "ai_api_key" }],
    ["a secret and a non-secret key together", { tenantId: T1, key: ["ai_api_key", "ai_vendor"] }],
  ])("refuses a plaintext value when the statement has %s", async (_name, where) => {
    const whereClause: unknown = where;
    await expect(TenantSettings.update({ value: "plain" }, { where: whereClause as never })).rejects.toThrow(
      /must name one tenantId and only secret keys/,
    );

    expect(bulkUpdateSpy).not.toHaveBeenCalled();
  });

  it("an instance save still encrypts, and its validation does not encrypt early", async () => {
    const row = TenantSettings.build({ tenantId: T1, key: "ai_api_key", value: "sk" });

    await runModelHooks(row, "beforeValidate", {});
    expect(row.value).toBe("sk");

    await runModelHooks(row, "beforeSave", {});
    expect(isEnvelopeOf(T1, row.value, "sk")).toBe(true);
  });
});

describe("A-178 — sso_idp_cert is a public certificate", () => {
  const CERT = "-----BEGIN CERTIFICATE-----MIICpublic-----END CERTIFICATE-----";

  it("is stored as given on every write path", async () => {
    const row = TenantSettings.build({ tenantId: T1, key: "sso_idp_cert", value: CERT });
    await runModelHooks(row, "beforeSave", {});
    await TenantSettings.upsert({ tenantId: T1, key: "sso_idp_cert", value: CERT });
    await TenantSettings.bulkCreate([{ tenantId: T1, key: "sso_idp_cert", value: CERT }]);
    const where: unknown = { tenantId: T1, key: "sso_idp_cert" };
    await TenantSettings.update({ value: CERT }, { where: where as never });

    expect(row.value).toBe(CERT);
    const upsertCall0 = upsertSpy.mock.calls[0] as [unknown, { value: string }];
    expect(upsertCall0[1].value).toBe(CERT);
    const bulkInsertCall0 = bulkInsertSpy.mock.calls[0] as [unknown, { value: string }[]];
    expect(bulkInsertCall0[1][0]?.value).toBe(CERT);
    const bulkUpdateCall0 = bulkUpdateSpy.mock.calls[0] as [unknown, { value: string }];
    expect(bulkUpdateCall0[1].value).toBe(CERT);
  });

  it("an envelope written before A-178 still reads back as the certificate", async () => {
    const legacy = TenantSettings.build({
      tenantId: T1,
      key: "sso_idp_cert",
      value: kms.encryptData(T1, CERT),
    });
    const plain = TenantSettings.build({ tenantId: T1, key: "sso_idp_cert", value: CERT });

    await runModelHooks([legacy, plain], "afterFind", {});

    expect(legacy.value).toBe(CERT);
    expect(plain.value).toBe(CERT);
  });

  it("a non-secret key holding text that merely starts with v1: is not decrypted", async () => {
    const row = TenantSettings.build({ tenantId: T1, key: "ai_vendor", value: "v1:custom" });

    await runModelHooks(row, "afterFind", {});

    expect(row.value).toBe("v1:custom");
  });
});

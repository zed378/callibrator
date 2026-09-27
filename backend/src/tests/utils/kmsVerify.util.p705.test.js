/**
 * P7-05 (ADR-078) — a database restored WITHOUT the KMS master key it was
 * written under must refuse the boot, not start cleanly and fail per request.
 *
 * REAL node crypto and a REAL kms.service key ring, loaded in isolation with
 * the environment each case describes (as kms.rotation.s08 does). The database
 * is an in-memory stand-in answering the three query shapes the verifier
 * issues; the same verifier ran against PostgreSQL 18 in the P7-04 drill
 * (MEMORY/records/2026-09-27-p7-04-restore-drill.md).
 */
const crypto = require("crypto");
const { keyIdOf } = require("../../utils/keyring.util");

const KEY_A = "a1".repeat(32);
const KEY_B = "b2".repeat(32);
const TENANT = "11111111-1111-4111-8111-111111111111";

/** Load kmsVerify (and the kms.service it requires) under this environment. */
const load = (env) => {
  const saved = { ...process.env };
  delete process.env.KMS_MASTER_KEY_PREVIOUS;
  delete process.env.KMS_VERIFY;
  Object.assign(process.env, env);
  let mod;
  try {
    jest.isolateModules(() => {
      mod = {
        verify: require("../../utils/kmsVerify.util"),
        kms: require("../../services/kms.service"),
      };
    });
  } finally {
    process.env = saved;
  }
  return mod;
};

/** A v1 envelope as kms.service wrote them before P6-10 — no key id. */
const legacyV1 = (masterHex, tenantId, plaintext) => {
  const dek = crypto.randomBytes(32);
  const dataIv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", dek, dataIv);
  c.setAAD(Buffer.from(tenantId));
  const data = Buffer.concat([c.update(Buffer.from(plaintext, "utf8")), c.final()]);
  const dataTag = c.getAuthTag();
  const dekIv = crypto.randomBytes(12);
  const w = crypto.createCipheriv("aes-256-gcm", Buffer.from(masterHex, "hex"), dekIv);
  const encDek = Buffer.concat([w.update(dek), w.final()]);
  const dekTag = w.getAuthTag();
  const b = (x) => x.toString("base64");
  return ["v1", b(encDek), b(dekIv), b(dekTag), b(data), b(dataIv), b(dataTag)].join(":");
};

/**
 * An in-memory database: `{ table: [{ id, tenant_id, value }] }`. Answers the
 * verifier's three statements the way PostgreSQL would.
 */
const fakeDb = (tables) => ({
  query: jest.fn(async (sql, opts) => {
    const table = /FROM (\w+)/.exec(sql)[1];
    const rows = tables[table] || [];
    if (sql.includes("split_part")) {
      const counts = new Map();
      for (const r of rows.filter((x) => typeof x.value === "string" && x.value.startsWith("v2:"))) {
        const id = r.value.split(":")[1];
        counts.set(id, (counts.get(id) || 0) + 1);
      }
      return [...counts].sort().map(([key_id, n]) => ({ key_id, n }));
    }
    if (sql.includes("COUNT(*)::int AS n, MIN(")) {
      const v1 = rows.filter((x) => typeof x.value === "string" && x.value.startsWith("v1:"));
      return [{ n: v1.length, id: v1.length ? v1.map((x) => x.id).sort()[0] : null }];
    }
    const hit = rows.find((x) => x.id === opts.replacements.id);
    return [{ id: hit.id, tenant_id: hit.tenant_id, value: hit.value }];
  }),
});

const logger = () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() });

describe("P7-05 — the boot refuses a database whose KMS master key is missing", () => {
  it("passes when every envelope is under the configured key (a restore with the right key)", async () => {
    const { verify, kms } = load({ KMS_MASTER_KEY: KEY_A });
    const db = fakeDb({
      tenant_settings: [{ id: "1", tenant_id: TENANT, value: kms.encryptData(TENANT, "sso-secret") }, { id: "2", tenant_id: TENANT, value: "plain, not a secret" }],
      webhooks: [{ id: "3", tenant_id: TENANT, value: kms.encryptData(TENANT, "whsec") }],
      tenant_keys: [{ id: "4", tenant_id: TENANT, value: kms.encryptData(TENANT, "-----BEGIN PRIVATE KEY-----") }],
    });
    const log = logger();
    const result = await verify.assertKmsKeysConfigured({ sequelize: db, logger: log });
    expect(result).toEqual({ problems: [], envelopes: 3 });
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining("[kms-verify] OK: 3 stored envelope(s)"));
  });

  it("an empty database passes (a fresh install has nothing to open)", async () => {
    const { verify } = load({ KMS_MASTER_KEY: KEY_A });
    const result = await verify.assertKmsKeysConfigured({ sequelize: fakeDb({}), logger: logger() });
    expect(result).toEqual({ problems: [], envelopes: 0 });
  });

  it("REFUSES a database written under another key, naming the table, the count and the missing key id", async () => {
    const writer = load({ KMS_MASTER_KEY: KEY_A }).kms;
    const { verify } = load({ KMS_MASTER_KEY: KEY_B }); // the restore got a NEW key
    const db = fakeDb({
      tenant_keys: [
        { id: "1", tenant_id: TENANT, value: writer.encryptData(TENANT, "pem-1") },
        { id: "2", tenant_id: TENANT, value: writer.encryptData(TENANT, "pem-2") },
      ],
    });
    const log = logger();
    const missing = keyIdOf(Buffer.from(KEY_A, "hex"));
    await expect(verify.assertKmsKeysConfigured({ sequelize: db, logger: log })).rejects.toThrow(
      `tenant_keys.private_key: 2 value(s) wrapped under KMS master key ${missing}, which is not configured`,
    );
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining("[kms-verify] UNREADABLE: tenant_keys.private_key"));
  });

  it("accepts the old key as KMS_MASTER_KEY_PREVIOUS (mid-rotation, or a restore of an older backup)", async () => {
    const writer = load({ KMS_MASTER_KEY: KEY_A }).kms;
    const { verify } = load({ KMS_MASTER_KEY: KEY_B, KMS_MASTER_KEY_PREVIOUS: KEY_A });
    const db = fakeDb({ webhooks: [{ id: "1", tenant_id: TENANT, value: writer.encryptData(TENANT, "whsec") }] });
    await expect(verify.assertKmsKeysConfigured({ sequelize: db, logger: logger() })).resolves.toEqual({ problems: [], envelopes: 1 });
  });

  it("decrypts a sample v1 envelope (which names no key): the right key passes, a wrong one refuses", async () => {
    const db = fakeDb({
      tenant_settings: [
        { id: "b", tenant_id: TENANT, value: legacyV1(KEY_A, TENANT, "x") },
        { id: "a", tenant_id: TENANT, value: legacyV1(KEY_A, TENANT, "y") },
      ],
    });
    const right = load({ KMS_MASTER_KEY: KEY_A }).verify;
    await expect(right.verifyKmsKeys(db)).resolves.toEqual({ problems: [], envelopes: 2 });

    const wrong = load({ KMS_MASTER_KEY: KEY_B }).verify;
    const result = await wrong.verifyKmsKeys(db);
    expect(result.problems).toEqual([
      "tenant_settings.value: 2 v1 value(s); the sample (id a) does not decrypt under any configured KMS master key",
    ]);
  });

  it("S-20: a v1 TOTP seed is sampled with its own AAD (users.mfa:<id>), not a tenant id", async () => {
    const db = fakeDb({ users: [{ id: "u1", tenant_id: TENANT, value: legacyV1(KEY_A, "users.mfa:u1", "JBSWY3DPEHPK3PXP") }] });
    await expect(load({ KMS_MASTER_KEY: KEY_A }).verify.verifyKmsKeys(db)).resolves.toMatchObject({ problems: [] });
    const wrong = await load({ KMS_MASTER_KEY: KEY_B }).verify.verifyKmsKeys(db);
    expect(wrong.problems[0].startsWith("users.mfa_secret: 1 v1 value(s)")).toBe(true);
  });

  it("KMS_VERIFY=warn logs every problem at error level and lets the boot continue", async () => {
    const writer = load({ KMS_MASTER_KEY: KEY_A }).kms;
    const { verify } = load({ KMS_MASTER_KEY: KEY_B });
    const db = fakeDb({ webhooks: [{ id: "1", tenant_id: TENANT, value: writer.encryptData(TENANT, "s") }] });
    const log = logger();
    const result = await verify.assertKmsKeysConfigured({ sequelize: db, logger: log, mode: "warn" });
    expect(result.problems).toHaveLength(1);
    expect(log.error).toHaveBeenLastCalledWith(expect.stringContaining("Continuing ONLY because KMS_VERIFY=warn"));
  });

  it("reads the mode from KMS_VERIFY by default (unset = refuse)", async () => {
    const writer = load({ KMS_MASTER_KEY: KEY_A }).kms;
    const { verify } = load({ KMS_MASTER_KEY: KEY_B });
    const db = fakeDb({ webhooks: [{ id: "1", tenant_id: TENANT, value: writer.encryptData(TENANT, "s") }] });
    const saved = process.env.KMS_VERIFY;
    process.env.KMS_VERIFY = "warn";
    try {
      await expect(verify.assertKmsKeysConfigured({ sequelize: db, logger: logger() })).resolves.toMatchObject({ envelopes: 1 });
    } finally {
      if (saved === undefined) delete process.env.KMS_VERIFY;
      else process.env.KMS_VERIFY = saved;
    }
  });

  it("checks every column keys:rotate re-wraps, soft-deleted rows included (no deleted_at predicate)", async () => {
    const { verify } = load({ KMS_MASTER_KEY: KEY_A });
    const db = fakeDb({});
    await verify.verifyKmsKeys(db);
    const statements = db.query.mock.calls.map(([sql]) => sql);
    for (const [table, column] of [["tenant_settings", "value"], ["webhooks", "secret"], ["tenant_keys", "private_key"]]) {
      expect(statements.some((s) => s.includes(`FROM ${table} WHERE ${column} LIKE 'v2:%'`))).toBe(true);
    }
    expect(statements.join("\n")).not.toMatch(/deleted/i);
  });
});

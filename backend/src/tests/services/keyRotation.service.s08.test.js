/**
 * S-08 / P6-10 — services/keyRotation.service.js, against an in-memory table
 * double. Real kms.service and real signingKeyWrap (real crypto) under the
 * test environment's KMS_MASTER_KEY / ENCRYPT_KEY.
 *
 * The same code against PostgreSQL — seeded v1 envelopes and legacy signing
 * keys, a rotation A -> B, a process with only B reading everything back, an
 * interrupted run, 0058 down — is keyRotation.s08.live.test.js.
 */
const crypto = require("crypto");
const kms = require("../../services/kms.service");
const { rewrapAll, rewrapTarget, TARGETS, workFor } = require("../../services/keyRotation.service");
const { encryptPrivateKeyForTest } = require("../utils/esignatureKey.utils");

const T1 = "tenant-1";
const T2 = "tenant-2";

/** v1 form of an envelope written now (same crypto, no key id). */
const asV1 = (envelope) => ["v1", ...envelope.split(":").slice(2)].join(":");

let PEM;
beforeAll(() => {
  PEM = crypto.generateKeyPairSync("rsa", {
    modulusLength: 1024,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  }).privateKey;
});

/**
 * A sequelize double over { table: rows[] }, understanding exactly the three
 * statement shapes rewrapTarget issues.
 */
const fakeDb = (tables, { interfere } = {}) => {
  const query = jest.fn(async (sql, options = {}) => {
    const s = sql.replace(/\s+/g, " ").trim();
    const r = options.replacements || {};
    const table = /(?:FROM|UPDATE) (\w+)/.exec(s)[1];
    const column = TARGETS.find((t) => t.table === table).column;
    const rows = tables[table];
    if (s.startsWith("SELECT id::text AS id")) {
      return rows
        .filter((row) => r.cursor === null || row.id > r.cursor)
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, r.limit)
        .map((row) => ({ id: row.id, tenant_id: row.tenant_id, value: row[column] }));
    }
    if (s.startsWith("UPDATE")) {
      if (interfere) {
        interfere(rows, r);
      }
      const hit = rows.find((row) => row.id === r.id && row.tenant_id === r.tenantId && row[column] === r.previous);
      if (hit) {
        hit[column] = r.next;
      }
      return [[], { rowCount: hit ? 1 : 0 }];
    }
    if (s.startsWith(`SELECT ${column} AS value`)) {
      const row = rows.find((x) => x.id === r.id && x.tenant_id === r.tenantId);
      return [{ value: row[column] }];
    }
    throw new Error(`unexpected SQL: ${s}`);
  });
  return { query };
};

const seed = () => ({
  tenant_settings: [
    { id: "s1", tenant_id: T1, value: asV1(kms.encryptData(T1, "stripe")) },
    { id: "s2", tenant_id: T1, value: "not a secret" },
    { id: "s3", tenant_id: T2, value: kms.encryptData(T2, "already-current") },
    { id: "s4", tenant_id: T2, value: null },
  ],
  webhooks: [{ id: "w1", tenant_id: T2, secret: asV1(kms.encryptData(T2, "whsec")) }],
  tenant_keys: [
    { id: "k1", tenant_id: T1, private_key: encryptPrivateKeyForTest(PEM, process.env.ENCRYPT_KEY) },
    { id: "k2", tenant_id: T2, private_key: kms.encryptData(T2, PEM) },
  ],
});

describe("workFor", () => {
  const settings = TARGETS[0];
  const keys = TARGETS[2];
  it.each([
    [settings, null, null],
    [settings, "", null],
    [settings, "plain", null],
    [settings, "v1:a:b:c:d:e:f", "rewrap"],
    [keys, "00ff:abcd", "convert"],
  ])("%#", (target, value, expected) => {
    expect(workFor(target, value)).toBe(expected);
  });

  it("a v2 envelope under the current key needs nothing", () => {
    expect(workFor(settings, kms.encryptData(T1, "x"))).toBeNull();
  });
});

describe("rewrapAll", () => {
  it("re-wraps v1 envelopes, converts legacy signing keys, leaves the rest; every row re-reads the same", async () => {
    const tables = seed();
    const current = tables.tenant_settings[2].value;
    const result = await rewrapAll({ sequelize: fakeDb(tables), batchSize: 2 });

    expect(result.failed).toBe(0);
    expect(result.keyInfo).toEqual(kms.keyInfo());
    expect(result.reports).toEqual([
      { table: "tenant_settings", scanned: 4, rewrapped: 1, converted: 0, skipped: 0, failed: [] },
      { table: "webhooks", scanned: 1, rewrapped: 1, converted: 0, skipped: 0, failed: [] },
      { table: "tenant_keys", scanned: 2, rewrapped: 0, converted: 1, skipped: 0, failed: [] },
    ]);
    expect(kms.decryptData(T1, tables.tenant_settings[0].value)).toBe("stripe");
    expect(tables.tenant_settings[0].value).toMatch(/^v2:/);
    expect(tables.tenant_settings[1].value).toBe("not a secret");
    expect(tables.tenant_settings[2].value).toBe(current); // untouched
    expect(kms.decryptData(T2, tables.webhooks[0].secret)).toBe("whsec");
    expect(kms.decryptData(T1, tables.tenant_keys[0].private_key)).toBe(PEM);
  });

  it("dry run counts and writes nothing", async () => {
    const tables = seed();
    const snapshot = JSON.stringify(tables);
    const db = fakeDb(tables);
    const result = await rewrapAll({ sequelize: db, dryRun: true });
    expect(result.reports.map((r) => r.rewrapped + r.converted)).toEqual([1, 1, 1]);
    expect(JSON.stringify(tables)).toBe(snapshot);
    expect(db.query.mock.calls.some(([sql]) => sql.includes("UPDATE"))).toBe(false);
  });

  it("limits to the named tables", async () => {
    const result = await rewrapAll({ sequelize: fakeDb(seed()), tables: ["webhooks"] });
    expect(result.reports.map((r) => r.table)).toEqual(["webhooks"]);
  });

  it("a row the application rewrote meanwhile is SKIPPED, not clobbered", async () => {
    const tables = seed();
    const db = fakeDb(tables, {
      interfere: (rows, r) => {
        const row = rows.find((x) => x.id === r.id);
        if (row && row.secret) {
          row.secret = "rotated-by-the-app";
        }
      },
    });
    const report = await rewrapTarget({ sequelize: db, target: TARGETS[1] });
    expect(report).toEqual(expect.objectContaining({ rewrapped: 0, skipped: 1, failed: [] }));
    expect(tables.webhooks[0].secret).toBe("rotated-by-the-app");
  });

  it("a row that cannot be decrypted is reported, and the rest continue", async () => {
    const tables = seed();
    tables.tenant_settings[0].tenant_id = T2; // wrong AAD: not decryptable as T2
    const result = await rewrapAll({ sequelize: fakeDb(tables) });
    expect(result.failed).toBe(1);
    expect(result.reports[0].failed).toEqual([{ id: "s1", error: "Failed to decrypt data" }]);
    expect(result.reports[1].rewrapped).toBe(1);
  });

  it("a re-read that does not hold the same secret is a failure", async () => {
    const tables = seed();
    const db = fakeDb(tables);
    const original = db.query.getMockImplementation();
    db.query.mockImplementation(async (sql, options) => {
      if (sql.includes("SELECT secret AS value")) {
        return [{ value: kms.encryptData(T2, "something else") }];
      }
      return original(sql, options);
    });
    const report = await rewrapTarget({ sequelize: db, target: TARGETS[1] });
    expect(report.failed).toEqual([{ id: "w1", error: "the re-read value does not decrypt to the original secret" }]);
  });

  it("with no database it throws rather than reporting a rotation that did not happen", async () => {
    await expect(rewrapAll()).rejects.toThrow(TypeError);
  });
});

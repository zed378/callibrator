/**
 * S-08 / P6-10 — tenant e-signature private keys are stored as KMS envelopes
 * (authenticated, tenant-bound, rotatable), and the legacy AES-CBC form is
 * still read — never written.
 *
 * REAL crypto and real RSA keys: this is a cryptographic contract.
 */
const crypto = require("crypto");
const { encryptPrivateKeyForTest } = require("../utils/esignatureKey.utils");

const TENANT = "tenant-wrap";
const KMS_KEY = "d4".repeat(32);

/** Load the module as a process with this environment would. */
const load = (env) => {
  const saved = { ...process.env };
  delete process.env.ENCRYPT_KEY;
  delete process.env.ENCRYPT_KEY_PREVIOUS;
  Object.assign(process.env, { KMS_MASTER_KEY: KMS_KEY }, env);
  let mod;
  try {
    jest.isolateModules(() => {
      mod = require("../../services/signingKeyWrap.service");
    });
  } finally {
    process.env = saved;
  }
  return mod;
};

let PEM;
beforeAll(() => {
  PEM = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  }).privateKey;
});

describe("signingKeyWrap", () => {
  it("a NEW key is a v2 KMS envelope, bound to its tenant", () => {
    const wrap = load({ ENCRYPT_KEY: "enc-1" });
    const stored = wrap.wrapPrivateKey(TENANT, PEM);
    expect(stored).toMatch(/^v2:[0-9a-f]{16}:/);
    expect(stored).not.toContain("PRIVATE KEY");
    expect(wrap.isLegacy(stored)).toBe(false);
    expect(wrap.unwrapPrivateKey(TENANT, stored)).toBe(PEM);
    // GCM + tenant AAD: the same row under another tenant does not open.
    expect(() => wrap.unwrapPrivateKey("another-tenant", stored)).toThrow("Failed to decrypt data");
  });

  it("a new key needs no ENCRYPT_KEY at all", () => {
    const wrap = load({});
    expect(wrap.unwrapPrivateKey(TENANT, wrap.wrapPrivateKey(TENANT, PEM))).toBe(PEM);
  });

  it("a LEGACY (AES-CBC under ENCRYPT_KEY) key still reads", () => {
    const wrap = load({ ENCRYPT_KEY: "enc-1" });
    const legacy = encryptPrivateKeyForTest(PEM, "enc-1");
    expect(wrap.isLegacy(legacy)).toBe(true);
    expect(wrap.unwrapPrivateKey(TENANT, legacy)).toBe(PEM);
  });

  it("ROTATION of ENCRYPT_KEY: a legacy key under the PREVIOUS secret still reads", () => {
    const wrap = load({ ENCRYPT_KEY: "enc-2", ENCRYPT_KEY_PREVIOUS: "enc-1" });
    expect(wrap.unwrapPrivateKey(TENANT, encryptPrivateKeyForTest(PEM, "enc-1"))).toBe(PEM);
    expect(wrap.unwrapPrivateKey(TENANT, encryptPrivateKeyForTest(PEM, "enc-2"))).toBe(PEM);
  });

  it("a legacy key under an unknown secret is refused, saying how many secrets were tried", () => {
    const wrap = load({ ENCRYPT_KEY: "enc-2" });
    expect(() => wrap.unwrapPrivateKey(TENANT, encryptPrivateKeyForTest(PEM, "enc-1"))).toThrow(
      /no configured ENCRYPT_KEY \(1 tried\) decrypts this legacy signing key/,
    );
  });

  it("a legacy key with NO ENCRYPT_KEY configured is refused, saying so", () => {
    const wrap = load({});
    expect(() => wrap.unwrapPrivateKey(TENANT, encryptPrivateKeyForTest(PEM, "enc-1"))).toThrow(
      /ENCRYPT_KEY is not set/,
    );
  });

  it("CBC has no MAC: a decryption that is not a private key is REJECTED, not returned", () => {
    const wrap = load({ ENCRYPT_KEY: "enc-1" });
    // Valid CBC under the right key, but the plaintext is not a key.
    const notAKey = encryptPrivateKeyForTest("-----BEGIN PRIVATE KEY-----\nnot really\n-----END PRIVATE KEY-----", "enc-1");
    expect(() => wrap.unwrapPrivateKey(TENANT, notAKey)).toThrow(/decrypts this legacy signing key/);
    expect(() => wrap.unwrapPrivateKey(TENANT, "zz:not-hex")).toThrow(/decrypts this legacy signing key/);
  });

  it("wrapLegacy (migration 0058's rollback direction) round-trips under ENCRYPT_KEY", () => {
    const wrap = load({ ENCRYPT_KEY: "enc-1", ENCRYPT_KEY_PREVIOUS: "enc-0" });
    const legacy = wrap.wrapLegacy(PEM);
    expect(legacy).toMatch(/^[0-9a-f]{32}:[0-9a-f]+$/);
    // Written under the CURRENT secret, readable by a process that has only it.
    expect(load({ ENCRYPT_KEY: "enc-1" }).unwrapPrivateKey(TENANT, legacy)).toBe(PEM);
  });

  it("wrapLegacy refuses without ENCRYPT_KEY", () => {
    expect(() => load({}).wrapLegacy(PEM)).toThrow(/ENCRYPT_KEY is not set/);
  });
});

describe("eSignature.generateKeyPair stores the new form", () => {
  it("the private key written to tenant_keys is a v2 envelope under the tenant", async () => {
    const created = [];
    let service;
    jest.isolateModules(() => {
      jest.doMock("../../models", () => ({
        TenantKey: { create: jest.fn(async (row) => created.push(row)) },
      }));
      service = require("../../services/eSignature.service");
    });
    const kms = require("../../services/kms.service");

    const result = await service.generateKeyPair(TENANT);

    expect(result.privateKey).toBe("[REDACTED]");
    expect(created).toHaveLength(1);
    expect(created[0].privateKey).toMatch(/^v2:/);
    const pem = kms.decryptData(TENANT, created[0].privateKey);
    expect(() => crypto.createPrivateKey(pem)).not.toThrow();
    // The stored private key matches the published public key.
    const sig = crypto.sign("sha256", Buffer.from("x"), pem);
    expect(crypto.verify("sha256", Buffer.from("x"), created[0].publicKey, sig)).toBe(true);
  });
});

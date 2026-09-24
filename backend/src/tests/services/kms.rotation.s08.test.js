/**
 * P6-10 / S-08 — the KMS master key is rotatable.
 *
 * REAL node crypto throughout (kms.service.test.js mocks crypto, so it can
 * only prove which calls are made; this file proves that what one key ring
 * writes another can read). Each case loads kms.service in isolation with the
 * key ring it describes, exactly as a process booted with that environment.
 *
 * The DoD lines of S-08 this proves:
 *  - a new ciphertext names the key that wrapped it ("v2:<keyId>:");
 *  - with two master keys configured, rows wrapped by either decrypt —
 *    including v1 rows, written before key ids existed;
 *  - a re-wrap moves a row onto the current key, and the row reads back.
 */
const crypto = require("crypto");
const { keyIdOf } = require("../../utils/keyring.util");

const KEY_A = "a1".repeat(32);
const KEY_B = "b2".repeat(32);
const KEY_C = "c3".repeat(32);
const TENANT = "tenant-s08";

/** Load kms.service as a process with this environment would. */
const loadKms = (env) => {
  const saved = { ...process.env };
  delete process.env.KMS_MASTER_KEY_PREVIOUS;
  Object.assign(process.env, env);
  let kms;
  try {
    jest.isolateModules(() => {
      kms = require("../../services/kms.service");
    });
  } finally {
    process.env = saved;
  }
  return kms;
};

/**
 * A v1 envelope exactly as kms.service wrote them before P6-10 — no key id.
 * @param {string} masterHex
 * @param {string} tenantId
 * @param {string} plaintext
 */
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

const idOf = (hex) => keyIdOf(Buffer.from(hex, "hex"));

describe("S-08 — KMS envelopes name their key, and a ring decrypts old and new", () => {
  it("a new envelope is v2 and names the CURRENT key by its fingerprint", () => {
    const kms = loadKms({ KMS_MASTER_KEY: KEY_A });
    const env = kms.encryptData(TENANT, "stripe-secret");
    const parts = env.split(":");
    expect(parts[0]).toBe("v2");
    expect(parts[1]).toBe(idOf(KEY_A));
    expect(parts[1]).toMatch(/^[0-9a-f]{16}$/);
    expect(env).not.toContain(KEY_A); // the id is a fingerprint, not the key
    expect(kms.decryptData(TENANT, env)).toBe("stripe-secret");
    expect(kms.keyInfo()).toEqual({ currentKeyId: idOf(KEY_A), previousKeyIds: [] });
  });

  it("a v1 envelope (no key id) still decrypts — under the current key", () => {
    const kms = loadKms({ KMS_MASTER_KEY: KEY_A });
    expect(kms.decryptData(TENANT, legacyV1(KEY_A, TENANT, "old-secret"))).toBe("old-secret");
  });

  it("ROTATION: with B current and A previous, v1-under-A, v2-under-A and v2-under-B all decrypt", () => {
    const beforeRotation = loadKms({ KMS_MASTER_KEY: KEY_A });
    const v2UnderA = beforeRotation.encryptData(TENANT, "written-before");
    const v1UnderA = legacyV1(KEY_A, TENANT, "written-long-before");

    const rotated = loadKms({ KMS_MASTER_KEY: KEY_B, KMS_MASTER_KEY_PREVIOUS: KEY_A });
    const v2UnderB = rotated.encryptData(TENANT, "written-after");

    expect(v2UnderB.split(":")[1]).toBe(idOf(KEY_B));
    expect(rotated.decryptData(TENANT, v2UnderA)).toBe("written-before");
    expect(rotated.decryptData(TENANT, v1UnderA)).toBe("written-long-before");
    expect(rotated.decryptData(TENANT, v2UnderB)).toBe("written-after");
    expect(rotated.keyInfo()).toEqual({ currentKeyId: idOf(KEY_B), previousKeyIds: [idOf(KEY_A)] });
  });

  it("several previous keys, comma- or space-separated; a repeat of the current key is ignored", () => {
    const underC = loadKms({ KMS_MASTER_KEY: KEY_C }).encryptData(TENANT, "from-c");
    const kms = loadKms({ KMS_MASTER_KEY: KEY_B, KMS_MASTER_KEY_PREVIOUS: `${KEY_A}, ${KEY_C} ${KEY_B}` });
    expect(kms.keyInfo().previousKeyIds).toEqual([idOf(KEY_A), idOf(KEY_C)]);
    expect(kms.decryptData(TENANT, underC)).toBe("from-c");
  });

  it("an envelope naming a key that is NOT configured fails loudly — never a silent wrong answer", () => {
    const underA = loadKms({ KMS_MASTER_KEY: KEY_A }).encryptData(TENANT, "x");
    const kms = loadKms({ KMS_MASTER_KEY: KEY_B }); // A was dropped too early
    expect(() => kms.decryptData(TENANT, underA)).toThrow("Failed to decrypt data");
    expect(() => kms.decryptData(TENANT, legacyV1(KEY_A, TENANT, "x"))).toThrow("Failed to decrypt data");
  });

  it("a v2 envelope whose key id is right but whose DEK was tampered with is refused", () => {
    const kms = loadKms({ KMS_MASTER_KEY: KEY_A });
    const parts = kms.encryptData(TENANT, "x").split(":");
    parts[2] = Buffer.from("x".repeat(48)).toString("base64");
    expect(() => kms.decryptData(TENANT, parts.join(":"))).toThrow("Failed to decrypt data");
  });

  it("the tenant id is still the AAD: another tenant cannot unwrap it", () => {
    const kms = loadKms({ KMS_MASTER_KEY: KEY_A });
    expect(() => kms.decryptData("other-tenant", kms.encryptData(TENANT, "x"))).toThrow("Failed to decrypt data");
  });

  it("a malformed v2 or v1 envelope is refused", () => {
    const kms = loadKms({ KMS_MASTER_KEY: KEY_A });
    expect(() => kms.decryptData(TENANT, "v2:abc:def")).toThrow("Failed to decrypt data");
    expect(() => kms.decryptData(TENANT, "v1:abc")).toThrow("Failed to decrypt data");
  });

  it("isEnvelope recognises v1 and v2 only", () => {
    const kms = loadKms({ KMS_MASTER_KEY: KEY_A });
    expect([
      kms.isEnvelope("v1:x"),
      kms.isEnvelope("v2:x"),
      kms.isEnvelope("v3:x"),
      kms.isEnvelope("plain"),
      kms.isEnvelope(null),
      kms.isEnvelope(42),
    ]).toEqual([true, true, false, false, false, false]);
  });

  it("needsRewrap: v1, and v2 under a previous key, need it; v2 under the current key and plaintext do not", () => {
    const underA = loadKms({ KMS_MASTER_KEY: KEY_A }).encryptData(TENANT, "x");
    const kms = loadKms({ KMS_MASTER_KEY: KEY_B, KMS_MASTER_KEY_PREVIOUS: KEY_A });
    expect(kms.needsRewrap(legacyV1(KEY_A, TENANT, "x"))).toBe(true);
    expect(kms.needsRewrap(underA)).toBe(true);
    expect(kms.needsRewrap(kms.encryptData(TENANT, "x"))).toBe(false);
    expect(kms.needsRewrap("plaintext")).toBe(false);
  });

  it("rewrap moves a value onto the current key, and it reads back the same", () => {
    const v1 = legacyV1(KEY_A, TENANT, "the-secret");
    const kms = loadKms({ KMS_MASTER_KEY: KEY_B, KMS_MASTER_KEY_PREVIOUS: KEY_A });
    const moved = kms.rewrap(TENANT, v1);
    expect(moved.split(":").slice(0, 2)).toEqual(["v2", idOf(KEY_B)]);
    expect(kms.needsRewrap(moved)).toBe(false);
    // And after the previous key is REMOVED, the re-wrapped value still reads.
    expect(loadKms({ KMS_MASTER_KEY: KEY_B }).decryptData(TENANT, moved)).toBe("the-secret");
  });

  it("refuses to boot with a previous key that is not 32 bytes, naming which", () => {
    expect(() => loadKms({ KMS_MASTER_KEY: KEY_A, KMS_MASTER_KEY_PREVIOUS: `${KEY_B},abcd` })).toThrow(
      /KMS_MASTER_KEY_PREVIOUS\[1\] must decode to 32 bytes \(got 2\)/,
    );
  });
});

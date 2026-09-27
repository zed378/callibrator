/**
 * S-20 (ADR-080) — a TOTP seed is stored only as a KMS envelope.
 *
 * The REAL otplib and the REAL kms.service (real AES-256-GCM under the test
 * environment's KMS_MASTER_KEY). Only the models barrel is doubled, for the
 * replay stamp consumeCode writes.
 *
 * The same, against PostgreSQL 18 with the real User model, migration 0086
 * and an upgrade from plaintext rows, is secretsAtRest.s20.live.test.js.
 */
jest.mock("../../models", () => ({ Users: { update: jest.fn(async () => [1]) } }));

const { generateSync } = require("otplib");
const kms = require("../../services/kms.service");
const mfaService = require("../../services/mfa.service");

const { secretAad, LEGACY_PLAINTEXT_SEED } = mfaService;

const USER = "5e5e5e5e-0000-4000-8000-000000000020";
const OTHER = "5e5e5e5e-0000-4000-8000-000000000021";
const SEED = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

describe("S-20 — sealSecret / openSecret", () => {
  it("seals a seed as a v2 envelope that does not contain it, and opens it again", () => {
    const stored = mfaService.sealSecret(USER, SEED);
    expect(stored).toMatch(/^v2:[0-9a-f]{16}:/);
    expect(stored).not.toContain(SEED);
    expect(mfaService.openSecret(USER, stored)).toBe(SEED);
    // Two seals of one seed differ (fresh DEK and IV each time).
    expect(mfaService.sealSecret(USER, SEED)).not.toBe(stored);
  });

  it("binds the envelope to the account: under another user id it does not open", () => {
    const stored = mfaService.sealSecret(USER, SEED);
    expect(() => mfaService.openSecret(OTHER, stored)).toThrow("Failed to decrypt data");
    // Nor under the user's tenant id, or any AAD but the documented one.
    expect(() => kms.decryptData(USER, stored)).toThrow("Failed to decrypt data");
    expect(kms.decryptData(secretAad(USER), stored)).toBe(SEED);
  });

  it("reads a pre-0086 plaintext value, and null, as they are", () => {
    expect(mfaService.openSecret(USER, SEED)).toBe(SEED);
    expect(mfaService.openSecret(USER, null)).toBeNull();
    expect(mfaService.openSecret(USER, undefined)).toBeUndefined();
  });
});

describe("S-20 — the live verify path opens the envelope (real otplib)", () => {
  // Mid-step, so ±1 step is unambiguous.
  const NOW_S = Date.parse("2026-09-27T08:00:15Z") / 1000;
  beforeEach(() => jest.spyOn(Date, "now").mockReturnValue(NOW_S * 1000));

  it("accepts the current code for a SEALED live seed, and stamps the step", async () => {
    const user = { id: USER, mfaEnabled: true, mfaSecret: mfaService.sealSecret(USER, SEED), mfaLastUsedStep: null };
    const code = generateSync({ secret: SEED, epoch: NOW_S });
    await expect(mfaService.verifyLogin(user, code)).resolves.toBe(true);
    expect(user.mfaLastUsedStep).toBe(Math.floor(NOW_S / 30));
  });

  it("accepts a code for a SEALED pending seed passed as `secret`", async () => {
    const user = { id: USER, mfaSecret: null, mfaLastUsedStep: null };
    const code = generateSync({ secret: SEED, epoch: NOW_S });
    await expect(
      mfaService.consumeCode(user, code, { secret: mfaService.sealSecret(USER, SEED) }),
    ).resolves.toBe(true);
  });

  it("a seed sealed for ANOTHER account is a 500, not a silently wrong code", async () => {
    const user = { id: USER, mfaEnabled: true, mfaSecret: mfaService.sealSecret(OTHER, SEED), mfaLastUsedStep: null };
    const code = generateSync({ secret: SEED, epoch: NOW_S });
    await expect(mfaService.verifyLogin(user, code)).rejects.toMatchObject({ status: 500 });
  });

  it("the envelope itself is never usable as a seed", async () => {
    const stored = mfaService.sealSecret(USER, SEED);
    expect(mfaService.checkCode(generateSync({ secret: SEED, epoch: NOW_S }), stored)).toBe(false);
  });
});

describe("S-20 — LEGACY_PLAINTEXT_SEED (migration 0086, keys:rotate)", () => {
  it("a non-envelope is legacy; an envelope is not", () => {
    expect(LEGACY_PLAINTEXT_SEED.isLegacy(SEED)).toBe(true);
    expect(LEGACY_PLAINTEXT_SEED.isLegacy(mfaService.sealSecret(USER, SEED))).toBe(false);
  });

  it.each([
    ["a 32-character seed", SEED],
    ["a legacy 16-character (80-bit) seed", "JBSWY3DPEHPK3PXP"],
    ["a padded seed", "JBSWY3DPEHPK3PXPJB======"],
  ])("unwraps %s as itself", (_label, seed) => {
    expect(LEGACY_PLAINTEXT_SEED.unwrap(secretAad(USER), seed)).toBe(seed);
  });

  it.each([
    ["too short", "JBSWY3DPEHPK3PX"],
    ["lower case", "jbswy3dpehpk3pxp"],
    ["not base32", "JBSWY3DPEHPK3PX1"],
    ["a broken envelope", "v9:garbage"],
    ["empty", ""],
  ])("refuses %s rather than guessing", (_label, value) => {
    expect(() => LEGACY_PLAINTEXT_SEED.unwrap(secretAad(USER), value)).toThrow(
      "not a base32 TOTP seed (refusing to guess)",
    );
  });
});

// P9-18 (ADR-087): converted from mfa.service.js, behaviour unchanged (its
// interim `.d.ts` is deleted with it). The export is the same object: an
// MfaService instance carrying `secretAad`, `LEGACY_PLAINTEXT_SEED`,
// `RECOVERY_CODE_COUNT` and `MFA_CLEARED`, added in that order. `crypto` and
// `kms` stay module objects, read at call time; `logger` is captured at load;
// otplib, sequelize and the models are still required lazily, per call, so
// loading this module loads none of them.
import crypto from "crypto";
import type { Attributes, Transaction, UpdateOptions } from "sequelize";
import type { ModelInstance } from "../types/models";
import type * as OtplibModule from "otplib";
import type * as SequelizeModule from "sequelize";
import type * as ModelsModule from "../models";
import { logger as loadedLogger } from "../middlewares/activityLog.middleware";
import kms from "./kms.service";

const logger = loadedLogger;

/** The update options of a User row (what the two conditional updates pass). */
type UserUpdateOptions = UpdateOptions<Attributes<ModelInstance<"User">>>;

/** The user row as these methods read it. */
interface MfaUser {
  id: string;
  mfaEnabled?: boolean | null;
  mfaSecret?: string | null;
  mfaLastUsedStep?: number | string | null;
  mfaRecoveryCodes?: string[] | null;
}

/**
 * S-20 (ADR-080) — a TOTP seed is stored ONLY as a kms.service envelope.
 *
 * `users.mfa_secret` and `users.mfa_pending_secret` held the base32 seed in
 * plaintext, so a database dump (`make backup`) gave out every account's
 * second factor. Both now hold a v2 envelope under the KMS master key ring,
 * with this AAD: the USER id, not the tenant id — a user's tenant can be null
 * (the platform operator) and can change (a tenant move), and the seed must
 * still read back. A value copied onto another account does not decrypt.
 * Migration 0086 encrypted the rows written before this; keys:rotate re-wraps
 * them (services/keyRotation.service.js); User model hooks refuse a
 * plaintext write.
 *
 * @param userId - the account
 * @returns the AAD both MFA columns are sealed under
 */
const secretAad = (userId: string): string => `users.mfa:${userId}`;

/** A base32 TOTP seed, at least 80 bits (16 characters) — see LEGACY_MIN_SECRET_BYTES. */
const SEED_SHAPE = /^[A-Z2-7]{16,}=*$/;

/**
 * A-99: every TOTP operation in the backend goes through this module, on the
 * otplib 13 functional API (generateSecret / generateURI / verifySync).
 *
 * The code used to destructure `authenticator` from otplib — an export that
 * otplib 13 does not have — so MFA setup, setup verification and MFA login all
 * threw a TypeError in production, while a global jest mock that accepted any
 * code kept every test green. Tests of this module run the REAL library
 * (mfa.realOtplib.a99.test.js).
 *
 * otplib 13's CommonJS build pulls in ESM-only dependencies (@scure/base,
 * @noble/hashes). Node 24 loads them through require(esm); it is required
 * lazily so that only a TOTP operation depends on that, not module load.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: required per TOTP operation (otplib loads ESM-only dependencies)
const otp = (): typeof OtplibModule => require("otplib") as typeof OtplibModule;

// Q-43 (ADR-098 §8.1): the name an authenticator app shows. Only new enrolments carry it; codes do not depend on it.
const TOTP_ISSUER = "Device Calibrator";

// ±30 s around "now" is exactly the previous, current and next 30-second step:
// tolerates one step of clock drift on the phone, and no more.
const TOTP_EPOCH_TOLERANCE_SECONDS = 30;

// otplib <= 12 generated 10-byte (80-bit, 16-character base32) secrets, the
// Google Authenticator convention. otplib 13 refuses secrets under 16 bytes by
// default, which would lock any such account out. VERIFICATION accepts them;
// every NEW secret is 20 bytes (RFC 4226's recommended 160 bits).
const LEGACY_MIN_SECRET_BYTES = 10;

const SIX_DIGITS = /^\d{6}$/;

let verifyGuardrails: ReturnType<typeof OtplibModule.createGuardrails> | undefined;
const guardrails = (): ReturnType<typeof OtplibModule.createGuardrails> => {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an if, kept
  if (!verifyGuardrails) {
    verifyGuardrails = otp().createGuardrails({ MIN_SECRET_BYTES: LEGACY_MIN_SECRET_BYTES });
  }
  return verifyGuardrails;
};

/**
 * MFA Service (TOTP)
 */
class MfaService {
  /**
   * A new base32 TOTP secret — 20 random bytes, 32 characters.
   * @returns the secret
   */
  createSecret(): string {
    return otp().generateSecret();
  }

  /**
   * S-20 — the stored form of a seed: a KMS envelope bound to the account.
   * @param userId - the account
   * @param secret - base32 seed
   * @returns a v2 envelope
   */
  sealSecret(userId: string, secret: string): string {
    return kms.encryptData(secretAad(userId), secret) as string;
  }

  /**
   * S-20 — the seed a stored value holds. An envelope is decrypted (a KMS
   * failure throws — it is a misconfiguration, not a wrong code). A value
   * that is not an envelope is a row written before migration 0086 (restored
   * from an older dump, say) and reads as it is; nothing writes one any more.
   *
   * @param userId - the account
   * @param stored - the column's value
   * @returns the seed (or the legacy value as it is)
   */
  openSecret(userId: string, stored: string | null | undefined): string | null | undefined {
    if (!kms.isEnvelope(stored)) {
      return stored;
    }
    return kms.decryptData(secretAad(userId), stored);
  }

  /**
   * The otpauth:// URI an authenticator app scans.
   * @param label - the account name shown in the app (the email)
   * @param secret - base32 secret
   * @returns the URI
   */
  buildOtpauthUri(label: string, secret: string): string {
    return otp().generateURI({ issuer: TOTP_ISSUER, label, secret });
  }

  /**
   * The TOTP time step `token` matches for `secret`, within ±1 step of now —
   * or null when it matches none.
   *
   * Never throws for anything the caller sent: a malformed code is a wrong
   * code. A stored secret the library cannot decode is logged — it means the
   * row is corrupt — and refused.
   *
   * @param token - the code as submitted (string, or a JSON number)
   * @param secret - base32 secret
   * @returns floor(epoch / 30) of the matching step
   */
  matchTimeStep(token: unknown, secret: string | null | undefined): number | null {
    if (!secret) {
      return null;
    }
    const code = typeof token === "number" ? String(token) : token;
    if (typeof code !== "string") {
      return null;
    }
    const trimmed = code.trim();
    if (!SIX_DIGITS.test(trimmed)) {
      return null;
    }

    try {
      // A TOTP verification answers `{ valid, timeStep }` (otplib types the HOTP shape too).
      const result = otp().verifySync({
        secret,
        token: trimmed,
        epochTolerance: TOTP_EPOCH_TOLERANCE_SECONDS,
        guardrails: guardrails(),
      }) as { valid: boolean; timeStep?: number };
      return result.valid ? (result.timeStep as number) : null;
    } catch (err) {
      logger.error("TOTP verification failed on the stored secret", { error: (err as { message?: unknown }).message });
      return null;
    }
  }

  /**
   * Whether `token` is the TOTP for `secret` now, within ±1 time step.
   *
   * A PURE check: it does not record the code as used. Accepting a code as a
   * factor must go through `consumeCode` (A-115), or the code can be replayed.
   *
   * @param token - the code as submitted
   * @param secret - base32 secret
   * @returns whether it matches now
   */
  checkCode(token: unknown, secret: string | null | undefined): boolean {
    return this.matchTimeStep(token, secret) !== null;
  }

  /**
   * A-115 — accept `token` as a second factor ONCE.
   *
   * A TOTP code is valid for its 30-second step and, with the ±1 step drift
   * allowance, is accepted for about 90 seconds. Without a record of use, a
   * code seen over a shoulder, in a proxy log or by a phishing page could be
   * presented again inside that window. The account's last accepted step is
   * stored (`users.mfa_last_used_step`, migration 0028), and a code whose step
   * is at or before it is refused.
   *
   * The stamp is a CONDITIONAL update — `WHERE mfa_last_used_step IS NULL OR
   * mfa_last_used_step < :step` — and the code is accepted only if it changed
   * exactly one row. Two requests racing with the same code both pass the
   * in-memory check, but PostgreSQL re-evaluates the WHERE for the second one
   * after the first commits, so it updates nothing and is refused.
   *
   * @param user - the user row (id, mfaSecret, mfaLastUsedStep)
   * @param token - the code as submitted
   * @param options - `secret`: verify against this secret instead of the live
   *   one (the pending secret, when enrolling); either is the STORED form — an
   *   envelope — and is opened here (S-20). `transaction`: write the stamp in it
   * @returns true when the code is right and unused
   */
  async consumeCode(
    user: MfaUser,
    token: unknown,
    { secret = user.mfaSecret, transaction }: { secret?: string | null | undefined; transaction?: Transaction | undefined } = {},
  ): Promise<boolean> {
    const step = this.matchTimeStep(token, this.openSecret(user.id, secret));
    if (step === null) {
      return false;
    }

    const lastUsed =
      user.mfaLastUsedStep === null || user.mfaLastUsedStep === undefined
        ? null
        : Number(user.mfaLastUsedStep);
    if (lastUsed !== null && step <= lastUsed) {
      logger.warn("TOTP code refused: its time step was already used", { userId: user.id });
      return false;
    }

    // Required here, not at the top, so that loading this module does not load
    // the models: only this method touches the database.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: required here (see above)
    const { Op } = require("sequelize") as typeof SequelizeModule;
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: required here (see above)
    const { Users } = require("../models") as typeof ModelsModule;
    const stampOptions = {
      where: {
        id: user.id,
        [Op.or]: [{ mfaLastUsedStep: null }, { mfaLastUsedStep: { [Op.lt]: step } }],
      },
      transaction,
    };
    const [affected] = await Users.update(
      { mfaLastUsedStep: step },
      stampOptions as unknown as UserUpdateOptions,
    );
    if (affected !== 1) {
      logger.warn("TOTP code refused: used concurrently", { userId: user.id });
      return false;
    }

    user.mfaLastUsedStep = step;
    return true;
  }

  /**
   * Verify a code against the account's LIVE secret and consume it (A-115).
   * Used by certificate and e-signature signing (certificate.service.js).
   *
   * @param user - The user instance
   * @param token - The 6-digit TOTP token
   * @returns whether the code was right and unused
   * @throws {Error} when the account has no MFA
   */
  async verifyLogin(user: MfaUser, token: unknown): Promise<boolean> {
    if (!user.mfaEnabled || !user.mfaSecret) {
      throw new Error("MFA is not enabled for this user.");
    }
    return this.consumeCode(user, token);
  }

  // ----------------------------------------------------------------
  // A-141 — ONE-TIME RECOVERY CODES
  //
  // Without them a lost phone was a locked-out account: there was no MFA
  // disable and no other way past the second factor. RECOVERY_CODE_COUNT codes
  // are issued when MFA is enabled or its authenticator replaced, shown once,
  // and stored only as hashes (users.mfa_recovery_codes, migration 0031).
  //
  // Each code is 80 random bits (16 base32 characters, shown as four groups
  // of four). At that entropy a fast hash is the right one: there is nothing
  // for a slow KDF to protect that 2^80 does not. The hash is salted with the
  // user id, so equal codes on two accounts do not hash alike and one
  // precomputed table does not serve every account.
  // ----------------------------------------------------------------

  /**
   * RECOVERY_CODE_COUNT fresh codes, formatted "ABCD-EFGH-IJKL-MNOP".
   * @returns the codes
   */
  createRecoveryCodes(): string[] {
    const codes: string[] = [];
    for (let i = 0; i < RECOVERY_CODE_COUNT; i += 1) {
      const raw = base32(crypto.randomBytes(RECOVERY_CODE_BYTES));
      codes.push((raw.match(/.{4}/g) as RegExpMatchArray).join("-"));
    }
    return codes;
  }

  /**
   * The canonical form of a submitted recovery code — upper case, without
   * spaces or hyphens — or null when it cannot be one.
   * @param input - the code as submitted
   * @returns the canonical form, or null
   */
  normalizeRecoveryCode(input: unknown): string | null {
    if (typeof input !== "string") {
      return null;
    }
    const canonical = input.replace(/[\s-]/g, "").toUpperCase();
    return RECOVERY_CODE_SHAPE.test(canonical) ? canonical : null;
  }

  /**
   * The stored form of a code for `userId`. The code must already be
   * normalized (normalizeRecoveryCode).
   * @param userId - the account
   * @param canonical - the normalized code
   * @returns hex SHA-256
   */
  hashRecoveryCode(userId: string, canonical: string | null): string {
    return crypto.createHash("sha256").update(`${userId}:${String(canonical)}`).digest("hex");
  }

  /**
   * The hashes to store for `codes`.
   * @param userId - the account
   * @param codes - as createRecoveryCodes returned them
   * @returns the hashes
   */
  hashRecoveryCodes(userId: string, codes: readonly string[]): string[] {
    return codes.map((code) => this.hashRecoveryCode(userId, this.normalizeRecoveryCode(code)));
  }

  /**
   * A-141 — accept `input` as the second factor ONCE, in place of a TOTP code.
   *
   * The same replay-safe shape as consumeCode: a CONDITIONAL update removes
   * the code's hash only `WHERE mfa_recovery_codes @> ARRAY[hash]`, and the
   * code is accepted only if exactly one row changed. Two requests racing
   * with the same code both find the hash in memory, but PostgreSQL
   * re-evaluates the WHERE for the second after the first commits, finds the
   * hash gone, and updates nothing.
   *
   * @param user - the user row (id, mfaRecoveryCodes)
   * @param input - the code as submitted
   * @param options - `transaction`: write the removal in it
   * @returns true when the code was unused and is now spent
   */
  async consumeRecoveryCode(user: MfaUser, input: unknown, { transaction }: { transaction?: Transaction | undefined } = {}): Promise<boolean> {
    const canonical = this.normalizeRecoveryCode(input);
    if (!canonical || !Array.isArray(user.mfaRecoveryCodes)) {
      return false;
    }
    const hash = this.hashRecoveryCode(user.id, canonical);
    if (!user.mfaRecoveryCodes.includes(hash)) {
      return false;
    }

    // Required here, not at the top — see consumeCode.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: required here (see consumeCode)
    const { Op, fn, col } = require("sequelize") as typeof SequelizeModule;
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: required here (see consumeCode)
    const { Users } = require("../models") as typeof ModelsModule;
    const removeOptions = {
      where: { id: user.id, mfaRecoveryCodes: { [Op.contains]: [hash] } },
      transaction,
    };
    const [affected] = await Users.update(
      { mfaRecoveryCodes: fn("array_remove", col("mfa_recovery_codes"), hash) } as unknown as Partial<Attributes<ModelInstance<"User">>>,
      removeOptions as unknown as UserUpdateOptions,
    );
    if (affected !== 1) {
      logger.warn("MFA recovery code refused: used concurrently", { userId: user.id });
      return false;
    }

    user.mfaRecoveryCodes = user.mfaRecoveryCodes.filter((stored) => stored !== hash);
    return true;
  }
}

const RECOVERY_CODE_COUNT = 10;
// 10 bytes = 80 bits = exactly 16 base32 characters.
const RECOVERY_CODE_BYTES = 10;
const RECOVERY_CODE_SHAPE = /^[A-Z2-7]{16}$/;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * RFC 4648 base32, no padding. Only ever called with 10 bytes, so the bit
 * count is a multiple of 5 and there is never a partial final group.
 * @param bytes - ten bytes
 * @returns the base32 text
 */
const base32 = (bytes: Buffer): string => {
  let bits = "";
  for (const byte of bytes) {
    bits += byte.toString(2).padStart(8, "0");
  }
  let out = "";
  for (let i = 0; i < bits.length; i += 5) {
    out += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)] as string;
  }
  return out;
};

// A-114: `generateSecret`, `verifyAndEnable` and `disable` were removed. No
// code called them; they kept an enrolment in `user.mfaSecretTemp`, which was
// an attribute of no model, so Sequelize dropped it on save(). Enrolment and
// rotation live in auth.service.js (setupMfa / verifyMfaSetup).

/**
 * S-20 — the pre-0086 (plaintext) form of an MFA column, for
 * keyRotation.service: a non-envelope value is a legacy seed, converted to an
 * envelope by migration 0086 and by keys:rotate. `unwrap` REFUSES a value
 * that is not a base32 seed — a corrupt or foreign value is reported by id,
 * never guessed at and sealed.
 */
const LEGACY_PLAINTEXT_SEED = Object.freeze({
  isLegacy: (stored: unknown): boolean => !kms.isEnvelope(stored),
  unwrap: (_aad: unknown, stored: string): string => {
    if (!SEED_SHAPE.test(stored)) {
      throw new Error("not a base32 TOTP seed (refusing to guess)");
    }
    return stored;
  },
});

/** What the module exports: the instance, carrying four more properties. */
type MfaServiceExport = MfaService & {
  secretAad: typeof secretAad;
  LEGACY_PLAINTEXT_SEED: typeof LEGACY_PLAINTEXT_SEED;
  RECOVERY_CODE_COUNT: typeof RECOVERY_CODE_COUNT;
  MFA_CLEARED: Readonly<Record<string, null | false>>;
};

// The exported object is the instance; the four properties are added to it in
// the JavaScript's order (`module.exports.x = …` one after another). Written as
// `const x = new X()` + `export = x;` so the audit-coverage guard
// (auditCoverage.p611) reads the class's methods as entry points.
const mfaService = new MfaService() as MfaServiceExport;
Object.assign(mfaService, {
  secretAad,
  LEGACY_PLAINTEXT_SEED,
  RECOVERY_CODE_COUNT,
  // A-141: every MFA column back to "never enrolled" — what a disable
  // (auth.service disableMfa) and an administrator's reset (user.service
  // resetUserMfa) write.
  MFA_CLEARED: Object.freeze({
    mfaEnabled: false,
    mfaSecret: null,
    mfaPendingSecret: null,
    mfaPendingCreatedAt: null,
    mfaLastUsedStep: null,
    mfaRecoveryCodes: null,
  }),
});

export = mfaService;

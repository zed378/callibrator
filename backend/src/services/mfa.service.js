const { logger } = require("../middlewares/activityLog.middleware");

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
const otp = () => require("otplib");

const TOTP_ISSUER = "Callibrator";

// ±30 s around "now" is exactly the previous, current and next 30-second step:
// tolerates one step of clock drift on the phone, and no more.
const TOTP_EPOCH_TOLERANCE_SECONDS = 30;

// otplib <= 12 generated 10-byte (80-bit, 16-character base32) secrets, the
// Google Authenticator convention. otplib 13 refuses secrets under 16 bytes by
// default, which would lock any such account out. VERIFICATION accepts them;
// every NEW secret is 20 bytes (RFC 4226's recommended 160 bits).
const LEGACY_MIN_SECRET_BYTES = 10;

const SIX_DIGITS = /^\d{6}$/;

let verifyGuardrails;
const guardrails = () => {
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
   * @returns {string}
   */
  createSecret() {
    return otp().generateSecret();
  }

  /**
   * The otpauth:// URI an authenticator app scans.
   * @param {string} label - the account name shown in the app (the email)
   * @param {string} secret - base32 secret
   * @returns {string}
   */
  buildOtpauthUri(label, secret) {
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
   * @param {unknown} token - the code as submitted (string, or a JSON number)
   * @param {string|null|undefined} secret - base32 secret
   * @returns {number|null} floor(epoch / 30) of the matching step
   */
  matchTimeStep(token, secret) {
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
      const result = otp().verifySync({
        secret,
        token: trimmed,
        epochTolerance: TOTP_EPOCH_TOLERANCE_SECONDS,
        guardrails: guardrails(),
      });
      return result.valid ? result.timeStep : null;
    } catch (err) {
      logger.error("TOTP verification failed on the stored secret", { error: err.message });
      return null;
    }
  }

  /**
   * Whether `token` is the TOTP for `secret` now, within ±1 time step.
   *
   * A PURE check: it does not record the code as used. Accepting a code as a
   * factor must go through `consumeCode` (A-115), or the code can be replayed.
   *
   * @param {unknown} token
   * @param {string|null|undefined} secret
   * @returns {boolean}
   */
  checkCode(token, secret) {
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
   * @param {object} user - the user row (id, mfaSecret, mfaLastUsedStep)
   * @param {unknown} token - the code as submitted
   * @param {object} [options]
   * @param {string} [options.secret] - verify against this secret instead of
   *   the live one (the pending secret, when enrolling)
   * @param {object} [options.transaction] - write the stamp in this transaction
   * @returns {Promise<boolean>} true when the code is right and unused
   */
  async consumeCode(user, token, { secret = user.mfaSecret, transaction } = {}) {
    const step = this.matchTimeStep(token, secret);
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
    const { Op } = require("sequelize");
    const { Users } = require("../models");
    const [affected] = await Users.update(
      { mfaLastUsedStep: step },
      {
        where: {
          id: user.id,
          [Op.or]: [{ mfaLastUsedStep: null }, { mfaLastUsedStep: { [Op.lt]: step } }],
        },
        transaction,
      },
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
   * @param {Object} user - The user instance
   * @param {string} token - The 6-digit TOTP token
   * @returns {Promise<boolean>}
   * @throws {Error} when the account has no MFA
   */
  async verifyLogin(user, token) {
    if (!user.mfaEnabled || !user.mfaSecret) {
      throw new Error("MFA is not enabled for this user.");
    }
    return this.consumeCode(user, token);
  }
}

// A-114: `generateSecret`, `verifyAndEnable` and `disable` were removed. No
// code called them; they kept an enrolment in `user.mfaSecretTemp`, which was
// an attribute of no model, so Sequelize dropped it on save(). Enrolment and
// rotation live in auth.service.js (setupMfa / verifyMfaSetup).

module.exports = new MfaService();

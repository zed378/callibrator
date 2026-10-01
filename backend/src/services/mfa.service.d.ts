/**
 * Types for `src/services/mfa.service.js`, which is still JavaScript (P9-12,
 * ADR-087 Amendment 13; the `config/index.d.ts` precedent). It emits nothing
 * and is never copied into `dist/`. It declares exactly what the module
 * exports: `module.exports = new MfaService()` (its methods, on the prototype)
 * plus four properties added to that instance. `tests/guards/declarationDrift`
 * holds it to the module. It is deleted when mfa.service.js converts.
 *
 * Members a converted TypeScript module calls are typed from the code. The
 * others are `(...args: never[]) => unknown`: callable only once someone types
 * them, which is the point — the first TypeScript caller writes the type.
 */
import type { Transaction } from "sequelize";

/** The account a code is checked against, as the methods read it. */
interface MfaUser {
  id: string;
  mfaSecret?: string | null;
  mfaLastUsedStep?: number | string | null;
  mfaRecoveryCodes?: string[] | null;
  update?: (values: Record<string, unknown>, options?: { transaction?: Transaction }) => Promise<unknown>;
}

/** Not yet typed: the first TypeScript caller types it. */
type Untyped = (...args: never[]) => unknown;

declare const mfaService: {
  /** A new base32 TOTP secret (20 random bytes, 32 characters). */
  createSecret(): string;
  /** S-20: the stored form of a seed, a KMS envelope bound to the account. */
  sealSecret(userId: string, secret: string): string;
  openSecret: Untyped;
  /** The otpauth:// URI an authenticator app scans. */
  buildOtpauthUri(label: string, secret: string): string;
  matchTimeStep: Untyped;
  checkCode: Untyped;
  /** True when the TOTP code is right and unused; the used step is stamped (in `transaction` when given). */
  consumeCode(
    user: MfaUser,
    token: unknown,
    options?: { secret?: string | null; transaction?: Transaction | undefined },
  ): Promise<boolean>;
  /**
   * A-115: verify a code against the account's live secret and consume it.
   * Throws for an account without MFA. Typed for certificate.service.
   */
  verifyLogin(user: MfaUser & { mfaEnabled?: boolean | null }, token: unknown): Promise<boolean>;
  /** Fresh recovery codes, shown once. */
  createRecoveryCodes(): string[];
  normalizeRecoveryCode: Untyped;
  hashRecoveryCode: Untyped;
  /** The stored (hashed) form of recovery codes. */
  hashRecoveryCodes(userId: string, codes: readonly string[]): string[];
  /** True when the recovery code was unused and is now spent (in `transaction` when given). */
  consumeRecoveryCode(
    user: MfaUser,
    input: unknown,
    options?: { transaction?: Transaction | undefined },
  ): Promise<boolean>;
  /** The KMS additional data a user's seed is bound to. */
  secretAad(userId: string): string;
  LEGACY_PLAINTEXT_SEED: {
    readonly isLegacy: (stored: unknown) => boolean;
    readonly unwrap: (aad: string, stored: string) => string;
  };
  RECOVERY_CODE_COUNT: number;
  /** The columns that turn MFA off (auth.service#disableMfa, user.service#resetUserMfa). */
  MFA_CLEARED: Readonly<{
    mfaEnabled: false;
    mfaSecret: null;
    mfaPendingSecret: null;
    mfaPendingCreatedAt: null;
    mfaLastUsedStep: null;
    mfaRecoveryCodes: null;
  }>;
};

export = mfaService;

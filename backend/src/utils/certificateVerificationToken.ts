/**
 * A-293 (ADR-100) — a certificate's verification token.
 *
 * The secret its QR code carries: the public verification endpoint answers
 * the FULL verdict (device, signer, document) only to a caller presenting it,
 * and the minimal verdict to anyone who merely knows — or walked to — the
 * sequential certificate number.
 *
 * 24 bytes from the CSPRNG, base64url: 32 URL-safe characters, 192 bits.
 * Stored in plaintext on purpose (certificates.verification_token, migration
 * 0096): the application reprints the same QR code from the certificate's
 * document at any time, and the token gates only disclosure detail that
 * anyone who can read the row already reads.
 */
import * as crypto from "crypto";

/** Bytes of entropy in a token. */
export const VERIFICATION_TOKEN_BYTES = 24;

/** A fresh token: 32 base64url characters. */
export const newVerificationToken = (): string => crypto.randomBytes(VERIFICATION_TOKEN_BYTES).toString("base64url");

/**
 * Whether `presented` is the certificate's token, compared in constant time.
 *
 * Anything but a non-empty string — an absent parameter, a repeated one
 * (Express parses `?token=a&token=b` as an array), a row with no token — is a
 * mismatch. Lengths are compared first because timingSafeEqual requires equal
 * lengths; the length of a public-format token is not a secret.
 */
export const verificationTokenMatches = (expected: unknown, presented: unknown): boolean => {
  if (typeof expected !== "string" || typeof presented !== "string" || expected === "" || presented === "") {
    return false;
  }
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(presented, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

/**
 * Token and authentication types shared by utils/jwt.util and the identity
 * services that sign and read tokens (P9-12, ADR-087 Amendment 13).
 */

/**
 * The claims a token is signed with. Identifiers only (A-59); jsonwebtoken adds
 * `iat`/`exp`. Any object: a named claims interface (ActivationClaims) has no
 * index signature, and jsonwebtoken signs any object.
 */
export type TokenClaims = object;

/**
 * A decoded token payload. Every claim is `unknown` until read and checked:
 * jsonwebtoken's own `JwtPayload` types them `any`.
 */
export interface TokenPayload {
  [claim: string]: unknown;
  typ?: unknown;
}

/** What jsonwebtoken returns when it verifies or decodes: a payload object, or a string payload. */
export type DecodedToken = string | TokenPayload;

/** The single-purpose token types (A-59): refused as bearer credentials, accepted only for their purpose. */
/**
 * `password-change` (P10-16, ADR-099): issued by a one-time password's first
 * sign-in, accepted only by POST /auth/first-sign-in/password.
 */
export type TokenPurpose = "activation" | "mfa" | "socket" | "password-change";

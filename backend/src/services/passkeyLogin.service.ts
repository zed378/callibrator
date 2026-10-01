/**
 * P10-10 (ADR-098 §5, Q-46) — passwordless sign-in with a passkey.
 * Spec: MEMORY/specs/P10-10-passkey-login.md.
 *
 * `/webauthn/login-options` and `/webauthn/verify-login` are a STEP-UP inside
 * an existing session (webauthn.route.js puts `auth` on every route). This is
 * the ceremony a signed-OUT user can run:
 *
 *  1. `getPasskeyLoginOptions()` — NO identifier in, and NO `allowCredentials`
 *     out: the browser offers whatever discoverable credential it holds for
 *     the RP. Asking for an address first and returning that account's
 *     credential would answer "does this account have a passkey" (an oracle).
 *     The challenge is bound to a random CEREMONY id (not a user), stored
 *     under its hash for 120 s, and spent once.
 *  2. `verifyPasskeyLogin()` — the credential id names the account (the only
 *     `skipTenantScope` of the path: before authentication the tenant is what
 *     we are trying to learn); the assertion is verified with user
 *     verification REQUIRED, origin and RP id checked, the user handle
 *     matched, the signature counter checked; then the SAME post-credential
 *     refusals, session, LOGIN row and answer as a password sign-in
 *     (auth.service#completePasswordlessSignIn).
 *
 * MFA (Q-46, working decision; ADR-059 amended): a user-verifying passkey is
 * possession (the authenticator's private key, which never leaves it) plus
 * inherence or knowledge (the biometric or PIN that unlocks it), and it is
 * phishing-resistant (the signature is bound to the origin) — NIST SP 800-63B
 * AAL3-style multi-factor. So no TOTP step follows, for platform operators too;
 * the session's `amr` is "passkey", which mfaPolicy#mfaEnrolmentRequired
 * accepts as MFA. An assertion WITHOUT user verification is refused.
 *
 * Every failure before the account is proven — unknown or spent ceremony,
 * unknown credential, bad signature, no user verification, counter regression,
 * wrong user handle — is ONE 401 with the password sign-in's message.
 */
import { createHash, randomBytes } from "crypto";
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type VerifiedAuthenticationResponse,
} from "@simplewebauthn/server";
import models from "../models";
import { db } from "../config";
import redis from "./redis.service";
import rateLimiter from "./rateLimiter.redis.service";
import auditService from "./audit.service";
import { AppError } from "../utils/appError.util";
import { logger } from "../middlewares/activityLog.middleware";
import { envOr } from "../config/env";
import { PLATFORM_TENANT_ID } from "../constants/platformTenant";
import { SYSTEM_ACTORS } from "../constants/systemActors";
import type { ModelInstance } from "../types/models";

const { Users, Role, WebauthnCredential } = models;

type UserRow = ModelInstance<"User">;
type CredentialRow = ModelInstance<"WebauthnCredential">;

/** The sign-in method recorded on the session (`amr`) and the LOGIN row. */
export const PASSKEY_METHOD = "passkey";

/** The ceremony's lifetime: a person picks a passkey in well under two minutes. */
export const CEREMONY_TTL_SECONDS = 120;

/** The one answer to every failure before the account is proven (auth.service's). */
export const INVALID_CREDENTIALS = "Invalid credentials";

/** The password path's pause message, for the same throttle (A-185). */
const SIGN_IN_PAUSED =
  "Too many failed sign-in attempts. Wait a few minutes, then try again.";

// Read at CALL time (tests set them); the same variables and defaults as webauthn.service.
const rpId = (): string => envOr("WEBAUTHN_RP_ID", "localhost");
const expectedOrigin = (): string =>
  envOr(
    "WEBAUTHN_ORIGIN",
    rpId() === "localhost" ? "http://localhost:3000" : `https://${rpId()}`,
  );

/** Where a ceremony's challenge lives: under the HASH of its id, so the store never holds the id itself. */
export const ceremonyKey = (ceremonyId: string): string =>
  `webauthn:pl:${createHash("sha256").update(ceremonyId).digest("hex")}`;

/** auth.service (JavaScript until P9-12 converts it), as this module calls it. */
interface AuthService {
  tenantInclude: () => Record<string, unknown>;
  completePasswordlessSignIn: (
    user: UserRow,
    context: { ip: string | null; userAgent: string | null; method: string },
  ) => Promise<Record<string, unknown>>;
}

/** Lazily: auth.service loads the session, e-mail and Redis services (as webauthn.service does). */
const authService = (): AuthService =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- a lazy require of a JavaScript module, typed by the two members used
  require("./auth.service") as AuthService;

/**
 * Start a ceremony. The same shape for every caller: a fresh challenge and a
 * fresh ceremony id, nothing about any account.
 */
export const getPasskeyLoginOptions = async (): Promise<{
  ceremonyId: string;
  options: PublicKeyCredentialRequestOptionsJSON;
}> => {
  const options = await generateAuthenticationOptions({
    rpID: rpId(),
    allowCredentials: [],
    userVerification: "required",
    timeout: 60000,
  });
  const ceremonyId = randomBytes(32).toString("base64url");
  const stored = await redis.set(
    ceremonyKey(ceremonyId),
    options.challenge,
    CEREMONY_TTL_SECONDS,
  );
  if (!stored) {
    // No shared store: the ceremony could not be verified later.
    throw new AppError(503, "Passkey sign-in is temporarily unavailable");
  }
  return { ceremonyId, options };
};

/** What the verify request carries (already shape-checked by the validator). */
export interface PasskeyAssertion {
  readonly ceremonyId: string;
  readonly credential: AuthenticationResponseJSON;
}

/** Where the request came from (never the body). */
export interface SignInContext {
  readonly ip: string | null;
  readonly userAgent: string | null;
}

const refuse = (): AppError => new AppError(401, INVALID_CREDENTIALS);

/** The WebAuthn user handle registration gave this account (`Buffer.from(user.id)`, webauthn.service). */
export const userHandleOf = (userId: string): string =>
  Buffer.from(userId).toString("base64url");

/** A passkey and the account holding it, across tenants, with what the sign-in rules read. */
interface Found {
  readonly user: UserRow;
  readonly passkey: CredentialRow;
}

/**
 * ADR-108 Amendment 1: the passkey is looked up in `webauthn_credentials`
 * (several per user), then its account. The account's flag must be on: a reset
 * or remove-all voids every passkey (the User model's hook deletes them too).
 */
const findByCredential = async (credentialId: string): Promise<Found | null> => {
  // Not tenant-scoped by column (a child of its user): no hook to bypass here.
  const passkey = await WebauthnCredential.findOne({ where: { credentialId } });
  if (!passkey) {
    return null;
  }
  const user = await Users.findOne({
    where: { id: passkey.userId, webauthnEnabled: true },
    include: [
      // ADR-043: `roleLevel` is what rbac() and the MFA policy compare.
      { model: Role, as: "role", attributes: ["id", "name", "roleLevel"], required: false },
      authService().tenantInclude(),
    ],
    // Pre-authentication: the tenant is what this lookup is for. The ONE
    // bypass of the tenant hooks on this path (spec § Security checklist); the
    // account is named by the credential, whose id is globally unique.
    skipTenantScope: true,
  });
  return user ? { user, passkey } : null;
};

/**
 * Count a failed ceremony for a KNOWN credential against its account's
 * sign-in throttle — passkey and password guessing share one ceiling (A-185).
 */
const noteFailure = async (
  user: UserRow,
  context: SignInContext,
): Promise<void> => {
  await rateLimiter.recordLoginFailure({
    identifier: user.email,
    ip: context.ip,
  });
};

/** A counter that did not advance: a possibly cloned authenticator. Refused, audited, the count left alone. */
const refuseCounterRegression = async (
  user: UserRow,
  stored: number,
  presented: number,
  context: SignInContext,
): Promise<never> => {
  // Its own transaction (P6-11): the row is the whole write, so it commits or the refusal says so.
  await db.transaction((transaction) =>
    auditService.logAction(
      {
        tenantId: user.tenantId ?? PLATFORM_TENANT_ID,
        // The system refused a credential; the account is the RESOURCE, not the
        // actor (the A-126 rule for ACCOUNT_LOCKED rows).
        systemActor: SYSTEM_ACTORS.AUTH_LOCKOUT,
        action: "UPDATE",
        resourceType: "User",
        resourceId: user.id,
        changes: {
          operation: "PASSKEY_COUNTER_REGRESSION",
          storedCount: stored,
          presentedCount: presented,
        },
        ipAddress: context.ip,
        userAgent: context.userAgent,
      },
      { transaction },
    ),
  );
  logger.warn(
    "Passkey sign-in refused: the signature counter did not advance",
    { userId: user.id },
  );
  await noteFailure(user, context);
  throw refuse();
};

/**
 * Finish a ceremony and sign in.
 *
 * @returns exactly what a completed password sign-in returns (auth.service)
 * @throws {AppError} 401 generic; 429 paused; 403/423 as the password path
 */
export const verifyPasskeyLogin = async (
  { ceremonyId, credential }: PasskeyAssertion,
  context: SignInContext,
): Promise<Record<string, unknown>> => {
  // Single use: read and delete in one step, before anything else.
  const challenge = await redis.getDel(ceremonyKey(ceremonyId));
  if (typeof challenge !== "string" || challenge === "") {
    throw refuse();
  }

  const found = await findByCredential(credential.id);
  if (!found) {
    logger.info("Passkey sign-in refused: unknown credential");
    throw refuse();
  }
  const { user, passkey } = found;

  // A-185: a paused account is paused for every way in.
  const attempt = { identifier: user.email, ip: context.ip };
  if ((await rateLimiter.checkLoginThrottle(attempt)).throttled) {
    throw new AppError(429, SIGN_IN_PAUSED);
  }

  // The handle the authenticator stored at registration names this account.
  if (credential.response.userHandle !== userHandleOf(user.id)) {
    logger.info("Passkey sign-in refused: the user handle does not match", {
      userId: user.id,
    });
    await noteFailure(user, context);
    throw refuse();
  }

  const storedCount = Number(passkey.signCount);
  let verification: VerifiedAuthenticationResponse;
  try {
    verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: challenge,
      expectedOrigin: expectedOrigin(),
      expectedRPID: rpId(),
      requireUserVerification: true,
      credential: {
        // The row was found BY this id, so it is the stored one.
        id: credential.id,
        publicKey: Buffer.from(passkey.publicKey, "base64url"),
        // The counter is checked BELOW, so a regression is refused AND audited
        // (the library would only throw).
        counter: 0,
      },
    });
  } catch (err) {
    logger.info("Passkey sign-in refused: the assertion did not verify", {
      userId: user.id,
      error: (err as Error).message,
    });
    await noteFailure(user, context);
    throw refuse();
  }
  if (!verification.verified) {
    await noteFailure(user, context);
    throw refuse();
  }

  const presentedCount = verification.authenticationInfo.newCounter;
  if (
    (storedCount > 0 || presentedCount > 0) &&
    presentedCount <= storedCount
  ) {
    return refuseCounterRegression(user, storedCount, presentedCount, context);
  }
  await passkey.update({ signCount: presentedCount, lastUsedAt: new Date() });

  const result = await authService().completePasswordlessSignIn(user, {
    ip: context.ip,
    userAgent: context.userAgent,
    method: PASSKEY_METHOD,
  });
  await rateLimiter.clearLoginThrottle(attempt);
  return result;
};

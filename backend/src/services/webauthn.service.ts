/**
 * WebAuthn / passkey service.
 *
 * Real FIDO2 attestation and assertion verification via @simplewebauthn/server:
 * registration parses the authenticator's attestation and stores its actual COSE
 * public key + signature counter; authentication verifies the assertion
 * signature over authenticatorData||SHA256(clientDataJSON) against that stored
 * key and enforces counter monotonicity (clone/rollback detection).
 *
 * The registration/authentication challenge is held in Redis (shared, TTL'd) so
 * the flow is correct across multiple instances — a per-process Map would fail
 * whenever options are issued on one instance and verified on another.
 *
 * P9-12 (ADR-087 Amendment 13): converted from webauthn.service.js with no
 * behaviour change. `export =` keeps the exact object `require()` returned.
 */

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  type VerifiedAuthenticationResponse,
  type VerifiedRegistrationResponse,
} from "@simplewebauthn/server";
import type { Transaction } from "sequelize";

import models from "../models";
import { db } from "../config";
import { AppError } from "../utils/appError.util";
import { logger } from "../middlewares/activityLog.middleware";
import redis from "./redis.service";
import { envOr } from "../config/env";
import type { TenantId } from "../types/ids";
import type { ModelInstance } from "../types/models";

const { Users, WebauthnCredential } = models;

/**
 * ADR-108 Amendment 1: how many passkeys one account may hold. Enough for a
 * phone, a laptop, a tablet and a couple of security keys; a bound, so a
 * stolen session cannot fill the table.
 */
const MAX_PASSKEYS_PER_USER = 10;

/** The default name of a passkey the user did not name. */
const DEFAULT_PASSKEY_NAME = "Passkey";

type CredentialRow = ModelInstance<"WebauthnCredential">;

type UserRow = ModelInstance<"User">;

// Q-43 (ADR-098 §8.1): the name the browser's passkey prompt shows (the RP ID, not this, binds the credential).
const RP_NAME = "Device Calibrator";
const RP_ID = envOr("WEBAUTHN_RP_ID", "localhost");
// The origin the browser reports in clientDataJSON. Must match exactly.
const ORIGIN = envOr(
  "WEBAUTHN_ORIGIN",
  RP_ID === "localhost" ? "http://localhost:3000" : `https://${RP_ID}`,
);
const CHALLENGE_TTL_SECONDS = 300; // 5 minutes

const challengeKey = (userId: unknown): string => `webauthn:challenge:${String(userId)}`;

/** `err.message`, read exactly as the JavaScript did. */
const messageOf = (err: unknown): unknown => (err as { message?: unknown }).message;

function base64urlEncode(buffer: Uint8Array): string {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlToBuffer(str: string): Buffer<ArrayBuffer> {
  let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) {
    b64 += "=";
  }
  return Buffer.from(b64, "base64");
}

async function storeChallenge(userId: unknown, challenge: string): Promise<void> {
  const ok = await redis.set(challengeKey(userId), challenge, CHALLENGE_TTL_SECONDS);
  if (!ok) {
    // No shared store means we cannot safely verify later — fail loudly rather
    // than silently degrade to an unverifiable flow.
    throw new AppError(503, "WebAuthn temporarily unavailable");
  }
}

async function consumeChallenge(userId: unknown): Promise<unknown> {
  const challenge = await redis.get(challengeKey(userId));
  await redis.del(challengeKey(userId));
  return challenge;
}

/** The account a registration is for, as far as the options read it. */
interface RegistrationUser {
  id: unknown;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
}

/** An enrolled credential, to exclude from a new registration. */
interface ExistingCredential {
  credentialId: string;
  transports?: string[] | undefined;
}

/**
 * Build registration (attestation) options and stash the challenge.
 */
async function getRegistrationOptions(
  user: RegistrationUser,
  existingCredentials?: readonly ExistingCredential[],
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  // ADR-108 Amendment 1: the authenticator is told which of this account's
  // passkeys it already holds, so it does not enrol the same one twice.
  const enrolled =
    existingCredentials ??
    (await WebauthnCredential.findAll({
      where: { userId: String(user.id) },
      attributes: ["credentialId", "transports"],
    })).map((c) => ({ credentialId: c.credentialId, transports: c.transports ?? undefined }));
  if (enrolled.length >= MAX_PASSKEYS_PER_USER) {
    throw new AppError(
      409,
      `This account already has ${String(MAX_PASSKEYS_PER_USER)} passkeys, the most it can hold; remove one before adding another`,
    );
  }
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: Buffer.from(String(user.id)),
    userName: user.email,
    userDisplayName:
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `||`
      `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email,
    attestationType: "none",
    // The library's type omits `undefined` for `transports`; the JavaScript passed the stored value through.
    excludeCredentials: enrolled.map((cred) => ({
      id: cred.credentialId,
      transports: cred.transports,
    })) as { id: string; transports?: string[] }[],
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
    timeout: 60000,
  });

  await storeChallenge(user.id, options.challenge);
  return options;
}

/**
 * Build authentication (assertion) options and stash the challenge. Restricts
 * allowCredentials to the user's enrolled credential when present.
 */
async function getLoginOptions(userId: string): Promise<PublicKeyCredentialRequestOptionsJSON> {
  // ADR-108 Amendment 1: any of the caller's passkeys may answer the step-up.
  const allowCredentials = (
    await WebauthnCredential.findAll({ where: { userId }, attributes: ["credentialId"] })
  ).map((c) => ({ id: c.credentialId }));

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    allowCredentials,
    userVerification: "required",
    timeout: 60000,
  });

  await storeChallenge(userId, options.challenge);
  return options;
}

/** What a registration records besides the attestation. */
interface RegistrationContext {
  name?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Verify an attestation and store the authenticator's real public key as a
 * NEW passkey of the caller (ADR-108 Amendment 1: several per user).
 *
 * The passkey row, the account's "has a passkey" flag and the audit row
 * (UPDATE on User, `changes.operation` WEBAUTHN_REGISTER — never the key or
 * the credential id) commit together. When the flag was off — every passkey
 * removed, or an administrator's reset — any row left from before is purged
 * first, so a reset passkey can never come back.
 *
 * @throws {AppError} 400 the challenge or the attestation; 404 no such user in
 *   the tenant; 409 the limit, or a credential already enrolled
 */
async function verifyRegistration(
  tenantId: TenantId | null,
  userId: string,
  attestationResponse: RegistrationResponseJSON,
  { name = null, ipAddress = null, userAgent = null }: RegistrationContext = {},
): Promise<{ success: true; credential: PasskeySummary }> {
  const expectedChallenge = await consumeChallenge(userId);
  if (!expectedChallenge) {
    throw new AppError(400, "Challenge expired or not found");
  }

  let verification: VerifiedRegistrationResponse;
  try {
    verification = await verifyRegistrationResponse({
      response: attestationResponse,
      // The challenge this module stored (a string); verification refuses any other value.
      expectedChallenge: expectedChallenge as string,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: true,
    });
  } catch (err) {
    logger.error("WebAuthn attestation verification failed", {
      error: messageOf(err),
    });
    throw new AppError(400, "WebAuthn registration failed");
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: a verified result without registrationInfo is refused too
  if (!verification.verified || !verification.registrationInfo) {
    throw new AppError(400, "WebAuthn registration could not be verified");
  }

  const { credential } = verification.registrationInfo;
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: a lazy require (auth.service loads the session, e-mail and Redis services)
  const authService = require("./auth.service") as AuthForWebauthn;

  const created = await db.transaction(async (transaction) => {
    const user = await Users.findOne({ where: { id: userId, tenantId }, transaction });
    if (!user) {
      throw new AppError(404, "User not found");
    }
    if (!user.webauthnEnabled) {
      // Rows left from before a reset or a remove-all never come back.
      await WebauthnCredential.destroy({ where: { userId }, transaction });
    }
    const held = await WebauthnCredential.count({ where: { userId }, transaction });
    if (held >= MAX_PASSKEYS_PER_USER) {
      throw new AppError(409, `This account already has ${String(MAX_PASSKEYS_PER_USER)} passkeys; remove one first`);
    }
    if (await WebauthnCredential.count({ where: { credentialId: credential.id }, transaction })) {
      throw new AppError(409, "This passkey is already registered");
    }
    const row = await WebauthnCredential.create(
      {
        userId,
        credentialId: credential.id,
        publicKey: base64urlEncode(credential.publicKey),
        signCount: credential.counter,
        name: passkeyName(name, held),
        transports: knownTransports(credential.transports),
      },
      { transaction },
    );
    if (!user.webauthnEnabled) {
      await user.update({ webauthnEnabled: true }, { transaction });
    }
    await authService.auditCredentialChange(transaction, {
      user,
      // Never the credential id or key: audit_logs is permanent.
      operation: "WEBAUTHN_REGISTER",
      details: { passkeyId: row.id, name: row.name, passkeysHeld: held + 1 },
      ipAddress,
      userAgent,
    });
    return row;
  });

  return { success: true, credential: summarise(created) };
}

/**
 * Verify an assertion (the signed-in step-up) against the caller's passkey it
 * names, and advance that passkey's signature counter.
 */
async function verifyLogin(
  tenantId: TenantId | null,
  userId: string,
  assertionResponse: AuthenticationResponseJSON,
): Promise<{ success: true }> {
  const user = await Users.findOne({ where: { id: userId, tenantId } });
  if (!user?.webauthnEnabled) {
    throw new AppError(404, "WebAuthn not enabled for this user");
  }
  // Only the caller's own passkey: another account's credential id finds nothing.
  const passkey = await WebauthnCredential.findOne({
    where: { userId, credentialId: assertionResponse.id },
  });
  if (!passkey) {
    throw new AppError(401, "WebAuthn authentication failed");
  }

  const expectedChallenge = await consumeChallenge(userId);
  if (!expectedChallenge) {
    throw new AppError(400, "Challenge expired or not found");
  }

  let verification: VerifiedAuthenticationResponse;
  try {
    verification = await verifyAuthenticationResponse({
      response: assertionResponse,
      // The challenge this module stored (a string); verification refuses any other value.
      expectedChallenge: expectedChallenge as string,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: true,
      credential: {
        id: passkey.credentialId,
        publicKey: base64urlToBuffer(passkey.publicKey),
        counter: Number(passkey.signCount),
      },
    });
  } catch (err) {
    logger.error("WebAuthn assertion verification failed", {
      error: messageOf(err),
    });
    throw new AppError(401, "WebAuthn authentication failed");
  }

  if (!verification.verified) {
    throw new AppError(401, "WebAuthn authentication failed");
  }

  await passkey.update({ signCount: verification.authenticationInfo.newCounter, lastUsedAt: new Date() });

  return { success: true };
}

/** What getStatus reports. */
interface WebauthnStatus {
  enabled: boolean;
  /** How many passkeys the account holds (ADR-108 Amendment 1). */
  count: number;
  /** The highest signature counter among them (as the one-passkey answer reported it). */
  signCount: number;
  lastUpdatedAt: Date | null;
}

async function getStatus(tenantId: TenantId | null, userId: string): Promise<WebauthnStatus> {
  const user = await Users.findOne({
    where: { id: userId, tenantId },
    attributes: ["webauthnEnabled", "updatedAt"],
  });

  if (!user) {
    throw new AppError(404, "User not found");
  }

  const passkeys = user.webauthnEnabled
    ? await WebauthnCredential.findAll({ where: { userId }, attributes: ["signCount", "updatedAt"] })
    : [];
  return {
    enabled: passkeys.length > 0,
    count: passkeys.length,
    signCount: passkeys.reduce((max, p) => Math.max(max, Number(p.signCount)), 0),
    // The credential ids themselves are not exposed — only what is enrolled.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: `updatedAt || null` (the attribute list could omit it)
    lastUpdatedAt: user.updatedAt || null,
  };
}

/** A passkey as its owner sees it: never the credential id or the key. */
interface PasskeySummary {
  id: string;
  name: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  transports: string[] | null;
}

const summarise = (row: CredentialRow): PasskeySummary => ({
  id: row.id,
  name: row.name,
  createdAt: row.createdAt,
  lastUsedAt: row.lastUsedAt,
  transports: row.transports,
});

/** The WebAuthn transport names the column accepts (utils/jsonShape: WebauthnCredential.transports). */
const TRANSPORTS = ["ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"] as const;
type Transport = (typeof TRANSPORTS)[number];
const isTransport = (value: string): value is Transport => (TRANSPORTS as readonly string[]).includes(value);

/** An authenticator's reported transports, keeping only the names WebAuthn defines; none → null. */
const knownTransports = (reported: readonly string[] | undefined): Transport[] | null => {
  const known = (reported ?? []).filter(isTransport);
  return known.length > 0 ? [...new Set(known)] : null;
};

/** The name to store: the user's, trimmed to the column, else "Passkey N". */
const passkeyName = (name: string | null, held: number): string => {
  const trimmed = (name ?? "").trim().slice(0, 64);
  return trimmed || (held === 0 ? DEFAULT_PASSKEY_NAME : `${DEFAULT_PASSKEY_NAME} ${String(held + 1)}`);
};

/**
 * ADR-108 Amendment 1 — the caller's passkeys, oldest first. An account whose
 * flag is off (reset or all removed) has none, whatever rows are left.
 */
async function listPasskeys(tenantId: TenantId | null, userId: string): Promise<PasskeySummary[]> {
  const user = await Users.findOne({ where: { id: userId, tenantId }, attributes: ["id", "webauthnEnabled"] });
  if (!user) {
    throw new AppError(404, "User not found");
  }
  if (!user.webauthnEnabled) {
    return [];
  }
  const rows = await WebauthnCredential.findAll({ where: { userId }, order: [["createdAt", "ASC"]] });
  return rows.map(summarise);
}

/** One of the CALLER's passkeys, or the 404 every other id gets (another user's, another tenant's, none). */
const ownPasskey = async (userId: string, passkeyId: string, transaction: Transaction): Promise<CredentialRow> => {
  const row = await WebauthnCredential.findOne({
    where: { id: passkeyId, userId },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (!row) {
    throw new AppError(404, "Passkey not found");
  }
  return row;
};

/** Rename one of the caller's passkeys (audited: the name is the account holder's own label). */
async function renamePasskey(
  tenantId: TenantId | null,
  userId: string,
  passkeyId: string,
  name: string,
  { ipAddress = null, userAgent = null }: RequestContext = {},
): Promise<PasskeySummary> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: a lazy require
  const authService = require("./auth.service") as AuthForWebauthn;
  return db.transaction(async (transaction) => {
    const user = await Users.findOne({ where: { id: userId, tenantId }, transaction });
    if (!user?.webauthnEnabled) {
      throw new AppError(404, "Passkey not found");
    }
    const row = await ownPasskey(userId, passkeyId, transaction);
    const before = row.name;
    await row.update({ name: passkeyName(name, 0) }, { transaction });
    await authService.auditCredentialChange(transaction, {
      user,
      operation: "WEBAUTHN_RENAME",
      details: { passkeyId: row.id, before: { name: before }, after: { name: row.name } },
      ipAddress,
      userAgent,
    });
    return summarise(row);
  });
}

/**
 * Revoke ONE of the caller's passkeys (ADR-108 Amendment 1).
 *
 * THE LOCK-OUT GUARD. It needs the A-213/A-114 re-authentication: the current
 * password (and, with MFA, a current code), proven in this transaction. So the
 * last passkey can only be removed by someone who has just shown that the
 * password sign-in still works — removing it can never leave the account with
 * no way in. Without that proof the answer is the 400 of reauthenticate and
 * nothing is removed. The last one also turns the account's flag off.
 *
 * @throws {AppError} 404 not the caller's passkey (another user's or tenant's
 *   id is indistinguishable from none); 400 re-authentication missing or wrong
 */
async function revokePasskey(
  tenantId: TenantId | null,
  userId: string,
  passkeyId: string,
  proof: ReauthProof = {},
  { ipAddress = null, userAgent = null }: RequestContext = {},
): Promise<{ success: true; remaining: number }> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: a lazy require
  const authService = require("./auth.service") as AuthForWebauthn;
  return db.transaction(async (transaction) => {
    const user = await Users.findOne({ where: { id: userId, tenantId }, transaction });
    if (!user?.webauthnEnabled) {
      throw new AppError(404, "Passkey not found");
    }
    const row = await ownPasskey(userId, passkeyId, transaction);
    const remaining = (await WebauthnCredential.count({ where: { userId }, transaction })) - 1;
    const method = await authService.reauthenticate(user, proof, {
      purpose: remaining === 0 ? "Removing your last passkey" : "Removing a passkey",
      transaction,
      ipAddress,
      userAgent,
    });
    await row.destroy({ transaction });
    if (remaining === 0) {
      await user.update({ webauthnEnabled: false }, { transaction });
    }
    await authService.auditCredentialChange(transaction, {
      user,
      operation: "WEBAUTHN_REVOKE",
      details: { passkeyId: row.id, name: row.name, remaining, reauthenticatedWith: method },
      ipAddress,
      userAgent,
    });
    return { success: true as const, remaining };
  });
}

/** The re-authentication proof disable() takes. */
interface ReauthProof {
  // P9-20: `undefined` admitted, as a request body gives it (type-only).
  currentPassword?: string | undefined;
  code?: string | undefined;
  recoveryCode?: string | undefined;
}

/** The request context disable() records. */
interface RequestContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** The two auth.service functions disable() calls (auth.service is loaded lazily). */
interface AuthForWebauthn {
  reauthenticate: (
    user: UserRow,
    proof: ReauthProof,
    options: { purpose: string; transaction: Transaction; ipAddress: string | null; userAgent: string | null },
  ) => Promise<string>;
  auditCredentialChange: (
    transaction: Transaction,
    entry: {
      user: UserRow;
      operation: string;
      details: Record<string, unknown>;
      ipAddress: string | null;
      userAgent: string | null;
    },
  ) => Promise<void>;
}

/**
 * A-213 (ADR-068) — remove the caller's passkey.
 *
 * It used to need nothing but the session and write no audit row: whoever held
 * a stolen cookie could remove the owner's passkey unrecorded. Now it needs
 * the A-114 re-authentication (auth.service#reauthenticate: the current
 * password, and on an MFA account a current TOTP or recovery code, spent in
 * this transaction), and the change and its audit row (UPDATE on User,
 * `changes.operation` WEBAUTHN_DISABLE) commit together or not at all.
 *
 * @param tenantId - the caller's tenant
 * @param userId - the caller
 * @param proof - `{ currentPassword, code, recoveryCode }`
 * @param context - `{ ipAddress, userAgent }`
 * @returns `{ success: true }`
 * @throws {AppError} 404 no such user in the tenant; 409 no passkey enrolled;
 *   400 re-authentication missing or wrong
 */
async function disableWebauthn(
  tenantId: TenantId | null,
  userId: string,
  proof: ReauthProof = {},
  { ipAddress = null, userAgent = null }: RequestContext = {},
): Promise<{ success: true }> {
  // Lazily: auth.service loads the session, e-mail and Redis services.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: a lazy require
  const authService = require("./auth.service") as AuthForWebauthn;

  const user = await Users.findOne({ where: { id: userId, tenantId } });
  if (!user) {
    throw new AppError(404, "User not found");
  }
  if (!user.webauthnEnabled) {
    throw new AppError(409, "No passkey is enrolled on this account, so there is nothing to remove");
  }

  await db.transaction(async (transaction) => {
    const method = await authService.reauthenticate(user, proof, {
      purpose: "Removing a passkey",
      transaction,
      ipAddress,
      userAgent,
    });
    const removed = await WebauthnCredential.count({ where: { userId }, transaction });
    // Turning the flag off removes every passkey (the User model's hook).
    await user.update({ webauthnEnabled: false }, { transaction });
    await authService.auditCredentialChange(transaction, {
      user,
      // Never the credential id or key: audit_logs is permanent.
      operation: "WEBAUTHN_DISABLE",
      details: { reauthenticatedWith: method, passkeysRemoved: removed },
      ipAddress,
      userAgent,
    });
  });

  return { success: true };
}

export = {
  getStatus,
  getRegistrationOptions,
  getLoginOptions,
  verifyRegistration,
  verifyLogin,
  disable: disableWebauthn,
  // ADR-108 Amendment 1: several passkeys per user.
  listPasskeys,
  renamePasskey,
  revokePasskey,
  MAX_PASSKEYS_PER_USER,
};

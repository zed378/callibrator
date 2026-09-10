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
 */

const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require("@simplewebauthn/server");

const { Users } = require("../models");
const { AppError } = require("../utils/appError.util");
const { logger } = require("../middlewares/activityLog.middleware");
const redis = require("./redis.service");

const RP_NAME = "Callibrator";
const RP_ID = process.env.WEBAUTHN_RP_ID || "localhost";
// The origin the browser reports in clientDataJSON. Must match exactly.
const ORIGIN =
  process.env.WEBAUTHN_ORIGIN ||
  (RP_ID === "localhost" ? "http://localhost:3000" : `https://${RP_ID}`);
const CHALLENGE_TTL_SECONDS = 300; // 5 minutes

const challengeKey = (userId) => `webauthn:challenge:${userId}`;

function base64urlEncode(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlToBuffer(str) {
  let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) {
    b64 += "=";
  }
  return Buffer.from(b64, "base64");
}

async function storeChallenge(userId, challenge) {
  const ok = await redis.set(challengeKey(userId), challenge, CHALLENGE_TTL_SECONDS);
  if (!ok) {
    // No shared store means we cannot safely verify later — fail loudly rather
    // than silently degrade to an unverifiable flow.
    throw new AppError(503, "WebAuthn temporarily unavailable");
  }
}

async function consumeChallenge(userId) {
  const challenge = await redis.get(challengeKey(userId));
  await redis.del(challengeKey(userId));
  return challenge;
}

/**
 * Build registration (attestation) options and stash the challenge.
 */
async function getRegistrationOptions(user, existingCredentials = []) {
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: Buffer.from(String(user.id)),
    userName: user.email,
    userDisplayName:
      `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email,
    attestationType: "none",
    excludeCredentials: existingCredentials.map((cred) => ({
      id: cred.credentialId,
      transports: cred.transports,
    })),
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
async function getLoginOptions(userId) {
  const user = await Users.findOne({ where: { id: userId } });

  const allowCredentials =
    user && user.webauthnCredentialId
      ? [{ id: user.webauthnCredentialId }]
      : [];

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    allowCredentials,
    userVerification: "required",
    timeout: 60000,
  });

  await storeChallenge(userId, options.challenge);
  return options;
}

/**
 * Verify an attestation and persist the authenticator's real public key.
 */
async function verifyRegistration(tenantId, userId, attestationResponse) {
  const expectedChallenge = await consumeChallenge(userId);
  if (!expectedChallenge) {
    throw new AppError(400, "Challenge expired or not found");
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: attestationResponse,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: true,
    });
  } catch (err) {
    logger.error("WebAuthn attestation verification failed", {
      error: err.message,
    });
    throw new AppError(400, "WebAuthn registration failed");
  }

  if (!verification.verified || !verification.registrationInfo) {
    throw new AppError(400, "WebAuthn registration could not be verified");
  }

  const { credential } = verification.registrationInfo;

  await Users.update(
    {
      webauthnCredentialId: credential.id,
      webauthnPublicKey: base64urlEncode(credential.publicKey),
      webauthnSignCount: credential.counter,
      webauthnEnabled: true,
    },
    { where: { id: userId, tenantId } },
  );

  return { success: true };
}

/**
 * Verify an assertion signature against the stored public key and advance the
 * signature counter.
 */
async function verifyLogin(tenantId, userId, assertionResponse) {
  const user = await Users.findOne({ where: { id: userId, tenantId } });
  if (!user || !user.webauthnEnabled || !user.webauthnCredentialId) {
    throw new AppError(404, "WebAuthn not enabled for this user");
  }

  const expectedChallenge = await consumeChallenge(userId);
  if (!expectedChallenge) {
    throw new AppError(400, "Challenge expired or not found");
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: assertionResponse,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: true,
      credential: {
        id: user.webauthnCredentialId,
        publicKey: base64urlToBuffer(user.webauthnPublicKey),
        counter: user.webauthnSignCount || 0,
      },
    });
  } catch (err) {
    logger.error("WebAuthn assertion verification failed", {
      error: err.message,
    });
    throw new AppError(401, "WebAuthn authentication failed");
  }

  if (!verification.verified) {
    throw new AppError(401, "WebAuthn authentication failed");
  }

  await Users.update(
    { webauthnSignCount: verification.authenticationInfo.newCounter },
    { where: { id: userId } },
  );

  return { success: true };
}

async function getStatus(tenantId, userId) {
  const user = await Users.findOne({
    where: { id: userId, tenantId },
    attributes: ["webauthnEnabled", "webauthnSignCount", "updatedAt"],
  });

  if (!user) {
    throw new AppError(404, "User not found");
  }

  return {
    enabled: Boolean(user.webauthnEnabled),
    signCount: user.webauthnSignCount || 0,
    // The credential id itself is not exposed — only whether one is enrolled.
    lastUpdatedAt: user.updatedAt || null,
  };
}

async function disableWebauthn(tenantId, userId) {
  await Users.update(
    {
      webauthnEnabled: false,
      webauthnCredentialId: null,
      webauthnPublicKey: null,
      webauthnSignCount: 0,
    },
    { where: { id: userId, tenantId } },
  );

  return { success: true };
}

exports.getStatus = getStatus;
exports.getRegistrationOptions = getRegistrationOptions;
exports.getLoginOptions = getLoginOptions;
exports.verifyRegistration = verifyRegistration;
exports.verifyLogin = verifyLogin;
exports.disable = disableWebauthn;

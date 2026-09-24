/**
 * E-Signature Service (21 CFR Part 11 / eIDAS Compliant)
 *
 * Provides digital signature workflow with audit trail, signer routing,
 * biometric/polygon capture, and cryptographic binding.
 *
 * Usage:
 *   const { createSignatureWorkflow } = require('./services/eSignature.service');
 *   await createSignatureWorkflow(tenantId, { documentId, signers: [...] });
 */

const crypto = require("crypto");
const { promisify } = require("util");
const generateKeyPairAsync = promisify(crypto.generateKeyPair);
const { logger } = require("../middlewares/activityLog.middleware");
const { AppError } = require("../utils/appError.util");
const { db } = require("../config");
const auditService = require("./audit.service");
const { USER_STATUS } = require("../constants/appConstants");

// ==========================================
// CONFIGURATION
// ==========================================

const ESIGN_ENABLED = process.env.ESIGN_ENABLED !== "false";
const SIGNATURE_ALGORITHM = process.env.SIGNATURE_ALGORITHM || "RS256";
const SIGNATURE_KEY_SIZE = parseInt(process.env.SIGNATURE_KEY_SIZE) || 2048;
// A-65 — signing ALWAYS re-authenticates the signer (21 CFR 11.200(a)).
// REQUIRE_REAUTHENTICATION used to switch that off, and even when on it
// checked only that the user was active. It is no longer read: a
// configuration switch that removes the signature's authentication is the
// same bypass as a missing check. Certificate approval never had one.
const REQUIRE_REAUTHENTICATION = true;
const SIGNATURE_TTL_MS = parseInt(process.env.SIGNATURE_TTL_MS) || 300000; // 5 min

// AES-256 key for encrypting signer private keys at rest. Required — no
// hardcoded default. Derived via SHA-256 so any sufficiently-random secret
// yields a valid 32-byte key.
const ENCRYPT_KEY_RAW = process.env.ENCRYPT_KEY;
/* istanbul ignore next -- fail-fast startup guard: private keys must never be
   encrypted under a default key baked into source. */
if (!ENCRYPT_KEY_RAW) {
  throw new Error("ENCRYPT_KEY is required (no insecure default)");
}
const ENCRYPT_KEY = crypto.createHash("sha256").update(ENCRYPT_KEY_RAW).digest();

// ==========================================
// SIGNATURE SCHEME
// ==========================================

/**
 * Identifier stored on every record produced by the current scheme: an
 * RSA-SHA256 signature, made with the signing tenant's private key, over the
 * canonical payload built by canonicalizeSignaturePayload().
 *
 * Records written before this scheme existed carry NULL (see LEGACY_*), were
 * "verified" by recomputing a SHA-256 of a payload containing Date.now(), and
 * therefore could never verify. They are reported as unverifiable, NOT as
 * forgeries and NOT as valid.
 */
const SIGNATURE_SCHEME_V2 = "esig-v2-rsa-sha256";

const LEGACY_VERIFICATION_REASON =
  "This signature predates the cryptographic signing fix (ADR-040): it was " +
  "recorded as a timestamp hash with no key material, so it can neither be " +
  "cryptographically verified nor shown to be a forgery.";

/**
 * The exact fields bound by a signature, in the exact order they are
 * serialized. The order lives here, in one array, so the bytes cannot change
 * because an object literal was reordered or because a JSON implementation
 * ordered keys differently.
 */
const CANONICAL_FIELDS = [
  "scheme",
  "algorithm",
  "tenantId",
  "documentId",
  "workflowId",
  "workflowStepId",
  "signerUserId",
  "signedAt",
  "authenticationMethod",
  "reason",
];

/**
 * Serialize the signed payload deterministically.
 *
 * Emits a JSON array of [name, value] pairs — an array, so ordering is defined
 * by CANONICAL_FIELDS rather than by object key-insertion order — with every
 * value coerced to a string and null/undefined collapsed to "". The same inputs
 * always produce byte-identical output, on any Node version, in any process.
 *
 * @param {Object} fields - values keyed by CANONICAL_FIELDS
 * @returns {string} canonical UTF-8 payload
 */
function canonicalizeSignaturePayload(fields) {
  return JSON.stringify(
    CANONICAL_FIELDS.map((name) => [
      name,
      fields[name] === null || fields[name] === undefined
        ? ""
        : String(fields[name]),
    ]),
  );
}

/**
 * Normalize a signing timestamp to a fixed, millisecond-precision ISO-8601
 * string. Verification reconstructs it from the STORED signedAt, so it must
 * render identically whether the driver hands back a Date or a string.
 *
 * @param {Date|string|number} value
 * @returns {string}
 */
function canonicalTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString();
}

/**
 * A-85 — the state explanation for signing a workflow step that is not
 * pending. Keyed by the step statuses in signatureWorkflowStep.model.js; an
 * unknown status still gets the generic sentence rather than a bare 409.
 *
 * @param {string} status - the step's current status
 * @returns {string}
 */
function explainUnsignableStep(status) {
  const why = {
    waiting:
      "an earlier signer in this workflow has not signed yet; it becomes signable when the previous step is signed",
    signed: "it has already been signed, and a step is signed once",
    declined: "it was declined, which ends the step",
  };
  const reason = why[status] || "only a pending step can be signed";
  return `This signature step is "${status}" and cannot be signed: ${reason}.`;
}

/**
 * A-92 — the state explanation for changing a workflow that is closed.
 * Only the closed statuses are keyed: callers refuse exactly these two.
 *
 * @param {string} status - the workflow's current status
 * @param {string} verb - what was attempted, as a past participle ("edited")
 * @returns {string}
 */
function explainClosedWorkflow(status, verb) {
  const why = {
    completed:
      "every signer has signed, and the signatures cover the workflow as it was signed",
    cancelled: "cancellation is final; create a new workflow instead",
    // A-159 — set by signDocument when a signature is attempted after
    // expiresAt; like cancellation, final.
    expired:
      "its expiry date has passed, and an expired workflow collects no more signatures; " +
      "create a new workflow for the remaining signers instead",
  };
  return `This signature workflow is "${status}" and cannot be ${verb}: ${why[status]}.`;
}

/**
 * A-168 — the state explanation for editing a workflow whose expiry date has
 * passed, whether or not a signature attempt has marked it "expired" yet.
 * Expiry is terminal for signing and for editing: extending `expiresAt` would
 * re-open signing on a request its signers were told had lapsed.
 *
 * @param {Date|string} expiresAt
 * @returns {string}
 */
function explainExpiredWorkflowEdit(expiresAt) {
  return (
    `This signature workflow is "expired" (its expiry date, ${new Date(expiresAt).toISOString()}, has passed) ` +
    "and cannot be edited: expiry is final, and its expiry date cannot be extended; " +
    "create a new workflow for the remaining signers instead."
  );
}

/**
 * A-168 / A-169 — whether a workflow is expired: marked "expired", or still
 * open (pending / in_progress) with its expiry date passed. A workflow that
 * completed or was cancelled before its expiry date is closed, not expired.
 *
 * @param {{status: string, expiresAt?: Date|string|null}} workflow
 * @param {number} [now] - ms since the epoch
 * @returns {boolean}
 */
function isExpired(workflow, now = Date.now()) {
  if (workflow.status === "expired") {
    return true;
  }
  const open = workflow.status === "pending" || workflow.status === "in_progress";
  return open && Boolean(workflow.expiresAt) && new Date(workflow.expiresAt).getTime() <= now;
}

/**
 * A-130 / A-144 — the state explanation for deleting a workflow that carries
 * signatures, with the way forward.
 *
 * @param {string} status - the workflow's current status
 * @param {number} count - signatures made against it
 * @returns {string}
 */
function explainSignedWorkflowDeletion(status, count) {
  const way =
    status === "completed" || status === "cancelled"
      ? "it stays as the record of what was signed"
      : "cancel it instead (POST /esignature/workflows/:workflowId/cancel), which keeps the signatures";
  return (
    `This signature workflow is "${status}" and has ${count} signature${count === 1 ? "" : "s"}, ` +
    "so it cannot be deleted: a signature stays linked to the record it signs " +
    `(21 CFR 11.70); ${way}.`
  );
}

// ==========================================
// KEY PAIR MANAGEMENT
// ==========================================

/**
 * Generate RSA key pair for digital signatures
 * @param {string} tenantId - Tenant ID
 * @returns {Promise<{publicKey: string, privateKey: string, keyId: string}>}
 */
exports.generateKeyPair = async (tenantId) => {
  if (!ESIGN_ENABLED) {
    throw new AppError(400, "E-signature is disabled");
  }

  try {
    const { privateKey, publicKey } = await generateKeyPairAsync("rsa", {
      modulusLength: SIGNATURE_KEY_SIZE,
      publicKeyEncoding: {
        type: "spki",
        format: "pem",
      },
      privateKeyEncoding: {
        type: "pkcs8",
        format: "pem",
      },
    });

    const keyId = `key-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;

    // Store key pair in database (private key encrypted)
    const { TenantKey } = require("../models");
    await TenantKey.create({
      tenantId,
      keyId,
      keyType: "esignature",
      algorithm: SIGNATURE_ALGORITHM,
      publicKey,
      privateKey: encryptPrivateKey(privateKey),
      createdAt: new Date(),
    });

    logger.info("E-signature key pair generated", {
      tenantId,
      keyId,
      algorithm: SIGNATURE_ALGORITHM,
    });

    return { keyId, publicKey, privateKey: "[REDACTED]" };
  } catch (err) {
    if (err.status) throw err;
    logger.error("Key pair generation failed", {
      tenantId,
      error: err.message,
    });
    throw new AppError(500, "Failed to generate key pair");
  }
};

/**
 * Encrypt private key for storage
 */
function encryptPrivateKey(privateKey) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", ENCRYPT_KEY, iv);

  let encrypted = cipher.update(privateKey, "utf8", "hex");
  encrypted += cipher.final("hex");

  return `${iv.toString("hex")}:${encrypted}`;
}

/**
 * Decrypt private key for use. Called by loadSigningKey() on every signature.
 */
function decryptPrivateKey(encryptedKey) {
  const [ivHex, encrypted] = encryptedKey.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", ENCRYPT_KEY, iv);

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

/**
 * Load the tenant's current e-signature signing key and return its decrypted
 * PEM. The private key is excluded by the model's default scope, so this reads
 * through `.unscoped()`.
 *
 * @param {string} tenantId
 * @returns {Promise<{keyId: string, privateKeyPem: string}>}
 * @throws {AppError} 409 when the tenant has no key pair provisioned — signing
 *   is not a server fault, it is an unmet precondition the caller can fix by
 *   generating a key pair.
 */
async function loadSigningKey(tenantId) {
  const { TenantKey } = require("../models");

  const key = await TenantKey.unscoped().findOne({
    where: { tenantId, keyType: "esignature" },
    order: [["createdAt", "DESC"]],
  });

  if (!key) {
    throw new AppError(
      409,
      "No e-signature key pair is provisioned for this tenant. Generate one " +
        "(POST /api/v1/esignature/keys) before signing.",
    );
  }

  let privateKeyPem;
  try {
    privateKeyPem = decryptPrivateKey(key.privateKey);
  } catch (err) {
    logger.error("Signing key could not be decrypted", {
      tenantId,
      keyId: key.keyId,
      error: err.message,
    });
    throw new AppError(
      500,
      "The tenant signing key could not be decrypted (wrong ENCRYPT_KEY?)",
    );
  }

  return { keyId: key.keyId, privateKeyPem };
}

/**
 * Load the key a signature was made with, for verification.
 *
 * `paranoid: false` is deliberate and load-bearing: TenantKey is paranoid, and
 * deleting a key must not retroactively turn every signature it ever made into
 * an unverifiable record. Only the public key is needed, so the default scope
 * (which excludes the private key) is left in place.
 *
 * @param {string} tenantId
 * @param {string} keyId
 * @returns {Promise<Object|null>}
 */
async function loadVerificationKey(tenantId, keyId) {
  const { TenantKey } = require("../models");

  return TenantKey.findOne({
    where: { tenantId, keyId },
    paranoid: false,
  });
}

/**
 * List a tenant's key pairs. The private key is excluded by the model's default
 * scope, so only public metadata is returned.
 * @param {string} tenantId
 * @returns {Promise<Array>}
 */
exports.getKeyPairs = async (tenantId) => {
  try {
    const { TenantKey } = require("../models");
    const keys = await TenantKey.findAll({
      where: { tenantId },
      order: [["createdAt", "DESC"]],
    });
    return keys.map((k) => ({
      id: k.id,
      keyId: k.keyId,
      keyType: k.keyType,
      algorithm: k.algorithm,
      publicKey: k.publicKey,
      createdAt: k.createdAt,
    }));
  } catch (err) {
    logger.error("Failed to list key pairs", { tenantId, error: err.message });
    throw new AppError(500, "Failed to list key pairs");
  }
};

/**
 * Soft-delete a tenant's key pair.
 * @param {string} keyPairId
 * @param {string} tenantId
 */
exports.deleteKeyPair = async (keyPairId, tenantId) => {
  try {
    const { TenantKey } = require("../models");
    const key = await TenantKey.findOne({
      where: { id: keyPairId, tenantId },
    });
    if (!key) {
      throw new AppError(404, "Key pair not found");
    }
    await key.destroy(); // paranoid soft delete
    logger.info("E-signature key pair deleted", { tenantId, keyPairId });
    return { success: true };
  } catch (err) {
    if (err.status) throw err;
    logger.error("Failed to delete key pair", {
      keyPairId,
      error: err.message,
    });
    throw new AppError(500, "Failed to delete key pair");
  }
};

// ==========================================
// SIGNATURE WORKFLOW
// ==========================================

/**
 * A-86 (ADR-051) — the explanation for a signer named by email alone.
 */
const EXTERNAL_SIGNER_REFUSAL =
  "Signers must be users of this organisation: an email-only (external) signer " +
  "has no way to authenticate, so the workflow could never complete. To have an " +
  "external party sign, invite them as a user with e-signature permission.";

/** A-129 — a signer the tenant does not have: missing, deleted or another tenant's, alike. */
const SIGNER_NOT_FOUND = "Signer not found";

/** The printed name a signature manifests (21 CFR 11.50(a)(1)), from the user row. */
const displayName = (user) =>
  [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || user.username || user.email;

/**
 * A-129 (ADR-051 Q-19, F-10) — resolve every named signer to a user of the
 * tenant who may sign, BEFORE anything is written.
 *
 *  - A signer with no `userId` is refused (400, A-86).
 *  - A `userId` that is not a user of this tenant — missing, soft-deleted or
 *    another tenant's — is 404, one message for all three (the A-75
 *    convention: a distinguishable answer is a cross-tenant existence oracle).
 *    The tenant predicate is explicit, not left to the hooks.
 *  - A user of the tenant who is inactive, or who does not hold
 *    `esignature:write`, is 400 naming the signer: the workflow could never
 *    complete (the /sign gate would refuse them), so it is not created.
 *
 * The name and email written onto the step come from the user row; any value
 * the body carried is ignored (F-10).
 *
 * @param {string} tenantId
 * @param {Array<{userId?: string}>} signers - as validated
 * @param {object} transaction
 * @returns {Promise<Array<{userId: string, email: string, name: string}>>}
 */
const resolveSigners = async (tenantId, signers, transaction) => {
  const { User, Role } = require("../models");
  const { principalHasMenuPermission } = require("../middlewares/dynamicAccess.middleware");
  const { MENU_SLUGS } = require("../constants");

  const resolved = [];
  for (let i = 0; i < signers.length; i++) {
    const userId = signers[i] && signers[i].userId;
    if (!userId) {
      throw new AppError(400, `Signer ${i + 1}: ${EXTERNAL_SIGNER_REFUSAL}`);
    }

    const user = await User.findOne({ where: { id: userId, tenantId }, transaction });
    if (!user) {
      throw new AppError(404, SIGNER_NOT_FOUND);
    }

    const name = displayName(user);
    if (!user.isActive || user.status !== USER_STATUS.ACTIVE) {
      throw new AppError(
        400,
        `Signer ${i + 1} (${name}) is not an active user, so they could not sign. ` +
          "Choose an active user, or reactivate the account first.",
      );
    }

    const role = user.roleId
      ? await Role.findByPk(user.roleId, { attributes: ["id", "name"], transaction })
      : null;
    const maySign = await principalHasMenuPermission(
      { id: user.id, role: role ? { id: role.id, name: role.name } : null },
      MENU_SLUGS.ESIGNATURE,
      "write",
    );
    if (!maySign) {
      throw new AppError(
        400,
        `Signer ${i + 1} (${name}) does not hold the e-signature signing permission, so ` +
          "they could not sign. Grant it to their role or to them, or choose another signer.",
      );
    }

    resolved.push({ userId: user.id, email: user.email, name });
  }
  return resolved;
};

/**
 * Create a signature workflow.
 *
 * A-129 / A-130 (ADR-051 Q-19, A-86; F-10). Every signer is a user of the
 * tenant who may sign (resolveSigners). The workflow, its steps and the audit
 * row commit together or not at all; the first signer is notified only after
 * the commit.
 *
 * @param {string} tenantId - Tenant ID
 * @param {Object} data - Workflow data
 * @param {Array<{userId: string}>} data.signers - in signing order
 * @param {{userId?: string, ipAddress?: string, userAgent?: string}} [actor] -
 *   auditActor(req)
 * @returns {Promise<{workflowId: string, signers: Array}>}
 * @throws {AppError} 400 for an email-only, inactive or unauthorised signer;
 *   404 for a signer who is not a user of this tenant
 */
exports.createSignatureWorkflow = async (tenantId, data, actor = {}) => {
  if (!ESIGN_ENABLED) {
    throw new AppError(400, "E-signature is disabled");
  }

  const { documentId, signers, subject, message, expiresAt } = data;

  if (!documentId || !signers || signers.length === 0) {
    throw new AppError(400, "documentId and signers are required");
  }

  try {
    const { SignatureWorkflow, SignatureWorkflowStep } = require("../models");

    const { workflow, steps, resolved } = await db.transaction(async (transaction) => {
      const named = await resolveSigners(tenantId, signers, transaction);

      const created = await SignatureWorkflow.create(
        {
          tenantId,
          documentId,
          subject: subject || "Please sign this document",
          message: message || "",
          status: "pending",
          expiresAt: expiresAt || new Date(Date.now() + 7 * 86400000),
          signatureAlgorithm: SIGNATURE_ALGORITHM,
          // A-170 — the requester is the authenticated actor, never a body
          // field; the completion email goes to them.
          requestedBy: actor.userId,
        },
        { transaction },
      );

      const createdSteps = [];
      for (let i = 0; i < named.length; i++) {
        createdSteps.push(
          await SignatureWorkflowStep.create(
            {
              // tenantId is required for isolation AND is read back by
              // signDocument (step.tenantId) when it writes the
              // SignatureRecord/AuditLog rows.
              tenantId,
              workflowId: created.id,
              stepNumber: i + 1,
              signerId: named[i].userId,
              signerEmail: named[i].email,
              signerName: named[i].name,
              status: i === 0 ? "pending" : "waiting",
              signedAt: null,
            },
            { transaction },
          ),
        );
      }

      await auditWorkflowChange(transaction, tenantId, actor, "CREATE", created.id, {
        after: {
          documentId,
          subject: created.subject,
          status: created.status,
          signers: named.map((s, i) => ({ stepNumber: i + 1, userId: s.userId })),
        },
      });

      return { workflow: created, steps: createdSteps, resolved: named };
    });

    await sendSignatureRequest(resolved[0].email, workflow, steps[0]);

    logger.info("Signature workflow created", {
      tenantId,
      workflowId: workflow.id,
      signerCount: resolved.length,
    });

    return {
      workflowId: workflow.id,
      signers: resolved.map((s, i) => ({
        userId: s.userId,
        email: s.email,
        name: s.name,
        status: steps[i].status,
      })),
    };
  } catch (err) {
    if (err.status) throw err;
    logger.error("Failed to create signature workflow", {
      tenantId,
      error: err.message,
    });
    throw new AppError(500, "Failed to create signature workflow");
  }
};

/**
 * A-158 — the signer's way in: the E-Signature page, whose default "To sign"
 * tab (A-91) lists the steps waiting on the signed-in user. There is no
 * per-step page to deep-link to.
 *
 * The origin is the public web front end: FRONTEND_URL (as the SSO callback
 * uses it), else HOST_URL — the origin the deployments publish and the one
 * email.service already builds its emailed links on. The link used to be a
 * hard-coded https://app.callibrator.io/sign/:id: a domain this product does
 * not serve and a route the front end never had.
 *
 * @returns {string|null} absolute URL, or null when no origin is configured
 */
function signingPageUrl() {
  const origin = (process.env.FRONTEND_URL || process.env.HOST_URL || "").replace(/\/+$/, "");
  return origin ? `${origin}/dashboard/esignature` : null;
}

/**
 * A-158 — queue one e-signature email through the real email path
 * (emailQueue.service#queueNotificationEmail → the email_queue consumer →
 * email.service#sendNotificationEmail). This used to call
 * `emailQueueService.queueEmail`, which that module has never exported: every
 * call threw a TypeError that a catch logged as a warning, so no signing
 * email was ever sent and nothing said so above warn level.
 *
 * Never throws — the workflow or signature it reports on has already
 * committed, so a mail failure must not turn it into a 500 — but every
 * failure is logged at ERROR with the workflow, step and signer context.
 *
 * @param {string} what - log label ("Signature request", "Workflow completion")
 * @param {Object} context - logged with every outcome (ids only, no address)
 * @param {Object} email - queueNotificationEmail's argument
 * @returns {Promise<boolean>} whether the email was accepted for delivery
 */
async function queueESignatureEmail(what, context, email) {
  if (!email.actionUrl) {
    logger.error(`${what} email has no link: neither FRONTEND_URL nor HOST_URL is set`, context);
  }
  try {
    const { queueNotificationEmail } = require("./emailQueue.service");
    const accepted = await queueNotificationEmail(email);
    if (!accepted) {
      throw new Error("the email queue did not accept the message");
    }
    logger.info(`${what} email queued`, context);
    return true;
  } catch (err) {
    logger.error(`${what} email was not sent`, { ...context, error: err.message });
    return false;
  }
}

/**
 * Send the signature request email to the signer of `step`.
 *
 * @param {string} email - the signer's address (the step's signerEmail)
 * @param {Object} workflow
 * @param {Object} step
 * @returns {Promise<boolean>} whether the email was accepted for delivery
 */
async function sendSignatureRequest(email, workflow, step) {
  const lines = [
    `You have been asked to sign "${workflow.subject}" (document ${workflow.documentId}), ` +
      `as signer ${step.stepNumber || 1} of this workflow.`,
  ];
  if (workflow.message) {
    lines.push(workflow.message);
  }
  lines.push('Open E-Signature and choose "To sign" to review and sign it.');
  if (workflow.expiresAt) {
    lines.push(`This request expires at ${new Date(workflow.expiresAt).toISOString()}.`);
  }
  return queueESignatureEmail(
    "Signature request",
    {
      tenantId: workflow.tenantId,
      workflowId: workflow.id,
      stepId: step.id,
      signerId: step.signerId || null,
    },
    {
      email,
      firstName: step.signerName || "",
      title: `Signature request: ${workflow.subject}`,
      message: lines.join("\n\n"),
      actionUrl: signingPageUrl(),
    },
  );
}

// ==========================================
// SIGNATURE EXECUTION
// ==========================================

/**
 * Sign a document.
 *
 * Produces an RSA-SHA256 signature, made with the tenant's private key, over a
 * canonical payload binding the document, workflow step, signer, tenant, the
 * signing timestamp as stored, the authentication method and the signature's
 * meaning. Requires a provisioned tenant key pair (409 without one).
 *
 * @param {string} stepId - Workflow step ID
 * @param {string} userId - User ID
 * @param {Object} signatureData - Signature data
 * @param {string} [signatureData.reason] - meaning of the signature (21 CFR 11.50)
 * @returns {Promise<{signatureId: string, certificate: Object}>}
 */
exports.signDocument = async (stepId, userId, signatureData) => {
  const { polygon, biometricData, authenticationMethod, authPayload } = signatureData;

  // A-129 (ADR-051 Q-19) — the meaning of the signature is part of what is
  // signed (21 CFR 11.50(a)(3)), so a signature without one is refused before
  // anything is looked up. It used to be optional and stored as NULL.
  const reason =
    typeof signatureData.reason === "string" ? signatureData.reason.trim() : "";
  if (!reason) {
    throw new AppError(
      400,
      "The meaning of the signature is required (for example \"Reviewed and approved\"): " +
        "it is recorded with, and bound into, the signature (21 CFR 11.50).",
    );
  }

  try {
    const {
      SignatureWorkflowStep,
      SignatureWorkflow,
      SignatureRecord,
    } = require("../models");

    // Get step
    const step = await SignatureWorkflowStep.findByPk(stepId);
    if (!step) {
      throw new AppError(404, "Signature step not found");
    }

    // A-65 — only the step's own signer may sign it. The step is already
    // tenant-scoped (another tenant's step is the 404 above), so this is a
    // permission failure inside the caller's tenant: 403. It is checked before
    // the step's state, so a non-signer learns nothing about it. A step with
    // no internal signer (signerId null) cannot be signed by any user.
    if (!step.signerId || step.signerId !== userId) {
      throw new AppError(403, "Only the assigned signer can sign this step");
    }

    // Verify step is pending. A-85: a step in any other state is a state
    // conflict (409), explained — not a malformed request.
    if (step.status !== "pending") {
      throw new AppError(409, explainUnsignableStep(step.status));
    }

    // A-159 — a second, identical `step.status !== "pending"` check ("not
    // your turn", 400) used to follow and could never run. The check above IS
    // the turn check: a later signer's step is "waiting" until the previous
    // step is signed.

    // A-65 — re-authenticate the signer with their own password or MFA code,
    // exactly as certificate approval does (the same function), BEFORE
    // anything is signed or persisted.
    const method = authenticationMethod || "password";
    const user = await require("../models").User.findByPk(userId);
    // User.status is UPPERCASE — the model default and USER_STATUS are
    // "ACTIVE". This compared against "active", which no stored row carries,
    // so every real signer was refused here with a 401; the unit tests passed
    // only because their fixtures used the same wrong lowercase value. Signing
    // a Part 11 record needs an account that is active on both flags, the
    // rule the SSO sign-in applies (sso.service.js).
    if (!user || !user.isActive || user.status !== USER_STATUS.ACTIVE) {
      throw new AppError(401, "Re-authentication required");
    }
    // A-126: a wrong credential writes SIGNATURE_AUTH_FAILED about this step.
    await require("./certificate.service").verifySignerCredentials(userId, method, authPayload, {
      tenantId: step.tenantId,
      resourceType: "SignatureWorkflowStep",
      resourceId: step.id,
      operation: "sign",
      ipAddress: signatureData.ipAddress,
      userAgent: signatureData.userAgent,
    });

    // Get workflow
    const workflow = await SignatureWorkflow.findByPk(step.workflowId);
    if (!workflow) {
      throw new AppError(404, "Workflow not found");
    }
    // A-130 — a cancelled workflow keeps its pending step as it was, so the
    // step's own status does not stop a signature. Cancellation is final.
    if (workflow.status === "cancelled" || workflow.status === "expired") {
      throw new AppError(409, explainClosedWorkflow(workflow.status, "signed"));
    }
    // A-159 — expiry. Nothing ever read expiresAt, so a workflow past its
    // expiry went on collecting signatures, and nothing set "expired". With
    // no scheduler, the first signature attempted after expiresAt records the
    // expiry (with its audit row) and is refused with the state explanation.
    if (workflow.expiresAt && new Date(workflow.expiresAt).getTime() <= Date.now()) {
      await expireWorkflow(workflow, userId, signatureData);
      throw new AppError(409, explainClosedWorkflow("expired", "signed"));
    }

    // Everything the signature binds is fixed HERE, before anything is signed,
    // and the same values are what gets persisted. signedAt in particular is
    // computed once: verification reconstructs the payload from the stored
    // column, so a second `new Date()` would make every signature unverifiable
    // (that was the original defect, with Date.now() inside the payload).
    const signedAt = new Date();

    const { keyId, privateKeyPem } = await loadSigningKey(step.tenantId);

    const canonicalPayload = canonicalizeSignaturePayload({
      scheme: SIGNATURE_SCHEME_V2,
      algorithm: SIGNATURE_ALGORITHM,
      tenantId: step.tenantId,
      documentId: workflow.documentId,
      workflowId: workflow.id,
      workflowStepId: step.id,
      signerUserId: userId,
      signedAt: canonicalTimestamp(signedAt),
      authenticationMethod: method,
      reason,
    });

    const payloadBuffer = Buffer.from(canonicalPayload, "utf8");
    const signatureValue = crypto
      .sign("sha256", payloadBuffer, privateKeyPem)
      .toString("base64");
    // Kept for the NOT NULL column and for human comparison: the digest of the
    // bytes that were actually signed, not a hash of a timestamp.
    const signatureHash = crypto
      .createHash("sha256")
      .update(payloadBuffer)
      .digest("hex");

    // A-41 — the signature, the step and workflow transitions and the audit
    // row commit together or not at all. Before this, the audit insert used
    // an action outside the ENUM ("DOCUMENT_SIGNED") and columns that do not
    // exist, so it failed on every signing — after the signature had already
    // committed with no transaction: a signature with no audit row, and a 500
    // to the signer. Notifications go out only after the commit.
    const { signature, allSigned, nextStep } = await db.transaction(async (transaction) => {
      const created = await SignatureRecord.create(
        {
          workflowId: workflow.id,
          workflowStepId: step.id,
          userId,
          tenantId: step.tenantId,
          signatureHash,
          signatureValue,
          signingKeyId: keyId,
          signatureScheme: SIGNATURE_SCHEME_V2,
          signatureReason: reason,
          signatureAlgorithm: SIGNATURE_ALGORITHM,
          polygon: polygon || null,
          biometricData: biometricData || null,
          authenticationMethod: method,
          signedAt,
          ipAddress: signatureData.ipAddress || null,
          userAgent: signatureData.userAgent || null,
          status: "signed",
        },
        { transaction },
      );

      await step.update({ status: "signed", signedAt: created.signedAt }, { transaction });

      // Check if all signers have signed
      const allSteps = await SignatureWorkflowStep.findAll({
        where: { workflowId: workflow.id },
        transaction,
      });
      const everyoneSigned = allSteps.every((s) => s.status === "signed");
      const next = everyoneSigned ? null : allSteps.find((s) => s.status === "waiting");

      if (everyoneSigned) {
        await workflow.update({ status: "completed" }, { transaction });
      } else {
        if (next) {
          await next.update({ status: "pending" }, { transaction });
        }
        // A-159 — the first signature of a multi-signer workflow moves it
        // from "pending" to "in_progress"; nothing used to, so a half-signed
        // workflow read as untouched.
        if (workflow.status === "pending") {
          await workflow.update({ status: "in_progress" }, { transaction });
        }
      }

      // A signature is a decision: APPROVE, with the operation named
      // (audit_logs.action has no SIGN member).
      await auditService.logAction(
        {
          tenantId: step.tenantId,
          userId,
          action: "APPROVE",
          resourceType: "SignatureWorkflow",
          resourceId: workflow.id,
          changes: {
            operation: "SIGN",
            before: { stepId, status: "pending" },
            after: {
              stepId,
              status: "signed",
              signatureId: created.id,
              signatureHash,
              signingKeyId: keyId,
              signatureScheme: SIGNATURE_SCHEME_V2,
              signedAt: created.signedAt,
              reason,
              workflowStatus: everyoneSigned ? "completed" : workflow.status,
            },
          },
          ipAddress: signatureData.ipAddress || null,
          userAgent: signatureData.userAgent || null,
        },
        { transaction },
      );

      return { signature: created, allSigned: everyoneSigned, nextStep: next };
    });

    if (allSigned) {
      await completeWorkflow(workflow);
    } else if (nextStep) {
      // Notify next signer
      await sendSignatureRequest(nextStep.signerEmail, workflow, nextStep);
    }

    logger.info("Document signed", {
      workflowId: workflow.id,
      signatureId: signature.id,
      userId,
    });

    return {
      signatureId: signature.id,
      certificate: generateSignatureCertificate(signature, workflow),
    };
  } catch (err) {
    if (err.status) throw err;
    logger.error("Signature failed", {
      stepId,
      userId,
      error: err.message,
    });
    throw new AppError(500, "Failed to sign document");
  }
};

/**
 * Generate signature certificate
 */
function generateSignatureCertificate(signature, workflow) {
  return {
    signatureId: signature.id,
    workflowId: workflow.id,
    documentId: workflow.documentId,
    signerId: signature.userId,
    signedAt: signature.signedAt.toISOString(),
    signatureHash: signature.signatureHash,
    signatureValue: signature.signatureValue,
    signingKeyId: signature.signingKeyId,
    signatureScheme: signature.signatureScheme,
    algorithm: signature.signatureAlgorithm,
    ipAddress: signature.ipAddress,
    userAgent: signature.userAgent,
    verificationUrl: `/api/v1/esignature/verify/${signature.id}`,
  };
}

/**
 * A-159 — record that a workflow has expired: status "expired" and its audit
 * row, in one transaction. Called by signDocument when a signature is
 * attempted after expiresAt; the caller then refuses the signature (409).
 *
 * The audit row names the signer whose attempt found the expiry — the
 * request that made the write — and says so in `changes.detectedBy`; there is
 * no expiry job to name as a system actor.
 *
 * @param {Object} workflow - the SignatureWorkflow instance
 * @param {string} userId - the signer who attempted to sign
 * @param {Object} signatureData - for ipAddress / userAgent
 */
async function expireWorkflow(workflow, userId, signatureData) {
  const previousStatus = workflow.status;
  await db.transaction(async (transaction) => {
    await workflow.update({ status: "expired" }, { transaction });
    await auditService.logAction(
      {
        tenantId: workflow.tenantId,
        userId,
        action: "UPDATE",
        resourceType: "SignatureWorkflow",
        resourceId: workflow.id,
        changes: {
          operation: "EXPIRE",
          before: { status: previousStatus },
          after: { status: "expired" },
          expiresAt: new Date(workflow.expiresAt).toISOString(),
          detectedBy: "signature attempt after expiresAt",
        },
        ipAddress: signatureData.ipAddress || null,
        userAgent: signatureData.userAgent || null,
      },
      { transaction },
    );
  });
  logger.info("Signature workflow expired", {
    tenantId: workflow.tenantId,
    workflowId: workflow.id,
  });
}

/**
 * Tell the requester and every signer that the workflow is complete.
 *
 * A-158 — this used to look for the "document owner" with
 * `User.findOne({ where: { role: "TENANT_ADMIN" } })`: users carry `roleId`,
 * there is no `role` column and no TENANT_ADMIN role, so the query failed on
 * every completion (and, had it run, would have mailed an arbitrary admin).
 *
 * A-170 — the workflow now records its requester (`requestedBy`, set at
 * creation from the actor). The requester is emailed first, then each signer;
 * every address once. A workflow from before migration 0039 whose requester
 * could not be backfilled has none, and only its signers are told.
 *
 * Never throws: the workflow has already committed as completed.
 *
 * @param {Object} workflow - the completed SignatureWorkflow
 */
async function completeWorkflow(workflow) {
  const context = { tenantId: workflow.tenantId, workflowId: workflow.id };
  const email = {
    title: `Document signed: ${workflow.subject}`,
    message:
      `Every signer has signed "${workflow.subject}" (document ${workflow.documentId}). ` +
      "The signature workflow is complete.",
    actionUrl: signingPageUrl(),
  };
  const notified = new Set();

  if (workflow.requestedBy) {
    const requester = await findRequester(workflow, context);
    if (requester) {
      notified.add(requester.email);
      await queueESignatureEmail(
        "Workflow completion",
        { ...context, requesterId: requester.id },
        { ...email, email: requester.email, firstName: requester.firstName || "" },
      );
    }
  }

  let steps;
  try {
    const { SignatureWorkflowStep } = require("../models");
    steps = await SignatureWorkflowStep.findAll({
      where: { workflowId: workflow.id },
      order: [["stepNumber", "ASC"]],
    });
  } catch (err) {
    logger.error("Workflow completion email was not sent: the signers could not be read", {
      ...context,
      error: err.message,
    });
    return;
  }

  for (const step of steps) {
    if (!step.signerEmail || notified.has(step.signerEmail)) {
      continue;
    }
    notified.add(step.signerEmail);
    await queueESignatureEmail(
      "Workflow completion",
      { ...context, stepId: step.id, signerId: step.signerId || null },
      { ...email, email: step.signerEmail, firstName: step.signerName || "" },
    );
  }
}

/**
 * A-170 — the workflow's requester, for the completion email, read in the
 * workflow's own tenant. A requester who cannot be read, or has no email
 * address, is logged at ERROR (ids only) and skipped; the signers are still
 * told.
 *
 * @param {Object} workflow
 * @param {Object} context - log context
 * @returns {Promise<Object|null>} the requester, with an email address
 */
async function findRequester(workflow, context) {
  const logContext = { ...context, requesterId: workflow.requestedBy };
  try {
    const { User } = require("../models");
    const requester = await User.findOne({
      where: { id: workflow.requestedBy, tenantId: workflow.tenantId },
      attributes: ["id", "email", "firstName"],
    });
    if (!requester || !requester.email) {
      logger.error(
        "Workflow completion email was not sent to the requester: no email address for them",
        logContext,
      );
      return null;
    }
    return requester;
  } catch (err) {
    logger.error("Workflow completion email was not sent to the requester: they could not be read", {
      ...logContext,
      error: err.message,
    });
    return null;
  }
}

// ==========================================
// VERIFICATION
// ==========================================

/**
 * The shared, non-cryptographic part of a verification result.
 */
function buildVerificationDetails(signature, workflow) {
  return {
    signatureId: signature.id,
    workflowId: signature.workflowId,
    documentId: workflow ? workflow.documentId : null,
    signerId: signature.userId,
    signedAt: signature.signedAt,
    algorithm: signature.signatureAlgorithm,
    scheme: signature.signatureScheme || null,
    signingKeyId: signature.signingKeyId || null,
    reason: signature.signatureReason || null,
    ipAddress: signature.ipAddress,
    userAgent: signature.userAgent,
    authenticationMethod: signature.authenticationMethod,
    polygon: signature.polygon,
    biometricData: signature.biometricData,
  };
}

/**
 * Verify a signature.
 *
 * Reconstructs the canonical payload from the STORED fields (document, signer,
 * tenant, step, signing timestamp, authentication method, meaning) and checks
 * the stored RSA-SHA256 signature against the tenant public key it was made
 * with. Nothing is recomputed from the current clock, so a genuine signature
 * verifies for as long as the key is readable.
 *
 * `verificationStatus` is the field to branch on; `valid` stays a strict
 * boolean and is true ONLY for a cryptographically verified signature:
 *   valid | invalid | revoked | not_found | workflow_missing |
 *   unverifiable_legacy | unverifiable_key_missing | error
 *
 * @param {string} signatureId - Signature ID
 * @returns {Promise<{valid: boolean, verificationStatus: string, reason: string, details?: Object}>}
 */
exports.verifySignature = async (signatureId) => {
  try {
    const { SignatureRecord, SignatureWorkflow } = require("../models");

    const signature = await SignatureRecord.findByPk(signatureId);
    if (!signature) {
      return {
        valid: false,
        verificationStatus: "not_found",
        reason: "Signature not found",
      };
    }

    // paranoid: false — a soft-deleted workflow must not erase the evidence of
    // the signatures made against it.
    const workflow = await SignatureWorkflow.findByPk(signature.workflowId, {
      paranoid: false,
    });

    const details = buildVerificationDetails(signature, workflow);

    // Verify signature hasn't been revoked
    if (signature.status === "revoked") {
      return {
        valid: false,
        verificationStatus: "revoked",
        reason: "Signature has been revoked",
        details,
      };
    }

    // Records written before ADR-040 carry no signature value and no scheme.
    // They are neither valid nor forged — they are unverifiable, and they say so.
    if (
      signature.signatureScheme !== SIGNATURE_SCHEME_V2 ||
      !signature.signatureValue
    ) {
      return {
        valid: false,
        verificationStatus: "unverifiable_legacy",
        reason: LEGACY_VERIFICATION_REASON,
        details,
      };
    }

    if (!workflow) {
      return {
        valid: false,
        verificationStatus: "workflow_missing",
        reason:
          "The signed workflow no longer exists, so the signed document " +
          "identity cannot be reconstructed.",
        details,
      };
    }

    const key = await loadVerificationKey(
      signature.tenantId,
      signature.signingKeyId,
    );
    if (!key) {
      return {
        valid: false,
        verificationStatus: "unverifiable_key_missing",
        reason: `Signing key ${signature.signingKeyId} is no longer present, so this signature cannot be verified.`,
        details,
      };
    }

    details.signingKeyDeletedAt = key.deletedAt || null;

    const canonicalPayload = canonicalizeSignaturePayload({
      scheme: SIGNATURE_SCHEME_V2,
      algorithm: signature.signatureAlgorithm,
      tenantId: signature.tenantId,
      documentId: workflow.documentId,
      workflowId: signature.workflowId,
      workflowStepId: signature.workflowStepId,
      signerUserId: signature.userId,
      signedAt: canonicalTimestamp(signature.signedAt),
      authenticationMethod: signature.authenticationMethod,
      reason: signature.signatureReason,
    });

    const valid = crypto.verify(
      "sha256",
      Buffer.from(canonicalPayload, "utf8"),
      key.publicKey,
      Buffer.from(signature.signatureValue, "base64"),
    );

    return {
      valid,
      verificationStatus: valid ? "valid" : "invalid",
      reason: valid
        ? `Signature verified against tenant key ${key.keyId}.`
        : "Signature does not match the record: the document, signer, tenant, step, signing time, authentication method or meaning has changed since it was signed.",
      details,
    };
  } catch (err) {
    logger.error("Signature verification failed", {
      signatureId,
      error: err.message,
    });
    return { valid: false, verificationStatus: "error", reason: err.message };
  }
};

// ==========================================
// WORKFLOW MANAGEMENT
// ==========================================

/**
 * One workflow, for workflow management (qms), with its steps in order.
 *
 * A-105. The tenant is taken explicitly, as getSignerWorkflow does, and not
 * only through the global hooks. A workflow in another tenant, a deleted one
 * and a missing one are the same 404. A database failure is NOT caught: it
 * used to be logged and answered as `null`, which the controller turned into
 * a 404 — an outage reported as "this workflow does not exist". It now
 * propagates to the global handler as a 500.
 *
 * The step order is a top-level `order` naming the association. An `order`
 * inside an include entry is ignored by Sequelize, so the steps came back in
 * whatever order the database chose.
 *
 * @param {string} workflowId
 * @param {string} tenantId - the caller's tenant (from req.user)
 * @returns {Promise<Object>} the workflow with its `steps` ordered by stepNumber
 * @throws {AppError} 404 when there is no such workflow in the tenant
 */
exports.getWorkflow = async (workflowId, tenantId) => {
  const { SignatureWorkflow, SignatureWorkflowStep } = require("../models");

  const workflow = await SignatureWorkflow.findOne({
    where: { id: workflowId, tenantId },
    include: [
      {
        model: SignatureWorkflowStep,
        as: "steps",
        where: { tenantId },
        // A workflow whose steps cannot be joined is still a workflow; an
        // INNER JOIN would make it a 404 (CLAUDE.md, the first trap).
        required: false,
      },
    ],
    order: [[{ model: SignatureWorkflowStep, as: "steps" }, "stepNumber", "ASC"]],
  });

  if (!workflow) {
    throw new AppError(404, "Workflow not found");
  }
  return workflow;
};

/**
 * List a tenant's signature workflows, optionally filtered by status.
 * @param {string} tenantId
 * @param {Object} filters
 * @param {string} [filters.status]
 * @returns {Promise<Array>}
 */
exports.getWorkflows = async (tenantId, filters = {}) => {
  try {
    const { SignatureWorkflow } = require("../models");
    const where = { tenantId };
    if (filters.status) {
      where.status = filters.status;
    }
    return await SignatureWorkflow.findAll({
      where,
      order: [["createdAt", "DESC"]],
    });
  } catch (err) {
    logger.error("Failed to list workflows", {
      tenantId,
      error: err.message,
    });
    throw new AppError(500, "Failed to list workflows");
  }
};

// ==========================================
// SIGNER VIEW (A-91)
// ==========================================
//
// GET /workflows and GET /workflows/:id are workflow MANAGEMENT and stay on
// `qms`. A signer is whoever a workflow names — commonly a TECHNICIAN with no
// `qms` menu — so without these a named signer could not open the workflow
// they alone can sign (A-65), and the workflow could never complete.
//
// What a signer sees is deliberately narrower than the management view:
//  - only workflows in which a step names them (`signerId`);
//  - the fields needed to decide and sign — never another signer's recorded
//    IP address or user agent (Part 11 capture, not the signer's business).
//
// Tenant: every query carries the caller's tenantId explicitly as well as
// through the global hooks, so a signer id from another tenant matches nothing.

const SIGNER_WORKFLOW_ATTRIBUTES = [
  "id",
  "documentId",
  "subject",
  "message",
  "status",
  "expiresAt",
  "createdAt",
  "updatedAt",
];
const SIGNER_STEP_ATTRIBUTES = [
  "id",
  "workflowId",
  "stepNumber",
  "signerId",
  "signerName",
  "signerEmail",
  "status",
  "signedAt",
];
const SIGNER_STEP_STATUSES = ["waiting", "pending", "signed", "declined"];

/**
 * The steps of a workflow, as the signer view includes them. `required:
 * false` — an INNER JOIN here would drop a workflow whose steps it could not
 * join (CLAUDE.md, the first trap).
 */
const signerStepsInclude = (SignatureWorkflowStep, tenantId) => ({
  model: SignatureWorkflowStep,
  as: "steps",
  attributes: SIGNER_STEP_ATTRIBUTES,
  where: { tenantId },
  required: false,
});

/**
 * List the workflows in which `userId` is a named signer.
 *
 * @param {string} tenantId - the caller's tenant (from req.user)
 * @param {string} userId - the caller (from req.user)
 * @param {Object} filters
 * @param {string} [filters.stepStatus] - only workflows where the caller's own
 *   step has this status; "pending" is "waiting for my signature"
 * @returns {Promise<Array>} workflows, newest first, each with its `steps`
 *   ordered by stepNumber and a derived `expired` flag; an expired workflow
 *   the caller has not signed or declined in is left out (A-169)
 * @throws {AppError} 400 on an unknown stepStatus
 */
exports.getSignerWorkflows = async (tenantId, userId, filters) => {
  const { stepStatus } = filters;
  if (stepStatus !== undefined && !SIGNER_STEP_STATUSES.includes(stepStatus)) {
    throw new AppError(
      400,
      `stepStatus must be one of: ${SIGNER_STEP_STATUSES.join(", ")}`,
    );
  }

  const { SignatureWorkflow, SignatureWorkflowStep } = require("../models");

  const stepWhere = { tenantId, signerId: userId };
  if (stepStatus) {
    stepWhere.status = stepStatus;
  }
  const mySteps = await SignatureWorkflowStep.findAll({
    where: stepWhere,
    attributes: ["workflowId"],
  });
  const workflowIds = [...new Set(mySteps.map((step) => step.workflowId))];
  if (workflowIds.length === 0) {
    return [];
  }

  const workflows = await SignatureWorkflow.findAll({
    where: { id: workflowIds, tenantId },
    attributes: SIGNER_WORKFLOW_ATTRIBUTES,
    include: [signerStepsInclude(SignatureWorkflowStep, tenantId)],
    order: [
      ["createdAt", "DESC"],
      [{ model: SignatureWorkflowStep, as: "steps" }, "stepNumber", "ASC"],
    ],
  });

  // A-169 — an expired workflow is not something to sign. It is left out
  // of the list unless the caller has already acted in it (signed or
  // declined), which keeps it as their record; asked for "pending" or
  // "waiting" steps, it is always left out. What remains carries `expired`,
  // so a workflow past its expiry date that no signature attempt has marked
  // yet reads as expired. Nothing is written on this read.
  const now = Date.now();
  const actionable = stepStatus === "pending" || stepStatus === "waiting";
  return workflows
    .filter((workflow) => {
      if (!isExpired(workflow, now)) {
        return true;
      }
      if (actionable) {
        return false;
      }
      // The steps include is required: false, so `steps` is always an array.
      return workflow.steps.some(
        (step) => step.signerId === userId && (step.status === "signed" || step.status === "declined"),
      );
    })
    .map((workflow) => flagExpiry(workflow, now));
};

/**
 * A-169 — set the derived `expired` field on a workflow the signer view
 * returns. On a model instance it is set as a data value, so it is part of
 * the JSON the route sends (a plain property would not be).
 *
 * @param {Object} workflow - a SignatureWorkflow instance (or a plain row)
 * @param {number} now - ms since the epoch
 * @returns {Object} the same workflow
 */
function flagExpiry(workflow, now) {
  const expired = isExpired(workflow, now);
  if (typeof workflow.setDataValue === "function") {
    workflow.setDataValue("expired", expired);
  } else {
    workflow.expired = expired;
  }
  return workflow;
}

/**
 * One workflow, for a caller who is named in it as a signer.
 *
 * A workflow in another tenant, a deleted one, and one that does not name the
 * caller are all the same 404: a 403 for "exists but you are not a signer"
 * would let any user in the tenant probe which workflow ids exist, and the
 * management route (qms) is the way to read a workflow one is not named in.
 *
 * @param {string} workflowId
 * @param {string} tenantId - the caller's tenant (from req.user)
 * @param {string} userId - the caller (from req.user)
 * @returns {Promise<Object>} the workflow with its ordered `steps`
 * @throws {AppError} 404 when the caller is not a signer of it
 */
exports.getSignerWorkflow = async (workflowId, tenantId, userId) => {
  const { SignatureWorkflow, SignatureWorkflowStep } = require("../models");

  const workflow = await SignatureWorkflow.findOne({
    where: { id: workflowId, tenantId },
    attributes: SIGNER_WORKFLOW_ATTRIBUTES,
    include: [signerStepsInclude(SignatureWorkflowStep, tenantId)],
    order: [[{ model: SignatureWorkflowStep, as: "steps" }, "stepNumber", "ASC"]],
  });

  const steps = (workflow && workflow.steps) || [];
  if (!steps.some((step) => step.signerId === userId)) {
    throw new AppError(404, "Workflow not found");
  }
  // A-169 — the one workflow says whether it has expired, as the list does.
  return flagExpiry(workflow, Date.now());
};

/**
 * The audit row for a workflow-management mutation, written inside the
 * mutation's transaction (A-104). `auditService.logAction` re-throws inside a
 * transaction, so a failed audit insert rolls the mutation back with it.
 *
 * @param {object} transaction
 * @param {string} tenantId - the workflow's tenant
 * @param {{userId?: string|null, ipAddress?: string|null, userAgent?: string|null}} actor
 * @param {string} action - one of AUDIT_ACTIONS
 * @param {string} workflowId
 * @param {object} changes
 */
const auditWorkflowChange = (transaction, tenantId, actor, action, workflowId, changes) =>
  auditService.logAction(
    {
      tenantId,
      userId: actor.userId || null,
      action,
      resourceType: "SignatureWorkflow",
      resourceId: workflowId,
      changes,
      ipAddress: actor.ipAddress || null,
      userAgent: actor.userAgent || null,
    },
    { transaction },
  );

/**
 * Load a workflow for a management mutation, inside that mutation's
 * transaction and locked (FOR UPDATE) against a concurrent one. 404 when it is
 * not in the tenant.
 */
const findWorkflowForMutation = async (workflowId, tenantId, transaction) => {
  const { SignatureWorkflow } = require("../models");
  const workflow = await SignatureWorkflow.findOne({
    where: { id: workflowId, tenantId },
    transaction,
    lock: true,
  });
  if (!workflow) {
    throw new AppError(404, "Workflow not found");
  }
  return workflow;
};

/**
 * Update a workflow's editable metadata (subject/message/expiry). A completed,
 * cancelled or expired (A-168) workflow is immutable.
 *
 * A-104 — the update and its audit row commit together, or neither does. A
 * body that changes none of the editable fields writes nothing, audit row
 * included.
 *
 * @param {string} workflowId
 * @param {string} tenantId
 * @param {Object} updates
 * @param {{userId?: string, ipAddress?: string, userAgent?: string}} [actor] -
 *   auditActor(req)
 * @returns {Promise<Object>} the updated workflow
 */
exports.updateWorkflow = async (workflowId, tenantId, updates = {}, actor = {}) => {
  try {
    return await db.transaction(async (transaction) => {
      const workflow = await findWorkflowForMutation(workflowId, tenantId, transaction);
      // A-92 — editing a closed workflow is a state conflict (409), explained;
      // the same body is accepted while the workflow is open.
      if (workflow.status === "completed" || workflow.status === "cancelled") {
        throw new AppError(409, explainClosedWorkflow(workflow.status, "edited"));
      }
      // A-168 (decided) — an expired workflow is not edited either, not even
      // to extend `expiresAt`: a new workflow is the way to re-request. Read
      // under the lock, so an edit cannot race the expiry being recorded.
      if (isExpired(workflow)) {
        throw new AppError(409, explainExpiredWorkflowEdit(workflow.expiresAt));
      }
      // Only a safe subset of fields is mutable — the client cannot force a status
      // (e.g. "completed") or re-point the document.
      const allowed = ["subject", "message", "expiresAt"];
      const patch = {};
      const before = {};
      for (const field of allowed) {
        if (updates[field] !== undefined) {
          patch[field] = updates[field];
          before[field] = workflow[field];
        }
      }
      if (Object.keys(patch).length === 0) {
        return workflow;
      }
      await workflow.update(patch, { transaction });
      await auditWorkflowChange(transaction, tenantId, actor, "UPDATE", workflowId, {
        before,
        after: patch,
      });
      return workflow;
    });
  } catch (err) {
    if (err.status) throw err;
    logger.error("Failed to update workflow", {
      workflowId,
      error: err.message,
    });
    throw new AppError(500, "Failed to update workflow");
  }
};

/**
 * Soft-delete a workflow.
 *
 * A-104 — the soft delete and its audit row commit together, or neither does.
 *
 * @param {string} workflowId
 * @param {string} tenantId
 * @param {{userId?: string, ipAddress?: string, userAgent?: string}} [actor] -
 *   auditActor(req)
 */
exports.deleteWorkflow = async (workflowId, tenantId, actor = {}) => {
  const { SignatureRecord } = require("../models");
  try {
    await db.transaction(async (transaction) => {
      const workflow = await findWorkflowForMutation(workflowId, tenantId, transaction);
      // A-130 / A-144 (ADR-051 A-107) — a workflow with ANY signature is a
      // signed record (21 CFR 11.70: signatures stay linked to the record they
      // sign). A-113 refused only `completed`, so an in_progress workflow with
      // some steps signed could be deleted, hiding those signatures from every
      // list. Counted with paranoid: false — a revoked or soft-deleted
      // signature is still a signature that was made.
      const signatures = await SignatureRecord.count({
        where: { workflowId, tenantId },
        paranoid: false,
        transaction,
      });
      if (signatures > 0) {
        throw new AppError(409, explainSignedWorkflowDeletion(workflow.status, signatures));
      }
      // A completed workflow has signatures; this stays for one whose rows
      // were removed outside the application.
      if (workflow.status === "completed") {
        throw new AppError(409, explainClosedWorkflow(workflow.status, "deleted"));
      }
      await workflow.destroy({ transaction }); // paranoid soft delete
      await auditWorkflowChange(transaction, tenantId, actor, "DELETE", workflowId, {
        before: { status: workflow.status, documentId: workflow.documentId },
      });
    });
    logger.info("Signature workflow deleted", { tenantId, workflowId });
    return { success: true };
  } catch (err) {
    if (err.status) throw err;
    logger.error("Failed to delete workflow", {
      workflowId,
      error: err.message,
    });
    throw new AppError(500, "Failed to delete workflow");
  }
};

/**
 * A-129 (F-9) — what a caller without workflow management (`qms` read) is
 * never shown in the signature history: the Part 11 capture of where and how a
 * signature was made. They see only their own signatures in any case.
 */
const HISTORY_REDACTED_ATTRIBUTES = ["biometricData", "ipAddress", "userAgent"];

/**
 * Signature history / audit trail, optionally filtered by signed-at range.
 *
 * A-129 (ADR-051 Q-19, F-9). `/history` was gated on `esignature:read`, which
 * every signing role holds, and returned every signature in the tenant with
 * its IP address, user agent and biometric capture, filtered by whatever
 * `userId` the caller passed.
 *  - `canManage` (the caller holds `qms` read): the tenant's history, the
 *    `userId` filter honoured, every column.
 *  - otherwise: the caller's own signatures only — `filters.userId` is
 *    ignored, not honoured — without biometricData, ipAddress or userAgent.
 *
 * @param {string} tenantId
 * @param {Object} filters
 * @param {string} [filters.userId] - honoured only when canManage
 * @param {string} [filters.startDate]
 * @param {string} [filters.endDate]
 * @param {{callerId: string, canManage: boolean}} scope - from the controller
 * @returns {Promise<Array>}
 */
exports.getSignatureHistory = async (tenantId, filters = {}, scope = {}) => {
  try {
    const { SignatureRecord } = require("../models");
    const { Op } = require("sequelize");
    const where = { tenantId };
    const options = { order: [["signedAt", "DESC"]] };
    if (scope.canManage) {
      if (filters.userId) {
        where.userId = filters.userId;
      }
    } else {
      // Deny by default: no caller id, no rows.
      where.userId = scope.callerId || null;
      options.attributes = { exclude: HISTORY_REDACTED_ATTRIBUTES };
    }
    if (filters.startDate || filters.endDate) {
      where.signedAt = {};
      if (filters.startDate) {
        where.signedAt[Op.gte] = new Date(filters.startDate);
      }
      if (filters.endDate) {
        where.signedAt[Op.lte] = new Date(filters.endDate);
      }
    }
    return await SignatureRecord.findAll({ where, ...options });
  } catch (err) {
    logger.error("Failed to get signature history", {
      tenantId,
      error: err.message,
    });
    throw new AppError(500, "Failed to get signature history");
  }
};

/**
 * A-129 — the users a workflow may name as signers: active users of the
 * tenant who hold `esignature:write`, exactly the rule createSignatureWorkflow
 * enforces. For the workflow-creation picker, so a creator chooses from users
 * instead of typing an email (A-86). Only id, name and email are returned.
 *
 * @param {string} tenantId - the caller's tenant (from req.user)
 * @returns {Promise<Array<{id: string, name: string, email: string}>>} by name
 */
exports.getEligibleSigners = async (tenantId) => {
  const { User, Role } = require("../models");
  const { principalHasMenuPermission } = require("../middlewares/dynamicAccess.middleware");
  const { MENU_SLUGS } = require("../constants");

  const users = await User.findAll({
    where: { tenantId, isActive: true, status: USER_STATUS.ACTIVE },
    attributes: ["id", "username", "email", "firstName", "lastName", "roleId"],
  });
  const roleIds = [...new Set(users.map((u) => u.roleId).filter(Boolean))];
  const roles = roleIds.length
    ? await Role.findAll({ where: { id: roleIds }, attributes: ["id", "name"] })
    : [];
  const roleById = new Map(roles.map((r) => [r.id, { id: r.id, name: r.name }]));

  const eligible = [];
  for (const user of users) {
    const maySign = await principalHasMenuPermission(
      { id: user.id, role: roleById.get(user.roleId) || null },
      MENU_SLUGS.ESIGNATURE,
      "write",
    );
    if (maySign) {
      eligible.push({ id: user.id, name: displayName(user), email: user.email });
    }
  }
  return eligible.sort((a, b) => a.name.localeCompare(b.name));
};

/**
 * Cancel a signature workflow.
 *
 * A-104 — the cancellation and its audit row (`UPDATE`, operation `CANCEL`;
 * the audit ENUM has no CANCEL) commit together, or neither does.
 *
 * @param {string} workflowId
 * @param {string} userId - the caller
 * @param {string} tenantId
 * @param {{ipAddress?: string, userAgent?: string}} [actor] - auditActor(req);
 *   the audit row's user is always `userId`
 * @param {string} [reason] - why it was cancelled; recorded in the audit row
 * @throws {AppError} 404 when the workflow is not in the tenant; 409 when it
 *   is completed or already cancelled. An expired workflow may be cancelled
 *   (A-168).
 */
exports.cancelWorkflow = async (workflowId, userId, tenantId, actor = {}, reason) => {
  try {
    await db.transaction(async (transaction) => {
      const workflow = await findWorkflowForMutation(workflowId, tenantId, transaction);

      // A-92 — a state conflict (409), explained, not a malformed request.
      // A-130 — cancelling a cancelled workflow is the same conflict: it used
      // to succeed again and write a second CANCEL audit row.
      if (workflow.status === "completed" || workflow.status === "cancelled") {
        throw new AppError(409, explainClosedWorkflow(workflow.status, "cancelled"));
      }

      // A-168 (decided) — an expired workflow MAY be cancelled: that is how
      // it is closed, with this audit row, when no signature attempt has
      // marked it expired. The row says it had expired.
      const expired = isExpired(workflow);
      const previousStatus = workflow.status;
      await workflow.update({ status: "cancelled" }, { transaction });
      await auditWorkflowChange(
        transaction,
        tenantId,
        { ...actor, userId },
        "UPDATE",
        workflowId,
        {
          operation: "CANCEL",
          before: {
            status: previousStatus,
            ...(expired ? { expired: true, expiresAt: new Date(workflow.expiresAt).toISOString() } : {}),
          },
          after: { status: "cancelled", ...(reason ? { reason } : {}) },
        },
      );
    });

    logger.info("Workflow cancelled", {
      workflowId,
      cancelledBy: userId,
    });

    return { success: true };
  } catch (err) {
    if (err.status) throw err;
    logger.error("Failed to cancel workflow", {
      workflowId,
      error: err.message,
    });
    throw new AppError(500, "Failed to cancel workflow");
  }
};

/**
 * Revoke a signature
 */
exports.revokeSignature = async (signatureId, userId, tenantId, reason) => {
  try {
    const { SignatureRecord } = require("../models");

    const signature = await SignatureRecord.findOne({
      where: { id: signatureId, tenantId },
    });

    if (!signature) {
      throw new AppError(404, "Signature not found");
    }

    const previousStatus = signature.status;

    // A-41 — the revocation and its audit row commit together. The previous
    // row ("SIGNATURE_REVOKED", entityType/entityId) was outside the ENUM and
    // the schema, so it failed after the revocation had committed.
    await db.transaction(async (transaction) => {
      await signature.update(
        {
          status: "revoked",
          revokedAt: new Date(),
          revokedBy: userId,
          revocationReason: reason,
        },
        { transaction },
      );

      await auditService.logAction(
        {
          tenantId,
          userId,
          action: "UPDATE",
          resourceType: "SignatureRecord",
          resourceId: signatureId,
          changes: {
            operation: "REVOKE",
            before: { status: previousStatus },
            after: { status: "revoked", reason },
          },
        },
        { transaction },
      );
    });

    logger.info("Signature revoked", {
      signatureId,
      revokedBy: userId,
      reason,
    });

    return { success: true };
  } catch (err) {
    if (err.status) throw err;
    logger.error("Failed to revoke signature", {
      signatureId,
      error: err.message,
    });
    throw new AppError(500, "Failed to revoke signature");
  }
};

// ==========================================
// UTILITIES
// ==========================================

/**
 * Get service status
 */
exports.getStatus = () => {
  return {
    enabled: ESIGN_ENABLED,
    algorithm: SIGNATURE_ALGORITHM,
    keySize: SIGNATURE_KEY_SIZE,
    reauthenticationRequired: REQUIRE_REAUTHENTICATION,
  };
};

/**
 * Export constants
 */
exports.SIGNATURE_STATUS = {
  PENDING: "pending",
  SIGNED: "signed",
  REVOKED: "revoked",
  EXPIRED: "expired",
};

exports.WORKFLOW_STATUS = {
  PENDING: "pending",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
};

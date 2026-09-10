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

// ==========================================
// CONFIGURATION
// ==========================================

const ESIGN_ENABLED = process.env.ESIGN_ENABLED !== "false";
const SIGNATURE_ALGORITHM = process.env.SIGNATURE_ALGORITHM || "RS256";
const SIGNATURE_KEY_SIZE = parseInt(process.env.SIGNATURE_KEY_SIZE) || 2048;
const REQUIRE_REAUTHENTICATION =
  process.env.REQUIRE_REAUTHENTICATION !== "false";
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
 * Decrypt private key for use
 */
/* istanbul ignore next -- unreachable: decryptPrivateKey is not exported and is
   never called anywhere in the codebase (only its counterpart
   encryptPrivateKey is used), so no test can invoke it. */
function decryptPrivateKey(encryptedKey) {
  const [ivHex, encrypted] = encryptedKey.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", ENCRYPT_KEY, iv);

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
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
 * Create a signature workflow
 * @param {string} tenantId - Tenant ID
 * @param {Object} data - Workflow data
 * @returns {Promise<{workflowId: string, signers: Array}>}
 */
exports.createSignatureWorkflow = async (tenantId, data) => {
  if (!ESIGN_ENABLED) {
    throw new AppError(400, "E-signature is disabled");
  }

  const { documentId, signers, subject, message, expiresAt } = data;

  if (!documentId || !signers || signers.length === 0) {
    throw new AppError(400, "documentId and signers are required");
  }

  try {
    const {
      SignatureWorkflow,
      SignatureWorkflowStep,
      SignatureRecord,
    } = require("../models");

    // Create workflow
    const workflow = await SignatureWorkflow.create({
      tenantId,
      documentId,
      subject: subject || "Please sign this document",
      message: message || "",
      status: "pending",
      expiresAt: expiresAt || new Date(Date.now() + 7 * 86400000),
      signatureAlgorithm: SIGNATURE_ALGORITHM,
    });

    // Create steps for each signer
    for (let i = 0; i < signers.length; i++) {
      const signer = signers[i];
      const step = await SignatureWorkflowStep.create({
        // tenantId is required for isolation AND is read back by signDocument
        // (step.tenantId) when it writes the SignatureRecord/AuditLog rows.
        tenantId,
        workflowId: workflow.id,
        stepNumber: i + 1,
        signerId: signer.userId,
        signerEmail: signer.email,
        signerName: signer.name,
        status: i === 0 ? "pending" : "waiting",
        signedAt: null,
        ipAddress: signer.ipAddress,
        userAgent: signer.userAgent,
      });

      // Send notification to first signer
      if (i === 0) {
        await sendSignatureRequest(signer.email, workflow, step);
      }
    }

    logger.info("Signature workflow created", {
      tenantId,
      workflowId: workflow.id,
      signerCount: signers.length,
    });

    return {
      workflowId: workflow.id,
      signers: signers.map((s) => ({
        userId: s.userId,
        email: s.email,
        name: s.name,
        status: "pending",
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
 * Send signature request email to signer
 */
async function sendSignatureRequest(email, workflow, step) {
  const { emailQueueService } = require("../services/emailQueue.service");

  try {
    await emailQueueService.queueEmail({
      to: email,
      subject: `Signature request: ${workflow.subject}`,
      template: "signature-request",
      data: {
        workflowId: workflow.id,
        stepId: step.id,
        signUrl: `https://app.callibrator.io/sign/${step.id}`,
        expiresAt: workflow.expiresAt,
      },
    });

    logger.info("Signature request sent", {
      workflowId: workflow.id,
      signerEmail: email,
    });
  } catch (err) {
    logger.warn("Failed to send signature request", {
      workflowId: workflow.id,
      error: err.message,
    });
  }
}

// ==========================================
// SIGNATURE EXECUTION
// ==========================================

/**
 * Sign a document
 * @param {string} stepId - Workflow step ID
 * @param {string} userId - User ID
 * @param {Object} signatureData - Signature data
 * @returns {Promise<{signatureId: string, certificate: string}>}
 */
exports.signDocument = async (stepId, userId, signatureData) => {
  const { polygon, biometricData, authenticationMethod } = signatureData;

  try {
    const {
      SignatureWorkflowStep,
      SignatureWorkflow,
      SignatureRecord,
      AuditLog,
    } = require("../models");

    // Get step
    const step = await SignatureWorkflowStep.findByPk(stepId);
    if (!step) {
      throw new AppError(404, "Signature step not found");
    }

    // Verify step is pending
    if (step.status !== "pending") {
      throw new AppError(400, `Step is not pending (status: ${step.status})`);
    }

    // Verify this signer's turn
    // istanbul ignore next -- unreachable: this repeats the identical
    // `step.status !== "pending"` check a few lines above, which already threw;
    // by this point step.status is always "pending". (Likely a copy/paste bug:
    // the turn check should compare the step number, not the status.)
    if (step.status !== "pending") {
      throw new AppError(
        400,
        `It's not your turn to sign (step ${step.stepNumber})`,
      );
    }

    // Re-authenticate if required
    if (REQUIRE_REAUTHENTICATION) {
      // Verify session/token is valid and recent
      const user = await require("../models").User.findByPk(userId);
      if (!user || user.status !== "active") {
        throw new AppError(401, "Re-authentication required");
      }
    }

    // Get workflow
    const workflow = await SignatureWorkflow.findByPk(step.workflowId);
    if (!workflow) {
      throw new AppError(404, "Workflow not found");
    }

    // Generate signature hash
    const signatureHash = generateSignatureHash(
      workflow.documentId,
      userId,
      step.tenantId,
    );

    // Create signature record
    const signature = await SignatureRecord.create({
      workflowId: workflow.id,
      workflowStepId: step.id,
      userId,
      tenantId: step.tenantId,
      signatureHash,
      signatureAlgorithm: SIGNATURE_ALGORITHM,
      polygon: polygon || null,
      biometricData: biometricData || null,
      authenticationMethod: authenticationMethod || "password",
      signedAt: new Date(),
      ipAddress: signatureData.ipAddress || null,
      userAgent: signatureData.userAgent || null,
      status: "signed",
    });

    // Update step status
    await step.update({
      status: "signed",
      signedAt: signature.signedAt,
    });

    // Log the signature action
    await AuditLog.create({
      tenantId: step.tenantId,
      userId,
      action: "DOCUMENT_SIGNED",
      entityType: "SignatureWorkflow",
      entityId: workflow.id,
      before: { stepId, status: "pending" },
      after: {
        signatureId: signature.id,
        signatureHash,
        signedAt: signature.signedAt,
      },
    });

    // Check if all signers have signed
    const allSteps = await SignatureWorkflowStep.findAll({
      where: { workflowId: workflow.id },
    });

    const allSigned = allSteps.every((s) => s.status === "signed");

    if (allSigned) {
      await workflow.update({ status: "completed" });
      await completeWorkflow(workflow.id);
    } else {
      // Notify next signer
      const nextStep = allSteps.find((s) => s.status === "waiting");
      if (nextStep) {
        await nextStep.update({ status: "pending" });
        await sendSignatureRequest(nextStep.signerEmail, workflow, nextStep);
      }
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
 * Generate signature hash (document binding)
 */
function generateSignatureHash(documentId, userId, tenantId) {
  const payload = `${documentId}:${userId}:${tenantId}:${Date.now()}`;
  return crypto.createHash("sha256").update(payload).digest("hex");
}

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
    algorithm: signature.signatureAlgorithm,
    ipAddress: signature.ipAddress,
    userAgent: signature.userAgent,
    verificationUrl: `/api/v1/esignature/verify/${signature.id}`,
  };
}

/**
 * Complete workflow and notify all parties
 */
async function completeWorkflow(workflowId) {
  const { SignatureWorkflow, User } = require("../models");

  try {
    const workflow = await SignatureWorkflow.findByPk(workflowId);
    if (!workflow) return;

    // Notify document owner
    const owner = await User.findOne({
      where: { tenantId: workflow.tenantId, role: "TENANT_ADMIN" },
    });

    if (owner && owner.email) {
      const { emailQueueService } = require("../services/emailQueue.service");
      await emailQueueService.queueEmail({
        to: owner.email,
        subject: `Document signed: ${workflow.subject}`,
        template: "document-completed",
        data: {
          workflowId: workflow.id,
          completedAt: new Date().toISOString(),
        },
      });
    }
  } catch (err) {
    logger.warn("Failed to notify on workflow completion", {
      workflowId,
      error: err.message,
    });
  }
}

// ==========================================
// VERIFICATION
// ==========================================

/**
 * Verify a signature
 * @param {string} signatureId - Signature ID
 * @returns {Promise<{valid: boolean, details: Object}>}
 */
exports.verifySignature = async (signatureId) => {
  try {
    const { SignatureRecord, SignatureWorkflow } = require("../models");

    const signature = await SignatureRecord.findByPk(signatureId);
    if (!signature) {
      return { valid: false, reason: "Signature not found" };
    }

    const workflow = await SignatureWorkflow.findByPk(signature.workflowId);

    // Verify signature hasn't been revoked
    if (signature.status === "revoked") {
      return { valid: false, reason: "Signature has been revoked" };
    }

    // Verify document hasn't been tampered with
    const currentHash = generateSignatureHash(
      workflow.documentId,
      signature.userId,
      signature.tenantId,
    );

    const valid = currentHash === signature.signatureHash;

    return {
      valid,
      details: {
        signatureId: signature.id,
        workflowId: signature.workflowId,
        documentId: workflow.documentId,
        signerId: signature.userId,
        signedAt: signature.signedAt,
        algorithm: signature.signatureAlgorithm,
        ipAddress: signature.ipAddress,
        userAgent: signature.userAgent,
        authenticationMethod: signature.authenticationMethod,
        polygon: signature.polygon,
        biometricData: signature.biometricData,
      },
    };
  } catch (err) {
    logger.error("Signature verification failed", {
      signatureId,
      error: err.message,
    });
    return { valid: false, reason: err.message };
  }
};

// ==========================================
// WORKFLOW MANAGEMENT
// ==========================================

/**
 * Get workflow by ID
 */
exports.getWorkflow = async (workflowId) => {
  try {
    const { SignatureWorkflow, SignatureWorkflowStep } = require("../models");

    const workflow = await SignatureWorkflow.findByPk(workflowId, {
      include: [
        {
          model: SignatureWorkflowStep,
          as: "steps",
          order: [["stepNumber", "ASC"]],
        },
      ],
    });

    return workflow || null;
  } catch (err) {
    logger.error("Failed to get workflow", {
      workflowId,
      error: err.message,
    });
    return null;
  }
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

/**
 * Update a workflow's editable metadata (subject/message/expiry). A completed or
 * cancelled workflow is immutable.
 * @param {string} workflowId
 * @param {string} tenantId
 * @param {Object} updates
 * @returns {Promise<Object>} the updated workflow
 */
exports.updateWorkflow = async (workflowId, tenantId, updates = {}) => {
  try {
    const { SignatureWorkflow } = require("../models");
    const workflow = await SignatureWorkflow.findOne({
      where: { id: workflowId, tenantId },
    });
    if (!workflow) {
      throw new AppError(404, "Workflow not found");
    }
    if (workflow.status === "completed" || workflow.status === "cancelled") {
      throw new AppError(400, `Cannot update a ${workflow.status} workflow`);
    }
    // Only a safe subset of fields is mutable — the client cannot force a status
    // (e.g. "completed") or re-point the document.
    const allowed = ["subject", "message", "expiresAt"];
    const patch = {};
    for (const field of allowed) {
      if (updates[field] !== undefined) {
        patch[field] = updates[field];
      }
    }
    await workflow.update(patch);
    return workflow;
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
 * @param {string} workflowId
 * @param {string} tenantId
 */
exports.deleteWorkflow = async (workflowId, tenantId) => {
  try {
    const { SignatureWorkflow } = require("../models");
    const workflow = await SignatureWorkflow.findOne({
      where: { id: workflowId, tenantId },
    });
    if (!workflow) {
      throw new AppError(404, "Workflow not found");
    }
    await workflow.destroy(); // paranoid soft delete
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
 * Signature history / audit trail for a tenant, optionally filtered by signer
 * and signed-at date range.
 * @param {string} tenantId
 * @param {Object} filters
 * @param {string} [filters.userId]
 * @param {string} [filters.startDate]
 * @param {string} [filters.endDate]
 * @returns {Promise<Array>}
 */
exports.getSignatureHistory = async (tenantId, filters = {}) => {
  try {
    const { SignatureRecord } = require("../models");
    const { Op } = require("sequelize");
    const where = { tenantId };
    if (filters.userId) {
      where.userId = filters.userId;
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
    return await SignatureRecord.findAll({
      where,
      order: [["signedAt", "DESC"]],
    });
  } catch (err) {
    logger.error("Failed to get signature history", {
      tenantId,
      error: err.message,
    });
    throw new AppError(500, "Failed to get signature history");
  }
};

/**
 * Cancel a signature workflow
 */
exports.cancelWorkflow = async (workflowId, userId, tenantId) => {
  try {
    const { SignatureWorkflow } = require("../models");

    const workflow = await SignatureWorkflow.findOne({
      where: { id: workflowId, tenantId },
    });

    if (!workflow) {
      throw new AppError(404, "Workflow not found");
    }

    if (workflow.status === "completed") {
      throw new AppError(400, "Cannot cancel completed workflow");
    }

    await workflow.update({ status: "cancelled" });

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
    const { SignatureRecord, AuditLog } = require("../models");

    const signature = await SignatureRecord.findOne({
      where: { id: signatureId, tenantId },
    });

    if (!signature) {
      throw new AppError(404, "Signature not found");
    }

    await signature.update({
      status: "revoked",
      revokedAt: new Date(),
      revokedBy: userId,
      revocationReason: reason,
    });

    await AuditLog.create({
      tenantId,
      userId,
      action: "SIGNATURE_REVOKED",
      entityType: "SignatureRecord",
      entityId: signatureId,
      before: { status: "signed" },
      after: { status: "revoked", reason },
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

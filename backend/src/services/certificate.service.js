/**
 * Certificate Service
 *
 * Handles certificate CRUD operations, approval, signing, and revocation.
 */

const { Op } = require("sequelize");
const {
  Certificate,
  CalibrationDevice,
  CalibrationRecord,
  Tenant,
  User,
  ESignatureRecord,
  Sequelize,
} = require("../models");
const { logger } = require("../middlewares/activityLog.middleware");
const { AppError } = require("../utils/appError.util");
const { DEFAULT_LIMIT } = require("../constants");
const authService = require("./auth.service");
const mfaService = require("./mfa.service");
const auditService = require("./audit.service");
const { db } = require("../config");
const crypto = require("crypto");

/**
 * A-41 — every certificate mutation writes its audit row inside the SAME
 * transaction as the change (MEMORY/specs/A-41-audit-inside-transaction.md,
 * rows 1-7). A rollback takes the row with it; a failed audit insert is
 * re-thrown by logAction and rolls the change back — a certificate is never
 * issued, approved, signed or revoked unattributed.
 *
 * `changes` carries statuses and identifiers only. Never the re-authentication
 * payload (password / MFA code): audit_logs is permanent.
 */
const auditCertificate = (
  transaction,
  certificate,
  { tenantId, userId, action, operation, before, after, ipAddress, userAgent },
) =>
  auditService.logAction(
    {
      tenantId,
      userId,
      action,
      resourceType: "Certificate",
      resourceId: certificate.id,
      changes: {
        operation,
        certificateNumber: certificate.certificateNumber,
        before,
        after,
      },
      ipAddress,
      userAgent,
    },
    { transaction },
  );

/**
 * A-64 — what a caller who tried to edit `status` should do instead, keyed by
 * the certificate's current status. Signed and revoked certificates are not
 * editable at all and are refused before this is consulted.
 */
const NEXT_TRANSITION = {
  draft: "Submit it for approval with POST /certificates/:id/submit.",
  pending_approval:
    "Approve it with POST /certificates/:id/approve, which requires re-authentication.",
  approved:
    "Sign it with POST /certificates/:id/sign, or revoke it with POST /certificates/:id/revoke; both require re-authentication.",
};

/**
 * A-85 — why a signed or revoked certificate refuses an edit, keyed by status.
 * These are state conflicts (409), not malformed requests: the same body is
 * accepted while the certificate is a draft.
 */
const LOCKED_EDIT_EXPLANATION = {
  signed:
    'This certificate is "signed" and can no longer be edited: its signature covers the content as signed. ' +
    "To correct it, revoke it with POST /certificates/:id/revoke and issue a new certificate.",
  revoked:
    'This certificate is "revoked" and can no longer be edited: revocation is final. ' +
    "Issue a new certificate instead.",
};

/**
 * A-92 — why a signed certificate refuses deletion (a state conflict, 409).
 */
const DELETE_SIGNED_EXPLANATION =
  'This certificate is "signed" and cannot be deleted: a signed certificate is a controlled record ' +
  "whose signature must stay verifiable. Revoke it with POST /certificates/:id/revoke instead.";

/**
 * Re-authenticate the signer. MUST be called BEFORE the state change it
 * authorises.
 *
 * This used to be fused with the record-writing step and invoked AFTER the
 * certificate had already been mutated and saved — so a caller with a valid
 * session but a wrong password got a 401 while the certificate was already
 * approved/signed/revoked in the database, and no ESignatureRecord was
 * written. Under 21 CFR Part 11 the signature must gate the act, not trail it.
 *
 * @throws {AppError} 400 on a missing/invalid payload, 401 on failed re-auth.
 */
const verifySignatureAuth = async (userId, authOptions) => {
  const { authMethod, authPayload, meaning } = authOptions || {};

  if (!authMethod || !authPayload || !meaning) {
    throw new AppError(400, "Missing required E-signature authentication payload.");
  }

  await verifySignerCredentials(userId, authMethod, authPayload);
};

/**
 * Check the signer's own credential — their password, or a current code from
 * their authenticator — at the moment of signing (21 CFR 11.200(a)).
 *
 * Shared by certificate approve / sign / revoke and by e-signature workflow
 * signing (A-65), so every signature in the system re-authenticates the same
 * way. It checks the credential only; the caller decides who `userId` is, and
 * it must be the authenticated caller, never a body field (A-62).
 *
 * @param {string} userId - the authenticated caller
 * @param {"password"|"mfa"} authMethod
 * @param {string} authPayload - the password or the MFA code
 * @throws {AppError} 400 on an unknown method or an account without MFA,
 *   401 when the credential is wrong or missing.
 */
const verifySignerCredentials = async (userId, authMethod, authPayload) => {
  if (authMethod !== "password" && authMethod !== "mfa") {
    throw new AppError(400, "Invalid auth method.");
  }
  if (!authPayload) {
    throw new AppError(401, "Re-authentication is required to sign.");
  }

  if (authMethod === "password") {
    const valid = await authService.passIsValid(userId, authPayload);
    if (!valid || !valid.data.valid) {
      throw new AppError(401, "Invalid password for e-signature.");
    }
    return;
  }

  const user = await User.findByPk(userId);
  // mfaService.verifyLogin throws a plain Error for an account without MFA,
  // which surfaced as a 500. It is a request the account cannot satisfy: 400.
  if (!user || !user.mfaEnabled || !user.mfaSecret) {
    throw new AppError(400, "MFA is not enabled for this account; sign with your password.");
  }
  // A-115: verifyLogin consumes the code — a code that signed once cannot
  // sign (or sign in) again inside its window.
  if (!(await mfaService.verifyLogin(user, authPayload))) {
    throw new AppError(401, "Invalid MFA code for e-signature.");
  }
};

exports.verifySignerCredentials = verifySignerCredentials;

/**
 * Write the Part 11 compliance record. Called AFTER the state change so the
 * document hash captures the state that was actually signed.
 */
const logSignature = async (tenantId, certificate, userId, action, authOptions, transaction) => {
  // No `|| {}` guard: this only runs after verifySignatureAuth, which throws
  // 400 unless authMethod/authPayload/meaning are all present.
  const { authMethod, meaning, ipAddress, userAgent } = authOptions;

  // Document hash (SHA-256 of the signed certificate state)
  const certDataString = JSON.stringify({
    id: certificate.id,
    certificateNumber: certificate.certificateNumber,
    deviceId: certificate.deviceId,
    calibrationRecordId: certificate.calibrationRecordId,
    status: certificate.status,
    digitalSignature: certificate.digitalSignature,
  });
  const documentHash = crypto.createHash("sha256").update(certDataString).digest("hex");

  await ESignatureRecord.create({
    tenantId,
    entityType: 'Certificate',
    entityId: certificate.id,
    userId,
    action,
    meaning,
    authMethod,
    documentHash,
    ipAddress: ipAddress || "unknown",
    userAgent: userAgent || "unknown",
  }, { transaction });
};

/**
 * Fetch all certificates for a tenant with pagination and filtering
 */
exports.fetchCertificates = async ({
  tenantId,
  page = 1,
  limit = DEFAULT_LIMIT,
  deviceId,
  status,
  type,
  certificateNumber,
  from,
  to,
  sortBy = "created_at",
  sortOrder = "DESC",
}) => {
  try {
    const whereClause = { tenantId };

    if (deviceId) {
      whereClause.deviceId = deviceId;
    }

    if (status && Array.isArray(status) && status.length > 0) {
      whereClause.status = { [Op.in]: status };
    }

    if (type && Array.isArray(type) && type.length > 0) {
      whereClause.type = { [Op.in]: type };
    }

    if (certificateNumber) {
      whereClause.certificateNumber = {
        [Op.like]: `%${certificateNumber}%`,
      };
    }

    if (from || to) {
      whereClause.issuedAt = {};
      if (from) {whereClause.issuedAt[Op.gte] = from;}
      if (to) {whereClause.issuedAt[Op.lte] = to;}
    }

    // Map sortBy to database column
    const sortMap = {
      certificate_number: "certificateNumber",
      issued_at: "issuedAt",
      created_at: "createdAt",
      status: "status",
      device_name: "deviceName",
    };
    const orderColumn = sortMap[sortBy] || "createdAt";
    const orderDirection = sortOrder === "ASC" ? "ASC" : "DESC";

    const { rows, count } = await Certificate.findAndCountAll({
      where: whereClause,
      order: [[orderColumn, orderDirection]],
      limit: Number(limit),
      offset: (Number(page) - 1) * Number(limit),
      // required:false -> LEFT JOINs. Without it these default to INNER JOINs,
      // and the User associations carry a default scope (deleted_at IS NULL),
      // so any certificate with a null optional FK (e.g. a draft with no
      // approver/signer) is silently dropped from the list.
      include: [
        {
          association: "device",
          attributes: ["id", "name", "serialNumber", "manufacturer", "model"],
          required: false,
        },
        {
          association: "calibratedByUser",
          attributes: ["id", "firstName", "lastName", "email"],
          required: false,
        },
        {
          association: "approvedByUser",
          attributes: ["id", "firstName", "lastName", "email"],
          required: false,
        },
        {
          association: "signedByUser",
          attributes: ["id", "firstName", "lastName", "email"],
          required: false,
        },
      ],
    });

    return {
      success: true,
      status: 200,
      message: "Fetch certificates successful",
      data: {
        rows,
        count,
        meta: {
          total: count,
          page: Number(page),
          limit: Number(limit),
          totalPages: Math.ceil(count / Number(limit)),
        },
      },
    };
  } catch (error) {
    logger.error("Error fetching certificates", {
      error: error.message,
    });
    throw error;
  }
};

/**
 * Fetch a specific certificate by ID
 */
exports.fetchSpecificCertificate = async (tenantId, certificateId) => {
  try {
    const certificate = await Certificate.findOne({
      where: { id: certificateId, tenantId },
      include: [
        {
          association: "device",
          attributes: [
            "id",
            "name",
            "serialNumber",
            "manufacturer",
            "model",
            "category",
          ],
          required: false,
        },
        {
          association: "calibrationRecord",
          attributes: ["id", "calibrationDate", "isCompliant", "notes"],
          required: false,
        },
        {
          association: "calibratedByUser",
          attributes: ["id", "firstName", "lastName", "email"],
          required: false,
        },
        {
          association: "approvedByUser",
          attributes: ["id", "firstName", "lastName", "email"],
          required: false,
        },
        {
          association: "signedByUser",
          attributes: ["id", "firstName", "lastName", "email"],
          required: false,
        },
        {
          association: "tenant",
          attributes: ["id", "name", "code"],
          required: false,
        },
      ],
    });

    if (!certificate) {
      return {
        success: false,
        status: 404,
        message: "Certificate not found",
        data: null,
      };
    }

    return {
      success: true,
      status: 200,
      message: "Fetch certificate successful",
      data: certificate,
    };
  } catch (error) {
    logger.error("Error fetching specific certificate", {
      error: error.message,
      certificateId,
    });
    throw error;
  }
};

/**
 * Create a new certificate
 */
exports.createCertificate = async (tenantId, userId, inputData, actor = {}) => {
  try {
    const {
      validate,
      createCertificateSchema,
    } = require("../validators/certificate.validator");
    const validated = validate(inputData, createCertificateSchema);

    // Verify device belongs to tenant
    const device = await CalibrationDevice.findOne({
      where: { id: validated.deviceId, tenantId },
    });

    if (!device) {
      return {
        success: false,
        status: 404,
        message: "Device not found or not belonging to this tenant",
        data: null,
      };
    }

    // Get tenant for certificate number generation
    const tenant = await Tenant.findByPk(tenantId);
    const tenantCode = tenant?.code || "T";

    // Generate unique certificate number
    const certificateNumber = await Certificate.generateCertificateNumber(
      tenantCode,
      { Certificate, Sequelize },
    );

    const certificate = await db.transaction(async (transaction) => {
      const created = await Certificate.create(
        {
          ...validated,
          tenantId,
          certificateNumber,
          issueDate: new Date(),
          createdBy: userId,
        },
        { transaction },
      );
      await auditCertificate(transaction, created, {
        tenantId,
        userId,
        action: "CREATE",
        operation: "ISSUE",
        before: {},
        after: {
          status: created.status,
          deviceId: created.deviceId,
          calibrationRecordId: created.calibrationRecordId,
        },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
      return created;
    });

    logger.info("Certificate created", {
      certificateId: certificate.id,
      certificateNumber: certificate.certificateNumber,
      tenantId,
      userId,
    });

    const workflowService = require("./workflow.service");
    await workflowService.startWorkflow(tenantId, "Certificate", certificate.id);

    return {
      success: true,
      status: 201,
      message: "Certificate created successfully",
      data: certificate,
    };
  } catch (error) {
    logger.error("Error creating certificate", {
      error: error.message,
    });
    throw error;
  }
};

/**
 * Update an existing certificate
 */
exports.updateCertificate = async (tenantId, certificateId, inputData, actor = {}) => {
  try {
    const {
      validate,
      updateCertificateSchema,
    } = require("../validators/certificate.validator");
    const validated = validate(inputData, updateCertificateSchema);

    const certificate = await Certificate.findOne({
      where: { id: certificateId, tenantId },
    });

    if (!certificate) {
      return {
        success: false,
        status: 404,
        message: "Certificate not found",
        data: null,
      };
    }

    // Cannot update signed or revoked certificates. A-85: a state conflict,
    // so 409 with the state and the way forward — not a 400.
    if (
      certificate.status === Certificate.STATUS.SIGNED ||
      certificate.status === Certificate.STATUS.REVOKED
    ) {
      return {
        success: false,
        status: 409,
        message: LOCKED_EDIT_EXPLANATION[certificate.status],
        data: null,
      };
    }

    // A-64 — status is not editable. It changes only through its own
    // transitions (submit / approve / sign / revoke), each of which
    // re-authenticates where Part 11 requires it and writes its own audit row.
    // The schema still accepts `status` so an attempted transition can be
    // REFUSED with a state explanation rather than silently dropped; the
    // current status repeated back (a client round-tripping the record) is not
    // a transition and is simply removed from the edit.
    const { status: requestedStatus, ...edit } = validated;
    if (requestedStatus && requestedStatus !== certificate.status) {
      throw new AppError(
        409,
        `This certificate is in "${certificate.status}" and editing it cannot change its status. ` +
          `${NEXT_TRANSITION[certificate.status]}`,
      );
    }

    const updatedBy = inputData.updatedBy || null;
    const before = Object.fromEntries(
      Object.keys(edit).map((key) => [key, certificate[key]]),
    );

    await db.transaction(async (transaction) => {
      await certificate.update({ ...edit, updatedBy }, { transaction });
      await auditCertificate(transaction, certificate, {
        tenantId,
        userId: updatedBy,
        action: "UPDATE",
        operation: "UPDATE",
        before,
        after: edit,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
    });

    logger.info("Certificate updated", {
      certificateId,
      tenantId,
    });

    return {
      success: true,
      status: 200,
      message: "Certificate updated successfully",
      data: certificate,
    };
  } catch (error) {
    logger.error("Error updating certificate", {
      error: error.message,
    });
    throw error;
  }
};

/**
 * Soft-delete a certificate
 */
exports.deleteCertificate = async (tenantId, certificateId, actor = {}) => {
  try {
    const certificate = await Certificate.findOne({
      where: { id: certificateId, tenantId },
    });

    if (!certificate) {
      return {
        success: false,
        status: 404,
        message: "Certificate not found",
        data: null,
      };
    }

    // Cannot delete signed certificates (must revoke instead). A-92: a state
    // conflict, so 409 with the state and the way forward — not a 400. Thrown,
    // not returned: the controller renders a returned result through
    // success(), which would have sent `success: true` with the 409.
    if (certificate.status === Certificate.STATUS.SIGNED) {
      throw new AppError(409, DELETE_SIGNED_EXPLANATION);
    }

    await db.transaction(async (transaction) => {
      await certificate.destroy({ transaction });
      await auditCertificate(transaction, certificate, {
        tenantId,
        userId: actor.userId,
        action: "DELETE",
        operation: "DELETE",
        before: { status: certificate.status },
        after: { deleted: true },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
    });

    logger.info("Certificate deleted", {
      certificateId,
      tenantId,
    });

    return {
      success: true,
      status: 200,
      message: "Certificate deleted successfully",
      data: null,
    };
  } catch (error) {
    logger.error("Error deleting certificate", {
      error: error.message,
    });
    throw error;
  }
};

/**
 * Approve a certificate (move from pending_approval to approved)
 */
exports.approveCertificate = async (tenantId, certificateId, approvedBy, authOptions) => {
  try {
    const certificate = await Certificate.findOne({
      where: { id: certificateId, tenantId },
    });

    if (!certificate) {
      return {
        success: false,
        status: 404,
        message: "Certificate not found",
        data: null,
      };
    }

    // A certificate must be PENDING_APPROVAL to be approved. Surface an invalid
    // transition as 409 (not a plain Error → 500). New certificates are DRAFT;
    // callers must POST /:certificateId/submit first.
    if (certificate.status !== "pending_approval") {
      throw new AppError(
        409,
        `Cannot approve certificate with status: ${certificate.status}. Submit it for approval first.`,
      );
    }

    // Re-authenticate BEFORE mutating: the signature authorises the approval.
    await verifySignatureAuth(approvedBy, authOptions);

    const previousStatus = certificate.status;
    await db.transaction(async (transaction) => {
      await certificate.approve({ transaction });
      certificate.approvedBy = approvedBy;
      certificate.issueDate = new Date();
      await certificate.save({ transaction });

      // Logged after the save so the hash captures the approved state.
      await logSignature(tenantId, certificate, approvedBy, "approve", authOptions, transaction);

      await auditCertificate(transaction, certificate, {
        tenantId,
        userId: approvedBy,
        action: "APPROVE",
        operation: "APPROVE",
        before: { status: previousStatus },
        after: { status: certificate.status, approvedBy, meaning: authOptions.meaning },
        ipAddress: authOptions.ipAddress,
        userAgent: authOptions.userAgent,
      });
    });

    logger.info("Certificate approved", {
      certificateId,
      certificateNumber: certificate.certificateNumber,
      approvedBy,
      tenantId,
    });

    return {
      success: true,
      status: 200,
      message: "Certificate approved successfully",
      data: certificate,
    };
  } catch (error) {
    logger.error("Error approving certificate", {
      error: error.message,
    });
    throw error;
  }
};

/**
 * Submit a DRAFT certificate for approval (DRAFT -> PENDING_APPROVAL) so it can
 * then be approved. Without this transition, approve() is unreachable and 500s.
 */
exports.submitCertificateForApproval = async (tenantId, certificateId, actor = {}) => {
  const certificate = await Certificate.findOne({
    where: { id: certificateId, tenantId },
  });

  if (!certificate) {
    return { success: false, status: 404, message: "Certificate not found", data: null };
  }

  if (certificate.status !== "draft") {
    throw new AppError(
      409,
      `Cannot submit certificate for approval with status: ${certificate.status}`,
    );
  }

  const previousStatus = certificate.status;
  await db.transaction(async (transaction) => {
    await certificate.submitForApproval({ transaction });
    await auditCertificate(transaction, certificate, {
      tenantId,
      userId: actor.userId,
      action: "UPDATE",
      operation: "SUBMIT_FOR_APPROVAL",
      before: { status: previousStatus },
      after: { status: certificate.status },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
  });

  logger.info("Certificate submitted for approval", {
    certificateId,
    certificateNumber: certificate.certificateNumber,
    tenantId,
  });

  return {
    success: true,
    status: 200,
    message: "Certificate submitted for approval",
    data: certificate,
  };
};

/**
 * Sign a certificate digitally
 */
exports.signCertificate = async (
  tenantId,
  certificateId,
  signatureData,
  keyId,
  signedBy,
  authOptions
) => {
  try {
    const certificate = await Certificate.findOne({
      where: { id: certificateId, tenantId },
    });

    if (!certificate) {
      return {
        success: false,
        status: 404,
        message: "Certificate not found",
        data: null,
      };
    }

    // Re-authenticate BEFORE mutating: the signature authorises the signing.
    await verifySignatureAuth(signedBy, authOptions);

    const previousStatus = certificate.status;
    await db.transaction(async (transaction) => {
      await certificate.sign(signatureData, keyId, { transaction });
      certificate.signedBy = signedBy;
      await certificate.save({ transaction });

      // Logged after the save so the hash captures the signed state.
      await logSignature(tenantId, certificate, signedBy, "sign", authOptions, transaction);

      // A signature is a decision, not a field change: APPROVE, with the
      // operation named (audit_logs.action has no SIGN member).
      await auditCertificate(transaction, certificate, {
        tenantId,
        userId: signedBy,
        action: "APPROVE",
        operation: "SIGN",
        before: { status: previousStatus },
        after: { status: certificate.status, signedBy, keyId, meaning: authOptions.meaning },
        ipAddress: authOptions.ipAddress,
        userAgent: authOptions.userAgent,
      });
    });

    // Publish certificate signed event to message queue
    // This would be handled by the event publisher

    logger.info("Certificate signed", {
      certificateId,
      certificateNumber: certificate.certificateNumber,
      signedBy,
      tenantId,
    });

    return {
      success: true,
      status: 200,
      message: "Certificate signed successfully",
      data: certificate,
    };
  } catch (error) {
    logger.error("Error signing certificate", {
      error: error.message,
    });
    throw error;
  }
};

/**
 * Revoke a certificate
 */
exports.revokeCertificate = async (
  tenantId,
  certificateId,
  reason,
  revokedBy,
  authOptions
) => {
  try {
    const certificate = await Certificate.findOne({
      where: { id: certificateId, tenantId },
    });

    if (!certificate) {
      return {
        success: false,
        status: 404,
        message: "Certificate not found",
        data: null,
      };
    }

    // Re-authenticate BEFORE mutating: the signature authorises the revocation.
    await verifySignatureAuth(revokedBy, authOptions);

    const previousStatus = certificate.status;
    await db.transaction(async (transaction) => {
      await certificate.revoke(reason, { transaction });

      // Logged after the mutation so the hash captures the revoked state.
      await logSignature(tenantId, certificate, revokedBy, "revoke", authOptions, transaction);

      // No REVOKE member in audit_logs.action: UPDATE, with the operation named.
      await auditCertificate(transaction, certificate, {
        tenantId,
        userId: revokedBy,
        action: "UPDATE",
        operation: "REVOKE",
        before: { status: previousStatus },
        after: { status: certificate.status, reason },
        ipAddress: authOptions.ipAddress,
        userAgent: authOptions.userAgent,
      });
    });

    logger.info("Certificate revoked", {
      certificateId,
      certificateNumber: certificate.certificateNumber,
      reason,
      revokedBy,
      tenantId,
    });

    return {
      success: true,
      status: 200,
      message: "Certificate revoked successfully",
      data: certificate,
    };
  } catch (error) {
    logger.error("Error revoking certificate", {
      error: error.message,
    });
    throw error;
  }
};

/**
 * Get certificate statistics for a tenant
 */
exports.getCertificateStats = async (tenantId) => {
  try {
    const totalCertificates = await Certificate.count({ where: { tenantId } });
    const byStatus = await Certificate.countByStatus(tenantId, {
      Certificate,
      Sequelize,
    });

    // Get certificates by type
    const byTypeResult = await Certificate.findAll({
      where: { tenantId },
      attributes: [
        "type",
        [
          require("sequelize").fn("COUNT", require("sequelize").col("id")),
          "count",
        ],
      ],
      group: ["type"],
      raw: true,
    });

    const byType = byTypeResult.reduce((acc, row) => {
      acc[row.type] = parseInt(row.count, 10);
      return acc;
    }, {});

    // Get latest certificate
    const latestCertificate = await Certificate.findOne({
      where: { tenantId },
      order: [["issueDate", "DESC"]],
      include: [
        {
          association: "device",
          attributes: ["id", "name", "serialNumber"],
          // A-109: LEFT. CalibrationDevice's defaultScope made this an
          // implicit INNER JOIN, so when the newest certificate's device was
          // soft-deleted (or foreign), "latest certificate" silently became
          // an older one — or null.
          required: false,
        },
      ],
    });

    return {
      success: true,
      status: 200,
      message: "Certificate statistics retrieved successfully",
      data: {
        totalCertificates,
        byStatus,
        byType,
        latestCertificate,
      },
    };
  } catch (error) {
    logger.error("Error fetching certificate statistics", {
      error: error.message,
    });
    throw error;
  }
};

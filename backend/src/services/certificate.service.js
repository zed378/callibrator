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
const crypto = require("crypto");

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

  if (authMethod === "password") {
    const valid = await authService.passIsValid(userId, authPayload);
    if (!valid || !valid.data.valid) {
      throw new AppError(401, "Invalid password for e-signature.");
    }
  } else if (authMethod === "mfa") {
    const user = await User.findByPk(userId);
    const valid = mfaService.verifyLogin(user, authPayload);
    if (!valid) {
      throw new AppError(401, "Invalid MFA code for e-signature.");
    }
  } else {
    throw new AppError(400, "Invalid auth method.");
  }
};

/**
 * Write the Part 11 compliance record. Called AFTER the state change so the
 * document hash captures the state that was actually signed.
 */
const logSignature = async (tenantId, certificate, userId, action, authOptions) => {
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
  });
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
exports.createCertificate = async (tenantId, userId, inputData) => {
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

    const certificate = await Certificate.create({
      ...validated,
      tenantId,
      certificateNumber,
      issueDate: new Date(),
      createdBy: userId,
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
exports.updateCertificate = async (tenantId, certificateId, inputData) => {
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

    // Cannot update signed or revoked certificates
    if (
      certificate.status === Certificate.STATUS.SIGNED ||
      certificate.status === Certificate.STATUS.REVOKED
    ) {
      return {
        success: false,
        status: 400,
        message: `Cannot update ${certificate.status} certificate`,
        data: null,
      };
    }

    await certificate.update({
      ...validated,
      updatedBy: inputData.updatedBy || null,
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
exports.deleteCertificate = async (tenantId, certificateId) => {
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

    // Cannot delete signed certificates (must revoke instead)
    if (certificate.status === Certificate.STATUS.SIGNED) {
      return {
        success: false,
        status: 400,
        message:
          "Cannot delete signed certificate. Use revoke endpoint instead.",
        data: null,
      };
    }

    await certificate.destroy();

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

    await certificate.approve();
    certificate.approvedBy = approvedBy;
    certificate.issueDate = new Date();
    await certificate.save();

    // Logged after the save so the hash captures the approved state.
    await logSignature(tenantId, certificate, approvedBy, "approve", authOptions);

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
exports.submitCertificateForApproval = async (tenantId, certificateId) => {
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

  await certificate.submitForApproval();

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

    await certificate.sign(signatureData, keyId);
    certificate.signedBy = signedBy;
    await certificate.save();

    // Logged after the save so the hash captures the signed state.
    await logSignature(tenantId, certificate, signedBy, "sign", authOptions);

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

    await certificate.revoke(reason);

    // Logged after the mutation so the hash captures the revoked state.
    await logSignature(tenantId, certificate, revokedBy, "revoke", authOptions);

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

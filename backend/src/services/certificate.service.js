/**
 * Certificate Service
 *
 * Handles certificate CRUD operations, approval, signing, and revocation.
 */

const { Op, Transaction } = require("sequelize");
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
const webhookService = require("./webhook.service");
const { WEBHOOK_EVENTS } = require("../constants/webhookEvents");
const { db } = require("../config");
const { PLATFORM_TENANT_ID } = require("../constants/platformTenant");
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
 * A-92 / A-130 (ADR-051 A-107) — why a certificate refuses deletion (a state
 * conflict, 409), keyed by the statuses that refuse it. `draft` and
 * `pending_approval` are not keys: they may still be deleted. An `approved`
 * certificate has been attested by its approver's re-authenticated signature,
 * a `signed` one is issued, and a `revoked` one is the permanent record that it
 * was withdrawn — which the public verification page must go on reporting.
 */
const DELETE_REFUSAL_EXPLANATIONS = {
  approved:
    'This certificate is "approved" and cannot be deleted: its approval is a signed record. ' +
    "Revoke it with POST /certificates/:id/revoke instead.",
  signed:
    'This certificate is "signed" and cannot be deleted: a signed certificate is a controlled record ' +
    "whose signature must stay verifiable. Revoke it with POST /certificates/:id/revoke instead.",
  revoked:
    'This certificate is "revoked" and cannot be deleted: a revoked certificate is the permanent record ' +
    "that it was withdrawn, and its verification page goes on showing it as revoked.",
};

/**
 * A-167 — why a status transition is refused (409), keyed by the transition
 * and then by the certificate's current status. Only the statuses that refuse
 * the transition are keys.
 */
const TRANSITION_REFUSALS = {
  submitted: {
    pending_approval: "it has already been submitted and is waiting for approval",
    approved: "it has already been approved; sign it with POST /certificates/:id/sign",
    signed: "it has already been approved and signed",
    revoked: "revocation is final; issue a new certificate instead",
  },
  approved: {
    draft: "it has not been submitted yet; submit it with POST /certificates/:id/submit first",
    approved: "it has already been approved; sign it with POST /certificates/:id/sign",
    signed: "it has already been approved and signed",
    revoked: "revocation is final; issue a new certificate instead",
  },
  signed: {
    draft:
      "only an approved certificate can be signed; submit it with POST /certificates/:id/submit, then approve it",
    pending_approval:
      "only an approved certificate can be signed; approve it with POST /certificates/:id/approve first",
    signed: "it has already been signed, and a certificate is signed once",
    revoked: "revocation is final; issue a new certificate instead",
  },
  revoked: {
    revoked: "it has already been revoked, and revocation is final",
  },
};

/**
 * A-167 — the state explanation for a refused transition.
 *
 * @param {string} status - the certificate's current (locked) status
 * @param {"submitted"|"approved"|"signed"|"revoked"} transition
 * @returns {string|null} the refusal, or null when the transition is allowed
 */
const explainRefusedTransition = (status, transition) => {
  const reason = TRANSITION_REFUSALS[transition][status];
  return reason
    ? `This certificate is "${status}" and cannot be ${transition}: ${reason}.`
    : null;
};

/**
 * A-167 — load a certificate for a status transition INSIDE the transition's
 * transaction, locked (SELECT ... FOR UPDATE), as A-157 does for
 * deleteCertificate. The status that decides the transition used to be read
 * before the transaction with no lock: an approval could update a certificate
 * that a concurrent delete had just removed, and two concurrent transitions
 * could both pass the same check. Under the lock a concurrent delete or
 * transition either commits first — and this read, which waits for it, sees
 * the row gone (404) or its new status (409) — or waits for this one.
 *
 * @returns {Promise<Object|null>} the locked certificate, or null (404)
 */
const lockCertificate = (tenantId, certificateId, transaction) =>
  Certificate.findOne({
    where: { id: certificateId, tenantId },
    transaction,
    lock: Transaction.LOCK.UPDATE,
  });

/** The 404 result the transitions return (not thrown: the controller renders it). */
const CERTIFICATE_NOT_FOUND = {
  success: false,
  status: 404,
  message: "Certificate not found",
  data: null,
};

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
 * @param {string} userId - the authenticated caller
 * @param {Object} authOptions - authMethod, authPayload, meaning, ipAddress, userAgent
 * @param {Object} context - A-126: what is being signed (tenantId, resourceType,
 *   resourceId, operation), for the SIGNATURE_AUTH_FAILED row
 * @throws {AppError} 400 on a missing/invalid payload, 401 on failed re-auth.
 */
const verifySignatureAuth = async (userId, authOptions, context) => {
  const { authMethod, authPayload, meaning } = authOptions || {};

  if (!authMethod || !authPayload || !meaning) {
    throw new AppError(400, "Missing required E-signature authentication payload.");
  }

  // A-126: `context` says what was being signed, for a SIGNATURE_AUTH_FAILED row.
  await verifySignerCredentials(userId, authMethod, authPayload, {
    ...context,
    ipAddress: authOptions.ipAddress,
    userAgent: authOptions.userAgent,
  });
};

/**
 * A-126 (ADR-051 Q-15) — a wrong signing credential is an audit row,
 * `SIGNATURE_AUTH_FAILED`: 21 CFR 11.300(d) wants attempts to use signature
 * credentials without authority detected and reported.
 *
 * Written in its OWN transaction, committed before the 401 is thrown. The
 * certificate transitions re-authenticate inside the transition's transaction,
 * which the 401 rolls back — a row written there would vanish with it. If
 * the row cannot be written the error propagates and the caller gets a 500,
 * not the 401: an attempt that cannot be recorded is not answered.
 *
 * The actor is the signed-in caller (whose session is being used); the row
 * never carries the payload, only which method failed. It goes in the tenant
 * of the record being signed; with no context, in the signer's own tenant
 * (PLATFORM for an account with none, ADR-051 Q-14).
 *
 * @param {string} userId - the authenticated caller
 * @param {"password"|"mfa"} authMethod
 * @param {{tenantId?: string, resourceType?: string, resourceId?: string,
 *   operation?: string, ipAddress?: string, userAgent?: string}} context
 */
const recordSignatureAuthFailure = async (userId, authMethod, context) => {
  const tenantId =
    context.tenantId ||
    (await User.findByPk(userId, { attributes: ["id", "tenantId"] }))?.tenantId ||
    PLATFORM_TENANT_ID;
  // A new, independent transaction: Sequelize never makes db.transaction() a
  // child of the CLS one unless it is passed as `transaction`.
  await db.transaction(
    (transaction) =>
      auditService.logAction(
        {
          tenantId,
          userId,
          action: "SIGNATURE_AUTH_FAILED",
          resourceType: context.resourceType || "User",
          resourceId: context.resourceId || userId,
          changes: { method: authMethod, operation: context.operation || null },
          ipAddress: context.ipAddress || null,
          userAgent: context.userAgent || null,
        },
        { transaction },
      ),
  );
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
 * @param {object} [context] - A-126: what is being signed, for the
 *   SIGNATURE_AUTH_FAILED row a wrong credential writes
 *   (recordSignatureAuthFailure)
 * @throws {AppError} 400 on an unknown method or an account without MFA,
 *   401 when the credential is wrong or missing.
 */
const verifySignerCredentials = async (userId, authMethod, authPayload, context = {}) => {
  if (authMethod !== "password" && authMethod !== "mfa") {
    throw new AppError(400, "Invalid auth method.");
  }
  if (!authPayload) {
    throw new AppError(401, "Re-authentication is required to sign.");
  }

  if (authMethod === "password") {
    const valid = await authService.passIsValid(userId, authPayload);
    if (!valid || !valid.data.valid) {
      await recordSignatureAuthFailure(userId, authMethod, context);
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
    await recordSignatureAuthFailure(userId, authMethod, context);
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
    // D-40: certificate_number is unique PLATFORM-wide — it is the key the
    // public verification page resolves (ADR-063). The prefix must
    // therefore be distinct per tenant. `tenants.code` is globally unique but
    // nullable; every code-less tenant used to share the prefix "T", and the
    // generator's tenant-scoped lookup could not see the other tenant's
    // numbers, so the second code-less tenant to issue a certificate on a
    // given day collided with the first and failed with a unique violation.
    const tenantCode = tenant?.code || `T${String(tenantId).replace(/-/g, "").slice(0, 8).toUpperCase()}`;

    // Generate unique certificate number
    const certificateNumber = await Certificate.generateCertificateNumber(
      tenantCode,
      { Certificate, Sequelize },
    );

    const workflowService = require("./workflow.service");
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
      // A-190 — the certificate's approval workflow starts in the SAME
      // transaction. It used to start after the commit, so a failure there
      // left a certificate with no workflow: one that could never pass
      // through the approval chain its tenant had configured. Now a failure
      // rolls the certificate back with it, and the caller gets the error.
      const instance = await workflowService.startWorkflow(
        tenantId,
        "Certificate",
        created.id,
        transaction,
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
          workflowInstanceId: instance ? instance.id : null,
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
    // A-157 — the status that decides whether a delete is allowed is read
    // INSIDE the delete's transaction, with the row locked (SELECT ... FOR
    // UPDATE). It used to be read before the transaction with no lock, so an
    // approval committing between that read and the destroy was deleted
    // anyway: the refusal below checked a status that was no longer true.
    // Under the lock, a concurrent approval either commits first (and this
    // read, which waits for it, sees "approved") or waits for this delete.
    // The static Transaction.LOCK is the same constant as transaction.LOCK.
    const outcome = await db.transaction(async (transaction) => {
      const certificate = await Certificate.findOne({
        where: { id: certificateId, tenantId },
        transaction,
        lock: Transaction.LOCK.UPDATE,
      });

      if (!certificate) {
        return null;
      }

      // Only a draft or a certificate pending approval may be deleted (A-130,
      // ADR-051 A-107; until then only `signed` was refused, so a revoked
      // certificate could be deleted and its public verification then answered
      // "no certificate matches" — F-11). A-92: a state conflict, so 409 with
      // the state and the way forward — not a 400. Thrown, not returned: the
      // controller renders a returned result through success(), which would
      // have sent `success: true` with the 409.
      if (Object.prototype.hasOwnProperty.call(DELETE_REFUSAL_EXPLANATIONS, certificate.status)) {
        throw new AppError(409, DELETE_REFUSAL_EXPLANATIONS[certificate.status]);
      }

      await certificate.destroy({ transaction });
      // D-22 (ADR-070): its attachments go with it, in this transaction.
      await require("./attachment.service").softDeleteForResource(
        tenantId,
        "Certificate",
        certificate.id,
        { transaction, actor },
      );
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
      return certificate;
    });

    if (!outcome) {
      return {
        success: false,
        status: 404,
        message: "Certificate not found",
        data: null,
      };
    }

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
 * A-167 — run one status transition: lock the certificate inside the
 * transaction (lockCertificate), refuse a transition its current status does
 * not allow (409, explained), re-authenticate when the transition is a
 * signature, then apply `mutate` to the LOCKED row. Everything, audit row
 * included, commits together or not at all.
 *
 * Re-authentication runs inside the transaction and after the status check:
 * a refused transition then consumes no one-time MFA code, and the check
 * still comes BEFORE the state change it authorises (Part 11). With CLS on,
 * a consumed MFA code (users.mfa_last_used_step) commits or rolls back with
 * the transition it authorised; the password check writes nothing.
 *
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {string} params.certificateId
 * @param {"submitted"|"approved"|"signed"|"revoked"} params.transition
 * @param {{userId: string, authOptions: Object}|null} params.reauth - who
 *   re-authenticates, or null for a transition that is not a signature
 * @param {(transaction: Object, certificate: Object) => Promise<void>} [params.guard] -
 *   a further refusal, checked after the status and BEFORE re-authentication
 * @param {(transaction: Object, certificate: Object, previousStatus: string) => Promise<void>} params.mutate
 * @returns {Promise<Object|null>} the transitioned certificate, or null (404)
 * @throws {AppError} 409 with the state explanation; 400/401 from re-auth
 */
const runTransition = ({ tenantId, certificateId, transition, reauth, mutate, guard }) =>
  db.transaction(async (transaction) => {
    const certificate = await lockCertificate(tenantId, certificateId, transaction);
    if (!certificate) {
      return null;
    }

    const refusal = explainRefusedTransition(certificate.status, transition);
    if (refusal) {
      throw new AppError(409, refusal);
    }
    if (guard) {
      await guard(transaction, certificate);
    }

    if (reauth) {
      await verifySignatureAuth(reauth.userId, reauth.authOptions, {
        tenantId,
        resourceType: "Certificate",
        resourceId: certificateId,
        operation: transition,
      });
    }

    await mutate(transaction, certificate, certificate.status);
    return certificate;
  });

/**
 * A-203 (ADR-065) — the workflow is mandatory once it has started: a
 * certificate whose approval workflow is PENDING is approved through that
 * workflow (where every step's approver re-authenticates, A-182), never
 * directly. The direct route stays for a tenant with no workflow configured.
 * Checked under the certificate's row lock, before re-authentication, so a
 * refusal consumes no one-time MFA code.
 */
const refuseWhileWorkflowPending = async (transaction, certificate) => {
  const pending = await require("./workflow.service").findPendingInstance(
    certificate.tenantId,
    "Certificate",
    certificate.id,
    transaction,
  );
  if (pending) {
    throw new AppError(
      409,
      `This certificate is in its approval workflow "${pending.workflow.name}" (step ` +
        `${pending.currentStepOrder}) and is approved there, not directly: act on it with ` +
        "POST /workflows/instances/:instanceId/action. Nothing was recorded.",
    );
  }
};

/**
 * Approve a certificate (move from pending_approval to approved)
 */
exports.approveCertificate = async (tenantId, certificateId, approvedBy, authOptions) => {
  try {
    const certificate = await runTransition({
      tenantId,
      certificateId,
      transition: "approved",
      guard: refuseWhileWorkflowPending,
      // Re-authenticate BEFORE mutating: the signature authorises the approval.
      reauth: { userId: approvedBy, authOptions },
      mutate: async (transaction, locked, previousStatus) => {
        await locked.approve({ transaction });
        locked.approvedBy = approvedBy;
        locked.issueDate = new Date();
        await locked.save({ transaction });

        // Logged after the save so the hash captures the approved state.
        await logSignature(tenantId, locked, approvedBy, "approve", authOptions, transaction);

        await auditCertificate(transaction, locked, {
          tenantId,
          userId: approvedBy,
          action: "APPROVE",
          operation: "APPROVE",
          before: { status: previousStatus },
          after: { status: locked.status, approvedBy, meaning: authOptions.meaning },
          ipAddress: authOptions.ipAddress,
          userAgent: authOptions.userAgent,
        });
        // A-11: announced only after this transaction commits.
        webhookService.emitAfterCommit(transaction, tenantId, WEBHOOK_EVENTS.CERTIFICATE_APPROVED, {
          certificateId: locked.id, certificateNumber: locked.certificateNumber, deviceId: locked.deviceId, status: locked.status, approvedBy,
        });
      },
    });

    if (!certificate) {
      return CERTIFICATE_NOT_FOUND;
    }

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
 * A-182 — why a workflow REJECTION is refused (409), keyed by the statuses that
 * refuse it. A rejection returns a certificate to `draft` for its author to
 * rework; that is only meaningful before it is approved. It used to reset the
 * certificate to `draft` from ANY state — including an approved, signed or
 * revoked one, silently un-issuing a signed record.
 */
const WORKFLOW_REJECTION_REFUSALS = {
  approved:
    "its approval is a signed record and a workflow rejection cannot undo it; " +
    "revoke it with POST /certificates/:id/revoke instead",
  signed:
    "a signed certificate is a controlled record and a workflow rejection cannot undo it; " +
    "revoke it with POST /certificates/:id/revoke instead",
  revoked: "revocation is final; issue a new certificate instead",
};

/** A-182 — the certificate a workflow instance decides on was deleted after the workflow started. */
const WORKFLOW_TARGET_GONE =
  "The certificate this workflow decides on no longer exists (it was deleted), so it can be " +
  "neither approved nor rejected. Nothing was recorded.";

/**
 * A-182 — lock the certificate a workflow decision acts on, INSIDE the
 * decision's transaction (SELECT ... FOR UPDATE, as runTransition does), and
 * refuse a decision its current status does not allow: 409 with the state
 * explanation. Called BEFORE re-authentication, so a refused decision consumes
 * no one-time MFA code.
 *
 * - `approve`: the certificate state machine's own rule (ADR-035) — only a
 *   `pending_approval` certificate can be approved. The workflow used to set
 *   APPROVED from any status, a draft included.
 * - `reject`: only a `draft` or `pending_approval` certificate.
 *
 * @param {Object} transaction - the workflow decision's transaction
 * @param {string} tenantId
 * @param {string} certificateId - the workflow instance's resourceId
 * @param {"approve"|"reject"} decision
 * @returns {Promise<Object>} the locked certificate
 * @throws {AppError} 409 with the state explanation, or when the certificate is gone
 */
exports.lockForWorkflowDecision = async (transaction, tenantId, certificateId, decision) => {
  const certificate = await lockCertificate(tenantId, certificateId, transaction);
  if (!certificate) {
    throw new AppError(409, WORKFLOW_TARGET_GONE);
  }
  const refusal =
    decision === "approve"
      ? explainRefusedTransition(certificate.status, "approved")
      : WORKFLOW_REJECTION_REFUSALS[certificate.status] &&
        `This certificate is "${certificate.status}" and cannot be rejected: ` +
          `${WORKFLOW_REJECTION_REFUSALS[certificate.status]}.`;
  if (refusal) {
    throw new AppError(409, refusal);
  }
  return certificate;
};

/**
 * A-182 — apply a workflow's FINAL approval to the certificate locked by
 * lockForWorkflowDecision, exactly as POST /certificates/:id/approve does:
 * the transition, the approver (the re-authenticated caller — never a body
 * field, A-62), the Part 11 ESignatureRecord, the audit row and the webhook,
 * all in the workflow decision's transaction.
 *
 * The caller must already have re-authenticated `approverId`
 * (verifySignatureAuth) inside that transaction.
 *
 * The workflow path used to write `approvedById` and `approvedAt`, neither of
 * which is a Certificate attribute (the column is `approvedBy`), so a
 * workflow-approved certificate recorded no approver at all (A-200).
 *
 * @param {Object} transaction
 * @param {Object} certificate - locked, status `pending_approval`
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {string} params.approverId - the authenticated caller
 * @param {Object} params.authOptions - authMethod, authPayload, meaning, ipAddress, userAgent
 * @param {string} params.workflowInstanceId - recorded in the audit row
 */
exports.applyWorkflowApproval = async (
  transaction,
  certificate,
  { tenantId, approverId, authOptions, workflowInstanceId },
) => {
  const previousStatus = certificate.status;
  await certificate.approve({ transaction });
  certificate.approvedBy = approverId;
  certificate.issueDate = new Date();
  await certificate.save({ transaction });

  await logSignature(tenantId, certificate, approverId, "approve", authOptions, transaction);

  await auditCertificate(transaction, certificate, {
    tenantId,
    userId: approverId,
    action: "APPROVE",
    operation: "APPROVE",
    before: { status: previousStatus },
    after: {
      status: certificate.status,
      approvedBy: approverId,
      meaning: authOptions.meaning,
      workflowInstanceId,
    },
    ipAddress: authOptions.ipAddress,
    userAgent: authOptions.userAgent,
  });
  webhookService.emitAfterCommit(transaction, tenantId, WEBHOOK_EVENTS.CERTIFICATE_APPROVED, {
    certificateId: certificate.id,
    certificateNumber: certificate.certificateNumber,
    deviceId: certificate.deviceId,
    status: certificate.status,
    approvedBy: approverId,
  });
};

/**
 * A-182 — apply a workflow REJECTION to the certificate locked by
 * lockForWorkflowDecision: a `pending_approval` certificate returns to
 * `draft` for rework, with its own audit row in the decision's transaction.
 * A `draft` is left as it is — nothing about the certificate changes, and
 * the workflow instance's own audit row records the rejection.
 *
 * @param {Object} transaction
 * @param {Object} certificate - locked, status `draft` or `pending_approval`
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {string} params.userId - the rejecting caller
 * @param {string} params.workflowInstanceId
 * @param {string|null} [params.comments]
 */
exports.applyWorkflowRejection = async (
  transaction,
  certificate,
  { tenantId, userId, workflowInstanceId, comments },
) => {
  if (certificate.status !== "pending_approval") {
    return;
  }
  certificate.status = "draft";
  await certificate.save({ transaction });
  await auditCertificate(transaction, certificate, {
    tenantId,
    userId,
    action: "UPDATE",
    operation: "WORKFLOW_REJECT",
    before: { status: "pending_approval" },
    after: { status: "draft", workflowInstanceId, comments: comments || null },
  });
};

/**
 * A-182 — the workflow decision's re-authentication: the same check, and the
 * same SIGNATURE_AUTH_FAILED row on a wrong credential, as every other
 * certificate signature (verifySignatureAuth).
 */
exports.verifyWorkflowApprovalAuth = (userId, authOptions, context) =>
  verifySignatureAuth(userId, authOptions, context);

/**
 * Submit a DRAFT certificate for approval (DRAFT -> PENDING_APPROVAL) so it can
 * then be approved. Without this transition, approve() is unreachable and 500s.
 */
exports.submitCertificateForApproval = async (tenantId, certificateId, actor = {}) => {
  const certificate = await runTransition({
    tenantId,
    certificateId,
    transition: "submitted",
    reauth: null,
    mutate: async (transaction, locked, previousStatus) => {
      await locked.submitForApproval({ transaction });
      // A-203 (ADR-065) — a certificate re-submitted after its workflow
      // rejected it goes through the chain again: a new instance starts, in
      // this transaction. Without it the rejected instance was the last word,
      // and the re-submitted certificate could be approved directly.
      const workflowService = require("./workflow.service");
      const pending = await workflowService.findPendingInstance(tenantId, "Certificate", locked.id, transaction);
      const instance =
        pending || (await workflowService.startWorkflow(tenantId, "Certificate", locked.id, transaction));
      await auditCertificate(transaction, locked, {
        tenantId,
        userId: actor.userId,
        action: "UPDATE",
        operation: "SUBMIT_FOR_APPROVAL",
        before: { status: previousStatus },
        after: { status: locked.status, workflowInstanceId: instance ? instance.id : null },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
    },
  });

  if (!certificate) {
    return CERTIFICATE_NOT_FOUND;
  }

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
 * Sign a certificate digitally.
 *
 * A-167 — only an approved certificate can be signed. The model's sign()
 * refused anything else with a plain Error, which answered 500; the refusal
 * is now a 409 with the state explanation, decided under the row lock.
 */
exports.signCertificate = async (
  tenantId,
  certificateId,
  signatureData,
  keyId,
  signedBy,
  authOptions,
) => {
  try {
    const certificate = await runTransition({
      tenantId,
      certificateId,
      transition: "signed",
      // Re-authenticate BEFORE mutating: the signature authorises the signing.
      reauth: { userId: signedBy, authOptions },
      mutate: async (transaction, locked, previousStatus) => {
        await locked.sign(signatureData, keyId, { transaction });
        locked.signedBy = signedBy;
        await locked.save({ transaction });

        // Logged after the save so the hash captures the signed state.
        await logSignature(tenantId, locked, signedBy, "sign", authOptions, transaction);

        // A signature is a decision, not a field change: APPROVE, with the
        // operation named (audit_logs.action has no SIGN member).
        await auditCertificate(transaction, locked, {
          tenantId,
          userId: signedBy,
          action: "APPROVE",
          operation: "SIGN",
          before: { status: previousStatus },
          after: { status: locked.status, signedBy, keyId, meaning: authOptions.meaning },
          ipAddress: authOptions.ipAddress,
          userAgent: authOptions.userAgent,
        });
        // A-11: announced only after this transaction commits.
        webhookService.emitAfterCommit(transaction, tenantId, WEBHOOK_EVENTS.CERTIFICATE_SIGNED, {
          certificateId: locked.id, certificateNumber: locked.certificateNumber, deviceId: locked.deviceId, status: locked.status, signedBy,
        });
      },
    });

    if (!certificate) {
      return CERTIFICATE_NOT_FOUND;
    }

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
 * Revoke a certificate.
 *
 * A-167 — revoking a revoked certificate is a 409. The model's revoke()
 * returned silently for it, and this then wrote a second REVOKE signature
 * record and audit row for a revocation that did not happen.
 */
exports.revokeCertificate = async (
  tenantId,
  certificateId,
  reason,
  revokedBy,
  authOptions,
) => {
  try {
    const certificate = await runTransition({
      tenantId,
      certificateId,
      transition: "revoked",
      // Re-authenticate BEFORE mutating: the signature authorises the revocation.
      reauth: { userId: revokedBy, authOptions },
      mutate: async (transaction, locked, previousStatus) => {
        await locked.revoke(reason, { transaction });

        // Logged after the mutation so the hash captures the revoked state.
        await logSignature(tenantId, locked, revokedBy, "revoke", authOptions, transaction);

        // No REVOKE member in audit_logs.action: UPDATE, with the operation named.
        await auditCertificate(transaction, locked, {
          tenantId,
          userId: revokedBy,
          action: "UPDATE",
          operation: "REVOKE",
          before: { status: previousStatus },
          after: { status: locked.status, reason },
          ipAddress: authOptions.ipAddress,
          userAgent: authOptions.userAgent,
        });
        // A-11: announced only after this transaction commits.
        webhookService.emitAfterCommit(transaction, tenantId, WEBHOOK_EVENTS.CERTIFICATE_REVOKED, {
          certificateId: locked.id, certificateNumber: locked.certificateNumber, deviceId: locked.deviceId, status: locked.status, revokedBy,
        });
      },
    });

    if (!certificate) {
      return CERTIFICATE_NOT_FOUND;
    }

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

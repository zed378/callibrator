/**
 * Certificate Controller
 *
 * Handles HTTP requests for certificate CRUD operations.
 */

const certificateService = require("../services/certificate.service");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { success } = require("../utils/response.util");
const {
  getCertificatesQuery,
  certificateIdSchema,
  createCertificateSchema,
  updateCertificateSchema,
  approveCertificateSchema,
  signCertificateSchema,
  revokeCertificateSchema,
  validate,
} = require("../validators/certificate.validator");

/**
 * GET /api/certificates
 * List all certificates with pagination and filtering
 */
exports.getAllCertificates = asyncHandler(async (req, res) => {
  const tenantId = req.user.tenantId;
  const validated = validate(req.query, getCertificatesQuery);
  const result = await certificateService.fetchCertificates({
    tenantId,
    page: validated.page,
    limit: validated.limit,
    deviceId: validated.deviceId,
    status: validated.status,
    type: validated.type,
    certificateNumber: validated.certificateNumber,
    from: validated.from,
    to: validated.to,
    sortBy: validated.sortBy,
    sortOrder: validated.sortOrder,
  });

  success(
    res,
    result.data.rows,
    result.data.meta,
    result.message,
    result.status,
  );
});

/**
 * GET /api/certificates/:certificateId
 * Get a specific certificate
 */
exports.getSpecificCertificate = asyncHandler(async (req, res) => {
  const tenantId = req.user.tenantId;
  const { certificateId } = validate(req.params, certificateIdSchema);
  const result = await certificateService.fetchSpecificCertificate(
    tenantId,
    certificateId,
  );

  success(res, result.data, null, result.message, result.status);
});

/**
 * POST /api/certificates
 * Create a new certificate
 */
exports.createCertificate = asyncHandler(async (req, res) => {
  const tenantId = req.user.tenantId;
  const userId = req.user.id;
  const validated = validate(req.body, createCertificateSchema);
  const result = await certificateService.createCertificate(
    tenantId,
    userId,
    validated,
  );

  success(res, result.data, null, result.message, result.status);
});

/**
 * PUT /api/certificates/:certificateId
 * Update a certificate
 */
exports.updateCertificate = asyncHandler(async (req, res) => {
  const tenantId = req.user.tenantId;
  const { certificateId } = validate(req.params, certificateIdSchema);
  const validated = validate(req.body, updateCertificateSchema);
  const result = await certificateService.updateCertificate(
    tenantId,
    certificateId,
    { ...validated, updatedBy: req.user.id },
  );

  success(res, result.data, null, result.message, result.status);
});

/**
 * DELETE /api/certificates/:certificateId
 * Delete a certificate
 */
exports.deleteCertificate = asyncHandler(async (req, res) => {
  const tenantId = req.user.tenantId;
  const { certificateId } = validate(req.params, certificateIdSchema);
  const result = await certificateService.deleteCertificate(
    tenantId,
    certificateId,
  );

  success(res, result.data, null, result.message, result.status);
});

/**
 * POST /api/certificates/:certificateId/approve
 * Approve a certificate
 */
exports.approveCertificate = asyncHandler(async (req, res) => {
  const tenantId = req.user.tenantId;
  const { certificateId } = validate(req.params, certificateIdSchema);
  const validated = validate(req.body, approveCertificateSchema);
  const result = await certificateService.approveCertificate(
    tenantId,
    certificateId,
    validated.approvedBy || req.user.id,
    {
      authMethod: validated.authMethod,
      authPayload: validated.authPayload,
      meaning: validated.meaning,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    }
  );

  success(res, result.data, null, result.message, result.status);
});

/**
 * POST /api/certificates/:certificateId/sign
 * Sign a certificate digitally
 */
exports.submitCertificate = asyncHandler(async (req, res) => {
  const tenantId = req.user.tenantId;
  const { certificateId } = validate(req.params, certificateIdSchema);
  const result = await certificateService.submitCertificateForApproval(
    tenantId,
    certificateId,
  );
  success(res, result.data, null, result.message, result.status);
});

exports.signCertificate = asyncHandler(async (req, res) => {
  const tenantId = req.user.tenantId;
  const { certificateId } = validate(req.params, certificateIdSchema);
  const validated = validate(req.body, signCertificateSchema);
  const result = await certificateService.signCertificate(
    tenantId,
    certificateId,
    validated.digitalSignature,
    validated.digitalSignatureKeyId,
    req.user.id,
    {
      authMethod: validated.authMethod,
      authPayload: validated.authPayload,
      meaning: validated.meaning,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    }
  );

  success(res, result.data, null, result.message, result.status);
});

/**
 * POST /api/certificates/:certificateId/revoke
 * Revoke a certificate
 */
exports.revokeCertificate = asyncHandler(async (req, res) => {
  const tenantId = req.user.tenantId;
  const { certificateId } = validate(req.params, certificateIdSchema);
  const validated = validate(req.body, revokeCertificateSchema);
  const result = await certificateService.revokeCertificate(
    tenantId,
    certificateId,
    validated.reason,
    req.user.id,
    {
      authMethod: validated.authMethod,
      authPayload: validated.authPayload,
      meaning: validated.meaning,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    }
  );

  success(res, result.data, null, result.message, result.status);
});

/**
 * GET /api/certificates/stats
 * Get certificate statistics
 */
exports.getCertificateStats = asyncHandler(async (req, res) => {
  const tenantId = req.user.tenantId;
  const result = await certificateService.getCertificateStats(tenantId);

  success(res, result.data, null, result.message, result.status);
});

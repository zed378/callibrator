// src/controllers/certificatePdf.controller.js
//
// PDF generation/download + public verification for certificates.

const certificatePdfService = require("../services/certificatePdf.service");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { success } = require("../utils/response.util");
const { AppError } = require("../utils/appError.util");
const {
  validate,
  certificateIdSchema,
} = require("../validators/certificate.validator");

const baseUrlOf = (req) => `${req.protocol}://${req.get("host")}`;

// POST /api/v1/certificates/:certificateId/pdf — (re)generate the PDF.
exports.generatePdf = asyncHandler(async (req, res) => {
  const tenantId = req.user.tenantId;
  const { certificateId } = validate(req.params, certificateIdSchema);
  const result = await certificatePdfService.generateCertificatePdf(
    tenantId,
    certificateId,
    { baseUrl: baseUrlOf(req) },
  );
  if (!result.success) {
    throw new AppError(result.status || 500, result.message);
  }
  success(res, result.data, null, result.message, result.status);
});

// GET /api/v1/certificates/:certificateId/pdf — download (generate if missing).
exports.downloadPdf = asyncHandler(async (req, res) => {
  const tenantId = req.user.tenantId;
  const { certificateId } = validate(req.params, certificateIdSchema);
  const result = await certificatePdfService.getOrCreatePdf(
    tenantId,
    certificateId,
    { baseUrl: baseUrlOf(req) },
  );
  if (!result.success) {
    throw new AppError(result.status || 500, result.message);
  }
  return res.download(result.data.absPath, result.data.fileName);
});

// GET /api/v1/certificates/verify/:certificateNumber — PUBLIC, no auth.
exports.verifyCertificate = asyncHandler(async (req, res) => {
  const { certificateNumber } = req.params;
  const result = await certificatePdfService.verifyByCertificateNumber(
    certificateNumber,
    { baseUrl: baseUrlOf(req) },
  );
  success(
    res,
    result.data,
    null,
    result.data.found
      ? "Certificate verification result"
      : "Certificate not found",
    200,
  );
});

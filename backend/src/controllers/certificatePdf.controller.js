// src/controllers/certificatePdf.controller.js
//
// PDF generation/download + public verification for certificates.

const certificatePdfService = require("../services/certificatePdf.service");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { success } = require("../utils/response.util");
const { AppError } = require("../utils/appError.util");
const { sendStoredFile } = require("../utils/fileResponse.util");
const {
  validate,
  certificateIdSchema,
} = require("../validators/certificate.validator");
// A-189: the configured public origin, never the proxy-facing Host header.
const { baseUrlOf } = require("../utils/publicBaseUrl.util");

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

/**
 * Who may frame the certificate document: this origin, and the configured
 * frontend origins (CORS_ORIGIN) — the verification page renders it in an
 * <iframe>. Helmet's global `frame-ancestors 'none'` + X-Frame-Options would
 * otherwise blank that iframe. Only well-formed http(s) origins are admitted,
 * so a stray value cannot inject another CSP directive.
 */
const documentFrameAncestors = () => {
  const origins = String(process.env.CORS_ORIGIN || "")
    .split(",")
    .map((o) => o.trim())
    .filter((o) => /^https?:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(o));
  return ["'self'", ...origins].join(" ");
};
exports._documentFrameAncestors = documentFrameAncestors; // exported for tests

// GET /api/v1/certificates/verify/:certificateNumber/document?token=...
// PUBLIC, capability-gated (ADR-042 step 4): the token is minted by the
// verification endpoint above for a SIGNED certificate only, and the status is
// re-checked here. The PDF is served inline so the verification page can show
// it, with ETag/Range from sendFile.
exports.verifyDocument = asyncHandler(async (req, res) => {
  const result = await certificatePdfService.getVerifiedDocument(
    req.params.certificateNumber,
    req.query.token,
  );
  if (!result.success) {
    throw new AppError(result.status, result.message);
  }
  await sendStoredFile(res, result.data.absPath, {
    contentType: "application/pdf",
    fileName: result.data.fileName,
    frameAncestors: documentFrameAncestors(),
  });
});

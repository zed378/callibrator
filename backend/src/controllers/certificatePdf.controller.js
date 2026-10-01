// src/controllers/certificatePdf.controller.js
//
// The certificate document (data), the stored pre-M-11 PDFs, and public
// verification. The backend renders no PDF (M-11, ADR-095).

const certificatePdfService = require("../services/certificatePdf.service");
const certificateDocumentService = require("../services/certificateDocument.service");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { success } = require("../utils/response.util");
const { AppError } = require("../utils/appError.util");
const { sendStoredFile } = require("../utils/fileResponse.util");
const { certificateIdSchema } = require("../validators/certificate.validator");
const { validateInput: validate } = require("../validators/input");
// A-189: the configured public origin, never the proxy-facing Host header.
const { baseUrlOf } = require("../utils/publicBaseUrl.util");
const { requestBudget } = require("../middlewares/requestBudget.middleware");

// GET /api/v1/certificates/:certificateId/document — the certificate's DATA,
// from which the frontend renders its PDF (M-11, ADR-095). Own tenant only;
// another tenant's certificate is the same 404 as a missing one.
exports.getDocument = asyncHandler(async (req, res) => {
  const tenantId = req.user.tenantId;
  const { certificateId } = validate(req.params, certificateIdSchema);
  const result = await certificateDocumentService.getCertificateDocument(tenantId, certificateId, {
    baseUrl: baseUrlOf(req),
  });
  if (!result.success) {
    throw new AppError(result.status, result.message);
  }
  success(res, result.data, null, "Certificate document", 200);
});

// GET /api/v1/certificates/:certificateId/pdf — download the PDF the backend
// rendered before M-11, when the certificate has one. Nothing is rendered here.
exports.downloadPdf = asyncHandler(async (req, res) => {
  const tenantId = req.user.tenantId;
  const { certificateId } = validate(req.params, certificateIdSchema);
  const result = await certificatePdfService.getStoredPdf(tenantId, certificateId);
  if (!result.success) {
    throw new AppError(result.status, result.message);
  }
  return res.download(result.data.absPath, result.data.fileName);
});

// A-293 (ADR-100): every answer that is NOT the full verdict — a bare number, a
// wrong token, an unknown number — is what walking the sequential numbers
// yields, so it is counted against the tighter `certificateVerify` budget
// (per address). It can only be counted after the lookup: a wrong token must
// answer exactly like none, so the route cannot tell them apart in advance.
// Every request is also counted, before the lookup, against the route's
// `certificateVerifyToken` budget (routes/api/certificates.route.js).
const minimalVerdictBudget = requestBudget("certificateVerify");

// GET /api/v1/certificates/verify/:certificateNumber — PUBLIC, no auth.
// `?token=` is the certificate's verification token (A-293): with it the full
// verdict, without it (or with a wrong one) the minimal one.
exports.verifyCertificate = asyncHandler(async (req, res) => {
  const { certificateNumber } = req.params;
  const result = await certificatePdfService.verifyByCertificateNumber(
    certificateNumber,
    { baseUrl: baseUrlOf(req), token: req.query.token },
  );
  if (result.data.disclosure !== "full") {
    let withinBudget = false;
    await minimalVerdictBudget(req, res, () => {
      withinBudget = true;
    });
    if (!withinBudget) {
      return; // the 429 (with Retry-After) is already sent
    }
  }
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

/**
 * The certificate document (data), the stored pre-M-11 PDFs, and public
 * verification. The backend renders no PDF (M-11, ADR-095).
 *
 * P9-20 (ADR-087): converted from certificatePdf.controller.js, behaviour
 * unchanged. `req.user`, `req.params` and `req.query` are read INLINE as the
 * JavaScript read them. Everything it required at load is captured at load, in
 * its order, and the `certificateVerify` budget is built at load as before.
 * CORS_ORIGIN is read at call time, through `config/env`. `export =` keeps the
 * exact object `require()` returned (the same keys, in the same order).
 */
import type { Request, Response } from "express";
import certificatePdfService from "../services/certificatePdf.service";
import * as certificateDocumentService from "../services/certificateDocument.service";
import { asyncHandler as loadedAsyncHandler } from "../utils/controllerWrapper.util";
import { success as loadedSuccess } from "../utils/response.util";
import { AppError as LoadedAppError } from "../utils/appError.util";
import { sendStoredFile as loadedSendStoredFile } from "../utils/fileResponse.util";
import { certificateIdSchema as loadedIdSchema } from "../validators/certificate.validator";
import { validateInput } from "../validators/input";
// A-189: the configured public origin, never the proxy-facing Host header.
import { baseUrlOf as loadedBaseUrlOf } from "../utils/publicBaseUrl.util";
import { requestBudget as loadedRequestBudget } from "../middlewares/requestBudget.middleware";
import { env } from "../config/env";
import type { TenantId } from "../types/ids";

const asyncHandler = loadedAsyncHandler;
const success = loadedSuccess;
const AppError = LoadedAppError;
const sendStoredFile = loadedSendStoredFile;
const certificateIdSchema = loadedIdSchema;
const validate = validateInput;
const baseUrlOf = loadedBaseUrlOf;
const requestBudget = loadedRequestBudget;

/** The caller's tenant (`auth` ran; read without a guard, as before). */
const tenantOf = (req: Request): TenantId => (req.user as { tenantId: TenantId }).tenantId;

/** A failed service result, as these handlers throw it. */
interface Failure {
  status: number;
  message: string;
}

// GET /api/v1/certificates/:certificateId/document — the certificate's DATA,
// from which the frontend renders its PDF (M-11, ADR-095). Own tenant only;
// another tenant's certificate is the same 404 as a missing one.
const getDocument = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantOf(req);
  const { certificateId } = validate(req.params, certificateIdSchema);
  const result = await certificateDocumentService.getCertificateDocument(tenantId, certificateId, {
    baseUrl: baseUrlOf(req),
  });
  if (!result.success) {
    throw new AppError((result as Failure).status, (result as Failure).message);
  }
  success(res, result.data, null, "Certificate document", 200);
});

// GET /api/v1/certificates/:certificateId/pdf — download the PDF the backend
// rendered before M-11, when the certificate has one. Nothing is rendered here.
const downloadPdf = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantOf(req);
  const { certificateId } = validate(req.params, certificateIdSchema);
  const result = await certificatePdfService.getStoredPdf(tenantId, certificateId);
  if (!result.success) {
    throw new AppError((result as Failure).status, (result as Failure).message);
  }
  const { absPath, fileName } = result.data as { absPath: string; fileName: string };
  // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression -- as built: the .js returned res.download(...)
  return res.download(absPath, fileName);
});

// A-293 (ADR-100): every answer that is NOT the full verdict — a bare number, a
// wrong token, an unknown number — is what walking the sequential numbers
// yields, so it is counted against the tighter `certificateVerify` budget
// (per address). It can only be counted after the lookup: a wrong token must
// answer exactly like none, so the route cannot tell them apart in advance.
// Every request is also counted, before the lookup, against the route's
// `certificateVerifyToken` budget (routes/api/certificates.route.ts).
const minimalVerdictBudget = requestBudget("certificateVerify");

// GET /api/v1/certificates/verify/:certificateNumber — PUBLIC, no auth.
// `?token=` is the certificate's verification token (A-293): with it the full
// verdict, without it (or with a wrong one) the minimal one.
const verifyCertificate = asyncHandler(async (req: Request, res: Response) => {
  const { certificateNumber } = req.params as { certificateNumber: string };
  const result = await certificatePdfService.verifyByCertificateNumber(
    certificateNumber,
    { baseUrl: baseUrlOf(req), token: (req.query as { token?: unknown }).token },
  );
  // A verdict always carries `data` (found or not).
  const verdict = result.data as Record<string, unknown>;
  if (verdict["disclosure"] !== "full") {
    let withinBudget = false;
    await minimalVerdictBudget(req, res, () => {
      withinBudget = true;
    });
    // `next` above may have run: TypeScript cannot see the callback's assignment.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built (ADR-038 rule 3)
    if (!withinBudget) {
      return; // the 429 (with Retry-After) is already sent
    }
  }
  success(
    res,
    verdict,
    null,
    verdict["found"]
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
const documentFrameAncestors = (): string => {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/no-unnecessary-type-conversion -- as built: an unset or empty value is no origin, and String() is what the .js called (ADR-038 rule 3)
  const origins = String(env("CORS_ORIGIN") || "")
    .split(",")
    .map((o) => o.trim())
    .filter((o) => /^https?:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(o));
  return ["'self'", ...origins].join(" ");
};

// GET /api/v1/certificates/verify/:certificateNumber/document?token=...
// PUBLIC, capability-gated (ADR-042 step 4): the token is minted by the
// verification endpoint above for a SIGNED certificate only, and the status is
// re-checked here. The PDF is served inline so the verification page can show
// it, with ETag/Range from sendFile.
const verifyDocument = asyncHandler(async (req: Request, res: Response) => {
  const result = await certificatePdfService.getVerifiedDocument(
    (req.params as { certificateNumber: string }).certificateNumber,
    (req.query as { token?: unknown }).token,
  );
  if (!result.success) {
    throw new AppError((result as Failure).status, (result as Failure).message);
  }
  const { absPath, fileName } = result.data as { absPath: string; fileName: string };
  await sendStoredFile(res, absPath, {
    contentType: "application/pdf",
    fileName,
    frameAncestors: documentFrameAncestors(),
  });
});

export = {
  getDocument,
  downloadPdf,
  verifyCertificate,
  _documentFrameAncestors: documentFrameAncestors, // exported for tests
  verifyDocument,
};

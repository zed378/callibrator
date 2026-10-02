/**
 * Certificates, `/api/v1/certificates` (index.js mounts it).
 *
 * P9-20 (ADR-087): converted from certificates.route.js. Every route, gate and
 * middleware is in the same order as before (checked against the mounted
 * route table); the `certificateVerifyToken` budget is built at load, as
 * before. The contract is code-first: certificates.openapi.ts (P9-25, ADR-103);
 * the `@swagger` JSDoc this file carried is gone.
 */
import { Router } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { dynamicAccess } from "../../middlewares/dynamicAccess.middleware";
import { validateUuid } from "../../middlewares/validateUuid.middleware";
import { denyPlatformAuthoring } from "../../middlewares/denyPlatformAuthoring.middleware"; // A-127, ADR-051 Q-17
import certificateController from "../../controllers/certificate.controller";
import certificatePdfController from "../../controllers/certificatePdf.controller";
import { validate } from "../../middlewares/validation.middleware";
import { approveCertificateSchema } from "../../validators/certificate.validator";
import { requestBudget } from "../../middlewares/requestBudget.middleware";

// `Router` is `express.Router` (the same function).
const router = Router();

// A-293 (ADR-100): the public verification routes count EVERY request per
// client address against `certificateVerifyToken` (300 / 15 min), before the
// lookup. The verification controller then counts every answer that is not the
// full verdict (no token, a wrong token, an unknown number) against the tighter
// `certificateVerify` (60 / 15 min) — a wrong token cannot be told from no
// token before the lookup, and must not buy the looser budget.
const verifyBudget = requestBudget("certificateVerifyToken");

/* ------------------------------------------------------------------ */
/* CERTIFICATE ROUTES                                                 */
/* ------------------------------------------------------------------ */

// PUBLIC — registered before the parametric `/:certificateId` routes.
router.get("/verify/:certificateNumber", verifyBudget, certificatePdfController.verifyCertificate);

// PUBLIC — capability-gated (the token is the gate, as for /storage/object).
router.get("/verify/:certificateNumber/document", verifyBudget, certificatePdfController.verifyDocument);

router.get(
  "/",
  auth,
  dynamicAccess("certificate", "read"),
  certificateController.getAllCertificates,
);

router.post(
  "/",
  auth,
  dynamicAccess("certificate", "generate"),
  denyPlatformAuthoring, // A-145: issues a numbered certificate
  certificateController.createCertificate,
);

// NOTE: literal `/stats` MUST be registered before the parametric
// `/:certificateId` route, otherwise Express matches "stats" as an id and
// `validateUuid` returns 400.
router.get(
  "/stats",
  auth,
  dynamicAccess("certificate", "read"),
  certificateController.getCertificateStats,
);

router.get(
  "/:certificateId",
  auth,
  validateUuid("certificateId"),
  dynamicAccess("certificate", "read"),
  certificateController.getSpecificCertificate,
);

router.put(
  "/:certificateId",
  auth,
  validateUuid("certificateId"),
  dynamicAccess("certificate", "generate"),
  denyPlatformAuthoring, // A-145: edits certificate content, approved ones included
  certificateController.updateCertificate,
);

router.delete(
  "/:certificateId",
  auth,
  validateUuid("certificateId"),
  dynamicAccess("certificate", "generate"),
  denyPlatformAuthoring, // A-145: withdraws an issued certificate number
  certificateController.deleteCertificate,
);

router.post(
  "/:certificateId/approve",
  auth,
  validateUuid("certificateId"),
  dynamicAccess("certificate", "approve"),
  denyPlatformAuthoring,
  // A-62: strips a body `approvedBy` before the controller sees it. The schema
  // is body-only — the certificateId path param is validated separately
  // (validateUuid here, certificateIdSchema in the controller).
  validate(approveCertificateSchema),
  certificateController.approveCertificate,
);

// Submit a DRAFT certificate for approval (DRAFT -> PENDING_APPROVAL). Without
// this transition the approve action is unreachable. Same access as approve.
router.post(
  "/:certificateId/submit",
  auth,
  validateUuid("certificateId"),
  dynamicAccess("certificate", "approve"),
  denyPlatformAuthoring,
  certificateController.submitCertificate,
);

router.post(
  "/:certificateId/sign",
  auth,
  validateUuid("certificateId"),
  dynamicAccess("certificate", "sign"),
  denyPlatformAuthoring,
  certificateController.signCertificate,
);

router.post(
  "/:certificateId/revoke",
  auth,
  validateUuid("certificateId"),
  dynamicAccess("certificate", "generate"),
  denyPlatformAuthoring,
  certificateController.revokeCertificate,
);

router.get(
  "/:certificateId/document",
  auth,
  validateUuid("certificateId"),
  dynamicAccess("certificate", "read"),
  certificatePdfController.getDocument,
);

router.get(
  "/:certificateId/pdf",
  auth,
  validateUuid("certificateId"),
  dynamicAccess("certificate", "read"),
  certificatePdfController.downloadPdf,
);

export = router;

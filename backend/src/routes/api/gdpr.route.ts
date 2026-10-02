/**
 * Data subject requests (GDPR / CCPA): `/api/v1/gdpr` (index.js mounts it).
 *
 * P9-18 (ADR-087): converted from gdpr.route.js. Every route and middleware is
 * in the same order as before (checked against the mounted route table). The
 * contract is code-first: gdpr.openapi.ts (P9-25, ADR-103); the `@swagger`
 * JSDoc this file carried is gone.
 */
import { Router } from "express";
import { auth } from "../../middlewares/auth.middleware";
import {
  exportUserData,
  downloadExport,
  requestErasure,
  getErasureStatus,
  updateConsent,
  getConsentHistory,
  getProcessingActivities,
  rectifyData,
  restrictProcessing,
} from "../../controllers/gdpr.controller";
import {
  requestErasure as erasureValidator,
  updateConsent as consentValidator,
  rectifyData as rectifyValidator,
  restrictProcessing as restrictValidator,
} from "../../validators/gdpr.validator";
import { validateUuid } from "../../middlewares/validateUuid.middleware";
import { validate } from "../../middlewares/validation.middleware";

// `Router` is `express.Router` (the same function).
const router = Router();

/**
 * GDPR/CCPA Compliance Routes
 *
 * Routes for data subject requests and privacy compliance.
 * Mounted at /api/v1/gdpr
 */

// These are SCHEMAS. A schema's own method was once passed to the router
// (`schema.validate`), which express called as (req, res, next) — it threw and
// 500'd every write route. `validate(schema)` is the only router-facing factory
// (P9-11 guard: tests/guards/schemaAsMiddleware.p911).

router.post("/export", auth, exportUserData);

// A-360 (ADR-114): the archive POST /export answers as `downloadUrl`. The
// caller's OWN export only; the id's shape, owner, tenant and expiry are
// checked by gdpr.service#getExportDownload (every refusal is one 404).
router.get("/exports/:exportId/download", auth, downloadExport);

router.post("/erasure", auth, validate(erasureValidator), requestErasure);

router.get(
  "/erasure/:requestId",
  auth,
  validateUuid("requestId"),
  getErasureStatus,
);

router.put("/consent", auth, validate(consentValidator), updateConsent);

router.get("/consent/history", auth, getConsentHistory);

router.get("/processing", auth, getProcessingActivities);

router.put("/rectify", auth, validate(rectifyValidator), rectifyData);

router.post("/restrict", auth, validate(restrictValidator), restrictProcessing);

export = router;

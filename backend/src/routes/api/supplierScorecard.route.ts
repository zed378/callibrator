/**
 * Supplier scorecards: `/api/v1/supplier-scorecard` (index.js mounts it).
 *
 * P9-21 (ADR-087): converted from supplierScorecard.route.js. Every route,
 * gate and middleware is in the same order as before (checked against the
 * mounted route table). The contract is code-first:
 * supplierScorecard.openapi.ts (P9-25, ADR-103); the `@swagger` JSDoc this
 * file carried is gone.
 *
 * A-336 (2026-10-01): the writes mount `validate()` with the contract's
 * allow-list; the service checks a changed `vendorId` against the tenant.
 */
import { Router } from "express";
import {
  createScorecard,
  getScorecards,
  getScorecardById,
  updateScorecard,
  deleteScorecard,
} from "../../controllers/supplierScorecard.controller";
import { auth, denyApiKey } from "../../middlewares/auth.middleware";
import { dynamicAccess } from "../../middlewares/dynamicAccess.middleware";
import { MENU_SLUGS } from "../../constants/roleConstants";
import { validate } from "../../middlewares/validation.middleware";
import { validateUuid } from "../../middlewares/validateUuid.middleware";
import {
  createScorecard as createScorecardSchema,
  updateScorecard as updateScorecardSchema,
} from "../../validators/supplierScorecard.validator";

// `Router` is `express.Router` (the same function).
const router = Router();

// AZ-01 (G-03): every route here was `auth` (+ denyApiKey on writes) alone, so
// any role could create, edit and delete vendor scorecards. Gated on the
// seeded `supplier-scorecard` menu.
const canRead = dynamicAccess(MENU_SLUGS.SUPPLIER_SCORECARD, "read");
const canWrite = dynamicAccess(MENU_SLUGS.SUPPLIER_SCORECARD, "write");

router.use(auth);

// Mutations require an interactive user session (scoped API keys are denied).
router.post("/", denyApiKey, canWrite, validate(createScorecardSchema), createScorecard);
router.get("/", canRead, getScorecards);
router.get("/:id", validateUuid("id"), canRead, getScorecardById);
router.put("/:id", denyApiKey, validateUuid("id"), canWrite, validate(updateScorecardSchema), updateScorecard);
router.delete("/:id", denyApiKey, validateUuid("id"), canWrite, deleteScorecard);

export = router;

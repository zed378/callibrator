/**
 * The risk register: `/api/v1/risk` (index.js mounts it).
 *
 * P9-21 (ADR-087): converted from risk.route.js. Every route, gate and
 * middleware is in the same order as before (checked against the mounted
 * route table). The contract is code-first: risk.openapi.ts (P9-25, ADR-103);
 * the `@swagger` JSDoc this file carried is gone.
 *
 * A-335 (2026-10-01): the writes mount `validate()` with the contract's
 * allow-list, so a server-owned attribute (`id`, `tenantId`, `identifiedBy`,
 * the timestamps; `status` on create) never reaches the model from a body.
 */
import { Router } from "express";
import { createRisk, getRisks, getRiskById, updateRisk, deleteRisk } from "../../controllers/risk.controller";
import { auth } from "../../middlewares/auth.middleware";
import { dynamicAccess } from "../../middlewares/dynamicAccess.middleware";
import { MENU_SLUGS } from "../../constants";
import { validate } from "../../middlewares/validation.middleware";
import { createRisk as createRiskSchema, updateRisk as updateRiskSchema } from "../../validators/risk.validator";

// `Router` is `express.Router` (the same function).
const router = Router();

// A-28 — authorization.
//
// Until 2026-09-23 every route here carried `auth` alone and risk.service
// checked tenant only, so any role could create, rescore or delete entries in
// the risk register (ISO 14971 / ISO 13485 risk management file).
//
// `risk` is a real MENU_SLUGS entry: write is held by SUPERADMIN, HEALTHCARE
// ADMIN and CALIBRATOR ADMIN; ENGINEERING MANAGER holds read. No other seeded
// role holds the menu at all, so a TECHNICIAN or USER now gets 403 on every
// route here — including the reads, which is what the menu matrix says.
router.use(auth);

router.post("/", dynamicAccess(MENU_SLUGS.RISK, "write"), validate(createRiskSchema), createRisk);
router.get("/", dynamicAccess(MENU_SLUGS.RISK, "read"), getRisks);
router.get("/:id", dynamicAccess(MENU_SLUGS.RISK, "read"), getRiskById);
router.put("/:id", dynamicAccess(MENU_SLUGS.RISK, "write"), validate(updateRiskSchema), updateRisk);
router.delete("/:id", dynamicAccess(MENU_SLUGS.RISK, "write"), deleteRisk);

export = router;

/**
 * The field app's server routes: `/api/v1/field` (P21-03c; P19-08 spec § 11.3, G-O9).
 *
 * `POST /wipes` — an UNBOUND tenant administrator records that it wiped another user's offline
 * data on a phone (counts only). Unmarked: a bound principal never wipes (FACILITY_ROUTE_REFUSED).
 * Contract: field.openapi.ts.
 */
import { Router } from "express";
import { auth, denyApiKey } from "../../middlewares/auth.middleware";
import { rbac } from "../../middlewares/rbac.middleware";
import { dynamicAccess } from "../../middlewares/dynamicAccess.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { ROLE_NAMES } from "../../constants";
import { fieldWipe } from "@callibrator/contracts/inspectionSessions";
import { wipe } from "../../controllers/field.controller";

const router = Router();

router.post("/wipes", auth, denyApiKey, rbac([ROLE_NAMES.TENANT_ADMIN]), dynamicAccess("ipm", "write"), validate(fieldWipe), wipe);

export = router;

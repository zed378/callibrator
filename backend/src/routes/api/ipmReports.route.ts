/**
 * IPM reports and "due": `/api/v1/ipm` (index.ts mounts it before the catalogue router at the same
 * prefix). P21-04 (ADR-126 Am. 2, Am. 5; specs MEMORY/specs/P19-06-ipm-report-document.md § 8.1,
 * § 9 and MEMORY/specs/P19-02-ipm-session-aggregate.md § 11).
 *
 *  - `GET /verify/:reportNumber?token=` — PUBLIC (no `auth`; routeGateExemptions `public`): the
 *    printed report's QR. The 192-bit token is the capability; a malformed, unknown or mismatched
 *    link is one identical 404. Every request counts against `ipmVerifyToken` (300 / 15 min per
 *    address) here; every answer that is not a verdict also against `ipmVerify` (60), in the
 *    controller — ADR-100's pair, as the certificate verification (A-293).
 *  - `GET /due` — `ipm` read, marked facility-accessible (N-9): a bound principal sees its facility's
 *    devices only (`facilityClause` in the raw read).
 *
 * Contract: ipmReports.openapi.ts.
 */
import { Router } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { dynamicAccess } from "../../middlewares/dynamicAccess.middleware";
import { requestBudget } from "../../middlewares/requestBudget.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { ipmDueQuery } from "@callibrator/contracts/inspectionSessions";
import { ipmVerifyQuery } from "@callibrator/contracts/ipmReport";
import { due, verify } from "../../controllers/ipmSession.controller";

const router = Router();

router.get("/verify/:reportNumber", requestBudget("ipmVerifyToken"), validate(ipmVerifyQuery, { from: ["params", "query"] }), verify);
router.get("/due", auth, dynamicAccess("ipm", "read"), validate(ipmDueQuery, { from: "query" }), due);

export = router;

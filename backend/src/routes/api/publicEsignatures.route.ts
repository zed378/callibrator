/**
 * The public verification of an e-signature application: `/api/v1/public/esignatures` (index.ts
 * mounts it). P21-15 (ADR-140; spec MEMORY/specs/P21-15-operator-esignature.md v2 § 4).
 *
 *  - `GET /:applicationId?token=` — PUBLIC (no `auth`; routeGateExemptions `public`): the link and
 *    QR of one application. The 192-bit token is the capability; a malformed, unknown or mismatched
 *    link is one identical 404. The headers are set first (`no-store`, `noindex`), so a 429 carries
 *    them too; every request counts against `esigVerifyToken` (per address) here, every answer that
 *    is not a verdict also against `esigVerify`, in the controller (ADR-100's pair).
 *
 * Contract: publicEsignatures.openapi.ts.
 */
import { Router } from "express";
import { requestBudget } from "../../middlewares/requestBudget.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { publicEsignatureQuery } from "@callibrator/contracts/esignatures";
import { publicHeaders, verifyPublicHandler } from "../../controllers/userEsignature.controller";

const router = Router();

router.get("/:applicationId", publicHeaders, requestBudget("esigVerifyToken"), validate(publicEsignatureQuery, { from: ["params", "query"] }), verifyPublicHandler);

export = router;

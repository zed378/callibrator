/**
 * P10-05 (ADR-098 §6) — POST /api/v1/access-requests: the public intake that
 * replaces self-registration (spec MEMORY/specs/P10-05-request-access.md).
 *
 * PUBLIC, on purpose (the ADR the template requires for a public write is
 * ADR-098 §6; route-gate exemption kind `public`). Its defences:
 *  - a request budget per client address (ADR-100 `requestBudget`,
 *    API_ENDPOINTS.accessRequest: 5 an hour in production);
 *  - a per-address cap in the service (3 stored per work email per 24 h);
 *  - a honeypot (`website`), dropped silently;
 *  - ONE answer — 202 "Request received" — for a new request, a duplicate, an
 *    over-cap address and a honeypot hit (BR-P10-2). Only a malformed field
 *    answers 400, about its shape.
 *
 * The contract is code-first: accessRequests.openapi.ts (P9-25).
 */
import { Router } from "express";
import { requestBudget } from "../../middlewares/requestBudget.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { submitAccessRequestSchema } from "../../validators/accessRequest.validator";
import { submit } from "../../controllers/accessRequest.controller";
import { assertPublicAccessConfig } from "../../config/publicAccess";

// Production refuses to boot without ACCESS_REQUEST_IP_PEPPER: index.js loads
// this module at start.
assertPublicAccessConfig();

const router = Router();

router.post("/", requestBudget("accessRequest"), validate(submitAccessRequestSchema), submit);

export = router;

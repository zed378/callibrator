/**
 * IPM sessions: `/api/v1/ipm/sessions` (index.ts mounts it before `/api/v1/ipm`). P21-03a/b
 * (ADR-126, Am. 1 – 4; spec MEMORY/specs/P19-02-ipm-session-aggregate.md § 10).
 *
 *  - READS — `ipm` read, marked facility-accessible (N-2): a bound principal reads its facility's
 *    sessions only (the hooks), another facility's is the 404 of a missing id.
 *  - DRAFT WRITES — `denyApiKey` (an IPM is a person's record, G-S8), `ipm` write,
 *    `denyPlatformAuthoring` (ADR-052: a Part 11 record authored by a member of the tenant), the
 *    validated params + body, then `idempotency()` (an offline replay answers the stored status
 *    with the session re-read in context). Marked (N-3): within the bound ceiling only a
 *    HEALTHCARE TECHNICIAN holds `ipm` write.
 *  - The submit, the void, the report document and the signatures are P21-04's (ADR-126 Am. 4 § 1).
 *
 * `:sessionId` routes are registered after the literal paths. Contract: ipmSessions.openapi.ts.
 */
import { Router } from "express";
import { auth, denyApiKey } from "../../middlewares/auth.middleware";
import { dynamicAccess } from "../../middlewares/dynamicAccess.middleware";
import { denyPlatformAuthoring } from "../../middlewares/denyPlatformAuthoring.middleware";
import { idempotency } from "../../middlewares/idempotency.middleware";
import { validate } from "../../middlewares/validation.middleware";
import {
  ipmResultsReplace,
  ipmSessionCorrection,
  ipmSessionCreate,
  ipmSessionDiscard,
  ipmSessionHeaderUpdate,
  ipmSessionIdParams,
  ipmSessionListQuery,
} from "@callibrator/contracts/inspectionSessions";
import { correct, create, discard, editHeader, editResults, getOne, list, readSession } from "../../controllers/ipmSession.controller";

const router = Router();

const replay = idempotency({ slug: "ipm", read: readSession });

router.get("/", auth, dynamicAccess("ipm", "read"), validate(ipmSessionListQuery, { from: "query" }), list);
router.post("/", auth, denyApiKey, dynamicAccess("ipm", "write"), denyPlatformAuthoring, validate(ipmSessionCreate), replay, create);

router.get("/:sessionId", auth, dynamicAccess("ipm", "read"), validate(ipmSessionIdParams, { from: "params" }), getOne);
router.patch(
  "/:sessionId",
  auth,
  denyApiKey,
  dynamicAccess("ipm", "write"),
  denyPlatformAuthoring,
  validate(ipmSessionHeaderUpdate, { from: ["params", "body"] }),
  replay,
  editHeader,
);
router.put(
  "/:sessionId/results",
  auth,
  denyApiKey,
  dynamicAccess("ipm", "write"),
  denyPlatformAuthoring,
  validate(ipmResultsReplace, { from: ["params", "body"] }),
  replay,
  editResults,
);
router.post(
  "/:sessionId/discard",
  auth,
  denyApiKey,
  dynamicAccess("ipm", "write"),
  denyPlatformAuthoring,
  validate(ipmSessionDiscard, { from: ["params", "body"] }),
  replay,
  discard,
);
router.post(
  "/:sessionId/corrections",
  auth,
  denyApiKey,
  dynamicAccess("ipm", "write"),
  denyPlatformAuthoring,
  validate(ipmSessionCorrection, { from: ["params", "body"] }),
  replay,
  correct,
);

export = router;

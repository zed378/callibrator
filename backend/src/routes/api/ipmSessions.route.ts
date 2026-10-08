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
 *  - P21-04 (ADR-126 Am. 5): the SUBMIT (a draft write, marked N-3, idempotent); the VOID —
 *    `rbac([TENANT_ADMIN])` and unmarked (N-4: a bound principal never voids; the service re-checks
 *    "not facility-bound"); the REPORT DOCUMENT (`ipm` read, marked N-2; `?render=` is audited); the
 *    SIGNATURES — `esignature` write, `denyPlatformAuthoring`, the `ipmSignature` budget per user and
 *    address, marked N-5 (the ONLY marked `esignature` route).
 *
 * `:sessionId` routes are registered after the literal paths. Contract: ipmSessions.openapi.ts.
 */
import { Router } from "express";
import { auth, denyApiKey } from "../../middlewares/auth.middleware";
import { dynamicAccess } from "../../middlewares/dynamicAccess.middleware";
import { denyPlatformAuthoring } from "../../middlewares/denyPlatformAuthoring.middleware";
import { idempotency } from "../../middlewares/idempotency.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { rbac } from "../../middlewares/rbac.middleware";
import { requestBudget } from "../../middlewares/requestBudget.middleware";
import { ROLE_NAMES } from "../../constants";
import {
  ipmResultsReplace,
  ipmSessionCorrection,
  ipmSessionCreate,
  ipmSessionDiscard,
  ipmSessionHeaderUpdate,
  ipmSessionIdParams,
  ipmSessionListQuery,
  ipmSessionSubmit,
  ipmSessionVoid,
} from "@callibrator/contracts/inspectionSessions";
import { ipmReportDocumentQuery, ipmSignature } from "@callibrator/contracts/ipmReport";
import {
  correct,
  create,
  discard,
  editHeader,
  editResults,
  getOne,
  list,
  readSession,
  reportDocument,
  sign,
  submit,
  voidOne,
} from "../../controllers/ipmSession.controller";

const router = Router();

const replay = idempotency({ slug: "ipm", read: readSession });
// A credential is checked on every signature: per user and per address (the A-185 class).
// After `auth` and `denyApiKey`, so the principal is a user.
const signatureBudget = requestBudget("ipmSignature", { keyOf: (req) => (req.user as { id: string }).id });

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

router.post(
  "/:sessionId/submit",
  auth,
  denyApiKey,
  dynamicAccess("ipm", "write"),
  denyPlatformAuthoring,
  validate(ipmSessionSubmit, { from: ["params", "body"] }),
  replay,
  submit,
);
router.post(
  "/:sessionId/void",
  auth,
  denyApiKey,
  rbac([ROLE_NAMES.TENANT_ADMIN]),
  dynamicAccess("ipm", "write"),
  denyPlatformAuthoring,
  validate(ipmSessionVoid, { from: ["params", "body"] }),
  voidOne,
);
router.get(
  "/:sessionId/report-document",
  auth,
  dynamicAccess("ipm", "read"),
  validate(ipmReportDocumentQuery, { from: ["params", "query"] }),
  reportDocument,
);
router.post(
  "/:sessionId/signatures",
  auth,
  denyApiKey,
  dynamicAccess("esignature", "write"),
  denyPlatformAuthoring,
  validate(ipmSignature, { from: ["params", "body"] }),
  signatureBudget,
  sign,
);

export = router;

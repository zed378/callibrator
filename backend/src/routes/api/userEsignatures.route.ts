/**
 * Personal e-signatures: `/api/v1/esignature` — mounted BEFORE eSignature.route (the generic
 * workflows at the same prefix; none of these paths is theirs). P21-15 (ADR-140; spec
 * MEMORY/specs/P21-15-operator-esignature.md v2 § 4).
 *
 *  - `GET /me`, `POST /me`, `POST /me/revoke`, `GET /me/applications`, `POST /documents` — the
 *    caller's own e-signature: `auth`, `denyApiKey`, `esignature` read or write. Every route that
 *    re-enters a credential carries the signing budget per user and address (the A-185 class).
 *  - `POST /users/:userId/revoke` — a tenant administrator (`rbac`) with `qms` write revokes another
 *    user's e-signature; never creates or replaces one. Another tenant's user is a 404.
 *
 * Contract: userEsignatures.openapi.ts.
 */
import { Router } from "express";
import { auth, denyApiKey } from "../../middlewares/auth.middleware";
import { dynamicAccess } from "../../middlewares/dynamicAccess.middleware";
import { rbac } from "../../middlewares/rbac.middleware";
import { requestBudget } from "../../middlewares/requestBudget.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { validateUuid } from "../../middlewares/validateUuid.middleware";
import { denyPlatformAuthoring } from "../../middlewares/denyPlatformAuthoring.middleware";
import { MENU_SLUGS, ROLE_NAMES } from "../../constants/roleConstants";
import { createMyEsignature, myApplicationsQuery, revokeMyEsignature, revokeUserEsignature, signDocument } from "@callibrator/contracts/esignatures";
import { createMe, getMe, myApplicationList, revokeMe, revokeOther, signDocumentByHash } from "../../controllers/userEsignature.controller";

const router = Router();

// After `auth` and `denyApiKey`, so the principal is a user.
const signingBudget = requestBudget("esigSign", { keyOf: (req) => (req.user as { id: string }).id });

router.get("/me", auth, denyApiKey, dynamicAccess(MENU_SLUGS.ESIGNATURE, "read"), getMe);
router.post("/me", auth, denyApiKey, dynamicAccess(MENU_SLUGS.ESIGNATURE, "write"), validate(createMyEsignature), signingBudget, createMe);
router.post("/me/revoke", auth, denyApiKey, dynamicAccess(MENU_SLUGS.ESIGNATURE, "write"), validate(revokeMyEsignature), signingBudget, revokeMe);
router.get("/me/applications", auth, denyApiKey, dynamicAccess(MENU_SLUGS.ESIGNATURE, "read"), validate(myApplicationsQuery, { from: "query" }), myApplicationList);
router.post("/documents", auth, denyApiKey, dynamicAccess(MENU_SLUGS.ESIGNATURE, "write"), denyPlatformAuthoring, validate(signDocument), signingBudget, signDocumentByHash);
router.post(
  "/users/:userId/revoke",
  auth,
  denyApiKey,
  rbac([ROLE_NAMES.TENANT_ADMIN]),
  dynamicAccess(MENU_SLUGS.QMS, "write"),
  denyPlatformAuthoring,
  validateUuid("userId"),
  validate(revokeUserEsignature, { from: ["params", "body"] }),
  revokeOther,
);

export = router;

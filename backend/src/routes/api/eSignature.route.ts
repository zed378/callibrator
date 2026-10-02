/**
 * E-signature (21 CFR Part 11), `/api/v1/esignature` (index.js mounts it).
 *
 * P9-20 (ADR-087): converted from eSignature.route.js. Every route, gate and
 * middleware is in the same order as before (checked against the mounted
 * route table); the controller's handlers are destructured at load, as before.
 * The contract is code-first: eSignature.openapi.ts (P9-25, ADR-103); the
 * `@swagger` JSDoc this file carried is gone.
 */
import { Router } from "express";
import { auth, denyApiKey } from "../../middlewares/auth.middleware";
import eSignatureController from "../../controllers/eSignature.controller";
import {
  createKeyPair as createKeyPairValidator,
  createWorkflow as createWorkflowValidator,
  cancelWorkflow as cancelWorkflowValidator,
  signDocument as signDocumentValidator,
  verifySignature as verifySignatureValidator,
} from "../../validators/eSignature.validator";
import { validateUuid } from "../../middlewares/validateUuid.middleware";
// These are SCHEMAS. A schema's own method was once passed to the router
// (`schema.validate`), which express called as (req, res, next) — it threw and
// 500'd every write route. `validate(schema)` is the only router-facing factory
// (P9-11 guard: tests/guards/schemaAsMiddleware.p911).
import { validate } from "../../middlewares/validation.middleware";
import { dynamicAccess } from "../../middlewares/dynamicAccess.middleware";
import { denyPlatformAuthoring } from "../../middlewares/denyPlatformAuthoring.middleware"; // A-127, ADR-051 Q-17
import { MENU_SLUGS } from "../../constants";

// `Router` is `express.Router` (the same function).
const router = Router();

const {
  getKeyPairs,
  createKeyPair,
  deleteKeyPair,
  getWorkflows,
  createWorkflow,
  getWorkflow,
  updateWorkflow,
  deleteWorkflow,
  signDocument,
  verifySignature,
  getSignatureHistory,
  getSignerWorkflows,
  getSignerWorkflow,
  getEligibleSigners,
  cancelWorkflow,
} = eSignatureController;

// A-28 — authorization.
//
// Until 2026-09-23 key-pair and workflow management carried `auth` and nothing
// else, and the service checked tenant only: any role could delete the
// tenant's signing keys or a workflow mid-signature, and DELETE /key-pairs was
// reachable by any API key while POST /key-pairs was already `denyApiKey`.
//
// The signing keys and the workflows that bind them are quality-system
// records, so they are gated on `qms` (MENU_SLUGS.QMS — read for listing,
// write for mutation). `qms:write` is held by SUPERADMIN, HEALTHCARE ADMIN and
// CALIBRATOR ADMIN; ENGINEERING MANAGER holds read.
//
// Deliberately NOT gated on `qms`: POST /sign, POST /verify and GET /history.
// A signer is whoever the workflow names — commonly a TECHNICIAN with no `qms`
// menu — so gating /sign on `qms:write` would make the workflows unsignable.
// Those three have their own gate, `esignature` (A-84, at the routes below).

router.get("/key-pairs", auth, dynamicAccess(MENU_SLUGS.QMS, "read"), getKeyPairs);

router.post(
  "/key-pairs",
  auth,
  denyApiKey,
  dynamicAccess(MENU_SLUGS.QMS, "write"),
  validate(createKeyPairValidator),
  createKeyPair,
);

router.delete(
  "/key-pairs/:keyPairId",
  auth,
  denyApiKey,
  dynamicAccess(MENU_SLUGS.QMS, "write"),
  validateUuid("keyPairId"),
  deleteKeyPair,
);

router.get("/workflows", auth, dynamicAccess(MENU_SLUGS.QMS, "read"), getWorkflows);

router.post(
  "/workflows",
  auth,
  denyApiKey,
  dynamicAccess(MENU_SLUGS.QMS, "write"),
  validate(createWorkflowValidator),
  createWorkflow,
);

router.get(
  "/workflows/:workflowId",
  auth,
  dynamicAccess(MENU_SLUGS.QMS, "read"),
  validateUuid("workflowId"),
  getWorkflow,
);

router.put(
  "/workflows/:workflowId",
  auth,
  denyApiKey,
  dynamicAccess(MENU_SLUGS.QMS, "write"),
  validateUuid("workflowId"),
  updateWorkflow,
);

router.delete(
  "/workflows/:workflowId",
  auth,
  denyApiKey,
  dynamicAccess(MENU_SLUGS.QMS, "write"),
  validateUuid("workflowId"),
  deleteWorkflow,
);

router.post(
  "/workflows/:workflowId/cancel",
  auth,
  denyApiKey,
  dynamicAccess(MENU_SLUGS.QMS, "write"),
  validateUuid("workflowId"),
  validate(cancelWorkflowValidator),
  cancelWorkflow,
);

router.get("/signers", auth, dynamicAccess(MENU_SLUGS.QMS, "write"), getEligibleSigners);

// A-91 — the signer's own view. GET /workflows and GET /workflows/:id are
// management and stay on `qms`, which technicians and most other roles do not
// hold; a workflow naming one of them could not be opened, so it could never
// complete. These two are gated on `esignature` (read) — the same menu as
// /sign — and the service returns only workflows in which a step names the
// caller. A workflow they are not named in is 404, like another tenant's.

router.get(
  "/my-workflows",
  auth,
  dynamicAccess(MENU_SLUGS.ESIGNATURE, "read"),
  getSignerWorkflows,
);

router.get(
  "/my-workflows/:workflowId",
  auth,
  dynamicAccess(MENU_SLUGS.ESIGNATURE, "read"),
  validateUuid("workflowId"),
  getSignerWorkflow,
);

// A-84 — /sign, /verify and /history carried no permission gate (CLAUDE.md:
// every route needs one). They are gated on their own menu, `esignature`, NOT
// on `qms`: a signer is whoever the workflow names. Since A-129 (ADR-051
// Q-19) the technical roles hold `esignature:write` by default and USER, ROOM
// USER and WAREHOUSE STAFF do not (migration 0031); a workflow cannot name a
// signer without it (checked at creation), so no workflow is left unsignable.
// The gate does not replace the A-65 check in signDocument — only the step's
// own signer signs.
router.post(
  "/sign",
  auth,
  denyApiKey,
  dynamicAccess(MENU_SLUGS.ESIGNATURE, "write"),
  denyPlatformAuthoring,
  validate(signDocumentValidator),
  signDocument,
);

router.post(
  "/verify",
  auth,
  dynamicAccess(MENU_SLUGS.ESIGNATURE, "read"),
  validate(verifySignatureValidator),
  verifySignature,
);

router.get("/history", auth, dynamicAccess(MENU_SLUGS.ESIGNATURE, "read"), getSignatureHistory);

export = router;

/**
 * Approval workflows, `/api/v1/workflows` (index.js mounts it).
 *
 * P9-21 (ADR-087): converted from workflows.route.js. Every route, gate and
 * middleware is in the same order as before (checked against the mounted
 * route table). The contract is code-first: workflows.openapi.ts (P9-25,
 * ADR-103); the `@swagger` JSDoc this file carried is gone.
 */
import { Router } from "express";
import workflowController from "../../controllers/workflow.controller";
import { auth, denyApiKey } from "../../middlewares/auth.middleware";
import { dynamicAccess } from "../../middlewares/dynamicAccess.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { validateUuid } from "../../middlewares/validateUuid.middleware";
import { denyPlatformAuthoring } from "../../middlewares/denyPlatformAuthoring.middleware"; // A-145, ADR-051 Q-17
import {
  createWorkflowSchema,
  updateWorkflowSchema,
  submitActionSchema,
} from "../../validators/workflow.validator";

// `Router` is `express.Router` (the same function).
const router = Router();

// User action routes (Inbox)

// A-183 — the inbox is the Workflows page's; it needs that page's grant.
router.get(
  "/instances/pending",
  auth,
  dynamicAccess("workflows", "read"),
  workflowController.getPendingTasks,
);

// A-145 (ADR-051 Q-17, ADR-052) — an approval or rejection is a Part 11 act:
// the WorkflowAction row names the approver, and a final approval stamps the
// certificate / stock transfer / work order as approved by them. A platform
// operator may not record one in a member's name (impersonation) or inside
// another tenant.
//
// A-183 — the route gate admits a caller who may approve SOME kind of record a
// workflow decides on; the service then requires write access to the kind
// this instance decides on (certificate / warehouse / maintenance), after the
// 404. A-182 — a Certificate approval re-authenticates (authMethod,
// authPayload, meaning).
router.post(
  "/instances/:instanceId/action",
  auth,
  // Q-51 (ADR-100): an approval decision is a person's. A key would put its
  // id in the target's `approved_by` (a users FK), and a stock transfer's
  // approver stays user-only; keys are refused here, 403, before any work.
  denyApiKey,
  dynamicAccess(["certificate", "warehouse", "maintenance"], "write"),
  validateUuid("instanceId"),
  denyPlatformAuthoring,
  validate(submitActionSchema),
  workflowController.submitAction,
);

// Admin Management Routes

router.get(
  "/",
  auth,
  dynamicAccess("workflows", "read"),
  workflowController.getWorkflows,
);

router.post(
  "/",
  auth,
  dynamicAccess("workflows", "write"),
  validate(createWorkflowSchema),
  workflowController.createWorkflow,
);

router.get(
  "/:id",
  auth,
  dynamicAccess("workflows", "read"),
  validateUuid("id"),
  workflowController.getWorkflowById,
);

router.put(
  "/:id",
  auth,
  dynamicAccess("workflows", "write"),
  validateUuid("id"),
  validate(updateWorkflowSchema),
  workflowController.updateWorkflow,
);

router.delete(
  "/:id",
  auth,
  dynamicAccess("workflows", "write"),
  validateUuid("id"),
  workflowController.deleteWorkflow,
);

export = router;

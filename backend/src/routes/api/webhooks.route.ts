/**
 * Outbound webhooks: `/api/v1/webhooks` (index.js mounts it).
 *
 * P9-18 (ADR-087): converted from webhooks.route.js. Every route and
 * middleware is in the same order as before (checked against the mounted route
 * table). The contract is code-first: webhooks.openapi.ts (P9-25, ADR-103);
 * the `@swagger` JSDoc this file carried is gone. The controller is now
 * imported before the admin chain is built (imports are hoisted); building it
 * has no effect beyond its closures.
 */
import { Router } from "express";
import { auth, denyApiKey } from "../../middlewares/auth.middleware";
import { rbac } from "../../middlewares/rbac.middleware";
import { ROLE_NAMES } from "../../constants";
import { validateUuid } from "../../middlewares/validateUuid.middleware";
import { requireFeature } from "../../middlewares/enforceQuota.middleware";
import { validate } from "../../middlewares/validation.middleware";
import {
  createWebhookSchema,
  updateWebhookSchema,
  rotateWebhookSecretSchema,
} from "../../validators/webhook.validator";
import webhookController from "../../controllers/webhook.controller";

// `Router` is `express.Router` (the same function).
const router = Router();

// A-02. A webhook is an outbound channel out of the tenant: its target URL
// decides where this tenant's data is POSTed, and its secret signs it. Until
// 2026-09-23 every route here was `auth` alone, so any role — a room user —
// could point a webhook at a host it controls and read the tenant's events.
// Managing them is tenant-admin work, and never an API key's (a scoped key
// could otherwise widen its own reach into an exfiltration channel).
const webhookAdmin = [auth, denyApiKey, rbac([ROLE_NAMES.TENANT_ADMIN])];

// A-51. Every route that takes a body validates it with `validate(schema)` —
// never `schema.validate` passed to Express (CLAUDE.md, traps). Unknown keys
// are stripped, so a caller-supplied `secret` never reaches the service. The
// body schemas do not include `id`: it is a path parameter, checked by
// validateUuid, and the controller reads it from req.params.

router.post(
  "/",
  ...webhookAdmin,
  requireFeature("webhooks"),
  validate(createWebhookSchema),
  webhookController.create,
);

router.get("/", ...webhookAdmin, webhookController.list);

router.get("/:id", ...webhookAdmin, validateUuid("id"), webhookController.getOne);

router.patch(
  "/:id",
  ...webhookAdmin,
  validateUuid("id"),
  validate(updateWebhookSchema),
  webhookController.update,
);

router.delete("/:id", ...webhookAdmin, validateUuid("id"), webhookController.remove);

router.get("/:id/deliveries", ...webhookAdmin, validateUuid("id"), webhookController.deliveries);

router.post("/:id/test", ...webhookAdmin, validateUuid("id"), webhookController.test);

// P6-13: the optional body names the overlap window (overlapHours, 0–168).
router.post(
  "/:id/rotate-secret",
  ...webhookAdmin,
  validateUuid("id"),
  validate(rotateWebhookSecretSchema),
  webhookController.rotateSecret,
);

export = router;

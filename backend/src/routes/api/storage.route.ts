/**
 * Tenant storage settings and the signed-object stream: `/api/v1/storage`
 * (index.js mounts it).
 *
 * P9-18 (ADR-087): converted from storage.route.js. Every route and middleware
 * is in the same order as before (checked against the mounted route table).
 * The contract is code-first: storage.openapi.ts (P9-25, ADR-103); the
 * `@swagger` JSDoc this file carried is gone. The controller is now imported
 * before the admin chain is built (imports are hoisted); building it has no
 * effect beyond its closures.
 */
import { Router } from "express";
import { auth, denyApiKey } from "../../middlewares/auth.middleware";
import { rbac } from "../../middlewares/rbac.middleware";
import { ROLE_NAMES } from "../../constants";
import { validate } from "../../middlewares/validation.middleware";
import storageController from "../../controllers/storage.controller";
import {
  updateStorageSettingsSchema,
} from "../../validators/storage.validator";

// `Router` is `express.Router` (the same function).
const router = Router();

// A-02. These settings hold the tenant's object-storage credentials (S3 keys,
// NFS paths) and decide where every uploaded file is written. Until 2026-09-23
// they were `auth` alone: any role could read the tenant's bucket credentials
// or repoint storage at a bucket it owned. Tenant-admin only, and never an API
// key — a key must not be able to redirect storage.
const storageAdmin = [auth, denyApiKey, rbac([ROLE_NAMES.TENANT_ADMIN])];

// PUBLIC — token-gated; MUST be registered before the auth'd routes.
router.get("/object", storageController.getObject);

router.get("/settings", ...storageAdmin, storageController.getSettings);
router.put(
  "/settings",
  ...storageAdmin,
  validate(updateStorageSettingsSchema),
  storageController.updateSettings,
);
router.delete("/settings", ...storageAdmin, storageController.clearSettings);

router.post("/settings/test", ...storageAdmin, storageController.testConnection);

router.get("/usage", ...storageAdmin, storageController.getUsage);

export = router;

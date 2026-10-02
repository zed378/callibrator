/**
 * Tenant backups: `/api/v1/tenants/:tenantId/backups` (index.js mounts it on
 * `/api/v1/tenants`, beside tenant.route).
 *
 * P9-21 (ADR-087): converted from tenantBackup.route.js. Every route, gate and
 * middleware is in the same order as before, `/backups/stats` before
 * `/backups/:backupId` (checked against the mounted route table). The
 * contract is code-first: tenantBackup.openapi.ts (P9-25, ADR-103); the
 * `@swagger` JSDoc this file carried is gone.
 */
import { Router } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { rbac } from "../../middlewares/rbac.middleware";
import { abac } from "../../middlewares/abac.middleware";
import { validateUuid } from "../../middlewares/validateUuid.middleware";
import { TENANT_PERMISSIONS, ROLE_NAMES } from "../../constants";
import { createBackup, getBackups, getBackup, downloadBackup, restoreBackup, deleteBackup, getBackupStats } from "../../controllers/tenantBackup.controller";
import { validate } from "../../middlewares/validation.middleware";
import { createBackupSchema, restoreBackupSchema } from "../../validators/tenantBackup.validator";

// `Router` is `express.Router` (the same function).
const router = Router();

/* ------------------------------------------------------------------ */
/* CREATE BACKUP                                                      */
/* ------------------------------------------------------------------ */
router.post(
  "/:tenantId/backups",
  auth,
  validateUuid("tenantId"),
  rbac([ROLE_NAMES.SUPER_ADMIN, ROLE_NAMES.TENANT_ADMIN], {
    allowHigher: true,
  }),
  abac([TENANT_PERMISSIONS.UPDATE], { checkTenant: true }),
  validate(createBackupSchema),
  createBackup,
);

/* ------------------------------------------------------------------ */
/* GET ALL BACKUPS                                                    */
/* ------------------------------------------------------------------ */
router.get(
  "/:tenantId/backups",
  auth,
  rbac([ROLE_NAMES.SUPER_ADMIN, ROLE_NAMES.TENANT_ADMIN], {
    allowHigher: true,
  }),
  abac([TENANT_PERMISSIONS.READ], { checkTenant: true }),
  getBackups,
);

/* ------------------------------------------------------------------ */
/* GET BACKUP STATISTICS                                              */
/* ------------------------------------------------------------------ */
// NOTE: literal `/backups/stats` MUST be registered before the parametric
// `/backups/:backupId` route, otherwise "stats" is matched as a backupId.
router.get(
  "/:tenantId/backups/stats",
  auth,
  rbac([ROLE_NAMES.SUPER_ADMIN, ROLE_NAMES.TENANT_ADMIN], {
    allowHigher: true,
  }),
  abac([TENANT_PERMISSIONS.READ], { checkTenant: true }),
  getBackupStats,
);

/* ------------------------------------------------------------------ */
/* GET SPECIFIC BACKUP                                                */
/* ------------------------------------------------------------------ */
router.get(
  "/:tenantId/backups/:backupId",
  auth,
  rbac([ROLE_NAMES.SUPER_ADMIN, ROLE_NAMES.TENANT_ADMIN], {
    allowHigher: true,
  }),
  abac([TENANT_PERMISSIONS.READ], { checkTenant: true }),
  getBackup,
);

/* ------------------------------------------------------------------ */
/* DOWNLOAD BACKUP                                                    */
/* ------------------------------------------------------------------ */
router.get(
  "/:tenantId/backups/:backupId/download",
  auth,
  rbac([ROLE_NAMES.SUPER_ADMIN, ROLE_NAMES.TENANT_ADMIN], {
    allowHigher: true,
  }),
  abac([TENANT_PERMISSIONS.READ], { checkTenant: true }),
  downloadBackup,
);

/* ------------------------------------------------------------------ */
/* RESTORE BACKUP                                                     */
/* ------------------------------------------------------------------ */
router.post(
  "/:tenantId/backups/:backupId/restore",
  auth,
  validateUuid("tenantId"),
  validateUuid("backupId"),
  rbac([ROLE_NAMES.SUPER_ADMIN, ROLE_NAMES.TENANT_ADMIN], {
    allowHigher: true,
  }),
  abac([TENANT_PERMISSIONS.UPDATE], { checkTenant: true }),
  validate(restoreBackupSchema),
  restoreBackup,
);

/* ------------------------------------------------------------------ */
/* DELETE BACKUP                                                      */
/* ------------------------------------------------------------------ */
router.delete(
  "/:tenantId/backups/:backupId",
  auth,
  rbac([ROLE_NAMES.SUPER_ADMIN, ROLE_NAMES.TENANT_ADMIN], {
    allowHigher: true,
  }),
  abac([TENANT_PERMISSIONS.DELETE], { checkTenant: true }),
  deleteBackup,
);

export = router;

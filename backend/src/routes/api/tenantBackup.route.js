/**
 * @swagger
 * tags:
 *   name: TenantBackup
 *   description: Endpoints for managing tenant backups and restores
 * components:
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 */
const express = require("express");
const router = express.Router();
const { auth } = require("../../middlewares/auth.middleware");
const { rbac } = require("../../middlewares/rbac.middleware");
const { abac } = require("../../middlewares/abac.middleware");
const { validateUuid } = require("../../middlewares/validateUuid.middleware");
const { TENANT_PERMISSIONS, ROLE_NAMES } = require("../../constants");
const {
  createBackup,
  getBackups,
  getBackup,
  downloadBackup,
  restoreBackup,
  deleteBackup,
  getBackupStats,
} = require("../../controllers/tenantBackup.controller");
const { validate } = require("../../middlewares/validation.middleware");
const tenantBackupValidator = require("../../validators/tenantBackup.validator");

/* ------------------------------------------------------------------ */
/* CREATE BACKUP                                                      */
/* ------------------------------------------------------------------ */
/**
 * @swagger
 * /api/v1/tenants/{tenantId}/backups:
 *   post:
 *     summary: Create a backup for a tenant
 *     description: Requires SUPER_ADMIN or TENANT_ADMIN role with tenant:update permission. Creates a ZIP file containing tenant data (settings, roles, features, users, permissions).
 *     tags:
 *       - TenantBackup
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *                 example: "Pre-migration backup"
 *               description:
 *                 type: string
 *                 example: "Backup before system migration"
 *               backupType:
 *                 type: string
 *                 enum: [FULL, PARTIAL, USER_ONLY]
 *                 default: FULL
 *                 example: FULL
 *               retentionDays:
 *                 type: integer
 *                 default: 90
 *                 example: 180
 *               tag:
 *                 type: string
 *                 example: "pre-migration"
 *     responses:
 *       '201':
 *         description: Backup created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 status:
 *                   type: integer
 *                   example: 201
 *                 message:
 *                   type: string
 *                   example: "Backup created successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       format: uuid
 *                     status:
 *                       type: string
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *       '403':
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 status:
 *                   type: integer
 *                   example: 403
 *                 message:
 *                   type: string
 *                   example: "Forbidden"
 *       '404':
 *         description: Tenant not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 status:
 *                   type: integer
 *                   example: 404
 *                 message:
 *                   type: string
 *                   example: "Tenant not found"
 */
router.post(
  "/:tenantId/backups",
  auth,
  validateUuid("tenantId"),
  rbac([ROLE_NAMES.SUPER_ADMIN, ROLE_NAMES.TENANT_ADMIN], {
    allowHigher: true,
  }),
  abac([TENANT_PERMISSIONS.UPDATE], { checkTenant: true }),
  validate(tenantBackupValidator.createBackupSchema),
  createBackup,
);

/* ------------------------------------------------------------------ */
/* GET ALL BACKUPS                                                    */
/* ------------------------------------------------------------------ */
/**
 * @swagger
 * /api/v1/tenants/{tenantId}/backups:
 *   get:
 *     summary: Get all backups for a tenant
 *     description: Requires SUPER_ADMIN or TENANT_ADMIN role with tenant:read permission. Returns paginated list of backups with status, size, and metadata.
 *     tags:
 *       - TenantBackup
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, IN_PROGRESS, COMPLETED, FAILED, RESTORING, RESTORED, DELETING]
 *       - in: query
 *         name: backupType
 *         schema:
 *           type: string
 *           enum: [FULL, PARTIAL, USER_ONLY]
 *       - in: query
 *         name: tag
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       '200':
 *         description: Backups retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 status:
 *                   type: integer
 *                   example: 200
 *                 message:
 *                   type: string
 *                   example: "Backups fetched successfully"
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       status:
 *                         type: string
 *                       size:
 *                         type: integer
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                 meta:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     totalPages:
 *                       type: integer
 *       '403':
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 status:
 *                   type: integer
 *                   example: 403
 *                 message:
 *                   type: string
 *                   example: "Forbidden"
 */
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
/**
 * @swagger
 * /api/v1/tenants/{tenantId}/backups/stats:
 *   get:
 *     summary: Get backup statistics for a tenant
 *     description: Requires SUPER_ADMIN or TENANT_ADMIN role with tenant:read permission. Returns totals, completed/failed counts, total size, and the latest backup.
 *     tags:
 *       - TenantBackup
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       '200':
 *         description: Backup statistics retrieved successfully
 *       '403':
 *         description: Forbidden
 */
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
/**
 * @swagger
 * /api/v1/tenants/{tenantId}/backups/{backupId}:
 *   get:
 *     summary: Get details of a specific backup
 *     description: Requires SUPER_ADMIN or TENANT_ADMIN role with tenant:read permission. Returns detailed information about a specific backup including creator, size, and metadata.
 *     tags:
 *       - TenantBackup
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: backupId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       '200':
 *         description: Backup details retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 status:
 *                   type: integer
 *                   example: 200
 *                 message:
 *                   type: string
 *                   example: "Backup fetched successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       format: uuid
 *                     status:
 *                       type: string
 *                     size:
 *                       type: integer
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *       '404':
 *         description: Backup not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 status:
 *                   type: integer
 *                   example: 404
 *                 message:
 *                   type: string
 *                   example: "Backup not found"
 *       '403':
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 status:
 *                   type: integer
 *                   example: 403
 *                 message:
 *                   type: string
 *                   example: "Forbidden"
 */
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
/**
 * @swagger
 * /api/v1/tenants/{tenantId}/backups/{backupId}/download:
 *   get:
 *     summary: Download a backup file
 *     description: Requires SUPER_ADMIN or TENANT_ADMIN role with tenant:read permission. Downloads the ZIP file containing the backup data.
 *     tags:
 *       - TenantBackup
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: backupId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       '200':
 *         description: Backup file downloaded successfully
 *         content:
 *           application/zip:
 *             schema:
 *               type: string
 *               format: binary
 *       '400':
 *         description: Backup is not ready for download
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 status:
 *                   type: integer
 *                   example: 400
 *                 message:
 *                   type: string
 *                   example: "Backup is not ready"
 *       '404':
 *         description: Backup not found or file missing
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 status:
 *                   type: integer
 *                   example: 404
 *                 message:
 *                   type: string
 *                   example: "Backup not found"
 *       '403':
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 status:
 *                   type: integer
 *                   example: 403
 *                 message:
 *                   type: string
 *                   example: "Forbidden"
 */
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
/**
 * @swagger
 * /api/v1/tenants/{tenantId}/backups/{backupId}/restore:
 *   post:
 *     summary: Restore a backup for a tenant
 *     description: Requires SUPER_ADMIN or TENANT_ADMIN role with tenant:update permission. Restores tenant data from a backup. Can optionally merge with existing data.
 *     tags:
 *       - TenantBackup
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: backupId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               mergeData:
 *                 type: boolean
 *                 default: false
 *                 description: Whether to merge with existing data instead of replacing
 *     responses:
 *       '200':
 *         description: Backup restored successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 status:
 *                   type: integer
 *                   example: 200
 *                 message:
 *                   type: string
 *                   example: "Backup restored successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     restored:
 *                       type: boolean
 *       '400':
 *         description: Backup is not ready for restore
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 status:
 *                   type: integer
 *                   example: 400
 *                 message:
 *                   type: string
 *                   example: "Backup is not ready"
 *       '404':
 *         description: Backup not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 status:
 *                   type: integer
 *                   example: 404
 *                 message:
 *                   type: string
 *                   example: "Backup not found"
 *       '403':
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 status:
 *                   type: integer
 *                 message:
 *                   type: string
 *                   example: "Forbidden"
 */
router.post(
  "/:tenantId/backups/:backupId/restore",
  auth,
  validateUuid("tenantId"),
  validateUuid("backupId"),
  rbac([ROLE_NAMES.SUPER_ADMIN, ROLE_NAMES.TENANT_ADMIN], {
    allowHigher: true,
  }),
  abac([TENANT_PERMISSIONS.UPDATE], { checkTenant: true }),
  validate(tenantBackupValidator.restoreBackupSchema),
  restoreBackup,
);

/* ------------------------------------------------------------------ */
/* DELETE BACKUP                                                      */
/* ------------------------------------------------------------------ */
/**
 * @swagger
 * /api/v1/tenants/{tenantId}/backups/{backupId}:
 *   delete:
 *     summary: Delete a backup
 *     description: Requires SUPER_ADMIN or TENANT_ADMIN role with tenant:delete permission. Deletes the backup file and record.
 *     tags:
 *       - TenantBackup
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: backupId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       '200':
 *         description: Backup deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 status:
 *                   type: integer
 *                   example: 200
 *                 message:
 *                   type: string
 *                   example: "Backup deleted successfully"
 *       '404':
 *         description: Backup not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 status:
 *                   type: integer
 *                   example: 404
 *                 message:
 *                   type: string
 *                   example: "Backup not found"
 *       '403':
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 status:
 *                   type: integer
 *                   example: 403
 *                 message:
 *                   type: string
 *                   example: "Forbidden"
 */
router.delete(
  "/:tenantId/backups/:backupId",
  auth,
  rbac([ROLE_NAMES.SUPER_ADMIN, ROLE_NAMES.TENANT_ADMIN], {
    allowHigher: true,
  }),
  abac([TENANT_PERMISSIONS.DELETE], { checkTenant: true }),
  deleteBackup,
);

module.exports = router;

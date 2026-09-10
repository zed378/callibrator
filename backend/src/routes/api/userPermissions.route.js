/**
 * @swagger
 * tags:
 *   name: UserPermissions
 *   description: Per-user permission overrides (role inheritance + custom grants/denies)
 */

const express = require("express");
const router = express.Router();
const userPermissionController = require("../../controllers/userPermission.controller");
const { auth } = require("../../middlewares/auth.middleware");
const { rbac } = require("../../middlewares/rbac.middleware");
const { validateUuid } = require("../../middlewares/validateUuid.middleware");

/**
 * @swagger
 * /api/v1/user-permissions/{userId}:
 *   get:
 *     tags: [UserPermissions]
 *     security:
 *       - bearerAuth: []
 *     summary: Get a user's permission picture
 *     description: >
 *       Returns the user's role permissions, custom overrides, and the
 *       resolved effective permission per menu group.
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: User permissions fetched successfully
 *       404:
 *         description: User not found
 */
router.get(
  "/:userId",
  validateUuid("userId"),
  auth,
  rbac(["SUPERADMIN"]),
  userPermissionController.getUserPermissions,
);

/**
 * @swagger
 * /api/v1/user-permissions/{userId}:
 *   post:
 *     tags: [UserPermissions]
 *     security:
 *       - bearerAuth: []
 *     summary: Assign or update a custom permission for a user
 *     description: >
 *       Upserts a per-user override on a menu group. permissionType "read"
 *       or "write" grants that access regardless of the user's role;
 *       "none" explicitly denies the menu even if the role grants it.
 *     parameters:
 *       - in: path
 *         name: userId
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
 *             required: [menuGroupId, permissionType]
 *             properties:
 *               menuGroupId:
 *                 type: string
 *                 format: uuid
 *               permissionType:
 *                 type: string
 *                 enum: [read, write, none]
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Custom permission assigned
 *       200:
 *         description: Custom permission updated
 *       400:
 *         description: Invalid payload
 *       404:
 *         description: User or menu group not found
 */
router.post(
  "/:userId",
  validateUuid("userId"),
  auth,
  rbac(["SUPERADMIN"]),
  userPermissionController.setUserPermission,
);

/**
 * @swagger
 * /api/v1/user-permissions/{userId}/{menuGroupId}:
 *   delete:
 *     tags: [UserPermissions]
 *     security:
 *       - bearerAuth: []
 *     summary: Remove a custom permission override
 *     description: Deletes the override so the user falls back to role inheritance.
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: menuGroupId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Custom permission removed
 */
router.delete(
  "/:userId/:menuGroupId",
  validateUuid("userId", "menuGroupId"),
  auth,
  rbac(["SUPERADMIN"]),
  userPermissionController.removeUserPermission,
);

module.exports = router;

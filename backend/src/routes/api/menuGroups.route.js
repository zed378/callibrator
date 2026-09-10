/**
 * @swagger
 * tags:
 *   name: MenuGroups
 *   description: Menu group management endpoints - CRUD operations and role-based access control
 */

const express = require("express");
const router = express.Router();
const menuGroupController = require("../../controllers/menuGroup.controller");
const { auth } = require("../../middlewares/auth.middleware");
const { rbac } = require("../../middlewares/rbac.middleware");

/* ------------------------------------------------------------------ */
/* FILTER MENU GROUPS (user-facing) */
/* ------------------------------------------------------------------ */
/**
 * @swagger
 * /api/v1/menu-groups/filter:
 *   post:
 *     tags: [MenuGroups]
 *     security:
 *       - bearerAuth: []
 *     summary: Filter menu groups by role/permissions
 *     description: Returns menu groups visible to the authenticated user based on their role permissions.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               roleId:
 *                 type: string
 *                 format: uuid
 *               tenantId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       '200':
 *         description: Menu groups filtered successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post("/filter", auth, menuGroupController.filterMenuGroups);

/**
 * @swagger
 * /api/v1/menu-groups/get-assignments:
 *   post:
 *     tags: [MenuGroups]
 *     security:
 *       - bearerAuth: []
 *     summary: Get role menu assignments
 *     description: Returns menu permission assignments for a specific role.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [roleId]
 *             properties:
 *               roleId:
 *                 type: string
 *                 format: uuid
 *                 description: Role ID to get assignments for
 *     responses:
 *       '200':
 *         description: Role menu assignments retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  "/get-assignments",
  auth,
  menuGroupController.getRoleMenuAssignments,
);

/**
 * @swagger
 * /api/v1/menu-groups/menu-groups:
 *   get:
 *     tags: [MenuGroups]
 *     security:
 *       - bearerAuth: []
 *     summary: Get menu groups for authenticated user
 *     description: Returns all menu groups accessible to the current user based on their role.
 *     responses:
 *       '200':
 *         description: Menu groups retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/menu-groups", auth, menuGroupController.filterMenuGroups);

/* ------------------------------------------------------------------ */
/* ADMIN-ENDPOINTS (SUPERADMIN required) */
/* ------------------------------------------------------------------ */
/**
 * @swagger
 * /api/v1/menu-groups/menu-groups/admin:
 *   get:
 *     tags: [MenuGroups]
 *     security:
 *       - bearerAuth: []
 *     summary: Get all menu groups (admin view)
 *     description: Requires SUPERADMIN role. Returns complete list of all menu groups.
 *     responses:
 *       '200':
 *         description: All menu groups retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '403':
 *         description: Forbidden - SUPERADMIN role required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get(
  "/menu-groups/admin",
  auth,
  rbac(["SUPERADMIN"]),
  menuGroupController.filterMenuGroups,
);

/**
 * @swagger
 * /api/v1/menu-groups/roles:
 *   get:
 *     tags: [MenuGroups]
 *     security:
 *       - bearerAuth: []
 *     summary: Get available roles for menu assignment
 *     description: Requires SUPERADMIN role. Returns all roles that can have menu groups assigned.
 *     responses:
 *       '200':
 *         description: Available roles retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Role'
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '403':
 *         description: Forbidden - SUPERADMIN role required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get(
  "/roles",
  auth,
  rbac(["SUPERADMIN"]),
  menuGroupController.getAvailableRoles,
);

/**
 * @swagger
 * /api/v1/menu-groups/create:
 *   post:
 *     tags: [MenuGroups]
 *     security:
 *       - bearerAuth: []
 *     summary: Create a new menu group
 *     description: Requires SUPERADMIN role. Creates a new menu group for navigation.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *                 description: Menu group name
 *               icon:
 *                 type: string
 *                 description: Menu group icon
 *               parentId:
 *                 type: string
 *                 format: uuid
 *                 description: Parent menu group ID (for nested menus)
 *               sortOrder:
 *                 type: integer
 *                 default: 0
 *               isActive:
 *                 type: boolean
 *                 default: true
 *     responses:
 *       '201':
 *         description: Menu group created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '403':
 *         description: Forbidden - SUPERADMIN role required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  "/create",
  auth,
  rbac(["SUPERADMIN"]),
  menuGroupController.createMenuGroup,
);

/**
 * @swagger
 * /api/v1/menu-groups/update:
 *   post:
 *     tags: [MenuGroups]
 *     security:
 *       - bearerAuth: []
 *     summary: Update a menu group
 *     description: Requires SUPERADMIN role. Updates menu group properties.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id]
 *             properties:
 *               id:
 *                 type: string
 *                 format: uuid
 *                 description: Menu group ID to update
 *               name:
 *                 type: string
 *               icon:
 *                 type: string
 *               parentId:
 *                 type: string
 *                 format: uuid
 *               sortOrder:
 *                 type: integer
 *               isActive:
 *                 type: boolean
 *     responses:
 *       '200':
 *         description: Menu group updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '403':
 *         description: Forbidden - SUPERADMIN role required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  "/update",
  auth,
  rbac(["SUPERADMIN"]),
  menuGroupController.updateMenuGroup,
);

/**
 * @swagger
 * /api/v1/menu-groups/delete:
 *   post:
 *     tags: [MenuGroups]
 *     security:
 *       - bearerAuth: []
 *     summary: Delete a menu group
 *     description: Requires SUPERADMIN role. Soft deletes a menu group.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id]
 *             properties:
 *               id:
 *                 type: string
 *                 format: uuid
 *                 description: Menu group ID to delete
 *     responses:
 *       '200':
 *         description: Menu group deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '403':
 *         description: Forbidden - SUPERADMIN role required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  "/delete",
  auth,
  rbac(["SUPERADMIN"]),
  menuGroupController.deleteMenuGroup,
);

/**
 * @swagger
 * /api/v1/menu-groups/assign:
 *   post:
 *     tags: [MenuGroups]
 *     security:
 *       - bearerAuth: []
 *     summary: Assign menu group to a role
 *     description: Requires SUPERADMIN role. Grants menu access permission to a specific role.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [roleId, menuGroupId]
 *             properties:
 *               roleId:
 *                 type: string
 *                 format: uuid
 *                 description: Role ID to assign menu to
 *               menuGroupId:
 *                 type: string
 *                 format: uuid
 *                 description: Menu group ID to assign
 *               permissionType:
 *                 type: string
 *                 enum: [read, write]
 *                 default: read
 *     responses:
 *       '200':
 *         description: Menu group assigned to role successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '403':
 *         description: Forbidden - SUPERADMIN role required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  "/assign",
  auth,
  rbac(["SUPERADMIN"]),
  menuGroupController.assignMenuGroupToRole,
);

/**
 * @swagger
 * /api/v1/menu-groups/revoke:
 *   post:
 *     tags: [MenuGroups]
 *     security:
 *       - bearerAuth: []
 *     summary: Revoke menu group from a role
 *     description: Requires SUPERADMIN role. Revokes menu access permission from a specific role.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [roleId, menuGroupId]
 *             properties:
 *               roleId:
 *                 type: string
 *                 format: uuid
 *               menuGroupId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       '200':
 *         description: Menu group revoked from role successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '403':
 *         description: Forbidden - SUPERADMIN role required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  "/revoke",
  auth,
  rbac(["SUPERADMIN"]),
  menuGroupController.revokeMenuGroupFromRole,
);

/**
 * @swagger
 * /api/v1/menu-groups/assign-item:
 *   post:
 *     tags: [MenuGroups]
 *     security:
 *       - bearerAuth: []
 *     summary: Assign individual menu item to a role
 *     description: Requires SUPERADMIN role. Grants specific menu item permission to a role.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [roleId, menuGroupId]
 *             properties:
 *               roleId:
 *                 type: string
 *                 format: uuid
 *               menuGroupId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       '200':
 *         description: Menu item assigned successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '403':
 *         description: Forbidden - SUPERADMIN role required
 */
router.post(
  "/assign-item",
  auth,
  rbac(["SUPERADMIN"]),
  menuGroupController.assignMenuGroupToRole,
);

/**
 * @swagger
 * /api/v1/menu-groups/revoke-item:
 *   post:
 *     tags: [MenuGroups]
 *     security:
 *       - bearerAuth: []
 *     summary: Revoke individual menu item from a role
 *     description: Requires SUPERADMIN role. Revokes specific menu item permission from a role.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [roleId, menuGroupId]
 *             properties:
 *               roleId:
 *                 type: string
 *                 format: uuid
 *               menuGroupId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       '200':
 *         description: Menu item revoked successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '403':
 *         description: Forbidden - SUPERADMIN role required
 */
router.post(
  "/revoke-item",
  auth,
  rbac(["SUPERADMIN"]),
  menuGroupController.revokeMenuGroupFromRole,
);

/**
 * @swagger
 * /api/v1/menu-groups/bulk-assign:
 *   post:
 *     tags: [MenuGroups]
 *     security:
 *       - bearerAuth: []
 *     summary: Bulk assign menu groups to a role
 *     description: Requires SUPERADMIN role. Assigns multiple menu groups to a role in one request.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [roleId, menuGroupIds]
 *             properties:
 *               roleId:
 *                 type: string
 *                 format: uuid
 *               menuGroupIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *     responses:
 *       '200':
 *         description: Menu groups bulk-assigned successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '403':
 *         description: Forbidden - SUPERADMIN role required
 */
router.post(
  "/bulk-assign",
  auth,
  rbac(["SUPERADMIN"]),
  menuGroupController.bulkAssignMenuGroups,
);

/**
 * @swagger
 * /api/v1/menu-groups/bulk-revoke:
 *   post:
 *     tags: [MenuGroups]
 *     security:
 *       - bearerAuth: []
 *     summary: Bulk revoke menu groups from a role
 *     description: Requires SUPERADMIN role. Revokes multiple menu groups from a role in one request.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [roleId, menuGroupIds]
 *             properties:
 *               roleId:
 *                 type: string
 *                 format: uuid
 *               menuGroupIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *     responses:
 *       '200':
 *         description: Menu groups bulk-revoked successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '403':
 *         description: Forbidden - SUPERADMIN role required
 */
router.post(
  "/bulk-revoke",
  auth,
  rbac(["SUPERADMIN"]),
  menuGroupController.bulkRevokeMenuGroups,
);

module.exports = router;

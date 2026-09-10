/**
 * Tenant Hierarchy Routes
 *
 * Routes for parent-tenant to child business unit hierarchy management.
 * Mounted at /api/v1/tenant-hierarchy
 */

const express = require("express");
const router = express.Router();

const { auth } = require("../../middlewares/auth.middleware");
const {
  getTenantTree,
  getTenantChildren,
  getTenantParent,
  getTenantDescendants,
  getTenantAncestors,
  addChildTenant,
  updateTenantParent,
  removeTenantParent,
  getCrossTenantRoles,
} = require("../../controllers/tenantHierarchy.controller");
const {
  addChild: addChildValidator,
} = require("../../validators/tenantHierarchy.validator");
const { validateUuid } = require("../../middlewares/validateUuid.middleware");

/**
 * @swagger
 * /api/v1/tenant-hierarchy/tree:
 *   get:
 *     summary: Get full tenant tree
 *     description: Retrieves the complete hierarchical tree of all tenants and business units. Requires read access to TenantHierarchy.
 *     tags: [TenantHierarchy]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: depth
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 10
 *           default: 5
 *           description: Maximum depth to traverse
 *     responses:
 *       200:
 *         description: Tenant tree retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 tree:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       name:
 *                         type: string
 *                       code:
 *                         type: string
 *                       parentId:
 *                         type: string
 *                         format: uuid
 *                       children:
 *                         type: array
 *       401:
 *         description: Unauthorized
 */
router.get("/tree", auth, getTenantTree);

/**
 * @swagger
 * /api/v1/tenant-hierarchy/{tenantId}/children:
 *   get:
 *     summary: Get child tenants
 *     description: Retrieves direct child tenants (business units) of a parent tenant. Requires read access to TenantHierarchy.
 *     tags: [TenantHierarchy]
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
 *       200:
 *         description: Child tenants retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 children:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       name:
 *                         type: string
 *                       code:
 *                         type: string
 *       404:
 *         description: Parent tenant not found
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/:tenantId/children",
  auth,
  validateUuid("tenantId"),
  getTenantChildren,
);

/**
 * @swagger
 * /api/v1/tenant-hierarchy/{tenantId}/parent:
 *   get:
 *     summary: Get parent tenant
 *     description: Retrieves the direct parent tenant of a child business unit. Requires read access to TenantHierarchy.
 *     tags: [TenantHierarchy]
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
 *       200:
 *         description: Parent tenant retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 parent:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       format: uuid
 *                     name:
 *                       type: string
 *                     code:
 *                       type: string
 *       404:
 *         description: Tenant has no parent (is a root tenant)
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/:tenantId/parent",
  auth,
  validateUuid("tenantId"),
  getTenantParent,
);

/**
 * @swagger
 * /api/v1/tenant-hierarchy/{tenantId}/descendants:
 *   get:
 *     summary: Get all descendant tenants
 *     description: Retrieves all descendant tenants (recursive children) of a parent tenant. Requires read access to TenantHierarchy.
 *     tags: [TenantHierarchy]
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
 *         name: depth
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 10
 *           default: 10
 *     responses:
 *       200:
 *         description: Descendant tenants retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 descendants:
 *                   type: array
 *                   items:
 *                     type: object
 *       404:
 *         description: Tenant not found
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/:tenantId/descendants",
  auth,
  validateUuid("tenantId"),
  getTenantDescendants,
);

/**
 * @swagger
 * /api/v1/tenant-hierarchy/{tenantId}/ancestors:
 *   get:
 *     summary: Get all ancestor tenants
 *     description: Retrieves all ancestor tenants (recursive parents) of a child business unit. Requires read access to TenantHierarchy.
 *     tags: [TenantHierarchy]
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
 *       200:
 *         description: Ancestor tenants retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ancestors:
 *                   type: array
 *                   items:
 *                     type: object
 *       404:
 *         description: Tenant has no ancestors (is a root tenant)
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/:tenantId/ancestors",
  auth,
  validateUuid("tenantId"),
  getTenantAncestors,
);

/**
 * @swagger
 * /api/v1/tenant-hierarchy/{parentId}/children:
 *   post:
 *     summary: Add a child tenant
 *     description: Creates a new child tenant (business unit) under a parent tenant. Requires write access to TenantHierarchy.
 *     tags: [TenantHierarchy]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: parentId
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
 *               - code
 *             properties:
 *               name:
 *                 type: string
 *                 description: Name of the child tenant
 *               code:
 *                 type: string
 *                 description: Unique code for the child tenant
 *               settings:
 *                 type: object
 *                 description: Tenant-specific settings
 *               plan:
 *                 type: string
 *                 enum: [free, professional, business, enterprise]
 *                 default: free
 *     responses:
 *       201:
 *         description: Child tenant created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   format: uuid
 *                 name:
 *                   type: string
 *                 code:
 *                   type: string
 *                 parentId:
 *                   type: string
 *                   format: uuid
 *       400:
 *         description: Invalid input or code already exists
 *       401:
 *         description: Unauthorized
 */
// `addChildValidator` is a Joi schema, so `.validate` is Joi's own
// (value, options) method — passing it as middleware called it with
// (req, res, next), which threw and 500'd every request. The body is now
// validated inside addChildTenant against that same schema.
router.post("/:parentId/children", auth, addChildTenant);

/**
 * @swagger
 * /api/v1/tenant-hierarchy/{tenantId}/parent:
 *   put:
 *     summary: Update tenant parent
 *     description: Changes the parent tenant of a child business unit. Requires write access to TenantHierarchy.
 *     tags: [TenantHierarchy]
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
 *               - newParentId
 *             properties:
 *               newParentId:
 *                 type: string
 *                 format: uuid
 *                 description: ID of the new parent tenant
 *     responses:
 *       200:
 *         description: Parent tenant updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 tenantId:
 *                   type: string
 *                   format: uuid
 *                 newParentId:
 *                   type: string
 *                   format: uuid
 *       400:
 *         description: Invalid parent relationship
 *       404:
 *         description: Tenant or parent not found
 *       401:
 *         description: Unauthorized
 */
router.put(
  "/:tenantId/parent",
  auth,
  validateUuid("tenantId"),
  updateTenantParent,
);

/**
 * @swagger
 * /api/v1/tenant-hierarchy/{tenantId}/parent:
 *   delete:
 *     summary: Remove tenant parent
 *     description: Removes the parent relationship, making the child tenant a root tenant. Requires write access to TenantHierarchy.
 *     tags: [TenantHierarchy]
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
 *       200:
 *         description: Parent relationship removed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 tenantId:
 *                   type: string
 *                   format: uuid
 *                 status:
 *                   type: string
 *                   enum: [root]
 *       404:
 *         description: Tenant not found or already a root tenant
 *       401:
 *         description: Unauthorized
 */
router.delete(
  "/:tenantId/parent",
  auth,
  validateUuid("tenantId"),
  removeTenantParent,
);

/**
 * @swagger
 * /api/v1/tenant-hierarchy/cross-tenant-roles:
 *   get:
 *     summary: Get cross-tenant role assignments
 *     description: Retrieves all cross-tenant role assignments where users have roles spanning multiple tenants in the hierarchy. Requires read access to TenantHierarchy.
 *     tags: [TenantHierarchy]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *           format: uuid
 *           description: Filter by user ID
 *     responses:
 *       200:
 *         description: Cross-tenant role assignments retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 assignments:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       userId:
 *                         type: string
 *                         format: uuid
 *                       tenantId:
 *                         type: string
 *                         format: uuid
 *                       roleId:
 *                         type: string
 *                         format: uuid
 *       401:
 *         description: Unauthorized
 */
router.get("/cross-tenant-roles", auth, getCrossTenantRoles);

module.exports = router;

/**
 * @swagger
 * tags:
 *   name: Admin
 *   description: Super Admin backend management endpoints
 */

const express = require("express");
const router = express.Router();
const { auth } = require("../../middlewares/auth.middleware");
const { rbac } = require("../../middlewares/rbac.middleware");
const {
  getAllTenants,
  updateTenantStatus,
  updateTenantFlags,
} = require("../../controllers/admin.controller");

// All admin routes require SUPER_ADMIN role
router.use(auth);
router.use(rbac(["SUPER_ADMIN", "SUPERADMIN"]));

/**
 * @swagger
 * /api/v1/admin/tenants:
 *   get:
 *     tags: [Admin]
 *     summary: Get all tenants system-wide
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *     responses:
 *       '200':
 *         description: List of tenants
 */
router.get("/tenants", getAllTenants);

/**
 * @swagger
 * /api/v1/admin/tenants/{id}/status:
 *   patch:
 *     tags: [Admin]
 *     summary: Update tenant status
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
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
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [active, suspended, deleted]
 *     responses:
 *       '200':
 *         description: Tenant status updated
 */
router.patch("/tenants/:id/status", updateTenantStatus);

/**
 * @swagger
 * /api/v1/admin/tenants/{id}/flags:
 *   patch:
 *     tags: [Admin]
 *     summary: Update tenant feature flags
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
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
 *               - flags
 *             properties:
 *               flags:
 *                 type: object
 *                 additionalProperties: true
 *     responses:
 *       '200':
 *         description: Tenant flags updated
 */
router.patch("/tenants/:id/flags", updateTenantFlags);

module.exports = router;

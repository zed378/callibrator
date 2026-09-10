/**
 * @swagger
 * tags:
 *   name: Tenants
 *   description: Endpoints for managing tenants and organizations
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
const { dynamicAccess } = require("../../middlewares/dynamicAccess.middleware");
const { validateUuid } = require("../../middlewares/validateUuid.middleware");
const { endpointRateLimiter } = require("../../services/rateLimiter.redis.service");
const { enforceStorageQuota } = require("../../middlewares/enforceQuota.middleware");
const tenantController = require("../../controllers/tenant.controller");
const { upload } = require("../../utils/upload.util");

/* ------------------------------------------------------------------ */
/* GET ALL TENANTS                                                    */
/* ------------------------------------------------------------------ */
/**
 * @swagger
 * /api/v1/tenants/all:
 *   get:
 *     summary: Retrieve a paginated list of tenants
 *     description: Requires read access to Tenant model with tenant scope. Uses dynamic RBAC/ABAC.
 *     tags:
 *       - Tenants
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: find
 *         required: false
 *         description: Free-text search by name, code, or description
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         required: false
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *           default: 25
 *     responses:
 *       '200':
 *         description: Successful retrieval of tenants
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
 *                   example: "Tenants fetched successfully"
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
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
 *       '401':
 *         description: Unauthorized
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
 *                   example: 401
 *                 message:
 *                   type: string
 *                   example: "Unauthorized"
 *       '403':
 *         description: Forbidden - Insufficient permissions
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
  "/all",
  auth,
  dynamicAccess("Management", "read", { checkTenant: true }),
  tenantController.getAllTenants,
);

/* ------------------------------------------------------------------ */
/* GET SPECIFIC TENANT                                                */
/* ------------------------------------------------------------------ */
/**
 * @swagger
 * /api/v1/tenants/detail:
 *   post:
 *     summary: Fetch details of a specific tenant by ID
 *     description: Requires read access to Tenant model. Uses dynamic RBAC/ABAC.
 *     tags:
 *       - Tenants
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - tenantId
 *             properties:
 *               tenantId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       '200':
 *         description: Tenant details retrieved successfully
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
 *                   example: "Tenant fetched successfully"
 *                 data:
 *                   type: object
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
 *       '403':
 *         description: Forbidden - Insufficient permissions
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
router.post(
  "/detail",
  auth,
  dynamicAccess("Management", "read", { checkTenant: true }),
  tenantController.getSpecificTenant,
);

/* ------------------------------------------------------------------ */
/* PUBLIC BRANDING (no auth) — login/register page reads tenant        */
/* logo/name/color pre-auth via the X-Tenant-ID header.                */
/* Returns only non-sensitive branding fields (no users/settings).     */
/* ------------------------------------------------------------------ */
/**
 * @swagger
 * /api/v1/tenants/public:
 *   get:
 *     summary: Public tenant branding (no auth)
 *     description: >
 *       Pre-auth branding for the login/register pages. Resolves the tenant
 *       from the X-Tenant-ID or X-Tenant-Code header and returns only
 *       non-sensitive fields (name, code, primaryColor, logo URL).
 *     tags:
 *       - Tenants
 *     parameters:
 *       - in: header
 *         name: X-Tenant-ID
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Tenant UUID (alternative to X-Tenant-Code)
 *       - in: header
 *         name: X-Tenant-Code
 *         schema:
 *           type: string
 *         description: Tenant code (alternative to X-Tenant-ID)
 *     responses:
 *       200:
 *         description: Tenant branding retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       404:
 *         description: Tenant not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/public", tenantController.getPublicBranding);

/* ------------------------------------------------------------------ */
/* CREATE TENANT (supports form-data with optional file upload)       */
/* ------------------------------------------------------------------ */
/**
 * @swagger
 * /api/v1/tenants/create:
 *   post:
 *     summary: Create a new tenant
 *     description: Requires create access to Tenant model with tenant scope. Uses dynamic RBAC/ABAC. Supports multipart/form-data for file upload.
 *     tags:
 *       - Tenants
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - code
 *             properties:
 *               name:
 *                 type: string
 *                 example: "Acme Corporation"
 *               code:
 *                 type: string
 *                 example: "acme-corp"
 *               description:
 *                 type: string
 *                 example: "Acme Corporation - Global Enterprise"
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: Optional logo file (JPEG, PNG, GIF, WebP, SVG). Use field name "file" for the upload.
 *               maxUsers:
 *                 type: integer
 *                 example: 50
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "contact@acmecorp.com"
 *               phone:
 *                 type: string
 *                 example: "+1-555-123-4567"
 *               address:
 *                 type: string
 *                 example: "123 Business Ave, Suite 100"
 *               city:
 *                 type: string
 *                 example: "New York"
 *               state:
 *                 type: string
 *                 example: "NY"
 *               zipCode:
 *                 type: string
 *                 example: "10001"
 *               country:
 *                 type: string
 *                 example: "United States"
 *               website:
 *                 type: string
 *                 format: uri
 *                 example: "https://www.acmecorp.com"
 *     responses:
 *       '201':
 *         description: Tenant created successfully
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
 *                   example: "Tenant created successfully"
 *                 data:
 *                   type: object
 *       '409':
 *         description: Conflict (name or code already exists)
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
 *                   example: 409
 *                 message:
 *                   type: string
 *                   example: "Tenant name or code already exists"
 *       '403':
 *         description: Forbidden - Insufficient permissions
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
router.post(
  "/create",
  endpointRateLimiter("tenantCreate"),
  auth,
  dynamicAccess("Management", "create", { checkTenant: true }),
  upload({
    folder: "uploads/tenant",
    allowedMimes: [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "image/svg+xml",
    ],
    allowedExtensions: [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"],
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024,
  }),
  tenantController.createTenant,
);

/* ------------------------------------------------------------------ */
/* UPDATE TENANT (supports form-data with optional file upload)       */
/* ------------------------------------------------------------------ */
/**
 * @swagger
 * /api/v1/tenants/edit:
 *   patch:
 *     summary: Update an existing tenant's details
 *     description: Requires update access to Tenant model. Self-check enabled. Uses dynamic RBAC/ABAC. Supports multipart/form-data for file upload.
 *     tags:
 *       - Tenants
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - tenantId
 *             properties:
 *               tenantId:
 *                 type: string
 *                 format: uuid
 *                 example: "b4130d0e-4772-4868-9da9-0817271bda93"
 *               name:
 *                 type: string
 *                 example: "Acme Corporation Updated"
 *               code:
 *                 type: string
 *                 example: "acme-corp-updated"
 *               description:
 *                 type: string
 *                 example: "Updated description"
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: Optional logo file (JPEG, PNG, GIF, WebP, SVG). Use field name "file" for the upload.
 *               status:
 *                 type: string
 *                 enum: [ACTIVE, INACTIVE, SUSPENDED]
 *                 example: "ACTIVE"
 *               maxUsers:
 *                 type: integer
 *                 example: 100
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "contact@acmecorp.com"
 *               phone:
 *                 type: string
 *                 example: "+1-555-123-4567"
 *               address:
 *                 type: string
 *                 example: "123 Business Ave, Suite 100"
 *               city:
 *                 type: string
 *                 example: "New York"
 *               state:
 *                 type: string
 *                 example: "NY"
 *               zipCode:
 *                 type: string
 *                 example: "10001"
 *               country:
 *                 type: string
 *                 example: "United States"
 *               website:
 *                 type: string
 *                 format: uri
 *                 example: "https://www.acmecorp.com"
 *     responses:
 *       '200':
 *         description: Tenant updated successfully
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
 *                   example: "Tenant updated successfully"
 *                 data:
 *                   type: object
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
 *       '409':
 *         description: Conflict (name or code already exists)
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
 *                   example: 409
 *                 message:
 *                   type: string
 *                   example: "Tenant name or code already exists"
 *       '403':
 *         description: Forbidden - Insufficient permissions
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
router.patch(
  "/edit",
  endpointRateLimiter("tenantUpload"),
  auth,
  dynamicAccess("Management", "update", { checkSelf: true, checkTenant: true }),
  enforceStorageQuota(),
  upload({
    folder: "uploads/tenant",
    allowedMimes: [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "image/svg+xml",
    ],
    allowedExtensions: [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"],
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024,
  }),
  tenantController.updateTenant,
);

/* ------------------------------------------------------------------ */
/* DELETE TENANT                                                      */
/* ------------------------------------------------------------------ */
/**
 * @swagger
 * /api/v1/tenants/delete:
 *   delete:
 *     summary: Delete a tenant
 *     description: Requires delete access to Tenant model with tenant scope. Uses dynamic RBAC/ABAC.
 *     tags:
 *       - Tenants
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - tenantId
 *             properties:
 *               tenantId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       '200':
 *         description: Tenant deleted successfully
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
 *                   example: "Tenant deleted successfully"
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
 *       '400':
 *         description: Bad Request (tenant has active users)
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
 *                   example: "Cannot delete tenant with active users"
 *       '403':
 *         description: Forbidden - Insufficient permissions
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
  "/delete",
  auth,
  dynamicAccess("Management", "delete", { checkTenant: true }),
  tenantController.deleteTenant,
);

/* ------------------------------------------------------------------ */
/* TENANT SETTINGS & LOGO OPERATIONS */
/* ------------------------------------------------------------------ */

/**
 * @swagger
 * /api/v1/tenants/settings:
 *   post:
 *     summary: Get tenant settings
 *     description: Retrieves the settings for a tenant. Requires Management read access.
 *     tags: [Tenants]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [tenantId]
 *             properties:
 *               tenantId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       '200':
 *         description: Tenant settings retrieved successfully
 *       '404':
 *         description: Tenant not found
 */
router.post(
  "/settings",
  auth,
  dynamicAccess("Management", "read", { checkTenant: true }),
  tenantController.getTenantSettings,
);

/**
 * @swagger
 * /api/v1/tenants/settings:
 *   patch:
 *     summary: Update tenant settings
 *     description: Updates the settings for a tenant. Requires Management write access.
 *     tags: [Tenants]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [tenantId, settings]
 *             properties:
 *               tenantId:
 *                 type: string
 *                 format: uuid
 *               settings:
 *                 type: object
 *     responses:
 *       '200':
 *         description: Tenant settings updated successfully
 *       '400':
 *         description: Bad request
 */
router.patch(
  "/settings",
  auth,
  dynamicAccess("Management", "write", { checkTenant: true }),
  tenantController.updateTenantSettings,
);

/**
 * @swagger
 * /api/v1/tenants/user-count:
 *   post:
 *     summary: Get tenant user count
 *     description: Retrieves the active user count for a tenant. Requires Management read access.
 *     tags: [Tenants]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [tenantId]
 *             properties:
 *               tenantId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       '200':
 *         description: User count retrieved successfully
 *       '404':
 *         description: Tenant not found
 */
router.post(
  "/user-count",
  auth,
  dynamicAccess("Management", "read", { checkTenant: true }),
  tenantController.getTenantUserCount,
);

/**
 * @swagger
 * /api/v1/tenants/{tenantId}/logo:
 *   post:
 *     summary: Upload tenant logo
 *     description: Uploads a logo for the specified tenant. Requires Management update access.
 *     tags: [Tenants]
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
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       '200':
 *         description: Tenant logo uploaded successfully
 *       '400':
 *         description: Bad request or file upload error
 */
router.post(
  "/:tenantId/logo",
  auth,
  dynamicAccess("Management", "update", { checkTenant: true }),
  upload({
    folder: "uploads/tenant",
    allowedMimes: [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "image/svg+xml",
    ],
    allowedExtensions: [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"],
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024,
  }),
  tenantController.uploadTenantLogo,
);

/**
 * @swagger
 * /api/v1/tenants/{tenantId}/logo:
 *   delete:
 *     summary: Remove tenant logo
 *     description: Removes the logo for the specified tenant. Requires Management update access.
 *     tags: [Tenants]
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
 *         description: Tenant logo removed successfully
 *       '404':
 *         description: Tenant not found
 */
router.delete(
  "/:tenantId/logo",
  auth,
  dynamicAccess("Management", "update", { checkTenant: true }),
  tenantController.removeTenantLogo,
);

module.exports = router;

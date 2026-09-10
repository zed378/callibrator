/**
 * @swagger
 * tags:
 *   name: Users
 *   description: Endpoints for managing user accounts and roles
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
const { upload } = require("../../utils/upload.util");
const {
  enforceSeatQuota,
  enforceStorageQuota,
} = require("../../middlewares/enforceQuota.middleware");
const userController = require("../../controllers/user.controller");
const { recordAudit } = require("../../middlewares/auditLog.middleware");

/* ------------------------------------------------------------------ */
/* GET ALL USERS (paginated, searchable, tenant‑scoped)               */
/* ------------------------------------------------------------------ */
/**
 * @swagger
 * /api/v1/users/all:
 *   get:
 *     summary: Retrieve a paginated list of users
 *     description: Requires read access to User model with tenant scope. Uses dynamic RBAC/ABAC.
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: tenantId
 *         required: false
 *         description: Identifier of the tenant the request belongs to
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: roleFilter
 *         required: false
 *         description: Role filter
 *         schema:
 *           type: string
 *       - in: query
 *         name: find
 *         required: false
 *         description: Free-text search
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
 *           default: 50
 *     responses:
 *       '200':
 *         description: Successful retrieval of users
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
 *                   example: "Users fetched successfully"
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
  dynamicAccess("users", "read", { checkTenant: true }),
  userController.getAllUsers,
);

/* ------------------------------------------------------------------ */
/* GET SPECIFIC USER                                                  */
/* ------------------------------------------------------------------ */
/**
 * @swagger
 * /api/v1/users/detail:
 *   post:
 *     summary: Fetch details of a specific user by ID
 *     description: Requires read access to User model. Uses dynamic RBAC/ABAC.
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *             properties:
 *               userId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       '200':
 *         description: User details retrieved successfully
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
 *                   example: "User fetched successfully"
 *                 data:
 *                   type: object
 *       '400':
 *         description: Missing userId
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
 *                   example: "userId is required"
 *       '404':
 *         description: User not found
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
 *                   example: "User not found"
 */
router.post(
  "/detail",
  auth,
  dynamicAccess("users", "read", { checkTenant: true }),
  userController.getSpecificUser,
);

/* ------------------------------------------------------------------ */
/* CHECK USERNAME AVAILABILITY                                        */
/* ------------------------------------------------------------------ */
/**
 * @swagger
 * /api/v1/users/username-check:
 *   post:
 *     summary: Check if a username is available
 *     description: Requires authentication. No specific permission required - available to all authenticated users.
 *     tags:
 *       - Users
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *             properties:
 *               username:
 *                 type: string
 *     responses:
 *       '200':
 *         description: Availability check result
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
 *                   example: "Username is available"
 *                 data:
 *                   type: object
 *                   properties:
 *                     available:
 *                       type: boolean
 *       '400':
 *         description: Bad request
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
 *                   example: "Username is required"
 */
// Username availability check requires authentication to prevent user enumeration
// See: commands-backend.md RBAC rules - every protected endpoint must verify valid auth token
router.post("/username-check", auth, userController.checkUsernameAvailability);

/* ------------------------------------------------------------------ */
/* UPDATE USER ROLE                                                   */
/* ------------------------------------------------------------------ */
/**
 * @swagger
 * /api/v1/users/role-update:
 *   post:
 *     summary: Update a user's role
 *     description: Requires update access to User model with tenant scope. Uses dynamic RBAC/ABAC.
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - roleId
 *             properties:
 *               userId:
 *                 type: string
 *                 format: uuid
 *               roleId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       '200':
 *         description: Role updated successfully
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
 *                   example: "User role updated successfully"
 *                 data:
 *                   type: object
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
  "/role-update",
  auth,
  dynamicAccess("users", "update", { checkTenant: true }),
  recordAudit("UPDATE", "User", {
    resolveResourceId: (req) => req.body?.userId,
  }),
  userController.updateUserRole,
);

/* ------------------------------------------------------------------ */
/* CREATE USER                                                        */
/* ------------------------------------------------------------------ */
/**
 * @swagger
 * /api/v1/users/create:
 *   post:
 *     summary: Create a new user
 *     description: Requires create access to User model with tenant scope. Uses dynamic RBAC/ABAC.
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - firstName
 *               - lastName
 *               - email
 *               - password
 *               - roleId
 *             properties:
 *               tenantId:
 *                 type: string
 *                 format: uuid
 *                 description: Optional tenant ID
 *               username:
 *                 type: string
 *                 description: Username (alphanumeric, 3-30 chars, lowercase)
 *                 example: johndoe
 *               firstName:
 *                 type: string
 *                 description: User's first name (2-100 chars)
 *                 example: John
 *               lastName:
 *                 type: string
 *                 description: User's last name (2-100 chars)
 *                 example: Doe
 *               email:
 *                 type: string
 *                 format: email
 *                 description: Email address (will be lowercased)
 *                 example: user@example.com
 *               password:
 *                 type: string
 *                 minLength: 8
 *                 description: Password (must contain uppercase, lowercase, and number)
 *                 example: Password123
 *               roleId:
 *                 type: string
 *                 format: uuid
 *                 description: Role ID (valid UUID)
 *               status:
 *                 type: string
 *                 enum: [ACTIVE, INACTIVE, SUSPENDED]
 *                 default: ACTIVE
 *                 description: User status
 *     responses:
 *       '201':
 *         description: User created successfully
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
 *                   example: "User created successfully"
 *                 data:
 *                   type: object
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
  auth,
  dynamicAccess("users", "create", { checkTenant: true }),
  enforceSeatQuota(),
  recordAudit("CREATE", "User"),
  userController.createUser,
);

/* ------------------------------------------------------------------ */
/* EDIT USER                                                          */
/* ------------------------------------------------------------------ */
/**
 * @swagger
 * /api/v1/users/edit:
 *   patch:
 *     summary: Update an existing user's details
 *     description: Requires update access to User model. Self-check enabled. Uses dynamic RBAC/ABAC.
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *             properties:
 *               userId:
 *                 type: string
 *                 format: uuid
 *               username:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *               status:
 *                 type: string
 *     responses:
 *       '200':
 *         description: User updated successfully
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
 *                   example: "User updated successfully"
 *                 data:
 *                   type: object
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
  auth,
  dynamicAccess("users", "update", { checkSelf: true, checkTenant: true }),
  userController.editUser,
);

/* ------------------------------------------------------------------ */
/* DELETE USER                                                        */
/* ------------------------------------------------------------------ */
/**
 * @swagger
 * /api/v1/users/delete:
 *   delete:
 *     summary: Delete a user account
 *     description: Requires delete access to User model with tenant scope. Uses dynamic RBAC/ABAC.
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       '200':
 *         description: User deleted successfully
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
 *                   example: "User deleted successfully"
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
  dynamicAccess("users", "delete", { checkTenant: true }),
  recordAudit("DELETE", "User", {
    resolveResourceId: (req) => req.query?.userId || req.body?.userId,
  }),
  userController.deleteUser,
);

/* ------------------------------------------------------------------ */
/* UPLOAD USER AVATAR                                                 */
/* ------------------------------------------------------------------ */
/**
 * @swagger
 * /api/v1/users/{userId}/avatar:
 *   post:
 *     summary: Upload an avatar for a user
 *     description: Requires update access to User model. Self-check enabled.
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
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
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       '200':
 *         description: User avatar uploaded successfully
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
 *                   example: "Avatar uploaded successfully"
 *                 data:
 *                   type: object
 *       '400':
 *         description: No file uploaded or invalid file type
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
 *                   example: "No file uploaded"
 *       '404':
 *         description: User not found
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
 *                   example: "User not found"
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
router.post(
  "/:userId/avatar",
  auth,
  validateUuid("userId"),
  dynamicAccess("users", "update", { checkSelf: true, checkTenant: true }),
  enforceStorageQuota(),
  upload({
    folder: "uploads/profile",
    allowedMimes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
    allowedExtensions: [".jpg", ".jpeg", ".png", ".gif", ".webp"],
    maxFileSize: 2 * 1024 * 1024, // 2MB
  }),
  userController.uploadUserAvatar,
);

/* ------------------------------------------------------------------ */
/* REMOVE USER AVATAR                                                 */
/* ------------------------------------------------------------------ */
/**
 * @swagger
 * /api/v1/users/{userId}/avatar:
 *   delete:
 *     summary: Remove a user's avatar
 *     description: Requires update access to User model. Self-check enabled.
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       '200':
 *         description: User avatar removed successfully
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
 *                   example: "Avatar removed successfully"
 *       '404':
 *         description: User not found
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
 *                   example: "User not found"
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
  "/:userId/avatar",
  auth,
  validateUuid("userId"),
  dynamicAccess("users", "update", { checkSelf: true, checkTenant: true }),
  userController.removeUserAvatar,
);

module.exports = router;

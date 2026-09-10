/**
 * @swagger
 * tags:
 *   name: Sessions
 *   description: Session management endpoints
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
const { validateUuid } = require("../../middlewares/validateUuid.middleware");
const {
  getAllSessions,
  getSessionById,
  revokeSession,
  revokeAllUserSessions,
  deleteSession,
  getSessionStats,
} = require("../../controllers/session.controller");
const { validate } = require("../../middlewares/validation.middleware");
const sessionValidator = require("../../validators/session.validator");

// All session routes require authentication
router.use(auth);

/* ------------------------------------------------------------------ */
/* GET /api/v1/sessions/stats                                         */
/* ------------------------------------------------------------------ */
/**
 * @swagger
 * /api/v1/sessions/stats:
 *   get:
 *     tags: [Sessions]
 *     security:
 *       - bearerAuth: []
 *     summary: Get session statistics
 *     description: Get counts of active, expired, and revoked sessions
 *     parameters:
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *         description: Filter by user ID (admin only)
 *     responses:
 *       '200':
 *         description: Session statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.get("/stats", rbac(["SUPERADMIN"]), getSessionStats);

/* ------------------------------------------------------------------ */
/* GET /api/v1/sessions                                                 */
/* ------------------------------------------------------------------ */
/**
 * @swagger
 * /api/v1/sessions:
 *   get:
 *     tags: [Sessions]
 *     security:
 *       - bearerAuth: []
 *     summary: Get all sessions (paginated)
 *     description: Admin-only endpoint. Get paginated list of sessions with optional filters.
 *     parameters:
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
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by IP, device, or user agent
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, expired, revoked]
 *         description: Filter by session status
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *         description: Filter by user ID
 *     responses:
 *       '200':
 *         description: Sessions retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.get("/", rbac(["SUPERADMIN"]), getAllSessions);

/* ------------------------------------------------------------------ */
/* GET /api/v1/sessions/:id                                             */
/* ------------------------------------------------------------------ */
/**
 * @swagger
 * /api/v1/sessions/{id}:
 *   get:
 *     tags: [Sessions]
 *     security:
 *       - bearerAuth: []
 *     summary: Get session by ID
 *     description: Get details of a specific session
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       '200':
 *         description: Session retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       '404':
 *         description: Session not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/:id", validateUuid("id"), rbac(["SUPERADMIN"]), getSessionById);

/* ------------------------------------------------------------------ */
/* POST /api/v1/sessions/:id/revoke                                     */
/* ------------------------------------------------------------------ */
/**
 * @swagger
 * /api/v1/sessions/{id}/revoke:
 *   post:
 *     tags: [Sessions]
 *     security:
 *       - bearerAuth: []
 *     summary: Revoke a session
 *     description: Revoke a specific session. Users can revoke their own sessions, admins can revoke any.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *                 default: MANUAL_REVOKE
 *     responses:
 *       '200':
 *         description: Session revoked successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       '404':
 *         description: Session not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '403':
 *         description: Access denied
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post("/:id/revoke", validateUuid("id"), rbac(["SUPERADMIN"]), validate(sessionValidator.revokeSessionSchema), revokeSession);

/* ------------------------------------------------------------------ */
/* POST /api/v1/sessions/user/:userId/revoke-all                        */
/* ------------------------------------------------------------------ */
/**
 * @swagger
 * /api/v1/sessions/user/{userId}/revoke-all:
 *   post:
 *     tags: [Sessions]
 *     security:
 *       - bearerAuth: []
 *     summary: Revoke all sessions for a user (Admin only)
 *     description: Revoke all active sessions for a specific user. Only Super Admins can do this.
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *                 default: ADMIN_REVOKE_ALL
 *     responses:
 *       '200':
 *         description: Sessions revoked successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       '403':
 *         description: Access denied
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post("/user/:userId/revoke-all", rbac(["SUPERADMIN"]), validate(sessionValidator.revokeAllSessionsSchema), revokeAllUserSessions);

/* ------------------------------------------------------------------ */
/* DELETE /api/v1/sessions/:id                                          */
/* ------------------------------------------------------------------ */
/**
 * @swagger
 * /api/v1/sessions/{id}:
 *   delete:
 *     tags: [Sessions]
 *     security:
 *       - bearerAuth: []
 *     summary: Delete a session
 *     description: Permanently delete a revoked or expired session. Users can delete their own sessions, admins can delete any.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       '200':
 *         description: Session deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       '404':
 *         description: Session not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '400':
 *         description: Can only delete revoked or expired sessions
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.delete("/:id", validateUuid("id"), rbac(["SUPERADMIN"]), deleteSession);

module.exports = router;

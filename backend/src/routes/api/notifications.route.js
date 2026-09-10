const express = require("express");
const router = express.Router();
const { auth } = require("../../middlewares/auth.middleware");
const { validateUuid } = require("../../middlewares/validateUuid.middleware");
const { validate } = require("../../middlewares/validation.middleware");
const { deleteManySchema } = require("../../validators/notification.validator");
const notificationController = require("../../controllers/notification.controller");

/**
 * @swagger
 * /api/v1/notifications:
 *   get:
 *     summary: Get all user notifications
 *     description: Retrieves all notifications for the currently authenticated user (and tenant-wide notifications).
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
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
 *           default: 25
 *       - in: query
 *         name: isRead
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [SYSTEM, CALIBRATION, INVENTORY, MAINTENANCE]
 *     responses:
 *       200:
 *         description: Notifications retrieved successfully
 */
router.get(
  "/",
  auth,
  notificationController.fetchUserNotifications,
);

/**
 * @swagger
 * /api/v1/notifications/test:
 *   post:
 *     summary: Emit a test notification (diagnostic — verifies realtime delivery)
 *     description: >-
 *       Emits a notification from within the server so socket.io pushes it live
 *       to the caller. Body (all optional): scope ("user" | "tenant"), title,
 *       message, type.
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Test notification emitted
 */
router.post(
  "/test",
  auth,
  notificationController.sendTestNotification,
);

/**
 * @swagger
 * /api/v1/notifications/read-all:
 *   patch:
 *     summary: Mark all notifications as read
 *     description: Marks all unread notifications for the currently authenticated user as read.
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All notifications marked as read
 */
router.patch(
  "/read-all",
  auth,
  notificationController.markAllAsRead,
);

/**
 * @swagger
 * /api/v1/notifications/{notificationId}/read:
 *   patch:
 *     summary: Mark notification as read
 *     description: Marks a specific notification as read.
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: notificationId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Notification marked as read
 *       404:
 *         description: Notification not found
 */
router.patch(
  "/:notificationId/read",
  auth,
  validateUuid("notificationId"),
  notificationController.markAsRead,
);

/**
 * @swagger
 * /api/v1/notifications/{notificationId}:
 *   delete:
 *     summary: Delete a notification
 *     description: Deletes (dismisses) an existing notification.
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: notificationId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Notification deleted successfully
 *       404:
 *         description: Notification not found
 */
/**
 * @swagger
 * /api/v1/notifications/all:
 *   delete:
 *     summary: Delete all of the caller's notifications
 *     description: Removes every notification visible to the authenticated user (their own plus tenant-wide broadcasts).
 *     tags: [Notifications]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Notifications deleted
 */
// Registered BEFORE /:notificationId so "all" is not parsed as a uuid param.
router.delete(
  "/all",
  auth,
  notificationController.deleteAllNotifications,
);

/**
 * @swagger
 * /api/v1/notifications/bulk:
 *   delete:
 *     summary: Delete selected notifications
 *     description: Deletes the given notification ids that belong to the caller. Ids outside their scope are ignored.
 *     tags: [Notifications]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ids]
 *             properties:
 *               ids:
 *                 type: array
 *                 items: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Notifications deleted
 *       400:
 *         description: Invalid or empty id list
 *       404:
 *         description: No matching notifications found
 */
// Also registered BEFORE /:notificationId for the same reason.
router.delete(
  "/bulk",
  auth,
  validate(deleteManySchema),
  notificationController.deleteManyNotifications,
);

router.delete(
  "/:notificationId",
  auth,
  validateUuid("notificationId"),
  notificationController.deleteNotification,
);

module.exports = router;

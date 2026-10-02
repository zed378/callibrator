/**
 * The caller's notifications: `/api/v1/notifications` (index.js mounts it).
 *
 * P9-18 (ADR-087): converted from notifications.route.js. Every route and
 * middleware is in the same order as before (checked against the mounted route
 * table). The contract is code-first: notifications.openapi.ts (P9-25,
 * ADR-103); the `@swagger` JSDoc this file carried is gone.
 */
import { Router, type NextFunction, type Request, type Response } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { validateUuid } from "../../middlewares/validateUuid.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { deleteManySchema } from "../../validators/notification.validator";
import notificationController from "../../controllers/notification.controller";
import { dynamicAccess } from "../../middlewares/dynamicAccess.middleware";

// `Router` is `express.Router` (the same function).
const router = Router();

// A-251: POST /test with `scope: "tenant"` broadcast a caller-worded
// notification (title, message, type) to EVERY user of the tenant, from any
// role — a spoofed "SYSTEM" notice one request away. The caller-only form
// stays open (the notifications page's realtime self-test uses it); the
// tenant broadcast needs `notifications` write, as sending to others does.
const canBroadcast = dynamicAccess("notifications", "write");
function tenantBroadcastGate(req: Request, res: Response, next: NextFunction): unknown {
  if ((req.body as { scope?: unknown } | undefined)?.scope === "tenant") {
    return canBroadcast(req, res, next);
  }
  // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression -- as built: the gate answers what `next` answers
  return next();
}

router.get(
  "/",
  auth,
  notificationController.fetchUserNotifications,
);

router.post(
  "/test",
  auth,
  tenantBroadcastGate,
  notificationController.sendTestNotification,
);

router.patch(
  "/read-all",
  auth,
  notificationController.markAllAsRead,
);

router.patch(
  "/:notificationId/read",
  auth,
  validateUuid("notificationId"),
  notificationController.markAsRead,
);

// Registered BEFORE /:notificationId so "all" is not parsed as a uuid param.
router.delete(
  "/all",
  auth,
  notificationController.deleteAllNotifications,
);

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

export = router;

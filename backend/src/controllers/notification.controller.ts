/**
 * The caller's notifications, `/api/v1/notifications`.
 *
 * P9-18 (ADR-087): converted from notification.controller.js, behaviour
 * unchanged. `req.user` is read without a guard (`auth` runs first on every
 * route), the bulk delete's body arrives validated, and the list filters are
 * passed raw (the service coerces them). The service is read through its
 * module object at call time; `asyncHandler` and `success` are captured at
 * load, as the `.js` destructured them. `export =` keeps the exact object
 * `require()` returned (the same keys, in the same order).
 */
import type { Request, Response } from "express";
import notificationService from "../services/notification.service";
import { asyncHandler as loadedAsyncHandler } from "../utils/controllerWrapper.util";
import { success as loadedSuccess } from "../utils/response.util";
import type { TenantId, UserId } from "../types/ids";

const asyncHandler = loadedAsyncHandler;
const success = loadedSuccess;

/** The principal `auth` set (read without a guard, as before). */
interface NotificationPrincipal {
  tenantId: TenantId;
  id: UserId;
}

/** The list filters, raw from the query string (the service coerces them). */
interface RawListQuery {
  page?: string;
  limit?: string;
  isRead?: string;
  type?: string;
}

const fetchUserNotifications = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId, id: userId } = req.user as NotificationPrincipal;
  const { page, limit, isRead, type } = req.query as RawListQuery;

  // No role-based widening: the feed is the caller's own inbox (see
  // fetchUserNotifications), which keeps it consistent with mark-read/delete.
  const query = {
    tenantId,
    userId,
    page,
    limit,
    isRead,
    type,
  };
  const result = await notificationService.fetchUserNotifications(query as Parameters<typeof notificationService.fetchUserNotifications>[0]);

  // The service answers its rows on success, as before (read without a guard).
  const data = result.data as NonNullable<typeof result.data>;
  success(res, data.rows, data.meta, result.message, result.status);
});

const markAsRead = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId, id: userId } = req.user as NotificationPrincipal;
  const { notificationId } = req.params as { notificationId: string };

  const result = await notificationService.markAsRead(tenantId, userId, notificationId);
  success(res, result.data, null, result.message, result.status);
});

const markAllAsRead = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId, id: userId } = req.user as NotificationPrincipal;

  const result = await notificationService.markAllAsRead(tenantId, userId);
  success(res, null, null, result.message, result.status);
});

const deleteAllNotifications = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId, id: userId } = req.user as NotificationPrincipal;

  const result = await notificationService.deleteAllNotifications(
    tenantId,
    userId,
  );
  success(res, result.data, null, result.message, result.status);
});

const deleteManyNotifications = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId, id: userId } = req.user as NotificationPrincipal;
  const { ids } = req.body as { ids: unknown };

  const result = await notificationService.deleteManyNotifications(
    tenantId,
    userId,
    ids,
  );
  success(res, result.data, null, result.message, result.status);
});

const deleteNotification = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId, id: userId } = req.user as NotificationPrincipal;
  const { notificationId } = req.params as { notificationId: string };

  const result = await notificationService.deleteNotification(tenantId, userId, notificationId);
  success(res, null, null, result.message, result.status);
});

// Diagnostic: emit a notification from inside the running server so socket.io
// pushes it live to the caller's connected client(s). Use it to manually verify
// realtime delivery. scope "tenant" targets the whole tenant; default targets
// only the caller.
const sendTestNotification = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId, id: userId } = req.user as NotificationPrincipal;
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: any falsy body reads as {}
  const { scope, title, message, type } = (req.body || {}) as Record<string, string | undefined>;

  const notification = await notificationService.emitNotification({
    tenantId,
    userId: scope === "tenant" ? null : userId,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty value takes the default
    type: type || "SYSTEM",
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built
    title: title || "🔔 Test notification",
    message:
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built
      message ||
      `Realtime test emitted at ${new Date().toLocaleTimeString()}.`,
    actionUrl: "/dashboard/notifications",
  });

  success(res, notification, null, "Test notification emitted", 201);
});

const controller = {
  fetchUserNotifications,
  markAsRead,
  markAllAsRead,
  deleteAllNotifications,
  deleteManyNotifications,
  deleteNotification,
  sendTestNotification,
};

export = controller;

const notificationService = require("../services/notification.service");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { success } = require("../utils/response.util");

exports.fetchUserNotifications = asyncHandler(async (req, res) => {
  const { tenantId, id: userId } = req.user;
  const { page, limit, isRead, type } = req.query;

  // No role-based widening: the feed is the caller's own inbox (see
  // fetchUserNotifications), which keeps it consistent with mark-read/delete.
  const result = await notificationService.fetchUserNotifications({
    tenantId,
    userId,
    page,
    limit,
    isRead,
    type,
  });

  success(res, result.data.rows, result.data.meta, result.message, result.status);
});

exports.markAsRead = asyncHandler(async (req, res) => {
  const { tenantId, id: userId } = req.user;
  const { notificationId } = req.params;

  const result = await notificationService.markAsRead(tenantId, userId, notificationId);
  success(res, result.data, null, result.message, result.status);
});

exports.markAllAsRead = asyncHandler(async (req, res) => {
  const { tenantId, id: userId } = req.user;

  const result = await notificationService.markAllAsRead(tenantId, userId);
  success(res, null, null, result.message, result.status);
});

exports.deleteAllNotifications = asyncHandler(async (req, res) => {
  const { tenantId, id: userId } = req.user;

  const result = await notificationService.deleteAllNotifications(
    tenantId,
    userId,
  );
  success(res, result.data, null, result.message, result.status);
});

exports.deleteManyNotifications = asyncHandler(async (req, res) => {
  const { tenantId, id: userId } = req.user;
  const { ids } = req.body;

  const result = await notificationService.deleteManyNotifications(
    tenantId,
    userId,
    ids,
  );
  success(res, result.data, null, result.message, result.status);
});

exports.deleteNotification = asyncHandler(async (req, res) => {
  const { tenantId, id: userId } = req.user;
  const { notificationId } = req.params;

  const result = await notificationService.deleteNotification(tenantId, userId, notificationId);
  success(res, null, null, result.message, result.status);
});

// Diagnostic: emit a notification from inside the running server so socket.io
// pushes it live to the caller's connected client(s). Use it to manually verify
// realtime delivery. scope "tenant" targets the whole tenant; default targets
// only the caller.
exports.sendTestNotification = asyncHandler(async (req, res) => {
  const { tenantId, id: userId } = req.user;
  const { scope, title, message, type } = req.body || {};

  const notification = await notificationService.emitNotification({
    tenantId,
    userId: scope === "tenant" ? null : userId,
    type: type || "SYSTEM",
    title: title || "🔔 Test notification",
    message:
      message ||
      `Realtime test emitted at ${new Date().toLocaleTimeString()}.`,
    actionUrl: "/dashboard/notifications",
  });

  success(res, notification, null, "Test notification emitted", 201);
});

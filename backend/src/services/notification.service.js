const { Op } = require("sequelize");
const { db } = require("../config");
const { Notification, NotificationState, User } = require("../models");
const { AppError } = require("../utils/appError.util");
const { DEFAULT_LIMIT, MAX_LIMIT } = require("../constants");
const { getIo } = require("../config/socket");
const notificationChannels = require("./notificationChannels.service");

// ------------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------------
const transformNotification = (notification) => {
  if (!notification) {return null;}
  const plain = notification.toJSON
    ? notification.toJSON()
    : { ...notification };

  // Collapse the per-user state join into the flat shape clients already
  // expect: `isRead` reflects THIS user, not the shared row. Absent state row
  // = unread. The join array itself is internal, so it is stripped.
  if (Object.prototype.hasOwnProperty.call(plain, "states")) {
    const state = Array.isArray(plain.states) ? plain.states[0] : null;
    plain.isRead = state ? !!state.isRead : false;
    plain.readAt = state ? state.readAt : null;
    delete plain.states;
  }
  return plain;
};

const transformNotifications = (rows) => (rows || []).map(transformNotification);

// ------------------------------------------------------------------
// EMIT NOTIFICATION (Internal Use)
// ------------------------------------------------------------------
exports.emitNotification = async (data) => {
  try {
    // Channel-routing fields are not Notification columns — strip them off
    // before persisting the row.
    const {
      channels,
      recipientEmail,
      recipientName,
      ...notifData
    } = data;

    const newNotification = await Notification.create(notifData);
    const transformed = transformNotification(newNotification);

    // --- Realtime channel (socket.io) ---
    // Delivered ONLY to the addressed recipient: the target user, or the target
    // tenant room for tenant-wide notifications. This mirrors the REST feed
    // (fetchUserNotifications), which is recipient scoped.
    //
    // It deliberately no longer fans out to a global "super_admins" room. That
    // pushed every user's notification to super admins, so their bell badge
    // incremented (and toasts/sounds fired) for items that were not theirs and
    // never appeared in their list — a phantom unread count, plus a leak of
    // other users' notification content.
    try {
      const io = getIo();
      const room = notifData.userId
        ? `user_${notifData.userId}`
        : notifData.tenantId
          ? `tenant_${notifData.tenantId}`
          : null;
      // No recipient => nobody to notify in realtime (the row is still stored).
      if (room) {
        io.to(room).emit("new_notification", transformed);
      }
    } catch (socketErr) {
      console.warn("Socket.io emit failed (server might be booting):", socketErr.message);
    }

    // --- Additional channel (email), opt-in via data.channels ---
    const requested = channels || notificationChannels.DEFAULT_CHANNELS;
    if (requested.includes("email")) {
      try {
        let email = recipientEmail;
        let name = recipientName;
        // Resolve recipient contact details from the target user if not supplied.
        if (notifData.userId && !email) {
          const u = await User.findByPk(notifData.userId, {
            attributes: ["email", "firstName"],
          });
          if (u) {
            email = email || u.email;
            name = name || u.firstName;
          }
        }
        await notificationChannels.dispatch(transformed, {
          channels: requested,
          recipientEmail: email,
          recipientName: name,
        });
      } catch (chErr) {
        console.warn("Notification channel dispatch failed:", chErr.message);
      }
    }

    return transformed;
  } catch (error) {
    console.error("Failed to emit notification:", error);
    // We don't throw here to prevent blocking main flows (like stock reduction) if notification fails
    return null;
  }
};

// ------------------------------------------------------------------
// FETCH USER NOTIFICATIONS
// ------------------------------------------------------------------
exports.fetchUserNotifications = async ({
  tenantId,
  userId,
  page = 1,
  limit = DEFAULT_LIMIT,
  isRead,
  type,
}) => {
  try {
    // This is a PERSONAL inbox: always scoped to the recipient (their own
    // notifications + tenant-wide ones, userId = null) — the same scope the
    // mark-read/delete mutations enforce.
    //
    // Super admins deliberately get no bypass here. Previously they received
    // every notification across every tenant, which (a) leaked other users'
    // personal notification content, and (b) surfaced items they then got a
    // 404 on when marking them read, because the mutations were recipient
    // scoped. Cross-tenant visibility belongs in a dedicated admin/audit
    // endpoint, not in someone's notification bell.
    const whereClause = {
      tenantId,
      [Op.or]: [{ userId: userId }, { userId: null }],
      // Hidden-for-this-user rows are excluded here (in SQL, not in JS) so
      // pagination and counts stay correct.
      "$states.deleted_at$": null,
    };

    if (isRead !== undefined) {
      const want = isRead === "true" || isRead === true;
      // No state row means unread, so "unread" must also match a NULL join.
      whereClause["$states.is_read$"] = want
        ? true
        : { [Op.or]: [false, null] };
    }
    if (type) {
      whereClause.type = type;
    }

    const safeLimit = Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT);
    const offset = (Number(page) - 1) * safeLimit;

    // subQuery:false is required for a WHERE on an included column to work
    // alongside limit/offset.
    const stateInclude = {
      model: NotificationState,
      as: "states",
      // required:false + a where puts userId in the JOIN's ON clause, so
      // notifications with no state row for this user still come back.
      where: { userId },
      required: false,
      attributes: ["isRead", "readAt", "deletedAt"],
    };

    const { count, rows } = await Notification.findAndCountAll({
      where: whereClause,
      include: [stateInclude],
      limit: safeLimit,
      offset,
      order: [["createdAt", "DESC"]],
      subQuery: false,
      distinct: true,
    });

    const unreadCount = await Notification.count({
      where: {
        tenantId,
        [Op.or]: [{ userId: userId }, { userId: null }],
        "$states.deleted_at$": null,
        "$states.is_read$": { [Op.or]: [false, null] },
      },
      include: [stateInclude],
      subQuery: false,
      distinct: true,
    });

    return {
      success: true,
      status: 200,
      message: "Fetch notifications successful",
      data: {
        rows: transformNotifications(rows),
        count,
        meta: {
          total: count,
          unread: unreadCount,
          page: Number(page),
          limit: safeLimit,
          totalPages: Math.ceil(count / safeLimit),
        },
      },
    };
  } catch (error) {
    // Rethrow as AppError so the error handler gets a real stack
    // (a plain object made `details` render as "[object Object]").
    throw new AppError(error.status || 500, error.message || "Failed to fetch notifications");
  }
};

// ------------------------------------------------------------------
// MARK AS READ
// ------------------------------------------------------------------
exports.markAsRead = async (tenantId, userId, notificationId) => {
  try {
    const notification = await Notification.findOne({
      where: {
        id: notificationId,
        tenantId,
        [Op.or]: [{ userId }, { userId: null }],
      },
    });

    if (!notification) {
      throw new AppError(404, "Notification not found");
    }

    // Per-user: writing isRead on a tenant-wide row would mark it read for
    // every recipient. The state row is upserted instead.
    await setState(notificationId, userId, {
      isRead: true,
      readAt: new Date(),
    });

    const plain = transformNotification(notification);
    plain.isRead = true;

    return {
      success: true,
      status: 200,
      message: "Notification marked as read",
      data: plain,
    };
  } catch (error) {
    // Rethrow as AppError so the error handler gets a real stack
    // (a plain object made `details` render as "[object Object]").
    throw new AppError(error.status || 500, error.message || "Failed to mark notification as read");
  }
};

// ------------------------------------------------------------------
// MARK ALL AS READ
// ------------------------------------------------------------------
exports.markAllAsRead = async (tenantId, userId) => {
  try {
    // Per-user: collect what this user can see, then upsert THEIR state rows.
    const visible = await Notification.findAll({
      where: recipientScope(tenantId, userId),
      attributes: ["id"],
    });
    await setStateForMany(
      visible.map((n) => n.id),
      userId,
      { isRead: true, readAt: new Date() },
    );

    return {
      success: true,
      status: 200,
      message: "All notifications marked as read",
    };
  } catch (error) {
    // Rethrow as AppError so the error handler gets a real stack
    // (a plain object made `details` render as "[object Object]").
    throw new AppError(error.status || 500, error.message || "Failed to mark all notifications as read");
  }
};

// ------------------------------------------------------------------
// DELETE NOTIFICATION
// ------------------------------------------------------------------
/**
 * Rows a user is allowed to act on: their own, plus tenant-wide broadcasts
 * (userId = null). Mirrors the read scope in fetchUserNotifications so a user
 * can always act on exactly what they can see.
 */
const recipientScope = (tenantId, userId) => ({
  tenantId,
  [Op.or]: [{ userId }, { userId: null }],
});

/**
 * Upsert this user's state for a notification (lazily creating the row).
 */
const setState = async (notificationId, userId, patch) => {
  const [state, created] = await NotificationState.findOrCreate({
    where: { notificationId, userId },
    defaults: { notificationId, userId, ...patch },
  });
  if (!created) {
    await state.update(patch);
  }
  return state;
};

/**
 * Apply a per-user state patch to many notifications at once. Rows the user
 * has never interacted with get a state row created here.
 */
const setStateForMany = async (notificationIds, userId, patch) => {
  if (notificationIds.length === 0) return 0;

  const existing = await NotificationState.findAll({
    where: { notificationId: { [Op.in]: notificationIds }, userId },
    attributes: ["notificationId"],
  });
  const seen = new Set(existing.map((s) => s.notificationId));

  const missing = notificationIds.filter((id) => !seen.has(id));
  if (missing.length) {
    await NotificationState.bulkCreate(
      missing.map((notificationId) => ({ notificationId, userId, ...patch })),
      { ignoreDuplicates: true },
    );
  }
  if (seen.size) {
    await NotificationState.update(patch, {
      where: { notificationId: { [Op.in]: [...seen] }, userId },
    });
  }
  return notificationIds.length;
};

/**
 * Remove notifications for one user.
 *
 * - Rows addressed to them personally are destroyed outright (nobody else can
 *   see them, so keeping the row would just leak storage).
 * - Tenant-wide rows are shared, so they are only HIDDEN for this user via a
 *   state row — other recipients keep theirs.
 */
const removeForUser = async (notifications, userId) => {
  const personal = notifications
    .filter((n) => n.userId === userId)
    .map((n) => n.id);
  const shared = notifications.filter((n) => n.userId === null).map((n) => n.id);

  if (personal.length) {
    await Notification.destroy({ where: { id: { [Op.in]: personal } } });
  }
  if (shared.length) {
    await setStateForMany(shared, userId, { deletedAt: new Date() });
  }
  return personal.length + shared.length;
};

// ------------------------------------------------------------------
// DELETE ALL NOTIFICATIONS
// ------------------------------------------------------------------
exports.deleteAllNotifications = async (tenantId, userId) => {
  try {
    const visible = await Notification.findAll({
      where: recipientScope(tenantId, userId),
      attributes: ["id", "userId"],
    });
    const deleted = await removeForUser(visible, userId);

    return {
      success: true,
      status: 200,
      message:
        deleted === 1
          ? "1 notification deleted"
          : `${deleted} notifications deleted`,
      data: { deleted },
    };
  } catch (error) {
    throw new AppError(
      error.status || 500,
      error.message || "Failed to delete notifications",
    );
  }
};

// ------------------------------------------------------------------
// DELETE SELECTED NOTIFICATIONS
// ------------------------------------------------------------------
exports.deleteManyNotifications = async (tenantId, userId, ids) => {
  try {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new AppError(400, "No notification ids provided");
    }

    // Scoped lookup: ids the caller cannot see are simply not matched, so this
    // can never remove another user's notifications.
    const matched = await Notification.findAll({
      where: {
        id: { [Op.in]: ids },
        ...recipientScope(tenantId, userId),
      },
      attributes: ["id", "userId"],
    });
    const deleted = await removeForUser(matched, userId);

    if (deleted === 0) {
      throw new AppError(404, "No matching notifications found");
    }

    return {
      success: true,
      status: 200,
      message:
        deleted === 1
          ? "1 notification deleted"
          : `${deleted} notifications deleted`,
      // `requested` vs `deleted` lets the client notice partial matches.
      data: { deleted, requested: ids.length },
    };
  } catch (error) {
    throw new AppError(
      error.status || 500,
      error.message || "Failed to delete notifications",
    );
  }
};

exports.deleteNotification = async (tenantId, userId, notificationId) => {
  try {
    const notification = await Notification.findOne({
      where: {
        id: notificationId,
        tenantId,
        [Op.or]: [{ userId }, { userId: null }],
      },
    });

    if (!notification) {
      throw new AppError(404, "Notification not found");
    }

    // Personal rows are destroyed; tenant-wide rows are only hidden for this
    // user so other recipients keep theirs.
    await removeForUser([notification], userId);

    return {
      success: true,
      status: 200,
      message: "Notification deleted successfully",
    };
  } catch (error) {
    // Rethrow as AppError so the error handler gets a real stack
    // (a plain object made `details` render as "[object Object]").
    throw new AppError(error.status || 500, error.message || "Failed to delete notification");
  }
};

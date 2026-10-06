// src/services/notification.service.ts
//
// P9-18 (ADR-087, Stage C): converted from notification.service.js with no
// behaviour change. `export =` keeps the object `require()` returned (the same
// seven keys, in the same order); it replaces the interim
// notification.service.d.ts and keeps its `emitNotification` types as the
// floor. `Op`, the three models, `AppError`, the page limits, `getIo` and the
// logger are captured at load, as the `.js` destructured them;
// `notificationChannels` is read at call time. `../config` is still loaded
// first (the `.js` destructured `db` from it and never used it).

import { Op as LoadedOp } from "sequelize";
import type { CountOptions, CreationAttributes, IncludeOptions, Transaction, WhereOptions } from "sequelize";
import "../config";
import models from "../models";
import { AppError as LoadedAppError } from "../utils/appError.util";
import { DEFAULT_LIMIT as LOADED_DEFAULT_LIMIT, MAX_LIMIT as LOADED_MAX_LIMIT } from "../constants";
import socket from "../config/socket";
import notificationChannels from "./notificationChannels.service";
import { logger as loadedLogger } from "../middlewares/activityLog.middleware";
import type { ModelInstance } from "../types/models";
import type { TenantId, UserId } from "../types/ids";

const Op = LoadedOp;
const { Notification, NotificationState, User } = models;
const AppError = LoadedAppError;
const DEFAULT_LIMIT = LOADED_DEFAULT_LIMIT;
const MAX_LIMIT = LOADED_MAX_LIMIT;
const { getIo } = socket;
const logger = loadedLogger;

type NotificationRow = ModelInstance<"Notification">;
type NotificationStateRow = ModelInstance<"NotificationState">;

/** A notification as `transformNotification` returns it: a plain object, per-user read state flattened. */
interface EmittedNotification {
  id: string;
  [field: string]: unknown;
}

/** The routing fields of `emitNotification`'s data: not Notification columns. */
interface Routing {
  channels?: string[] | null | undefined;
  recipientEmail?: string | null | undefined;
  recipientName?: string | null | undefined;
}

/** A service answer in the envelope shape the controller unwraps. */
interface ServiceAnswer<T = undefined> {
  success: true;
  status: number;
  message: string;
  data?: T;
}

/** A caught error, read as the `.js` read it (`error.status`, `error.message`, `error.stack`). */
const errorOf = (err: unknown): { status?: number; message?: string; stack?: string } =>
  err as { status?: number; message?: string; stack?: string };

// ------------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------------
const transformNotification = (notification: unknown): EmittedNotification | null => {
  if (!notification) {return null;}
  const source = notification as { toJSON?: () => unknown };
  // As built: a model instance is flattened with toJSON(), anything else is copied.
  const plain = (source.toJSON
    ? source.toJSON()
    : { ...notification }) as EmittedNotification & { states?: unknown };

  // Collapse the per-user state join into the flat shape clients already
  // expect: `isRead` reflects THIS user, not the shared row. Absent state row
  // = unread. The join array itself is internal, so it is stripped.
  if (Object.prototype.hasOwnProperty.call(plain, "states")) {
    const state = (Array.isArray(plain.states) ? plain.states[0] : null) as { isRead?: unknown; readAt?: unknown } | null | undefined;
    plain["isRead"] = state ? !!state.isRead : false;
    plain["readAt"] = state ? state.readAt : null;
    delete plain.states;
  }
  return plain;
};

// eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: any falsy value reads as no rows
const transformNotifications = (rows: unknown[] | null | undefined): (EmittedNotification | null)[] => (rows || []).map(transformNotification);

// ------------------------------------------------------------------
// EMIT NOTIFICATION (Internal Use)
// ------------------------------------------------------------------
/**
 * Deliver a stored notification on its realtime and (opt-in) email channels.
 * Never throws: a channel that fails is logged, the row is already stored.
 */
const deliverNotification = async (
  transformed: EmittedNotification,
  notifData: Record<string, unknown>,
  { channels, recipientEmail, recipientName }: Routing,
): Promise<void> => {
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
    // As built: the ids are interpolated as given.
    const room = notifData["userId"]
      // eslint-disable-next-line @typescript-eslint/no-base-to-string -- as built: the id's own string form
      ? `user_${String(notifData["userId"])}`
      : notifData["tenantId"]
        // eslint-disable-next-line @typescript-eslint/no-base-to-string -- as built: the id's own string form
        ? `tenant_${String(notifData["tenantId"])}`
        : null;
    // No recipient => nobody to notify in realtime (the row is still stored).
    if (room) {
      io.to(room).emit("new_notification", transformed);
    }
  } catch (socketErr) {
    logger.warn("Socket.io emit failed (server might be booting)", {
      notificationId: transformed.id,
      error: errorOf(socketErr).message,
    });
  }

  // --- Additional channel (email), opt-in via data.channels ---
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: any falsy list means the defaults
  const requested = channels || notificationChannels.DEFAULT_CHANNELS;
  if (requested.includes("email")) {
    try {
      let email = recipientEmail;
      let name = recipientName;
      // Resolve recipient contact details from the target user if not supplied.
      if (notifData["userId"] && !email) {
        const u = await User.findByPk(notifData["userId"] as string, {
          attributes: ["email", "firstName"],
        });
        if (u) {
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `email` is falsy on this path
          email = email || u.email;
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty name also falls back
          name = name || u.firstName;
        }
      }
      // The stored row carries its title and message.
      // As built: the recipient fields are passed through, undefined included.
      const dispatchFields = {
        channels: requested,
        recipientEmail: email,
        recipientName: name,
      };
      await notificationChannels.dispatch(
        transformed as unknown as Parameters<typeof notificationChannels.dispatch>[0],
        dispatchFields as Parameters<typeof notificationChannels.dispatch>[1],
      );
    } catch (chErr) {
      logger.warn("Notification channel dispatch failed", {
        notificationId: transformed.id,
        channels: requested,
        error: errorOf(chErr).message,
      });
    }
  }
};

/**
 * Store a notification and deliver it.
 *
 * Without a transaction (the historical form): best-effort — a failure is
 * logged and `null` returned, so a notification can never block the flow
 * that raised it (a stock reduction, a sign-off).
 *
 * W-04 — with `{ transaction }`: the row is written in the caller's
 * transaction (next to the caller's audit row), a failure is RE-THROWN so the
 * caller's transaction cannot commit half of it, and the realtime and email
 * deliveries wait for the COMMIT — a rolled-back notification is never
 * announced.
 *
 * @param data - Notification columns plus `channels`,
 *   `recipientEmail`, `recipientName` (routing only, not stored)
 * @param options.transaction - a Sequelize transaction
 * @returns the stored notification, or null after a
 *   logged failure outside a transaction
 */
const emitNotification = async (
  data: Record<string, unknown>,
  { transaction }: { transaction?: Transaction } = {},
): Promise<EmittedNotification | null> => {
  try {
    // Channel-routing fields are not Notification columns — strip them off
    // before persisting the row.
    const {
      channels,
      recipientEmail,
      recipientName,
      ...notifData
    } = data as Record<string, unknown> & Routing;
    const routing: Routing = { channels, recipientEmail, recipientName };
    // As built: the caller's columns are stored as given.
    const values = notifData as CreationAttributes<NotificationRow>;

    const newNotification = transaction
      ? await Notification.create(values, { transaction })
      : await Notification.create(values);
    // A created row always transforms to an object.
    const transformed = transformNotification(newNotification) as EmittedNotification;

    if (transaction) {
      // As built: the delivery promise is handed to afterCommit, which does not await it.
      transaction.afterCommit(() => deliverNotification(transformed, notifData, routing));
    } else {
      await deliverNotification(transformed, notifData, routing);
    }

    return transformed;
  } catch (error) {
    if (transaction) {
      throw error;
    }
    logger.error("Failed to emit notification", {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: a missing data object is tolerated here
      tenantId: data?.["tenantId"],
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: a missing data object is tolerated here
      userId: data?.["userId"],
      error: errorOf(error).message,
      stack: errorOf(error).stack,
    });
    // We don't throw here to prevent blocking main flows (like stock reduction) if notification fails
    return null;
  }
};

// ------------------------------------------------------------------
// FETCH USER NOTIFICATIONS
// ------------------------------------------------------------------
const fetchUserNotifications = async ({
  tenantId,
  userId,
  page = 1,
  limit = DEFAULT_LIMIT,
  isRead,
  type,
}: {
  tenantId: TenantId;
  userId: UserId;
  page?: number | string;
  limit?: number | string;
  isRead?: boolean | string;
  type?: string;
}): Promise<ServiceAnswer<{
  rows: (EmittedNotification | null)[];
  count: number;
  meta: { total: number; unread: number; page: number; limit: number; totalPages: number };
}>> => {
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
    const whereClause: Record<string | symbol, unknown> = {
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
      whereClause["type"] = type;
    }

    const safeLimit = Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT);
    const offset = (Number(page) - 1) * safeLimit;

    // subQuery:false is required for a WHERE on an included column to work
    // alongside limit/offset.
    const stateInclude: IncludeOptions = {
      model: NotificationState,
      as: "states",
      // required:false + a where puts userId in the JOIN's ON clause, so
      // notifications with no state row for this user still come back.
      where: { userId },
      required: false,
      attributes: ["isRead", "readAt", "deletedAt"],
    };

    const { count, rows } = await Notification.findAndCountAll({
      where: whereClause as WhereOptions<NotificationRow>,
      include: [stateInclude],
      limit: safeLimit,
      offset,
      order: [["createdAt", "DESC"], ["id", "DESC"]],
      subQuery: false,
      distinct: true,
    });

    const unreadWhere: Record<string | symbol, unknown> = {
      tenantId,
      [Op.or]: [{ userId: userId }, { userId: null }],
      "$states.deleted_at$": null,
      "$states.is_read$": { [Op.or]: [false, null] },
    };
    const unreadOptions: CountOptions<NotificationRow> & { subQuery: boolean } = {
      where: unreadWhere,
      include: [stateInclude],
      subQuery: false,
      distinct: true,
    };
    const unreadCount = await Notification.count(unreadOptions);

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
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: a 0 status or empty message also falls back
    throw new AppError(errorOf(error).status || 500, errorOf(error).message || "Failed to fetch notifications");
  }
};

// ------------------------------------------------------------------
// MARK AS READ
// ------------------------------------------------------------------
const markAsRead = async (
  tenantId: TenantId,
  userId: UserId,
  notificationId: string,
): Promise<ServiceAnswer<EmittedNotification>> => {
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

    // A found row always transforms to an object.
    const plain = transformNotification(notification) as EmittedNotification;
    plain["isRead"] = true;

    return {
      success: true,
      status: 200,
      message: "Notification marked as read",
      data: plain,
    };
  } catch (error) {
    // Rethrow as AppError so the error handler gets a real stack
    // (a plain object made `details` render as "[object Object]").
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: a 0 status or empty message also falls back
    throw new AppError(errorOf(error).status || 500, errorOf(error).message || "Failed to mark notification as read");
  }
};

// ------------------------------------------------------------------
// MARK ALL AS READ
// ------------------------------------------------------------------
const markAllAsRead = async (tenantId: TenantId, userId: UserId): Promise<ServiceAnswer> => {
  try {
    // Per-user: collect what this user can see, then upsert THEIR state rows.
    const visible = await Notification.findAll({
      where: recipientScope(tenantId, userId) as WhereOptions<NotificationRow>,
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
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: a 0 status or empty message also falls back
    throw new AppError(errorOf(error).status || 500, errorOf(error).message || "Failed to mark all notifications as read");
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
const recipientScope = (tenantId: TenantId, userId: UserId): Record<string | symbol, unknown> => ({
  tenantId,
  [Op.or]: [{ userId }, { userId: null }],
});

/**
 * Upsert this user's state for a notification (lazily creating the row).
 */
/** A per-user state change. */
interface StatePatch { isRead?: boolean; readAt?: Date; deletedAt?: Date }

const setState = async (notificationId: string, userId: UserId, patch: StatePatch): Promise<NotificationStateRow> => {
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
const setStateForMany = async (notificationIds: string[], userId: UserId, patch: StatePatch): Promise<number> => {
  if (notificationIds.length === 0) {return 0;}

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
const removeForUser = async (
  notifications: { id: string; userId: string | null }[],
  userId: UserId,
): Promise<number> => {
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
const deleteAllNotifications = async (tenantId: TenantId, userId: UserId): Promise<ServiceAnswer<{ deleted: number }>> => {
  try {
    const visible = await Notification.findAll({
      where: recipientScope(tenantId, userId) as WhereOptions<NotificationRow>,
      attributes: ["id", "userId"],
    });
    const deleted = await removeForUser(visible, userId);

    return {
      success: true,
      status: 200,
      message:
        deleted === 1
          ? "1 notification deleted"
          // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built: a number interpolated as its decimal string
          : `${deleted} notifications deleted`,
      data: { deleted },
    };
  } catch (error) {
    throw new AppError(
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: a 0 status also falls back
      errorOf(error).status || 500,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty message also falls back
      errorOf(error).message || "Failed to delete notifications",
    );
  }
};

// ------------------------------------------------------------------
// DELETE SELECTED NOTIFICATIONS
// ------------------------------------------------------------------
const deleteManyNotifications = async (
  tenantId: TenantId,
  userId: UserId,
  ids: unknown,
): Promise<ServiceAnswer<{ deleted: number; requested: number }>> => {
  try {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new AppError(400, "No notification ids provided");
    }

    // Scoped lookup: ids the caller cannot see are simply not matched, so this
    // can never remove another user's notifications.
    const matchedWhere: Record<string | symbol, unknown> = {
      id: { [Op.in]: ids as string[] },
      ...recipientScope(tenantId, userId),
    };
    const matched = await Notification.findAll({
      where: matchedWhere as WhereOptions<NotificationRow>,
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
          // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built: a number interpolated as its decimal string
          : `${deleted} notifications deleted`,
      // `requested` vs `deleted` lets the client notice partial matches.
      data: { deleted, requested: ids.length },
    };
  } catch (error) {
    throw new AppError(
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: a 0 status also falls back
      errorOf(error).status || 500,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty message also falls back
      errorOf(error).message || "Failed to delete notifications",
    );
  }
};

const deleteNotification = async (tenantId: TenantId, userId: UserId, notificationId: string): Promise<ServiceAnswer> => {
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
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: a 0 status or empty message also falls back
    throw new AppError(errorOf(error).status || 500, errorOf(error).message || "Failed to delete notification");
  }
};

export = {
  emitNotification,
  fetchUserNotifications,
  markAsRead,
  markAllAsRead,
  deleteAllNotifications,
  deleteManyNotifications,
  deleteNotification,
};

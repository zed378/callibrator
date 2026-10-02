// P9-25 (ADR-103 item 11): on the GENERATED client; the types are the
// contract's (backend/src/routes/api/notifications.openapi.ts). The names are unchanged.
import { typedApi, unwrap, type Answer, type DataOf, type Op, type QueryOf, type components } from "../typed";

// ─── Types ───────────────────────────────────────────────────────────────────

export type NotificationType =
  | "SYSTEM"
  | "CALIBRATION"
  | "INVENTORY"
  | "MAINTENANCE";

export type Notification = components["schemas"]["Notification"];

type List = Op<"/api/v1/notifications", "get">;

export type NotificationMeta = Answer<List>["meta"];

export interface NotificationListResult {
  notifications: Notification[];
  meta: NotificationMeta;
}

// ─── API Service ─────────────────────────────────────────────────────────────

export const notificationService = {
  /**
   * Get notifications for the current user (paginated)
   * @param page - Page number (default: 1)
   * @param limit - Items per page (default: 10)
   * @param isRead - Filter by read state (optional)
   * @param type - Filter by notification type (optional)
   */
  getAll: async (
    page = 1,
    limit = 10,
    isRead?: boolean,
    type?: NotificationType,
  ): Promise<NotificationListResult> => {
    const params: QueryOf<List> = { page, limit };

    // The contract publishes the query value as the string it is on the wire.
    if (isRead !== undefined) params.isRead = isRead ? "true" : "false";
    if (type) params.type = type;

    const response = await typedApi.GET("/api/v1/notifications", { params: { query: params } }).then(unwrap);

    const notifications = response.data ?? [];
    const meta: NotificationMeta = response.meta ?? {
      total: notifications.length,
      unread: 0,
      page,
      limit,
      totalPages: 1,
    };

    return { notifications, meta };
  },

  /**
   * Mark all notifications as read
   */
  markAllAsRead: async (): Promise<void> => {
    await typedApi.PATCH("/api/v1/notifications/read-all");
  },

  /**
   * Mark a single notification as read
   * @param notificationId - Notification UUID
   */
  markAsRead: async (notificationId: string): Promise<Notification> => {
    return (
      await typedApi
        .PATCH("/api/v1/notifications/{notificationId}/read", { params: { path: { notificationId } } })
        .then(unwrap)
    ).data;
  },

  /**
   * Delete a notification
   * @param notificationId - Notification UUID
   */
  delete: async (notificationId: string): Promise<void> => {
    await typedApi.DELETE("/api/v1/notifications/{notificationId}", { params: { path: { notificationId } } });
  },

  /**
   * Delete the selected notifications. Ids outside the caller's scope are
   * ignored server-side, so `deleted` may be < the number requested.
   */
  deleteMany: async (
    ids: string[],
  ): Promise<DataOf<Op<"/api/v1/notifications/bulk", "delete">>> => {
    const response = await typedApi.DELETE("/api/v1/notifications/bulk", { body: { ids } }).then(unwrap);
    return response.data ?? { deleted: 0, requested: ids.length };
  },

  /** Delete every notification visible to the caller. */
  deleteAll: async (): Promise<{ deleted: number }> => {
    const response = await typedApi.DELETE("/api/v1/notifications/all").then(unwrap);
    return response.data ?? { deleted: 0 };
  },

  /**
   * Diagnostic: emit a test notification to verify realtime (socket.io)
   * delivery. `scope` "user" targets only you; "tenant" targets the whole tenant.
   */
  sendTest: async (
    scope: "user" | "tenant" = "user",
  ): Promise<Notification | null> => {
    return (await typedApi.POST("/api/v1/notifications/test", { body: { scope } }).then(unwrap)).data;
  },
};

export default notificationService;

import { api } from "../client";

// ─── Types ───────────────────────────────────────────────────────────────────

export type NotificationType =
  | "SYSTEM"
  | "CALIBRATION"
  | "INVENTORY"
  | "MAINTENANCE";

export interface Notification {
  id: string;
  tenantId: string;
  userId?: string | null;
  type: NotificationType;
  title: string;
  message: string;
  isRead: boolean;
  actionUrl?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationMeta {
  total: number;
  unread: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface ListEnvelope {
  success: boolean;
  status: number;
  message: string;
  data: Notification[] | null;
  meta?: NotificationMeta;
}

interface ItemEnvelope<T> {
  success: boolean;
  status: number;
  message: string;
  data: T;
}

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
    const params: Record<string, string | number | boolean> = { page, limit };

    if (isRead !== undefined) params.isRead = isRead;
    if (type) params.type = type;

    const response = await api.get<ListEnvelope>("/api/v1/notifications", {
      params,
    });

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
    await api.patch<ItemEnvelope<null>>("/api/v1/notifications/read-all");
  },

  /**
   * Mark a single notification as read
   * @param notificationId - Notification UUID
   */
  markAsRead: async (notificationId: string): Promise<Notification> => {
    const response = await api.patch<ItemEnvelope<Notification>>(
      `/api/v1/notifications/${notificationId}/read`,
    );
    return response.data;
  },

  /**
   * Delete a notification
   * @param notificationId - Notification UUID
   */
  delete: async (notificationId: string): Promise<void> => {
    await api.delete<ItemEnvelope<null>>(
      `/api/v1/notifications/${notificationId}`,
    );
  },

  /**
   * Delete the selected notifications. Ids outside the caller's scope are
   * ignored server-side, so `deleted` may be < the number requested.
   */
  deleteMany: async (
    ids: string[],
  ): Promise<{ deleted: number; requested: number }> => {
    const response = await api.delete<
      ItemEnvelope<{ deleted: number; requested: number }>
    >("/api/v1/notifications/bulk", { data: { ids } });
    return response.data ?? { deleted: 0, requested: ids.length };
  },

  /** Delete every notification visible to the caller. */
  deleteAll: async (): Promise<{ deleted: number }> => {
    const response = await api.delete<ItemEnvelope<{ deleted: number }>>(
      "/api/v1/notifications/all",
    );
    return response.data ?? { deleted: 0 };
  },

  /**
   * Diagnostic: emit a test notification to verify realtime (socket.io)
   * delivery. `scope` "user" targets only you; "tenant" targets the whole tenant.
   */
  sendTest: async (
    scope: "user" | "tenant" = "user",
  ): Promise<Notification | null> => {
    const response = await api.post<ItemEnvelope<Notification | null>>(
      "/api/v1/notifications/test",
      { scope },
    );
    return response.data;
  },
};

export default notificationService;

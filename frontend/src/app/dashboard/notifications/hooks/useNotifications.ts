// src/app/dashboard/notifications/hooks/useNotifications.ts
import { useCallback, useEffect, useState } from "react";
import { useToastStore } from "@/stores/toastStore";
import {
  Notification,
  NotificationMeta,
  NotificationType,
  notificationService,
} from "@/api/services/notification.service";
import { getSocket } from "@/lib/socket";
import { useNotificationStore } from "@/stores/notificationStore";

const NOTIFICATION_TYPES: NotificationType[] = [
  "SYSTEM",
  "CALIBRATION",
  "INVENTORY",
  "MAINTENANCE",
];

export function useNotifications() {
  const { addToast } = useToastStore();
  const setUnreadCount = useNotificationStore((state) => state.setUnreadCount);

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [meta, setMeta] = useState<NotificationMeta>({
    total: 0,
    unread: 0,
    page: 1,
    limit: 10,
    totalPages: 1,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters & pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [typeFilter, setTypeFilter] = useState(""); // "" = all
  const [readFilter, setReadFilter] = useState(""); // "" = all, "unread", "read"

  // NOTE: this deliberately does NOT flip `isLoading`/`error` up front. It is
  // invoked from an effect, and writing state synchronously in an effect body
  // trips react-hooks/set-state-in-effect (and causes cascading renders). The
  // spinner is switched on by the handlers that trigger a reload instead.
  const fetchNotifications = useCallback(async () => {
    try {
      const isRead =
        readFilter === "read" ? true : readFilter === "unread" ? false : undefined;
      const type = NOTIFICATION_TYPES.includes(typeFilter as NotificationType)
        ? (typeFilter as NotificationType)
        : undefined;

      const result = await notificationService.getAll(
        currentPage,
        pageSize,
        isRead,
        type,
      );
      setNotifications(result.notifications);
      setMeta(result.meta);
      setError(null);
      // Keep the TopBar bell badge in sync — meta.unread is the tenant-wide
      // unread total regardless of the filters applied to this list.
      setUnreadCount(result.meta.unread ?? 0);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load notifications",
      );
    } finally {
      setIsLoading(false);
    }
  }, [currentPage, pageSize, readFilter, typeFilter, setUnreadCount]);

  useEffect(() => {
    let active = true;
    (async () => {
      // Defer past the synchronous effect body: fetchNotifications writes
      // state, and doing that synchronously in an effect cascades renders
      // (react-hooks/set-state-in-effect).
      await Promise.resolve();
      if (active) await fetchNotifications();
    })();
    return () => {
      active = false;
    };
  }, [fetchNotifications]);

  // Live updates: refresh the list when a notification arrives via socket.io
  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | null = null;

    (async () => {
      const socket = await getSocket();
      if (!socket || disposed) return;
      const onNotification = () => {
        fetchNotifications();
      };
      socket.on("new_notification", onNotification);
      cleanup = () => socket.off("new_notification", onNotification);
    })();

    return () => {
      disposed = true;
      if (cleanup) cleanup();
    };
  }, [fetchNotifications]);

  // Each of these triggers a refetch via the effect above; showing the skeleton
  // is done here (an event handler) rather than inside fetchNotifications.
  const handleTypeFilterChange = (value: string) => {
    setIsLoading(true);
    setTypeFilter(value);
    setCurrentPage(1);
  };

  const handleReadFilterChange = (value: string) => {
    setIsLoading(true);
    setReadFilter(value);
    setCurrentPage(1);
  };

  const goToPage = (page: number) => {
    setIsLoading(true);
    setCurrentPage(page);
  };

  // Changing how many rows are shown must return to page 1, otherwise the
  // current page can fall outside the new total page count.
  const changePageSize = (size: number) => {
    setIsLoading(true);
    setPageSize(size);
    setCurrentPage(1);
  };

  const markAsRead = async (notificationId: string) => {
    try {
      await notificationService.markAsRead(notificationId);
      addToast({ type: "success", title: "Notification marked as read" });
      await fetchNotifications();
    } catch (err) {
      addToast({
        type: "error",
        title:
          err instanceof Error
            ? err.message
            : "Failed to mark notification as read",
      });
    }
  };

  const markAllAsRead = async () => {
    try {
      await notificationService.markAllAsRead();
      addToast({ type: "success", title: "All notifications marked as read" });
      await fetchNotifications();
    } catch (err) {
      addToast({
        type: "error",
        title:
          err instanceof Error
            ? err.message
            : "Failed to mark all notifications as read",
      });
    }
  };

  const deleteNotification = async (notificationId: string) => {
    try {
      await notificationService.delete(notificationId);
      addToast({ type: "success", title: "Notification deleted" });
      // If we deleted the last item on the last page, step back a page
      if (notifications.length === 1 && currentPage > 1) {
        setCurrentPage(currentPage - 1);
      } else {
        await fetchNotifications();
      }
    } catch (err) {
      addToast({
        type: "error",
        title:
          err instanceof Error ? err.message : "Failed to delete notification",
      });
    }
  };

  return {
    notifications,
    meta,
    isLoading,
    error,
    currentPage,
    // Exposed under the original name so callers are unchanged; the wrapper
    // just shows the loading skeleton while the new page loads.
    setCurrentPage: goToPage,
    pageSize,
    setPageSize: changePageSize,
    typeFilter,
    readFilter,
    handleTypeFilterChange,
    handleReadFilterChange,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    refresh: fetchNotifications,
  };
}

export default useNotifications;

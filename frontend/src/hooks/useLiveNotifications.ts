// src/hooks/useLiveNotifications.ts
import { useEffect, useState } from "react";
import { getSocket } from "@/lib/socket";
import { Notification } from "@/api/services/notification.service";
import { useToastStore } from "@/stores/toastStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { playNotificationSound } from "@/lib/notificationSound";

/**
 * Live notification state. The unread count lives in the shared
 * notificationStore (so marking notifications as read on the notifications
 * page updates the TopBar bell instantly); this hook keeps it current via
 * the socket.io "new_notification" event and shows an info toast for every
 * incoming notification.
 */
export function useLiveNotifications() {
  const { addToast } = useToastStore();
  const { unreadCount, setUnreadCount, incrementUnread, refreshUnread } =
    useNotificationStore();
  const [latest, setLatest] = useState<Notification | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | null = null;

    refreshUnread();

    (async () => {
      const socket = await getSocket();
      if (!socket || disposed) return;

      const onConnect = () => setConnected(true);
      const onDisconnect = () => setConnected(false);
      const onNotification = (notification: Notification) => {
        incrementUnread();
        setLatest(notification);
        playNotificationSound();
        addToast({
          type: "info",
          title: notification.title,
          description: notification.message,
        });
      };

      socket.on("connect", onConnect);
      socket.on("disconnect", onDisconnect);
      socket.on("new_notification", onNotification);
      setConnected(socket.connected);

      cleanup = () => {
        socket.off("connect", onConnect);
        socket.off("disconnect", onDisconnect);
        socket.off("new_notification", onNotification);
      };
    })();

    return () => {
      disposed = true;
      // Remove only our listeners — the singleton socket stays connected
      // for other subscribers.
      if (cleanup) cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { unreadCount, latest, connected, setUnreadCount, refreshUnread };
}

export default useLiveNotifications;

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
 *
 * F-17: a push does not increment the badge — it re-reads the server's count,
 * so the same notification can never be counted twice. Every (re)connect
 * re-reads it too, so pushes missed while disconnected are not lost
 * (docs/FRONTEND/06-REALTIME.md: "on reconnect, refetch").
 */
export function useLiveNotifications() {
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const setUnreadCount = useNotificationStore((s) => s.setUnreadCount);
  const refreshUnread = useNotificationStore((s) => s.refreshUnread);
  const [latest, setLatest] = useState<Notification | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | null = null;
    // Store actions are read from the stores themselves, not closed over from
    // render, so this effect subscribes once per mount.
    const { refreshUnread: refresh } = useNotificationStore.getState();
    const { addToast } = useToastStore.getState();

    void refresh();

    (async () => {
      const socket = await getSocket();
      if (!socket || disposed) return;

      const onConnect = () => {
        setConnected(true);
        void refresh();
      };
      const onDisconnect = () => setConnected(false);
      const onNotification = (notification: Notification) => {
        void refresh();
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
  }, []);

  return { unreadCount, latest, connected, setUnreadCount, refreshUnread };
}

export default useLiveNotifications;

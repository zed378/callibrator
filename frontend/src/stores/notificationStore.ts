// src/stores/notificationStore.ts
import { create } from "zustand";
import { notificationService } from "@/api/services/notification.service";

/**
 * Shared unread-notification count. Written by:
 * - useLiveNotifications (socket "new_notification" → increment)
 * - the notifications page (after every fetch/mutation → sync from meta.unread)
 * Read by the TopBar NotificationBell, so marking notifications as read
 * anywhere updates the badge immediately.
 */
interface NotificationState {
  unreadCount: number;
  setUnreadCount: (count: number) => void;
  incrementUnread: () => void;
  refreshUnread: () => Promise<void>;
}

export const useNotificationStore = create<NotificationState>()((set) => ({
  unreadCount: 0,

  setUnreadCount: (count) => set({ unreadCount: Math.max(0, count) }),

  incrementUnread: () =>
    set((state) => ({ unreadCount: state.unreadCount + 1 })),

  refreshUnread: async () => {
    try {
      const res = await notificationService.getAll(1, 1);
      set({ unreadCount: res.meta.unread ?? 0 });
    } catch {
      // Non-fatal — badge keeps its previous value.
    }
  },
}));

// src/stores/notificationStore.ts
import { create } from "zustand";
import { notificationService } from "@/api/services/notification.service";

/**
 * Shared unread-notification count, read by the TopBar NotificationBell.
 *
 * F-17: the count is only ever the SERVER's number. It used to be incremented
 * locally on every socket push while the notifications page independently set
 * it from `meta.unread` — two writers racing, so a push that landed between
 * the page's fetch and its setUnreadCount was counted twice, and pushes missed
 * while disconnected left it permanently low. Now:
 * - a push, a (re)connect and the page's own fetch all resolve to the server's
 *   `meta.unread` — a notification can never be counted twice, because nothing
 *   counts; the server does;
 * - the newest read wins: every write bumps a sequence number, and a refresh
 *   whose response arrives after a newer write (or a newer refresh) is dropped.
 */
interface NotificationState {
  unreadCount: number;
  /** Set from a server response the caller already has (e.g. `meta.unread`). */
  setUnreadCount: (count: number) => void;
  /** Re-read the count from the server. Never throws. */
  refreshUnread: () => Promise<void>;
}

// Sequence of writes. Module-level: there is one store.
let latestWrite = 0;

export const useNotificationStore = create<NotificationState>()((set) => ({
  unreadCount: 0,

  setUnreadCount: (count) => {
    latestWrite += 1;
    set({ unreadCount: Math.max(0, count) });
  },

  refreshUnread: async () => {
    latestWrite += 1;
    const mine = latestWrite;
    try {
      const res = await notificationService.getAll(1, 1);
      // A newer write happened while this was in flight: it wins.
      if (mine !== latestWrite) return;
      set({ unreadCount: Math.max(0, res.meta.unread ?? 0) });
    } catch {
      // Non-fatal — the badge keeps its previous value.
    }
  },
}));

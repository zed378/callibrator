// src/components/layouts/NotificationBell.tsx
"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Bell,
  Settings,
  Gauge,
  Package,
  Wrench,
  ArrowRight,
  Loader2,
} from "lucide-react";
import useLiveNotifications from "@/hooks/useLiveNotifications";
import {
  notificationService,
  Notification,
  NotificationType,
} from "@/api/services/notification.service";

const PREVIEW_LIMIT = 6;

const TYPE_ICONS: Record<NotificationType, React.ReactNode> = {
  SYSTEM: <Settings className="w-4 h-4" />,
  CALIBRATION: <Gauge className="w-4 h-4" />,
  INVENTORY: <Package className="w-4 h-4" />,
  MAINTENANCE: <Wrench className="w-4 h-4" />,
};

/**
 * TopBar bell with a live unread badge and a dropdown drawer previewing the
 * latest notifications (titles/messages ellipsis-truncated), plus a button
 * to the full notifications page.
 */
export const NotificationBell: React.FC = () => {
  const router = useRouter();
  const { unreadCount, latest } = useLiveNotifications();

  const [isOpen, setIsOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // The panel lives in a portal, so it is NOT inside containerRef.
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelPos, setPanelPos] = useState<{ top: number; right: number }>({
    top: 0,
    right: 0,
  });

  // The TopBar sets `z-30` AND `backdrop-blur`, each of which creates a
  // stacking context — so a dropdown nested inside it can never paint above
  // page content that also uses z-50 (Select panels, the notifications page).
  // Portalling to <body> escapes that context entirely; position is measured
  // from the bell button since the panel is then `fixed`.
  const measure = useCallback(() => {
    const el = buttonRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPanelPos({
      top: rect.bottom + 8,
      right: Math.max(8, window.innerWidth - rect.right),
    });
  }, []);

  // Refresh the preview when opening, and live when a new notification
  // arrives while the drawer is open. State is only written in the async
  // continuation — never synchronously in the effect body (the spinner is
  // switched on by the click handler instead).
  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    (async () => {
      try {
        const res = await notificationService.getAll(1, PREVIEW_LIMIT);
        if (active) setItems(res.notifications);
      } catch {
        // Non-fatal — drawer just shows the empty state.
      } finally {
        if (active) setIsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [isOpen, latest]);

  // Close on outside click / Escape. The panel is portalled, so a click inside
  // it is NOT inside containerRef — both refs must be checked.
  useEffect(() => {
    if (!isOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const inTrigger = containerRef.current?.contains(target);
      const inPanel = panelRef.current?.contains(target);
      if (!inTrigger && !inPanel) setIsOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  // Keep the fixed panel anchored to the bell while open.
  useEffect(() => {
    if (!isOpen) return;
    const onReflow = () => measure();
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    return () => {
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }, [isOpen, measure]);

  const goToNotifications = () => {
    setIsOpen(false);
    router.push("/dashboard/notifications");
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          if (!isOpen) {
            // Measure before opening so the fixed panel lands in the right
            // spot, and show the spinner from here (event handlers may
            // setState freely, effect bodies may not).
            measure();
            setIsLoading(true);
          }
          setIsOpen((open) => !open);
        }}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
        aria-expanded={isOpen}
        className="relative p-2 rounded-lg hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors inline-flex"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full bg-destructive text-white text-[10px] font-bold flex items-center justify-center px-1">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            style={{ top: panelPos.top, right: panelPos.right }}
            className="fixed w-80 sm:w-96 bg-card border border-border rounded-xl shadow-lg z-100 overflow-hidden"
          >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/[0.03]">
            <h3 className="text-sm font-semibold text-foreground">
              Notifications
            </h3>
            {unreadCount > 0 && (
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                {unreadCount} unread
              </span>
            )}
          </div>

          {/* Preview list */}
          <div className="max-h-80 overflow-y-auto divide-y divide-border/60">
            {isLoading && items.length === 0 ? (
              <div className="py-10 flex items-center justify-center text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            ) : items.length > 0 ? (
              items.map((notification) => (
                <button
                  key={notification.id}
                  type="button"
                  onClick={goToNotifications}
                  className={`w-full flex items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 ${
                    !notification.isRead ? "bg-primary/5" : ""
                  }`}
                >
                  <span className="mt-0.5 w-8 h-8 rounded-lg bg-muted/60 flex items-center justify-center shrink-0 text-muted-foreground">
                    {TYPE_ICONS[notification.type] ?? (
                      <Settings className="w-4 h-4" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span
                        className={`block text-sm truncate ${
                          !notification.isRead
                            ? "font-semibold text-foreground"
                            : "font-medium text-foreground/80"
                        }`}
                      >
                        {notification.title}
                      </span>
                      {!notification.isRead && (
                        <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
                      )}
                    </span>
                    {/* Ellipsis: single-line truncation for the message */}
                    <span className="block text-xs text-muted-foreground truncate">
                      {notification.message}
                    </span>
                    <span className="block text-[10px] text-muted-foreground/70 mt-0.5">
                      {new Date(notification.createdAt).toLocaleString()}
                    </span>
                  </span>
                </button>
              ))
            ) : (
              <div className="py-10 text-center">
                <Bell className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">
                  No notifications yet
                </p>
              </div>
            )}
          </div>

          {/* Footer: full page redirect */}
          <div className="border-t border-border p-2">
            <button
              type="button"
              onClick={goToNotifications}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-primary hover:bg-primary/10 transition-colors"
            >
              View all notifications
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
          </div>,
          document.body,
        )}
    </div>
  );
};

export default NotificationBell;

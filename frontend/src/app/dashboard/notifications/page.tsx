// src/app/dashboard/notifications/page.tsx
"use client";

import React, { useState } from "react";
import Link from "next/link";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import {
  Button,
  Select,
  Card,
  CardContent,
  Badge,
  Alert,
  Skeleton,
  ConfirmDialog,
} from "@/components/ui";
import { Pagination } from "@/components/ui/Table";
import {
  Settings,
  Gauge,
  Package,
  Wrench,
  Check,
  CheckCheck,
  Trash2,
  BellOff,
  BellRing,
} from "lucide-react";
import {
  Notification,
  NotificationType,
  notificationService,
} from "@/api/services/notification.service";
import { useToastStore } from "@/stores/toastStore";
import { useNotifications } from "./hooks/useNotifications";

const TYPE_CONFIG: Record<
  NotificationType,
  { icon: React.ReactNode; label: string; bgColor: string }
> = {
  SYSTEM: {
    icon: <Settings className="h-5 w-5 text-primary" />,
    label: "System",
    bgColor: "bg-primary/10",
  },
  CALIBRATION: {
    icon: <Gauge className="h-5 w-5 text-info" />,
    label: "Calibration",
    bgColor: "bg-info/10",
  },
  INVENTORY: {
    icon: <Package className="h-5 w-5 text-warning" />,
    label: "Inventory",
    bgColor: "bg-warning/10",
  },
  MAINTENANCE: {
    icon: <Wrench className="h-5 w-5 text-success" />,
    label: "Maintenance",
    bgColor: "bg-success/10",
  },
};

function NotificationRow({
  notification,
  onMarkAsRead,
  onDelete,
  isSelected,
  onToggleSelect,
}: {
  notification: Notification;
  onMarkAsRead: (id: string) => void;
  onDelete: (id: string) => void;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
}) {
  const config = TYPE_CONFIG[notification.type] ?? TYPE_CONFIG.SYSTEM;

  return (
    <div
      className={`flex items-start gap-4 p-4 rounded-2xl bg-card shadow-xs border border-border transition-colors ${
        !notification.isRead ? "bg-primary/5" : ""
      }`}
    >
      <input
        type="checkbox"
        checked={isSelected}
        onChange={() => onToggleSelect(notification.id)}
        aria-label={`Select notification: ${notification.title}`}
        className="mt-3 shrink-0 h-4 w-4 accent-primary cursor-pointer"
      />

      <div
        className={`shrink-0 flex items-center justify-center w-10 h-10 rounded-full ${config.bgColor}`}
      >
        {config.icon}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {notification.actionUrl ? (
            <Link
              href={notification.actionUrl}
              className="font-semibold text-foreground hover:text-primary hover:underline"
            >
              {notification.title}
            </Link>
          ) : (
            <span className="font-semibold text-foreground">
              {notification.title}
            </span>
          )}
          {!notification.isRead && (
            <span
              className="w-2 h-2 rounded-full bg-primary shrink-0"
              aria-label="Unread"
            />
          )}
          <Badge variant="secondary" size="sm">
            {config.label}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground mt-1 break-words">
          {notification.message}
        </p>
        <p className="text-xs text-muted-foreground mt-2">
          {new Date(notification.createdAt).toLocaleString()}
        </p>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {!notification.isRead && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onMarkAsRead(notification.id)}
            className="text-primary hover:text-primary hover:bg-muted"
            title="Mark as read"
          >
            <Check className="h-4 w-4" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onDelete(notification.id)}
          className="text-destructive hover:text-destructive hover:bg-muted"
          title="Delete notification"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function NotificationListSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="flex items-start gap-4 p-4 rounded-2xl bg-card border border-border"
        >
          <Skeleton variant="circle" className="w-10 h-10 shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-1/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function NotificationsPage() {
  const {
    notifications,
    meta,
    isLoading,
    error,
    currentPage,
    setCurrentPage,
    pageSize,
    setPageSize,
    typeFilter,
    readFilter,
    handleTypeFilterChange,
    handleReadFilterChange,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    refresh,
  } = useNotifications();

  const { addToast } = useToastStore();
  const [sendingTest, setSendingTest] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  // Which destructive action is awaiting confirmation (null = no modal).
  const [confirmAction, setConfirm] = useState<"selected" | "all" | null>(null);

  const visibleIds = notifications.map((n) => n.id);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

  const toggleSelectAllVisible = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        visibleIds.forEach((id) => next.delete(id));
      } else {
        visibleIds.forEach((id) => next.add(id));
      }
      return next;
    });

  const handleDeleteSelected = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;

    setIsDeleting(true);
    try {
      const { deleted } = await notificationService.deleteMany(ids);
      setSelected(new Set());
      setConfirm(null);
      await refresh();
      addToast({
        type: "success",
        title: `${deleted} notification${deleted === 1 ? "" : "s"} deleted`,
      });
    } catch (err) {
      setConfirm(null);
      addToast({
        type: "error",
        title: "Failed to delete notifications",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteAll = async () => {
    setIsDeleting(true);
    try {
      const { deleted } = await notificationService.deleteAll();
      setSelected(new Set());
      setConfirm(null);
      await refresh();
      addToast({
        type: "success",
        title: `${deleted} notification${deleted === 1 ? "" : "s"} deleted`,
      });
    } catch (err) {
      setConfirm(null);
      addToast({
        type: "error",
        title: "Failed to delete notifications",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setIsDeleting(false);
    }
  };

  // Diagnostic: emit a notification from the server so socket.io pushes it back
  // live. Watch the bell badge + toast update in real time; then refresh the list.
  const handleSendTest = async () => {
    setSendingTest(true);
    try {
      await notificationService.sendTest("user");
      await refresh();
    } catch {
      addToast({ type: "error", title: "Failed to send test notification" });
    } finally {
      setSendingTest(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight">
                Notifications
              </h1>
              <Badge variant={meta.unread > 0 ? "primary" : "default"}>
                {meta.unread} unread
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Stay up to date with system, calibration, inventory and
              maintenance events.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={handleSendTest}
              isLoading={sendingTest}
              className="flex items-center gap-2"
              title="Emit a test notification to verify realtime delivery"
            >
              <BellRing className="h-4 w-4" />
              Send test
            </Button>
            <Button
              variant="outline"
              onClick={markAllAsRead}
              disabled={meta.unread === 0 || isLoading}
              className="flex items-center gap-2"
            >
              <CheckCheck className="h-4 w-4" />
              Mark all as read
            </Button>
            <Button
              variant="outline"
              onClick={() => setConfirm("selected")}
              disabled={selected.size === 0 || isDeleting}
              className="flex items-center gap-2 text-destructive border-destructive/30 hover:border-destructive/50"
              title="Delete the selected notifications"
            >
              <Trash2 className="h-4 w-4" />
              Delete selected
              {selected.size > 0 ? ` (${selected.size})` : ""}
            </Button>
            <Button
              variant="outline"
              onClick={() => setConfirm("all")}
              disabled={meta.total === 0 || isDeleting}
              className="flex items-center gap-2 text-destructive border-destructive/30 hover:border-destructive/50"
              title="Delete every notification"
            >
              <Trash2 className="h-4 w-4" />
              Delete all
            </Button>
          </div>
        </div>

        {/* Filters */}
        <Card className="bg-card/50 backdrop-blur-sm border-border relative z-50">
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Select
                value={typeFilter}
                onChange={handleTypeFilterChange}
                options={[
                  { value: "", label: "All Types" },
                  { value: "SYSTEM", label: "System" },
                  { value: "CALIBRATION", label: "Calibration" },
                  { value: "INVENTORY", label: "Inventory" },
                  { value: "MAINTENANCE", label: "Maintenance" },
                ]}
              />
              <Select
                value={readFilter}
                onChange={handleReadFilterChange}
                options={[
                  { value: "", label: "All Notifications" },
                  { value: "unread", label: "Unread" },
                  { value: "read", label: "Read" },
                ]}
              />
            </div>
          </CardContent>
        </Card>

        {error && <Alert variant="error">{error}</Alert>}

        {/* Notification list */}
        {isLoading ? (
          <NotificationListSkeleton />
        ) : notifications.length === 0 ? (
          <div className="rounded-2xl bg-card p-12 text-center shadow-xs border border-border">
            <BellOff className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-30" />
            <p className="text-lg font-medium text-muted-foreground">
              You&apos;re all caught up
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              No notifications match your current filters.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Select-all bar for the current page */}
            <label className="flex items-center gap-3 px-4 py-2 rounded-xl bg-muted/40 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleSelectAllVisible}
                aria-label="Select all notifications on this page"
                className="h-4 w-4 accent-primary cursor-pointer"
              />
              <span className="text-muted-foreground">
                {selected.size > 0
                  ? `${selected.size} selected`
                  : "Select all on this page"}
              </span>
              {selected.size > 0 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    setSelected(new Set());
                  }}
                  className="ml-auto text-xs font-medium text-primary hover:underline"
                >
                  Clear selection
                </button>
              )}
            </label>

            {notifications.map((notification) => (
              <NotificationRow
                key={notification.id}
                notification={notification}
                onMarkAsRead={markAsRead}
                onDelete={deleteNotification}
                isSelected={selected.has(notification.id)}
                onToggleSelect={toggleSelect}
              />
            ))}
          </div>
        )}

        {/* Pagination */}
        {!isLoading && notifications.length > 0 && (
          <div className="rounded-2xl bg-card shadow-xs border border-border">
            <Pagination
              currentPage={currentPage}
              totalPages={meta.totalPages}
              totalItems={meta.total}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
              onPageSizeChange={setPageSize}
              pageSizes={[10, 25, 50, 100]}
            />
          </div>
        )}

        <ConfirmDialog
          isOpen={confirmAction !== null}
          isLoading={isDeleting}
          title={
            confirmAction === "all"
              ? "Delete all notifications?"
              : `Delete ${selected.size} notification${selected.size === 1 ? "" : "s"}?`
          }
          description={
            confirmAction === "all"
              ? `This permanently removes all ${meta.total} of your notifications. This cannot be undone.`
              : "The selected notifications will be permanently removed. This cannot be undone."
          }
          confirmLabel="Delete"
          onCancel={() => setConfirm(null)}
          onConfirm={
            confirmAction === "all" ? handleDeleteAll : handleDeleteSelected
          }
        />
      </div>
    </DashboardLayout>
  );
}

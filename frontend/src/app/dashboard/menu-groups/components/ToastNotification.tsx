"use client";

import { CheckCircle2, XCircle, LayoutGrid } from "lucide-react";

interface ToastData {
  type: "success" | "error" | "info";
  title: string;
  description: string;
}

interface ToastNotificationProps {
  toast: ToastData | null;
}

const typeColors = {
  success: {
    bg: "bg-success/10 border-success/30/50 text-success",
    icon: "text-success",
  },
  error: {
    bg: "bg-destructive/10 border-destructive/30 text-destructive",
    icon: "text-destructive",
  },
  info: {
    bg: "bg-info/10 border-info/30 text-info",
    icon: "text-info",
  },
};

export function ToastNotification({ toast }: ToastNotificationProps) {
  if (!toast) return null;
  const colors = typeColors[toast.type];

  return (
    <div
      className={`fixed top-4 right-4 z-50 p-4 rounded-lg shadow-lg max-w-md border ${colors.bg}`}
    >
      <div className="flex items-start gap-3">
        {toast.type === "success" && (
          <CheckCircle2
            className={`w-5 h-5 mt-0.5 flex-shrink-0 ${colors.icon}`}
          />
        )}
        {toast.type === "error" && (
          <XCircle
            className={`w-5 h-5 mt-0.5 flex-shrink-0 ${colors.icon}`}
          />
        )}
        {toast.type === "info" && (
          <LayoutGrid
            className={`w-5 h-5 mt-0.5 flex-shrink-0 ${colors.icon}`}
          />
        )}
        <div>
          <h4
            className="font-semibold text-sm text-foreground"
          >
            {toast.title}
          </h4>
          <p
            className="text-xs mt-1 text-muted-foreground"
          >
            {toast.description}
          </p>
        </div>
      </div>
    </div>
  );
}

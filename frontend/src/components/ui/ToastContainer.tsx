"use client";

import React from "react";
import { useToastStore } from "@/stores/toastStore";
import { CheckCircle2, XCircle, AlertCircle, Info, X } from "lucide-react";

const icons = {
  success: <CheckCircle2 className="w-5 h-5 text-success" />,
  error: <XCircle className="w-5 h-5 text-destructive" />,
  warning: <AlertCircle className="w-5 h-5 text-warning" />,
  info: <Info className="w-5 h-5 text-info" />,
};

const toastColors = {
  success: "ring-1 ring-success/30 bg-success/10 text-success",
  error: "ring-1 ring-destructive/30 bg-destructive/10 text-destructive",
  warning: "ring-1 ring-warning/30 bg-warning/10 text-warning",
  info: "ring-1 ring-info/30 bg-info/10 text-info",
};

export function ToastContainer() {
  const { toasts, removeToast } = useToastStore();

  return (
    // z-100 puts toasts on the same overlay tier as the notification dropdown.
    // At z-50 they tied with page content (Select panels, dashboard cards) and
    // lost, because ToastContainer is mounted BEFORE {children} in the root
    // layout — on an equal z-index the later-painted element wins.
    <div className="fixed top-4 right-4 z-100 flex flex-col gap-3 max-w-sm w-full pointer-events-none" suppressHydrationWarning>
      {toasts.map((toast) => {
        const borderBgColor = toastColors[toast.type];

        return (
          <div
            key={toast.id}
            role="alert"
            aria-live="assertive"
            className={`pointer-events-auto flex items-start gap-3 p-4 rounded-xl border backdrop-blur-md shadow-lg transition-all duration-300 ${borderBgColor}`}
          >
            <div className="flex-shrink-0 mt-0.5">{icons[toast.type]}</div>
            <div className="flex-1 min-w-0">
              <h4 className="font-semibold text-sm leading-5 text-foreground">
                {toast.title}
              </h4>
              {toast.description && (
                <p className="text-xs mt-1 leading-4 text-muted-foreground">
                  {toast.description}
                </p>
              )}
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="flex-shrink-0 p-0.5 rounded-lg transition-colors hover:bg-white/10 text-muted-foreground hover:text-foreground"
              aria-label="Close notification"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

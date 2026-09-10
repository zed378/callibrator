"use client";

import React from "react";
import { AlertTriangle } from "lucide-react";
import { Dialog } from "./Dialog";
import { Button } from "./Button";

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  /** Supporting copy — say what will happen and whether it is reversible. */
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" for destructive actions (delete/remove), "primary" otherwise. */
  variant?: "danger" | "primary";
  isLoading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Themed confirmation modal — the replacement for `window.confirm`, which is
 * unstyled, blocks the main thread, and cannot be themed or tested.
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "danger",
  isLoading = false,
  onConfirm,
  onCancel,
}) => (
  <Dialog isOpen={isOpen} onClose={onCancel} size="md">
    <div className="flex items-start gap-4">
      <span
        className={`shrink-0 flex items-center justify-center w-11 h-11 rounded-full ${
          variant === "danger"
            ? "bg-destructive/10 text-destructive"
            : "bg-primary/10 text-primary"
        }`}
      >
        <AlertTriangle className="w-5 h-5" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-lg font-bold tracking-tight text-foreground">
          {title}
        </h2>
        {description && (
          <div className="text-sm text-muted-foreground mt-1.5">
            {description}
          </div>
        )}
      </div>
    </div>

    <div className="flex justify-end gap-2 mt-6">
      <Button variant="ghost" onClick={onCancel} disabled={isLoading}>
        {cancelLabel}
      </Button>
      <Button
        variant={variant === "danger" ? "danger" : "primary"}
        onClick={onConfirm}
        isLoading={isLoading}
        autoFocus
      >
        {confirmLabel}
      </Button>
    </div>
  </Dialog>
);

export default ConfirmDialog;

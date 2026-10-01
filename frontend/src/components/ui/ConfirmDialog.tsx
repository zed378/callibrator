"use client";

import React, { useId, useState } from "react";
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
  /**
   * For an irreversible action whose target must be named, not just clicked
   * (a restore that overwrites a tenant's data): the confirm button stays
   * disabled until this exact text is typed.
   */
  confirmPhrase?: string;
}

/**
 * The dialog body. Rendered only while the dialog is open (Dialog returns
 * null when closed), so the typed phrase starts empty every time it opens.
 */
const ConfirmBody: React.FC<Omit<ConfirmDialogProps, "isOpen">> = ({
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "danger",
  isLoading = false,
  onConfirm,
  onCancel,
  confirmPhrase,
}) => {
  const [typed, setTyped] = useState("");
  const inputId = useId();
  const phraseMatches = confirmPhrase === undefined || typed === confirmPhrase;
  return (
    <>
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
          {confirmPhrase !== undefined && (
            <div className="mt-4">
              <label
                htmlFor={inputId}
                className="block text-sm font-medium text-foreground mb-1.5"
              >
                Type <span className="font-mono font-semibold">{confirmPhrase}</span>{" "}
                to confirm
              </label>
              <input
                id={inputId}
                type="text"
                autoComplete="off"
                autoFocus
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
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
          disabled={!phraseMatches}
          autoFocus={confirmPhrase === undefined}
        >
          {confirmLabel}
        </Button>
      </div>
    </>
  );
};

/**
 * Themed confirmation modal — the replacement for `window.confirm`, which is
 * unstyled, blocks the main thread, and cannot be themed or tested.
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  ...body
}) => (
  <Dialog isOpen={isOpen} onClose={body.onCancel} size="md" ariaLabel={body.title}>
    <ConfirmBody {...body} />
  </Dialog>
);

export default ConfirmDialog;

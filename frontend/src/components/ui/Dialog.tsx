"use client";

import React, { useId } from "react";
import { X } from "lucide-react";
import { Button } from "./Button";
import { useModalA11y } from "./useModalA11y";

interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
  /**
   * The dialog's accessible name when it has no visible `title` (a
   * ConfirmDialog renders its own heading). One of the two should be given.
   */
  ariaLabel?: string;
  size?: "sm" | "md" | "lg" | "xl";
}

const sizeMap: Record<string, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
};

/**
 * The modal dialog primitive. F-12: `role="dialog"`, `aria-modal`, named by
 * its title (`aria-labelledby`) or `ariaLabel`; focus moves in and is trapped,
 * Escape closes, focus returns to the opener, the page does not scroll behind
 * it (useModalA11y). The close button has an accessible name.
 */
export const Dialog: React.FC<DialogProps> = ({
  isOpen,
  onClose,
  children,
  title,
  ariaLabel,
  size = "lg",
}) => {
  const titleId = useId();
  const panelRef = useModalA11y<HTMLDivElement>(isOpen, onClose);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : ariaLabel}
        tabIndex={-1}
        className={`w-full ${sizeMap[size]} max-h-[90vh] overflow-y-auto bg-card rounded-2xl shadow-2xl animate-scale-in focus:outline-none`}
      >
        {title && (
          <div className="flex items-center justify-between p-6 border-b border-border">
            <h2
              id={titleId}
              className="text-xl font-bold tracking-tight text-foreground"
            >
              {title}
            </h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              aria-label="Close dialog"
              className="rounded-xl p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        )}
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
};
